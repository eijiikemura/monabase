// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadModule } = require('./helpers/loadModule.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const jsonFiles = require('../electron/services/jsonFiles');
const { translate } = require('../electron/i18n');

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-history-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'history.json'), handlers = new Map();
  const { registerFileHandlers } = loadModule('electron/ipc/files.js', {
    '../services/sqlPrivacy': require('../electron/services/sqlPrivacy'),
    '../services/boundedFiles': require('../electron/services/boundedFiles'),
    '../services/settings': require('../electron/services/settings'),
    '../services/filePermissions': require('../electron/services/filePermissions'),
    '../services/atomicFiles': require('../electron/services/atomicFiles'),
    'node:fs': fs, 'node:crypto': require('node:crypto'), 'iconv-lite': {}, '../services/jsonFiles': { ...jsonFiles, ...overrides }
  });
  registerFileHandlers({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, HISTORY_FILE: file,
    getValidatedSettings: () => ({ sqlHistoryLimit: 2 }), t: (key, values) => translate(key, 'en', values) });
  return { file, directory, invoke: (channel, ...args) => handlers.get(channel)(null, ...args) };
}
const entry = sql => ({ executeTime: '2026-10-21', sql, duration: 1, rowCount: 0 });

test('SQL history preserves its array API, ordering, limits and unique IDs with atomic saves', t => {
  const h = fixture(t);
  assert.equal(h.invoke('get-sql-history').length, 0);
  const ids = new Set();
  for (const sql of ['first', '日本語', 'latest']) ids.add(h.invoke('add-sql-history', entry(sql))[0].id);
  assert.equal(ids.size, 3);
  assert.deepEqual(h.invoke('get-sql-history').map(row => row.sql), ['latest', '日本語']);
  assert.equal(h.invoke('clear-sql-history').length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(h.file, 'utf8')), []);
  assert.deepEqual(fs.readdirSync(h.directory), ['history.json']);
});

for (const original of ['[{"sql":"unfinished', '{"unexpected":"object"}', '[null]']) {
  test('Corrupt SQL history is preserved on reads and additions and can only be replaced by explicit clearing: ' + original.slice(0, 8), t => {
    const h = fixture(t);
    fs.writeFileSync(h.file, original);
    assert.throws(() => h.invoke('get-sql-history'), /SQL history is damaged/);
    assert.throws(() => h.invoke('add-sql-history', entry('replacement')), /SQL history is damaged/);
    assert.equal(fs.readFileSync(h.file, 'utf8'), original);
    const backups = fs.readdirSync(h.directory).filter(name => name.endsWith('.bak'));
    assert.equal(backups.length, 1); assert.equal(fs.readFileSync(path.join(h.directory, backups[0]), 'utf8'), original);
    h.invoke('clear-sql-history');
    assert.deepEqual(JSON.parse(fs.readFileSync(h.file, 'utf8')), []);
    assert.equal(fs.readFileSync(path.join(h.directory, backups[0]), 'utf8'), original);
  });
}

for (const failure of ['writeFileSync', 'fsyncSync', 'renameSync']) {
  test(`Failed SQL history ${failure} preserves old data on both addition and clearing`, t => {
    const h = fixture(t);
    h.invoke('add-sql-history', entry('retained'));
    const original = fs.readFileSync(h.file);
    const { atomicWriteJson } = loadModule('electron/services/jsonFiles.js', {
      './dataSafety': require('../electron/services/dataSafety'),
      'node:fs': { ...fs, [failure]() { throw new Error('Simulated storage failure'); } },
      'node:path': path, 'node:crypto': require('node:crypto')
    });
    const failing = fixture(t, { atomicWriteJson });
    fs.writeFileSync(failing.file, original);
    for (const [command, args] of [['add-sql-history', [entry('new')]], ['clear-sql-history', []]]) {
      assert.throws(() => failing.invoke(command, ...args), /Simulated storage failure/);
      assert.ok(fs.readFileSync(failing.file).equals(original));
      assert.deepEqual(fs.readdirSync(failing.directory), ['history.json']);
    }
  });
}

test('A failed recovery backup prevents explicit clearing from replacing corrupt history', t => {
  const h = fixture(t, { readJsonFile() { throw Object.assign(new Error('Simulated backup failure'), { code: 'EACCES' }); } });
  fs.writeFileSync(h.file, '{original');
  assert.throws(() => h.invoke('clear-sql-history'), /Simulated backup failure/);
  assert.equal(fs.readFileSync(h.file, 'utf8'), '{original');
});

test('SQL history IPC failures notify the renderer and return null without retrying database operations', async () => {
  const calls = [], alerts = [];
  const { invokeSqlHistory } = loadTypeScript('src/features/sql/sqlHistory.ts', {
    '@/shared/api/desktop': { ipcRenderer: { async invoke(...args) { calls.push(args); throw new Error('Simulated history failure'); } } }
  }, { alert: message => alerts.push(message) });
  const t = (key, values) => translate(key, 'en', values);
  assert.equal(await invokeSqlHistory(t, 'get-sql-history'), null);
  assert.equal(await invokeSqlHistory(t, 'add-sql-history', entry('successful SQL')), null);
  assert.equal(await invokeSqlHistory(t, 'clear-sql-history'), null);
  assert.equal(calls.length, 3); assert.equal(alerts.length, 3);
  assert.ok(alerts.every(message => message.includes('Simulated history failure')));
  assert.ok(calls.every(([command]) => command.endsWith('sql-history')));
});
