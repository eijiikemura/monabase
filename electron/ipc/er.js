// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readHistoryPage, historyPage } = require('../services/gitHistory');
const { readGitSource } = require('../services/dataSafety');
const { createGitClient } = require('../services/gitClient');
const { readBoundedText, normalizeFileLimits } = require('../services/boundedFiles');
const { getCurrentSettings } = require('../services/settings');
const { formatGitError } = require('../services/gitSecurity');
const fs = require('node:fs');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { enqueueGitWrite, commitPaths } = require('../services/gitWrites');
const { workspacePath, workspaceRelativePath } = require('../services/workspacePaths');
const { atomicWriteFile } = require('../services/atomicFiles');

function registerErHandlers({ getValidatedSettings = getCurrentSettings, ipcMain, gitDirectory: repoBase, t, createGit = overrides => createGitClient(repoBase, overrides, simpleGit) }) {
  const handleWrite = (channel, handler) => ipcMain.handle(channel, (...args) => enqueueGitWrite(repoBase, () => handler(...args)));
  const isDbSourceLocalRepo = repoBase => fs.existsSync(path.join(repoBase, '.git'));

  handleWrite('git-commit-er', async (event, { dbType, objectName, sourceText, message }) => {
    try {
      const safeDbType = dbType || 'ORACLE';
      const safeObjectName = objectName.endsWith('.json') ? objectName : `${objectName}.json`;
      const safeMessage = message || `ER図 ${safeObjectName} を更新`;

      const targetDir = workspacePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram');
      const filePath = workspacePath(targetDir, safeObjectName);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      atomicWriteFile(filePath, sourceText || '');

      if (!isDbSourceLocalRepo(repoBase)) {
        return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      }

      const git = await createGit();
      const relativePath = workspaceRelativePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram', safeObjectName);
      await git.raw(['--literal-pathspecs', 'add', '--', relativePath]);
      await commitPaths(git, safeMessage, [relativePath]);

      return { success: true };
    } catch (err) {
      console.error('Git Commit ER Error:', formatGitError(err, t));
      return { success: false, error: formatGitError(err, t) };
    }
  });

  ipcMain.handle('git-get-history-er', async (event, { dbType, objectName, page }) => {
    try {
      page = historyPage(page);
      const safeDbType = dbType || 'ORACLE';
      const safeObjectName = objectName.endsWith('.json') ? objectName : `${objectName}.json`;
      const relativeFilePath = workspaceRelativePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram', safeObjectName);
      if (!isDbSourceLocalRepo(repoBase)) return { success: true, history: [] };

      const git = await createGit();
      let hasRemote = false;
      try {
        hasRemote = (await git.getRemotes()).some(remote => remote.name === 'origin');
      } catch (error) {
        console.error(t("failed_to_fetch_remote_history"), formatGitError(error, t));
      }
      // An initialized repository without commits has an empty history.
      if (!(await git.raw(['rev-list', '--all', '--max-count=1'])).trim()) {
        return { success: true, history: [], hasMore: false, page };
      }
      return { success: true, ...await readHistoryPage(repoBase, [relativeFilePath], page, hasRemote, false) };
    } catch (err) {
      console.error('Git History ER Error:', formatGitError(err, t));
      return { success: false, error: formatGitError(err, t), history: [] };
    }
  });

  ipcMain.handle('git-get-file-content-er', async (event, { dbType, objectName, commitId }) => {
    try {
      const safeDbType = dbType || 'ORACLE';
      const safeObjectName = objectName.endsWith('.json') ? objectName : `${objectName}.json`;

      const relativeFilePath = workspaceRelativePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram', safeObjectName);

      if (!isDbSourceLocalRepo(repoBase)) {
        return { success: false, error: t("the_local_repository_has_not_been_initialized") };
      }

      const git = await createGit();
      if (!/^[a-fA-F0-9]{7,64}$/.test(commitId)) throw new Error('Invalid Git revision.');
      const content = await readGitSource(git, `${commitId}:./${relativeFilePath}`, undefined, normalizeFileLimits(getValidatedSettings()).erFileMaxMb * 1024 * 1024);

      return { success: true, content };
    } catch (err) {
      console.error('Git Show ER Error:', formatGitError(err, t));
      if (err.message.includes('exists on disk, but not in')) {
        return { success: true, content: t("not_yet_present_in_history") };
      }
      return { success: false, error: formatGitError(err, t) };
    }
  });

  ipcMain.handle('get-er-diagrams', async (event, dbType) => {
    try {
      const safeDbType = dbType || 'ORACLE';
      const targetDir = workspacePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram');
      if (!fs.existsSync(targetDir)) return { success: true, files: [] };
      const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.json'));
      return { success: true, files };
    } catch (e) {
      return { success: false, error: formatGitError(e, t) };
    }
  });

  ipcMain.handle('load-er-diagram', async (event, { dbType, objectName }) => {
    try {
      const safeDbType = dbType || 'ORACLE';
      const targetDir = workspacePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram');
      const filePath = workspacePath(targetDir, objectName);
      if (fs.existsSync(filePath)) {
        const data = await readBoundedText(filePath, normalizeFileLimits(getValidatedSettings()).erFileMaxMb);
        return { success: true, data };
      }
      return { success: false, error: 'File not found' };
    } catch (e) {
      return { success: false, error: ['file_read_not_regular', 'file_read_too_large'].includes(e.code) ? t(e.code, { limit: e.limitMiB }) : formatGitError(e, t) };
    }
  });

  handleWrite('save-er-diagram', async (event, { dbType, objectName, sourceText }) => {
    try {
      const safeDbType = dbType || 'ORACLE';
      const targetDir = workspacePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram');
      const safeObjectName = objectName.endsWith('.json') ? objectName : `${objectName}.json`;
      const filePath = workspacePath(targetDir, safeObjectName);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      atomicWriteFile(filePath, sourceText);
      return { success: true, filePath };
    } catch (e) {
      return { success: false, error: formatGitError(e, t) };
    }
  });

  handleWrite('delete-er-diagram', async (event, { dbType, objectName }) => {
    try {
      const safeDbType = dbType || 'ORACLE';
      const targetDir = workspacePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram');
      const safeObjectName = objectName.endsWith('.json') ? objectName : `${objectName}.json`;
      const filePath = workspacePath(targetDir, safeObjectName);

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      if (isDbSourceLocalRepo(repoBase)) {
        const git = await createGit();
        const relativePath = workspaceRelativePath(repoBase, 'MonaBase', safeDbType, 'ErDiagram', safeObjectName);
        const tracked = await git.raw(['--literal-pathspecs', 'ls-files', '--', relativePath]);
        if (tracked.trim()) await git.raw(['--literal-pathspecs', 'add', '-u', '--', relativePath]);
        // A previous failed commit may have already staged this deletion.
        await commitPaths(git, t("delete_er_diagram", { value0: safeObjectName }), [relativePath]);
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: formatGitError(e, t) };
    }
  });
}

module.exports = { registerErHandlers };
