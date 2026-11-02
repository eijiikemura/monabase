// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const service = require('../electron/oracle/objectPrivileges');
const { createObjectPrivilegeHarness } = require('./helpers/objectPrivilegeData.cjs');
function fixture() {
  const f = { target: { owner: 'Te\'st', name: 'Mi"x\'ed', type: 'TABLE' }, calls: [], grants: [], columns: [], visible: false, failRead: false, failAfter: false, revision: '1', requests: [], hold: false };
  f.query = async (sql, binds = {}) => {
    f.calls.push([sql, binds]);
    if (sql.includes('AS PRIV_USER')) return { rows: [{ PRIV_USER: f.user || f.target.owner }] };
    if (sql.includes('SESSION_PRIVS')) return { rows: f.grantAny ? [{ PRIVILEGE: 'GRANT ANY OBJECT PRIVILEGE' }] : [] };
    if (f.visible && /FROM DBA_/.test(sql)) throw Object.assign(new Error('Dictionary denied'), { errorNum: 942 });
    if (sql.includes('_OBJECTS')) {
      if (f.failRead) throw new Error('Read failed');
      assert.equal(binds.owner, f.target.owner); assert.equal(binds.name, f.target.name); assert.equal(binds.type, f.target.type);
      assert.ok(!sql.includes(f.target.name));
      return { rows: [{ ID: f.revision, DDL_TIME: 'now' }] };
    }
    if (sql.includes('_MVIEWS')) return { rows: [{ UPDATABLE: f.updatable ? 'Y' : 'N' }] };
    if (sql.includes('_TAB_PRIVS')) { assert.ok(sql.includes('TYPE = :type')); return { rows: f.grants.map(row => ({ ...row })) }; }
    if (sql.includes('_COL_PRIVS')) return { rows: f.columns };
    if (sql.includes('ALL_USERS')) return { rows: [{ NAME: f.target.owner, ORACLE_MAINTAINED: 'N' }, { NAME: 'APP_USER', ORACLE_MAINTAINED: 'N' }] };
    if (/DBA_ROLES|USER_ROLE_PRIVS/.test(sql)) return { rows: [{ NAME: 'READER', ORACLE_MAINTAINED: 'N' }] };
    if (/^(GRANT|REVOKE) /.test(sql)) {
      if (sql.startsWith('GRANT')) f.grants.push({ GRANTEE: 'PUBLIC', GRANTOR: f.target.owner, PRIVILEGE: 'SELECT', GRANTABLE: 'NO', COMMON: 'NO', INHERITED: 'NO' });
      else f.grants = [];
      if (f.failAfter) f.failRead = true;
      return { rows: [] };
    }
    throw new Error('Unexpected privilege query');
  };
  f.invoke = async (channel, request) => {
    f.requests.push([channel, request]);
    try {
      if (channel === 'list-oracle-privilege-principals') return { success: true, ...await service.listPrincipals(f.query) };
      if (channel === 'get-oracle-object-privileges') {
        const result = { success: true, detail: await service.readPrivileges(f.query, request) };
        if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve(result); }); }
        return result;
      }
      return { success: true, ...await service.mutatePrivileges(f.query, request) };
    } catch (error) { return { success: false, ...service.safeError(error) }; }
  };
  f.request = async (extra = {}) => ({ action: 'grant', object: f.target, grantee: 'PUBLIC', privilege: 'SELECT', expected: (await service.readPrivileges(f.query, f.target)).fingerprint, ...extra });
  return f;
}
const writes = f => f.calls.filter(([sql]) => /^(GRANT|REVOKE) /.test(sql));
async function harness(f, options) { const h = await createObjectPrivilegeHarness(f.invoke, options); h.state.select(f.target); await h.flush(); return h; }
test('Exact object identity uses binds including type, and the owner has no fabricated grants', async () => {
  const f = fixture(), detail = await service.readPrivileges(f.query, f.target);
  assert.deepEqual(detail.grants, []); assert.equal(detail.canGrant.SELECT, true);
  await service.mutatePrivileges(f.query, await f.request());
  assert.equal(writes(f)[0][0], 'GRANT SELECT ON "Te\'st"."Mi""x\'ed" TO PUBLIC');
});
test('Only dictionary permission errors fall back and visibility is explicit', async () => {
  const f = fixture(); f.visible = true;
  assert.equal((await service.readPrivileges(f.query, f.target)).scope, 'visible');
  const list = await service.listPrincipals(f.query); assert.equal(list.rolesComplete, false);
  assert.ok(list.principals.some(row => row.kind === 'public')); assert.ok(list.principals.some(row => row.kind === 'role'));
  f.visible = false; f.failRead = true; f.calls = [];
  await assert.rejects(service.readPrivileges(f.query, f.target)); assert.equal(f.calls.filter(([sql]) => sql.includes('FROM ALL_OBJECTS')).length, 0);
});
test('Invalid requests and read-only connections never execute changes', async () => {
  const f = fixture();
  for (const extra of [{ privilege: 'DBA' }, { object: { ...f.target, type: 'constructor' } }, { grantee: 'bad\0' }, { action: 'drop' }]) {
    await assert.rejects(service.mutatePrivileges(f.query, await f.request(extra)));
  }
  await assert.rejects(service.mutatePrivileges(f.query, await f.request(), true), /readonly/); assert.equal(writes(f).length, 0);
});
test('Changed object identity or grants prevent writes', async () => {
  const f = fixture(), request = await f.request(); f.revision = '2';
  await assert.rejects(service.mutatePrivileges(f.query, request), /conflict/); assert.equal(writes(f).length, 0);
});
test('Mixed grantors, grant options, inherited grants and column privileges are protected', async () => {
  for (const extra of [{ GRANTOR: 'OTHER' }, { GRANTABLE: 'YES' }, { INHERITED: 'YES' }, { HIERARCHY: 'YES' }, { COMMON: 'YES' }]) {
    const f = fixture(); f.grants = [{ GRANTEE: 'PUBLIC', GRANTOR: f.target.owner, PRIVILEGE: 'SELECT', GRANTABLE: 'NO', ...extra }];
    await assert.rejects(service.mutatePrivileges(f.query, await f.request({ action: 'revoke' })), /restricted/); assert.equal(writes(f).length, 0);
  }
  const f = fixture(); f.columns = [{ GRANTEE: 'PUBLIC', GRANTOR: f.target.owner, COLUMN_NAME: 'C', PRIVILEGE: 'UPDATE', GRANTABLE: 'NO' }];
  await assert.rejects(service.mutatePrivileges(f.query, await f.request({ privilege: 'UPDATE' })), /restricted/);
  await assert.rejects(service.mutatePrivileges(f.query, await f.request({ privilege: 'REFERENCES', grantee: 'READER' })), /restricted/);
});
test('Successful changes reread actual grants, and failed rereads retain the applied result', async () => {
  const f = fixture(), result = await service.mutatePrivileges(f.query, await f.request());
  assert.equal(result.applied, true); assert.equal(result.detail.grants[0].grantee, 'PUBLIC');
  const request = await f.request({ action: 'revoke' }); f.failAfter = true;
  const error = await service.mutatePrivileges(f.query, request).catch(service.safeError);
  assert.equal(error.applied, true); assert.equal(error.error, 'object_priv_operation_failed');
});
test('Failed refresh preserves the snapshot and disables editing until retry succeeds', async () => {
  const f = fixture(), h = await harness(f); assert.equal(h.state.editable('PUBLIC', 'SELECT'), true);
  f.failRead = true; await h.state.reload(); await h.flush(); assert.ok(h.state.detail); assert.equal(h.state.ready, false); assert.equal(h.state.editable('PUBLIC', 'SELECT'), false);
  f.failRead = false; await h.state.reload(); await h.flush(); assert.equal(h.state.ready, true); h.unmount();
});
test('Confirmation cancellation performs no write and explains main transaction commit', async () => {
  const f = fixture(), h = await harness(f, { confirm: () => false }); await h.state.change('PUBLIC', 'SELECT', true); await h.flush();
  assert.equal(writes(f).length, 0); assert.ok(h.confirmations[0].includes('object_priv_commit_warning')); assert.ok(h.confirmations[0].includes('object_priv_public_warning')); h.unmount();
});
test('Duplicate clicks send one command, and applied reread failures cannot repeat it', async () => {
  const f = fixture(), h = await harness(f); f.failAfter = true;
  await Promise.all([h.state.change('PUBLIC', 'SELECT', true), h.state.change('PUBLIC', 'SELECT', true)]); await h.flush();
  assert.equal(writes(f).length, 1); assert.equal(h.state.applied, true); assert.equal(h.state.ready, false);
  await h.state.change('PUBLIC', 'SELECT', true); assert.equal(writes(f).length, 1); h.unmount();
});
test('Responses from an inactive tab are ignored and activation retries verification', async () => {
  const f = fixture(), h = await harness(f); f.hold = true;
  const pending = h.state.reload(); await new Promise(resolve => setImmediate(resolve));
  h.updateActive(false); await h.flush(); f.release(); await pending; await h.flush(); assert.equal(h.state.ready, false);
  h.updateActive(true); await h.flush(); assert.equal(h.state.ready, true); h.unmount();
});
test('Switching targets ignores an older pending response', async () => {
  const f = fixture(), h = await harness(f); f.hold = true;
  const pending = h.state.reload(); await new Promise(resolve => setImmediate(resolve));
  h.updateActive(false); await h.flush(); f.target = { ...f.target, name: 'new' }; h.updateActive(true); await h.flush();
  // Selection remains locked while a request is active; once released, select the new object.
  f.release(); await pending; await h.flush(); h.state.select(f.target); await h.flush(); assert.equal(h.state.detail.object.name, 'new'); h.unmount();
});

