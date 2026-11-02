// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript: load } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const empty = () => ({ columns: [], primaryKeys: [], foreignKeys: [], tableComments: [], columnComments: [] });
const col = (TABLE_NAME, COLUMN_NAME, TABLE_SCHEMA) => ({ TABLE_NAME, COLUMN_NAME, TABLE_SCHEMA, DATA_TYPE: 'text' });
function diagram(metadata, dependencies = {}, globals = {}) {
  return load('src/features/er/useErDiagramWindow.ts', {
    './erMetadata': { fetchErMetadata: async () => metadata },
    './formatDataType': load('src/features/er/formatDataType.ts'),
    '@/shared/utils/errorUtils': {}, '@/shared/hooks/useLoadingCounter': {}, react: {}, 'react-i18next': {},
    reactflow: {}, 'html-to-image': {}, '../postgresql/windows/common/schemaStorage': {},
    '@/shared/api/desktop': {}, ...dependencies
  }, globals);
}
for (const isPg of [false, true]) {
  test(`${isPg ? 'PostgreSQL' : 'Oracle'}: ER tables, columns, comments and key flags retain exact case`, async () => {
    const metadata = { ...empty(), columns: [col('item', 'id'), col('item', 'ID'), col('ITEM', 'other')],
      primaryKeys: [{ TABLE_NAME: 'item', COLUMN_NAME: 'id' }],
      tableComments: [{ TABLE_NAME: 'item', COMMENTS: 'lower' }, { TABLE_NAME: 'ITEM', COMMENTS: 'upper' }] };
    const { fetchErDiagramData } = diagram(metadata);
    const result = await fetchErDiagramData(isPg, 'MixedSchema', null, true, true, false);
    assert.equal(result.nodes.length, 2);
    const lower = result.nodes.find(n => n.id === 'item'), upper = result.nodes.find(n => n.id === 'ITEM');
    assert.deepEqual(Array.from(lower.data.columns, c => c.name), ['id', 'ID']);
    assert.deepEqual(Array.from(lower.data.columns, c => c.isPk), [true, false]);
    assert.equal(lower.data.tableComment, 'lower'); assert.equal(upper.data.tableComment, 'upper');
    assert.notDeepEqual(lower.position, upper.position);
  });
  test(`${isPg ? 'PostgreSQL' : 'Oracle'}: metadata preserves quoted schema and table identifiers`, async () => {
    const calls = [];
    const { fetchErMetadata } = load('src/features/er/erMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      calls.push(args); return { success: true, rows: [] };
    } } } });
    await fetchErMetadata(isPg, "O'Brien", 'Mixed.Table', true);
    assert.ok(calls.every(([, sql]) => sql.includes("O''Brien")));
    assert.ok(calls.every(([, , binds]) => binds.erTable0 === 'Mixed.Table'));
  });
}
test('Cross-schema parents have distinct nodes, labels, comments and relationship endpoints', async () => {
  const metadata = { ...empty(), columns: [col('parent', 'local', 'test'), col('child', 'ref', 'test'), col('parent', 'external', 'Other')],
    foreignKeys: [{ CHILD_SCHEMA: 'test', CHILD_TABLE: 'child', CHILD_COLUMN: 'ref', PARENT_SCHEMA: 'Other', PARENT_TABLE: 'parent' }],
    tableComments: [{ TABLE_SCHEMA: 'test', TABLE_NAME: 'parent', COMMENTS: 'local' }, { TABLE_SCHEMA: 'Other', TABLE_NAME: 'parent', COMMENTS: 'external' }] };
  const result = await diagram(metadata).fetchErDiagramData(true, 'test', null, true, true, false);
  assert.equal(result.nodes.length, 3);
  const external = result.nodes.find(n => n.data.tableName === 'Other.parent');
  assert.ok(external); assert.notEqual(external.id, 'parent');
  assert.equal(external.data.tableComment, 'external');
  assert.equal(result.edges[0].source, external.id); assert.equal(result.edges[0].target, 'child');
  assert.equal(result.nodes.find(n => n.id === 'parent').data.columns[0].name, 'local');
});
test('External parent metadata is loaded once without recursively expanding foreign keys', async () => {
  const calls = [];
  const { fetchErMetadata } = load('src/features/er/erMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async (_, sql, binds) => {
    calls.push({ sql, binds });
    if (sql.includes('information_schema.columns')) return { success: true, rows: [col('parent', 'id')] };
    if (sql.includes('pg_constraint') && sql.includes("child_ns.nspname = 'test'")) return { success: true, rows: [1, 2].map(() => ({ PARENT_SCHEMA: 'Other', PARENT_TABLE: 'parent', CHILD_TABLE: 'child', CHILD_SCHEMA: 'test', CHILD_COLUMN: 'ref' })) };
    return { success: true, rows: [] };
  } } } });
  const result = await fetchErMetadata(true, 'test', null, false);
  assert.equal(calls.length, 10); assert.equal(result.columns.length, 2);
  assert.ok(result.columns.some(row => row.TABLE_SCHEMA === 'Other'));
});
test('Every failed metadata query rejects the entire snapshot', async () => {
  for (let failure = 0; failure < 5; failure++) {
    let count = 0;
    const { fetchErMetadata } = load('src/features/er/erMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async () => count++ === failure ? { success: false, error: 'Metadata failed' } : { success: true, rows: [] } } } });
    await assert.rejects(fetchErMetadata(true, 'test', null, true), /Metadata failed/);
  }
});
function customHarness(invoke, fetch = async () => ({ nodes: [], edges: [] })) {
  const h = createHookHarness(), alerts = [], calls = [], t = key => key;
  const { useCustomErDiagram } = load('src/features/er/useCustomErDiagram.ts', {
    './erDocument': load('src/features/er/erDocument.ts'),
    './erMetadata': load('src/features/er/erMetadata.ts', { '@/shared/api/desktop': {} }),
    react: h.react, 'react-i18next': { useTranslation: () => ({ t }) }, reactflow: {}, 'html-to-image': {},
    '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => ({ beginLoading() {}, endLoading() {}, isBusy: () => false }) },
    '../postgresql/windows/common/schemaStorage': {},
    './useErDiagramWindow': { fetchErDiagramData: fetch },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return invoke(...args); } } }
  }, { localStorage: { getItem: () => null }, alert: message => alerts.push(message), window: {}, document: {} });
  const render = () => h.render(() => useCustomErDiagram({ isActive: false, dbType: 'postgresql' }));
  render();
  return { render, alerts, calls };
}
test('Failed custom loading preserves the current diagram and its name', async () => {
  let fail = false;
  const old = [{ id: 'item', data: { columns: [] }, position: { x: 1, y: 2 } }];
  const h = customHarness(channel => channel === 'load-er-diagram' ? { success: true, data: JSON.stringify({ version: 2, schema: 'test', nodes: old, edges: [] }) } : fail ? { success: false, error: 'Comments failed' } : { success: true, rows: [] });
  await h.render().handleOpenCustomEr('original.json');
  const before = h.render().customNodes; fail = true;
  await h.render().handleOpenCustomEr('other.json');
  assert.equal(h.render().erDiagramName, 'original'); assert.equal(h.render().customNodes, before);
  assert.equal(h.alerts.length, 1);
});
test('Custom object selection opens without eagerly retrieving an unpaged table list', async () => {
  const h = customHarness(() => { throw new Error('Unexpected eager retrieval'); });
  h.render().handleChangeCustomSchema({ target: { value: "O'Brien" } });
  h.render().handleOpenAddCustomTableDialog();
  assert.equal(h.calls.length, 0); assert.equal(h.render().addTableDialogOpen, true);
});
test('Custom synchronization keeps the previous diagram on failure and treats case-distinct names independently', async () => {
  let fail = false;
  const initial = ['item', 'ITEM'].map(id => ({ id, position: { x: 0, y: 0 }, data: { columns: [] } }));
  const h = customHarness(channel => channel === 'load-er-diagram' ? { success: true, data: JSON.stringify({ version: 2, schema: 'test', nodes: initial, edges: [] }) } : { success: true, rows: [] }, async () => {
    if (fail) throw new Error('Unavailable');
    return { nodes: ['item', 'ITEM'].map(id => ({ id, data: { columns: [{ name: id }], tableComment: id } })), edges: [] };
  });
  h.render().handleChangeCustomSchema({ target: { value: 'test' } });
  await h.render().handleOpenCustomEr('draft.json');
  assert.equal(h.alerts.length, 0); assert.equal(h.render().customNodes.length, 2);
  await h.render().handleSyncWithDatabase();
  assert.ok(h.render().syncPreview);
  assert.equal(h.render().customNodes[0].data.columns.length, 0);
  h.render().handleApplySync();
  assert.deepEqual(Array.from(h.render().customNodes, n => n.data.columns[0].name), ['item', 'ITEM']);
  const before = h.render().customNodes; fail = true;
  await h.render().handleSyncWithDatabase(); assert.equal(h.render().customNodes, before);
});
test('Automatic ER refresh keeps the existing diagram after metadata failure', async () => {
  const h = createHookHarness(), alerts = [], t = key => key;
  let fail = false;
  const module = diagram(empty(), { react: h.react, 'react-i18next': { useTranslation: () => ({ t }) },
    './erMetadata': { fetchErMetadata: async () => { if (fail) throw new Error('Unavailable'); return { ...empty(), columns: [col('item', 'id')] }; } },
    '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => ({ beginLoading() {}, endLoading() {}, isBusy: () => false }) },
    '@/shared/utils/errorUtils': { getErrorMessage: error => error.message }
  }, { localStorage: { getItem: () => null }, alert: message => alerts.push(message) });
  const render = () => h.render(() => module.useErDiagramWindow({ isActive: false, initialSchema: 'test', tableName: 'item' }));
  await render().handleGenerateAutoEr();
  const before = render().nodes;
  assert.equal(before.length, 1); fail = true;
  await render().handleGenerateAutoEr();
  assert.equal(render().nodes, before); assert.equal(alerts.length, 1);
});

