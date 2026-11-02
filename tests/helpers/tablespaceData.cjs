// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createTablespaceHarness(invoke) {
  const hook = createHookHarness({ doubleUpdates: true });
  const { useTablespaceTab } = loadTypeScript('src/features/oracle/windows/dba/useTablespaceTab.ts', { react: hook.react, '@/shared/api/desktop': { ipcRenderer: { invoke } } });
  let active = true, state;
  const render = () => (state = hook.render(() => useTablespaceTab(active)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) { const deadline = Date.now() + 5000; do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 5)); } while (Date.now() < deadline); throw new Error('Tablespace state timed out: ' + state.error + ' ' + state.detailError); }
  await flush();
  return { get state() { return state; }, flush, waitFor, updateActive: value => { active = value; }, unmount: () => hook.unmount() };
}
module.exports = { createTablespaceHarness };
