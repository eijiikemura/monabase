// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { pathToFileURL } = require('node:url');

function createSenderCheckedIpc(ipcMain, getWindow, isTrustedFrame = () => false) {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, (event, ...args) => {
        const window = getWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame || !isTrustedFrame(event.senderFrame)) {
          throw new Error('Untrusted IPC sender.');
        }
        return handler(event, ...args);
      });
    }
  };
}

function validateExternalUrl(value) {
  if (typeof value !== 'string') throw new Error('Invalid external URL.');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported external URL.');
  }
  return url.href;
}

function restrictBrowserPermissions(session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.on('will-download', event => event.preventDefault());
}


function createAppPagePolicy({ packaged, entryFile, developmentUrl = 'http://localhost:5173' }) {
  const expected = new URL(packaged ? pathToFileURL(entryFile).href : developmentUrl);
  const isTrustedUrl = value => {
    try {
      if (typeof value !== 'string') return false;
      const url = new URL(value);
      // Fragments stay within the same application document; query/path changes do not.
      url.hash = '';
      return !url.username && !url.password && url.href === expected.href;
    } catch { return false; }
  };
  return {
    entryUrl: expected.href,
    isTrustedUrl,
    isTrustedFrame(frame) {
      try {
        if (!frame || !isTrustedUrl(frame.url)) return false;
        // Chromium serializes the opaque/local file origin differently from HTTP origins.
        return packaged ? ['file://', 'null'].includes(frame.origin) : frame.origin === expected.origin;
      } catch { return false; }
    }
  };
}

function restrictAppNavigation(contents, policy) {
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-redirect', (event, url) => {
    if (!policy.isTrustedUrl(event.url ?? url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
module.exports = { createSenderCheckedIpc, validateExternalUrl, restrictBrowserPermissions, createAppPagePolicy, restrictAppNavigation };
