// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const dates = loadTypeScript('src/shared/utils/dateFormatter.ts');

for (const database of ['oracle', 'postgresql']) {
  const { createTableQueryBuilder } = loadTypeScript(`src/features/${database}/windows/table/tableQueryBuilder.ts`, {
    '@/shared/utils/numberValues': loadTypeScript('src/shared/utils/numberValues.ts'),
    '@/shared/utils/dateFormatter': dates
  });
  const builder = createTableQueryBuilder({
    schema: 'APP', inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'DD/MM/YYYY',
    structureDefs: [{ COLUMN_NAME: 'CREATED_AT', DATA_TYPE: 'DATE' }]
  });

  test(`${database}: SQL values preserve nulls, numbers, escaped strings, and date formats`, () => {
    assert.equal(builder.formatSqlValue({ DATA_TYPE: database === 'oracle' ? 'VARCHAR2' : 'varchar' }, "O'Brien"), "'O''Brien'");
    assert.equal(builder.formatSqlValue({ DATA_TYPE: 'NUMBER' }, null), 'NULL');
    assert.equal(builder.formatSqlValue({ DATA_TYPE: database === 'oracle' ? 'NUMBER' : 'NUMERIC' }, '0'), '0');
    assert.equal(builder.formatSqlValue({ DATA_TYPE: 'DATE' }, '2026-10-20'), (database === 'oracle' ? "TO_DATE('2026-10-20', 'YYYY-MM-DD')" : "CAST('2026-10-20' AS date)"));
    assert.equal(builder.formatSqlValue({ DATA_TYPE: 'DATE' }, '20/10/2026', true), (database === 'oracle' ? "TO_DATE('2026-10-20', 'YYYY-MM-DD')" : "CAST('2026-10-20' AS date)"));
  });

  test(`${database}: Search clauses retain disabled fields, date conversion, and sort priority`, () => {
    const result = builder.buildQueryStrings({
      NAME: { type: 'STRING', value: "O'Brien", operator: '=', sort: '2 DESC' },
      CREATED_AT: { type: 'DATE', value: '2026-10-20', operator: '>=', sort: '1 ASC' },
      PAYLOAD: { type: 'DISABLED', value: 'ignored', operator: '=', sort: '3 ASC' }
    });
    const dateSql = database === 'oracle' ? "TO_DATE('2026-10-20', 'YYYY-MM-DD')" : "CAST('2026-10-20' AS date)";
    assert.equal(result.whereStr, ` WHERE "NAME" = 'O''Brien' AND "CREATED_AT" >= ${dateSql}`);
    assert.equal(result.orderStr, ' ORDER BY "CREATED_AT" ASC, "NAME" DESC' + (database === 'oracle' ? ', t.ROWID ASC' : ', t.tableoid ASC, t.ctid ASC'));
    assert.deepEqual(Object.keys(builder.buildQueryStrings({})).sort(), ['orderStr', 'whereStr']);
  });
  test(`${database}: Search and sort quote exact column names`, () => {
    const name = database === 'oracle' ? 'Order Name' : 'A"B';
    const expected = database === 'oracle' ? '"Order Name"' : '"A""B"';
    const result = builder.buildQueryStrings({ [name]: { type: 'STRING', value: 'value', operator: '=', sort: '1 DESC' } });
    assert.equal(result.whereStr, ` WHERE ${expected} = 'value'`);
    assert.equal(result.orderStr, ` ORDER BY ${expected} DESC` + (database === 'oracle' ? ', t.ROWID ASC' : ', t.tableoid ASC, t.ctid ASC'));
  });
}

const { buildCategoryQuery } = loadTypeScript('src/features/oracle/sidebarQueries.ts');

test('Oracle sidebar queries preserve pagination, schema escaping, and category-specific sources', () => {
  const { sql, binds } = buildCategoryQuery("app's", 'TABLE', 'sales%', 100, 100);
  assert.ok(sql.includes("OWNER = :schema"));
  assert.equal(binds.schema, "app's");
  assert.equal(binds.filter, "%sales!%%");
  assert.ok(sql.includes("ESCAPE '!'"));
  assert.ok(sql.includes('OFFSET 100 ROWS FETCH NEXT 100 ROWS ONLY'));
  assert.ok(sql.includes('NOT OBJECT_NAME LIKE \'MLOG$%\''));
  assert.ok(buildCategoryQuery('PUBLIC', 'DATABASE LINK', '', 0, 100).binds.schema === 'PUBLIC');
  assert.ok(buildCategoryQuery('APP', 'MATERIALIZED VIEW', '', 0, 100).sql.includes('FROM ALL_MVIEWS'));
});

for (const database of ['oracle', 'postgresql']) {
  test(`${database}: paging order uses ordered composite keys and adds only missing sort tie breakers`, () => {
    const { createTableQueryBuilder } = loadTypeScript(`src/features/${database}/windows/table/tableQueryBuilder.ts`);
    const builder = createTableQueryBuilder({ schema: 'A', inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD',
      structureDefs: [{ COLUMN_NAME: 'Key"B', DATA_TYPE: 'integer', PK_POSITION: 2 }, { COLUMN_NAME: 'Key.A', DATA_TYPE: 'integer', PK_POSITION: 1 }] });
    assert.equal(builder.buildQueryStrings({}).orderStr, ' ORDER BY "Key.A" ASC, "Key""B" ASC');
    const condition = sort => ({ type: 'STRING', value: '', operator: '=', sort });
    assert.equal(builder.buildQueryStrings({ 'Key.A': condition('1 DESC') }).orderStr, ' ORDER BY "Key.A" DESC, "Key""B" ASC');
    assert.equal(builder.buildQueryStrings({ Label: condition('1') }).orderStr, ' ORDER BY "Label" ASC, "Key.A" ASC, "Key""B" ASC');
  });
}
