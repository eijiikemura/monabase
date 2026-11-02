// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { temporalParts, oracleColumnProjection } = loadTypeScript('src/shared/utils/temporalValues.ts');
const { formatDbDate } = loadTypeScript('src/shared/utils/dateFormatter.ts');
const identities = loadTypeScript('src/features/data-grid/rowIdentity.ts');

test('Canonical temporal formatting preserves nanoseconds, calendar components and timezone offsets', () => {
  for (const fraction of ['.123456', '.123456789']) {
    const raw = `2026-10-23 12:34:56${fraction} +05:45`;
    assert.equal(formatDbDate(raw, 'DD/MM/YYYY HH:mm:ss'), `23/10/2026 12:34:56${fraction} +05:45`);
    assert.equal(formatDbDate(raw, 'YYYY/MM/DD'), '2026/10/23');
  }
  assert.equal(formatDbDate('2026-10-23', 'YYYY/MM/DD HH:mm:ss'), '2026/10/23');
  assert.equal(temporalParts('2026-10-23T12:34:56.123456Z').offset, '+00:00');
});

test('Grid display values never replace the original temporal or NULL record values', () => {
  const raw = { ID: 0, STAMP: '2026-10-23 12:34:56.123456', NOTE: null };
  const displayed = identities.withRowIdentity(raw, 0, 'RID1'); displayed.STAMP = '2026/10/23'; displayed.NOTE = '';
  assert.equal(identities.getRowSourceValue(displayed, 'STAMP'), raw.STAMP);
  assert.equal(identities.getRowSourceValue(displayed, 'NOTE'), null);
  const next = identities.preserveRowIdentity({ ...displayed, NOTE: 'changed' }, displayed);
  assert.equal(identities.getRowSourceValue(next, 'STAMP'), raw.STAMP);
  assert.equal(identities.getRowSourceValue(next, 'NOTE'), 'changed');
  assert.equal(identities.getRowIdentity(next), 0);
  assert.equal(identities.getOracleRowId(next), 'RID1');
  assert.ok(!JSON.stringify(next).includes(raw.STAMP));
});

test('Oracle projects DATE, TIMESTAMP and zoned timestamps to exact database text', () => {
  assert.match(oracleColumnProjection({ COLUMN_NAME: 'A"B', DATA_TYPE: 'TIMESTAMP(9)' }), /TO_CHAR\(t\."A""B", 'YYYY-MM-DD HH24:MI:SS.FF9'/);
  assert.match(oracleColumnProjection({ COLUMN_NAME: 'LTZ', DATA_TYPE: 'TIMESTAMP(9) WITH LOCAL TIME ZONE' }), /CAST\(t\."LTZ" AS TIMESTAMP WITH TIME ZONE\)/);
  assert.equal(oracleColumnProjection({ COLUMN_NAME: 'NOTE', DATA_TYPE: 'VARCHAR2' }), 't."NOTE"');
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: duplicate records retain NULL defaults, complete timestamps and date-only grid keys`, async () => {
    let state; const queries = [];
    const { createTableRecordEditor } = loadTypeScript(`src/features/${db}/windows/table/tableRecordEditor.ts`, { '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, sql) => { queries.push(sql); return { success: true, rowsAffected: 1 }; } } } }, { alert() {}, window: { confirm: () => true } });
    const defs = [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }, { COLUMN_NAME: 'STAMP', DATA_TYPE: 'TIMESTAMP(6)', PK_POSITION: 2 }, { COLUMN_NAME: 'NOTE', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'varchar', DATA_DEFAULT: "'fallback'" }];
    const builder = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`).createTableQueryBuilder({ schema: 'test', structureDefs: defs, inputDateFormat: 'YYYY/MM/DD', outputDateFormat: 'YYYY/MM/DD' });
    const raw = { ID: 1, STAMP: '2026-10-23 12:34:56.123456', NOTE: null };
    const row = identities.withRowIdentity(raw, 1, 'RID1'); row.STAMP = '2026/10/23'; row.NOTE = '';
    const context = { schema: 'test', tableName: 'items', structureDefs: defs, inputDateFormat: 'YYYY/MM/DD', hasLobColumns: false, isTransposed: false, recordSaving: { current: false }, recordDialog: {}, conditions: {}, paginationModel: { page: 0, pageSize: 50 }, t: key => key, formatSqlValue: builder.formatSqlValue, executeSearch: async () => {}, setRecordDialog: value => { state = value; }, setDataContextMenu() {}, setIsLoading() {}, setLogs() {}, setBottomTab() {}, setResultRows() {} };
    await createTableRecordEditor(context).handleOpenDuplicate(row);
    assert.equal(state.recordData.NOTE, null); assert.equal(state.recordData.STAMP, raw.STAMP);
    context.recordDialog = { ...state, recordData: { ...state.recordData, ID: 2 } };
    await createTableRecordEditor(context).submitRecord();
    assert.equal(queries.length, 1); assert.ok(queries[0].includes(raw.STAMP)); assert.match(queries[0], /, NULL\)$/);
    const timestamp = builder.formatSqlValue({ DATA_TYPE: 'TIMESTAMP(9) WITH TIME ZONE' }, '2026-10-23 12:34:56.123456789 +05:45');
    assert.match(timestamp, /123456789 \+05:45/);
    if (db === 'oracle') assert.match(timestamp, /^TO_TIMESTAMP_TZ/); else assert.match(timestamp, /AS timestamp with time zone/);
  });
}

