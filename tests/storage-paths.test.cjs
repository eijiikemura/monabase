// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createStoragePaths, prepareStorage } = require('../electron/services/storagePaths');
const { loadModule } = require('./helpers/loadModule.cjs');

function fixture(t, mode = 'installed') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'legacy');
  const userData = path.join(root, 'profile');
  const app = { isPackaged: mode !== 'development', getPath: name => name === 'exe' ? path.join(legacy, 'MonaBase.exe') : userData };
  const env = mode === 'portable' ? { PORTABLE_EXECUTABLE_DIR: path.join(root, 'portable') } : {};
  const paths = createStoragePaths(app, { cwd: path.join(root, 'development'), env });
  return { root, legacy, userData, paths };
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

for (const mode of ['development', 'installed', 'portable']) {
  test(`${mode}: Storage selection separates writable data from bundled application code`, t => {
    const { root, paths, userData } = fixture(t, mode);
    assert.equal(paths.mode, mode);
    const expected = mode === 'installed' ? userData : path.join(root, mode);
    assert.equal(paths.baseDirectory, expected);
    assert.equal(paths.traceDirectory, path.join(expected, 'trace'));
    assert.equal(paths.connectionsFile, path.join(userData, 'connections.json'));
  });
}

test('Migration retains original files, copies repositories and traces, and preserves existing destinations', t => {
  const { root, legacy, paths } = fixture(t);
  const oldTraces = path.join(root, 'old-app', 'trace');
  write(path.join(legacy, 'settings.json'), '{"language":"ja"}');
  write(path.join(legacy, 'git', '.git', 'HEAD'), 'old-branch');
  write(path.join(legacy, 'ai', 'source', 'old.json'), 'conversation');
  write(path.join(oldTraces, 'oracle', 'trace_DEMO.json'), '{"traceSteps":[]}');
  prepareStorage(paths, oldTraces);
  assert.equal(fs.readFileSync(paths.settingsFile, 'utf8'), '{"language":"ja"}');
  assert.equal(fs.readFileSync(path.join(paths.gitDirectory, '.git', 'HEAD'), 'utf8'), 'old-branch');
  assert.ok(fs.existsSync(path.join(paths.traceDirectory, 'oracle', 'trace_DEMO.json')));
  assert.ok(fs.existsSync(path.join(legacy, 'ai', 'source', 'old.json')));
  write(paths.settingsFile, '{"language":"en"}');
  write(path.join(paths.gitDirectory, '.git', 'HEAD'), 'new-branch');
  write(path.join(legacy, 'git', '.git', 'refs', 'heads', 'unrelated'), 'old-ref');
  prepareStorage(paths, oldTraces);
  assert.equal(fs.readFileSync(paths.settingsFile, 'utf8'), '{"language":"en"}');
  assert.equal(fs.readFileSync(path.join(paths.gitDirectory, '.git', 'HEAD'), 'utf8'), 'new-branch');
  assert.equal(fs.existsSync(path.join(paths.gitDirectory, '.git', 'refs', 'heads', 'unrelated')), false);
});

for (const database of ['oracle', 'postgres']) {
  test(`${database}: Real trace storage writes and reloads outside the application archive`, async t => {
    const { paths } = fixture(t);
    const { TraceDatabase } = loadModule(`electron/${database}/traceDb.js`, {
      '../services/storagePaths': { getStoragePaths: () => paths }
    }, {}, { strict: false });
    const trace = new TraceDatabase('demo');
    await trace.init();
    await trace.saveTraceInfo('2026-10-20', '{}');
    await trace.insertSteps([{ lineNum: 3, loopPath: '', variables: { count: 1 }, logText: 'trace' }]);
    trace.close();
    const reopened = new TraceDatabase('demo');
    await reopened.init();
    assert.equal((await reopened.getTraceSteps())[0].line_num, 3);
    assert.equal((await reopened.getTraceInfo()).compile_date, '2026-10-20');
    assert.ok(reopened.dbPath.startsWith(paths.traceDirectory + path.sep));
  });
}
