// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createTableHarness } = require('./helpers/tableData.cjs');
const { getRowIdentity } = loadTypeScript('src/features/data-grid/rowIdentity.ts');
const { deleteRecordBatches } = loadTypeScript('src/features/table/recordDeletion.ts');
const condition = (value, type = 'STRING', operator = '=') => ({ value, type, operator, sort: '' });
test('Oracle table fixture commits late initial metadata before the first sorted page request', async () => {
  const calls = [];
  const metadata = [{ COLUMN_NAME: 'ID', DATA_TYPE: 'NUMBER', PK_POSITION: 1 }, { COLUMN_NAME: 'LABEL', DATA_TYPE: 'VARCHAR2' }];
  const invoke = async (channel, sql) => {
    calls.push([channel, sql]);
    if (channel === 'execute-sql-bg') {
      // Complete during the fixture's final settle, just before its last render.
      await new Promise(resolve => setImmediate(() => setImmediate(resolve)));
      return { success: true, rows: metadata };
    }
    if (channel !== 'execute-sql') return {};
    if (/COUNT\(\*\)/.test(sql)) return { success: true, rows: [{ CNT: 4 }] };
    const ids = /ORDER BY "LABEL"/.test(sql) ? [2, 4] : [1, 2, 3, 4];
    const alias = /ROWID AS "([^"]+)"/.exec(sql)?.[1];
    return { success: true, rows: ids.map(ID => ({ ID: String(ID), LABEL: ID % 2 ? 'odd' : 'even', ...(alias ? { [alias]: `ROW${ID}` } : {}) })),
      metaData: [{ name: 'ID' }, { name: 'LABEL' }] };
  };
  const h = await createTableHarness('oracle', invoke);
  try {
    assert.equal(h.state.structureDefs.length, 2);
    assert.equal(h.state.isLoading, false);
    const before = calls.filter(([channel]) => channel === 'execute-sql').length;
    const conditions = { ...h.state.conditions, LABEL: { ...h.state.conditions.LABEL, sort: '1' } };
    await h.state.executeSearch(conditions, 0, 2); await h.flush();
    assert.deepEqual(h.alerts, []);
    assert.equal(calls.filter(([channel]) => channel === 'execute-sql').length, before + 2);
    assert.deepEqual(h.state.displayRows.map(row => row.ID), ['2', '4']);
    assert.equal(h.state.paginationModel.pageSize, 2);
  } finally { h.unmount(); }
});
for (const db of ['oracle', 'postgresql']) {
  const { createTableQueryBuilder } = loadTypeScript(`src/features/${db}/windows/table/tableQueryBuilder.ts`);
  const builder = createTableQueryBuilder({ schema: 'test', inputDateFormat: 'YYYY-MM-DD', outputDateFormat: 'YYYY-MM-DD', structureDefs: [] });
  test(`${db}: condition values preserve punctuation, whitespace and literal LIKE characters`, () => {
    const sql = builder.buildQueryStrings({ 'A"B': condition(" O'Reilly 50%_! ", 'STRING', 'LIKE') }).whereStr;
    assert.equal(sql, ' WHERE "A""B" LIKE \'% O\'\'Reilly 50!%!_!! %\' ESCAPE \'!\'');
    assert.equal(builder.buildQueryStrings({ NOTE: condition('  ') }).whereStr, ' WHERE "NOTE" = \'  \'');
    assert.match(builder.buildQueryStrings({ ID: condition('12345678901234567890.123456789', 'NUMBER') }).whereStr, /12345678901234567890\.123456789$/);
    assert.match(builder.buildQueryStrings({ DAY: condition("2026-10-23' OR '1'='1", 'DATE') }).whereStr, /2026-10-23'' OR ''1''=''1/);
  });
  test(`${db}: invalid condition SQL and sort fragments fail before execution`, () => {
    for (const c of [condition('1 OR 1=1', 'NUMBER'), condition('1; DELETE FROM Items', 'NUMBER'), condition('a', 'STRING', '= 1 OR'), { ...condition(''), sort: '1 DESC NULLS FIRST' }, { ...condition(''), sort: '0' }, condition('a', 'SQL')]) {
      assert.throws(() => builder.buildQueryStrings({ ID: c }), /Invalid/);
    }
    assert.equal(builder.buildQueryStrings({ A: { ...condition(''), sort: '2 DESC' }, B: { ...condition(''), sort: '1' } }).orderStr, ' ORDER BY "B" ASC, "A" DESC' + (db === 'oracle' ? ', t.ROWID ASC' : ', t.tableoid ASC, t.ctid ASC'));
  });
  test(`${db}: table deletion reports actual counts and preserves selection on mismatch or partial failure`, async () => {
    for (const mode of ['zero', 'unknown', 'partial', 'success']) {
      let deletes = 0, refreshes = 0;
      const invoke = async (channel, sql) => {
        if (/^DELETE/.test(sql)) {
          deletes++;
          if (mode === 'partial' && deletes === 2) return { success: false, error: 'Denied' };
          return { success: true, ...(mode === 'unknown' ? {} : { rowsAffected: mode === 'zero' ? 0 : db === 'oracle' ? 2 : 1 }) };
        }
        if (channel === 'execute-sql-bg') return { success: true, rows: [{ COLUMN_NAME: 'ID', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }] };
        if (/COUNT\(\*\)/.test(sql)) return { success: true, rows: [{ CNT: 2 }] };
        refreshes++;
        const alias = /ROWID AS "([^"]+)"/.exec(sql)?.[1];
        return { success: true, rows: [1, 2].map(ID => ({ ID, ...(alias ? { [alias]: `ROW${ID}` } : {}) })), metaData: [{ name: 'ID' }] };
      };
      const h = await createTableHarness(db, invoke);
      assert.equal(h.state.displayRows.length, 2);
      const selected = h.state.displayRows.map(getRowIdentity);
      h.state.setSelectedRowIds(selected); await h.flush();
      const before = refreshes;
      await h.state.handleDeleteSelected(); await h.flush();
      const fails = mode !== 'success';
      // Oracle deletes in one batch, so a two-statement partial error is tested below.
      const expectedSuccess = !fails || (db === 'oracle' && mode === 'partial');
      assert.equal(h.state.selectedRowIds.length, expectedSuccess ? 0 : 2);
      assert.equal(refreshes > before, expectedSuccess);
      assert.equal(h.state.isLoading, false);
      assert.ok(h.alerts.at(-1).includes(expectedSuccess ? 'Deleted 2 records' : 'No automatic commit or rollback'));
      h.unmount();
    }
  });
}

