// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { createSenderCheckedIpc, validateExternalUrl, createAppPagePolicy, restrictAppNavigation } = require('../electron/ipc/security');

function preload() {
  const calls = [], handlers = new Map();
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld(name, exposed) { assert.equal(name, 'monaBase'); api = exposed; } },
        ipcRenderer: {
          invoke: async (...args) => { calls.push(args); return 'ok'; },
          on: (channel, listener) => handlers.set(channel, listener),
          removeListener(channel, listener) { assert.equal(handlers.get(channel), listener); handlers.delete(channel); }
        }
      };
    }
  });
  return { api, calls, handlers };
}

test('Preload allows supported requests and blocks arbitrary channels', async () => {
  const { api, calls } = preload();
  assert.equal(await api.invoke('execute-sql', 'SELECT 1'), 'ok');
  assert.deepEqual(calls[0], ['execute-sql', 'SELECT 1']);
  await assert.rejects(api.invoke('arbitrary-command'), /Unsupported/);
  assert.equal(calls.length, 1);
});

test('Event callbacks receive payloads without privileged Electron event objects', () => {
  const { api, handlers } = preload();
  const messages = [];
  const listener = (...args) => messages.push(args);
  const unsubscribe = api.on('ai-response-chunk', listener);
  handlers.get('ai-response-chunk')({ sender: 'privileged' }, { text: 'hello' });
  assert.deepEqual(messages, [[undefined, { text: 'hello' }]]);
  unsubscribe();
  unsubscribe();
  assert.equal(handlers.size, 0);
  assert.throws(() => api.on('unknown-event', listener), /Unsupported/);
});

test('Main handlers reject other windows, subframes, and destroyed windows', () => {
  const handlers = new Map();
  const webContents = { mainFrame: { url: 'http://localhost:5173/', origin: 'http://localhost:5173' } };
  let destroyed = false;
  const window = { webContents, isDestroyed: () => destroyed };
  const ipc = createSenderCheckedIpc({ handle: (name, handler) => handlers.set(name, handler) }, () => window, createAppPagePolicy({ packaged: false }).isTrustedFrame);
  ipc.handle('test', (_event, value) => value);
  const invoke = handlers.get('test');
  assert.equal(invoke({ sender: webContents, senderFrame: webContents.mainFrame }, 42), 42);
  assert.throws(() => invoke({ sender: {}, senderFrame: webContents.mainFrame }), /Untrusted/);
  assert.throws(() => invoke({ sender: webContents, senderFrame: {} }), /Untrusted/);
  destroyed = true;
  assert.throws(() => invoke({ sender: webContents, senderFrame: webContents.mainFrame }), /Untrusted/);
});

test('External links accept web URLs and reject local, executable, and credential-bearing URLs', () => {
  assert.equal(validateExternalUrl('https://example.com'), 'https://example.com/');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:test@example.com', 'https://user:password@example.com']) {
    assert.throws(() => validateExternalUrl(url));
  }
});

test('The preload allowlist covers the registered application channels', () => {
  const text = fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8');
  const modules = ['main.js', ...fs.readdirSync(path.join(__dirname, '../electron/ipc')).map(file => `ipc/${file}`)];
  for (const file of modules) {
    const code = fs.readFileSync(path.join(__dirname, '../electron', file), 'utf8');
    for (const match of code.matchAll(/ipcMain\.handle\('([^']+)'/g)) {
      assert.ok(text.includes(JSON.stringify(match[1])), `Missing preload channel ${match[1]}`);
    }
  }
});

test('Application-page trust checks exact documents and origins rather than just a window identity', () => {
  const { pathToFileURL } = require('node:url');
  const entryFile = path.join(__dirname, '../dist/index.html');
  const packaged = createAppPagePolicy({ packaged: true, entryFile });
  const file = pathToFileURL(entryFile).href;
  assert.equal(packaged.isTrustedFrame({ url: file, origin: 'file://' }), true);
  assert.equal(packaged.isTrustedFrame({ url: file + '#same-document', origin: 'null' }), true);
  for (const frame of [null, {}, { url: file, origin: 'https://example.invalid' },
    { url: file + '?other', origin: 'file://' }, { url: file.replace('index.html', 'other.html'), origin: 'file://' },
    { url: 'file:///etc/passwd', origin: 'file://' }, { url: 'about:blank', origin: 'file://' },
    { url: 'blob:https://example.invalid/id', origin: 'https://example.invalid' },
    { get url() { throw new Error('Frame was destroyed'); } }]) assert.equal(packaged.isTrustedFrame(frame), false);
  const dev = createAppPagePolicy({ packaged: false });
  assert.equal(dev.isTrustedFrame({ url: 'http://localhost:5173/#app', origin: 'http://localhost:5173' }), true);
  for (const url of ['http://localhost:5174/', 'http://localhost.evil:5173/', 'http://user:password@localhost:5173/',
    'http://localhost:5173/other', 'https://localhost:5173/', 'data:text/html,untrusted', 'about:blank']) {
    assert.equal(dev.isTrustedUrl(url), false);
  }
  assert.equal(dev.isTrustedFrame({ url: 'http://localhost:5173/', origin: 'null' }), false);
  const handlers = new Map(), frame = { url: file, origin: 'file://' }, webContents = { mainFrame: frame };
  const window = { webContents, isDestroyed: () => false };
  createSenderCheckedIpc({ handle: (name, fn) => handlers.set(name, fn) }, () => window, packaged.isTrustedFrame)
    .handle('probe', () => 'allowed');
  const invoke = () => handlers.get('probe')({ sender: webContents, senderFrame: frame });
  assert.equal(invoke(), 'allowed'); frame.url = 'https://example.invalid/'; frame.origin = 'https://example.invalid';
  assert.throws(invoke, /Untrusted/);
  createSenderCheckedIpc({ handle: (name, fn) => handlers.set(name, fn) }, () => window).handle('unconfigured', () => 'unsafe');
  assert.throws(() => handlers.get('unconfigured')({ sender: webContents, senderFrame: frame }), /Untrusted/);
});

test('Navigation policy refuses external redirects using both current and legacy event details', () => {
  const { EventEmitter } = require('node:events');
  const contents = new EventEmitter(); contents.setWindowOpenHandler = handler => { contents.open = handler; };
  const policy = createAppPagePolicy({ packaged: false }); restrictAppNavigation(contents, policy);
  let denied = 0;
  const event = () => ({ preventDefault: () => { denied++; } });
  contents.emit('will-redirect', { ...event(), url: 'https://example.invalid/' });
  contents.emit('will-redirect', event(), 'https://example.invalid/');
  assert.equal(denied, 2);
  contents.emit('will-redirect', { ...event(), url: 'http://localhost:5173/' }); assert.equal(denied, 2);
  contents.emit('will-navigate', event()); assert.equal(denied, 3); assert.equal(contents.open().action, 'deny');
});
