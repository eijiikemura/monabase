// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readHistoryPage, historyPage, readHistoricalSource } = require('../services/gitHistory');
const { assertDataSize, GIT_SOURCE_MAX_BYTES, readInternalBufferSync } = require('../services/dataSafety');
const { createGitClient } = require('../services/gitClient');
const { redactGitSecrets, validateGitRemote, assertSafeOrigin, formatGitError } = require('../services/gitSecurity');
const { registerGitReviewHandlers } = require('../services/gitReview');
const fs = require('node:fs');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { enqueueGitWrite, commitPaths } = require('../services/gitWrites');
const { sourceFileName, canonicalGitDbType, legacySourceMatches } = require('../services/gitSourceNames');
const { workspacePath, workspaceRelativePath } = require('../services/workspacePaths');
const { atomicWriteFile } = require('../services/atomicFiles');

function registerGitHandlers({ ipcMain, gitDirectory: repoBase, t, createGit = overrides => createGitClient(repoBase, overrides, simpleGit) }) {
  const safeGitError = error => formatGitError(error, t);

  function handleWrite(channel, handler) {
    ipcMain.handle(channel, (...args) => enqueueGitWrite(repoBase, () => handler(...args)));
  }

  function sourcePaths({ dbType = 'ORACLE', schema = 'PUBLIC', objectType = 'UNKNOWN_TYPE', objectName, signature, tableName }) {
    const base = ['MonaBase', canonicalGitDbType(dbType), schema || 'PUBLIC', objectType || 'UNKNOWN_TYPE'];
    const file = sourceFileName(objectName, signature, tableName);
    const primary = workspaceRelativePath(repoBase, ...base, ...(signature === undefined ? ['.objects-v2'] : []), file);
    let legacy;
    // Do not guess ownership from a legacy filename shared by multiple possible names.
    if (signature === undefined && tableName === undefined) {
      try {
        const legacyName = objectName.endsWith('.sql') ? objectName : `${objectName}.sql`;
        const candidate = workspaceRelativePath(repoBase, ...base, legacyName);
        const file = workspacePath(repoBase, ...base, legacyName);
        const directory = path.dirname(file);
        // Match actual case rather than accepting a different object on case-insensitive filesystems.
        if (fs.existsSync(file) && fs.readdirSync(directory).includes(legacyName) &&
            legacySourceMatches(readInternalBufferSync(file, GIT_SOURCE_MAX_BYTES).toString('utf8'), { dbType, schema, objectType, objectName })) legacy = candidate;
      } catch (error) {
        if (error.code?.startsWith('internal_data_')) throw error;
        /* Old OS-unsafe filenames have no portable legacy path. */
      }
    }
    return { primary, legacy };
  }

  registerGitReviewHandlers({ ipcMain, repoBase, sourcePaths, createGit, t });

  function isDbSourceLocalRepo(repoBase) {
    const gitDir = path.join(repoBase, '.git');
    return fs.existsSync(gitDir);
  }

  async function currentBranch(git) {
    const ref = (await git.raw(['symbolic-ref', '--quiet', 'HEAD'])).trim();
    if (!ref.startsWith('refs/heads/')) throw new Error(t('git_current_branch_required'));
    return ref.slice('refs/heads/'.length);
  }

  function requiresPull(error) {
    // Git's porcelain rejection reason distinguishes history divergence from transport and hook errors.
    return /\[rejected\][^\r\n]*\((?:fetch first|non-fast-forward)\)/.test(error.message);
  }

  // Status can refresh the index; serialize it with writes to avoid index.lock races.
  handleWrite('git-status-check', async () => {
    try {
      const isRepo = isDbSourceLocalRepo(repoBase);
      let url = null;
      let ahead = null;
      let branch = null;
      let tracking = null;

      if (isRepo) {
        const git = await createGit();
        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        if (origin) url = origin.refs.push;

        const status = await git.status();
        branch = status.detached ? null : status.current;
        tracking = status.tracking;
        if (url && branch && tracking === `origin/${branch}`) {
          // A missing tracking ref is unknown, even when status reports ahead=0.
          try {
            const count = (await git.raw(['rev-list', '--count', `refs/remotes/origin/${branch}..HEAD`])).trim();
            if (/^\d+$/.test(count)) ahead = Number(count);
          } catch { /* Allow a normal Push to establish or repair tracking. */ }
        }
      }
      return { success: true, isRepo, remoteUrl: url ? redactGitSecrets(url) : url, repoPath: repoBase, ahead, branch, tracking };
    } catch (e) {
      return { success: false, error: safeGitError(e) };
    }
  });

  handleWrite('git-init-local', async () => {
    try {
      if (!fs.existsSync(repoBase)) {
        fs.mkdirSync(repoBase, { recursive: true });
      }
      const git = await createGit();

      await git.init();
      return { success: true };
    } catch (err) {
      console.error('Git Init Error:', safeGitError(err));
      return { success: false, error: safeGitError(err) };
    }
  });

  handleWrite('git-set-remote', async (event, { url, branch }) => {
    try {
      validateGitRemote(url);
      if (!isDbSourceLocalRepo(repoBase)) {
        return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      }
      const git = await createGit();
      const localBranch = await currentBranch(git);
      if (branch !== localBranch) return { success: false, error: t('git_branch_changed_refresh_settings') };
      const branchRef = `refs/heads/${localBranch}`;
      // An absent branch ref means an unborn branch; query failures must stop setup.
      const refs = await git.raw(['for-each-ref', '--format=%(refname)', branchRef]);
      const hasCommits = refs.split('\n').includes(branchRef);

      const remotes = await git.getRemotes();
      const hasOrigin = remotes.some(r => r.name === 'origin');

      if (hasOrigin) {
        await git.remote(['set-url', 'origin', url]);
      } else {
        await git.addRemote('origin', url);
      }

      if (!hasCommits) {
        const readme = workspacePath(repoBase, 'README.md');
        let createdReadme = false;
        try {
          fs.writeFileSync(readme, '# MonaBase Repository\n', { flag: 'wx', mode: 0o600 });
          createdReadme = true;
        } catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (createdReadme) {
          await git.raw(['--literal-pathspecs', 'add', '--', 'README.md']);
          await commitPaths(git, 'Initial commit', ['README.md']);
        } else {
          // Preserve existing files and staged work, even on the first commit.
          await git.raw(['commit', '--allow-empty', '--only', '-m', 'Initial commit']);
        }
      }

      try {
        await assertSafeOrigin(git);
      await git.push(['-u', 'origin', `HEAD:refs/heads/${localBranch}`]);
        return { success: true };
      } catch (pushErr) {
        return { success: false, needsPull: requiresPull(pushErr), error: safeGitError(pushErr) };
      }

    } catch (err) {
      console.error('Git Set Remote Error:', safeGitError(err));
      return { success: false, error: safeGitError(err) };
    }
  });

  handleWrite('git-commit', async (event, request) => {
    try {
      let relative;
      if (request.objectType === 'ErDiagram') {
        const name = request.objectName.endsWith('.json') ? request.objectName : `${request.objectName}.json`;
        relative = workspaceRelativePath(repoBase, 'MonaBase', canonicalGitDbType(request.dbType || 'ORACLE'), 'ErDiagram', name);
      } else relative = sourcePaths(request).primary;
      if (!isDbSourceLocalRepo(repoBase)) return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      const file = workspacePath(repoBase, ...relative.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      assertDataSize(Buffer.byteLength(request.sourceText || ''), GIT_SOURCE_MAX_BYTES);
      atomicWriteFile(file, request.sourceText || '');
      const git = await createGit();
      await git.raw(['--literal-pathspecs', 'add', '--', relative]);
      await commitPaths(git, request.message || `Update ${request.objectName}`, [relative]);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('git-get-history', async (event, { dbType, schema, objectType, signature, tableName, objectName, page }) => {
    try {
      page = historyPage(page);
      const safeDbType = canonicalGitDbType(dbType || 'ORACLE');
      const safeSchema = schema || 'PUBLIC';
      const safeObjectType = objectType || 'UNKNOWN_TYPE';
      const safeObjectName = objectName || 'UNKNOWN_OBJECT';


      let relativeFilePath;
      let legacyPath;
      if (safeObjectType === 'ErDiagram') {
        const fileName = safeObjectName.endsWith('.json') ? safeObjectName : `${safeObjectName}.json`;
        relativeFilePath = workspaceRelativePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram', fileName);
      } else {
        const paths = sourcePaths({ dbType: safeDbType, schema: safeSchema, objectType: safeObjectType, objectName: safeObjectName, signature, tableName });
        relativeFilePath = paths.primary;
        legacyPath = paths.legacy;
      }

      if (!isDbSourceLocalRepo(repoBase)) {
        return { success: true, history: [] };
      }

      const git = await createGit();

      let hasRemote = false;
      try {
        hasRemote = (await git.getRemotes()).some(remote => remote.name === 'origin');
      } catch (error) {
        console.error(t("failed_to_fetch_remote_history"), safeGitError(error));
      }
      if (!(await git.raw(['rev-list', '--all', '--max-count=1'])).trim()) {
        return { success: true, history: [], hasMore: false, page };
      }
      return { success: true, ...await readHistoryPage(repoBase, [relativeFilePath, legacyPath], page, hasRemote) };
    } catch (err) {
      console.error('Git History Error:', safeGitError(err));
      return { success: false, error: safeGitError(err), history: [] };
    }
  });

  ipcMain.handle('git-get-file-content', async (event, { dbType, schema, objectType, signature, tableName, objectName, commitId }) => {
    try {
      const safeDbType = canonicalGitDbType(dbType || 'ORACLE');
      const safeSchema = schema || 'PUBLIC';
      const safeObjectType = objectType || 'UNKNOWN_TYPE';
      const safeObjectName = objectName || 'UNKNOWN_OBJECT';


      let relativeFilePath;
      let legacyPath;
      if (safeObjectType === 'ErDiagram') {
        const fileName = safeObjectName.endsWith('.json') ? safeObjectName : `${safeObjectName}.json`;
        relativeFilePath = workspaceRelativePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram', fileName);
      } else {
        const paths = sourcePaths({ dbType: safeDbType, schema: safeSchema, objectType: safeObjectType, objectName: safeObjectName, signature, tableName });
        relativeFilePath = paths.primary;
        legacyPath = paths.legacy;
      }

      if (!isDbSourceLocalRepo(repoBase)) {
        return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      }

      if (!/^[a-fA-F0-9]{7,40}$/.test(commitId)) throw new Error('Invalid Git revision.');
      const content = await readHistoricalSource(repoBase, commitId, [relativeFilePath, legacyPath]);
      if (content !== null) return { success: true, content };
      return { success: false, error: t("not_yet_present_in_history") };
    } catch (err) {
      console.error('Git Show Error:', safeGitError(err));
      if (err.message.includes('exists on disk, but not in')) {
        return { success: true, content: t("not_yet_present_in_history") };
      }
      return { success: false, error: safeGitError(err) };
    }
  });

  handleWrite('git-push', async () => {
    try {
      if (!isDbSourceLocalRepo(repoBase)) return { success: false, error: t("not_initialized") };
      const git = await createGit();
      const branch = await currentBranch(git);
      await assertSafeOrigin(git);
      await git.push(['-u', 'origin', `HEAD:refs/heads/${branch}`]);
      try { await assertSafeOrigin(git);
      await git.fetch(['origin']); } catch(e){}
      return { success: true };
    } catch (err) {
      console.error('Git Push Error:', safeGitError(err));
      return { success: false, error: safeGitError(err) };
    }
  });

  handleWrite('git-pull', async () => {
    let git;
    try {
      if (!isDbSourceLocalRepo(repoBase)) return { success: false, error: t("not_initialized") };
      git = await createGit();
      const branch = await currentBranch(git);
      await assertSafeOrigin(git);
      await git.fetch(['origin']);

      const before = await git.status();
      if (before.files?.some(file => file.index !== '?' || file.working_dir !== '?')) throw new Error(t('git_clean_before_pull'));

      await assertSafeOrigin(git);
      await git.pull(['origin', `refs/heads/${branch}`, '--no-rebase', '--allow-unrelated-histories']);

      return { success: true };
    } catch (err) {
      let isConflict = false;
      let statusUnavailable = false;
      try { isConflict = (await git.status()).conflicted.length > 0; }
      catch { statusUnavailable = true; }
      return {
        success: false,
        isConflict,
        statusUnavailable,
        error: safeGitError(err)
      };
    }
  });

  handleWrite('git-pull-force', async (event, strategy = 'theirs') => {
    try {
      const git = await createGit();
      const branch = await currentBranch(git);

      try {
        await git.merge(['--abort']);
      } catch(e) {}

      try { await assertSafeOrigin(git);
      await git.fetch(['origin']); } catch(e){}

      await assertSafeOrigin(git);
      await git.pull(['origin', `refs/heads/${branch}`, '--no-rebase', '--allow-unrelated-histories', '-X', strategy]);

      return { success: true };
    } catch (err) {
      console.error('Git Pull Force Error:', safeGitError(err));
      return { success: false, error: safeGitError(err) };
    }
  });

  handleWrite('git-merge-abort', async () => {
    try {
      const git = await createGit();
      await git.merge(['--abort']);
      return { success: true };
    } catch (e) {
      return { success: false, error: safeGitError(e) };
    }
  });

  handleWrite('git-push-force', async () => {
    try {
      if (!isDbSourceLocalRepo(repoBase)) return { success: false, error: t("not_initialized") };
      const git = await createGit();

      const branchRef = (await git.raw(['symbolic-ref', '--quiet', 'HEAD'])).trim();
      if (!branchRef.startsWith('refs/heads/')) throw new Error(t('git_force_push_requires_tracking'));
      const branch = branchRef.slice('refs/heads/'.length);
      const trackingRef = `refs/remotes/origin/${branch}`;
      const references = await git.raw(['for-each-ref', '--format=%(refname) %(objectname)', trackingRef]);
      const expected = references.split('\n').find(line => line.startsWith(`${trackingRef} `))?.split(' ')[1];
      if (!expected || !/^[a-f0-9]{40,64}$/.test(expected)) throw new Error(t('git_force_push_requires_tracking'));
      // Pin the last known commit; never fetch here or retry with an unconditional force.
      await assertSafeOrigin(git);
      await git.push(['-u', 'origin', `HEAD:${branchRef}`, `--force-with-lease=${branchRef}:${expected}`]);
      try { await assertSafeOrigin(git);
      await git.fetch(['origin']); } catch(e){}
      return { success: true };
    } catch (err) {
      console.error('Git Push Force Error:', safeGitError(err));
      return { success: false, error: safeGitError(err) };
    }
  });

  handleWrite('git-delete-object', async (event, request) => {
    try {
      const { primary } = sourcePaths(request);
      if (!isDbSourceLocalRepo(repoBase)) return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      const git = await createGit();
      const tracked = await git.raw(['--literal-pathspecs', 'ls-files', '--', primary]);
      if (tracked.trim()) await git.raw(['--literal-pathspecs', 'rm', '--', primary]);
      else {
        const file = workspacePath(repoBase, ...primary.split('/'));
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      await commitPaths(git, `Delete ${request.objectName}`, [primary]);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  handleWrite('git-rename-object', async (event, request) => {
    try {
      const oldPaths = sourcePaths({ ...request, objectName: request.oldName });
      const newPaths = sourcePaths({ ...request, objectName: request.newName });
      if (!isDbSourceLocalRepo(repoBase)) return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      if (oldPaths.primary === newPaths.primary) return { success: true };
      const oldFile = workspacePath(repoBase, ...oldPaths.primary.split('/'));
      const newFile = workspacePath(repoBase, ...newPaths.primary.split('/'));
      const git = await createGit();
      const paths = [oldPaths.primary, newPaths.primary];
      if (fs.existsSync(oldFile)) {
        if (fs.existsSync(newFile)) throw new Error('The destination source already exists.');
        fs.mkdirSync(path.dirname(newFile), { recursive: true });
        await git.raw(['--literal-pathspecs', 'mv', '--', oldPaths.primary, newPaths.primary]);
      } else if (!fs.existsSync(newFile) && oldPaths.legacy) {
        const legacy = workspacePath(repoBase, ...oldPaths.legacy.split('/'));
        if (fs.existsSync(legacy)) {
          fs.mkdirSync(path.dirname(newFile), { recursive: true });
          fs.copyFileSync(legacy, newFile, fs.constants.COPYFILE_EXCL);
          await git.raw(['--literal-pathspecs', 'add', '--', newPaths.primary]);
          paths.splice(0, 1);
        }
      }
      await commitPaths(git, `Rename ${request.oldName} to ${request.newName}`, paths);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

}

module.exports = { registerGitHandlers };
