// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
function logModules(invoke) {
  return loadTypeScript('src/features/oracle/mviewLogDefinition.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
}
async function createMviewLogHarness(invoke, props = {}, options = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), events = [], copied = [];
  const { useMaterializedViewLogWindow } = loadTypeScript('src/features/oracle/windows/mview-log/useMaterializedViewLogWindow.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@codemirror/lang-sql': { sql: () => ({}) }, '../common/plsqlDialect': { plsqlDialect: {} },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, {
    navigator: { clipboard: { writeText: async text => { if (options.failCopy) throw new Error('Copy denied'); copied.push(text); } } },
    window: { confirm: options.confirm || (() => true), dispatchEvent: event => events.push(event), addEventListener() {}, removeEventListener() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  });
  let current = { schema: 'TEST', tableName: 'MASTER', tabId: 1, isNew: false, isActive: true, allSchemas: ['TEST'], ...props }, state;
  const render = () => (state = hook.render(() => useMaterializedViewLogWindow(current)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Materialized view log state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, flush, waitFor, events, copied, update: next => { current = { ...current, ...next }; }, unmount: () => hook.unmount() };
}
module.exports = { logModules, createMviewLogHarness };
