// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const identities = loadTypeScript('src/shared/utils/objectIdentity.ts');
const translate = key => key;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const events = harness => loadTypeScript('src/shared/hooks/useEventCallback.ts', { react: harness.react });

function sourceHarness() {
  const h = createHookHarness(), pending = [];
  const { useEditableSource } = loadTypeScript('src/features/objects/useEditableSource.ts', {
    react: h.react, '@/shared/hooks/useEventCallback': events(h)
  });
  const fetch = () => { const request = deferred(); pending.push(request); return request.promise; };
  const render = (identity = 'APP.VIEW') => h.render(() => useEditableSource(identity, fetch, 'Loading', 'Failed'));
  render(); h.commit();
  return { ...h, pending, render };
}

test('Editable source preserves edits made during loading while updating the saved baseline', async () => {
  const h = sourceHarness();
  const load = h.render().loadSource();
  h.render().setSourceText('my draft');
  h.pending[0].resolve('database source'); await load;
  assert.equal(h.render().sourceText, 'my draft');
  assert.equal(h.render().savedSourceText, 'database source');
  assert.equal(h.render().sourceStatus, 'success');
  h.render().setSourceText(''); h.render(); h.commit();
  assert.equal(h.pending.length, 1, 'Empty drafts do not trigger source loading');
});

test('Editable source ignores out-of-order loads and late responses after identity changes or unmount', async () => {
  const h = sourceHarness();
  const first = h.render().loadSource(), second = h.render().loadSource();
  h.pending[1].resolve('new'); await second;
  h.pending[0].resolve('old'); await first;
  assert.equal(h.render().sourceText, 'new');
  const oldIdentity = h.render().loadSource();
  h.render('APP.OTHER'); h.commit();
  h.pending[2].resolve('wrong identity'); await oldIdentity;
  assert.equal(h.render('APP.OTHER').sourceText, 'Loading');
  const closed = h.render('APP.OTHER').loadSource();
  h.unmount(); h.pending[3].resolve('closed'); await closed;
  assert.equal(h.render('APP.OTHER').sourceText, 'Loading');
});

test('Editable source keeps drafts on fetch failure and permits explicit retry', async () => {
  const h = sourceHarness();
  const load = h.render().loadSource(); h.render().setSourceText('draft');
  h.pending[0].reject(new Error('Unavailable')); await load;
  assert.equal(h.render().sourceText, 'draft');
  assert.equal(h.render().sourceStatus, 'error');
  const retry = h.render().loadSource(); h.pending[1].resolve('recovered'); await retry;
  assert.equal(h.render().sourceText, 'recovered');
});

test('Workspace tab updates are pure under double evaluation, batched opens, limits, and closes', () => {
  const h = createHookHarness({ doubleUpdates: true }); let alerts = 0;
  const { useWorkspaceTabs } = loadTypeScript('src/shared/hooks/useWorkspaceTabs.ts', { react: h.react, './useEventCallback': events(h) });
  const render = () => h.render(() => useWorkspaceTabs([{ id: 1, name: 'first' }], () => alerts++));
  const open = render().openTab;
  open((_tabs, id) => ({ tab: { id, name: 'second' } }));
  open((_tabs, id) => ({ tab: { id, name: 'third' } }));
  assert.deepEqual(Array.from(render().tabs, tab => tab.id), [1, 2, 3]);
  assert.equal(render().activeTabId, 3);
  open(tabs => ({ existingId: tabs[1].id }));
  assert.equal(render().activeTabId, 2);
  open(() => ({ limitReached: true })); render(); h.commit();
  render(); h.commit(); assert.equal(alerts, 1);
  render().setTabs(tabs => tabs.filter(tab => tab.id !== 2));
  assert.equal(render().activeTabId, 1);
  render().setTabs([]); assert.equal(render().activeTabId, 0);
});

