// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createDirectoryHarness(invoke, options = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), confirmations = [];
  const { useDirectoryTab } = loadTypeScript('src/features/oracle/windows/dba/useDirectoryTab.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: (key, values) => key + (values ? ': ' + JSON.stringify(values) : '') }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { window: { confirm: message => { confirmations.push(message); return options.confirm?.(message) ?? true; } } });
  let active = true, state;
  const render = () => (state = hook.render(() => useDirectoryTab(active)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Directory state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, flush, waitFor, confirmations, updateActive: value => { active = value; }, unmount: () => hook.unmount() };
}
module.exports = { createDirectoryHarness };
