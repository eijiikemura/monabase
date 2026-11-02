// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createAppPagePolicy, createSenderCheckedIpc, restrictAppNavigation } = require('../../electron/ipc/security');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ipc-origin-'));
app.setPath('userData', path.join(root, 'profile'));
app.disableHardwareAcceleration();
// Keep Electron alive while replacing the fixture window between trust policies.
app.on('window-all-closed', () => {});
const timeout = setTimeout(() => { console.error('IPC origin UI test timed out.'); app.exit(1); }, 30000);
let window, policy;
const servers = [];
async function server(handler) {
  const service = http.createServer(handler);
  servers.push(service);
  await new Promise((resolve, reject) => { service.once('error', reject); service.listen(0, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${service.address().port}`;
}
const invoke = () => window.webContents.executeJavaScript("window.monaBase.invoke('get-app-version')");
function createWindow() {
  window = new BrowserWindow({ show: false, webPreferences: {
    partition: 'ipc-security-fixture', preload: path.resolve(__dirname, '../../electron/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false
  } });
  restrictAppNavigation(window.webContents, policy);
}

(async () => {
  try {
    await app.whenReady();
    const file = path.join(root, 'index #日本語%.html'), other = path.join(root, 'other.html');
    fs.writeFileSync(file, '<!doctype html><title>Trusted fixture</title>');
    fs.writeFileSync(other, '<!doctype html><title>Untrusted fixture</title>');
    let requests = 0, operations = 0;
    const foreign = await server((_request, response) => { requests++; response.end('<!doctype html><title>Foreign fixture</title>'); });
    const local = await server((request, response) => {
      if (request.url === '/redirect') { response.writeHead(302, { Location: foreign + '/' }); response.end(); }
      else response.end('<!doctype html><title>Development fixture</title>');
    });
    createSenderCheckedIpc(ipcMain, () => window, frame => policy.isTrustedFrame(frame)).handle('get-app-version', () => {
      operations++; return 'fixture-version';
    });
    policy = createAppPagePolicy({ packaged: true, entryFile: file }); createWindow();
    await window.loadURL(policy.entryUrl); assert.equal(policy.isTrustedFrame(window.webContents.mainFrame), true, JSON.stringify({ url: window.webContents.mainFrame.url, origin: window.webContents.mainFrame.origin, file })); assert.equal(await invoke(), 'fixture-version'); assert.equal(operations, 1);
    const fileOrigin = window.webContents.mainFrame.origin;
    // Main-process loadURL deliberately simulates a wrong document in the same window.
    await window.loadURL(foreign + '/'); await assert.rejects(invoke(), /Untrusted IPC sender/); assert.equal(operations, 1);
    await window.loadFile(other); await assert.rejects(invoke(), /Untrusted IPC sender/); assert.equal(operations, 1);
    await window.loadURL(policy.entryUrl); assert.equal(await invoke(), 'fixture-version');
    const beforeRedirect = requests;
    let redirects = 0; window.webContents.on('will-redirect', () => { redirects++; });
    await assert.rejects(window.loadURL(local + '/redirect'), /ERR_(ABORTED|FAILED)/);
    assert.equal(redirects, 1);
    assert.equal(requests, beforeRedirect, 'The redirected destination must not be requested.');
    window.destroy();
    policy = createAppPagePolicy({ packaged: false, developmentUrl: local }); createWindow();
    await window.loadURL(local); assert.equal(await invoke(), 'fixture-version');
    await window.loadURL(local + '/other'); await assert.rejects(invoke(), /Untrusted IPC sender/);
    console.log(`IPC security: bundled file origin ${fileOrigin}, development origin, wrong-page refusals and redirected-request blocking passed.`);
  } finally {
    clearTimeout(timeout);
    if (window && !window.isDestroyed()) window.destroy();
    ipcMain.removeHandler('get-app-version');
    for (const service of servers) {
      service.closeAllConnections();
      await new Promise(resolve => service.close(resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
})().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
