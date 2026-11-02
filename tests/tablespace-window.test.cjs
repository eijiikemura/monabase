// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const service = require('../electron/oracle/tablespaceManagement');
const { createTablespaceHarness } = require('./helpers/tablespaceData.cjs');
function fixture() {
  const f = { calls: [], options: { scope: {}, readonly: false }, failList: false, failDetail: false, failAuto: false, users: [], defaults: ['USERS', 'TEMP'], denyFree: false,
    rows: ['BIG', 'USERS', 'SYSTEM', 'TEMP', 'UNDO'].map((name, index) => ({ TABLESPACE_NAME: name, TS_ID: String(index + 1), CONTENTS: name === 'TEMP' ? 'TEMPORARY' : name === 'UNDO' ? 'UNDO' : 'PERMANENT', STATUS: 'ONLINE', BIGFILE: name === 'BIG' ? 'YES' : 'NO', BLOCK_SIZE: 8192 })) };
  f.files = f.rows.map((row, index) => ({ TABLESPACE_NAME: row.TABLESPACE_NAME, FILE_ID: String(index + 1), FILE_NAME: `/db/${row.TABLESPACE_NAME}.dbf`, BYTES: '104857600', AUTOEXTENSIBLE: 'YES', MAXBYTES: '1073741824', NEXT_BYTES: '10485760', ONLINE_STATUS: 'ONLINE', CREATION_ID: String(index + 100), KIND: row.CONTENTS === 'TEMPORARY' ? 'TEMPFILE' : 'DATAFILE' }));
  f.query = async (sql, binds) => {
    f.calls.push([sql, binds]);
    if (sql === service.IDENTITY_SQL) return { rows: [{ DB_NAME: 'DB', CON_ID: 3, CON_NAME: 'PDB', INSTANCE_ID: 1 }] };
    if (sql.includes('FROM SESSION_PRIVS')) return { rows: ['CREATE TABLESPACE', 'ALTER TABLESPACE', 'DROP TABLESPACE'].map(PRIVILEGE => ({ PRIVILEGE })) };
    if (sql.includes('FROM DATABASE_PROPERTIES')) return { rows: f.defaults.map(PROPERTY_VALUE => ({ PROPERTY_VALUE })) };
    if (sql.includes('FROM V$PARAMETER')) return { rows: [{ NAME: 'db_create_file_dest', VALUE: '/db' }, { NAME: 'db_block_size', VALUE: '8192' }] };
    if (sql === service.TABLESPACE_SQL) { if (f.failList) throw Error('List unavailable'); return { rows: f.rows }; }
    if (sql === service.FILE_SQL) return { rows: f.files };
    if (sql === service.FREE_SQL) { if (f.denyFree) throw { errorNum: 1031 }; return { rows: f.rows.map(row => ({ TABLESPACE_NAME: row.TABLESPACE_NAME, FILE_ID: '1', FREE_BYTES: '26214400' })) }; }
    if (sql === service.TEMP_SQL) return { rows: [{ TABLESPACE_NAME: 'TEMP', TOTAL_BYTES: '104857600', FREE_BYTES: '78643200' }] };
    if (sql.includes('FROM DBA_USERS')) { if (f.failDetail) throw Error('Detail unavailable'); return { rows: f.users }; }
    if (sql.includes('FROM DBA_TS_QUOTAS') || sql.includes('FROM DBA_SEGMENTS')) return { rows: [] };
    if (sql.startsWith('ALTER TABLESPACE')) {
      if (sql.includes(' RESIZE ')) f.files[0].BYTES = String(BigInt(sql.match(/RESIZE (\d+)M/)[1]) * 1048576n);
      if (sql.includes(' AUTOEXTEND ')) { if (f.failAuto) throw Object.assign(Error('private server detail'), { code: 'ORA-01031' }); f.files[0].AUTOEXTENSIBLE = 'NO'; }
      return {};
    }
    if (sql.startsWith('CREATE ') || sql.startsWith('DROP ')) return {};
    throw Error('Unexpected query: ' + sql);
  };
  f.manager = service.createTablespaceManager();
  f.invoke = async (channel, input) => { try { const method = { 'list-oracle-tablespaces': 'read', 'get-oracle-tablespace-detail': 'detail', 'review-oracle-tablespace-operation': 'review', 'execute-oracle-tablespace-operation': 'execute' }[channel]; return { success: true, ...await (method === 'read' ? f.manager.read(f.query, f.options) : f.manager[method](f.query, input, f.options)) }; } catch (error) { return { success: false, ...service.safeError(error) }; } };
  return f;
}
async function request(f, name = 'BIG', action = 'resize') { const row = (await service.readTablespaces(f.query, f.options)).tablespaces.find(row => row.name === name); return { action, name, id: row.id, expected: row.fingerprint, sizeMb: '200', autoExtend: false, pathMode: 'omf' }; }
const writes = f => f.calls.filter(([sql]) => /^(ALTER|CREATE|DROP) /.test(sql));
test('Permanent, TEMP and offline capacities use distinct sources and preserve unknown values', async () => {
  const f = fixture(); let result = await service.readTablespaces(f.query, f.options);
  assert.equal(result.tablespaces[0].usedMb, '75.00'); assert.equal(result.tablespaces.find(row => row.name === 'TEMP').freeMb, '75.00'); assert.equal(result.files[3].kind, 'TEMPFILE');
  f.rows[0].STATUS = 'OFFLINE'; result = await service.readTablespaces(f.query, f.options); assert.equal(result.tablespaces[0].usedPercent, null); assert.equal(result.tablespaces[0].allocatedMb, '100.00');
  f.rows[0].STATUS = 'ONLINE'; f.denyFree = true; result = await service.readTablespaces(f.query, f.options); assert.equal(result.tablespaces[0].freeMb, null); assert.equal(result.tablespaces[3].freeMb, '75.00');
  assert.equal(service.mb('900719925474099300001'), '858993459200000.10');
});
test('Identity distinguishes file replacement while allocation changes invalidate review fingerprints', async () => {
  const f = fixture(), first = await service.readTablespaces(f.query, f.options); f.files.reverse(); const reordered = await service.readTablespaces(f.query, f.options); assert.equal(first.tablespaces[0].id, reordered.tablespaces[0].id);
  const file = f.files.find(row => row.TABLESPACE_NAME === 'BIG'); file.BYTES = '209715200'; const changed = await service.readTablespaces(f.query, f.options); assert.equal(first.tablespaces[0].id, changed.tablespaces[0].id); assert.notEqual(first.tablespaces[0].fingerprint, changed.tablespaces[0].fingerprint);
  file.CREATION_ID = '999'; assert.notEqual(first.tablespaces[0].id, (await service.readTablespaces(f.query, f.options)).tablespaces[0].id);
});
test('Resize partial failure preserves completed steps and new review contains only remaining changes', async () => {
  const f = fixture(), input = await request(f), review = await f.manager.review(f.query, input, f.options); assert.deepEqual(review.steps.map(step => step.kind), ['resize', 'autoextend']); f.failAuto = true;
  await assert.rejects(f.manager.execute(f.query, { ...review.request, token: review.token }, f.options), error => { const safe = service.safeError(error); assert.deepEqual(safe.completed, ['resize']); assert.equal(safe.attempted, 'autoextend'); assert.equal(safe.errorCode, 'ORA-01031'); assert.equal(safe.error, 'ts_operation_failed'); return true; });
  await assert.rejects(f.manager.execute(f.query, { ...review.request, token: review.token }, f.options), /review_expired/);
  f.failAuto = false; const next = await f.manager.review(f.query, await request(f), f.options); assert.deepEqual(next.steps.map(step => step.kind), ['autoextend']); await f.manager.execute(f.query, { ...next.request, token: next.token }, f.options);
  assert.equal((await f.manager.review(f.query, await request(f), f.options)).canExecute, false); assert.equal(writes(f).filter(([sql]) => sql.includes('RESIZE')).length, 1);
});
test('System, TEMP, UNDO, default shrink/drop, user references and readonly requests are rejected before mutation', async () => {
  for (const name of ['SYSTEM', 'TEMP', 'UNDO', 'USERS']) { const f = fixture(); await assert.rejects(f.manager.review(f.query, await request(f, name, 'drop'), f.options), /protected/); assert.equal(writes(f).length, 0); }
  const f = fixture(); f.defaults = ['BIG', 'TEMP']; const shrink = { ...await request(f), sizeMb: '50' }; await assert.rejects(f.manager.review(f.query, shrink, f.options), /protected/); await f.manager.review(f.query, await request(f), f.options);
  f.defaults = ['USERS', 'TEMP']; f.users = [{ USERNAME: 'OTHER' }]; await assert.rejects(f.manager.review(f.query, await request(f, 'BIG', 'drop'), f.options), /referenced/);
  f.options.readonly = true; await assert.rejects(f.manager.review(f.query, await request(f), f.options), /readonly/); assert.equal(writes(f).length, 0);
});
test('Review is bound to exact configuration, connection scope and typed drop name', async () => {
  const f = fixture(), input = await request(f, 'BIG', 'drop'), review = await f.manager.review(f.query, input, f.options);
  await assert.rejects(f.manager.execute(f.query, { ...input, token: review.token, confirmName: 'big' }, f.options), /confirm_name/);
  await assert.rejects(f.manager.execute(f.query, { ...input, token: review.token, confirmName: 'BIG' }, { ...f.options, scope: {} }), /review_expired/);
  f.files[0].NEXT_BYTES = '20971520'; await assert.rejects(f.manager.execute(f.query, { ...input, token: review.token, confirmName: 'BIG' }, f.options), /conflict/); assert.equal(writes(f).length, 0);
});
test('Sizes and paths are validated, quoted names round-trip and apostrophes are escaped without REUSE', async () => {
  const f = fixture(), input = { action: 'create', name: '"Mixed Name"', sizeMb: '100', autoExtend: true, nextMb: '10', maxMb: '1024', pathMode: 'path', path: "/db/a'b.dbf" };
  for (const sizeMb of ['0', '-1', 'NaN', 'Infinity', '1.5', '1e3', '999999999999']) await assert.rejects(f.manager.review(f.query, { ...input, sizeMb }, f.options), /ts_(invalid_size|size_limit)/);
  for (const path of ['relative.dbf', '/db/../existing.dbf', '/db/\nfile']) await assert.rejects(f.manager.review(f.query, { ...input, path }, f.options), /invalid_path/);
  const review = await f.manager.review(f.query, input, f.options); assert.match(review.steps[0].sql, /"Mixed Name"/); assert.match(review.steps[0].sql, /a''b.dbf/); assert.doesNotMatch(review.steps[0].sql, /REUSE|UNLIMITED/); await f.manager.execute(f.query, { ...review.request, token: review.token }, f.options);
});
test('Hook prefills actual BIGFILE settings and retains failed observations with mutations disabled until retry', async () => {
  const f = fixture(), h = await createTablespaceHarness(f.invoke); h.state.select(h.state.rows[0].id); await h.flush(); h.state.open('resize'); await h.flush(); assert.equal(h.state.draft.sizeMb, '100'); assert.equal(h.state.draft.nextMb, '10'); assert.equal(h.state.draft.maxMb, '1024');
  f.failDetail = true; await h.state.retryDetail(); await h.flush(); assert.ok(h.state.detail.files.length); assert.equal(h.state.detailReady, false); assert.equal(h.state.can('resize'), false);
  f.failDetail = false; await h.state.retryDetail(); await h.flush(); assert.equal(h.state.can('resize'), true);
  f.failList = true; await h.state.reload(); await h.flush(); assert.ok(h.state.rows.length); assert.equal(h.state.ready, false); assert.equal(h.state.can('create'), false); f.failList = false; await h.state.reload(); await h.flush(); assert.equal(h.state.ready, true); h.unmount();
});
test('Hook consumes failed review, preserves requested values and requires reload and renewed acknowledgement', async () => {
  const f = fixture(), h = await createTablespaceHarness(f.invoke); h.state.select(h.state.rows[0].id); await h.flush(); h.state.open('resize'); await h.flush(); h.state.update({ sizeMb: '200', autoExtend: false }); await h.flush(); await h.state.prepare(); await h.flush(); h.state.setAcknowledged(true); await h.flush(); f.failAuto = true; await h.state.execute(); await h.flush(); assert.deepEqual(h.state.outcome.completed, ['resize']); assert.equal(h.state.review, null); assert.equal(h.state.canExecute, false);
  f.failAuto = false; await h.state.reload(); await h.flush(); assert.equal(h.state.draft.sizeMb, '200'); await h.state.prepare(); await h.flush(); assert.deepEqual(h.state.review.steps.map(step => step.kind), ['autoextend']); assert.equal(h.state.canExecute, false); h.unmount();
});
test('Late list responses after deactivation cannot replace current observations', async () => {
  const f = fixture(); let resolve; const h = await createTablespaceHarness(f.invoke); const original = f.invoke; f.invoke = null;
  const deferred = await createTablespaceHarness((channel, input) => channel === 'list-oracle-tablespaces' ? new Promise(done => { resolve = done; }) : original(channel, input));
  deferred.updateActive(false); await deferred.flush(); resolve({ success: true, ...await service.readTablespaces(f.query, f.options) }); await deferred.flush(); assert.equal(deferred.state.snapshot, null); assert.equal(deferred.state.ready, false); deferred.unmount(); h.unmount();
});
test('Permission-only list fallback is explicitly limited, while transport failures remain errors', async () => {
  const f = fixture(), base = f.query;
  const limited = async (sql, binds) => { if (sql === service.TABLESPACE_SQL) throw { errorNum: 1031 }; if (sql.includes('FROM USER_TABLESPACES')) return { rows: f.rows.map(({ TS_ID, ...row }) => row) }; return base(sql, binds); };
  const result = await service.readTablespaces(limited, f.options); assert.equal(result.context.scope, 'visible'); assert.equal(result.context.protectionReady, false); assert.ok(result.tablespaces.every(row => row.protected));
  await assert.rejects(service.readTablespaces(async (sql, binds) => { if (sql === service.TABLESPACE_SQL) throw Object.assign(Error('Network unavailable'), { code: 'NJS-500' }); return base(sql, binds); }, f.options), /Network/);
});
test('Missing generation, ambiguous TEMP usage and missing protection metadata never enable unsafe operations', async () => {
  const f = fixture(), base = f.query; f.files[0].CREATION_ID = null;
  let result = await service.readTablespaces(f.query, f.options); assert.equal(result.tablespaces[0].protected, true);
  const ambiguous = async (sql, binds) => { const result = await base(sql, binds); return sql === service.TEMP_SQL ? { rows: [...result.rows, ...result.rows] } : result; };
  result = await service.readTablespaces(ambiguous, f.options); assert.equal(result.tablespaces.find(row => row.kind === 'TEMPORARY').usedMb, null);
  f.defaults = []; result = await service.readTablespaces(f.query, f.options); assert.equal(result.context.protectionReady, false); assert.ok(result.tablespaces.every(row => row.protected));
});
test('Main-process privilege checks reject changes even when a renderer submits a valid plan shape', async () => {
  const f = fixture(), input = await request(f), base = f.query;
  const noPrivilege = (sql, binds) => sql.includes('FROM SESSION_PRIVS') ? Promise.resolve({ rows: [] }) : base(sql, binds);
  await assert.rejects(f.manager.review(noPrivilege, input, f.options), /permission/); assert.equal(writes(f).length, 0);
});
test('Structured tablespace IPC sanitizes failures and never publishes transaction state', async () => {
  const { createDatabaseIpc } = require('./helpers/ddlEditors.cjs');
  const client = { executeTablespaceOperation: async () => { const error = Object.assign(Error('private path and SQL'), { code: 'ORA-03297', tsCompleted: ['resize'], tsAttempted: 'autoextend' }); throw error; } };
  const result = await createDatabaseIpc(client, 'oracle')('execute-oracle-tablespace-operation', {});
  assert.equal(result.success, false); assert.equal(result.errorCode, 'ORA-03297'); assert.deepEqual(result.completed, ['resize']); assert.equal(result.attempted, 'autoextend'); assert.equal(Object.hasOwn(result, 'hasUncommittedTx'), false); assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal((await createDatabaseIpc(client, 'postgresql')('execute-oracle-tablespace-operation', {})).success, false);
});
test('Dedicated connection closes on identity mismatch and preserves applied steps if cleanup fails', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const f = fixture(); let closed = 0, closeFailure = false, mismatch = false;
  const conn = { execute: (sql, binds) => mismatch && sql === service.IDENTITY_SQL ? { rows: [{ DB_NAME: 'OTHER', CON_ID: 3 }] } : f.query(sql, binds), close: async () => { closed++; if (closeFailure) throw Object.assign(Error('cleanup failed'), { code: 'NJS-500' }); } };
  const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } }, oracledb: { OUT_FORMAT_OBJECT: 1, getConnection: async () => conn } }, {}, { strict: false });
  const client = new Client(); client.connection = { execute: async sql => { assert.equal(sql, service.IDENTITY_SQL, 'The main connection receives only identity reads'); return f.query(sql); } }; client.dbLinkConnectOptions = {};
  mismatch = true; await assert.rejects(client.listManagedTablespaces(), /connection_changed/); assert.equal(closed, 1); assert.equal(client.isExecuting, false);
  mismatch = false; closeFailure = true;
  await assert.rejects(client.withTablespaceConnection(async () => ({ completed: ['resize'], attempted: null })), error => { assert.deepEqual(error.tsCompleted, ['resize']); return true; });
  assert.equal(closed, 2); assert.equal(client.isExecuting, false);
});
