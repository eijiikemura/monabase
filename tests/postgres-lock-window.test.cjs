// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const service = require('../electron/postgres/lockManagement');
const { createPostgresLockHarness, postgresLockFixture } = require('./helpers/postgresLockData.cjs');
function fixture() {
  const f = { rows: [postgresLockFixture(), postgresLockFixture({ pid: 21, granted: true, mode: 'ExclusiveLock', state: 'idle in transaction', blockers: [] })], calls: [], requests: [], failRead: false, failSignal: false, accepted: true, ended: true, options: { readonly: false, ownPids: [10, 11, 12], protectionReady: true }, superuser: false, signal: false };
  f.query = async (sql, binds) => {
    f.calls.push([sql, binds]);
    if (sql === service.CONTEXT_SQL) return { rows: [{ database: 'demo', database_id: '5', reader_pid: 12, version: 180000, superuser: f.superuser, signal: f.signal }] };
    if (sql === service.LOCK_SQL) { if (f.failRead) throw Error('Read failed'); return { rows: f.rows.map(row => ({ ...row })) }; }
    if (sql === service.TARGET_SQL) return { rows: f.ended ? [] : [{ pid: 20, state: 'active', query_start: f.rows[0].query_start }] };
    if (sql.startsWith('SELECT pg_')) { if (f.failSignal) throw Object.assign(Error('private SQL'), { code: '42501' }); return { rows: [{ accepted: f.accepted }] }; }
    throw Error('Unexpected query');
  };
  f.invoke = async (channel, input) => { f.requests.push([channel, input]); try { return { success: true, ...await (channel === 'list-postgres-locks' ? service.readLocks(f.query, f.options) : service.manageLock(f.query, input, f.options)) }; } catch (error) { return { success: false, ...service.safeError(error) }; } };
  return f;
}
const target = async (f, action = 'terminate') => ({ ...(await service.readLocks(f.query, f.options)).locks[0], action });
const signals = f => f.calls.filter(([sql]) => sql.startsWith('SELECT pg_'));
async function selected(f, options) { const h = await createPostgresLockHarness(f.invoke, options); h.state.select(h.state.rows[0].id); await h.flush(); return h; }
test('Lock identity survives reorder and distinguishes reused PIDs, lock tags and backend generations', async () => {
  const f = fixture(), first = await target(f); f.rows.reverse(); assert.equal((await service.readLocks(f.query, f.options)).locks[1].id, first.id); f.rows.reverse();
  for (const override of [{ backend_start: 'later' }, { transaction_id: '9007199254740994' }, { virtualtransaction: '2/4' }, { database_id: '9' }, { mode: 'RowExclusiveLock' }]) { const old = f.rows[0]; f.rows[0] = { ...old, ...override }; assert.notEqual((await target(f)).id, first.id); f.rows[0] = old; }
  assert.equal(first.querySeconds, '9007199254740993.000001'); assert.equal(first.transactionId, '9007199254740993');
});
test('Prepared, internal, application, superuser, hidden-identity and unprivileged targets cannot be signalled', async () => {
  for (const override of [{ pid: null }, { pid: 10 }, { pid: 11 }, { pid: 12 }, { backend_type: 'autovacuum worker' }, { backend_start: null }, { target_superuser: true }, { member: false }, { user_id: null }]) {
    const f = fixture(); Object.assign(f.rows[0], override); await assert.rejects(service.manageLock(f.query, await target(f), f.options), /protected/); assert.equal(signals(f).length, 0);
  }
  for (const options of [{ readonly: true }, { protectionReady: false }]) { const f = fixture(); Object.assign(f.options, options); await assert.rejects(service.manageLock(f.query, await target(f), f.options), /readonly|protected/); assert.equal(signals(f).length, 0); }
});
test('Blocker counts deduplicate waiters and keep prepared transaction blockers distinct from processes', async () => {
  const f = fixture(); f.rows[0].blockers = [21, 21, 0]; f.rows.push({ ...f.rows[0], mode: 'RowShareLock' });
  const rows = (await service.readLocks(f.query, f.options)).locks; assert.deepEqual(rows[0].blockers, [21, 0]); assert.equal(rows[1].waiters, 1);
  assert.match(service.LOCK_SQL, /pg_blocking_pids/); assert.match(service.LOCK_SQL, /l.database=0/);
});
test('Revalidation rejects changed queries, users and lock state before sending any signal', async () => {
  for (const override of [{ query_start: 'changed' }, { query: 'SELECT NEW' }, { user_id: '101' }, { granted: true }, { backend_start: 'reused' }]) { const f = fixture(), input = await target(f); Object.assign(f.rows[0], override); await assert.rejects(service.manageLock(f.query, input, f.options), /target_changed/); assert.equal(signals(f).length, 0); }
});
test('Signal acceptance is distinct from observed connection or query completion and false is a failure', async () => {
  const f = fixture(); assert.equal((await service.manageLock(f.query, await target(f), f.options)).status, 'ended');
  const [sql, binds] = signals(f)[0]; assert.match(sql, /backend_start::text=\$2/); assert.match(sql, /query_start IS NOT DISTINCT FROM \$5/); assert.equal(binds[0], 20);
  f.ended = false; assert.equal((await service.manageLock(f.query, await target(f), f.options)).status, 'requested');
  f.accepted = false; await assert.rejects(service.manageLock(f.query, await target(f), f.options), /not_accepted/);
});
test('Cancellation requires a visible active query, preserves the connection and reports failed observation separately', async () => {
  const f = fixture(), base = f.query; f.query = (sql, binds) => sql === service.TARGET_SQL ? Promise.resolve({ rows: [{ state: 'idle in transaction', query_start: f.rows[0].query_start }] }) : base(sql, binds);
  assert.equal((await service.manageLock(f.query, await target(f, 'cancel'), f.options)).status, 'query-ended'); assert.match(signals(f)[0][0], /pg_cancel_backend/);
  f.query = (sql, binds) => { if (sql === service.TARGET_SQL) throw Error('Observation lost'); return base(sql, binds); };
  assert.equal((await service.manageLock(f.query, await target(f), f.options)).observationFailed, true);
  f.rows[0].query = '<insufficient privilege>'; await assert.rejects(service.manageLock(f.query, await target(f, 'cancel'), f.options), /protected/);
});
test('Hook retains failed observations, disables commands until retry and clears vanished selections', async () => {
  const f = fixture(), h = await selected(f); assert.equal(h.state.can('terminate'), true); f.failRead = true; await h.state.load(); await h.flush(); assert.ok(h.state.rows.length); assert.equal(h.state.ready, false); assert.equal(h.state.can('terminate'), false);
  f.failRead = false; await h.state.load(); await h.flush(); assert.equal(h.state.can('terminate'), true); f.rows = []; await h.state.load(); await h.flush(); assert.equal(h.state.selectedId, null); h.unmount();
});
test('Hook supports blocker navigation, filters, cancellation refusal and duplicate command protection', async () => {
  const f = fixture(), h = await selected(f, { confirm: () => false }); assert.equal(h.state.blockers[0].pid, 21); await h.state.command('terminate'); assert.equal(signals(f).length, 0); h.state.inspectBlocker(21); await h.flush(); assert.equal(h.state.selected.pid, 21); assert.equal(h.state.can('cancel'), false);
  h.state.setSearch('unmatched'); await h.flush(); assert.equal(h.state.can('terminate'), false); h.unmount();
  const g = fixture(), j = await selected(g); await Promise.all([j.state.command('terminate'), j.state.command('terminate')]); await j.flush(); assert.equal(signals(g).length, 1); assert.equal(j.confirmations.length, 1); assert.equal(j.state.notice, 'pg_lock_ended'); j.unmount();
});
test('Command failures require manual reload and never leak SQL or publish main transaction state through IPC', async () => {
  const f = fixture(), h = await selected(f); f.failSignal = true; await h.state.command('cancel'); await h.flush(); assert.equal(h.state.ready, false); assert.equal(h.state.errorCode, '42501'); assert.equal(h.state.can('cancel'), false); assert.equal(h.state.error, 'pg_lock_operation_failed'); h.unmount();
  const { createDatabaseIpc } = require('./helpers/ddlEditors.cjs');
  const client = { managePostgresLock: async () => { throw Object.assign(Error('secret SQL'), { code: '42501' }); } };
  const result = await createDatabaseIpc(client, 'postgresql')('manage-postgres-lock', {}); assert.equal(result.errorCode, '42501'); assert.equal(Object.hasOwn(result, 'hasUncommittedTx'), false); assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal((await createDatabaseIpc(client, 'oracle')('manage-postgres-lock', {})).success, false);
});
test('Late observations and command failures from hidden activations cannot overwrite the new activation', async () => {
  const f = fixture(); let finish; const h = await createPostgresLockHarness((channel, input) => channel === 'list-postgres-locks' ? new Promise(resolve => { finish = resolve; }) : f.invoke(channel, input));
  h.updateActive(false); await h.flush(); finish({ success: true, ...await service.readLocks(f.query, f.options) }); await h.flush(); assert.equal(h.state.snapshot, null); h.unmount();
  const g = fixture(), j = await selected(g); const base = g.query; let reject;
  g.query = (sql, binds) => sql.startsWith('SELECT pg_') ? new Promise((_resolve, fail) => { reject = fail; }) : base(sql, binds);
  const command = j.state.command('terminate'); while (!reject) await new Promise(resolve => setImmediate(resolve)); j.updateActive(false); await j.flush(); j.updateActive(true); await j.flush(); reject(Error('late error')); await command; await j.waitFor(s => s.ready && !s.loading && !s.acting); assert.equal(j.state.error, ''); j.unmount();
});
test('A reserved background slot preserves main state, releases after errors and rejects duplicate management', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const Client = loadModule('electron/postgres/postgresClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
  const f = fixture(), client = new Client(), slot = { id: 1, isExecuting: false, client: { processID: 12, getTransactionStatus: () => 'I', query: f.query } };
  client.client = { processID: 10, query: () => { throw Error('Main connection must remain untouched'); } }; client.metaClient = { processID: 11 }; client.bgPool = [slot]; client.hasUncommittedTx = true;
  const row = (await client.readPostgresLocks()).locks[0]; assert.equal(slot.isExecuting, false);
  let finish; slot.client.query = (sql, binds) => sql.startsWith('SELECT pg_') ? new Promise(resolve => { finish = resolve; }) : f.query(sql, binds);
  const pending = client.managePostgresLock({ action: 'terminate', id: row.id, fingerprint: row.fingerprint }); while (!finish) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(client.managePostgresLock({ action: 'terminate', id: row.id, fingerprint: row.fingerprint }), /busy/); finish({ rows: [{ accepted: true }] }); await pending;
  assert.equal(slot.isExecuting, false); assert.equal(client.hasUncommittedTx, true);
  slot.client.getTransactionStatus = () => 'T'; await assert.rejects(client.readPostgresLocks(), /busy/); assert.equal(slot.isExecuting, false);
  slot.client.getTransactionStatus = () => 'I'; slot.client.query = async () => { throw Error('Read failed'); }; await assert.rejects(client.readPostgresLocks(), /Read failed/); assert.equal(slot.isExecuting, false);
});
test('Connection generations invalidate old targets and transport errors after signalling require observation', async () => {
  const f = fixture(), input = await target(f); f.options.connectionId = 'new-connection'; await assert.rejects(service.manageLock(f.query, input, f.options), /target_changed/);
  const current = await target(f), base = f.query; f.query = (sql, binds) => { if (sql.startsWith('SELECT pg_')) throw Object.assign(Error('Connection lost'), { code: '08006' }); return base(sql, binds); };
  await assert.rejects(service.manageLock(f.query, current, f.options), error => { assert.equal(service.safeError(error).error, 'pg_lock_outcome_unknown'); return true; });
});
