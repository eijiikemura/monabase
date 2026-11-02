// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function fixture(info, options = {}) {
  const hook = createHookHarness(), alerts = [];
  const react = { ...hook.react, lazy: () => 'Workspace', Suspense: 'Suspense', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const i18n = { language: 'en', changeLanguage() {} };
  const App = loadTypeScript('src/App.tsx', {
    './features/ai/AiHistoryConnectionContext': { AiHistoryConnectionContext: { Provider: 'HistoryScopeProvider' } },
    react, 'react-i18next': { useTranslation: () => ({ t: key => key, i18n }) },
    '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@/components/feedback/NotificationHost': 'NotificationHost', './components/LoginScreen': 'Login', './components/SettingsDialog': 'Settings', './components/feedback/ScreenErrorBoundary': 'Boundary',
    './shared/utils/dateFormatter': { DEFAULT_DATETIME_FORMAT: 'YYYY-MM-DD HH:mm:ss', DEFAULT_DATE_FORMAT: 'YYYY-MM-DD' },
    './app/themes': { monaTheme: 'mona', darkTheme: 'dark', simpleTheme: 'simple' },
    './shared/api/desktop': { ipcRenderer: { invoke: async channel => {
      if (channel === 'load-settings') return { language: 'en' };
      if (channel === 'disconnect-db') return options.disconnect ? options.disconnect() : true;
      if (channel === 'get-db-info') return info();
      throw new Error('Unexpected IPC: ' + channel);
    } } }
  }, { React: react, alert: message => alerts.push(message), window: { addEventListener() {}, removeEventListener() {}, confirm: () => true } }).default;
  let tree;
  function walk(value) { return !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)]; }
  const get = type => walk(tree).find(node => node.type === type);
  const render = () => { tree = hook.render(() => App()); hook.commit(); };
  render();
  return { hook, render, get, alerts, login: (name, type = 'oracle') => get('Login').props.onLoginSuccess({ user: name, dbType: type }, []) };
}

for (const outcome of ['success', 'failure response', 'rejection']) {
  test(`Late DB information ${outcome} from a prior connection cannot overwrite the new session`, async () => {
    const old = deferred(); let calls = 0;
    const h = fixture(() => ++calls === 1 ? old.promise : { success: true, info: 'Database B' });
    const first = h.login('A'); h.render();
    await h.get('Workspace').props.onDisconnect(); h.render();
    await h.login('B', 'postgresql'); h.render();
    assert.equal(h.get('Workspace').props.dbInfo, 'Database B');
    if (outcome === 'rejection') old.reject(new Error('Simulated old IPC failure'));
    else old.resolve(outcome === 'success' ? { success: true, info: 'Database A' } : { success: false, error: 'Simulated failure' });
    await first; h.render();
    assert.equal(h.get('Workspace').props.dbInfo, 'Database B');
    assert.equal(h.get('Workspace').props.config.user, 'B');
  });
}

for (const outcome of ['failure response', 'rejection']) {
  test(`Current DB information ${outcome} shows a fallback while retaining the connected workspace`, async () => {
    const h = fixture(() => {
      if (outcome === 'rejection') throw new Error('Simulated IPC failure');
      return { success: false, error: 'Simulated lookup failure' };
    });
    await h.login('A'); h.render();
    assert.equal(h.get('Workspace').props.dbInfo, 'failed_to_fetch_version_information');
    assert.equal(h.get('Workspace').props.config.user, 'A');
  });
}

test('Disconnect invalidates pending DB information before returning to login', async () => {
  const pending = deferred(), h = fixture(() => pending.promise);
  const first = h.login('A'); h.render();
  await h.get('Workspace').props.onDisconnect(); h.render();
  pending.resolve({ success: true, info: 'Database A' }); await first; h.render();
  assert.ok(h.get('Login')); assert.equal(h.get('Workspace'), undefined);
});

test('Unmount invalidates pending DB information and absorbs later IPC rejection', async () => {
  const pending = deferred(), h = fixture(() => pending.promise);
  const first = h.login('A'); h.render(); h.hook.unmount();
  pending.reject(new Error('Simulated late IPC failure')); await first;
});

for (const failure of ['rejection', 'unconfirmed']) {
  test(`Disconnect ${failure} notifies the user and retires the connected workspace`, async () => {
    const h = fixture(() => ({ success: true, info: 'Database A' }), { disconnect() {
      if (failure === 'rejection') throw new Error('Simulated private cleanup failure');
      return false;
    } });
    await h.login('A'); h.render();
    await h.get('Workspace').props.onDisconnect(); h.render();
    assert.ok(h.get('Login')); assert.equal(h.get('Workspace'), undefined);
    assert.deepEqual(h.alerts, ['disconnect_cleanup_failed_retry']);
  });
}

test('Repeated disconnect clicks send only one request and release the guard for later sessions', async () => {
  const closing = deferred(); let attempts = 0;
  const h = fixture(() => ({ success: true, info: 'Database' }), { disconnect() {
    attempts++; return attempts === 1 ? closing.promise : true;
  } });
  await h.login('A'); h.render(); const disconnect = h.get('Workspace').props.onDisconnect;
  const first = disconnect(); await disconnect(); assert.equal(attempts, 1);
  closing.reject(new Error('Simulated delayed cleanup failure')); await first; h.render();
  assert.ok(h.get('Login')); assert.deepEqual(h.alerts, ['disconnect_cleanup_failed_retry']);
  await h.login('B'); h.render(); await h.get('Workspace').props.onDisconnect(); h.render();
  assert.equal(attempts, 2); assert.ok(h.get('Login'));
});
