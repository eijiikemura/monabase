// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { sourceFileName, canonicalGitDbType } = require('../electron/services/gitSourceNames');
const { pgRoutineInputTypes, tokenizePgSql } = loadTypeScript('src/features/postgresql/sqlTokens.ts');
const { routineTabKey, parseRoutineTab, resolvePgRoutine } = loadTypeScript('src/features/postgresql/routineIdentity.ts');
const identity = { schema: 'Mixed.Schema', objectName: 'Total."Order', objectType: 'FUNCTION', signature: 'integer' };

test('PostgreSQL overload tab and Git identities preserve case, punctuation, and argument types', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(parseRoutineTab(routineTabKey(identity)))), identity);
  const variants = [identity, { ...identity, signature: 'text' }, { ...identity, objectName: identity.objectName.toLowerCase() }];
  assert.equal(new Set(variants.map(routineTabKey)).size, 3);
  const files = variants.map(item => sourceFileName(item.objectName, item.signature));
  assert.equal(new Set(files).size, 3);
  for (const file of files) assert.match(file, /^[A-Za-z0-9_-]+_[a-f0-9]{64}\.sql$/);
  assert.equal(canonicalGitDbType('POSTGRES'), 'POSTGRESQL');
});

test('Routine declarations ignore OUT parameters, defaults, comments, and type modifiers', () => {
  const source = `CREATE FUNCTION demo.f(IN a numeric(12,2) DEFAULT round(1,2), OUT result text,
    INOUT b double precision, VARIADIC values integer[], c "Types"."Order" DEFAULT NULL,
    d timestamp(3) with time zone DEFAULT now()) RETURNS record LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$`;
  assert.equal(pgRoutineInputTypes(source), 'numeric, double precision, integer [ ], "Types" . "Order", timestamp with time zone');
  assert.equal(pgRoutineInputTypes('CREATE PROCEDURE s.p(/* nested /* comment */ */ text, OUT text, integer DEFAULT 3)'), 'text, integer');
  assert.equal(tokenizePgSql("SELECT 'RETURN;'; -- RETURN\n/* ; */ $$RETURN;$$").filter(token => token.text === ';').length, 1);
});

test('Routine resolution uses a bound signature and refuses ambiguous name-only selection', async () => {
  const client = { invoke: async (channel, sql, binds) => {
    assert.equal(channel, 'execute-sql-bg');
    assert.match(sql, /p.oid = to_regprocedure\(:routine\)/);
    assert.equal(binds.routine, '"Mixed.Schema"."Total.""Order"(integer)');
    return { success: true, rows: [{ oid: '42', signature: 'integer', ddl: 'source' }] };
  } };
  assert.equal((await resolvePgRoutine(client, identity)).oid, '42');
  await assert.rejects(resolvePgRoutine({ invoke: async () => ({ success: true, rows: [{}, {}] }) }, { ...identity, signature: undefined }), /ambiguous/);
});

test('Stored execution resolves metadata in the background and casts bound values on the main connection', async () => {
  const PostgresClient = loadModule('electron/postgres/postgresClient.js', {
    electron: { app: { isPackaged: true } }, 'pg': { Client: class {}, types: { setTypeParser() {} } }
  }, {}, { strict: false });
  const client = new PostgresClient(), calls = [];
  client.execute = async (...args) => {
    calls.push(args);
    return calls.length === 1 ? { rows: [{ names: ['value'], modes: null, types: ['integer'] }] } : { rows: [{ total: 42 }], notices: [] };
  };
  const result = await client.executeStored({ ...identity, args: { value: '41' } });
  assert.equal(calls[0][4], true);
  assert.match(calls[1][0], /SELECT \* FROM "Mixed.Schema"\."Total.""Order"\(CAST\(:value0 AS integer\)\)/);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1][1])), { value0: '41' });
  assert.deepEqual(JSON.parse(JSON.stringify(result.returnValues)), [{ name: 'total', value: 42 }]);
});

test('Real Git histories and deletion stay isolated between overloads and preserve legacy source', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { simpleGit } = require('simple-git');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-overload-git-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = simpleGit(directory);
  await git.init();
  await git.addConfig('user.name', 'MonaBase Tests', false, 'local');
  await git.addConfig('user.email', 'tests@example.invalid', false, 'local');
  await git.addConfig('commit.gpgsign', 'false', false, 'local');
  require('node:child_process').execFileSync('git', ['-C', directory, 'config', '--local', 'core.hooksPath', path.join(directory, 'no-hooks')]);
  const handlers = new Map();
  loadModule('electron/ipc/git.js', {}, {}, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, gitDirectory: directory, t: key => key
  });
  const invoke = (name, request) => handlers.get(name)(null, request);
  const base = { dbType: 'POSTGRES', schema: 'public', objectType: 'FUNCTION', objectName: 'total' };
  const legacy = path.join(directory, 'MonaBase', 'POSTGRESQL', 'public', 'FUNCTION', 'total.sql');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, 'legacy source');
  for (const signature of ['integer', 'text']) {
    const result = await invoke('git-commit', { ...base, signature, sourceText: `source ${signature}`, message: `Add ${signature}` });
    assert.equal(result.success, true, result.error);
  }
  for (const signature of ['integer', 'text']) {
    const history = await invoke('git-get-history', { ...base, dbType: 'POSTGRESQL', signature });
    assert.equal(history.success, true, history.error);
    assert.equal(history.history.length, 1);
    const source = await invoke('git-get-file-content', { ...base, signature, commitId: history.history[0].fullId });
    assert.equal(source.success, true, source.error);
    assert.equal(source.content, `source ${signature}`);
  }
  const deleted = await invoke('git-delete-object', { ...base, signature: 'integer' });
  assert.equal(deleted.success, true, deleted.error);
  assert.equal(fs.readFileSync(legacy, 'utf8'), 'legacy source');
  assert.equal(fs.readFileSync(path.join(path.dirname(legacy), sourceFileName('total', 'text')), 'utf8'), 'source text');
});
