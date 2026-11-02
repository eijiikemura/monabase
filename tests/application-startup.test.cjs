// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');

async function launch(packaged, options = {}) {
  let created;
  const startupEvents = [];
  const handlers = new Map();
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      startupEvents.push({ name: 'window' });
      this.options = options;
      this.loaded = [];
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.session = Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, setDevicePermissionHandler() {} });
      this.devToolsToggleCount = 0;
      this.webContents.toggleDevTools = () => { this.devToolsToggleCount += 1; };
      this.webContents.setWindowOpenHandler = handler => { this.newWindow = handler; };
      created = this;
    }
    loadFile(file) { this.loaded.push(['file', file]); Object.assign(this.webContents.mainFrame, { url: require('node:url').pathToFileURL(file).href, origin: 'file://' }); return Promise.resolve(); }
    loadURL(url) { this.loaded.push(['url', url]); Object.assign(this.webContents.mainFrame, { url: new URL(url).href, origin: new URL(url).origin }); return Promise.resolve(); }
    isDestroyed() { return false; }
  }
  const app = Object.assign(new EventEmitter(), {
    isPackaged: packaged, isReady: () => false, getPath: () => '/test-data',
    dock: { setIcon: file => startupEvents.push({ name: 'dock', file }) },
    disableHardwareAcceleration() {}, whenReady: () => Promise.resolve()
  });
  const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  vm.runInNewContext(source, {
    __dirname: path.resolve(__dirname, '../electron'),
    process: { platform: options.platform || 'linux', cwd: () => '/test-workspace' },
    console, setTimeout,
    require(name) {
      if (name === 'electron') return {
        app, BrowserWindow, ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, safeStorage: {},
        Menu: { setApplicationMenu() {} }
      };
      if (name === 'fs') return { existsSync: () => false };
      if (name === './services/connections' && options.connectionStore) return { createConnectionStore: () => options.connectionStore };
      if (name === './i18n' && options.language) return {
        t: (key, values) => require('../electron/i18n').translate(key, options.language, values), setLanguage() {}
      };
      if (name === './services/storagePaths') return {
        getStoragePaths: () => require('../electron/services/storagePaths').createStoragePaths(app, { cwd: '/test-workspace', env: {} }),
        prepareStorage() { startupEvents.push({ name: 'storage' }); }
      };
      if (name === './services/settings') return { createSettingsStore: () => ({ load: () => { startupEvents.push({ name: 'settings' }); return {}; } }) };
      if (name === './focusDiagnostics') return { startFocusDiagnostics() {} };
      if (/^\.\/ipc\/(ai|git|er|files|database)$/.test(name)) {
        return Object.fromEntries(['Ai', 'Git', 'Er', 'File', 'Database'].map(group => [`register${group}Handlers`, () => {}]));
      }
      if (name.startsWith('./')) return require(path.join(__dirname, '../electron', name));
      return require(name);
    }
  });
  await Promise.resolve();
  created.invoke = (channel, ...args) => handlers.get(channel)({ sender: created.webContents, senderFrame: created.webContents.mainFrame }, ...args);
  created.startupEvents = startupEvents;
  return created;
}

for (const language of ['en', 'ja']) {
  test(`${language}: a conflicting connection rename returns a specific IPC error without changing saved connections`, async t => {
    const os = require('node:os');
    const { createConnectionStore } = require('../electron/services/connections');
    const { createCredentialVault } = require('../electron/services/credentials');
    const { translate } = require('../electron/i18n');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-connection-ipc-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'connections.json');
    const store = createConnectionStore(file, createCredentialVault({ isEncryptionAvailable: () => false }));
    store.save({ name: 'A', host: 'fixture-a.invalid' }); store.save({ name: 'B', host: 'fixture-b.invalid' });
    const before = fs.readFileSync(file);
    const window = await launch(true, { connectionStore: store, language });
    const result = window.invoke('save-connection', { name: 'B', host: 'fixture-a.invalid' }, 'A');
    assert.equal(result.success, false);
    assert.equal(result.error, translate('connection_name_already_exists', language));
    assert.deepEqual(fs.readFileSync(file), before);
  });
}

