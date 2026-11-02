// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readLocks, terminateLockSession, safeLockError, IDENTITY_SQL, LOCK_SQL } = require('../electron/oracle/lockManagement');
const { createLockHarness, lockFixture } = require('./helpers/lockData.cjs');
function catalog() {
  const f = { rows: [lockFixture()], privileges: true, calls: [], killError: null };
  f.query = async sql => {
    f.calls.push(sql);
    if (sql === IDENTITY_SQL) return { rows: [{ SID: 10, INSTANCE_ID: 1, CON_ID: 3 }] };
    if (sql.includes('FROM SESSION_PRIVS')) return { rows: f.privileges ? [{ PRIVILEGE: 'ALTER SYSTEM' }] : [] };
    if (sql === LOCK_SQL) return { rows: f.rows };
    if (sql.startsWith('ALTER SYSTEM')) { if (f.killError) throw f.killError; return {}; }
    throw new Error('Unexpected query');
  };
  f.options = { readonly: false, protectionReady: true, ownSessions: [{ sid: 11, instance: 1, container: 3 }] };
  return f;
}
async function snapshot(f) { return { success: true, ...await readLocks(f.query, f.options) }; }

test('Lock identities include session generation, container and resource and remain stable across reorder', async () => {
  const f = catalog(); f.rows.push(lockFixture({ TYPE: 'TM', ID1: 9 }));
  const a = await snapshot(f); f.rows.reverse(); const b = await snapshot(f);
  assert.equal(new Set(a.locks.map(r => r.id)).size, 2);
  assert.equal(a.locks[0].id, b.locks[1].id); assert.equal(a.locks[0].fingerprint, b.locks[1].fingerprint);
  f.rows[1].LOGON_TIME = '2026-10-26 02:03:04';
  assert.notEqual((await snapshot(f)).locks[1].fingerprint, a.locks[0].fingerprint);
});

