// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { createExportSnapshots } = require('../electron/services/exportSnapshots');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { snapshotDesktop } = require('./helpers/exportSnapshot.cjs');

function setup(options = {}) {
  const owner = new EventEmitter(), calls = [];
  let client = { async execute(...args) { calls.push(args); return { rows: [{ id: 1 }, { id: 2 }] }; } };
  const snapshots = createExportSnapshots({ getClient: () => client, getDialect: () => 'postgresql', t: key => key, ...options });
  return { owner, calls, snapshots, replace: next => { client = next; } };
}
test('Snapshot reads reuse a single main-connection statement without transaction commands', async () => {
  const h = setup(), sql = 'SELECT * FROM items ORDER BY id';
  const result = await h.snapshots.open(h.owner, sql);
  assert.equal(result.rowCount, 2);
  assert.deepEqual(h.calls, [[sql, {}, null, false, false]]);
  assert.deepEqual(h.snapshots.read(h.owner, result.exportId, 0, 1), { rows: [{ id: 1 }], done: false });
  assert.deepEqual(h.snapshots.read(h.owner, result.exportId, 1, 1), { rows: [{ id: 2 }], done: true });
  assert.throws(() => h.snapshots.read(h.owner, result.exportId, 0, 1), /unavailable/);
  h.snapshots.close(h.owner, result.exportId);
  assert.equal(h.owner.listenerCount('destroyed'), 0); assert.equal(h.calls.length, 1);
});
test('Snapshots enforce sender ownership, chunk bounds and read-only SQL', async () => {
  const h = setup();
  for (const query of ['DELETE FROM items', 'SELECT 1; SELECT 2', 'SELECT * FROM items FOR UPDATE']) {
    await assert.rejects(h.snapshots.open(h.owner, query), /read_only/);
  }
  const { exportId } = await h.snapshots.open(h.owner, 'SELECT * FROM items');
  const other = new EventEmitter();
  assert.throws(() => h.snapshots.read(other, exportId, 0, 1), /unavailable/);
  assert.throws(() => h.snapshots.close(other, exportId), /unavailable/);
  for (const [offset, limit] of [[-1, 1], [0, 0], [0, 5001], [0.5, 1], [0, NaN]]) {
    assert.throws(() => h.snapshots.read(h.owner, exportId, offset, limit), /range/);
  }
  h.snapshots.close(h.owner, exportId); assert.equal(h.owner.listenerCount('destroyed'), 0);
});
for (const action of ['clear', 'destroy', 'replace', 'reopen']) {
  test(`Snapshot cleanup rejects stale reads after ${action}`, async () => {
    const h = setup(), { exportId } = await h.snapshots.open(h.owner, 'SELECT * FROM items');
    if (action === 'clear') h.snapshots.clear();
    if (action === 'destroy') h.owner.emit('destroyed');
    if (action === 'replace') h.replace({});
    if (action === 'reopen') await h.snapshots.open(h.owner, 'SELECT * FROM items');
    assert.throws(() => h.snapshots.read(h.owner, exportId, 0, 1), /unavailable/);
    h.snapshots.clear(); assert.equal(h.owner.listenerCount('destroyed'), 0);
  });
}
test('Idle snapshots expire and release their renderer listener', async () => {
  const h = setup({ idleTimeoutMs: 5 });
  const { exportId } = await h.snapshots.open(h.owner, 'SELECT * FROM items');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.throws(() => h.snapshots.read(h.owner, exportId, 0, 1), /unavailable/);
  assert.equal(h.owner.listenerCount('destroyed'), 0);
});
test('Failed and interrupted opens cannot publish stale results or leak listeners', async () => {
  for (const action of ['clear', 'destroy', 'replace', 'reopen', 'fail']) {
    let resolve, reject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; });
    const h = setup({ getClient: () => client });
    let client = { execute: () => result };
    const opening = h.snapshots.open(h.owner, 'SELECT * FROM items');
    const rejected = assert.rejects(opening, action === 'fail' ? /Query failed/ : /unavailable/);
    if (action === 'clear') h.snapshots.clear();
    if (action === 'destroy') h.owner.emit('destroyed');
    if (action === 'replace') client = {};
    if (action === 'reopen') {
      client.execute = async () => ({ rows: [] });
      const next = await h.snapshots.open(h.owner, 'SELECT * FROM items');
      assert.equal(next.rowCount, 0);
    }
    if (action === 'fail') reject(new Error('Query failed')); else resolve({ rows: [{ id: 1 }] });
    await rejected; h.snapshots.clear(); assert.equal(h.owner.listenerCount('destroyed'), 0);
  }
});
test('Database IPC releases snapshots on disconnect and connection replacement', async () => {
  const handlers = new Map(), sender = new EventEmitter();
  class Client { async execute() { return { rows: [{ id: 1 }, { id: 2 }] }; } async connect() {} async disconnect() {} }
  const state = { client: new Client(), type: 'postgresql' };
  const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', {
    '../oracle/traceDb': {}, '../postgres/traceDb': {}, '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {},
    '../oracle/oracleClient': Client, '../postgres/postgresClient': Client
  }, {}, { strict: false });
  registerDatabaseHandlers({ state, ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) }, getValidatedSettings: () => ({}), t: key => key });
  const invoke = (channel, ...args) => handlers.get(channel)({ sender }, ...args);
  for (const action of ['connect-db', 'disconnect-db']) {
    const opened = await invoke('open-data-export', 'SELECT * FROM items'); assert.equal(opened.success, true);
    assert.equal((await invoke('read-data-export', opened.exportId, 0, 1)).done, false);
    await invoke(action, { dbType: 'postgresql' });
    assert.equal((await invoke('read-data-export', opened.exportId, 1, 1)).success, false);
    assert.equal(sender.listenerCount('destroyed'), 0);
  }
});
test('Renderer fetchers start a fresh snapshot when reused after completion', async () => {
  const requests = [];
  const { createExportSnapshotFetcher } = loadTypeScript('src/features/table/exportSnapshot.ts', {
    '@/shared/api/desktop': snapshotDesktop(async (...args) => { requests.push(args); return { success: true, rows: [{ id: requests.length }] }; })
  });
  const fetch = createExportSnapshotFetcher(() => 'SELECT * FROM items');
  assert.equal((await fetch(0, 5000))[0].id, 1);
  assert.equal((await fetch(1, 5000)).length, 0);
  await fetch.close();
  assert.equal((await fetch(0, 5000))[0].id, 2); await fetch.close();
  assert.equal(requests.length, 2);
});
test('Renderer fetchers release failed reads or formatting and can retry after a failed open', async () => {
  for (const failure of ['open', 'read', 'format']) {
    const calls = [], desktop = snapshotDesktop(async () => ({ success: true, rows: [{ id: 1 }, { id: 2 }] }));
    let failing = true;
    const { createExportSnapshotFetcher } = loadTypeScript('src/features/table/exportSnapshot.ts', {
      '@/shared/api/desktop': { ipcRenderer: { async invoke(channel, ...args) {
        calls.push(channel);
        if (failing && channel === `${failure}-data-export`) return { success: false, error: 'Transfer failed' };
        return desktop.ipcRenderer.invoke(channel, ...args);
      } } }
    });
    const fetch = createExportSnapshotFetcher(() => 'SELECT * FROM items', rows => {
      if (failing && failure === 'format') throw new Error('Formatting failed');
      return rows;
    });
    await assert.rejects(fetch(0, 1), /failed/);
    await fetch.close();
    assert.equal(calls.includes('close-data-export'), failure !== 'open');
    failing = false;
    assert.equal((await fetch(0, 5000)).length, 2); await fetch.close(); desktop.close();
  }
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: view exports retain real IDs and filters without paged queries`, async () => {
    const h = createHookHarness(), requests = [];
    const { useViewDataTab } = loadTypeScript(`src/features/${db}/windows/view/useViewDataTab.ts`, {
      react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
      '@/features/data-grid/dataGridHelper': { buildGridColumns: () => [], buildTransposedColumns: () => [] },
      '@/shared/api/desktop': snapshotDesktop(async (...args) => {
        if (args[0] === 'get-columns') return { success: true, columns: ['id'] };
        if (args[0] === 'execute-sql-bg') return { success: true, rows: [{ COLUMN_NAME: 'id', DATA_TYPE: 'NUMBER' }] };
        requests.push(args); return { success: true, rows: [{ id: '9007199254740993', ID: 'upper' }] };
      }, db)
    }, { window: { addEventListener() {}, removeEventListener() {} } });
    h.render(() => useViewDataTab({ schema: 'test', viewName: 'View"Items', isActive: true }));
    h.commit(); await h.settle();
    for (const [key, value] of Object.entries({ operator: '=', value: '7', sort: '1 DESC', type: 'NUMBER' })) {
      const result = h.render(() => useViewDataTab({ schema: 'test', viewName: 'View"Items', isActive: false }));
      result.handleConditionChange('id', key, value);
    }
    const current = h.render(() => useViewDataTab({ schema: 'test', viewName: 'View"Items', isActive: false }));
    const rows = await current.fetchDataForExport(0, 5000);
    assert.equal(rows[0].id, '9007199254740993'); assert.equal(rows[0].ID, 'upper');
    assert.equal(requests.length, 1); assert.match(requests[0][1], /"test"\."View""Items"/);
    assert.match(requests[0][1], /WHERE/); assert.match(requests[0][1], /ORDER BY/);
    assert.ok(!/OFFSET|FETCH NEXT|LIMIT/.test(requests[0][1]));
    await current.fetchDataForExport.close(); h.unmount();
  });
}
