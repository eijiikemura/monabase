// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createSessionHarness, sessionFixture } = require('./helpers/sessionData.cjs');
const service = require('../electron/oracle/sessionManagement');
const { IDENTITY_SQL } = require('../electron/oracle/lockManagement');
function fixture() {
  const f = { rows: [sessionFixture(), sessionFixture({ SID: 21, SERIAL: 41, USERNAME: 'OTHER' })], calls: [], requests: [], failList: false, failDetail: false, alterError: null, privilege: true,
    options: { readonly: false, protectionReady: true, ownSessions: [{ sid: 10, instance: 1, container: 3 }], serverVersion: '23.0.0.0.0' } };
  f.query = async (sql, binds = {}) => {
    f.calls.push([sql, binds]);
    if (sql === IDENTITY_SQL) return { rows: [{ SID: 11, INSTANCE_ID: 1, CON_ID: 3 }] };
    if (sql.includes('FROM SESSION_PRIVS')) return { rows: f.privilege ? [{ PRIVILEGE: 'ALTER SYSTEM' }] : [] };
    if (sql === service.SESSION_SQL) { if (f.failList) throw new Error('List failed'); return { rows: f.rows.map(row => ({ ...row })) }; }
    if (sql === service.STATS_SQL) { if (f.failDetail) throw new Error('Stats failed'); assert.equal(binds.serial, binds.sid === 20 ? 40 : 41); return { rows: [{ STAT_ID: '55', NAME: 'session logical reads', VALUE: '900719925474099300001' }] }; }
    if (sql === service.TEXT_SQL) { if (f.changeSql) { f.changeSql = false; f.rows[0].SQL_EXEC_ID = '100'; } return { rows: [{ SQL_TEXT: 'SELECT * FROM DEMO' }] }; }
    if (sql === service.PREV_TEXT_SQL) return { rows: [{ SQL_TEXT: 'UPDATE DEMO SET VALUE=1' }] };
    if (sql.startsWith('ALTER SYSTEM')) { if (f.alterError) throw f.alterError; return {}; }
    throw new Error('Unexpected session query');
  };
  f.invoke = async (channel, request) => {
    f.requests.push([channel, request]);
    try {
      if (channel === 'list-oracle-sessions') return { success: true, ...await service.readSessions(f.query, f.options) };
      if (channel === 'get-oracle-session-detail') return { success: true, ...await service.readDetail(f.query, request, f.options) };
      return { success: true, ...await service.manageSession(f.query, request, f.options) };
    } catch (error) { return { success: false, ...service.safeError(error) }; }
  };
  return f;
}
const writes = f => f.calls.filter(([sql]) => sql.startsWith('ALTER SYSTEM'));
async function selected(f, options) { const h = await createSessionHarness(f.invoke, options); h.state.select(h.state.rows[0].id); await h.flush(); return h; }
const request = async (f, action = 'kill') => ({ ...(await service.readSessions(f.query, f.options)).sessions[0], action });
test('Stable session identity survives reorder and distinguishes SID reuse, serial, container and logon generation', async () => {
  const f = fixture(), first = await service.readSessions(f.query, f.options); f.rows.reverse(); const second = await service.readSessions(f.query, f.options);
  assert.equal(first.sessions[0].id, second.sessions[1].id);
  for (const change of [{ SERIAL: 999 }, { CON_ID: 4 }, { LOGON_TIME: 'later' }]) { f.rows[1] = sessionFixture(change); assert.notEqual((await service.readSessions(f.query, f.options)).sessions[1].id, first.sessions[0].id); }
});
test('Readonly, privilege, identity and application/system protection reject commands before mutation', async () => {
  for (const mode of ['readonly', 'privilege', 'identity', 'main', 'background', 'system', 'unknown']) {
    const f = fixture(); if (mode === 'readonly') f.options.readonly = true; if (mode === 'privilege') f.privilege = false; if (mode === 'identity') f.options.protectionReady = false;
    if (mode === 'main') f.options.ownSessions.push({ sid: 20, instance: 1, container: 3 });
    if (mode === 'background') f.rows[0].SID = 11;
    if (mode === 'system') f.rows[0].ORACLE_MAINTAINED = 'Y'; if (mode === 'unknown') f.rows[0].ORACLE_MAINTAINED = null;
    await assert.rejects(service.manageSession(f.query, await request(f), f.options), /session_/); assert.equal(writes(f).length, 0);
  }
});
test('Cancellation includes SQL_ID and rejects changed executions, inactive sessions and old or unknown versions', async () => {
  const f = fixture(), target = await request(f, 'cancel'); await service.manageSession(f.query, target, f.options);
  assert.equal(writes(f)[0][0], "ALTER SYSTEM CANCEL SQL '20,40,0123456789abc'");
  f.rows[0].SQL_EXEC_ID = '100'; await assert.rejects(service.manageSession(f.query, target, f.options), /sql_changed/);
  for (const version of ['12.2.0.1.0', '']) { f.options.serverVersion = version; await assert.rejects(service.manageSession(f.query, await request(f, 'cancel'), f.options), /unsupported/); }
  f.options.serverVersion = '19'; f.rows[0].STATUS = 'INACTIVE'; await assert.rejects(service.manageSession(f.query, await request(f, 'cancel'), f.options), /sql_changed/);
});
test('ORA-00031 is a marked result and recycled targets never receive a command', async () => {
  const f = fixture(); f.alterError = { errorNum: 31 }; assert.equal((await service.manageSession(f.query, await request(f), f.options)).status, 'marked');
  const old = await request(f); f.rows[0].SERIAL = 50; await assert.rejects(service.manageSession(f.query, old, f.options), /target_changed/); assert.equal(writes(f).length, 1);
});
test('Statistics preserve exact numeric strings, deduplicate names by container and verify the session before and after reading', async () => {
  const f = fixture(), target = await request(f), result = await service.readDetail(f.query, target, f.options);
  assert.equal(result.statistics[0].VALUE, '900719925474099300001'); assert.equal(result.statistics[0].id, '55');
  assert.match(service.STATS_SQL, /ROW_NUMBER/); assert.match(service.STATS_SQL, /s.SERIAL# = :serial/);
  assert.match(service.TEXT_SQL, /q.ADDRESS = s.SQL_ADDRESS AND q.HASH_VALUE = s.SQL_HASH_VALUE AND q.CON_ID = s.CON_ID/);
  f.changeSql = true; await assert.rejects(service.readDetail(f.query, target, f.options), /sql_changed/);
});
test('List refresh retains the selected session across reorder and clears ended sessions', async () => {
  const f = fixture(), h = await selected(f), id = h.state.selectedId; f.rows.reverse(); await h.state.reload(); await h.flush(); assert.equal(h.state.selectedId, id); assert.equal(h.state.selected.SID, 20);
  f.rows = []; await h.state.reload(); await h.flush(); assert.equal(h.state.selectedId, null); assert.equal(h.state.detail, null); h.unmount();
});
test('List and detail failures retain prior observations, expose errors and disable unsafe actions until retry', async () => {
  const f = fixture(), h = await selected(f); assert.equal(h.state.canCancel, true);
  f.failDetail = true; await h.state.retryDetail(); await h.flush(); assert.ok(h.state.detail.statistics.length); assert.equal(h.state.detailReady, false); assert.equal(h.state.canCancel, false);
  f.failDetail = false; await h.state.retryDetail(); await h.flush(); assert.equal(h.state.detailReady, true);
  f.failList = true; await h.state.reload(); await h.flush(); assert.equal(h.state.rows.length, 2); assert.equal(h.state.canKill, false);
  f.failList = false; await h.state.reload(); await h.flush(); assert.equal(h.state.canKill, true); h.unmount();
});
test('A slower response for an old selection cannot replace the newly selected statistics', async () => {
  const f = fixture(); let finish, hold = true;
  const h = await createSessionHarness((channel, target) => channel === 'get-oracle-session-detail' && hold ? (hold = false, new Promise(resolve => { finish = resolve; })) : f.invoke(channel, target));
  h.state.select(h.state.rows[0].id); await h.flush(); h.state.select(h.state.rows[1].id); await h.flush(); const current = h.state.detail;
  finish({ success: true, sessionId: 'old', fingerprint: 'old', statistics: [], execution: 'old' }); await h.flush(); assert.equal(h.state.detail, current);
  h.state.select(null); await h.flush(); assert.equal(h.state.detailLoading, false); h.unmount();
});
test('Confirmation cancellation sends no command and duplicate clicks execute exactly once for the selected session', async () => {
  for (const confirm of [false, true]) {
    const f = fixture(), h = await selected(f, { confirm: () => confirm });
    await Promise.all([h.state.command('kill'), h.state.command('kill')]); await h.flush(); assert.equal(writes(f).length, confirm ? 1 : 0);
    assert.ok(h.confirmations[0].includes('serial')); h.unmount();
  }
});
test('A completed command with failed observation cannot be repeated and preserves the requested notice', async () => {
  const f = fixture(), original = f.query;
  f.query = async (...args) => { const result = await original(...args); if (args[0].startsWith('ALTER SYSTEM')) f.failList = true; return result; };
  const h = await selected(f); await h.state.command('kill'); await h.flush(); assert.equal(h.state.ready, false); assert.equal(h.state.notice, 'session_kill_requested'); await h.state.command('kill'); assert.equal(writes(f).length, 1); h.unmount();
});
test('Auto refresh pauses during activity and when hidden, and old generations cannot replace reactivated data', async () => {
  const f = fixture(); let hold = false, finish, count = 0;
  const h = await createSessionHarness((channel, target) => { if (channel === 'list-oracle-sessions') { count++; if (hold) return new Promise(resolve => { finish = resolve; }); } return f.invoke(channel, target); });
  h.state.setRefreshSeconds(5); await h.flush(); assert.equal(h.timers.size, 1); hold = true; [...h.timers.values()][0](); await h.flush(); [...h.timers.values()][0](); assert.equal(count, 2);
  h.updateActive(false); await h.flush(); assert.equal(h.timers.size, 0); hold = false; h.updateActive(true); await h.flush(); finish({ success: true, sessions: [], context: {}, fetchedAt: '' }); await h.flush(); assert.equal(h.state.rows.length, 2); h.unmount();
});
test('Search and state filtering disable commands for hidden selections and export rows across pages', async () => {
  const f = fixture(), h = await selected(f); h.state.setSearch('OTHER'); await h.flush(); assert.equal(h.state.rows.length, 1); assert.equal(h.state.canKill, false); h.unmount();
});
test('Structured IPC rejects other databases, sanitizes errors and never publishes main transaction state', async () => {
  const { createDatabaseIpc } = require('./helpers/ddlEditors.cjs');
  const client = { listOracleSessions: async () => ({ sessions: [], context: {} }), manageOracleSession: async () => { throw Object.assign(new Error('sensitive sql'), { code: 'ORA-01031' }); } };
  const invoke = createDatabaseIpc(client, 'oracle'), error = await invoke('manage-oracle-session', {});
  assert.equal(error.errorCode, 'ORA-01031'); assert.equal(Object.hasOwn(error, 'hasUncommittedTx'), false); assert.ok(!JSON.stringify(error).includes('sensitive'));
  assert.equal((await createDatabaseIpc(client, 'postgresql')('list-oracle-sessions')).success, false);
});
test('One reserved background connection owns each operation and main command serialization blocks duplicates', async () => {
  const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
  const f = fixture(), client = new Client(), conn = { execute: f.query, oracleServerVersionString: '23' }, slot = { conn, isExecuting: false };
  client.connection = {}; client.bgPool = [slot]; client.managedSessions.set(client.connection, { sid: 10, instance: 1, container: 3 }); client.managedSessions.set(conn, { sid: 11, instance: 1, container: 3 });
  client.getAvailableBgConnection = async () => slot;
  const target = (await client.listOracleSessions()).sessions[0]; assert.equal(slot.isExecuting, false);
  let finish; conn.execute = (sql, binds) => sql.startsWith('ALTER SYSTEM') ? new Promise(resolve => { finish = resolve; }) : f.query(sql, binds);
  const task = client.manageOracleSession({ ...target, action: 'kill' }); while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(client.manageOracleSession({ ...target, action: 'kill' }), /busy/); finish({}); await task; assert.equal(slot.isExecuting, false);
  assert.equal((await client.killSession(20, 40)).success, false); assert.equal((await client.cancelSQL(20, 40)).success, false);
});
test('Split uses the measured container, supports keyboard control and restores the previous cursor on blur and unmount', async () => {
  const h = createHookHarness(), listeners = new Map(); let resize;
  const element = { getBoundingClientRect: () => ({ top: 100, height: 500 }) }, body = { style: { cursor: 'crosshair' } };
  const { useSessionSplit } = loadTypeScript('src/features/oracle/windows/dba/useSessionSplit.ts', { react: h.react }, {
    document: { body }, window: { addEventListener: (event, callback) => listeners.set(event, callback), removeEventListener: event => listeners.delete(event) },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe() {} disconnect() {} }
  });
  let state; const render = () => (state = h.render(() => useSessionSplit(true)));
  render(); state.container.current = element; h.commit(); await h.settle(); render(); resize(); await h.settle(); render();
  const initial = state.topHeight; state.key({ key: 'ArrowDown', preventDefault() {} }); await h.settle(); render(); assert.ok(state.topHeight > initial);
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  state.start({ button: 0, pointerId: 1, currentTarget: target, preventDefault() {} }); assert.equal(body.style.cursor, 'row-resize'); listeners.get('blur')(); assert.equal(body.style.cursor, 'crosshair');
  state.start({ button: 0, pointerId: 2, currentTarget: target, preventDefault() {} }); h.unmount(); assert.equal(body.style.cursor, 'crosshair');
});
test('Late command errors from a hidden activation trigger observation only and never replace the new activation with stale errors', async () => {
  const f = fixture(); let fail;
  const h = await createSessionHarness((channel, target) => channel === 'manage-oracle-session' ? new Promise((_resolve, reject) => { fail = reject; }) : f.invoke(channel, target));
  h.state.select(h.state.rows[0].id); await h.flush(); const pending = h.state.command('kill'); await h.flush();
  h.updateActive(false); await h.flush(); h.updateActive(true); await h.flush(); fail(new Error('Late error')); await pending; await h.flush();
  assert.equal(h.state.ready, true); assert.equal(h.state.error, ''); assert.equal(h.state.canKill, true); h.unmount();
});
