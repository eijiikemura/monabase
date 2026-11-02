// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { snapshotDesktop } = require('./helpers/exportSnapshot.cjs');

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: Sidebar imports preserve the main transaction and database-specific SQL`, async () => {
    const requests = [], loading = [], progress = [];
    const { createSidebarDataTransfer } = loadTypeScript(`src/features/${db}/sidebarDataTransfer.ts`, {
      '@/shared/utils/numberValues': loadTypeScript('src/shared/utils/numberValues.ts'),
      '@/shared/utils/objectIdentity': loadTypeScript('src/shared/utils/objectIdentity.ts'),
    '@/shared/api/desktop': snapshotDesktop(async (...args) => { requests.push(args); return { success: true, rowsAffected: 1 }; }),
      '@/shared/utils/errorUtils': { getErrorMessage: error => error.message },
      '@/shared/utils/dateFormatter': { getOracleDateFormat: value => value, formatDbDate: value => value, getPostgresFormatForValue: value => value }
    }, { alert() {}, window: { dispatchEvent() {} }, CustomEvent: class { constructor(type) { this.type = type; } } });
    const transfer = createSidebarDataTransfer({
      sidebarContextMenu: null, exportTarget: null,
      importTarget: { schema: 'APP', tableName: 'ITEMS', structureDefs: [
        { COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'int', NULLABLE: 'N' },
        { COLUMN_NAME: 'NAME', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'varchar', NULLABLE: 'Y' }
      ] },
      outputDateFormat: 'YYYY-MM-DD', t: key => key,
      setIsLoading: value => loading.push(value), setImportTarget() {}
    });
    const id = '9007199254740993';
    await transfer.processSidebarBulkInsertData([['ID', 'NAME'], [id, "O'Brien"]], (...args) => progress.push(args), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0][0], 'execute-sql');
    assert.ok(requests[0][1].includes(id));
    assert.match(requests[0][1], db === 'oracle' ? /^INSERT ALL/ : /^INSERT INTO/);
    assert.match(requests[0][1], /O''Brien/);
    assert.match(requests[0][1], db === 'oracle' ? /SELECT 1 FROM DUAL/ : /VALUES/);
    assert.equal(progress.at(-1)[0], 100);
    assert.deepEqual(loading, [true, false]);
  });
}

function postgresSidebarHarness({ failMetadata = false, failCount = false } = {}) {
  const requests = [], alerts = [], loading = [];
  const schema = "MiX'ed", tableName = 'Order"Items';
  const structureDefs = ['A"Name', 'B'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'text', NULLABLE: 'Y', DATA_DEFAULT: "'default'" }));
  const { createSidebarDataTransfer } = loadTypeScript('src/features/postgresql/sidebarDataTransfer.ts', {
    '@/shared/api/desktop': snapshotDesktop(async (...args) => {
      requests.push(args);
      if (args[0] === 'execute-sql' && args[1].startsWith('INSERT')) return { success: true, rowsAffected: 3 };
      if (args[0] === 'get-columns') return { success: true, columns: structureDefs.map(column => column.COLUMN_NAME) };
      if (args[0] === 'execute-sql-bg') return failMetadata ? { success: false, error: 'Simulated metadata failure' } : { success: true, rows: structureDefs };
      if (args[1].startsWith('SELECT COUNT')) return failCount ? { success: false, error: 'Simulated count failure' } : { success: true, rows: [{ cnt: '2' }] };
      return { success: true, rows: [{ 'A"Name': 'alpha', B: 'beta' }] };
    })
  }, { alert: message => alerts.push(message), setTimeout: callback => callback(),
    window: { dispatchEvent() {} }, CustomEvent: class {} });
  const context = {
    sidebarContextMenu: { schema, value: tableName, objType: 'TABLE' },
    exportTarget: null, importTarget: null, exportContainerRef: { current: null }, importContainerRef: { current: null },
    outputDateFormat: 'YYYY-MM-DD', t: (key, args) => key + (args?.error || ''),
    setSidebarContextMenu() {}, setExportTarget: target => { context.exportTarget = target; },
    setImportTarget: target => { context.importTarget = target; }, setIsLoading: state => loading.push(state)
  };
  return { schema, tableName, requests, alerts, loading, context, get transfer() { return createSidebarDataTransfer(context); } };
}

test('PostgreSQL sidebar metadata preserves mixed-case and quoted names through background binds', async () => {
  const h = postgresSidebarHarness();
  await h.transfer.handleExportClick();
  assert.equal(h.context.exportTarget.totalCount, 2);
  await h.transfer.handleImportClick();
  assert.equal(h.context.importTarget.tableName, h.tableName);
  for (const [channel, query, binds] of h.requests.filter(request => request[0] === 'execute-sql-bg')) {
    assert.equal(channel, 'execute-sql-bg');
    assert.match(query, /ns.nspname = :schema AND tab.relname = :tableName/);
    assert.equal(binds.schema, h.schema); assert.equal(binds.tableName, h.tableName);
    assert.ok(!query.includes(h.schema)); assert.ok(!query.includes(h.tableName));
  }
  const count = h.requests.find(request => request[1]?.startsWith('SELECT COUNT'));
  assert.equal(count[1], 'SELECT COUNT(*) AS cnt FROM "MiX\'ed"."Order""Items"');
  const rows = await h.transfer.fetchExportDataChunk(0, 50);
  assert.equal(rows[0]['A"Name'], 'alpha');
  assert.equal(h.alerts.length, 0);
});

test('PostgreSQL sidebar import retains column alignment, quoted columns, and all-default rows', async () => {
  const h = postgresSidebarHarness();
  await h.transfer.handleImportClick();
  await h.transfer.processSidebarBulkInsertData([['A"Name', 'B'], ['alpha', ''], ['', 'beta'], ['', '']], () => {}, true);
  const inserts = h.requests.filter(request => request[0] === 'execute-sql' && request[1].startsWith('INSERT'));
  assert.equal(inserts.length, 1);
  assert.match(inserts[0][1], /\("A""Name", "B"\)/);
  assert.match(inserts[0][1], /\('alpha', DEFAULT\),\n\(DEFAULT, 'beta'\),\n\(DEFAULT, DEFAULT\)/);
});

test('PostgreSQL sidebar export/import surfaces metadata and row-count failures', async () => {
  const metadata = postgresSidebarHarness({ failMetadata: true });
  await metadata.transfer.handleExportClick(); await metadata.transfer.handleImportClick();
  assert.equal(metadata.context.exportTarget, null); assert.equal(metadata.context.importTarget, null);
  assert.equal(metadata.alerts.length, 2);
  assert.ok(metadata.alerts[0].includes('Simulated metadata failure'));
  const count = postgresSidebarHarness({ failCount: true });
  await count.transfer.handleExportClick();
  assert.equal(count.context.exportTarget, null); assert.equal(count.alerts.length, 1);
  assert.ok(count.alerts[0].includes('Simulated count failure'));
  assert.equal(count.loading.at(-1), false);
});

test('PostgreSQL DBA object reads bind the selected schema without changing its case', async () => {
  const requests = [];
  const { invokeDbaRead } = loadTypeScript('src/features/dba/api/dbaBackgroundQueries.ts', {
    i18next: { t: key => key }, '@/shared/api/desktop': snapshotDesktop(async (...args) => {
      requests.push(args); return { success: true, rows: [{ OBJECT_NAME: 'OrderItems' }] };
    })
  });
  const result = await invokeDbaRead(true, 'get-objects', "Team's Data", 'TABLE');
  assert.equal(result.success, true); assert.equal(result.objects[0].name, 'OrderItems');
  assert.equal(requests[0][0], 'execute-sql-bg'); assert.equal(requests[0][2].owner, "Team's Data");
  assert.ok(!requests[0][1].includes("Team's Data"));
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: sidebar exports preserve real ID columns without adding display identifiers`, async () => {
    const original = { id: '9007199254740993', __row_id: 'business row', ORACLE_ROWID: 'business value', ID: 'upper ID' };
    const calls = [];
    const { createSidebarDataTransfer } = loadTypeScript(`src/features/${db}/sidebarDataTransfer.ts`, {
      '@/shared/api/desktop': snapshotDesktop(async (...args) => { calls.push(args); return { success: true, rows: [original] }; })
    });
    const transfer = createSidebarDataTransfer({ exportTarget: { schema: 'TEST', tableName: 'ITEMS', structureDefs: Object.keys(original).map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'varchar' })) }, t: key => key });
    const rows = await transfer.fetchExportDataChunk(0, 5000);
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0])), original);
    assert.notEqual(rows[0], original);
    assert.equal(calls[0][0], 'execute-sql');
    assert.ok(!calls[0][1].includes('ROWID AS ORACLE_ROWID'));
  });
}
test('PostgreSQL sidebar exports preserve NULL independently in case-distinct date columns', async () => {
  const source = [{ day: '2026-10-22', DAY: null }, { day: null, DAY: '2026-10-23' }];
  const before = JSON.stringify(source);
  const { createSidebarDataTransfer } = loadTypeScript('src/features/postgresql/sidebarDataTransfer.ts', {
    '@/shared/api/desktop': snapshotDesktop(async () => ({ success: true, rows: source }))
  });
  const rows = await createSidebarDataTransfer({ exportTarget: { schema: 'test', tableName: 'items',
    structureDefs: ['day', 'DAY'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'date' })) }, outputDateFormat: 'YYYY-MM-DD', t: key => key }).fetchExportDataChunk(0, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ day: '2026-10-22', DAY: '' }, { day: '', DAY: '2026-10-23' }]);
  assert.equal(JSON.stringify(source), before);
});

