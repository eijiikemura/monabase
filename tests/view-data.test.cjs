// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createViewHarness } = require('./helpers/viewData.cjs');
const { snapshotDesktop } = require('./helpers/exportSnapshot.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { getRowIdentity } = loadTypeScript('src/features/data-grid/rowIdentity.ts');
const plain = value => JSON.parse(JSON.stringify(value));

async function setup(db, options = {}) {
  const calls = [], stamp = '2026-10-22T12:34:56.000Z';
  const rows = [
    { id: '9007199254740993', __row_id: 'business', stamp, day: stamp, DAY: null, 'A"Name': 'alpha' },
    { id: '9007199254740993', __row_id: 'business', stamp, day: null, DAY: stamp, 'A"Name': 'beta' }
  ];
  const definitions = Object.keys(rows[0]).map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: ['day', 'DAY'].includes(COLUMN_NAME) ? 'TIMESTAMP' : 'VARCHAR2' }));
  const desktop = snapshotDesktop(async (channel, sql, ...args) => {
    calls.push([channel, sql, ...args]);
    const intercepted = options.respond?.(channel, sql);
    if (intercepted) return intercepted;
    if (channel === 'get-columns') return { success: true, columns: Object.keys(rows[0]) };
    if (channel === 'execute-sql-bg') return { success: true, rows: definitions };
    if (/COUNT\(\*\)/.test(sql)) return { success: true, rows: [{ CNT: 140 }] };
    return { success: true, rows: rows.map(row => ({ ...row })), metaData: Object.keys(rows[0]).map(name => ({ name })) };
  }, db);
  const h = await createViewHarness(db, desktop);
  return { ...h, get state() { return h.state; }, calls, rows, stamp, close() { h.unmount(); desktop.close(); } };
}
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: failed view pagination retains the displayed page and permits the same request to be retried`, async () => {
    let failure;
    const h = await setup(db, { respond: (channel, sql) => {
      if (channel !== 'execute-sql') return;
      if (failure === 'count' && /COUNT\(/.test(sql)) return { success: false, error: 'Count failed' };
      if (failure === 'data' && !/COUNT\(/.test(sql)) return { success: false, error: 'Data failed' };
    } });
    try {
      for (const stage of ['count', 'data']) {
        const before = h.state.displayRows;
        const model = plain(h.state.paginationModel);
        const next = { page: model.page + 1, pageSize: model.pageSize };
        failure = stage; h.calls.length = 0;
        h.state.setPaginationModel(next); await h.flush();
        assert.deepEqual(plain(h.state.paginationModel), model);
        assert.equal(h.state.displayRows, before); assert.equal(h.state.rowCount, 140);
        assert.equal(h.calls.length, stage === 'count' ? 1 : 2);
        failure = undefined; h.calls.length = 0;
        h.state.setPaginationModel(next); await h.flush();
        assert.deepEqual(plain(h.state.paginationModel), next); assert.equal(h.calls.length, 2);
        assert.equal(getRowIdentity(h.state.displayRows[0]), next.page * next.pageSize + 1);
      }
      const model = plain(h.state.paginationModel), before = h.state.displayRows;
      failure = 'data'; h.state.setPaginationModel({ page: 0, pageSize: 100 }); await h.flush();
      assert.deepEqual(plain(h.state.paginationModel), model); assert.equal(h.state.displayRows, before);
      failure = undefined; h.state.setPaginationModel({ page: 0, pageSize: 100 }); await h.flush();
      assert.deepEqual(plain(h.state.paginationModel), { page: 0, pageSize: 100 });
    } finally { h.close(); }
  });
  test(`${db}: Execute and sorting reset a view page only after a successful query`, async () => {
    let failing = false, pending, release;
    const h = await setup(db, { respond: (channel, sql) => {
      if (channel !== 'execute-sql') return;
      if (failing) return { success: false, error: 'Search failed' };
      if (pending && !/COUNT\(/.test(sql)) return pending;
    } });
    try {
      h.state.setPaginationModel({ page: 1, pageSize: 50 }); await h.flush();
      const before = h.state.displayRows;
      failing = true; await h.state.handleExecuteSearchClick(); await h.flush();
      assert.equal(h.state.paginationModel.page, 1); assert.equal(h.state.displayRows, before);
      h.state.handleColumnHeaderClick({ field: 'id' }); await h.flush();
      assert.equal(h.state.paginationModel.page, 1); assert.equal(h.state.displayRows, before);
      failing = false; pending = new Promise(resolve => { release = resolve; });
      const search = h.state.handleExecuteSearchClick(); await h.flush();
      assert.equal(h.state.paginationModel.page, 1); assert.equal(h.state.displayRows, before);
      release({ success: true, rows: [{ id: 'new' }], metaData: [{ name: 'id' }] });
      await search; await h.flush();
      assert.equal(h.state.paginationModel.page, 0); assert.equal(h.state.displayRows[0].id, 'new');
    } finally { release?.({ success: true, rows: [], metaData: [] }); h.close(); }
  });
  test(`${db}: sorting copies each view condition without modifying previous state`, async () => {
    const h = await setup(db);
    try {
      h.state.handleConditionChange('id', 'value', 'filter'); await h.flush();
      for (const field of ['id', 'id', 'stamp']) {
        const previous = h.state.conditions, saved = plain(previous);
        Object.values(previous).forEach(Object.freeze); Object.freeze(previous);
        h.state.handleColumnHeaderClick({ field }); await h.flush();
        assert.deepEqual(plain(previous), saved);
        for (const key of Object.keys(previous)) assert.notEqual(h.state.conditions[key], previous[key]);
        assert.equal(h.state.conditions.id.value, 'filter');
        assert.equal(h.state.conditions[field].sort, field === 'id' && saved.id.sort === '1' ? '1 DESC' : '1');
        assert.ok(Object.entries(h.state.conditions).every(([key, condition]) => key === field || condition.sort === ''));
      }
    } finally { h.close(); }
  });
  test(`${db}: failed or invalid view counts preserve prior results without reading data`, async () => {
    let response;
    const h = await setup(db, { respond: (_channel, sql) => /COUNT\(/.test(sql) ? response : undefined });
    try {
      const before = plain(h.state.displayRows);
      for (const result of [{ success: false, error: 'Count failed' }, ...[[], [{}], [{ CNT: null }], [{ CNT: '' }], [{ CNT: -1 }], [{ CNT: '1.5' }], [{ CNT: '9007199254740993' }]].map(rows => ({ success: true, rows }))]) {
        response = result; h.calls.length = 0;
        await h.state.executeSearch(h.state.conditions, 0, 50); await h.flush();
        assert.equal(h.calls.length, 1); assert.equal(h.state.rowCount, 140);
        assert.deepEqual(plain(h.state.displayRows), before); assert.equal(h.state.logs[0].resultMsg, 'search_error');
        assert.equal(h.state.isLoading, false);
      }
      assert.equal(h.alerts.length, 8);
      response = undefined; await h.state.handleExecuteSearchClick(); await h.flush();
      assert.equal(h.state.logs[0].resultMsg.includes('search_success'), true);
    } finally { h.close(); }
  });
  test(`${db}: view metadata failure is reported and Execute retries complete initialization`, async () => {
    let failing = true;
    const h = await setup(db, { respond: channel => failing && channel === 'execute-sql-bg' ? { success: false, error: 'Metadata failed' } : undefined });
    try {
      assert.equal(h.state.columns.length, 0); assert.equal(h.state.displayRows.length, 0);
      assert.equal(h.state.isLoading, false); assert.equal(h.alerts.length, 1);
      assert.equal(h.state.logs[0].resultMsg, 'search_error');
      assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 0);
      await assert.rejects(h.state.fetchDataForExport(0, 5000), /view_column_metadata_missing/); await h.state.fetchDataForExport.close();
      failing = false; await h.state.handleExecuteSearchClick(); await h.flush();
      assert.equal(h.state.displayRows.length, 2); assert.equal(h.state.rowCount, 140);
      assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 2);
    } finally { h.close(); }
  });
  test(`${db}: failed data requests leave the previous count and rows intact`, async () => {
    let failing = false;
    const h = await setup(db, { respond: (channel, sql) => failing && channel === 'execute-sql' ? (/COUNT\(/.test(sql) ? { success: true, rows: [{ CNT: 5 }] } : { success: false, error: 'Data failed' }) : undefined });
    try {
      const before = plain(h.state.displayRows); failing = true;
      await h.state.handleExecuteSearchClick(); await h.flush();
      assert.equal(h.state.rowCount, 140); assert.deepEqual(plain(h.state.displayRows), before);
      assert.equal(h.state.logs[0].resultMsg, 'search_error'); assert.equal(h.alerts.length, 1);
      assert.equal(h.state.isLoading, false);
    } finally { h.close(); }
  });
  test(`${db}: a genuine empty view remains a successful zero-row result`, async () => {
    const h = await setup(db, { respond: (channel, sql) => channel === 'execute-sql' ? (/COUNT\(/.test(sql) ? { success: true, rows: [{ CNT: '0' }] } : { success: true, rows: [], metaData: [] }) : undefined });
    try {
      assert.equal(h.state.rowCount, 0); assert.equal(h.state.displayRows.length, 0);
      assert.equal(h.alerts.length, 0); assert.ok(h.state.logs[0].resultMsg.includes('search_success'));
    } finally { h.close(); }
  });
  test(`${db}: view rows keep business IDs, exact string values, and independent typed dates`, async () => {
    const h = await setup(db);
    try {
      const rows = h.state.displayRows;
      assert.deepEqual(Array.from(rows, row => row.id), [h.rows[0].id, h.rows[1].id]);
      assert.notEqual(getRowIdentity(rows[0]), getRowIdentity(rows[1]));
      assert.equal(rows[0].__row_id, 'business'); assert.equal(rows[0].stamp, h.stamp);
      assert.equal(rows[0].day, '2026/10/22 12:34:56 +00:00'); assert.equal(rows[0].DAY, '');
      assert.equal(rows[1].day, ''); assert.equal(rows[1].DAY, '2026/10/22 12:34:56 +00:00');
      assert.equal(h.rows[0].day, h.stamp); assert.equal(h.rows[0].DAY, null);
      assert.deepEqual(Object.keys(rows[0]), Object.keys(h.rows[0]));
      const exported = await h.state.fetchDataForExport(0, 5000); await h.state.fetchDataForExport.close();
      assert.deepEqual(plain(exported), plain(rows));
      h.state.setIsTransposed(true); await h.flush();
      const idRow = h.state.displayRows.find(row => row.colName === 'id');
      assert.equal(idRow.row_0, h.rows[0].id); assert.equal(idRow.row_1, h.rows[1].id);
      assert.ok(h.state.displayRows.every(row => getRowIdentity(row) !== undefined));
    } finally { h.close(); }
  });
  test(`${db}: view page and page-size changes each execute exactly one count/data pair`, async () => {
    const h = await setup(db);
    try {
      assert.equal(h.calls.filter(call => call[0] === 'execute-sql').length, 2);
      h.calls.length = 0; h.state.setPaginationModel({ page: 1, pageSize: 50 }); await h.flush();
      assert.equal(h.calls.length, 2); assert.match(h.calls[1][1], /OFFSET 50/);
      h.calls.length = 0; h.state.setPaginationModel({ page: 1, pageSize: 50 }); await h.flush();
      assert.equal(h.calls.length, 0);
      h.state.setPaginationModel({ page: 1, pageSize: 100 }); await h.flush();
      assert.equal(h.calls.length, 2); assert.equal(h.state.paginationModel.page, 0);
      assert.match(h.calls[1][1], db === 'oracle' ? /OFFSET 0 ROWS FETCH NEXT 100/ : /OFFSET 0 LIMIT 100/);
      h.calls.length = 0; h.state.handleExecuteSearchClick(); await h.flush();
      assert.equal(h.calls.length, 2);
    } finally { h.close(); }
  });
  test(`${db}: view filters and sorting quote embedded column quotes in searches and exports`, async () => {
    const h = await setup(db);
    try {
      h.state.handleConditionChange('A"Name', 'value', "O'Brien"); await h.flush();
      h.calls.length = 0; h.state.handleColumnHeaderClick({ field: 'A"Name' }); await h.flush();
      assert.equal(h.calls.length, 2);
      assert.match(h.calls[1][1], /WHERE "A""Name" = 'O''Brien'/);
      assert.match(h.calls[1][1], /ORDER BY "A""Name" ASC/);
      h.calls.length = 0; await h.state.fetchDataForExport(0, 5000); await h.state.fetchDataForExport.close();
      assert.equal(h.calls.length, 1); assert.match(h.calls[0][1], /ORDER BY "A""Name" ASC/);
    } finally { h.close(); }
  });
  test(`${db}: a late page response cannot replace a newer view page`, async () => {
    let release, delayed = false;
    const pending = new Promise(resolve => { release = resolve; });
    const h = await setup(db, { respond: (_channel, sql) => delayed && /OFFSET 50\b/.test(sql) ? pending : undefined });
    try {
      delayed = true; h.state.setPaginationModel({ page: 1, pageSize: 50 }); await h.flush();
      h.state.setPaginationModel({ page: 2, pageSize: 50 }); await h.flush();
      assert.equal(getRowIdentity(h.state.displayRows[0]), 101);
      release({ success: true, rows: [{ id: 'stale' }], metaData: [{ name: 'id' }] }); await h.flush();
      assert.equal(h.state.displayRows[0].id, h.rows[0].id);
      assert.equal(getRowIdentity(h.state.displayRows[0]), 101);
      assert.equal(h.state.isLoading, false);
    } finally { release({ success: true, rows: [], metaData: [] }); h.close(); }
  });
}

for (const db of ['oracle', 'postgresql']) test(`${db}: invalid search fragments retain the view and literal LIKE inputs reach the query unchanged`, async () => {
  const h = await setup(db);
  try {
    h.calls.length = 0;
    await h.state.executeSearch({ 'A"Name': { type: 'STRING', operator: 'LIKE', value: "O'Reilly 50%_!", sort: '1 DESC' } }, 0, 50); await h.flush();
    assert.match(h.calls[0][1], /O''Reilly 50!%!_!!/);
    assert.ok(h.calls[0][1].includes("ESCAPE '!'"));
    const previous = h.state.displayRows;
    h.calls.length = 0;
    await h.state.executeSearch({ id: { type: 'NUMBER', operator: '=', value: '1 OR 1=1', sort: '' } }, 0, 50); await h.flush();
    assert.equal(h.calls.length, 0); assert.equal(h.state.displayRows, previous);
    assert.equal(h.state.isLoading, false); assert.ok(h.alerts.at(-1).includes('search_invalid_number'));
  } finally { h.close(); }
});
