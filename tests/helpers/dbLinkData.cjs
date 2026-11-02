// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createDbLinkHarness(invoke, props = {}, options = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), events = [], copies = [], confirmations = [];
  const { useDbLinkWindow } = loadTypeScript('src/features/oracle/windows/dblink/useDbLinkWindow.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: (key, values) => key + (values?.target ? ': ' + values.target : '') }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, {
    navigator: { clipboard: { writeText: async text => { if (options.failCopy) throw new Error('Clipboard denied'); copies.push(text); } } },
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event), confirm: text => { confirmations.push(text); return options.confirm?.(text) ?? true; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  });
  let current = { tabId: 7, schema: 'TEST', dbLinkName: 'DEMO.EXAMPLE', isNew: false, isActive: true, allSchemas: ['TEST'], ...props }, state;
  const render = () => (state = hook.render(() => useDbLinkWindow(current)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Database link state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, flush, waitFor, update: next => { current = { ...current, ...next }; }, events, copies, confirmations, unmount: () => hook.unmount() };
}
module.exports = { createDbLinkHarness };