test('Lock SQL binds sessions and cursors to their container, separates held/wait time and avoids TX object guesses', () => {
  assert.match(LOCK_SQL, /s\.CON_ID = l\.CON_ID/);
  assert.match(LOCK_SQL, /sq\.ADDRESS = s\.SQL_ADDRESS AND sq\.HASH_VALUE = s\.SQL_HASH_VALUE AND sq\.CON_ID = s\.CON_ID/);
  assert.match(LOCK_SQL, /WHEN l.TYPE = 'TM' THEN l.ID1/);
  assert.match(LOCK_SQL, /ROW_WAIT_OBJ#/); assert.doesNotMatch(LOCK_SQL, /V\$LOCKED_OBJECT/);
  assert.match(LOCK_SQL, /l.CTIME AS HOLD_SECONDS/); assert.match(LOCK_SQL, /s.STATE = 'WAITING' THEN ROUND/);
});

test('Readonly, missing privileges, unknown own identities and managed/system sessions cannot be terminated', async () => {
  for (const mode of ['readonly', 'privilege', 'identity', 'main', 'background', 'system', 'unknown-user']) {
    const f = catalog();
    if (mode === 'readonly') f.options.readonly = true;
    if (mode === 'privilege') f.privileges = false;
    if (mode === 'identity') f.options.protectionReady = false;
    if (mode === 'main') f.rows[0].SID = 11;
    if (mode === 'background') f.rows[0].SID = 10;
    if (mode === 'system') f.rows[0].ORACLE_MAINTAINED = 'Y';
    if (mode === 'unknown-user') f.rows[0].ORACLE_MAINTAINED = null;
    const row = (await snapshot(f)).locks[0]; f.calls.length = 0;
    await assert.rejects(terminateLockSession(f.query, { id: row.id, fingerprint: row.fingerprint }, f.options), /lock_/);
    assert.ok(f.calls.every(sql => !sql.startsWith('ALTER SYSTEM')));
    if (mode === 'readonly') assert.equal(f.calls.length, 0);
  }
});

test('Termination revalidates the exact selected session and never follows the blocking SID', async () => {
  const f = catalog(); f.rows[0].BLOCKING_SID = 99;
  const row = (await snapshot(f)).locks[0];
  assert.equal((await terminateLockSession(f.query, { id: row.id, fingerprint: row.fingerprint }, f.options)).status, 'requested');
  assert.equal(f.calls.at(-1), "ALTER SYSTEM KILL SESSION '20,40' IMMEDIATE");
  f.rows[0].SERIAL = 41;
  await assert.rejects(terminateLockSession(f.query, { id: row.id, fingerprint: row.fingerprint }, f.options), /lock_target_changed/);
  f.rows = [];
  await assert.rejects(terminateLockSession(f.query, { id: row.id, fingerprint: row.fingerprint }, f.options), /lock_target_changed/);
});

test('Marked-for-kill is pending success and native errors are sanitized', async () => {
  const f = catalog(), row = (await snapshot(f)).locks[0];
  f.killError = { errorNum: 31 };
  assert.equal((await terminateLockSession(f.query, { id: row.id, fingerprint: row.fingerprint }, f.options)).status, 'marked');
  assert.deepEqual(safeLockError(new Error('ORA-01031: hidden SQL and password')), { error: 'lock_operation_failed', errorCode: 'ORA-01031' });
});

test('Failed reads retain the snapshot and selection, block mutations and retry safely', async () => {
  const f = catalog(); let fail = false, writes = 0;
  const h = await createLockHarness(async channel => {
    if (channel !== 'list-oracle-locks') { writes++; return { success: true }; }
    return fail ? { success: false, error: 'lock_read_failed' } : snapshot(f);
  });
  try {
    const id = h.state.rows[0].id; h.state.select(id); await h.flush();
    fail = true; await h.state.load(); await h.flush();
    assert.equal(h.state.rows.length, 1); assert.equal(h.state.selected.id, id); assert.equal(h.state.canKill, false);
    await h.state.killSelected(); assert.equal(writes, 0);
    fail = false; await h.state.load(); await h.flush(); assert.equal(h.state.canKill, true);
    f.rows = []; await h.state.load(); await h.flush(); assert.equal(h.state.selected, null);
  } finally { h.unmount(); }
});

test('Inspect blocker selects a confirmed local row without terminating it; remote blockers cannot be followed', async () => {
  const f = catalog(); f.rows.push(lockFixture({ SID: 30, SERIAL: 50, REQUEST_MODE: 6, HELD_MODE: 0, BLOCKING_SID: 20, BLOCKING_INSTANCE: 1, WAITERS: 0 }));
  const calls = []; const h = await createLockHarness(async channel => { calls.push(channel); return snapshot(f); });
  try {
    h.state.select(h.state.rows[1].id); await h.flush(); h.state.inspectBlocker(); await h.flush();
    assert.equal(h.state.selected.SID, 20); assert.ok(calls.every(c => c === 'list-oracle-locks'));
    f.rows[1].BLOCKING_INSTANCE = 2; await h.state.load(); await h.flush(); h.state.select(h.state.rows[1].id); await h.flush();
    assert.equal(h.state.blocker, null);
  } finally { h.unmount(); }
});

test('Canceled confirmations and duplicate clicks issue at most one command and re-read after successful termination', async () => {
  for (const confirm of [false, true]) {
    const f = catalog(); let writes = 0, finish;
    const h = await createLockHarness(channel => channel === 'list-oracle-locks' ? snapshot(f) : (writes++, new Promise(resolve => { finish = resolve; })), { confirm: () => confirm });
    try {
      h.state.select(h.state.rows[0].id); await h.flush();
      const task = h.state.killSelected(); await h.flush(); await h.state.killSelected();
      assert.equal(writes, confirm ? 1 : 0);
      if (confirm) { f.rows = []; finish({ success: true, status: 'marked' }); }
      await task; await h.flush();
      if (confirm) { assert.equal(h.state.selected, null); assert.equal(h.state.notice, 'lock_kill_marked'); }
    } finally { h.unmount(); }
  }
});

test('A completed command with failed refresh retains a notice, disables actions and never repeats termination', async () => {
  const f = catalog(); let reads = 0, writes = 0;
  const h = await createLockHarness(channel => channel === 'list-oracle-locks' ? (++reads > 1 ? { success: false, error: 'lock_read_failed' } : snapshot(f)) : (writes++, { success: true, status: 'requested' }));
  try {
    h.state.select(h.state.rows[0].id); await h.flush(); await h.state.killSelected(); await h.flush();
    assert.equal(h.state.notice, 'lock_kill_requested'); assert.equal(h.state.ready, false);
    await h.state.killSelected(); assert.equal(writes, 1);
  } finally { h.unmount(); }
});

test('Auto refresh skips pending reads, pauses when hidden and rejects late replies after reactivation', async () => {
  const f = catalog(); let hold = false, release, calls = 0;
  const h = await createLockHarness(() => { calls++; return hold ? new Promise(resolve => { release = resolve; }) : snapshot(f); });
  try {
    h.state.setRefreshSeconds(5); await h.flush(); assert.equal(h.timers.size, 1);
    hold = true; [...h.timers.values()][0](); await h.flush(); [...h.timers.values()][0](); assert.equal(calls, 2);
    const old = release; h.updateActive(false); await h.flush(); assert.equal(h.timers.size, 0);
    hold = false; h.updateActive(true); await h.flush(); assert.equal(calls, 3); assert.equal(h.state.ready, true);
    old({ success: true, locks: [], context: {}, fetchedAt: '' }); await h.flush(); assert.equal(h.state.rows.length, 1);
  } finally { h.unmount(); }
});

test('User, object and session search and waiting/blocking filters preserve exact selected identity', async () => {
  const f = catalog(); f.rows.push(lockFixture({ SID: 30, SERIAL: 50, REQUEST_MODE: 6, HELD_MODE: 0, WAITERS: 0, BLOCK: 0, OBJECT_OWNER: 'Mixed', OBJECT_NAME: 'Order.Items' }));
  const h = await createLockHarness(() => snapshot(f));
  try {
    h.state.select(h.state.rows[0].id); h.state.setFilter('waiting'); await h.flush(); assert.equal(h.state.rows.length, 1); assert.equal(h.state.selected.SID, 20); assert.equal(h.state.canKill, false, 'A filtered-out selection cannot be terminated');
    h.state.setSearch('mixed.order'); await h.flush(); assert.equal(h.state.rows.length, 1);
    h.state.setSearch('order.items'); await h.flush(); assert.equal(h.state.rows[0].SID, 30);
    h.state.setSearch(''); h.state.setFilter('blocking'); await h.flush(); assert.equal(h.state.rows[0].SID, 20);
  } finally { h.unmount(); }
});

test('Structured lock IPC rejects a PostgreSQL client and never publishes a transaction state', async () => {
  const { createDatabaseIpc } = require('./helpers/ddlEditors.cjs');
  let writes = 0;
  const client = { readOracleLocks: async () => ({ locks: [], context: {}, fetchedAt: '' }), terminateOracleLockSession: async () => { writes++; return { status: 'requested' }; } };
  const pg = createDatabaseIpc(client, 'postgresql');
  assert.equal((await pg('list-oracle-locks')).success, false);
  assert.equal((await pg('terminate-oracle-lock-session', {})).success, false); assert.equal(writes, 0);
  const oracle = createDatabaseIpc(client, 'oracle');
  assert.equal(Object.hasOwn(await oracle('list-oracle-locks'), 'hasUncommittedTx'), false);
  assert.equal(Object.hasOwn(await oracle('terminate-oracle-lock-session', {}), 'hasUncommittedTx'), false);
});

test('One reserved background connection is used throughout lock commands and duplicate mutations are blocked', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
  const f = catalog(), client = new Client();
  const connection = { execute: f.query }, slot = { conn: connection, isExecuting: false };
  client.connection = {}; client.bgPool = [slot]; client.managedSessions.set(client.connection, { sid: 11, instance: 1, container: 3 });
  client.managedSessions.set(connection, { sid: 10, instance: 1, container: 3 });
  let reservations = 0; client.getAvailableBgConnection = async () => { reservations++; slot.isExecuting = true; return slot; };
  const row = (await client.readOracleLocks()).locks[0]; assert.equal(reservations, 1); assert.equal(slot.isExecuting, false);
  let release; const original = connection.execute;
  connection.execute = sql => sql.startsWith('ALTER SYSTEM') ? new Promise(resolve => { release = resolve; }) : original(sql);
  const task = client.terminateOracleLockSession({ id: row.id, fingerprint: row.fingerprint });
  while (!release) await Promise.resolve();
  await assert.rejects(client.terminateOracleLockSession({ id: row.id, fingerprint: row.fingerprint }), /lock_operation_busy/);
  release({}); await task; assert.equal(reservations, 2); assert.equal(slot.isExecuting, false);
});
