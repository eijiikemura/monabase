// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const { loadModule } = require('./helpers/loadModule.cjs');
const { safeAiError, providerError } = require('../electron/services/aiErrors');
const { readBoundedText } = require('../electron/services/boundedFiles');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('AI diagnostics redact known keys, encoded variants, bearer headers and secret fields before truncation', () => {
  const secret = 'DUMMY/key+secret';
  for (const text of [secret, encodeURIComponent(secret), JSON.stringify(secret), 'Bearer TOKEN_VALUE', 'api_key: TOKEN_VALUE', 'password=TOKEN_VALUE', 'https://user:TOKEN_VALUE@host/path']) {
    const message = safeAiError(text, secret);
    assert.ok(!message.includes(secret)); assert.ok(!message.includes(encodeURIComponent(secret))); assert.ok(!message.includes('TOKEN_VALUE'));
  }
  assert.ok(!safeAiError('x'.repeat(990) + secret, secret).includes('DUMMY/'));
  assert.ok(safeAiError('x'.repeat(2000)).length <= 1001);
  assert.ok(!safeAiError('line\nforged\rheader').includes('\n'));
  assert.equal(providerError(502, '<html>private content</html>', secret), 'HTTP 502');
  const message = providerError(401, JSON.stringify({ error: { message: 'Invalid API key: ' + secret } }), secret);
  assert.ok(message.includes('HTTP 401')); assert.ok(!message.includes(secret));
});

test('AI IPC sanitizes HTTP, JSON and SSE provider errors before delivering them to the renderer', async t => {
  const root = directory(t), file = path.join(root, 'ai.json'); fs.writeFileSync(file, '{}');
  const secret = 'DUMMY_KEY_DO_NOT_PERSIST';
  for (const kind of ['http', 'json', 'sse', 'json-prefixed']) {
    const handlers = new Map(), logs = [];
    const body = JSON.stringify({ error: { message: (kind === 'json-prefixed' ? 'security_ai_' : 'Invalid API key: ') + secret } });
    const payload = kind === 'sse' ? 'data: ' + body + '\n\n' : body;
    loadModule('electron/ipc/ai.js', {}, {
      fetch: async () => new Response(payload, { status: kind === 'http' ? 401 : 200, headers: { 'content-type': kind === 'sse' ? 'text/event-stream' : 'application/json' } }),
      console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) }
    }, { strict: false }).registerAiHandlers({
      ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, BrowserWindow: { getAllWindows: () => [] },
      getValidatedSettings: () => ({}), aiSettingsStore: { load: () => ({ isAiEnabled: true, apiKey: secret, endpointUrl: 'https://example.invalid/v1' }) },
      AI_CONFIG_FILE: file, AI_USAGE_DIR: path.join(root, 'usage'), t: key => key
    });
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false });
    const result = await handlers.get('ask-ai')({ sender }, 'fictional prompt', [], 'unspecified', kind);
    assert.equal(result.success, false); assert.equal(result.answer, undefined);
    assert.ok(!JSON.stringify(result).includes(secret)); assert.ok(!JSON.stringify(logs).includes(secret));
  }
});

test('Bounded file reads preserve UTF-8, enforce inclusive byte limits and refuse special files', async t => {
  const root = directory(t), file = path.join(root, 'query.sql');
  fs.writeFileSync(file, '日本語'); assert.equal(await readBoundedText(file, 1), '日本語');
  fs.writeFileSync(file, Buffer.alloc(1024 * 1024, 65)); assert.equal((await readBoundedText(file, 1)).length, 1024 * 1024);
  fs.appendFileSync(file, 'x'); await assert.rejects(readBoundedText(file, 1), { code: 'file_read_too_large' });
  await assert.rejects(readBoundedText(root, 1), { code: 'file_read_not_regular' });
  if (process.platform !== 'win32') {
    const link = path.join(root, 'link.sql'); fs.symlinkSync(file, link);
    await assert.rejects(readBoundedText(link, 1), { code: 'file_read_not_regular' });
    const pipe = path.join(root, 'pipe.sql'); execFileSync('mkfifo', [pipe]);
    await assert.rejects(readBoundedText(pipe, 1), { code: 'file_read_not_regular' });
  }
  await assert.rejects(readBoundedText(file, 0), /Invalid file read limit/);
});

test('A growing file never reads more than the limit plus one byte and always closes its descriptor', async () => {
  let readBytes = 0, closed = 0;
  const status = { isFile: () => true, isSymbolicLink: () => false, size: 0, ino: 2, dev: 1 };
  const handle = { stat: async () => status, close: async () => { closed++; }, read: async (buffer, offset, length) => {
    buffer.fill(65); readBytes += length; return { bytesRead: length };
  } };
  const { readBoundedText } = loadModule('electron/services/boundedFiles.js', { 'node:fs': {
    constants: fs.constants, promises: { lstat: async () => status, open: async () => handle }
  } });
  await assert.rejects(readBoundedText('/fictional/growing.sql', 1), { code: 'file_read_too_large' });
  assert.equal(readBytes, 1024 * 1024 + 1); assert.equal(closed, 1);
});

test('SQL and ER IPC use their independently configured current limits and return no partial text', async t => {
  const root = directory(t), repo = path.join(root, 'repo'), file = path.join(root, 'query.sql');
  fs.writeFileSync(file, 'x'.repeat(1024 * 1024 + 1));
  const folder = path.join(repo, 'MonaBase', 'ORACLE', 'ErDiagram'); fs.mkdirSync(folder, { recursive: true });
  fs.copyFileSync(file, path.join(folder, 'demo.json'));
  let sql = 1, er = 2;
  const handlers = new Map(), ipcMain = { handle: (key, fn) => handlers.set(key, fn) }, getValidatedSettings = () => ({ sqlFileMaxMb: sql, erFileMaxMb: er });
  require('../electron/ipc/files').registerFileHandlers({ ipcMain, getValidatedSettings, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) }, getWindow: () => null, t: key => key });
  require('../electron/ipc/er').registerErHandlers({ ipcMain, getValidatedSettings, gitDirectory: repo, t: key => key });
  const openSql = () => handlers.get('open-sql-file')({});
  const openEr = () => handlers.get('load-er-diagram')({}, { dbType: 'ORACLE', objectName: 'demo.json' });
  const failed = await openSql(); assert.equal(failed.success, false); assert.equal(failed.error, 'file_read_too_large'); assert.equal(failed.sql, undefined);
  assert.equal((await openEr()).success, true);
  sql = 2; er = 1;
  assert.equal((await openSql()).success, true);
  const erFailed = await openEr(); assert.equal(erFailed.success, false); assert.equal(erFailed.data, undefined);
});

test('Spreadsheet text mode neutralizes formula prefixes and preserves numeric types and raw text', () => {
  const { spreadsheetText } = loadTypeScript('src/shared/utils/spreadsheetText.ts');
  for (const value of ['=1+1', '+1', '-1', '@SUM(A1)', ' \t=1', '\rtext', '\ntext', '＝1', '＋1', '－1', '＠SUM(A1)']) {
    assert.equal(spreadsheetText(value, true), "'" + value);
    assert.equal(spreadsheetText(value, false), value);
  }
  for (const value of ['plain', "'=1+1", '', 12, -12, null]) assert.equal(spreadsheetText(value, true), String(value ?? ''));
});