test('Packaged startup loads only bundled files with isolated sandboxed renderers', async () => {
  const window = await launch(true);
  assert.equal(window.loaded.length, 1);
  assert.equal(window.loaded[0][0], 'url');
  assert.equal(new URL(window.loaded[0][1]).protocol, 'file:');
  assert.ok(window.loaded[0][1].endsWith('/dist/index.html'));
  assert.equal(window.options.webPreferences.nodeIntegration, false);
  assert.equal(window.options.webPreferences.contextIsolation, true);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.equal(window.options.webPreferences.preload, path.join(__dirname, '../electron/preload.js'));
  assert.equal(window.newWindow().action, 'deny');
  let blocked = false;
  window.webContents.emit('will-navigate', { preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
});

test('Development startup loads the local Vite server without probing other servers', async () => {
  const window = await launch(false);
  assert.deepEqual(window.loaded, [['url', 'http://localhost:5173/']]);
});

test('Developer tools shortcuts work in both packaged and development builds', async () => {
  for (const packaged of [true, false]) {
    const window = await launch(packaged);
    let prevented = 0;
    const event = { preventDefault() { prevented += 1; } };
    for (const input of [
      { key: 'F12' },
      { key: 'I', control: true, shift: true },
      { key: 'i', meta: true, alt: true }
    ]) {
      window.webContents.emit('before-input-event', event, { type: 'keyDown', ...input });
    }
    assert.equal(window.devToolsToggleCount, 3);
    assert.equal(prevented, 3);

    window.webContents.emit('before-input-event', event, { type: 'keyUp', key: 'F12' });
    window.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'i' });
    assert.equal(window.devToolsToggleCount, 3);
    assert.equal(prevented, 3);
  }
});

for (const language of ['en', 'ja']) {
  test(`${language}: new connection name conflicts use the localized IPC response`, async t => {
    const os = require('node:os');
    const { createConnectionStore } = require('../electron/services/connections');
    const { createCredentialVault } = require('../electron/services/credentials');
    const { translate } = require('../electron/i18n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-new-connection-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'connections.json');
    const store = createConnectionStore(file, createCredentialVault({ isEncryptionAvailable: () => false }));
    store.save({ name: 'Existing', host: 'original.invalid' });
    const before = fs.readFileSync(file);
    const window = await launch(true, { connectionStore: store, language });
    const result = window.invoke('save-connection', { name: 'Existing', host: 'replacement.invalid' }, '');
    assert.equal(result.success, false);
    assert.equal(result.error, translate('connection_name_already_exists', language));
    assert.deepEqual(fs.readFileSync(file), before);
  });

  test(`${language}: connection deletion exceptions become localized failure responses`, async () => {
    const { translate } = require('../electron/i18n');
    const window = await launch(true, { language, connectionStore: { remove() { throw new Error('Simulated private storage error'); } } });
    const result = window.invoke('delete-connection', 'Existing');
    assert.equal(result.success, false);
    assert.equal(result.error, translate('failed_to_delete_connection', language));
    assert.equal(result.error.includes('private'), false);
  });
}

for (const language of ['en', 'ja']) {
  test(`${language}: credential save and destination failures return safe actionable connection errors`, async () => {
    const { translate } = require('../electron/i18n');
    for (const [code, key] of [['CREDENTIAL_SAVE_FAILED', 'credentials_save_failed'], ['CREDENTIAL_CONTEXT_CHANGED', 'credentials_context_changed']]) {
      const window = await launch(true, { language, connectionStore: { save() { throw Object.assign(new Error('DUMMY_PRIVATE_PROVIDER_MESSAGE'), { code }); } } });
      const result = window.invoke('save-connection', { name: 'Existing' }, 'Existing');
      assert.equal(result.success, false); assert.equal(result.error, translate(key, language));
      assert.ok(!result.error.includes('DUMMY_PRIVATE_PROVIDER_MESSAGE'));
    }
  });
}

for (const packaged of [false, true]) {
  test(`${packaged ? 'Packaged' : 'Development'} macOS startup sets the Dock logo before storage, settings and window initialization`, async () => {
    const window = await launch(packaged, { platform: 'darwin' });
    assert.deepEqual(window.startupEvents.map(event => event.name), ['dock', 'storage', 'settings', 'window']);
    assert.equal(window.startupEvents[0].file, window.options.icon);
    assert.equal(window.options.icon, path.resolve(__dirname, '../src/assets/icon.png'));
  });
}
