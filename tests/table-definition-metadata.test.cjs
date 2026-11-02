// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createStructureHarness } = require('./helpers/tableData.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

async function oracleFixture() {
  const requests = [];
  const invoke = async (channel, sql, binds) => {
    requests.push({ channel, sql, binds });
    if (channel === 'git-delete-object') return { success: true };
    if (channel === 'execute-sql') return { success: true };
    let rows = [];
    if (/FROM ALL_TAB_COLUMNS/.test(sql)) rows = [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER' }];
    if (/i.INDEX_TYPE/.test(sql)) rows = ['Owner A', 'Owner B'].map(OWNER => ({ OWNER, INDEX_NAME: ' Same Index ', COLUMN_NAME: 'ID', COLUMN_POSITION: 1, INDEX_TYPE: 'NORMAL', VISIBILITY: 'VISIBLE' }));
    if (/FROM ALL_TRIGGERS/.test(sql)) {
      assert.match(sql, /TABLE_OWNER = 'test'/);
      rows = ['Owner A', 'Owner B'].map(OWNER => ({ OWNER, TRIGGER_NAME: ' Same Trigger ', TRIGGER_TYPE: 'BEFORE', TRIGGERING_EVENT: 'INSERT', STATUS: 'ENABLED' }));
    }
    return { success: true, rows };
  };
  const h = await createStructureHarness('oracle', invoke);
  return { h, requests };
}

test('Oracle structure rows preserve owners and distinguish identical names across owners', async () => {
  const { h } = await oracleFixture();
  try {
    assert.equal(h.state.indexRows.length, 2);
    assert.equal(new Set(h.state.indexRows.map(r => r.id)).size, 2);
    assert.equal(new Set(h.state.triggerRows.map(r => r.id)).size, 2);
    assert.deepEqual(Array.from(h.state.indexRows, r => r.OWNER), ['Owner A', 'Owner B']);
  } finally { h.unmount(); }
});

for (const type of ['index', 'trigger']) {
  test(`Oracle ${type} operations and Git/sidebar notifications retain exact owner and name`, async () => {
    const { h, requests } = await oracleFixture();
    try {
      const row = h.state[type === 'index' ? 'indexRows' : 'triggerRows'][1];
      const openMenu = async () => { h.state.handleContextMenu({ preventDefault() {}, clientX: 0, clientY: 0 }, type, row); await h.flush(); };
      await openMenu(); await h.state.handleToggleEnable(); await h.flush();
      assert.equal(requests.find(r => r.channel === 'execute-sql').sql,
        type === 'index' ? 'ALTER INDEX "Owner B"." Same Index " INVISIBLE' : 'ALTER TRIGGER "Owner B"." Same Trigger " DISABLE');
      await openMenu(); await h.state.handleDeleteObject(); await h.flush();
      assert.equal(requests.filter(r => r.channel === 'execute-sql').at(-1).sql,
        type === 'index' ? 'DROP INDEX "Owner B"." Same Index "' : 'DROP TRIGGER "Owner B"." Same Trigger "');
      assert.equal(requests.find(r => r.channel === 'git-delete-object').sql.schema, 'Owner B');
      assert.ok(h.events.some(e => e.type === 'object-deleted' && e.detail.schema === 'Owner B'));
      assert.ok(h.events.filter(e => e.type === 'refresh-sidebar').every(e => e.detail.schema === 'Owner B'));
    } finally { h.unmount(); }
  });
}

test('PostgreSQL structure retains first/composite keys, ordered expressions and separate INCLUDE columns', async () => {
  const h = await createStructureHarness('postgresql', async (_channel, sql) => {
    let rows = [];
    if (/AS "PK_COUNT"/.test(sql)) rows = [
      { COLUMN_NAME: 'before', DATA_TYPE: 'integer', PK_POSITION: 2, PK_COUNT: 2 },
      { COLUMN_NAME: 'after', DATA_TYPE: 'integer', PK_POSITION: 1, PK_COUNT: 2 },
      { COLUMN_NAME: 'meo', DATA_TYPE: 'integer', PK_POSITION: null, PK_COUNT: 2 }
    ];
    if (/AS "COLUMN_POSITION"/.test(sql)) rows = [
      { INDEX_NAME: 'pk', COLUMN_NAME: 'after', COLUMN_DEFINITION: 'after', COLUMN_POSITION: 1, IS_PRIMARY: true, UNIQUENESS: true },
      { INDEX_NAME: 'pk', COLUMN_NAME: 'before', COLUMN_DEFINITION: 'before', COLUMN_POSITION: 2, IS_PRIMARY: true, UNIQUENESS: true },
      { INDEX_NAME: 'pk', COLUMN_NAME: 'meo', COLUMN_DEFINITION: 'meo', COLUMN_POSITION: 3, IS_PRIMARY: true, UNIQUENESS: true, IS_INCLUDED: true },
      { INDEX_NAME: 'expression', COLUMN_NAME: null, COLUMN_DEFINITION: '(before + 1)', COLUMN_POSITION: 1 },
      { INDEX_NAME: 'expression', COLUMN_NAME: 'after', COLUMN_DEFINITION: 'after', COLUMN_POSITION: 2 },
      { INDEX_NAME: 'unique', COLUMN_NAME: 'before', COLUMN_DEFINITION: 'before', COLUMN_POSITION: 1, UNIQUENESS: true },
      { INDEX_NAME: 'unique', COLUMN_NAME: 'meo', COLUMN_DEFINITION: 'meo', COLUMN_POSITION: 2, UNIQUENESS: true, IS_INCLUDED: true }
    ];
    return { success: true, rows };
  });
  try {
    assert.deepEqual(Array.from(h.state.structureRows, r => r.PK_POSITION), [2, 1, '']);
    assert.ok(h.state.structureRows.every(r => r.IS_PK_COMPOSITE));
    assert.deepEqual(Array.from(h.state.structureRows[2].UK_DATA), []);
    assert.equal(h.state.indexRows.find(r => r.INDEX_NAME === 'expression').COLUMNS, '(before + 1)(1), after(2)');
    assert.equal(h.state.indexRows.find(r => r.INDEX_NAME === 'pk').COLUMNS, 'after(1), before(2), meo(3) INCLUDE');
  } finally { h.unmount(); }
});

test('Both PostgreSQL function-list paths identify the built-in trigger type by schema', async () => {
  const Client = loadModule('electron/postgres/postgresClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
  const client = new Client(), requests = [];
  client.client = { query: async sql => { requests.push(sql); return { rows: [] }; } };
  await client.getObjects('test', 'FUNCTION');
  const { invokeDbaRead } = loadTypeScript('src/features/dba/api/dbaBackgroundQueries.ts', {
    i18next: { t: key => key },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, sql) => { requests.push(sql); return { success: true, rows: [] }; } } }
  });
  await invokeDbaRead(true, 'get-objects', 'test', 'FUNCTION');
  assert.equal(requests.length, 2);
  for (const sql of requests) {
    assert.match(sql, /'pg_catalog.trigger'::regtype/);
    assert.doesNotMatch(sql, /SELECT oid FROM pg_type/);
  }
});
