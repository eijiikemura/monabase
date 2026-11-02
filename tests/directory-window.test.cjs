// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createDirectoryHarness } = require('./helpers/directoryData.cjs');
const service = require('../electron/oracle/directoryDefinition');
function fixture() {
  const f = { calls: [], requests: [], failDirectories: false, failPrivileges: false, failUsers: false, visible: false, hold: false, release: null, failAfterWrite: false,
    directories: new Map(['DirA', 'DirB'].map((name, i) => [name, { OWNER: 'SYS', DIRECTORY_NAME: name, DIRECTORY_PATH: '/old/' + name, DIRECTORY_ID: String(i + 1), DDL_TIME: 'v1' }])),
    grants: [
      { GRANTEE: 'TEST', GRANTOR: 'SYS', PRIVILEGE: 'READ', GRANTABLE: 'YES' },
      { GRANTEE: 'TEST', GRANTOR: 'SYS', PRIVILEGE: 'WRITE', GRANTABLE: 'YES' },
      { GRANTEE: 'READER', GRANTOR: 'SYS', PRIVILEGE: 'READ', GRANTABLE: 'NO' },
      { GRANTEE: 'PUBLIC', GRANTOR: 'TEST', PRIVILEGE: 'READ', GRANTABLE: 'NO' }
    ] };
  f.query = async (sql, binds = {}) => {
    f.calls.push([sql, binds]);
    if (sql.includes('AS DIRECTORY_USER')) return { rows: [{ DIRECTORY_USER: 'TEST' }] };
    if (sql.includes('FROM SESSION_PRIVS')) return { rows: ['CREATE ANY DIRECTORY', 'DROP ANY DIRECTORY'].map(PRIVILEGE => ({ PRIVILEGE })) };
    if (sql.includes('FROM SESSION_ROLES')) return { rows: [{ ROLE: 'READER' }] };
    if (f.visible && /DBA_DIRECTORIES|DBA_ROLES|DBA_TAB_PRIVS/.test(sql)) throw Object.assign(new Error('Dictionary unavailable'), { code: 'ORA-00942' });
    if (sql.includes('_DIRECTORIES')) {
      if (f.failDirectories) throw Object.assign(new Error('Directory query disconnected'), { code: 'ORA-03113' });
      return { rows: [...f.directories.values()].filter(row => !binds.name || row.DIRECTORY_NAME === binds.name) };
    }
    if (sql.includes('FROM ALL_USERS')) { if (f.failUsers) throw new Error('Recipients unavailable'); return { rows: [{ NAME: 'TEST', ORACLE_MAINTAINED: 'N' }, { NAME: 'APP_USER', ORACLE_MAINTAINED: 'N' }, { NAME: 'SYS', ORACLE_MAINTAINED: 'Y' }] }; }
    if (sql.includes('FROM DBA_ROLES') || sql.includes('FROM USER_ROLE_PRIVS')) return { rows: [{ NAME: 'READER', ORACLE_MAINTAINED: 'N' }] };
    if (sql.includes('_TAB_PRIVS')) {
      if (f.failPrivileges) throw new Error('Privilege query failed');
      assert.ok(sql.includes("TYPE = 'DIRECTORY'")); assert.ok(sql.includes('GRANTOR')); assert.ok(sql.includes('GRANTABLE'));
      return { rows: f.grants.map(row => ({ ...row })) };
    }
    if (/^CREATE (OR REPLACE )?DIRECTORY/.test(sql)) {
      const match = /^CREATE (OR REPLACE )?DIRECTORY "([^"]+)" AS '((?:''|[^'])*)'$/.exec(sql); assert.ok(match);
      const existing = f.directories.get(match[2]);
      f.directories.set(match[2], { OWNER: 'SYS', DIRECTORY_NAME: match[2], DIRECTORY_PATH: match[3].replaceAll("''", "'"), DIRECTORY_ID: existing?.DIRECTORY_ID || '3', DDL_TIME: 'v2' });
      if (f.failAfterWrite) f.failPrivileges = true;
      return { rows: [] };
    }
    if (sql.startsWith('DROP DIRECTORY')) { f.directories.delete(/"([^"]+)"/.exec(sql)[1]); return { rows: [] }; }
    if (sql.startsWith('GRANT ') || sql.startsWith('REVOKE ')) {
      const [, action, privilege] = /^(GRANT|REVOKE) (READ|WRITE)/.exec(sql), grantee = /(?:TO|FROM) (?:"([^"]+)"|(PUBLIC))$/.exec(sql);
      const recipient = grantee[1] || grantee[2];
      if (action === 'GRANT') f.grants.push({ GRANTEE: recipient, GRANTOR: 'TEST', PRIVILEGE: privilege, GRANTABLE: 'NO' });
      else f.grants = f.grants.filter(row => !(row.GRANTEE === recipient && row.PRIVILEGE === privilege));
      return { rows: [] };
    }
    throw new Error('Unexpected directory SQL');
  };
  f.invoke = async (channel, request) => {
    f.requests.push([channel, request]);
    try {
      if (channel === 'list-oracle-directories') return { success: true, ...await service.listDirectories(f.query) };
      if (channel === 'get-oracle-directory') {
        const result = { success: true, detail: await service.readDirectory(f.query, request) };
        if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve(result); }); }
        return result;
      }
      if (channel === 'mutate-oracle-directory') return { success: true, ...await service.mutateDirectory(f.query, request) };
      throw new Error('Unexpected directory channel');
    } catch (error) { return { success: false, ...service.safeDirectoryError(error) }; }
  };
  return f;
}
const writes = f => f.calls.filter(([sql]) => /^(CREATE|DROP|GRANT|REVOKE) /.test(sql));
const selectedHarness = async (f, options) => { const h = await createDirectoryHarness(f.invoke, options); h.state.select('DirA'); await h.flush(); return h; };
test('Directory candidates preserve exact quoted names and path apostrophes, and reject malformed input', () => {
  const model = loadTypeScript('src/features/oracle/directoryDefinition.ts');
  const candidate = model.directoryCandidate('"MiX.Dir"', "/data/owner's", true);
  assert.equal(candidate.name, 'MiX.Dir'); assert.equal(candidate.sql, 'CREATE DIRECTORY "MiX.Dir" AS \'/data/owner\'\'s\';');
  assert.equal(model.directoryCandidate('plain_name', '/data', true).name, 'PLAIN_NAME');
  assert.equal(model.directoryCandidate('MiX.Dir', '/data', false).name, 'MiX.Dir');
  for (const path of ['/data/../secret', '/data\0', 'あ'.repeat(1334)]) assert.ok(model.directoryCandidate('OK', path, true).error);
  assert.ok(model.directoryCandidate('bad"name', '/data', true).error);
  assert.throws(() => service.pathName('/data/../secret')); assert.throws(() => service.exactName('bad"name'));
});
test('New creation never replaces a collision and main-process validation precedes queries', async () => {
  const f = fixture();
  await assert.rejects(service.mutateDirectory(f.query, { action: 'create', name: 'DirA', path: '/new' }), /directory_exists/); assert.equal(writes(f).length, 0);
  f.calls.length = 0;
  await assert.rejects(service.mutateDirectory(f.query, { action: 'create', name: 'Bad"', path: '/new' })); assert.equal(f.calls.length, 0);
  await assert.rejects(service.mutateDirectory(f.query, { action: 'grant', name: 'DirA', grantee: 'APP_USER', privilege: 'DBA' })); assert.equal(f.calls.length, 0);
  await assert.rejects(service.mutateDirectory(f.query, { action: 'drop', name: 'DirA' }, true), /readonly/);
});
test('Visible dictionary fallback is labeled and transport failures never become empty successful data', async () => {
  const f = fixture(); f.visible = true;
  const list = await service.listDirectories(f.query); assert.equal(list.scope, 'visible'); assert.equal(list.rolesComplete, false);
  const detail = await service.readDirectory(f.query, 'DirA'); assert.equal(detail.scope, 'visible'); assert.ok(detail.sessionGrants.some(row => row.grantee === 'PUBLIC')); assert.ok(detail.sessionGrants.some(row => row.grantee === 'READER'));
  f.visible = false; f.failDirectories = true; f.calls.length = 0; await assert.rejects(service.listDirectories(f.query));
  assert.equal(f.calls.filter(([sql]) => sql.includes('FROM ALL_DIRECTORIES')).length, 0);
});
test('Actual direct grants include roles and PUBLIC; another grantor and EXECUTE remain read-only', async () => {
  const f = fixture(); f.grants.push({ GRANTEE: 'HIDDEN_ROLE', GRANTOR: 'SYS', PRIVILEGE: 'EXECUTE', GRANTABLE: 'NO' });
  const list = await service.listDirectories(f.query), detail = await service.readDirectory(f.query, 'DirA');
  const { directoryPrincipals } = loadTypeScript('src/features/oracle/directoryDefinition.ts');
  const rows = directoryPrincipals(list, detail, false, '');
  assert.ok(rows.some(row => row.name === 'PUBLIC')); assert.ok(rows.some(row => row.name === 'READER' && row.kind === 'role'));
  assert.equal(rows.find(row => row.name === 'HIDDEN_ROLE').kind, 'unknown'); assert.equal(rows.find(row => row.name === 'TEST').READ.editable, false);
  assert.equal(rows.find(row => row.name === 'HIDDEN_ROLE').WRITE.editable, false);
  await assert.rejects(service.mutateDirectory(f.query, { action: 'revoke', name: 'DirA', expected: detail.fingerprint, grantee: 'TEST', privilege: 'READ' }), /revoke_restricted/);
});
test('Definition and grant conflicts block mutations and a no-op replace emits no DDL', async () => {
  const f = fixture(), detail = await service.readDirectory(f.query, 'DirA');
  const result = await service.mutateDirectory(f.query, { action: 'replace', name: 'DirA', path: detail.directory.path, expected: detail.fingerprint }); assert.equal(result.applied, false); assert.equal(writes(f).length, 0);
  f.directories.get('DirA').DIRECTORY_ID = '99';
  await assert.rejects(service.mutateDirectory(f.query, { action: 'drop', name: 'DirA', expected: detail.fingerprint }), /conflict/); assert.equal(writes(f).length, 0);
});
test('Grant/revoke uses a whitelist, handles PUBLIC as a keyword and returns fresh database state', async () => {
  const f = fixture(); let detail = await service.readDirectory(f.query, 'DirA');
  let result = await service.mutateDirectory(f.query, { action: 'grant', name: 'DirA', expected: detail.fingerprint, grantee: 'APP_USER', privilege: 'READ' });
  assert.ok(result.detail.grants.some(row => row.grantee === 'APP_USER')); assert.match(writes(f)[0][0], /TO "APP_USER"$/);
  result = await service.mutateDirectory(f.query, { action: 'revoke', name: 'DirA', expected: result.detail.fingerprint, grantee: 'APP_USER', privilege: 'READ' });
  assert.ok(!result.detail.grants.some(row => row.grantee === 'APP_USER'));
  detail = result.detail;
  await service.mutateDirectory(f.query, { action: 'revoke', name: 'DirA', expected: detail.fingerprint, grantee: 'PUBLIC', privilege: 'READ' });
  assert.match(writes(f).at(-1)[0], /FROM PUBLIC$/);
});
test('Failed initial and privilege reads block changes, retain the last snapshot and retry with selection preserved', async () => {
  const f = fixture(); f.failDirectories = true; const h = await createDirectoryHarness(f.invoke);
  try {
    assert.equal(h.state.listReady, false); assert.equal(h.state.canCreate, false);
    f.failDirectories = false; await h.state.reload(); await h.flush(); h.state.select('DirA'); await h.flush(); assert.equal(h.state.ready, true);
    const saved = h.state.detail; f.failPrivileges = true; await h.state.reload(); await h.flush();
    assert.equal(h.state.detailReady, false); assert.equal(h.state.canDrop, false); assert.equal(h.state.detail.fingerprint, saved.fingerprint); assert.equal(h.state.selected, 'DirA');
    await h.state.changePrivilege('APP_USER', 'READ', true); assert.equal(writes(f).length, 0);
    f.failPrivileges = false; await h.state.reload(); await h.flush(); assert.equal(h.state.ready, true);
  } finally { h.unmount(); }
});
test('A late detail response cannot overwrite another selected directory', async () => {
  const f = fixture(), h = await selectedHarness(f);
  try {
    f.hold = true; const old = h.state.reload(); await h.flush(); h.state.select('DirB'); await h.flush();
    assert.equal(h.state.detail.directory.name, 'DirB'); f.release(); await old; await h.flush(); assert.equal(h.state.detail.directory.name, 'DirB');
  } finally { h.unmount(); }
});
test('Unchanged paths send no IPC; cancelled replace, drop and PUBLIC grant send no mutation', async () => {
  const f = fixture(), h = await selectedHarness(f, { confirm: () => false });
  try {
    h.state.openReplace(); await h.flush(); f.requests.length = 0; await h.state.submit(); assert.equal(f.requests.length, 0);
    h.state.setDialog(current => ({ ...current, path: '/new' })); await h.flush(); await h.state.submit(); await h.state.drop();
    await h.state.changePrivilege('PUBLIC', 'WRITE', true); assert.equal(writes(f).length, 0); assert.ok(h.confirmations.some(value => value.includes('/old/DirA') && value.includes('/new')));
  } finally { h.unmount(); }
});
test('Duplicate submissions perform one mutation and successful saves update the real path without losing selection', async () => {
  const f = fixture(), h = await selectedHarness(f);
  try {
    h.state.openReplace(); await h.flush(); h.state.setDialog(current => ({ ...current, path: "/data/owner's" })); await h.flush();
    const pending = h.state.submit(); await h.state.submit(); await pending; await h.flush();
    assert.equal(writes(f).length, 1); assert.equal(h.state.detail.directory.path, "/data/owner's"); assert.equal(h.state.selected, 'DirA'); assert.equal(h.state.dialog.open, false);
  } finally { h.unmount(); }
});
test('Completed DDL followed by a failed reload is reported and never automatically repeated', async () => {
  const f = fixture(), h = await selectedHarness(f);
  try {
    h.state.openReplace(); await h.flush(); h.state.setDialog(current => ({ ...current, path: '/new' })); await h.flush(); f.failAfterWrite = true;
    await h.state.submit(); await h.flush(); assert.equal(h.state.applied, true); assert.equal(h.state.ready, false); assert.equal(h.state.dialog.open, false); assert.equal(writes(f).length, 1);
    f.failPrivileges = false; await h.state.reload(); await h.flush(); assert.equal(h.state.detail.directory.path, '/new'); assert.equal(writes(f).length, 1);
  } finally { h.unmount(); }
});
test('Repeated selection and filtered redisplay retain the loaded grant state without starting a new request', async () => {
  const f = fixture(), h = await selectedHarness(f);
  try {
    f.requests.length = 0; h.state.select('DirA'); h.state.setSearch('not visible'); await h.flush();
    assert.equal(h.state.directories.length, 0); assert.equal(h.state.ready, true); assert.equal(h.state.selected, 'DirA');
    h.state.setSearch(''); await h.flush(); assert.equal(h.state.ready, true); assert.equal(f.requests.length, 0);
  } finally { h.unmount(); }
});
test('Mixed grantors never advertise an aggregate revoke as safe', async () => {
  const f = fixture(); f.grants.push({ GRANTEE: 'TEST', GRANTOR: 'TEST', PRIVILEGE: 'READ', GRANTABLE: 'NO' });
  const detail = await service.readDirectory(f.query, 'DirA');
  assert.ok(detail.grants.filter(grant => grant.grantee === 'TEST' && grant.privilege === 'READ').every(grant => !grant.canRevoke));
});
