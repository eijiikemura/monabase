// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createPostgresPrivilegeHarness(invoke) {
  const hook = createHookHarness({ doubleUpdates: true });
  const { useObjectPrivilegeTab } = loadTypeScript('src/features/postgresql/windows/dba/useObjectPrivilegeTab.ts', { react: hook.react, '@/shared/api/desktop': { ipcRenderer: { invoke } } });
  let active = true, state;
  const render = () => (state = hook.render(() => useObjectPrivilegeTab(active)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) { const deadline = Date.now() + 10000; do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline); throw Error('PostgreSQL privilege state timed out: ' + state.error + ' ' + state.errorCode); }
  await flush();
  return { get state() { return state; }, flush, waitFor, updateActive: value => { active = value; }, unmount: () => hook.unmount() };
}
module.exports = { createPostgresPrivilegeHarness };
