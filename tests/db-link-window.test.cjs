// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const service = require('../electron/oracle/databaseLink');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { createDbLinkHarness } = require('./helpers/dbLinkData.cjs');
function fixture() {
  const f = { calls: [], exists: true, auth: 'fixed', password: 'SECRET_SENTINEL', username: 'TEST', host: "server/service's", owner: 'TEST', name: 'DEMO.EXAMPLE', revision: '1', fail: false, rejectCreate: false, rejectDrop: false, hold: false, release: null };
  f.query = async (sql, binds) => {
    f.calls.push([sql, binds]);
    if (sql.includes('AS LINK_USER')) return { rows: [{ LINK_USER: 'TEST', LINK_DOMAIN: 'EXAMPLE' }] };
    if (sql.includes('FROM SESSION_PRIVS')) return { rows: ['CREATE DATABASE LINK', 'CREATE PUBLIC DATABASE LINK', 'ALTER DATABASE LINK', 'ALTER PUBLIC DATABASE LINK', 'DROP PUBLIC DATABASE LINK'].map(PRIVILEGE => ({ PRIVILEGE })) };
    if (sql.includes('FROM ALL_DB_LINKS')) {
      if (f.fail) throw new Error('SECRET_SENTINEL metadata unavailable');
      return { rows: f.exists && binds.owner === f.owner && binds.name === f.name ? [{ OWNER: f.owner, DB_LINK: f.name, USERNAME: f.auth === 'unknown' ? null : f.username, HOST: f.host, CREATED_TEXT: f.revision }] : [] };
    }
    if (sql.includes('GET_DDL')) return { rows: [{ DDL: `CREATE ${f.auth === 'shared' ? 'SHARED ' : ''}DATABASE LINK "${f.name}" ${f.auth === 'unknown' ? '' : 'CONNECT TO "TEST" IDENTIFIED BY "' + f.password + '"'} USING 'host'` }] };
    if (sql.startsWith('DROP')) { if (f.rejectDrop) throw new Error('DROP denied'); f.exists = false; return { rows: [] }; }
    if (sql.startsWith('CREATE')) {
      if (f.rejectCreate) throw Object.assign(new Error('ORA-12154: SECRET_SENTINEL rejected SQL'), { code: 'ORA-12154' });
      f.exists = true; f.name = /DATABASE LINK (\S+)/.exec(sql)[1]; f.username = /CONNECT TO "([^"]+)"/.exec(sql)[1]; f.host = /USING '((?:''|[^'])*)'/.exec(sql)[1].replaceAll("''", "'"); f.revision += 'n'; if (f.failAfterWrite) f.fail = true; return { rows: [] };
    }
    if (sql.startsWith('ALTER')) { f.revision += 'a'; if (f.failAfterWrite) f.fail = true; return { rows: [] }; }
    if (sql.startsWith('SELECT 1 AS LINK_OK')) return { rows: [{ LINK_OK: 1 }] };
    throw new Error('Unexpected database link query');
  };
  f.invoke = async (channel, request) => {
    try {
      if (channel === 'get-oracle-dblink') {
        const result = { success: true, ...await service.getLink(f.query, request) };
        if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve(result); }); }
        return result;
      }
      if (channel === 'save-oracle-dblink') return { success: true, ...await service.saveLink(f.query, request) };
      if (channel === 'test-oracle-dblink') return { success: true, ...await service.testLink(f.query, request) };
      throw new Error('Unexpected channel');
    } catch (error) { return { success: false, ...service.safeError(error) }; }
  };
  return f;
}
const identity = { schema: 'TEST', name: 'DEMO.EXAMPLE' };
const edit = async (h, values) => { h.state.setFormData(current => ({ ...current, ...values })); await h.flush(); };
const writes = f => f.calls.filter(([sql]) => /^(CREATE|ALTER|DROP) /.test(sql));
test('SQL builders preserve apostrophes and quoted usernames, reject appended SQL and never put passwords in renderer SQL', () => {
  const model = loadTypeScript('src/features/oracle/dbLinkDefinition.ts');
  const context = { user: 'TEST', domain: '', createPrivate: true, createPublic: true, alterPrivate: true, alterPublic: true };
  const form = { name: 'demo.example', username: '"MixedUser"', password: 'SECRET_SENTINEL', host: "service's", isPublic: false };
  const plan = model.dbLinkPlan(form, context, null);
  assert.equal(plan.error, ''); assert.ok(plan.sql.includes('"MixedUser"')); assert.ok(plan.sql.includes("service''s")); assert.ok(!plan.sql.includes(form.password));
  assert.ok(service.createSql(service.checkedForm(form)).includes("service''s"));
  assert.equal(service.checkedForm({ ...form, host: '(DESCRIPTION=\n\t(ADDRESS=(HOST=db)))' }).host.includes('\n'), true);
  assert.equal(model.dbLinkPlan({ ...form, password: 'あ'.repeat(43) }, context, null).error, 'dblink_invalid_password');
  assert.throws(() => service.checkedForm({ ...form, password: 'あ'.repeat(43) }));
  assert.throws(() => service.checkedForm({ ...form, name: 'DEMO;DROP TABLE X' }));
  assert.throws(() => service.checkedForm({ ...form, password: 'bad"password' }));
  assert.throws(() => service.checkedForm({ ...form, host: 'service\0' }));
  assert.equal(service.userName('normal'), 'NORMAL'); assert.equal(service.userName('"Mixed"'), 'Mixed');
  assert.equal(service.safeError(new Error('SECRET_SENTINEL raw SQL')).error, 'dblink_operation_failed');
  assert.ok(!JSON.stringify(service.safeError(new Error('SECRET_SENTINEL raw SQL'))).includes('SECRET_SENTINEL'));
});
test('Native metadata is classified conservatively and raw credentials are never returned', async () => {
  const f = fixture();
  const result = await service.getLink(f.query, identity);
  assert.equal(result.link.auth, 'fixed'); assert.ok(result.link.source.includes('********')); assert.ok(!JSON.stringify(result).includes(f.password));
  for (const auth of ['shared', 'unknown']) { f.auth = auth; assert.equal((await service.getLink(f.query, identity)).link.editable, false); }
  f.auth = 'fixed'; f.query = async sql => {
    if (sql.includes('AS LINK_USER')) return { rows: [{ LINK_USER: 'TEST' }] };
    if (sql.includes('SESSION_PRIVS')) return { rows: [] };
    if (sql.includes('ALL_DB_LINKS')) return { rows: [{ OWNER: 'TEST', DB_LINK: 'DEMO.EXAMPLE', USERNAME: 'TEST', HOST: 'db' }] };
    throw new Error('DDL invisible');
  };
  assert.equal((await service.getLink(f.query, identity)).link.editable, false);
});
test('Invalid creation is rejected before requests, existing names never drop, and owner/read-only restrictions are enforced', async () => {
  const f = fixture(), form = { name: identity.name, username: 'TEST', password: 'SECRET_SENTINEL', host: 'db', isPublic: false };
  await assert.rejects(service.saveLink(f.query, { ...identity, action: 'create', form: { ...form, password: 'bad"' } })); assert.equal(f.calls.length, 0);
  await assert.rejects(service.saveLink(f.query, { ...identity, action: 'create', form }), /dblink_exists/); assert.equal(writes(f).length, 0);
  await assert.rejects(service.saveLink(f.query, { ...identity, schema: 'OTHER', action: 'create', form }), /owner_restricted/);
  await assert.rejects(service.saveLink(f.query, { ...identity, action: 'create', form }, true), /readonly/);
});
test('Password-only updates issue ALTER without DROP and actual changes require explicit recreation approval', async () => {
  const f = fixture(), current = (await service.getLink(f.query, identity)).link;
  const form = { name: current.name, username: current.username, host: current.host, password: 'NEW_SECRET_SENTINEL', isPublic: false };
  f.calls.length = 0;
  const updated = await service.saveLink(f.query, { ...identity, action: 'save', expected: current.fingerprint, form });
  assert.equal(updated.phase, 'altered'); assert.equal(writes(f).length, 1); assert.match(writes(f)[0][0], /^ALTER DATABASE LINK/);
  await assert.rejects(service.saveLink(f.query, { ...identity, action: 'save', expected: updated.link.fingerprint, form: { ...form, host: 'other' } }), /recreate_required/);
  assert.equal(writes(f).length, 1);
});
test('DROP failure stops creation, while recreation failure reports the missing link without replay or credential leakage', async () => {
  for (const rejectDrop of [true, false]) {
    const f = fixture(), current = (await service.getLink(f.query, identity)).link;
    f.rejectDrop = rejectDrop; f.rejectCreate = true; f.calls.length = 0;
    let error;
    try { await service.saveLink(f.query, { ...identity, action: 'save', expected: current.fingerprint, confirmRecreate: true, form: { name: current.name, username: 'TEST', host: 'other', password: 'SECRET_SENTINEL', isPublic: false } }); } catch (failure) { error = failure; }
    assert.ok(error); assert.equal(f.exists, rejectDrop); assert.equal(writes(f).length, rejectDrop ? 1 : 2);
    assert.equal(service.safeError(error).phase, rejectDrop ? undefined : 'dropped-only');
    assert.ok(!JSON.stringify(service.safeError(error)).includes('SECRET_SENTINEL'));
  }
});
test('Missing or concurrent link definitions block updates/deletion, and PUBLIC shadowing blocks remote tests', async () => {
  const f = fixture(), current = (await service.getLink(f.query, identity)).link;
  f.host = 'external'; await assert.rejects(service.saveLink(f.query, { ...identity, action: 'drop', expected: current.fingerprint }), /conflict/); assert.equal(writes(f).length, 0);
  f.exists = false; await assert.rejects(service.saveLink(f.query, { ...identity, action: 'drop', expected: current.fingerprint }), /conflict/);
  const p = fixture(); p.owner = 'PUBLIC'; const pub = (await service.getLink(p.query, { ...identity, schema: 'PUBLIC' })).link;
  const original = p.query; p.query = (sql, binds) => sql.includes('ALL_DB_LINKS') && binds.owner === 'TEST' ? Promise.resolve({ rows: [{ OWNER: 'TEST', DB_LINK: p.name, USERNAME: 'TEST', HOST: 'private' }] }) : original(sql, binds);
  await assert.rejects(service.testLink(p.query, { ...identity, schema: 'PUBLIC', expected: pub.fingerprint }), /shadowed/);
  assert.equal(p.calls.some(([sql]) => sql.startsWith('SELECT 1 AS LINK_OK')), false);
});
test('Initial metadata failure blocks mutations and retry preserves edited fields and masked source', async () => {
  const f = fixture(); f.fail = true; const h = await createDbLinkHarness(f.invoke);
  try {
    assert.equal(h.state.ready, false); await h.state.execute(); await h.state.execute(true); assert.equal(writes(f).length, 0);
    f.fail = false; h.state.retry(); await h.flush(); assert.equal(h.state.ready, true);
    await edit(h, { host: 'draft', password: 'SECRET_SENTINEL' }); f.fail = true; h.state.retry(); await h.flush(); assert.equal(h.state.ready, false); assert.equal(h.state.form.host, 'draft');
    f.fail = false; h.state.retry(); await h.flush(); assert.equal(h.state.form.host, 'draft'); assert.equal(h.state.form.password, 'SECRET_SENTINEL'); assert.ok(!h.state.saved.source.includes('SECRET_SENTINEL'));
  } finally { h.unmount(); }
});
test('A no-op save sends no request, and password saves clear input while source, copies and logs remain masked', async () => {
  const f = fixture(), h = await createDbLinkHarness(f.invoke);
  try {
    f.calls.length = 0; await h.state.execute(); assert.equal(f.calls.length, 0);
    await edit(h, { password: 'SECRET_SENTINEL' }); await h.state.copy('pending'); await h.state.copy('saved');
    await h.state.execute(); await h.flush(); assert.equal(h.state.form.password, ''); assert.equal(writes(f).length, 1);
    assert.ok(!JSON.stringify({ logs: h.state.logs, copies: h.copies, source: h.state.saved.source, plan: h.state.plan }).includes('SECRET_SENTINEL'));
    assert.equal(h.state.canExecute, false);
  } finally { h.unmount(); }
});
test('Existing identity remains fixed and cancelled recreation/deletion performs no write', async () => {
  const f = fixture(), h = await createDbLinkHarness(f.invoke, {}, { confirm: () => false });
  try {
    await edit(h, { name: 'WRONG', isPublic: true, host: 'draft', password: 'SECRET_SENTINEL' }); assert.equal(h.state.form.name, identity.name); assert.equal(h.state.form.isPublic, false);
    f.calls.length = 0; await h.state.execute(); await h.state.execute(true); assert.equal(f.calls.length, 0); assert.ok(h.confirmations.every(message => message.includes(identity.name)));
  } finally { h.unmount(); }
});
test('Partial recreation can only be retried explicitly, and another existing link is never overwritten', async () => {
  const f = fixture(), h = await createDbLinkHarness(f.invoke);
  try {
    await edit(h, { host: 'draft', password: 'SECRET_SENTINEL' }); f.rejectCreate = true;
    await h.state.execute(); await h.flush(); assert.equal(h.state.phase, 'dropped-only'); assert.equal(h.state.ready, false); assert.equal(f.exists, false);
    f.rejectCreate = false; const count = writes(f).length; await h.flush(); assert.equal(writes(f).length, count);
    await h.state.execute(); await h.flush(); assert.equal(f.exists, true); assert.equal(h.state.error, ''); assert.equal(writes(f).filter(([sql]) => sql.startsWith('DROP')).length, 1);
  } finally { h.unmount(); }
});
test('Duplicate save requests perform one ALTER and stale metadata cannot replace a different opened link', async () => {
  const f = fixture(), h = await createDbLinkHarness(f.invoke);
  try {
    await edit(h, { password: 'SECRET_SENTINEL' }); const first = h.state.execute(); await h.state.execute(); await first; await h.flush(); assert.equal(writes(f).length, 1);
    f.hold = true; h.state.retry(); await h.flush(); f.name = 'OTHER.EXAMPLE'; h.update({ dbLinkName: f.name }); await h.flush(); f.release(); await h.flush(); assert.equal(h.state.saved.name, 'OTHER.EXAMPLE');
  } finally { h.unmount(); }
});
test('Connection test is explicit, targets saved settings despite edits, and clipboard errors stay visible', async () => {
  const f = fixture(), h = await createDbLinkHarness(f.invoke, {}, { failCopy: true });
  try {
    assert.equal(f.calls.some(([sql]) => sql.startsWith('SELECT 1 AS LINK_OK')), false);
    await edit(h, { host: 'pending' }); await h.state.testConnection(); await h.flush(); assert.equal(typeof h.state.testResult, 'number');
    assert.ok(f.calls.find(([sql]) => sql.startsWith('SELECT 1 AS LINK_OK'))[0].endsWith('DUAL@DEMO.EXAMPLE'));
    await h.state.copy('saved'); await h.flush(); assert.equal(h.state.error, 'dblink_copy_failed');
  } finally { h.unmount(); }
});
test('An external collision blocks retry after partial recreation without removing the replacement link', async () => {
  const f = fixture(), h = await createDbLinkHarness(f.invoke);
  try {
    await edit(h, { host: 'draft', password: 'SECRET_SENTINEL' }); f.rejectCreate = true;
    await h.state.execute(); await h.flush(); assert.equal(h.state.phase, 'dropped-only');
    f.exists = true; f.rejectCreate = false; const before = writes(f).length;
    await h.state.execute(); await h.flush(); assert.equal(h.state.error, 'dblink_exists'); assert.equal(writes(f).length, before); assert.equal(f.exists, true);
  } finally { h.unmount(); }
});
test('Successful mutations followed by failed metadata reads clear the password and reload without repeating DDL', async () => {
  for (const isNew of [false, true]) {
    const f = fixture(); f.exists = !isNew;
    const h = await createDbLinkHarness(f.invoke, { isNew });
    try {
      await edit(h, { name: identity.name, username: 'TEST', password: 'SECRET_SENTINEL', host: f.host }); f.failAfterWrite = true;
      await h.state.execute(); await h.flush(); assert.equal(h.state.ready, false); assert.equal(h.state.form.password, '');
      assert.equal(h.state.phase, isNew ? 'created' : 'altered'); assert.equal(writes(f).length, 1);
      f.fail = false; h.state.retry(); await h.flush(); assert.equal(h.state.ready, true); assert.equal(writes(f).length, 1); assert.equal(h.state.canExecute, false);
      if (isNew) assert.ok(h.events.some(event => event.type === 'dblink-created'));
    } finally { h.unmount(); }
  }
});
test('The production connection test owns a disposable session and closes it on both success and remote failure', async () => {
  for (const remoteFailure of [false, true]) {
    const f = fixture(), metadata = (await service.getLink(f.query, identity)).link;
    let closes = 0;
    const connection = { execute: (sql, binds) => {
      if (remoteFailure && sql.startsWith('SELECT 1 AS LINK_OK')) throw new Error('Remote authentication failed');
      return f.query(sql, binds);
    }, close: async () => { closes++; } };
    const OracleClient = loadModule('electron/oracle/oracleClient.js', {
      electron: { app: { isPackaged: true } }, '../services/settings': { getCurrentSettings: () => ({}) },
      oracledb: { getConnection: async () => connection, OUT_FORMAT_OBJECT: 4002 }
    }, {}, { strict: false });
    const client = new OracleClient(); client.connection = { transactionInProgress: true }; client.dbLinkConnectOptions = { connectString: 'local-test-only' };
    const request = { ...identity, expected: metadata.fingerprint };
    if (remoteFailure) await assert.rejects(client.testDatabaseLink(request));
    else assert.equal(typeof (await client.testDatabaseLink(request)).elapsedMs, 'number');
    assert.equal(connection.callTimeout, 15000); assert.equal(closes, 1); assert.equal(client.connection.transactionInProgress, true);
  }
});