test('Deletion stops after the first mismatch, error or uncertain count and retains confirmed progress', async () => {
  const batches = [1, 2, 3].map(i => ({ sql: `DELETE ${i}`, expected: 2 }));
  for (const response of [{ success: false, error: 'Denied' }, { success: true, rowsAffected: 0 }, { success: true }, { success: true, rowsAffected: 3 }, { success: true, rowsAffected: NaN }, new Error('IPC failed')]) {
    let calls = 0;
    const result = await deleteRecordBatches(batches, async () => { if (++calls === 1) return { success: true, rowsAffected: 2 }; if (response instanceof Error) throw response; return response; });
    assert.equal(calls, 2); assert.equal(result.confirmedCount, 2); assert.notEqual(result.status, 'complete');
  }
});

test('PostgreSQL record values distinguish NULL from the text null in string keys and fields', () => {
  const { createTableQueryBuilder } = loadTypeScript('src/features/postgresql/windows/table/tableQueryBuilder.ts');
  const { formatSqlValue } = createTableQueryBuilder({ schema: 'test', structureDefs: [] });
  for (const value of ['null', 'NULL', 'NuLl']) assert.equal(formatSqlValue({ DATA_TYPE: 'text' }, value), `'${value}'`);
  assert.equal(formatSqlValue({ DATA_TYPE: 'text' }, null), 'NULL');
});
