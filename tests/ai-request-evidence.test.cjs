// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getAiDatabaseContext } = require('../electron/services/aiDatabaseContext');
const { createTraceDatabase } = require('../electron/services/traceStore');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { buildRequestEvidence, emptyRequestBrief } = loadTypeScript('src/features/ai/requestEvidence.ts');

test('Main-session environment whitelists metadata and preserves transaction state', async () => {
  for (const database of ['oracle', 'postgresql']) {
    const row = { schema: 'test', timezone: '+09:00', version: '16', password: 'DO_NOT_SEND', host: 'PRIVATE_HOST' };
    const client = { isExecuting: false, hasUncommittedTx: true, isReadonly: true,
      connection: { oracleServerVersionString: '23', execute: async () => ({ rows: [row] }) },
      client: { query: async sql => { assert.ok(!/BEGIN|COMMIT|ROLLBACK/i.test(sql)); return { rows: [row] }; } } };
    const environment = await getAiDatabaseContext(client, database);
    assert.equal(environment.schema, 'test'); assert.equal(environment.readOnlyMode, true);
    assert.equal(environment.session, 'main'); assert.equal(client.isExecuting, false);
    assert.equal(client.hasUncommittedTx, true);
    assert.ok(!JSON.stringify(environment).includes('DO_NOT_SEND')); assert.ok(!JSON.stringify(environment).includes('PRIVATE_HOST'));
  }
});
test('Busy sessions are untouched and environment read failures release the guard without rollback', async () => {
  let calls = 0;
  const client = { isExecuting: true, client: { query: async () => { calls++; throw new Error('read failure'); } } };
  await assert.rejects(getAiDatabaseContext(client, 'postgresql')); assert.equal(calls, 0); assert.equal(client.isExecuting, true);
  client.isExecuting = false;
  await assert.rejects(getAiDatabaseContext(client, 'postgresql'), /read failure/); assert.equal(calls, 1); assert.equal(client.isExecuting, false);
});
test('Requirements and verification remain explicit evidence, including unknown environments and bounded fields', () => {
  const brief = emptyRequestBrief(); brief.expectedResult = '150'; brief.actualResult = '90'; brief.constraints = 'Keep signature'; brief.verification = 'Expected 150, received 90';
  const text = buildRequestEvidence(null, brief, true);
  assert.match(text, /unavailable/); assert.match(text, /Expected 150, received 90/); assert.match(text, /Keep signature/);
  assert.match(text, /not a claim that you executed code/);
  brief.verification = 'x'.repeat(13000);
  const evidence = JSON.parse(buildRequestEvidence(null, brief).split('\n').at(-1));
  assert.equal(evidence.userRequirements.verification.length, 12000);
  assert.equal(evidence.userRequirements.inputExample, undefined);
});
test('Trace replay retains exact original source, hash and trigger line mapping after editor changes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-source-proof-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const Store = createTraceDatabase('oracle', { getStoragePaths: () => ({ traceDirectory: directory }) });
  const identity = { schema: 'TEST', objectName: 'MBT_PROOF', objectType: 'FUNCTION' };
  const source = 'BEGIN\n  RETURN 90;\nEND;';
  const store = new Store(identity); await store.init();
  await store.saveTraceInfo('time', '{}', null, null, { text: source, lineMap: { 20: 2 } }); store.close();
  const reopened = new Store(identity); await reopened.init(); const info = await reopened.getTraceInfo();
  assert.equal(info.executed_source, source); assert.equal(info.source_kind, 'original');
  assert.equal(info.source_sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(info.line_mapping, 'generated_procedure_to_original'); assert.deepEqual(info.procedure_to_source, { 20: 2 });
  assert.notEqual(info.executed_source, source.replace('90', '150')); reopened.close();
});

test('Related references retain overload identities and reject unsupported or malformed catalog rows', async () => {
  const calls = [];
  const deps = { '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, sql, binds) => {
    calls.push({ channel, sql, binds }); return { success: true, rows: [
      { schema: 'test', name: 'f', category: 'FUNCTION', id: '21', displayName: 'f(integer)' },
      { schema: 'test', name: 'f', category: 'FUNCTION', id: '22', displayName: 'f(text)' },
      { schema: 'test', name: 'bad', category: 'DATABASE LINK', id: '23' },
      { name: 'missing-schema', category: 'TABLE' },
    ] };
  } } } };
  const repository = loadTypeScript('src/features/objects/objectRepository.ts', deps);
  const { listRelatedObjects } = loadTypeScript('src/features/ai/relatedObjects.ts', { ...deps, '../objects/objectRepository': repository });
  const object = { dbType: 'postgresql', category: 'VIEW', schema: 'test', name: 'v', id: '10', key: 'view' };
  const result = await listRelatedObjects(object);
  assert.equal(result.length, 2); assert.notEqual(result[0].key, result[1].key);
  assert.equal(calls[0].channel, 'execute-sql-bg'); assert.equal(calls[0].binds.id, '10');
  assert.equal((await listRelatedObjects({ ...object, id: '10; DROP TABLE x' })).length, 0); assert.equal(calls.length, 1);
});

test('Paid context entry refuses CI and missing approval before reading stdin or contacting a provider', () => {
  const { spawnSync } = require('node:child_process');
  for (const args of [[], ['--allow-paid']]) {
    const result = spawnSync(process.execPath, ['tests/live-ai/context-effect.cjs', ...args], {
      env: { ...process.env, CI: 'true' }, input: 'sk-fictional-context-guard-key\n', encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /forbidden in CI/);
    assert.ok(!result.stderr.includes('sk-fictional-context-guard-key'));
  }
});

test('SQL batch reservations remain visible between statements and stop following a disconnected client', () => {
  const { createSqlBatches } = require('../electron/services/sqlBatches');
  let client = {};
  const batches = createSqlBatches(() => client), event = { sender: { id: 1 } };
  assert.equal(batches.isReserved(), false);
  batches.begin(event, 'AI_CONTEXT_BATCH'); assert.equal(batches.isReserved(), true);
  batches.end(event, 'AI_CONTEXT_BATCH'); assert.equal(batches.isReserved(), false);
  batches.begin(event, 'OLD_CONNECTION_BATCH'); client = {};
  assert.equal(batches.isReserved(), false);
});