test('Delegation requires a direct grant option and grant-any does not unlock another grantor revocation', async () => {
  const f = fixture(); f.user = 'OPERATOR';
  let request = await f.request(); await assert.rejects(service.mutatePrivileges(f.query, request), /restricted/);
  f.grants = [{ GRANTEE: 'OPERATOR', GRANTOR: f.target.owner, PRIVILEGE: 'SELECT', GRANTABLE: 'YES' }];
  request = await f.request(); await service.mutatePrivileges(f.query, request); assert.equal(writes(f).length, 1);
  f.grantAny = true; f.grants = [{ GRANTEE: 'PUBLIC', GRANTOR: f.target.owner, PRIVILEGE: 'SELECT', GRANTABLE: 'NO' }];
  await assert.rejects(service.mutatePrivileges(f.query, await f.request({ action: 'revoke' })), /restricted/);
});
test('Object privilege IPC returns actual transaction state only for mutations and sanitizes driver errors', async () => {
  const { createDatabaseIpc } = require('./helpers/ddlEditors.cjs');
  const f = fixture();
  const client = { getMainTransactionState: () => true, listObjectPrivilegePrincipals: () => service.listPrincipals(f.query),
    getObjectPrivileges: target => service.readPrivileges(f.query, target), mutateObjectPrivileges: async () => { throw Object.assign(new Error('secret driver SQL'), { code: 'ORA-01031' }); } };
  const invoke = createDatabaseIpc(client, 'oracle');
  const read = await invoke('get-oracle-object-privileges', f.target); assert.equal(read.success, true); assert.equal(Object.hasOwn(read, 'hasUncommittedTx'), false);
  const response = await invoke('mutate-oracle-object-privileges', {}); assert.equal(response.hasUncommittedTx, true); assert.equal(response.errorCode, 'ORA-01031'); assert.ok(!JSON.stringify(response).includes('secret'));
});

test('DML grants require an updatable materialized view verified by the main process', async () => {
  const f = fixture(); f.target.type = 'MATERIALIZED VIEW';
  assert.deepEqual((await service.readPrivileges(f.query, f.target)).privileges, ['SELECT']);
  await assert.rejects(service.mutatePrivileges(f.query, await f.request({ privilege: 'INSERT' })), /restricted/); assert.equal(writes(f).length, 0);
  f.updatable = true;
  assert.ok((await service.readPrivileges(f.query, f.target)).privileges.includes('INSERT'));
  const request = await f.request({ privilege: 'INSERT' }); f.updatable = false;
  await assert.rejects(service.mutatePrivileges(f.query, request), /restricted/);
});
