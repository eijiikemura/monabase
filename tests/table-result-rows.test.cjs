// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const { getRowIdentity, withRowIdentity } = loadTypeScript('src/features/data-grid/rowIdentity.ts');
const dates = loadTypeScript('src/shared/utils/dateFormatter.ts');
const { formatTableResultRows } = loadTypeScript(
  'src/features/postgresql/windows/table/tableResultRows.ts', { '@/shared/utils/dateFormatter': dates }
);
const definitions = [
  { COLUMN_NAME: 'id', DATA_TYPE: 'integer' },
  { COLUMN_NAME: 'day', DATA_TYPE: 'date' },
  { COLUMN_NAME: 'payload', DATA_TYPE: 'bytea' }
];
const translate = key => key === 'data_2' ? ' data]' : key;

test('PostgreSQL row formatting preserves input, date-only output, nulls, and binary placeholders', () => {
  const input = { id: '7', day: '2026-10-20', payload: new Uint8Array([1, 2]) };
  const [initial] = formatTableResultRows([input], definitions, 'YYYY-MM-DD HH:mm:ss', translate);
  assert.equal(initial.id, '7');
  assert.equal(getRowIdentity(initial), 1);
  assert.equal(initial.__row_id, undefined);
  assert.equal(initial.day, '2026-10-20');
  assert.equal(initial.payload, '[BYTEA data]');
  assert.equal(input.id, '7');
  assert.ok(input.payload instanceof Uint8Array);
  const [empty] = formatTableResultRows([{ id: null, day: null, payload: null }], definitions, 'YYYY-MM-DD', translate);
  assert.equal(empty.id, null);
  assert.equal(empty.payload, null);
});

test('PostgreSQL paginated results preserve exact driver values and use pagination identities', () => {
  const [row] = formatTableResultRows([{ id: '7', day: null, payload: null }], definitions, 'YYYY-MM-DD', translate, 100);
  assert.equal(row.id, '7');
  assert.equal(getRowIdentity(row), 101);
});

test('Grid identities are separate from business columns, preserve zero, and reject unassigned rows', () => {
  const row = withRowIdentity({ __row_id: 999, id: 'database-key' }, 0);
  assert.equal(getRowIdentity(row), 0);
  assert.equal(row.id, 'database-key'); assert.equal(row.__row_id, 999);
  assert.equal(getRowIdentity({ ...row }), 0);
  assert.throws(() => getRowIdentity({ id: 'business-only' }), /missing its grid identity/);
});

test('PostgreSQL display formatting keeps case-distinct NULL dates and real identity-like columns', () => {
  const input = { id: null, __row_id: 'original', day: '2026-10-22', DAY: null };
  const [row] = formatTableResultRows([input], [{ COLUMN_NAME: 'day', DATA_TYPE: 'date' }, { COLUMN_NAME: 'DAY', DATA_TYPE: 'date' }], 'YYYY-MM-DD', translate);
  assert.equal(row.id, null); assert.equal(row.__row_id, 'original'); assert.equal(row.day, '2026-10-22'); assert.equal(row.DAY, '');
  assert.equal(input.DAY, null); assert.equal(getRowIdentity(row), 1);
});
