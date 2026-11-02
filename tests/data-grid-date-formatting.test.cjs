// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const dateFormat = 'DD-MMM-YY HH:mm:ss';

// Load shared display helpers to verify rendering, copy formatting, and transposition.
function loadModule(relativePath, dependencies = {}, globals = {}) {
  const runtime = { window: {}, ...globals };
  return loadTypeScript(relativePath, {
    '@/shared/api/desktop': { ipcRenderer: runtime.window?.require?.('electron')?.ipcRenderer || { invoke() { throw new Error('IPC test double is missing.'); } } },
    ...dependencies
  }, runtime);
}

const dates = loadModule('src/shared/utils/dateFormatter.ts');
const numberValues = loadTypeScript('src/shared/utils/numberValues.ts');
const grid = loadModule('src/features/data-grid/dataGridHelper.tsx', {
  "@/shared/utils/numberValues": numberValues,
  "@/shared/utils/dateFormatter": dates,
  react: require('react'),
  i18next: { t: (key, options) => options?.defaultValue || key }
});

test('Preserves VARCHAR2 year-month strings in display and clipboard formatting', () => {
  const [column] = grid.buildGridColumns([{ name: 'YM', dbTypeName: 'VARCHAR2', fetchType: 2001 }], dateFormat);
  assert.equal(column.renderCell({ value: '202412' }).props.children, '202412');
  assert.equal(column.valueFormatter({ value: '202412' }), '202412');
  assert.equal(column.valueFormatter('202412'), '202412');
  // String table columns still use renderCell when valueFormatter is omitted.
  const tableColumn = { ...column, valueFormatter: undefined };
  assert.equal(tableColumn.renderCell({ value: '202412' }).props.children, '202412');
});

test('Date-like strings remain unchanged for character columns', () => {
  for (const dbTypeName of ['VARCHAR2', 'CHAR', 'NVARCHAR2', 'CLOB', 'VARCHAR']) {
    for (const value of ['202412', '12', '2024-12-01', '2024/12/01 12:34:56', '01-JAN-12 00:00:00', '']) {
      assert.equal(grid.getFormattedValue(value, { dbTypeName }, dateFormat), value);
    }
  }
});

test('Preserves number and NULL display', () => {
  assert.equal(grid.getFormattedValue(202412, { dbTypeName: 'NUMBER' }, dateFormat), '202412');
  assert.equal(grid.getFormattedValue(0, { dbTypeName: 'NUMBER' }, dateFormat), '0');
  assert.equal(grid.getFormattedValue(-12.5, { dbTypeName: 'NUMBER' }, dateFormat), '-12.5');
  assert.equal(grid.getFormattedValue(null, { dbTypeName: 'DATE' }, dateFormat), '');
  assert.equal(grid.getFormattedValue(undefined, { dbTypeName: 'VARCHAR2' }, dateFormat), '');
});