test('Schema selection prefers exact names and accepts only unambiguous username fallbacks', () => {
  const { selectErSchema } = load('src/features/er/erMetadata.ts', { '@/shared/api/desktop': {} });
  assert.equal(selectErSchema(['test', 'TEST'], 'TEST'), 'TEST');
  assert.equal(selectErSchema(['test', 'TEST'], 'Test'), '');
  assert.equal(selectErSchema(['TEST'], 'test'), 'TEST');
  assert.equal(selectErSchema(['Mixed'], undefined), '');
});

test('Unavailable external metadata aborts generation instead of showing a misleading local parent', async () => {
  const { fetchErMetadata } = load('src/features/er/erMetadata.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async (_, sql) => {
    if (sql.includes('pg_constraint') && sql.includes("child_ns.nspname = 'test'")) return { success: true, rows: [{ PARENT_SCHEMA: 'Other', PARENT_TABLE: 'parent', CHILD_TABLE: 'child', CHILD_COLUMN: 'ref' }] };
    return { success: true, rows: [] };
  } } } });
  await assert.rejects(fetchErMetadata(true, 'test', null, false), /not accessible/);
});
const erObject = (name, category = 'TABLE', schema = 'test') => ({ dbType: 'postgresql', schema, category, name, key: name, displayName: name });
test('Custom additions accept tables and views with exact names and ignore already placed objects', async () => {
  const h = customHarness(() => ({ success: true }), async (_isPg, _schema, table) => ({
    nodes: [{ id: table, position: { x: 0, y: 0 }, data: { columns: [] } }], edges: []
  }));
  h.render().handleChangeCustomSchema({ target: { value: 'test' } });
  await h.render().handleAddObjectsToCustomCanvas([erObject('item'), erObject('ITEM', 'VIEW')]);
  await h.render().handleAddObjectsToCustomCanvas([erObject('item')]);
  assert.deepEqual(Array.from(h.render().customNodes, node => node.id), ['item', 'ITEM']);
  assert.equal(h.render().isObjectAdded(erObject('ITEM', 'VIEW')), true);
  assert.deepEqual(h.alerts, []);
});
test('Custom batch addition preserves the diagram on metadata failure and rejects another schema', async () => {
  const h = customHarness(() => ({ success: true }), async (_pg, _schema, name) => {
    if (name === 'bad') throw new Error('Unavailable');
    return { nodes: [{ id: name, position: { x: 0, y: 0 }, data: { columns: [] } }], edges: [] };
  });
  h.render().handleChangeCustomSchema({ target: { value: 'test' } });
  await assert.rejects(h.render().handleAddObjectsToCustomCanvas([erObject('good'), erObject('bad', 'VIEW')]), /Unavailable/);
  assert.equal(h.render().customNodes.length, 0);
  await assert.rejects(h.render().handleAddObjectsToCustomCanvas([erObject('other', 'TABLE', 'other')]));
  assert.equal(h.render().customNodes.length, 0);
});

test('Custom synchronization accepts a successfully empty schema while automatic generation still reports no tables', async () => {
  const { fetchErDiagramData } = diagram(empty());
  const custom = await fetchErDiagramData(true, 'test', null, true, true, false, true);
  assert.equal(custom.nodes.length, 0); assert.equal(custom.edges.length, 0);
  await assert.rejects(fetchErDiagramData(true, 'test', null, true, true, false), /No tables found/);
});
