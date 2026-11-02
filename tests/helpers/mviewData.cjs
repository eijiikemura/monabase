// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
function mviewModules(invoke) {
  const deps = { '@/shared/api/desktop': { ipcRenderer: { invoke } } };
  return { model: loadTypeScript('src/features/materialized-view/mviewSql.ts', deps), metadata: loadTypeScript('src/features/materialized-view/mviewMetadata.ts', deps) };
}
async function createMviewHarness(database, invoke, props = {}, { confirm = () => true } = {}) {
  let listener = () => {};
  const hook = createHookHarness({ doubleUpdates: true }), alerts = [], events = [];
  const { useMviewWindow } = loadTypeScript('src/features/materialized-view/useMviewWindow.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) }, '@/shared/api/desktop': { ipcRenderer: { invoke }, subscribeTransactionState: callback => { listener = callback; return () => {}; } }
  }, { alert: text => alerts.push(text), window: { confirm, dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  let currentProps = { schema: 'TEST', mviewName: 'DemoMv', tabId: 1, isNew: false, isActive: true, allSchemas: ['TEST'], ...props }, state;
  const render = () => (state = hook.render(() => useMviewWindow(database, currentProps)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Materialized view state did not reach the expected condition.');
  }
  await flush();
  return { transactionChanged: pending => listener(pending), get state() { return state; }, render, flush, waitFor, update: next => { currentProps = { ...currentProps, ...next }; }, alerts, events, unmount: () => hook.unmount() };
}
module.exports = { mviewModules, createMviewHarness };