test('Continues formatting DATE and TIMESTAMP columns', () => {
  const value = new Date(2024, 11, 1, 12, 34, 56);
  for (const dbTypeName of ['DATE', 'TIMESTAMP', 'TIMESTAMP(6)', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMP WITH LOCAL TIME ZONE', 'timestamp without time zone']) {
    const [column] = grid.buildGridColumns([{ name: 'CREATED', dbTypeName }], dateFormat);
    assert.equal(column.renderCell({ value }).props.children, '01-DEC-24 12:34:56');
    assert.equal(column.valueFormatter({ value }), '01-DEC-24 12:34:56');
    assert.equal(grid.getFormattedValue('2024/12/01 12:34:56', { dbTypeName }, dateFormat), '01-DEC-24 12:34:56');
  }
  assert.equal(grid.getFormattedValue('2024-12-01', { dbTypeName: 'DATE' }, dateFormat), '2024-12-01');
});

test('Preserves untyped strings and formats actual Date objects', () => {
  assert.equal(grid.getFormattedValue('202412', undefined, dateFormat), '202412');
  assert.equal(grid.getFormattedValue('2024/12/01 12:34:56', {}, dateFormat), '2024/12/01 12:34:56');
  assert.equal(grid.getFormattedValue(new Date(2024, 11, 1, 12, 34, 56), undefined, dateFormat), '01-DEC-24 12:34:56');
});

test('Transposition preserves year-month strings and formatted dates', () => {
  const columns = grid.buildTransposedColumns([{ YM: '202412', CREATED: '01-DEC-24 12:34:56' }], dateFormat);
  const column = columns[1];
  for (const value of ['202412', '01-DEC-24 12:34:56', '2024-12-01']) {
    assert.equal(column.renderCell({ value }).props.children, value);
    assert.equal(column.valueFormatter({ value }), value);
  }
  assert.equal(column.valueFormatter({ value: null }), '');
});

test('SQL result helpers do not convert untyped strings to dates', () => {
  const sql = loadModule('src/features/sql/useSqlWindowBottom.ts', {
    './explainIdentity': loadTypeScript('src/features/sql/explainIdentity.ts'),
    react: {
      useState: value => [value, () => {}],
      useRef: value => ({ current: value }),
      useMemo: callback => callback()
    },
    'react-i18next': { useTranslation: () => ({ t: text => text, i18n: { language: 'ja' } }) },
    "../data-grid/dataGridHelper": grid,
    "@/shared/utils/numberValues": numberValues,
  "@/shared/utils/dateFormatter": dates,
    "@/shared/utils/errorUtils": { getErrorMessage: error => String(error) }
  }, { window: { require: () => ({ ipcRenderer: {} }) } });
  const result = sql.useSqlWindowBottom({
    rows: [{ YM: '202412' }], columns: [{ field: 'YM', headerName: 'YM' }],
    dateFormat, isExplainResult: false, dbType: 'oracle'
  });
  const column = result.displayColumns[0];
  assert.equal(column.valueFormatter({ value: '202412' }), '202412');
  assert.equal(column.valueFormatter({ value: '2024/12/01 12:34:56' }), '2024/12/01 12:34:56');
});

test('NULL markers affect rendering only and preserve empty strings, literal NULL text and formatted export values', () => {
  for (const column of [grid.buildGridColumns([{ name: 'VALUE', dbTypeName: 'VARCHAR2' }], dateFormat)[0], grid.buildTransposedColumns([{}], dateFormat)[1]]) {
    assert.equal(column.renderCell({ value: null }).props.children, 'NULL');
    assert.equal(column.renderCell({ value: null }).props['data-db-null'], true);
    assert.equal(column.valueFormatter({ value: null }), '');
    assert.equal(column.renderCell({ value: '' }).props.children, '');
    assert.equal(column.renderCell({ value: 'NULL' }).props['data-db-null'], undefined);
    assert.equal(column.renderCell({ value: 'NULL' }).props.children, 'NULL');
  }
});

test('Strict display formats PostgreSQL temporal text without appending precision or zone details', () => {
  const raw = '2026-10-30 05:56:47.880908+00';
  for (const [format, expected] of [
    ['YYYY/MM/DD HH:mm:ss', '2026/10/30 05:56:47'],
    ['DD-MMM-YY HH:mm:ss', '30-OCT-26 05:56:47'],
    ['MM/DD/YYYY HH:mm:ss', '10/30/2026 05:56:47'],
    ['YYYY-MM-DD', '2026-10-30']
  ]) {
    const [column] = grid.buildGridColumns([{ name: 'stamp', dbTypeName: 'TIMESTAMP' }], format, {}, { preserveDetails: false });
    assert.equal(column.renderCell({ value: raw }).props.children, expected);
    assert.equal(column.valueFormatter({ value: raw }), expected);
    assert.equal(column.valueFormatter(raw), expected);
  }
  assert.equal(grid.getFormattedValue('2026-10-30', { dbTypeName: 'DATE' }, dateFormat, { preserveDetails: false }), '30-OCT-26');
  assert.equal(grid.getFormattedValue(raw, { dbTypeName: 'VARCHAR' }, dateFormat, { preserveDetails: false }), raw);
  assert.equal(grid.getFormattedValue(null, { dbTypeName: 'TIMESTAMP' }, dateFormat, { preserveDetails: false }), '');
  // Other consumers retain their existing precision-preserving format by default.
  assert.equal(grid.getFormattedValue(raw, { dbTypeName: 'TIMESTAMP' }, dateFormat), '30-OCT-26 05:56:47.880908 +00:00');
});
