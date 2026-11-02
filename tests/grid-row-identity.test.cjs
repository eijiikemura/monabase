// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript: load } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const identities = load('src/features/data-grid/rowIdentity.ts');
const { withRowIdentity, getRowIdentity, getOracleRowId, preserveRowIdentity, oracleRowIdAlias, identifyOracleRow } = identities;
const { createRowsInternalCache } = require('../node_modules/@mui/x-data-grid/node/hooks/features/rows/gridRowsUtils.js');
const plain = value => JSON.parse(JSON.stringify(value));
const t = key => key;

test('Grid metadata cannot collide with SQL columns and survives row copies without entering JSON', () => {
  const data = { id: null, __row_id: 0, ORACLE_ROWID: 'business', '__MONABASE_ROWID': 'also business' };
  const row = withRowIdentity(data, 0, 'physical');
  assert.equal(getRowIdentity(row), 0); assert.equal(getOracleRowId(row), 'physical');
  assert.equal(getRowIdentity({ ...row }), 0); assert.deepEqual(plain(row), data);
  const edited = preserveRowIdentity({ ...data, id: 'changed' }, row);
  assert.equal(getRowIdentity(edited), 0); assert.equal(getOracleRowId(edited), 'physical'); assert.equal(edited.id, 'changed');
  assert.throws(() => getOracleRowId({ ORACLE_ROWID: 'untrusted business column' }), /missing its Oracle/);
});
test('Oracle ROWID aliases avoid real columns and are removed without losing business values', () => {
  const data = { id: 7, ORACLE_ROWID: 'business', __MONABASE_ROWID: 'first', __MONABASE_ROWID_: 'second' };
  const alias = oracleRowIdAlias(Object.keys(data)); assert.equal(alias, '__MONABASE_ROWID_1');
  const row = identifyOracleRow({ ...data, [alias]: 'physical' }, alias, 3);
  assert.deepEqual(plain(row), data); assert.equal(getRowIdentity(row), 3); assert.equal(getOracleRowId(row), 'physical');
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: SQL results with duplicate, NULL and zero business IDs retain all grid records`, async () => {
    const h = createHookHarness();
    const source = [{ id: 0, __row_id: 8, value: 'first' }, { id: 0, __row_id: 8, value: 'second' }, { id: null, __row_id: null, value: 'third' }];
    const { useSqlWindow } = load(`src/features/${db}/windows/sql/useSqlWindow.ts`, {
      './sqlScript': load('src/features/sql/sqlScript.ts'), react: h.react, 'react-i18next': { useTranslation: () => ({ t }) }, 'sql-formatter': {}, '@codemirror/view': {},
      '../common/schemaStorage': { savePgSelectSchema() {} }, '@/features/data-grid/rowIdentity': identities,
      '@/features/data-grid/dataGridHelper': { buildGridColumns: metadata => metadata.map(col => ({ field: col.name })) },
      '@/features/sql/sqlHistory': { invokeSqlHistory: async () => [], invokeSqlHistoryWhen: async () => [] },
      '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
      '@/shared/api/desktop': { beginGlobalLoading: () => () => {}, ipcRenderer: { invoke: async (channel, statements, dialect) => channel === 'inspect-sql-privacy' ? statements.map(sql => require('../electron/services/sqlPrivacy').inspectSqlPrivacy(sql, dialect)) : ({ success: true, rows: source, metaData: Object.keys(source[0]).map(name => ({ name })), executionTime: 1 }) } }
    }, { crypto: require('node:crypto').webcrypto, window: { innerHeight: 800, dispatchEvent() {} }, CustomEvent: class {}, alert(message) { throw new Error(message); } });
    const render = () => h.render(() => useSqlWindow({ initialSql: 'SELECT * FROM demo', isActive: false, dateFormat: 'YYYY-MM-DD' }));
    if (db === 'postgresql') render().setSelectedSchema('test');
    await render().handleExecuteSql();
    const rows = render().rows;
    assert.deepEqual(plain(rows), source);
    const cache = createRowsInternalCache({ rows, getRowId: getRowIdentity, loading: false, rowCount: 3 });
    assert.equal(Object.keys(cache.dataRowIdToModelLookup).length, 3);
    assert.equal(new Set(rows.map(getRowIdentity)).size, 3);
  });
}
async function tableHarness(db, options = {}) {
  let releaseMetadata;
  const h = createHookHarness(), requests = [], alerts = [], listeners = new Map();
  const source = [11, 22].map((key, i) => ({ key, id: 0, __row_id: 'same', ORACLE_ROWID: 'business', __MONABASE_ROWID: 'real alias',
    label: `record${key}`, day: i === 0 ? '2026-10-22' : null, DAY: i === 1 ? '2026-10-23' : null }));
  const defs = Object.keys(source[0]).map(COLUMN_NAME => ({ COLUMN_NAME,
    DATA_TYPE: ['day', 'DAY'].includes(COLUMN_NAME) ? (db === 'oracle' ? 'DATE' : 'date') : COLUMN_NAME === 'key' ? (db === 'oracle' ? 'NUMBER' : 'integer') : (db === 'oracle' ? 'VARCHAR2' : 'varchar'), PK_POSITION: COLUMN_NAME === 'key' ? 1 : '' }));
  const desktop = { ipcRenderer: { invoke: async (...args) => {
    requests.push(args); const [channel, sql] = args;
    if (channel === 'execute-sql-bg') {
      if (options.pauseMetadata) return new Promise(resolve => { releaseMetadata = () => resolve({ success: true, rows: defs }); });
      return { success: true, rows: options.emptyMetadata ? [] : defs };
    }
    if (/COUNT\(\*\)/.test(sql)) return { success: true, rows: [{ CNT: 2, cnt: 2 }] };
    if (/^(UPDATE|DELETE)/.test(sql)) return { success: true, rows: [], rowsAffected: 1 };
    const alias = /t\.ROWID AS "([^"]+)"/.exec(sql)?.[1];
    return { success: true, rows: source.map(row => ({ ...row, ...(alias ? { [alias]: `PHYSICAL_${row.key}` } : {}) })),
      metaData: [...defs.map(col => ({ name: col.COLUMN_NAME })), ...(alias ? [{ name: alias }] : [])] };
  } } };
  const dependencies = { './sqlScript': load('src/features/sql/sqlScript.ts'), react: h.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/features/data-grid/rowIdentity': identities, '@/shared/api/desktop': { ...desktop, beginGlobalLoading: () => () => {} },
    '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
    '@/shared/hooks/useEventCallback': load('src/shared/hooks/useEventCallback.ts', { react: h.react }),
    '@/features/data-grid/dataGridHelper': { buildGridColumns: metadata => metadata.map(col => ({ field: col.name })), buildTransposedColumns: () => [] },
    '@/features/data-grid/tableResultHeaders': { decorateTableResultColumns: columns => columns }
  };
  for (const file of ['tableQueryBuilder', 'tableDataTransfer', 'tableRecordEditor']) {
    dependencies[`./${file}`] = load(`src/features/${db}/windows/table/${file}.ts`, dependencies, { alert: message => alerts.push(message), window: { confirm: () => true } });
  }
  if (db === 'postgresql') dependencies['./tableResultRows'] = load('src/features/postgresql/windows/table/tableResultRows.ts', dependencies);
  const { useTableDataTab } = load(`src/features/${db}/windows/table/useTableDataTab.ts`, dependencies, {
    window: { addEventListener(type, handler) { listeners.set(type, handler); }, removeEventListener() {}, dispatchEvent() {}, getSelection() {}, confirm: () => true },
    alert: message => alerts.push(message), CustomEvent: class {}
  });
  const render = () => h.render(() => useTableDataTab({ schema: 'TEST', tableName: 'ITEMS', isActive: true, outputDateFormat: 'YYYY-MM-DD', inputDateFormat: 'YYYY-MM-DD' }));
  render(); h.commit(); await h.settle(); render(); h.commit(); await h.settle(); render();
  return { render, h, requests, alerts, source, listeners, releaseMetadata: () => releaseMetadata() };
}
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: table selection, duplication, updates and deletion target internal row identities`, async () => {
    const h = await tableHarness(db), initial = h.render().displayRows;
    assert.equal(initial.length, 2); assert.equal(initial[0].id, 0); assert.equal(initial[0].__row_id, 'same'); assert.equal(initial[0].ORACLE_ROWID, 'business');
    assert.notEqual(getRowIdentity(initial[0]), getRowIdentity(initial[1]));
    assert.equal(initial[0].DAY, ''); assert.equal(initial[1].day, '');
    h.render().handleRowClick({ id: getRowIdentity(initial[1]) }, {});
    h.render().handleDuplicateSelected(); assert.equal(h.render().recordDialog.recordData.label, 'record22');
    h.render().handleEditSelected(); assert.equal(h.render().recordDialog.recordData.label, 'record22');
    if (db === 'oracle') assert.equal(h.render().recordDialog.targetRowId, 'PHYSICAL_22');
    const edited = await h.render().handleProcessRowUpdate({ ...initial[1], label: 'edited' }, initial[1]);
    assert.equal(getRowIdentity(edited), getRowIdentity(initial[1]));
    const update = h.requests.find(args => /^UPDATE /.test(args[1]));
    assert.match(update[1], db === 'oracle' ? /WHERE ROWID = 'PHYSICAL_22'/ : /WHERE "key" = 22/);
    assert.equal(h.render().displayRows[0].label, 'record11'); assert.equal(h.render().displayRows[1].label, 'edited');
    await h.render().handleDeleteSelected();
    const deletion = h.requests.find(args => /^DELETE /.test(args[1]));
    assert.match(deletion[1], db === 'oracle' ? /ROWID IN \('PHYSICAL_22'\)/ : /WHERE "key" = 22/);
    assert.ok(!deletion[1].includes('business'));
  });
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: refreshing a table clears selection before reusing page identities`, async () => {
    const h = await tableHarness(db);
    h.render().handleRowClick({ id: getRowIdentity(h.render().displayRows[1]) }, {});
    assert.equal(h.render().selectedRowIds.length, 1);
    h.listeners.get('reload-source')({ detail: { schema: 'TEST', tableName: 'ITEMS' } });
    h.render(); h.h.commit();
    assert.equal(h.render().selectedRowIds.length, 1, 'Keep the selection while the old rows are still displayed');
    await h.h.settle(); h.render(); h.h.commit(); await h.h.settle();
    assert.equal(h.render().selectedRowIds.length, 0, 'Clear selection when refreshed rows replace page identities');
  });
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: query builder results preserve duplicate business IDs with separate grid IDs`, async () => {
    const h = createHookHarness();
    const source = [{ id: 0, __row_id: 'same', value: 'first' }, { id: 0, __row_id: 'same', value: 'second' }];
    const { useQueryBuilderWindow } = load(`src/features/${db}/windows/builder/useQueryBuilderWindow.ts`, {
      './sqlScript': load('src/features/sql/sqlScript.ts'), react: h.react, 'react-i18next': { useTranslation: () => ({ t }) },
      '@/features/data-grid/rowIdentity': identities, '../common/ddlHelper': {}, '../common/schemaStorage': {},
      '@/features/ai/useQueryBuilderAi': { useQueryBuilderAi: () => ({}) },
      '@/features/sql/sqlHistory': { invokeSqlHistory: async () => [], invokeSqlHistoryWhen: async () => [] },
      '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
      '@/shared/api/desktop': { beginGlobalLoading: () => () => {}, ipcRenderer: { invoke: async (channel, statements, dialect) => channel === 'inspect-sql-privacy' ? statements.map(sql => require('../electron/services/sqlPrivacy').inspectSqlPrivacy(sql, dialect)) : ({ success: true, rows: source, metaData: [{ name: 'id' }, { name: '__row_id' }, { name: 'value' }], executionTime: 1 }) } }
    }, { crypto: require('node:crypto').webcrypto, window: { innerHeight: 800 }, alert(message) { throw new Error(message); } });
    const render = () => h.render(() => useQueryBuilderWindow({ isActive: false, dateFormat: 'YYYY-MM-DD' }));
    render().setSqlText('SELECT * FROM demo'); await render().handleExecuteSql();
    assert.deepEqual(plain(render().rows), source);
    assert.equal(new Set(render().rows.map(getRowIdentity)).size, 2);
  });
}

test('Oracle metadata completion after unmount does not start count or data queries', async () => {
  const h = await tableHarness('oracle', { pauseMetadata: true });
  h.h.unmount(); h.releaseMetadata(); await h.h.settle();
  assert.equal(h.requests.filter(request => request[0] === 'execute-sql').length, 0);
});

test('Oracle does not select a ROWID alias without verified column metadata', async () => {
  const h = await tableHarness('oracle', { emptyMetadata: true });
  assert.equal(h.requests.filter(request => request[0] === 'execute-sql').length, 0);
  await h.render().executeSearch({}, 0, 50);
  assert.equal(h.requests.filter(request => request[0] === 'execute-sql').length, 0);
  assert.ok(h.alerts.some(message => message.includes('failed_to_fetch_table_structure')));
});
