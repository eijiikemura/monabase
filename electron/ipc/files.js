// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { inspectSqlPrivacy } = require('../services/sqlPrivacy');
const { readBoundedText, normalizeFileLimits } = require('../services/boundedFiles');
const { getCurrentSettings } = require('../services/settings');
const { createFilePermissions } = require('../services/filePermissions');
const { atomicWriteFile } = require('../services/atomicFiles');
const iconv = require('iconv-lite');
const { randomUUID } = require('node:crypto');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('../services/jsonFiles');

function registerFileHandlers({ getValidatedSettings = getCurrentSettings, ipcMain, clipboard, dialog, getWindow, HISTORY_FILE, t }) {
  const permissions = createFilePermissions();
  ipcMain.handle('open-sql-file', async () => {
    try {
      const selected = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: 'SQL (UTF-8)', extensions: ['sql'] }] });
      if (selected.canceled || !selected.filePaths?.[0]) return { success: true, canceled: true };
      const filePath = selected.filePaths[0];
      return { success: true, canceled: false, filePath, sql: (await readBoundedText(filePath, normalizeFileLimits(getValidatedSettings()).sqlFileMaxMb)).replace(/^\uFEFF/, '') };
    } catch (error) { return { success: false, error: ['file_read_not_regular', 'file_read_too_large'].includes(error.code) ? t(error.code, { limit: error.limitMiB }) : error.message }; }
  });


  ipcMain.handle('copy-to-clipboard', async (event, text) => { clipboard.writeText(text); return true; });

  const readHistory = () => {
    try {
      return readJsonFile(HISTORY_FILE, value => Array.isArray(value) && value.every(entry =>
        isJsonObject(entry) && typeof entry.id === 'string' && typeof entry.sql === 'string'));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      if (error.code === 'INVALID_JSON_SETTINGS') {
        throw Object.assign(new Error(t('sql_history_corrupt')), { code: error.code });
      }
      throw error;
    }
  };

  const visibleHistory = history => history.filter(entry => !inspectSqlPrivacy(entry.sql).sensitive);
  ipcMain.handle('inspect-sql-privacy', (_event, statements, dialect) => {
    if (!Array.isArray(statements) || !['oracle', 'postgresql'].includes(dialect)) throw new Error('Invalid SQL privacy request.');
    return statements.map(sql => inspectSqlPrivacy(sql, dialect));
  });
  ipcMain.handle('get-sql-history', () => visibleHistory(readHistory()));

  ipcMain.handle('add-sql-history', (event, newHistory) => {
    let history = readHistory();
    if (!isJsonObject(newHistory) || typeof newHistory.sql !== 'string') throw new Error('Invalid SQL history entry.');

    const settings = getValidatedSettings();
    if (settings.sqlHistoryEnabled === false || inspectSqlPrivacy(newHistory.sql).sensitive) return visibleHistory(history);

    history.unshift({
      ...newHistory,
      id: randomUUID()
    });

    const limit = settings.sqlHistoryLimit;

    if (history.length > limit) {
      history = history.slice(0, limit);
    }

    atomicWriteJson(HISTORY_FILE, history);
    return visibleHistory(history);
  });

  ipcMain.handle('clear-sql-history', () => {
    // Explicit clearing may replace corrupt history only after a recovery copy exists.
    try { readHistory(); } catch (error) { if (error.code !== 'INVALID_JSON_SETTINGS') throw error; }
    atomicWriteJson(HISTORY_FILE, []);
    return [];
  });

  ipcMain.handle('show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(getWindow(), options);
    if (!result.canceled && result.filePath) return { ...result, writeToken: permissions.issue(event, result.filePath) };
    return result;
  });

  ipcMain.handle('show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(getWindow(), options);
    return result;
  });

  // Folder selection dialog handler.
  ipcMain.handle('show-open-folder-dialog', async (event, title) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: title || t("select_folder"),
      properties: ['openDirectory']
    });
    return result;
  });

  ipcMain.handle('save-file', async (event, filePath, data, encodingOrType, writeToken) => {
    try {
      const destination = permissions.authorize(event, writeToken, filePath);
      if (encodingOrType === 'binary') {
        atomicWriteFile(destination, Buffer.from(data));
      } else if (encodingOrType === 'sjis') {
        if (typeof data !== 'string') throw new TypeError('Text file data must be a string.');
        const sjisBuffer = iconv.encode(data, 'Shift_JIS');
        // Check before opening the destination: replacements and mappings can alter characters.
        if (iconv.decode(sjisBuffer, 'Shift_JIS') !== data) {
          return { success: false, error: t('shift_jis_cannot_preserve_text_use_utf8') };
        }
        atomicWriteFile(destination, sjisBuffer);
      } else {
        atomicWriteFile(destination, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.code === 'FILE_PERMISSION_REQUIRED' ? t('security_file_reselect') : error.message };
    }
  });
}

module.exports = { registerFileHandlers };
