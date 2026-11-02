// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createLockHarness(invoke, options = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), confirmations = [], timers = new Map();
  let id = 0;
  const { useLockTab } = loadTypeScript('src/features/oracle/windows/dba/useLockTab.ts', {
    react: hook.react,
    'react-i18next': { useTranslation: () => ({ t: (key, values) => key + (values ? JSON.stringify(values) : '') }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, {
    window: { confirm: message => { confirmations.push(message); return options.confirm?.(message) ?? true; } },
    setInterval: callback => { timers.set(++id, callback); return id; }, clearInterval: key => timers.delete(key)
  });
  let active = true, state;
  const render = () => (state = hook.render(() => useLockTab(active)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Lock state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, flush, waitFor, confirmations, timers, updateActive: value => { active = value; }, unmount: () => hook.unmount() };
}
function lockFixture(overrides = {}) {
  return { SID: 20, SERIAL: 40, INSTANCE_ID: 1, CON_ID: 3, USERNAME: 'TEST', PROGRAM: 'fixture', MACHINE: 'fixture', OSUSER: 'fixture',
    STATUS: 'INACTIVE', SESSION_TYPE: 'USER', LOGON_TIME: '2026-10-26 01:02:03', TYPE: 'TX', ID1: 1, ID2: 2,
    HELD_MODE: 6, REQUEST_MODE: 0, BLOCK: 1, WAITERS: 1, HOLD_SECONDS: 5, WAIT_SECONDS: null,
    BLOCKING_SID: null, BLOCKING_INSTANCE: null, ORACLE_MAINTAINED: 'N', SQL_ID: null, SQL_TEXT: null,
    PREV_SQL_ID: 'sql_fixture', PREV_SQL_TEXT: 'UPDATE demo SET value = 1', OBJECT_OWNER: null, OBJECT_NAME: null, ...overrides };
}
module.exports = { createLockHarness, lockFixture };
