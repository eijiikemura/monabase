// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createTableHarness } = require('./helpers/tableData.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { getRowIdentity } = loadTypeScript('src/features/data-grid/rowIdentity.ts');
const { requireTableColumns, requireTableCount } = loadTypeScript('src/features/table/tableQueryResults.ts');

function transport(database, state) {
  const calls = [];
  return { calls, invoke: async (channel, sql) => {
    calls.push([channel, sql]);
    if (channel === 'execute-sql-bg') {
      if (state.metadata instanceof Error) throw state.metadata;
      return state.metadata ?? { success: true, rows: [{ COLUMN_NAME: 'ID', DATA_TYPE: database === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 }] };
    }
    if (/COUNT\(/.test(sql)) {
      if (state.count instanceof Error) throw state.count;
      return state.count ?? { success: true, rows: [{ CNT: 120 }] };
    }
    if (state.data instanceof Error) throw state.data;
    const alias = /t\.ROWID AS "([^"]+)"/.exec(sql)?.[1];
    return state.data ?? { success: true, rows: [state.id ?? 1].map(ID => ({ ID, ...(alias ? { [alias]: `RID${ID}` } : {}) })), metaData: [{ name: 'ID' }] };
  } };
}
const dataCalls = calls => calls.filter(([channel, sql]) => channel === 'execute-sql' && !/COUNT\(/.test(sql));

for (const database of ['oracle', 'postgresql']) {
  test(`${database}: table sorting copies frozen conditions and preserves earlier state on success and failure`, async () => {
    const state = { metadata: { success: true, rows: [
      { COLUMN_NAME: 'ID', DATA_TYPE: database === 'oracle' ? 'NUMBER' : 'integer', PK_POSITION: 1 },
      { COLUMN_NAME: 'NOTE', DATA_TYPE: database === 'oracle' ? 'VARCHAR2' : 'text' },
      { COLUMN_NAME: 'PAYLOAD', DATA_TYPE: database === 'oracle' ? 'BLOB' : 'bytea' }
    ] } }, desktop = transport(database, state), h = await createTableHarness(database, desktop.invoke);
    try {
      h.state.handleConditionChange('NOTE', 'value', 'keep'); await h.flush();
      for (const [field, expectedSort, fail] of [['ID', '1', false], ['ID', '1 DESC', false], ['NOTE', '1', true]]) {
        const previous = h.state.conditions, saved = JSON.parse(JSON.stringify(previous));
        const rows = h.state.displayRows, page = h.state.paginationModel;
        Object.values(previous).forEach(Object.freeze); Object.freeze(previous);
        state.count = fail ? { success: false, error: 'Sort query failed' } : undefined;
        desktop.calls.length = 0;
        h.state.handleColumnHeaderClick({ field }); await h.flush();
        assert.deepEqual(JSON.parse(JSON.stringify(previous)), saved);
        for (const key of Object.keys(previous)) assert.notEqual(h.state.conditions[key], previous[key]);
        assert.equal(h.state.conditions.NOTE.value, 'keep');
        assert.equal(h.state.conditions[field].sort, expectedSort);
        assert.ok(Object.entries(h.state.conditions).every(([key, condition]) => key === field || condition.sort === ''));
        if (fail) {
          assert.equal(h.state.displayRows, rows); assert.equal(h.state.paginationModel, page);
          assert.equal(dataCalls(desktop.calls).length, 0);
        } else {
          assert.equal(dataCalls(desktop.calls).length, 1);
          assert.match(dataCalls(desktop.calls)[0][1], new RegExp(`ORDER BY "${field}" ${expectedSort === '1' ? 'ASC' : 'DESC'}`));
        }
      }
      assert.equal(h.state.conditions.PAYLOAD.type, 'DISABLED');
      const previous = h.state.conditions;
      desktop.calls.length = 0; h.state.handleColumnHeaderClick({ field: 'PAYLOAD' }); await h.flush();
      assert.equal(h.state.conditions, previous); assert.equal(desktop.calls.length, 0);
      h.state.setIsTransposed(true); await h.flush();
      h.state.handleColumnHeaderClick({ field: 'ID' }); await h.flush();
      assert.equal(h.state.conditions, previous); assert.equal(desktop.calls.length, 0);
    } finally { h.unmount(); }
  });
  test(`${database}: failed or invalid initial metadata is visible and Execute retries initialization once`, async () => {
    for (const metadata of [{ success: false, error: 'Metadata failed' }, { success: true, rows: [] }, { success: true, rows: [{ COLUMN_NAME: 'ID' }] }, new Error('Metadata request rejected')]) {
      const state = { metadata }, desktop = transport(database, state);
      const h = await createTableHarness(database, desktop.invoke);
      try {
        assert.equal(h.state.displayRows.length, 0); assert.equal(h.state.columns.length, 0);
        assert.equal(h.alerts.length, 1); assert.equal(h.state.bottomTab, 1); assert.equal(h.state.isLoading, false);
        assert.equal(dataCalls(desktop.calls).length, 0);
        await h.flush(); assert.equal(desktop.calls.length, 1, 'Failures must wait for an explicit retry');
        state.metadata = undefined;
        h.state.handleExecuteSearchClick(); await h.flush();
        assert.equal(h.state.columns.length, 1); assert.equal(h.state.structureDefs[0].PK_POSITION, 1);
        assert.equal(h.state.displayRows[0].ID, 1); assert.equal(h.state.rowCount, 120);
        assert.equal(desktop.calls.filter(([channel]) => channel === 'execute-sql-bg').length, 2);
        assert.equal(dataCalls(desktop.calls).length, 1);
      } finally { h.unmount(); }
    }
  });
  test(`${database}: bad counts retain results, page, selection and filters without issuing a data query`, async () => {
    const state = {}, desktop = transport(database, state), h = await createTableHarness(database, desktop.invoke);
    try {
      const rows = h.state.displayRows, columns = h.state.displayColumns, page = h.state.paginationModel;
      h.state.setSelectedRowIds([getRowIdentity(rows[0])]); await h.flush();
      const invalid = [{ success: false, error: 'Count failed' }, new Error('Count rejected'), ...[[], [{}], [null], [{ CNT: null }], [{ CNT: '' }], [{ CNT: true }], [{ CNT: -1 }], [{ CNT: 'NaN' }], [{ CNT: '1.5' }], [{ CNT: '9007199254740993' }], [{ CNT: 1 }, { CNT: 1 }]].map(rows => ({ success: true, rows }))];
      for (const response of invalid) {
        desktop.calls.length = 0; state.count = response; state.id = 2;
        await h.state.executeSearch({ ID: { value: '2', type: 'NUMBER', operator: '>=', sort: '1 DESC' } }, 1, 100); await h.flush();
        assert.equal(h.state.displayRows, rows); assert.equal(h.state.displayColumns, columns);
        assert.equal(h.state.rowCount, 120); assert.equal(h.state.paginationModel, page);
        assert.equal(h.state.selectedRowIds.length, 1); assert.equal(h.state.isLoading, false);
        assert.equal(h.state.logs[0].resultMsg, 'Search Error'); assert.equal(h.state.bottomTab, 1);
        assert.equal(dataCalls(desktop.calls).length, 0);
      }
      state.count = { success: true, rows: [{ CNT: 222 }] };
      await h.state.executeSearch({}, 1, 100); await h.flush();
      assert.equal(h.state.displayRows[0].ID, 2); assert.equal(h.state.rowCount, 222);
      assert.equal(h.state.paginationModel.page, 1); assert.equal(h.state.paginationModel.pageSize, 100);
      assert.equal(h.state.selectedRowIds.length, 0);
    } finally { h.unmount(); }
  });
  test(`${database}: initial count/data failures and failed reloads recover without publishing partial state`, async () => {
    for (const failure of ['count', 'data']) {
      const state = { [failure]: { success: false, error: `${failure} failed` } }, desktop = transport(database, state);
      const h = await createTableHarness(database, desktop.invoke);
      try {
        assert.equal(h.state.columns.length, 0); assert.equal(h.state.displayRows.length, 0); assert.equal(h.alerts.length, 1);
        state[failure] = undefined; h.state.handleExecuteSearchClick(); await h.flush();
        const rows = h.state.displayRows; assert.equal(rows.length, 1);
        state.metadata = { success: false, error: 'Reload metadata failed' };
        h.emit('reload-source', { schema: 'test', tableName: 'Items' }); await h.flush();
        assert.equal(h.state.displayRows, rows); assert.equal(h.state.rowCount, 120);
        state.metadata = undefined; state.id = 3; h.state.handleExecuteSearchClick(); await h.flush();
        assert.equal(h.state.displayRows[0].ID, 3); assert.equal(h.state.bottomTab, 0);
      } finally { h.unmount(); }
    }
  });
  test(`${database}: failed data requests retain a valid previous count and zero rows remain a genuine success`, async () => {
    const state = {}, desktop = transport(database, state), h = await createTableHarness(database, desktop.invoke);
    try {
      const rows = h.state.displayRows;
      state.count = { success: true, rows: [{ CNT: 222 }] }; state.data = { success: false, error: 'Data failed' };
      await h.state.executeSearch({}, 1, 100); await h.flush();
      assert.equal(h.state.rowCount, 120); assert.equal(h.state.displayRows, rows); assert.equal(h.state.paginationModel.page, 0);
      state.data = { success: true, rows: [], metaData: [{ name: 'ID' }] }; state.count = { success: true, rows: [{ CNT: '0' }] };
      await h.state.executeSearch({}, 0, 50); await h.flush();
      assert.equal(h.state.rowCount, 0); assert.equal(h.state.displayRows.length, 0); assert.equal(h.state.bottomTab, 0);
    } finally { h.unmount(); }
  });
  test(`${database}: late count responses do not issue stale data requests or replace newer results`, async () => {
    const state = {}, desktop = transport(database, state);
    let deferred, held = false;
    const h = await createTableHarness(database, async (...args) => {
      if (held && args[0] === 'execute-sql' && /COUNT\(/.test(args[1])) { held = false; return new Promise(resolve => { deferred = resolve; }); }
      return desktop.invoke(...args);
    });
    try {
      held = true;
      const old = h.state.executeSearch({}, 1, 50);
      state.id = 3; await h.state.executeSearch({}, 2, 50); await h.flush();
      const reads = dataCalls(desktop.calls).length;
      deferred({ success: true, rows: [{ CNT: 999 }] }); await old; await h.flush();
      assert.equal(h.state.displayRows[0].ID, 3); assert.equal(h.state.paginationModel.page, 2);
      assert.equal(h.state.rowCount, 120); assert.equal(dataCalls(desktop.calls).length, reads); assert.equal(h.state.isLoading, false);
    } finally { h.unmount(); }
  });
}

test('Table count and column validation rejects ambiguous metadata without confusing NULL with zero', () => {
  assert.equal(requireTableCount({ success: true, rows: [{ CNT: 0 }] }, 'invalid'), 0);
  assert.equal(requireTableCount({ success: true, rows: [{ cnt: '7' }] }, 'invalid'), 7);
  assert.throws(() => requireTableCount({ success: true, rows: [{ CNT: null, cnt: 0 }] }, 'invalid'), /invalid/);
  assert.throws(() => requireTableColumns([{ COLUMN_NAME: 'ID', DATA_TYPE: 'int' }, { COLUMN_NAME: 'ID', DATA_TYPE: 'int' }], 'invalid'), /invalid/);
});

for (const database of ['oracle', 'postgresql']) {
  test(`${database}: draft conditions never change displayed-page queries or exported SQL until search succeeds`, async () => {
    const state = {}, desktop = transport(database, state), exports = [];
    const h = await createTableHarness(database, async (channel, ...args) => {
      if (channel === 'open-data-export') { exports.push(args[0]); return { success: true, exportId: 'test-export', totalCount: 1 }; }
      if (channel === 'read-data-export') return { success: true, rows: [{ ID: 1 }] };
      if (channel === 'close-data-export') return { success: true };
      return desktop.invoke(channel, ...args);
    });
    try {
      assert.equal(h.state.conditionsPending, false);
      h.state.handleConditionChange('ID', 'value', '2'); await h.flush(); assert.equal(h.state.conditionsPending, true);
      assert.equal(h.state.conditionsText, '');
      await h.state.executeSearch(h.state.appliedConditions, 1, 50); await h.flush();
      assert.ok(!dataCalls(desktop.calls).at(-1)[1].includes('"ID" = 2'));
      await h.state.fetchDataForExport(0, 50); assert.ok(!exports.at(-1).includes('"ID" = 2'));
      state.count = { success: false, error: 'Denied' };
      await h.state.executeSearch(h.state.conditions, 0, 50); await h.flush();
      assert.equal(h.state.conditionsPending, true); assert.equal(Object.values(h.state.appliedConditions)[0]?.value || '', '');
      state.count = undefined; await h.state.executeSearch(h.state.conditions, 0, 50); await h.flush();
      assert.equal(h.state.conditionsPending, false); assert.equal(h.state.appliedConditions.ID.value, '2');
      assert.ok(h.state.conditionsText.includes('2'));
      await h.state.fetchDataForExport(0, 50); assert.ok(exports.at(-1).includes('"ID" = 2'));
      const before = desktop.calls.length;
      h.emit('reload-source', { schema: 'another', tableName: 'Items' }); await h.flush();
      assert.equal(desktop.calls.length, before, 'A same-named table in another schema does not invalidate results');
    } finally { h.unmount(); }
  });
}