function oraclePreparationHarness(options = {}) {
  const requests = [], alerts = [], loading = [], opened = [];
  const schema = "MiX'ed", tableName = 'Order\'Items"Mix';
  const columns = options.columns || [{ COLUMN_NAME: 'Id Key', DATA_TYPE: 'NUMBER', NULLABLE: 'N' }];
  const { createSidebarDataTransfer } = loadTypeScript('src/features/oracle/sidebarDataTransfer.ts', {
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      requests.push(args);
      const [channel, query] = args;
      const phase = channel === 'get-columns' ? 'columns' : channel === 'execute-sql' ? 'count' : query.includes('ALL_CONSTRAINTS') ? 'primaryKey' : 'metadata';
      if (options.fail === phase) return { success: false, error: `Simulated ${phase} failure` };
      if (phase === 'columns') return { success: true, columns: columns.map(col => col.COLUMN_NAME) };
      if (phase === 'primaryKey') return { success: true, rows: options.noPrimaryKey ? [] : [{ COLUMN_NAME: 'Id Key', POSITION: 1 }] };
      if (phase === 'count') return { success: true, rows: options.countRows ?? [{ CNT: '2' }] };
      return { success: true, rows: columns };
    } } }
  }, { alert: message => alerts.push(message), setTimeout: callback => callback() });
  const oldExport = { previous: 'export' }, oldImport = { previous: 'import' };
  const context = { sidebarContextMenu: { schema, value: tableName, objType: 'TABLE' }, exportTarget: oldExport, importTarget: oldImport,
    exportContainerRef: { current: { querySelector: () => ({ click: () => opened.push('export') }) } },
    importContainerRef: { current: { querySelector: () => ({ click: () => opened.push('import') }) } },
    setSidebarContextMenu() {}, setIsLoading: value => loading.push(value),
    setExportTarget: value => { context.exportTarget = value; }, setImportTarget: value => { context.importTarget = value; },
    t: (key, values) => key + (values?.error || '') };
  return { requests, alerts, loading, opened, context, schema, tableName, oldExport, oldImport,
    get transfer() { return createSidebarDataTransfer(context); } };
}
test('Oracle preparation binds exact schema/table names for all column and primary-key lookups', async () => {
  const h = oraclePreparationHarness();
  await h.transfer.handleExportClick(); await h.transfer.handleImportClick();
  assert.deepEqual(h.opened, ['export', 'import']); assert.equal(h.alerts.length, 0);
  const background = h.requests.filter(request => request[0] === 'execute-sql-bg'); assert.equal(background.length, 3);
  for (const [, sql, binds] of background) {
    assert.equal(binds.schema, h.schema); assert.equal(binds.tableName, h.tableName);
    assert.match(sql, /TABLE_NAME = :tableName/); assert.match(sql, /OWNER = :schema/);
    assert.ok(!sql.includes(h.schema)); assert.ok(!sql.includes(h.tableName));
  }
  assert.equal(h.context.exportTarget.totalCount, 2); assert.equal(h.context.importTarget.structureDefs[0].PK_POSITION, 1);
  assert.ok(h.requests.find(request => request[0] === 'execute-sql')[1].includes('"Order\'Items""Mix"'));
});
for (const fail of ['columns', 'metadata', 'count']) {
  test(`Oracle export preparation reports ${fail} failure without opening or replacing the target`, async () => {
    const h = oraclePreparationHarness({ fail }); await h.transfer.handleExportClick();
    assert.equal(h.context.exportTarget, h.oldExport); assert.deepEqual(h.opened, []);
    assert.equal(h.alerts.length, 1); assert.ok(h.alerts[0].includes(`Simulated ${fail} failure`));
    assert.deepEqual(h.loading, [true, false]);
    if (fail !== 'count') assert.ok(!h.requests.some(request => request[0] === 'execute-sql'));
  });
}
for (const fail of ['metadata', 'primaryKey']) {
  test(`Oracle import preparation reports ${fail} failure without opening or replacing the target`, async () => {
    const h = oraclePreparationHarness({ fail }); await h.transfer.handleImportClick();
    assert.equal(h.context.importTarget, h.oldImport); assert.deepEqual(h.opened, []);
    assert.equal(h.alerts.length, 1); assert.ok(h.alerts[0].includes(`Simulated ${fail} failure`));
    assert.deepEqual(h.loading, [true, false]);
  });
}
test('Oracle export preparation rejects missing, blank, negative, fractional and unsafe counts', async () => {
  for (const countRows of [[], [{}], [{ CNT: null }], [{ CNT: '' }], [{ CNT: -1 }], [{ CNT: 'NaN' }], [{ CNT: '1.5' }], [{ CNT: '9007199254740993' }]]) {
    const h = oraclePreparationHarness({ countRows }); await h.transfer.handleExportClick();
    assert.equal(h.context.exportTarget, h.oldExport); assert.deepEqual(h.opened, []);
    assert.equal(h.alerts.length, 1); assert.ok(h.alerts[0].includes('failed_to_fetch_row_count'));
  }
});
test('Oracle preparation distinguishes a valid empty table or absent primary key from failed retrieval', async () => {
  const h = oraclePreparationHarness({ countRows: [{ CNT: '0' }], noPrimaryKey: true });
  await h.transfer.handleExportClick(); await h.transfer.handleImportClick();
  assert.equal(h.context.exportTarget.totalCount, 0); assert.equal(h.context.importTarget.structureDefs[0].PK_POSITION, '');
  assert.deepEqual(h.opened, ['export', 'import']); assert.equal(h.alerts.length, 0);
});
test('Oracle preparation refuses empty column metadata', async () => {
  const h = oraclePreparationHarness({ columns: [] });
  await h.transfer.handleExportClick(); await h.transfer.handleImportClick();
  assert.deepEqual(h.opened, []); assert.equal(h.alerts.length, 2);
  assert.equal(h.context.exportTarget, h.oldExport); assert.equal(h.context.importTarget, h.oldImport);
});
test('Oracle preparation keeps unsupported binary table checks after metadata validation', async () => {
  const h = oraclePreparationHarness({ columns: [{ COLUMN_NAME: 'BINARY', DATA_TYPE: 'BLOB' }] });
  await h.transfer.handleExportClick(); await h.transfer.handleImportClick();
  assert.deepEqual(h.opened, []); assert.equal(h.alerts.length, 2);
  assert.ok(!h.requests.some(request => request[0] === 'execute-sql'));
});
