// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { readInternalText, readInternalBufferSync, parsePrivateJson, INTERNAL_FILE_MAX_BYTES,
  GIT_SOURCE_MAX_BYTES, createReadBudget, readGitSource } = require('../electron/services/dataSafety');
const { createTraceDatabase } = require('../electron/services/traceStore');
const { atomicWriteJson, readJsonFile } = require('../electron/services/jsonFiles');
const { getSourceHistoryFile, saveSourceHistory, loadSourceHistory } = require('../electron/ai/sourceHistory');
const { createUsageRecord, appendUsage, readUsage } = require('../electron/ai/usageHistory');
const { loadModule } = require('./helpers/loadModule.cjs');
const { setLanguage } = require('../electron/i18n');

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-internal-data-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const identity = { connectionScope: 'a'.repeat(64), dbType: 'oracle', schema: 'TEST', category: 'FUNCTION', objectName: 'DEMO' };
const conversation = text => ({ messages: [{ id: '1', sender: 'user', text, timestamp: 'now' }], selectedObjects: [] });
function oversized(file) { const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, INTERNAL_FILE_MAX_BYTES + 1); fs.closeSync(fd); }

test('AI usage CSV neutralizes formula starts, whitespace, full-width operators, quotes and multiline cells', async t => {
  const root = directory(t);
  const values = ['=1+1', '+1', '-1', '@x', '\t=1', '\r=1', '\n=1', ' \uFEFF＝1', '＋1', '－1', '＠x', '=1,"x"\nnext'];
  for (const value of values) await appendUsage(root, { ...createUsageRecord(value, value, new Date(2026, 9, 28)), inputTokens: 3, outputTokens: 4 });
  const records = await readUsage(root, 2026);
  assert.deepEqual(records.map(row => row.modelName), values.map(value => "'" + value));
  assert.deepEqual(records.map(row => row.requestType), values.map(value => "'" + value));
  assert.ok(records.every(row => row.inputTokens === 3 && row.outputTokens === 4));
  await appendUsage(root, createUsageRecord("'=literal", 'normal-model', new Date(2026, 9, 28)));
  assert.equal((await readUsage(root, 2026)).at(-1).requestType, "'=literal");
});

test('AI history parse failures expose no dummy source in IPC and preserve bytes for retry', async t => {
  const root = directory(t), file = getSourceHistoryFile(root, identity), marker = 'DUMMY_PRIVATE_VALUE';
  fs.writeFileSync(file, marker);
  const handlers = new Map();
  loadModule('electron/ipc/ai.js', {}, {}, { strict: false }).registerAiHandlers({
    state: { aiHistoryScopes: new Map([[identity.connectionScope, identity.dbType]]) }, t: key => key,
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, AI_SOURCE_DIR: root, AI_DEBUG_DIR: root
  });
  for (const key of ['load-ai-source-history', 'load-ai-debug-history']) {
    const result = await handlers.get(key)(null, identity);
    assert.equal(result.success, false); assert.ok(!JSON.stringify(result).includes(marker));
  }
  assert.equal(fs.readFileSync(file, 'utf8'), marker);
  await saveSourceHistory(root, identity, conversation('日本語'));
  assert.equal((await loadSourceHistory(root, identity)).messages[0].text, '日本語');
});

test('Trace parse failures and nested variable errors contain no original data in either language', async t => {
  const root = directory(t), Trace = createTraceDatabase('oracle', { getStoragePaths: () => ({ traceDirectory: root }) });
  const store = new Trace('DEMO'), marker = 'DUMMY_TRACE_SECRET'; fs.writeFileSync(store.dbPath, marker);
  for (const language of ['en', 'ja']) {
    setLanguage(language);
    await assert.rejects(store.init(), error => error.code === 'internal_data_invalid' && !error.message.includes(marker));
    assert.throws(() => parsePrivateJson(marker), error => error.code === 'internal_data_invalid' && !error.message.includes(marker));
  }
  setLanguage('en'); t.after(() => setLanguage('en'));
  assert.equal(fs.readFileSync(store.dbPath, 'utf8'), marker);
});

test('Internal readers and history writes reject oversized sparse files without changing their contents', async t => {
  const root = directory(t), file = path.join(root, 'history.json'); oversized(file);
  await assert.rejects(readInternalText(file), { code: 'internal_data_too_large' });
  assert.throws(() => readInternalBufferSync(file), { code: 'internal_data_too_large' });
  assert.throws(() => readJsonFile(file), { code: 'internal_data_too_large' });
  assert.equal(fs.statSync(file).size, INTERNAL_FILE_MAX_BYTES + 1);
  assert.deepEqual(fs.readdirSync(root), ['history.json']);
  fs.writeFileSync(file, '日本語');
  assert.equal(await readInternalText(file), '日本語');
  assert.equal(readInternalBufferSync(file).toString(), '日本語');
  assert.throws(() => readInternalBufferSync(root), { code: 'internal_data_not_regular' });
  if (process.platform !== 'win32') {
    const link = path.join(root, 'link'); fs.symlinkSync(file, link);
    assert.throws(() => readInternalBufferSync(link), { code: 'internal_data_not_regular' });
    await assert.rejects(readInternalText(link), { code: 'internal_data_not_regular' });
  }
});

test('Oversized AI histories and trace files refuse load without deletion or automatic replacement', async t => {
  const root = directory(t), file = getSourceHistoryFile(root, identity); oversized(file);
  await assert.rejects(loadSourceHistory(root, identity), { code: 'internal_data_too_large' });
  assert.equal(fs.statSync(file).size, INTERNAL_FILE_MAX_BYTES + 1);
  const Trace = createTraceDatabase('postgres', { getStoragePaths: () => ({ traceDirectory: root }) });
  const store = new Trace('DEMO'); oversized(store.dbPath);
  await assert.rejects(store.init(), { code: 'internal_data_too_large' });
  assert.equal(fs.statSync(store.dbPath).size, INTERNAL_FILE_MAX_BYTES + 1);
});

