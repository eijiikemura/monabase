// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createTraceIdentity, resolveTraceFile } = require('../electron/services/traceFiles');
const { loadModule } = require('./helpers/loadModule.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-trace-identity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const config = { host: 'localhost', port: 5432, database: 'demo', user: 'reader' };
const target = { schema: 'public', objectName: 'total', objectType: 'FUNCTION', signature: 'integer' };

test('Trace files separate connections, schemas, kinds, case, and overloads without storing credentials', t => {
  const directory = fixture(t);
  const identities = [createTraceIdentity(config, target),
    ...['host', 'port', 'database', 'user', 'sshHost', 'sshUser'].map(key => createTraceIdentity({ ...config, [key]: 'other' }, target)),
    ...['schema', 'objectName', 'objectType', 'signature'].map(key => createTraceIdentity(config, { ...target, [key]: 'Other' }))];
  const filenames = identities.map(identity => resolveTraceFile(directory, 'postgres', identity));
  assert.equal(new Set(filenames).size, filenames.length);
  assert.equal(resolveTraceFile(directory, 'postgres', createTraceIdentity({ ...config, password: 'secret' }, target)), filenames[0]);
  assert.ok(!JSON.stringify(identities).includes('secret'));
  const dangerous = createTraceIdentity(config, { ...target, objectName: '../../outside/CON' });
  assert.match(path.basename(resolveTraceFile(directory, 'postgres', dangerous)), /^trace_[a-f0-9]{64}\.json$/);
  assert.throws(() => createTraceIdentity(config, 'total'), /requires a schema/);
});

for (const database of ['oracle', 'postgres']) {
  test(`${database}: scoped writes and deletion preserve other traces and legacy files`, async t => {
    const directory = fixture(t);
    fs.mkdirSync(path.join(directory, database));
    const legacy = path.join(directory, database, 'trace_TOTAL.json');
    fs.writeFileSync(legacy, 'legacy data');
    const { TraceDatabase } = loadModule(`electron/${database}/traceDb.js`, {
      '../services/storagePaths': { getStoragePaths: () => ({ traceDirectory: directory }) }
    }, {}, { strict: false });
    const first = createTraceIdentity(config, target);
    const second = createTraceIdentity(config, { ...target, signature: 'text' });
    for (const [identity, line] of [[first, 1], [second, 2]]) {
      const store = new TraceDatabase(identity);
      await store.init();
      await store.insertSteps([{ lineNum: line, variables: {}, logText: 'step' }]);
      store.close();
    }
    TraceDatabase.deleteDatabase(first);
    assert.equal(TraceDatabase.exists(first), false);
    assert.equal(TraceDatabase.exists(second), true);
    assert.equal(fs.readFileSync(legacy, 'utf8'), 'legacy data');
    const reopened = new TraceDatabase(second);
    await reopened.init();
    assert.equal((await reopened.getTraceSteps())[0].line_num, 2);
  });
}

test('Trace paths reject linked directories and files before reading or writing', t => {
  const directory = fixture(t), outside = fixture(t);
  fs.symlinkSync(outside, path.join(directory, 'postgres'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveTraceFile(directory, 'postgres', 'demo'), /Symbolic links/);
  fs.unlinkSync(path.join(directory, 'postgres'));
  fs.mkdirSync(path.join(directory, 'postgres'));
  if (process.platform !== 'win32') {
    const filename = resolveTraceFile(directory, 'postgres', 'demo');
    const original = path.join(outside, 'original');
    fs.writeFileSync(original, 'preserve');
    fs.symlinkSync(original, filename);
    assert.throws(() => resolveTraceFile(directory, 'postgres', 'demo'), /Symbolic links/);
    assert.equal(fs.readFileSync(original, 'utf8'), 'preserve');
  }
});
