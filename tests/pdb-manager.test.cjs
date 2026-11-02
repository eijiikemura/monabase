// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createPdbManager, safeError, pdbName, serverPath, IDENTITY_SQL, PDB_SQL } = require('../electron/oracle/pdbManagement');
const { createPdbHarness } = require('./helpers/pdbData.cjs');
function fixture() {
  const f = { manager: createPdbManager(), calls: [], options: { readonly: false, originContainer: 'APP_PDB', scope: {} },
    container: 'CDB$ROOT', dbName: 'DEMO', sysdba: true, common: true, omf: true, failList: false, failAfter: false, failAttach: false,
    localUsers: ['APP_USER'], readonly: false, compatible: true, hold: false, violations: [], requests: [],
    rows: [{ PDB_ID: 3, PDB_NAME: 'APP_PDB', GUID: 'app', DBID: '333', STATUS: 'NORMAL', OPEN_MODE: 'READ WRITE', RESTRICTED: 'NO', SIZE_MB: 18 },
      { PDB_ID: 4, PDB_NAME: 'DEMO_PDB', GUID: 'demo', DBID: '444', STATUS: 'NORMAL', OPEN_MODE: 'MOUNTED', RESTRICTED: 'NO', SIZE_MB: 30 }] };
  f.query = async (sql, binds = {}) => {
    f.calls.push([sql, binds]);
    if (sql === IDENTITY_SQL) return { rows: [{ USERNAME: 'SYS', CON_NAME: f.container, CON_ID: f.container === 'CDB$ROOT' ? 1 : 4, DB_NAME: f.dbName, INSTANCE_NAME: 'INSTANCE1', IS_DBA: f.sysdba ? 'TRUE' : 'FALSE' }] };
    if (sql === 'SELECT COMMON FROM USER_USERS') return { rows: [{ COMMON: f.common ? 'YES' : 'NO' }] };
    if (sql === 'SELECT PRIVILEGE FROM SESSION_PRIVS') return { rows: (f.sysdba ? ['CREATE PLUGGABLE DATABASE', 'ALTER USER'] : []).map(PRIVILEGE => ({ PRIVILEGE })) };
    if (sql.includes('FROM V$DATABASE')) return { rows: [{ OPEN_MODE: f.readonly ? 'READ ONLY' : 'READ WRITE', LOG_MODE: 'ARCHIVELOG' }] };
    if (sql.includes('FROM DATABASE_PROPERTIES')) return { rows: [{ PROPERTY_VALUE: 'TRUE' }] };
    if (sql.includes('FROM V$PARAMETER')) return { rows: [{ NAME: 'db_create_file_dest', VALUE: f.omf ? '/data' : '' }] };
    if (sql === PDB_SQL) { if (f.failList) throw Object.assign(new Error('Sensitive catalog failure'), { code: 'ORA-03113' }); return { rows: f.rows.map(row => ({ ...row })) }; }
    if (sql.includes('FROM V$DATAFILE')) return { rows: ['/data/a/system.dbf', '/data/b/users.dbf', '/data/b/temp.dbf'].map(FILE_NAME => ({ FILE_NAME })) };
    if (sql.includes('FROM DBA_USERS')) { assert.ok(sql.includes("COMMON = 'NO'")); return { rows: f.localUsers.map(USERNAME => ({ USERNAME })) }; }
    if (sql.includes('DBMS_PDB.CHECK_PLUG_COMPATIBILITY')) { assert.equal(binds.path, "/server/owner's.xml"); return { outBinds: { compatible: f.compatible ? 1 : 0 } }; }
    if (sql.includes('FROM PDB_PLUG_IN_VIOLATIONS')) return { rows: f.violations };
    if (sql.startsWith('ALTER SESSION SET CONTAINER')) { f.container = sql.includes('CDB$ROOT') ? 'CDB$ROOT' : 'DEMO_PDB'; return { rows: [] }; }
    if (/^(CREATE|ALTER|DROP) (PLUGGABLE DATABASE|USER)/.test(sql)) {
      if (f.hold) { f.hold = false; await new Promise(resolve => { f.release = resolve; }); }
      if (f.failAttach && sql.startsWith('CREATE PLUGGABLE')) throw Object.assign(new Error('SECRET SQL password sentinel'), { code: 'ORA-65000' });
      if (sql.startsWith('DROP')) f.rows = f.rows.filter(row => row.PDB_NAME !== 'DEMO_PDB');
      if (sql.startsWith('ALTER PLUGGABLE') && sql.includes(' CLOSE ')) f.rows[1].OPEN_MODE = 'MOUNTED';
      if (f.failAfter) f.failList = true;
      return { rows: [] };
    }
    throw new Error('Unexpected PDB SQL');
  };
  f.invoke = async (channel, request) => {
    f.requests.push([channel, request]);
    try {
      if (channel === 'list-oracle-pdbs') return { success: true, ...await f.manager.list(f.query, f.options) };
      if (channel === 'get-oracle-pdb-detail') return { success: true, ...await f.manager.detail(f.query, request, f.options) };
      if (channel === 'review-oracle-pdb-operation') return { success: true, ...await f.manager.review(f.query, request, f.options) };
      return { success: true, ...await f.manager.execute(f.query, request, f.options) };
    } catch (error) { return { success: false, ...safeError(error) }; }
  };
  f.request = async (action = 'drop', extra = {}) => ({ action, target: 'DEMO_PDB', expected: (await f.manager.list(f.query, f.options)).pdbs[1].fingerprint, ...extra });
  f.run = async request => { const review = await f.manager.review(f.query, request, f.options); return f.manager.execute(f.query, { ...request, token: review.token, confirmName: 'DEMO_PDB', password: 'secret-sentinel' }, f.options); };
  return f;
}
const writes = f => f.calls.filter(([sql]) => /^(CREATE|ALTER|DROP) (PLUGGABLE DATABASE|USER)/.test(sql));
async function opened(f, action = 'drop') {
  const h = await createPdbHarness(f.invoke); h.state.setSelectedId('demo'); await h.flush(); await h.state.open(action); await h.flush(); return h;
}
test('Names are normalized and paths preserve apostrophes without accepting control characters or traversal', () => {
  assert.equal(pdbName('demo_pdb'), 'DEMO_PDB'); assert.equal(serverPath("/server/owner's.xml"), "/server/owner's.xml");
  for (const value of ['CDB$ROOT', 'PDB$SEED', 'bad"', 'a'.repeat(31), '1bad']) {
    assert.throws(() => pdbName(value));
  }
  for (const path of ['relative.xml', '/x/../secret.xml', '/x\0']) assert.throws(() => serverPath(path));
});
test('Snapshots preserve unknown state, identify objects by GUID, and protect the application PDB', async () => {
  const f = fixture(); f.rows[1].OPEN_MODE = null;
  const snapshot = await f.manager.list(f.query, f.options);
  assert.equal(snapshot.pdbs[0].protected, true); assert.equal(snapshot.pdbs[1].openMode, null); assert.equal(snapshot.pdbs[1].id, 'demo');
  assert.equal(snapshot.seedFiles.length, 3); assert.ok(f.calls.some(([sql]) => sql.includes('V$TEMPFILE')));
});
test('Readonly, permission, protected-target and stale-identity checks prevent native mutations', async () => {
  for (const mode of ['readonly', 'permission', 'protected', 'identity', 'database']) {
    const f = fixture(), request = await f.request();
    if (mode === 'readonly') f.options.readonly = true;
    if (mode === 'permission') f.sysdba = false;
    if (mode === 'protected') f.options.originContainer = 'DEMO_PDB';
    if (mode === 'identity') f.rows[1].GUID = 'new';
    if (mode === 'database') f.dbName = 'OTHER';
    await assert.rejects(f.manager.review(f.query, request, f.options), /pdb_/); assert.equal(writes(f).length, 0);
  }
});
test('Mutation requires a single-use review, exact destructive name and unchanged parameters', async () => {
  const f = fixture(), request = await f.request(), review = await f.manager.review(f.query, request, f.options);
  await assert.rejects(f.manager.execute(f.query, { ...request, token: review.token, confirmName: 'wrong' }, f.options), /confirmation/);
  await f.manager.execute(f.query, { ...request, token: review.token, confirmName: 'DEMO_PDB' }, f.options);
  assert.equal(writes(f).length, 1);
  await assert.rejects(f.manager.execute(f.query, { ...request, token: review.token, confirmName: 'DEMO_PDB' }, f.options), /expired/);
  const g = fixture(), original = await g.request('mode', { mode: 'READ ONLY' }), plan = await g.manager.review(g.query, original, g.options);
  await assert.rejects(g.manager.execute(g.query, { ...original, mode: 'READ WRITE', token: plan.token }, g.options), /conflict/);
});
test('All source datafile and tempfile directories require explicit non-overlapping conversion coverage', async () => {
  const f = fixture(); f.omf = false;
  const base = { action: 'create', name: 'NEW_PDB', user: 'ADMIN', pathMode: 'convert', conversions: [{ source: '/data/a/', destination: '/new/a/' }] };
  await assert.rejects(f.manager.review(f.query, base, f.options), /incomplete/);
  base.conversions.push({ source: '/data/b/', destination: "/new/owner's/" });
  const review = await f.manager.review(f.query, base, f.options);
  await f.manager.execute(f.query, { ...base, token: review.token, password: "pass'word" }, f.options);
  assert.ok(writes(f)[0][0].includes("'/new/owner''s/'"));
  await assert.rejects(f.manager.review(f.query, { ...base, conversions: [...base.conversions, { source: '/data/a/sub/', destination: '/x/' }] }, f.options), /invalid_path/);
});
test('Incompatible XML never removes a catalog entry and read failures never mean an absent PDB', async () => {
  const f = fixture(); f.rows[1].STATUS = 'UNPLUGGED'; f.compatible = false;
  const request = await f.request('plugin', { name: 'DEMO_PDB', path: "/server/owner's.xml" });
  const review = await f.manager.review(f.query, request, f.options); assert.equal(review.canExecute, false); assert.equal(review.token, ''); assert.equal(writes(f).length, 0);
  f.failList = true; await assert.rejects(f.manager.review(f.query, request, f.options)); assert.equal(writes(f).length, 0);
});
test('Partial plug-in failure reports removed catalog and a fresh review contains only the remaining attachment', async () => {
  const f = fixture(); f.rows[1].STATUS = 'UNPLUGGED'; f.failAttach = true;
  const request = await f.request('plugin', { name: 'DEMO_PDB', path: "/server/owner's.xml" });
  const error = await f.run(request).catch(safeError); assert.equal(error.stage, 'catalog_removed'); assert.ok(!JSON.stringify(error).includes('SECRET'));
  assert.equal(writes(f)[0][0], 'DROP PLUGGABLE DATABASE "DEMO_PDB" KEEP DATAFILES');
  const review = await f.manager.review(f.query, { action: 'plugin', name: 'DEMO_PDB', path: request.path }, f.options);
  assert.deepEqual(review.stages, ['attach']);
});
test('Passwords never appear in reviews/errors and only verified local users can be changed', async () => {
  const f = fixture(); f.rows[1].OPEN_MODE = 'READ WRITE';
  const request = await f.request('password', { user: 'APP_USER', password: 'SECRET_SENTINEL' });
  const review = await f.manager.review(f.query, request, f.options); assert.ok(!JSON.stringify(review).includes('SECRET_SENTINEL'));
  await assert.rejects(f.manager.execute(f.query, { ...request, token: review.token, password: 'bad"password' }, f.options), /invalid_password/);
  await f.manager.execute(f.query, { ...request, token: review.token, password: 'new-password' }, f.options);
  assert.ok(writes(f)[0][0].startsWith('ALTER USER "APP_USER"')); assert.equal(f.container, 'CDB$ROOT');
  await assert.rejects(f.manager.review(f.query, await f.request('password', { user: 'C##COMMON' }), f.options), /invalid_user/);
});
test('Failed post-DDL verification marks the result applied and consumes the review', async () => {
  const f = fixture(); const request = await f.request('open'); f.failAfter = true;
  const review = await f.manager.review(f.query, request, f.options);
  const error = await f.manager.execute(f.query, { ...request, token: review.token }, f.options).catch(safeError);
  assert.equal(error.applied, true); assert.equal(error.stage, 'applied');
  await assert.rejects(f.manager.execute(f.query, { ...request, token: review.token }, f.options), /expired/); assert.equal(writes(f).length, 1);
});
test('Failed refresh keeps the last snapshot but disables every operation until retry', async () => {
  const f = fixture(), h = await createPdbHarness(f.invoke); f.failList = true;
  await h.state.reload(); await h.flush(); assert.equal(h.state.snapshot.pdbs.length, 2); assert.equal(h.state.ready, false); assert.equal(h.state.can('create'), false);
  f.failList = false; await h.state.reload(); await h.flush(); assert.equal(h.state.ready, true); h.unmount();
});
test('Review cancellation clears credentials and changing fields invalidates a previous review', async () => {
  const f = fixture(), h = await opened(f, 'password'); // Mounted targets cannot open this dialog.
  assert.equal(h.state.dialog, false); f.rows[1].OPEN_MODE = 'READ WRITE'; await h.state.reload(); await h.flush();
  await h.state.open('password'); await h.flush(); assert.equal(h.state.draft.user, '');
  h.state.update({ user: 'APP_USER', password: 'SECRET_SENTINEL' }); await h.flush(); await h.state.prepare(); await h.flush();
  assert.ok(h.state.review); assert.ok(!JSON.stringify(f.requests.find(([channel]) => channel === 'review-oracle-pdb-operation')).includes('SECRET_SENTINEL'));
  h.state.update({ user: 'OTHER' }); await h.flush(); assert.equal(h.state.review, null);
  h.state.close(); await h.flush(); assert.equal(h.state.draft.password, ''); assert.equal(writes(f).length, 0); h.unmount();
});
test('Typed-name confirmation, acknowledgment and duplicate guards allow exactly one destructive command', async () => {
  const f = fixture(), h = await opened(f); await h.state.prepare(); await h.flush();
  assert.equal(h.state.canExecute, false); h.state.setDraft(previous => ({ ...previous, acknowledged: true, confirmName: 'wrong' })); await h.flush(); assert.equal(h.state.canExecute, false);
  h.state.setDraft(previous => ({ ...previous, confirmName: 'DEMO_PDB' })); await h.flush();
  await Promise.all([h.state.execute(), h.state.execute()]); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(h.state.dialog, false); h.unmount();
});
test('Completed command with failed verification blocks repeats and preserves safe draft fields for read-only retry', async () => {
  const f = fixture(), h = await opened(f, 'open'); await h.state.prepare(); await h.flush(); h.state.setDraft(previous => ({ ...previous, acknowledged: true })); await h.flush();
  f.failAfter = true; await h.state.execute(); await h.flush(); assert.equal(h.state.stage, 'applied'); assert.equal(h.state.ready, false); assert.equal(h.state.review, null);
  await h.state.execute(); assert.equal(writes(f).length, 1);
  f.failList = false; await h.state.reload(); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(h.state.ready, true); h.unmount();
});
test('Hidden tabs clear passwords and ignore outstanding responses; hidden search selections cannot be acted upon', async () => {
  const f = fixture(), h = await opened(f); h.state.setDraft(previous => ({ ...previous, password: 'SECRET_SENTINEL' })); await h.flush();
  h.updateActive(false); await h.flush(); assert.equal(h.state.draft.password, ''); assert.equal(h.state.dialog, false); assert.equal(h.state.ready, false);
  h.updateActive(true); await h.flush(); h.state.setSearch('missing'); await h.flush(); assert.equal(h.state.selected, null); assert.equal(h.state.can('drop'), false); h.unmount();
});
test('PDB IPC refuses other database types, sanitizes errors and never overwrites main transaction state', async () => {
  const { createDatabaseIpc } = require('./helpers/ddlEditors.cjs');
  const client = { inspectPdbAccess: async () => ({ common: false }), listManagedPdbs: async () => { throw Object.assign(new Error('PASSWORD_SECRET_SENTINEL'), { code: 'ORA-01031', pdbStage: 'applied' }); } };
  const invoke = createDatabaseIpc(client, 'oracle');
  const error = await invoke('list-oracle-pdbs'); assert.equal(error.success, false); assert.equal(error.errorCode, 'ORA-01031'); assert.equal(error.applied, true);
  assert.equal(Object.hasOwn(error, 'hasUncommittedTx'), false); assert.ok(!JSON.stringify(error).includes('PASSWORD_SECRET_SENTINEL'));
  assert.equal((await createDatabaseIpc(client, 'postgresql')('inspect-oracle-pdb-access')).success, false);
});
test('Dedicated operations use the main connection only for a serialized identity read and never execute administration on the main/pool connection and main-process guards block duplicate mutations', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const f = fixture(), connections = [];
  const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } },
    oracledb: { ...require('oracledb'), getConnection: async () => {
      const connection = { execute: f.query, close: async () => { connection.closed = true; } }; connections.push(connection); return connection;
    } } }, {}, { strict: false });
  const client = new Client(); client.connection = { execute: async sql => { assert.equal(sql, IDENTITY_SQL); return { rows: [{ CON_NAME: 'CDB$ROOT' }] }; } }; client.bgPool = [{ conn: { execute: () => assert.fail('The pool must not execute PDB SQL') } }];
  client.dbLinkConnectOptions = { connectString: 'mock-only' };
  const snapshot = await client.listManagedPdbs(), request = { action: 'open', target: 'DEMO_PDB', expected: snapshot.pdbs[1].fingerprint };
  const review = await client.reviewPdbOperation(request); f.hold = true;
  const pending = client.executePdbOperation({ ...request, token: review.token });
  while (!f.release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(client.executePdbOperation({ ...request, token: review.token }), /busy/);
  f.release(); await pending; assert.equal(connections.length, 3); assert.ok(connections.every(connection => connection.closed)); assert.equal(writes(f).length, 1);
});
test('A connection close failure after successful DDL reports the applied stage without repeating SQL', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const f = fixture(); let failClose = false;
  const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } }, oracledb: { ...require('oracledb'), getConnection: async () => ({ execute: f.query, close: async () => { if (failClose) throw new Error('close secret'); } }) } }, {}, { strict: false });
  const client = new Client(); client.connection = { execute: async sql => { assert.equal(sql, IDENTITY_SQL); return { rows: [{ CON_NAME: 'CDB$ROOT' }] }; } }; client.dbLinkConnectOptions = {};
  const snapshot = await client.listManagedPdbs(), request = { action: 'open', target: 'DEMO_PDB', expected: snapshot.pdbs[1].fingerprint };
  const review = await client.reviewPdbOperation(request); failClose = true;
  const error = await client.executePdbOperation({ ...request, token: review.token }).catch(safeError);
  assert.equal(error.applied, true); assert.equal(error.stage, 'applied'); assert.equal(writes(f).length, 1);
});
test('Inactive generations ignore late list and review responses, and a new activation revalidates', async () => {
  const f = fixture(); let hold = false, finish, holdChannel = 'list-oracle-pdbs';
  const h = await createPdbHarness((channel, request) => hold && channel === holdChannel ? new Promise(resolve => { finish = resolve; }) : f.invoke(channel, request));
  hold = true; const pending = h.state.reload(); await new Promise(resolve => setImmediate(resolve));
  h.updateActive(false); await h.flush(); hold = false; h.updateActive(true); await h.flush();
  assert.equal(h.state.rows.length, 2); finish({ success: true, context: {}, pdbs: [], seedFiles: [] }); await pending; await h.flush(); assert.equal(h.state.rows.length, 2);
  h.state.setSelectedId('demo'); await h.flush(); await h.state.open('drop'); await h.flush();
  hold = true; holdChannel = 'review-oracle-pdb-operation';
  const preparation = h.state.prepare(); await new Promise(resolve => setImmediate(resolve));
  h.updateActive(false); await h.flush(); hold = false; h.updateActive(true); await h.flush();
  finish({ success: true, token: 'late-review', request: {}, target: null, stages: [], datafiles: [], compatibility: null, canExecute: true });
  await preparation; await h.flush(); assert.equal(h.state.review, null); assert.equal(h.state.dialog, false);
  h.unmount();
});