test('Configured date inputs retain fractions and offsets when normalized for SQL', () => {
  const { canonicalTemporalInput } = loadTypeScript('src/shared/utils/temporalValues.ts');
  assert.equal(canonicalTemporalInput('23/10/2026 12:34:56.123456789 +05:45', 'DD/MM/YYYY HH:mm:ss'), '2026-10-23 12:34:56.123456789 +05:45');
  assert.equal(canonicalTemporalInput('23-OCT-26', 'DD-MMM-YY'), '2026-10-23');
  assert.equal(canonicalTemporalInput('23/10/2026', 'YYYY/MM/DD'), null);
});

for (const database of ['oracle', 'postgresql']) test(`${database}: temporal search clauses use the same exact conversion as record values`, () => {
  const { createTableQueryBuilder } = loadTypeScript(`src/features/${database}/windows/table/tableQueryBuilder.ts`);
  const definition = { COLUMN_NAME: 'STAMP', DATA_TYPE: 'TIMESTAMP(6)' };
  const builder = createTableQueryBuilder({ schema: 'test', structureDefs: [definition], inputDateFormat: 'DD/MM/YYYY HH:mm:ss', outputDateFormat: 'YYYY-MM-DD HH:mm:ss' });
  const value = '23/10/2026 12:34:56.123456';
  for (const operator of ['=', '>=', '<']) {
    assert.equal(builder.buildQueryStrings({ STAMP: { value, type: 'DATE', operator, sort: '' } }).whereStr,
      ` WHERE "STAMP" ${operator} ${builder.formatSqlValue(definition, value)}`);
  }
});

test('PostgreSQL TIME SQL preserves fractional seconds, offsets and quoted invalid input without a date conversion', () => {
  const { createTableQueryBuilder } = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts');
  const definitions = [{ COLUMN_NAME: 'CLOCK', DATA_TYPE: 'time(6) without time zone' }, { COLUMN_NAME: 'ZCLOCK', DATA_TYPE: 'time(6) with time zone' }];
  const builder = createTableQueryBuilder({ structureDefs: definitions, inputDateFormat: 'YYYY/MM/DD', outputDateFormat: 'YYYY/MM/DD' });
  assert.equal(builder.formatSqlValue(definitions[0], '12:34:56.123456'), "CAST('12:34:56.123456' AS time without time zone)");
  assert.equal(builder.formatSqlValue(definitions[1], '12:34:56.123456+05:45'), "CAST('12:34:56.123456+05:45' AS time with time zone)");
  assert.equal(builder.formatSqlValue(definitions[0], "bad' OR 1=1"), "CAST('bad'' OR 1=1' AS time without time zone)");
  assert.equal(builder.buildQueryStrings({ CLOCK: { value: '12:34:56.123456', type: 'TIME', operator: '=', sort: '' } }).whereStr, ' WHERE "CLOCK" = CAST(\'12:34:56.123456\' AS time without time zone)');
});