test('Usage capacity refusal preserves the existing file, does not poison the queue and rejects links', async t => {
  const root = directory(t), file = path.join(root, 'ai-usage-2026.csv'); oversized(file);
  const record = createUsageRecord('coding', 'model', new Date(2026, 9, 28));
  await assert.rejects(readUsage(root, 2026), { code: 'internal_data_too_large' });
  await assert.rejects(appendUsage(root, record), { code: 'internal_data_too_large' });
  assert.equal(fs.statSync(file).size, INTERNAL_FILE_MAX_BYTES + 1);
  fs.unlinkSync(file);
  await appendUsage(root, record); assert.equal((await readUsage(root, 2026)).length, 1);
  if (process.platform !== 'win32') {
    const target = path.join(root, 'target'); fs.writeFileSync(target, 'unchanged');
    fs.unlinkSync(file); fs.symlinkSync(target, file);
    await assert.rejects(appendUsage(root, record), { code: 'internal_data_not_regular' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  }
});

test('Git blob size and combined budgets fail before content retrieval and accept the exact boundary', async () => {
  let fetched = false, size = GIT_SOURCE_MAX_BYTES + 1;
  const git = { async raw(args) {
    if (args[1] === '-t') return 'blob\n';
    if (args[1] === '-s') return String(size);
    fetched = true; return 'text';
  } };
  await assert.rejects(readGitSource(git, 'a'.repeat(40)), { code: 'internal_data_too_large' });
  assert.equal(fetched, false);
  size = GIT_SOURCE_MAX_BYTES; const consume = createReadBudget();
  consume(INTERNAL_FILE_MAX_BYTES - size);
  assert.equal(await readGitSource(git, 'a'.repeat(40), consume), 'text');
  fetched = false;
  await assert.rejects(readGitSource(git, 'a'.repeat(40), consume), { code: 'internal_data_too_large' });
  assert.equal(fetched, false);
  size = -1;
  await assert.rejects(readGitSource(git, 'a'.repeat(40)), { code: 'internal_data_too_large' });
});

test('Bounded JSON writes preserve an existing history when serialization exceeds the limit', t => {
  const root = directory(t), file = path.join(root, 'history.json'); atomicWriteJson(file, { value: 'original' });
  const before = fs.readFileSync(file);
  assert.throws(() => atomicWriteJson(file, { value: 'x'.repeat(INTERNAL_FILE_MAX_BYTES) }), { code: 'internal_data_too_large' });
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(root), ['history.json']);
});

test('Trace UI and AI IPC paths hide malformed source and enforce capacity while preserving confirmation and retry', async t => {
  const { createTraceIdentity, resolveTraceFile } = require('../electron/services/traceFiles');
  const root = directory(t), marker = 'DUMMY_TRACE_CONTENT', logs = [];
  for (const type of ['oracle', 'postgres']) {
    const Trace = createTraceDatabase(type, { getStoragePaths: () => ({ traceDirectory: root }) });
    const state = { type, client: { lastConfig: { database: 'test-only' } } }, handlers = new Map();
    loadModule('electron/ipc/database.js', {
      '../services/storagePaths': { getStoragePaths: () => ({ traceDirectory: root }) },
      '../oracle/traceDb': { TraceDatabase: Trace }, '../postgres/traceDb': { TraceDatabase: Trace },
      '../oracle/oracleClient': class {}, '../postgres/postgresClient': class {},
      '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {}
    }, { console: { error: (...args) => logs.push(args.map(String).join(' ')) } }, { strict: false }).registerDatabaseHandlers({
      state, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, getValidatedSettings: () => ({}), t: key => key
    });
    const target = { dbType: type === 'postgres' ? 'postgresql' : type, schema: 'TEST', objectType: 'FUNCTION', objectName: 'DEMO' };
    const file = resolveTraceFile(root, type, createTraceIdentity(state.client.lastConfig, target));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, marker);
    for (const key of ['get-trace-data', 'get-trace-for-ai']) {
      const result = await handlers.get(key)(null, target);
      assert.equal(result.success, false); assert.ok(!JSON.stringify(result).includes(marker));
    }
    assert.equal(fs.readFileSync(file, 'utf8'), marker);
    fs.writeFileSync(file, JSON.stringify({ traceInfo: {}, traceSteps: [{ variables_json: marker }] }));
    const nested = await handlers.get('get-trace-data')(null, target);
    assert.equal(nested.success, false); assert.ok(!JSON.stringify(nested).includes(marker));
    assert.ok(!logs.join('\n').includes(marker));
    oversized(file);
    const huge = await handlers.get('get-trace-for-ai')(null, { ...target, approvedBytes: INTERNAL_FILE_MAX_BYTES + 1 });
    assert.equal(huge.success, false); assert.match(huge.error, /safety size limit/);
    assert.equal(fs.statSync(file).size, INTERNAL_FILE_MAX_BYTES + 1);
    const text = JSON.stringify({ traceInfo: {}, traceSteps: [{}] }) + ' '.repeat(1_000_001);
    fs.writeFileSync(file, text);
    const confirm = await handlers.get('get-trace-for-ai')(null, target);
    assert.equal(confirm.requiresConfirmation, true);
    const retry = await handlers.get('get-trace-for-ai')(null, { ...target, approvedBytes: 2_000_000 });
    assert.equal(retry.success, true); assert.equal(retry.content, text);
  }
});
