// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { snapshotDesktop } = require('./helpers/exportSnapshot.cjs');
const { translate } = require('../electron/i18n');

for (const database of ['oracle', 'postgresql']) {
  function setup(overrides = {}, rowsAffected = 2) {
    const calls = [], logs = [], loading = [];
    const { createTableDataTransfer } = loadTypeScript(`src/features/${database}/windows/table/tableDataTransfer.ts`, {
      '@/shared/utils/objectIdentity': loadTypeScript('src/shared/utils/objectIdentity.ts'),
    '@/shared/api/desktop': snapshotDesktop(async (...args) => { calls.push(args); return { success: true, rows: [], rowsAffected }; }),
      '@/shared/utils/dateFormatter': { formatDbDate: value => value },
      '@/shared/utils/errorUtils': { getErrorMessage: error => error.message }
    }, { alert() {} });
    const transfer = createTableDataTransfer({
      schema: 'TEST', tableName: 'ITEMS', outputDateFormat: 'YYYY-MM-DD',
      structureDefs: [{ COLUMN_NAME: 'ID', DATA_TYPE: database === 'oracle' ? 'NUMBER' : 'integer', NULLABLE: 'N' }],
      resultColumns: [{ field: 'ID' }], conditions: {}, paginationModel: { page: 0, pageSize: 50 },
      t: (key, values) => translate(key, 'en', values), formatSqlValue: (_column, value) => Number(value),
      buildQueryStrings: () => ({ whereStr: '', orderStr: '' }), executeSearch: async () => {},
      setIsLoading: state => loading.push(state), setLogs: update => logs.push(update([])), setBottomTab() {},
      ...overrides
    });
    return { transfer, calls, logs, loading };
  }

  test(`${database}: import remains uncommitted on the main connection and updates progress`, async () => {
    const h = setup(), progress = [];
    await h.transfer.processBulkInsertData([['ID'], ['1'], ['2']], value => progress.push(value), true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], 'execute-sql');
    assert.match(h.calls[0][1], /^INSERT (ALL|INTO)/);
    assert.ok(!/COMMIT/i.test(h.calls[0][1]));
    assert.equal(progress.at(-1), 100);
    assert.deepEqual(h.loading, [true, false]);
    assert.equal(h.logs.length, 1);
  });

  if (database === 'postgresql') {
    test('PostgreSQL CSV import keeps values in their own columns when missing fields differ by row', async () => {
      const h = setup({
        structureDefs: ['A', 'B'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'text', NULLABLE: 'Y' })),
        resultColumns: [], formatSqlValue: (_column, value) => `'${value}'`
      }, 4);
      await h.transfer.processBulkInsertData([['A', 'B'], ['alpha', ''], ['', 'beta'], ['', 'gamma'], ['delta', '']], () => {}, true);
      assert.equal(h.calls.length, 1);
      assert.match(h.calls[0][1], /\("A", "B"\) VALUES/);
      assert.match(h.calls[0][1], /\('alpha', DEFAULT\),\n\(DEFAULT, 'beta'\),\n\(DEFAULT, 'gamma'\),\n\('delta', DEFAULT\)/);
    });

    test('PostgreSQL CSV import preserves all-default rows and treats empty and NULL markers consistently', async () => {
      const h = setup({
        structureDefs: [{ COLUMN_NAME: 'ID', DATA_TYPE: 'integer', NULLABLE: 'N', DATA_DEFAULT: '42' }]
      }, 3);
      await h.transfer.processBulkInsertData([['ID'], [''], ['NULL'], ['7']], () => {}, true);
      assert.equal(h.calls.length, 1);
      assert.match(h.calls[0][1], /\(DEFAULT\),\n\(DEFAULT\),\n\(7\)/);
    });
  }

  test(`${database}: exports use one unpaged main-connection query`, async () => {
    const h = setup();
    await h.transfer.fetchDataForExport(10, 25);
    assert.equal(h.calls[0][0], 'execute-sql');
    assert.ok(!/OFFSET|FETCH NEXT|LIMIT/.test(h.calls[0][1]));
    assert.equal(h.calls.length, 1);
    await h.transfer.fetchDataForExport.close();
  });
}

for (const database of ['oracle', 'postgresql']) {
  test(`${database}: exports retain business columns named id, __row_id and ORACLE_ROWID`, async () => {
    const original = { id: '9007199254740993', __row_id: 'business row', ORACLE_ROWID: 'business value', ID: 'upper ID', note: '日本語' };
    const requests = [];
    const { createTableDataTransfer } = loadTypeScript(`src/features/${database}/windows/table/tableDataTransfer.ts`, {
      '@/shared/api/desktop': snapshotDesktop(async (...args) => { requests.push(args); return { success: true, rows: [original] }; })
    });
    const transfer = createTableDataTransfer({ schema: 'TEST', tableName: 'ITEMS', conditions: {}, outputDateFormat: 'YYYY-MM-DD', t: key => key,
      structureDefs: Object.keys(original).map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: database === 'oracle' ? 'VARCHAR2' : 'text' })),
      buildQueryStrings: () => ({ whereStr: '', orderStr: '' }) });
    const rows = await transfer.fetchDataForExport(0, 5000);
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0])), original);
    assert.notEqual(rows[0], original);
    assert.equal(requests[0][0], 'execute-sql');
    assert.ok(!requests[0][1].includes('ROWID AS ORACLE_ROWID'));
  });
}
test('PostgreSQL table exports format only the exact date column without modifying source rows', async () => {
  const source = [
    { day: '2026-10-22', DAY: null }, { day: null, DAY: '2026-10-23' }, { day: '', DAY: '2026-10-24' }
  ];
  const before = JSON.stringify(source);
  const { createTableDataTransfer } = loadTypeScript('src/features/postgresql/windows/table/tableDataTransfer.ts', {
    '@/shared/api/desktop': snapshotDesktop(async () => ({ success: true, rows: source }))
  });
  const rows = await createTableDataTransfer({ schema: 'test', tableName: 'items', conditions: {}, outputDateFormat: 'YYYY-MM-DD HH:mm:ss', t: key => key,
    structureDefs: ['day', 'DAY'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'date' })),
    buildQueryStrings: () => ({ whereStr: '', orderStr: '' }) }).fetchDataForExport(0, 50);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ day: '2026-10-22', DAY: '' }, { day: '', DAY: '2026-10-23' }, { day: '', DAY: '2026-10-24' }]);
  assert.equal(JSON.stringify(source), before);
});