test('SQL results retain new column types, widths, and sort functions with unchanged names', () => {
  const h = createHookHarness();
  const { useSqlWindowBottom } = loadTypeScript('src/features/sql/useSqlWindowBottom.ts', {
    './explainIdentity': loadTypeScript('src/features/sql/explainIdentity.ts'),
    react: h.react, 'react-i18next': { useTranslation: () => ({ t: translate, i18n: { language: 'en' } }) },
    '@/shared/utils/errorUtils': { getErrorMessage: String }, '../data-grid/dataGridHelper': { buildTransposedColumns: () => [] },
    '@/shared/utils/dateFormatter': { formatDbDate: String }, '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
      '@/shared/api/desktop': { beginGlobalLoading: () => () => {}, ipcRenderer: {} }
  });
  const render = column => h.render(() => useSqlWindowBottom({ rows: [], columns: [column], dateFormat: 'YYYY-MM-DD', sqlText: '', isExplainResult: false }));
  render({ field: 'VALUE', headerName: 'VALUE', type: 'number', width: 100 });
  const sortComparator = () => 0;
  const column = render({ field: 'VALUE', headerName: 'VALUE', type: 'string', width: 250, sortComparator }).displayColumns[0];
  assert.equal(column.type, 'string'); assert.equal(column.width, 250); assert.equal(column.sortComparator, sortComparator);
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: clearing a loaded view editor does not fetch or replace its draft`, async () => {
    const h = createHookHarness(), pending = [];
    const eventHook = events(h);
    const source = loadTypeScript('src/features/objects/useEditableSource.ts', { react: h.react, '@/shared/hooks/useEventCallback': eventHook });
    const dialect = { language: { data: { of: () => ({}) } } };
    const { useViewWindow } = loadTypeScript(`src/features/${db}/windows/view/useViewWindow.ts`, {
      react: h.react, 'react-i18next': { useTranslation: () => ({ t: translate }) },
      '@/features/objects/useEditableSource': source, '@/shared/utils/objectIdentity': identities,
      '@/shared/utils/errorUtils': { getErrorMessage: String }, '@codemirror/lint': { linter: () => [] }, '@codemirror/lang-sql': { sql: () => ({}), PostgreSQL: dialect },
      '../common/plsqlDialect': { plsqlDialect: dialect, oracleBuiltinCompletions: [] },
      '../common/loadOracleDdl': loadTypeScript('src/features/oracle/windows/common/loadOracleDdl.ts'),
      '@/features/sql/hooks/useDbCompletions': { useDbCompletions: () => ({ dbCompletions: [], dbSchema: {} }) },
      '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
      '@/shared/api/desktop': { beginGlobalLoading: () => () => {}, ipcRenderer: { invoke: () => { const request = deferred(); pending.push(request); return request.promise; } } }
    });
    const render = () => h.render(() => useViewWindow({ tabId: 1, fullViewName: 'APP.VIEW1', isActive: true }));
    render(); h.commit(); render().setActiveTab(1); render(); h.commit();
    assert.equal(pending.length, 1);
    pending[0].resolve({ success: true, rows: [{ DDL: 'CREATE VIEW APP.VIEW1 AS SELECT 1 FROM DUAL', definition: 'SELECT 1' }] });
    await h.settle(); render(); h.commit();
    render().setSourceText(''); render(); h.commit();
    assert.equal(pending.length, 1);
    assert.equal(render().sourceText, '');
    assert.equal(render().hasUnsavedChanges, true);
  });
  test(`${db}: pagination sends one query pair and rejects older search results`, async () => {
    const h = createHookHarness(), pending = [], requests = [];
    let delayed = false;
    const { useTableDataTab } = loadTypeScript(`src/features/${db}/windows/table/useTableDataTab.ts`, {
      react: h.react, 'react-i18next': { useTranslation: () => ({ t: translate }) },
      '@/shared/utils/objectIdentity': identities, '@/shared/hooks/useEventCallback': events(h),
      '@/shared/utils/dateFormatter': { formatDbDate: String }, '@/shared/utils/errorUtils': { getErrorMessage: String },
      './tableRecordEditor': { createTableRecordEditor: () => ({}) }, './tableDataTransfer': { createTableDataTransfer: () => ({}) },
      './tableQueryBuilder': { createTableQueryBuilder: () => ({ buildQueryStrings: () => ({ whereStr: '', orderStr: '' }), formatSqlValue: String }) },
      './tableResultRows': { formatTableResultRows: rows => rows },
      '@/features/data-grid/tableResultHeaders': { decorateTableResultColumns: columns => columns },
      '@/features/data-grid/dataGridHelper': { buildGridColumns: () => [], buildTransposedColumns: () => [] },
      '@/features/table/useTableOpening': { waitForTablePaint: async () => {} },
      '@/shared/api/desktop': { beginGlobalLoading: () => () => {}, ipcRenderer: { invoke: async (_channel, sql) => {
        requests.push(sql);
        if (_channel === 'execute-sql-bg') return { success: true, rows: [{ COLUMN_NAME: 'LABEL', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text' }] };
        if (delayed) { const request = deferred(); pending.push(request); return request.promise; }
        return { success: true, rows: sql.includes('COUNT(*)') ? [{ CNT: 100 }] : [], metaData: [] };
      } } }
    }, { window: { addEventListener() {}, removeEventListener() {} } });
    const render = () => h.render(() => useTableDataTab({ schema: 'APP', tableName: 'ITEMS', isActive: true, outputDateFormat: 'YYYY-MM-DD', inputDateFormat: 'YYYY-MM-DD' }));
    render(); h.commit(); await h.settle(); render(); h.commit();
    requests.length = 0;
    const current = render();
    const page = current.executeSearch({}, 1, 50); render(); h.commit(); await page;
    assert.equal(requests.filter(sql => sql.includes('COUNT(*)')).length, 1);
    assert.equal(requests.length, 2);
    delayed = true;
    const old = render().executeSearch({}, 1, 50), latest = render().executeSearch({}, 2, 50);
    const result = label => ({ success: true, rows: [{ LABEL: label, ORACLE_ROWID: label }], metaData: [] });
    assert.equal(pending.length, 2, 'Only the two count requests start initially');
    pending[1].resolve({ success: true, rows: [{ CNT: 100 }] }); await h.settle();
    assert.equal(pending.length, 3); pending[2].resolve(result('latest')); await latest;
    pending[0].resolve({ success: true, rows: [{ CNT: 999 }] }); await old;
    assert.equal(pending.length, 3, 'A stale count must not start another data request');
    assert.equal(render().rowCount, 100);
    assert.equal(render().displayRows[0].LABEL, 'latest');
  });
}
