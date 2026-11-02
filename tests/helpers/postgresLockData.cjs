// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createPostgresLockHarness(invoke, options = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), confirmations = [], timers = new Map(); let timerId = 0;
  const { useLockTab } = loadTypeScript('src/features/postgresql/windows/dba/useLockTab.ts', { react: hook.react, 'react-i18next': { useTranslation: () => ({ t: (key, values) => key + JSON.stringify(values || {}) }) }, '@/shared/api/desktop': { ipcRenderer: { invoke } } }, { window: { confirm: message => { confirmations.push(message); return options.confirm?.(message) ?? true; } }, setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id) });
  let active = true, state;
  const render = () => (state = hook.render(() => useLockTab(active)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) { const deadline = Date.now() + 10000; do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline); throw Error('PostgreSQL lock state timed out: ' + state.error + ' ' + state.errorCode); }
  await flush();
  return { get state() { return state; }, flush, waitFor, confirmations, timers, updateActive: value => { active = value; }, unmount: () => hook.unmount() };
}
function postgresLockFixture(overrides = {}) {
  return { pid: 20, backend_start: '2026-10-26 01:00:00+00', query_start: '2026-10-26 02:00:00+00', xact_start: '2026-10-26 01:55:00+00',
    user_id: '100', username: 'test', session_database_id: '5', session_database: 'demo', database_id: '5', database_name: 'demo', backend_type: 'client backend',
    state: 'active', program: 'fixture', address: '127.0.0.1', locktype: 'transactionid', transaction_id: '9007199254740993', relation_id: null, schema_name: null, object_name: null,
    virtualtransaction: '1/3', mode: 'ShareLock', granted: false, query: 'UPDATE DEMO SET VALUE=1', query_seconds: '9007199254740993.000001', wait_event_type: 'Lock', wait_event: 'transactionid', blockers: [21], target_superuser: false, member: true, ...overrides };
}
module.exports = { createPostgresLockHarness, postgresLockFixture };
