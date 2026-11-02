// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createSessionHarness(invoke, options = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), confirmations = [], timers = new Map(); let timerId = 0;
  const { useSessionTab } = loadTypeScript('src/features/oracle/windows/dba/useSessionTab.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: (key, values) => key + JSON.stringify(values || {}) }) }, '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { window: { confirm: message => { confirmations.push(message); return options.confirm?.(message) ?? true; } }, setInterval: callback => { timers.set(++timerId, callback); return timerId; }, clearInterval: id => timers.delete(id) });
  let active = true, state;
  const render = () => (state = hook.render(() => useSessionTab(active)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Session state did not reach the expected condition: ' + state.error + ' ' + state.detailError + ' ' + state.errorCode + ' ' + state.detailErrorCode);
  }
  await flush();
  return { get state() { return state; }, flush, waitFor, confirmations, timers, updateActive: value => { active = value; }, unmount: () => hook.unmount() };
}
function sessionFixture(overrides = {}) {
  return { SID: 20, SERIAL: 40, CON_ID: 3, INSTANCE_ID: 1, USERNAME: 'TEST', SESSION_TYPE: 'USER', ORACLE_MAINTAINED: 'N',
    STATUS: 'ACTIVE', OSUSER: 'fixture', MACHINE: 'fixture', PROGRAM: 'fixture', LOGON_TIME: '2026-10-26 01:00:00',
    SQL_ID: '0123456789abc', SQL_EXEC_START: '2026-10-26 02:00:00', SQL_EXEC_ID: '99', PREV_SQL_ID: null,
    EVENT: 'enq: TX - row lock contention', STATE: 'WAITING', WAIT_CLASS: 'Application', WAIT_SECONDS: 1.5, BLOCKING_SID: 25, BLOCKING_INSTANCE: 1, ...overrides };
}
module.exports = { createSessionHarness, sessionFixture };
