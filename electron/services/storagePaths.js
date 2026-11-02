// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');

function createStoragePaths(app, { cwd = process.cwd(), env = process.env } = {}) {
  const userData = app.getPath('userData');
  const portableDirectory = app.isPackaged && env.PORTABLE_EXECUTABLE_DIR;
  const baseDirectory = app.isPackaged ? portableDirectory || userData : cwd;
  return Object.freeze({
    mode: app.isPackaged ? portableDirectory ? 'portable' : 'installed' : 'development',
    baseDirectory,
    legacyDirectory: app.isPackaged ? path.dirname(app.getPath('exe')) : cwd,
    settingsFile: path.join(baseDirectory, 'settings.json'),
    gitDirectory: path.join(baseDirectory, 'git'),
    aiDirectory: path.join(baseDirectory, 'ai'),
    traceDirectory: path.join(baseDirectory, 'trace'),
    connectionsFile: path.join(userData, 'connections.json'),
    historyFile: path.join(userData, 'sql_history.json'),
    aiSettingsFile: path.join(userData, 'ai-settings.json')
  });
}

let activePaths;

function getStoragePaths() {
  if (!activePaths) activePaths = createStoragePaths(require('electron').app);
  return activePaths;
}

// Migrate whole entries atomically; never merge repositories or replace destination data.
function prepareStorage(paths, legacyTraceDirectory = path.join(__dirname, '..', '..', 'trace')) {
  fs.mkdirSync(paths.baseDirectory, { recursive: true });
  if (paths.mode === 'development') return;
  const copyMissing = (source, destination) => {
    if (path.resolve(source) === path.resolve(destination) || !fs.existsSync(source) || fs.existsSync(destination)) return;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (!fs.statSync(source).isDirectory()) {
      try { fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      return;
    }
    const temporary = fs.mkdtempSync(path.join(path.dirname(destination), '.monabase-migration-'));
    try {
      const staged = path.join(temporary, 'data');
      fs.cpSync(source, staged, { recursive: true });
      if (!fs.existsSync(destination)) fs.renameSync(staged, destination);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  };
  for (const name of ['settings.json', 'ai', 'git']) {
    copyMissing(path.join(paths.legacyDirectory, name), path.join(paths.baseDirectory, name));
  }
  for (const database of ['oracle', 'postgres']) {
    copyMissing(path.join(legacyTraceDirectory, database), path.join(paths.traceDirectory, database));
    copyMissing(path.join(paths.legacyDirectory, 'trace', database), path.join(paths.traceDirectory, database));
  }
}

module.exports = { createStoragePaths, getStoragePaths, prepareStorage };
