// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readGitSource, createReadBudget, assertDataSize, GIT_SOURCE_MAX_BYTES, dataError } = require('./dataSafety');
const { readBoundedText } = require('./boundedFiles');
const { redactGitSecrets, formatGitError } = require('./gitSecurity');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { workspacePath } = require('./workspacePaths');
const { atomicWriteFile } = require('./atomicFiles');
const { enqueueGitWrite } = require('./gitWrites');

function registerGitReviewHandlers({ ipcMain, repoBase, sourcePaths, createGit, t }) {
  const register = (channel, operation) => ipcMain.handle(channel, (_event, ...args) =>
    enqueueGitWrite(repoBase, async () => {
      try { return { success: true, ...await operation(await createGit(), ...args) }; }
      catch (error) { return { success: false, error: formatGitError(error, t) }; }
    }));
  const resolve = relative => workspacePath(repoBase, ...relative.split('/'));
  const read = async (relative, consume = createReadBudget()) => {
    const file = resolve(relative);
    if (!fs.existsSync(file)) return null;
    let text;
    try { text = await readBoundedText(file, 16); }
    catch (error) {
      if (error.code === 'file_read_too_large') throw dataError('internal_data_too_large');
      throw error;
    }
    consume(Buffer.byteLength(text));
    if (text.includes('\0')) throw new Error('Binary files cannot be reviewed as SQL text.');
    return text;
  };
  async function head(git) {
    try { return (await git.raw(['rev-parse', '--verify', 'HEAD'])).trim(); }
    catch (error) {
      if ((await git.raw(['rev-list', '--all', '--max-count=1'])).trim()) throw error;
      return null;
    }
  }
  async function atRevision(git, revision, relative, consume) {
    resolve(relative);
    if (!revision) return null;
    const files = await git.raw(['--literal-pathspecs', 'ls-tree', '-z', revision, '--', relative]);
    if (!files) return null;
    const entry = files.split('\0').find(Boolean), match = /^(\d+) blob ([a-f0-9]+)\t/.exec(entry);
    if (!match || !['100644', '100755'].includes(match[1])) throw new Error('Only regular source files can be reviewed.');
    const content = await readGitSource(git, match[2], consume);
    if (content.includes('\0')) throw new Error('Binary files cannot be reviewed as SQL text.');
    return content;
  }
  async function requireNoMerge(git) {
    if ((await git.raw(['ls-files', '-u', '-z'])).length || fs.existsSync(path.join((await git.raw(['rev-parse', '--absolute-git-dir'])).trim(), 'MERGE_HEAD'))) {
      throw new Error('Resolve or abort the current merge before recording DB sources.');
    }
  }
  register('git-review-sources', async (git, sources) => {
    await requireNoMerge(git);
    const revision = await head(git), rows = [], names = new Set(), consume = createReadBudget();
    for (const source of sources) {
      if (typeof source.sourceText !== 'string' || !source.sourceText.trim()) throw new Error('Source definition is empty.');
      assertDataSize(Buffer.byteLength(source.sourceText), GIT_SOURCE_MAX_BYTES);
      consume(Buffer.byteLength(source.sourceText));
      const paths = sourcePaths(source), relative = paths.primary;
      if (names.has(relative)) throw new Error('Duplicate source identity.');
      names.add(relative);
      let headPath = relative, headSource = await atRevision(git, revision, relative, consume);
      if (headSource === null && paths.legacy) {
        const legacySource = await atRevision(git, revision, paths.legacy, consume);
        if (legacySource !== null) { headPath = paths.legacy; headSource = legacySource; }
      }
      rows.push({ ...source, path: relative, headPath, headSource, localSource: await read(relative, consume) });
    }
    return { head: revision, rows };
  });
  register('git-commit-sources', async (git, { head: expected, rows, message }) => {
    if (!Array.isArray(rows) || !rows.length || typeof message !== 'string' || !message.trim()) throw new Error('Select sources and enter a commit message.');
    await requireNoMerge(git);
    if (await head(git) !== expected) throw new Error('Git HEAD changed. Refresh the source review.');
    const paths = new Set(), consume = createReadBudget();
    for (const row of rows) {
      const relative = sourcePaths(row).primary;
      if (paths.has(relative) || relative !== row.path || typeof row.sourceText !== 'string' || !row.sourceText.trim()) throw new Error('Invalid or duplicate source selection.');
      assertDataSize(Buffer.byteLength(row.sourceText), GIT_SOURCE_MAX_BYTES);
      consume(Buffer.byteLength(row.sourceText));
      paths.add(relative);
      const allowed = sourcePaths(row), headPath = row.headPath || relative;
      if (headPath !== relative && headPath !== allowed.legacy) throw new Error('Invalid historical source path.');
      const local = await read(relative, consume), committed = await atRevision(git, expected, headPath, consume);
      if (local !== row.localSource || committed !== row.headSource) throw new Error('Source files changed. Refresh the source review.');
      if (local !== null && local !== committed && local !== row.sourceText) throw new Error('Local source edits must be reviewed separately before replacement.');
      const staged = await git.raw(['--literal-pathspecs', 'diff', '--cached', '--name-only', '-z', '--', relative]);
      if (staged) throw new Error('A selected source already has staged changes. Finish those changes first.');
    }
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-git-index-'));
    let commitId;
    try {
      const isolated = await createGit({ GIT_INDEX_FILE: path.join(temporary, 'index') });
      await isolated.raw(expected ? ['read-tree', expected] : ['read-tree', '--empty']);
      for (const row of rows) {
        const file = resolve(row.path); fs.mkdirSync(path.dirname(file), { recursive: true }); atomicWriteFile(file, row.sourceText);
      }
      await isolated.raw(['--literal-pathspecs', 'add', '--', ...paths]);
      if (!(await isolated.raw(['diff', '--cached', '--name-only', '-z']))) return { committed: false };
      if (await head(git) !== expected) throw new Error('Git HEAD changed before commit.');
      await isolated.raw(['commit', '-m', message.trim()]);
      const updated = await head(git);
      if (!updated || updated === expected) throw new Error('Git did not create a commit. Check commit hooks and repository settings.');
      commitId = updated;
      // Update only the selected index entries, leaving unrelated staging unchanged.
      await git.raw(['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...paths]);
      return { committed: true, commitId };
    } catch (error) {
      if (commitId) return { success: false, committed: true, commitId, error: redactGitSecrets(error.message) };
      // Restore only our own writes; never replace a file changed by another process.
      for (const row of rows) {
        if (await read(row.path) !== row.sourceText) continue;
        if (row.localSource === null) fs.unlinkSync(resolve(row.path));
        else atomicWriteFile(resolve(row.path), row.localSource);
      }
      throw error;
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
  async function mergeState(git) {
    const directory = (await git.raw(['rev-parse', '--absolute-git-dir'])).trim();
    const file = path.join(directory, 'MERGE_HEAD');
    if (!fs.existsSync(file)) throw new Error('No merge is in progress.');
    return fs.readFileSync(file, 'utf8');
  }
  async function conflicts(git) {
    const merge = await mergeState(git);
    const entries = await git.raw(['ls-files', '-u', '-z']);
    const groups = new Map(), consume = createReadBudget();
    for (const entry of entries.split('\0').filter(Boolean)) {
      const match = /^(\d+) ([a-f0-9]+) ([123])\t([\s\S]+)$/.exec(entry);
      if (!match) throw new Error('Invalid conflict metadata.');
      const [, mode, hash, stage, file] = match; resolve(file);
      if (!['100644', '100755'].includes(mode)) throw new Error('Only regular text conflicts can be edited in MonaBase.');
      const group = groups.get(file) || { path: file, base: null, ours: null, theirs: null, entries: [] };
      const text = await readGitSource(git, hash, consume);
      if (text.includes('\0')) throw new Error('Binary conflicts must be resolved with an external Git tool.');
      group[stage === '1' ? 'base' : stage === '2' ? 'ours' : 'theirs'] = text;
      group.entries.push(entry); groups.set(file, group);
    }
    const files = [];
    // Read sequentially so many conflicts cannot allocate all working files at once.
    for (const group of groups.values()) {
      const working = await read(group.path, consume);
      files.push({ path: group.path, base: group.base, ours: group.ours, theirs: group.theirs, working,
        token: createHash('sha256').update(JSON.stringify([merge, group.entries, working])).digest('hex') });
    }
    return files;
  }
  const mergeToken = async git => createHash('sha256').update(JSON.stringify([await head(git), await mergeState(git), await git.raw(['ls-files', '--stage', '-z'])])).digest('hex');
  register('git-get-conflicts', async git => ({ files: await conflicts(git), token: await mergeToken(git) }));
  register('git-resolve-conflict', async (git, { path: relative, token, choice, content }) => {
    const file = (await conflicts(git)).find(file => file.path === relative);
    if (!file || file.token !== token) throw new Error('The conflict changed. Reload it before resolving.');
    if (!['ours', 'theirs', 'manual'].includes(choice)) throw new Error('Invalid conflict resolution.');
    const text = choice === 'manual' ? content : file[choice];
    if (text !== null && typeof text !== 'string') throw new Error('Invalid merged source.');
    if (text !== null) assertDataSize(Buffer.byteLength(text), GIT_SOURCE_MAX_BYTES);
    if (text !== null) {
      const attributes = await git.raw(['check-attr', '-z', 'conflict-marker-size', '--', relative]);
      const configured = attributes.split('\0')[2];
      const markerSize = /^[1-9]\d*$/.test(configured) ? Number(configured) : 7;
      // Honor Git's marker size and diff3 base markers, without allocating attribute-sized strings.
      for (const match of text.matchAll(/^(<+|\|+|=+|>+)(?:[ \t][^\r\n]*)?\r?$/gm)) {
        const marker = match[1];
        if ((marker.length === markerSize || marker.length >= 7) &&
            (marker[0] !== '=' || match[0].slice(marker.length).trim() === '')) {
          throw new Error('Remove all conflict markers before marking the file resolved.');
        }
      }
    }
    if (text === null) { if (fs.existsSync(resolve(relative))) fs.unlinkSync(resolve(relative)); }
    else { fs.mkdirSync(path.dirname(resolve(relative)), { recursive: true }); atomicWriteFile(resolve(relative), text); }
    await git.raw(['--literal-pathspecs', 'add', '-A', '--', relative]);
    return { files: await conflicts(git), token: await mergeToken(git) };
  });
  register('git-complete-merge', async (git, { message, token }) => {
    await mergeState(git);
    if (await mergeToken(git) !== token) throw new Error('The merge index changed. Review it again before committing.');
    if ((await git.raw(['ls-files', '-u', '-z'])).length) throw new Error('Resolve every conflict before completing the merge.');
    if (typeof message !== 'string' || !message.trim()) throw new Error('Enter a merge commit message.');
    const previous = await head(git);
    await git.raw(['commit', '-m', message.trim()]);
    const current = await head(git);
    if (!current || current === previous || fs.existsSync(path.join((await git.raw(['rev-parse', '--absolute-git-dir'])).trim(), 'MERGE_HEAD'))) throw new Error('The merge commit was not created. Check commit hooks.');
    return { commitId: current };
  });
}
module.exports = { registerGitReviewHandlers };
