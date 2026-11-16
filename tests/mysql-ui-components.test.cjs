// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');

test('Shared transaction actions animate both pending buttons and stop after finishing or disabling', async () => {
  const calls = [];
  const f = render('src/components/TopMenuBar.tsx', { onCommit: () => calls.push('commit'), onRollback: () => calls.push('rollback'), hasUncommittedTx: false, disabled: false });
  for (const pending of [false, true, false]) {
    f.props.hasUncommittedTx = pending; f.render();
    assert.equal(f.node('Chip'), undefined);
    for (const action of ['commit', 'rollback']) {
      const button = f.button(action);
      assert.equal(button.props.variant, pending ? 'contained' : 'outlined');
      assert.equal(button.props.sx.animation === 'none', !pending);
      assert.equal(button.props.sx['@media (prefers-reduced-motion: reduce)'].animation, 'none');
      assert.equal(button.props['aria-description'], pending ? 'ux_pending_transaction' : undefined);
    }
  }
  await f.click('commit'); await f.click('rollback');
  assert.deepEqual(calls, ['commit', 'rollback']);
  f.props.hasUncommittedTx = true; f.props.disabled = true; f.render();
  for (const action of ['commit', 'rollback']) {
    assert.equal(f.button(action).props.disabled, true);
    assert.equal(f.button(action).props.sx.animation, 'none');
    assert.equal(f.button(action).props.variant, 'contained');
  }
  f.unmount();
});

function sidebarFixture(overrides = {}) {
  const object = { key: 'demo-table', dbType: 'mysql', schema: 'demo', name: 'orders', displayName: 'orders', category: 'TABLE' };
  const calls = [], props = { open: true, width: 280, database: 'demo', schemas: ['demo', 'other', 'information_schema'], busy: false, disabled: false, readonly: false, canOpen: true, outputDateFormat: 'YYYY-MM-DD', onToggle: () => calls.push('toggle'), onOpenObject: value => calls.push(['open', value]), onOpenSql: (...args) => calls.push(['sql', ...args]), onCreateTable: schema => calls.push(['create', schema]), onOpenCategory() {}, setBusy() {}, onState() {}, ...overrides };
  const tables = { expanded: ['demo'], pages: { demo: { rows: [object], loading: false, more: true, filter: '', applied: '' } }, toggle: schema => calls.push(['category', schema]), filter: (...args) => calls.push(['filter', ...args]), refresh: schema => calls.push(['refresh', schema]), retry() {}, more: schema => calls.push(['more', schema]) };
  const f = render('src/features/mysql/Sidebar.tsx', props, { dependencies: {
    './useSidebarTables': { useSidebarTables: () => tables }, './function/FunctionSidebarCategory':'FunctionCategory','./procedure/ProcedureSidebarCategory':'ProcedureCategory', './trigger/TriggerSidebarCategory': 'TriggerCategory', './view/ViewSidebarCategory': 'ViewCategory', './index/IndexSidebarCategory': 'IndexCategory', './SidebarTableDialog': 'TableAction', './sidebarDataTransfer': {}, './sidebarTableActions': {}, './table/tableRepository': {},
    './table/tableModel': { mysqlTableName: (schema, name) => '`' + schema + '`.`' + name + '`' },
    '@/components/data/ExportDialog': 'ExportDialog', '@/components/data/ImportDialog': 'ImportDialog'
  } });
  return { f, calls, object, tables };
}

test('MySQL table sidebar follows Oracle expansion, selection, opening and pagination without a SQL category', () => {
  const { f, calls, object } = sidebarFixture();
  assert.equal(f.node('Paper').props.component, 'aside');
  assert.ok(!f.nodes().some(node => node.type === 'ListItemText' && node.props.primary === 'sql_window'));  assert.ok(!f.text().includes('information_schema'));
  const category = f.node('ListItemButton', node => node.props['data-sidebar-level'] === 2 && node.props['data-mysql-table-category']);
  category.props.onClick(); assert.deepEqual(calls.pop(), ['category', 'demo']);
  const row = f.node('ListItemButton', node => node.props['data-sidebar-object']);
  row.props.onClick(); f.render(); assert.equal(calls.length, 0); assert.equal(f.node('ListItemButton', node => node.props['data-sidebar-object']).props.selected, true);
  row.props.onDoubleClick(); assert.deepEqual(calls.pop(), ['open', object]);
  f.button('create_new_table').props.onClick(); assert.deepEqual(calls.pop(), ['create', 'demo']);
  f.button('refresh_to_latest_state').props.onClick(); assert.deepEqual(calls.pop(), ['refresh', 'demo']);
  f.node('TextField').props.onChange({ target: { value: 'invoice' } }); assert.deepEqual(calls.pop(), ['filter', 'demo', 'invoice']);
  f.node('ListItemButton', node => node.children.some(child => child?.props?.primary === 'show_100_more')).props.onClick(); assert.deepEqual(calls.pop(), ['more', 'demo']);
  f.props.open = false; f.render(); assert.equal(f.node('Paper').props.sx.width, 56); f.button('sidebar_expand').props.onClick(); assert.equal(calls.pop(), 'toggle');
  f.unmount();
});

test('MySQL table context menu exposes Oracle-equivalent actions and protects readonly mutations', () => {
  const { f, calls } = sidebarFixture({ readonly: true });
  f.node('ListItemButton', node => node.props['data-sidebar-object']).props.onContextMenu({ preventDefault() {}, clientX: 10, clientY: 20 }); f.render();
  const menu = label => f.node('MenuItem', node => node.children.includes(label));
  for (const label of ['rename_table', 'copy_table', 'gather_stats_analyze_2', 'import', 'truncate', 'drop']) assert.equal(menu(label).props.disabled, true, label);
  assert.equal(menu('export').props.disabled, false); assert.equal(menu('open').props.disabled, false);
  menu('open_in_sql_window').props.onClick(); assert.deepEqual(calls.pop(), ['sql', 'demo', 'SELECT * FROM `demo`.`orders`;']);
  assert.equal(f.button('create_new_table').props.disabled, true);
  f.props.readonly = false; f.props.busy = true; f.render();
  assert.equal(menu('export').props.disabled, true); assert.equal(menu('open').props.disabled, true); f.unmount();
});

test('MySQL processing overlay uses all themes, a Mona paw and only offers cancellation for cancellable SQL', async () => {
  for (const monaStyle of [false, true]) {
    let cancelled = 0;
    const f = render('src/features/mysql/LoadingOverlay.tsx', { open: true, monaStyle, cancelable: true, onCancel: () => cancelled++ }, { themeMode: 'dark' });
    assert.equal(f.tree.props.open, true);
    assert.equal(f.node('CircularProgress').props.size, 50);
    assert.equal(f.button('abort_process').props.startIcon.type === 'SvgIcon', monaStyle);
    await f.click('abort_process'); assert.equal(cancelled, 1);
    f.props.cancelable = false; f.render(); assert.equal(f.button('abort_process'), undefined);
    f.props.open = false; f.render(); assert.equal(f.tree.props.open, false);
    f.unmount();
  }
});

test('MySQL table source directly shows shared Git controls without a draft editor or coding AI', async () => {
  const object = { key: 'table-source', dbType: 'mysql', schema: 'demo', name: 'orders', displayName: 'orders', category: 'TABLE' };
  let definition = 'CREATE TABLE orders(id int)', failure = false, reads = 0;
  const win = new EventTarget();
  const f = render('src/features/mysql/table/TableSourceTab.tsx', { object, active: true }, { dependencies: {
    '@/features/git/VersionControlTab': 'VersionControl',
    '@/features/objects/objectRepository': { loadObjectReference: async () => { reads++; if (failure) throw new Error('metadata denied'); return { definition }; } }
  }, globals: { window: win, CustomEvent } });
  await f.flush();
  assert.equal(f.node('VersionControl').props.currentSource, definition);
  assert.equal(f.node('VersionControl').props.objectType, 'TABLE'); assert.equal(f.node('VersionControl').props.dbType, 'MYSQL');
  assert.equal(f.node('VersionControl').props.isSourceLoading, false); assert.equal(f.node('CodeMirror'), undefined); assert.equal(f.node('Tabs'), undefined);
  definition = 'CREATE TABLE orders(id int, label text)';
  await f.node('VersionControl').props.onRefresh(); await f.flush(); assert.equal(f.node('VersionControl').props.currentSource, definition);
  f.props.active = false; await f.flush(); const count = reads;
  win.dispatchEvent(new CustomEvent('reload-source', { detail: { schema: 'other', tableName: 'orders' } })); await f.flush(); assert.equal(reads, count);
  win.dispatchEvent(new CustomEvent('reload-source', { detail: { schema: 'demo', tableName: 'orders' } })); await f.flush(); assert.equal(reads, count);
  f.props.active = true; await f.flush(); assert.equal(reads, count + 1);
  failure = true; await f.node('VersionControl').props.onRefresh(); await f.flush();
  assert.equal(f.node('VersionControl').props.isSourceLoading, true); assert.ok(f.node('Alert')); assert.equal(f.node('VersionControl').props.currentSource, definition);
  failure = false; await f.click('retry'); await f.flush(); assert.equal(f.node('VersionControl').props.isSourceLoading, false); f.unmount();
});

test('MySQL data headers use applied conditions, Oracle click sorting, and no native grid menu/filter', async () => {
  const calls = [], decorations = [];
  const condition = { operator: '=', value: 'applied', sort: '1 DESC', type: 'STRING' };
  const controller = { metadata: { table: { ENGINE: 'InnoDB' }, columns: [{ COLUMN_NAME: 'label', DATA_TYPE: 'varchar', EXTRA: '', PK_POSITION: 0 }] },
    rows: [require('./helpers/loadTypeScript.cjs').loadTypeScript('src/features/data-grid/rowIdentity.ts').withRowIdentity({ id: 1, label: 'row' }, 1)], selection: [], total: 1, conditions: { label: { ...condition, value: 'draft' } }, applied: { label: condition }, pagination: { page: 0, pageSize: 100 }, logs: [],
    sortByColumn: field => calls.push(field), setConditions() {}, setError() {}, setSelection() {} };
  const props = { active: true, busy: false, disabled: false, readonly: false, settings: { outputDateFormat: 'YYYY-MM-DD' } };
  const f = render('src/features/mysql/table/TableDataTab.tsx', { controller, props }, { dependencies: {
    '@mui/x-data-grid': { DataGrid: 'DataGrid', enUS: require('@mui/x-data-grid').enUS, jaJP: require('@mui/x-data-grid').jaJP },
    '../VerticalSplit': 'VerticalSplit',
    './tableModel': { canEditTable: () => true, isGenerated: () => false, isSupportedColumn: () => true, isBinary: () => false },
    '@/features/data-grid/tableResultHeaders': { decorateTableResultColumns: (columns, applied) => { decorations.push(applied); return columns; } },
    '@/features/data-grid/dataGridHelper': { buildGridColumns: (metadata, _format, options) => metadata.map(column => ({ field: column.name, ...options })), buildTransposedColumns: () => [{ field: 'colName', sortable: false }], getFormattedValue: value => value },
    '@/features/data-grid/GridViewport': { GridViewport: 'Viewport' },
    '@/components/data/ConditionPanel': 'ConditionPanel', '@/components/data/ExportDialog': 'Export', '@/components/data/ImportDialog': 'Import',
    '@/components/data/CellValueInspector': { useCellValueInspector: () => ({ menuItems: () => null }), cellMenuTrigger: () => null }
  } });
  assert.equal(decorations.at(-1), controller.applied);
  const grid = f.node('DataGrid');
  assert.equal(grid.props.disableColumnMenu, true); assert.equal(grid.props.disableColumnFilter, true); assert.equal(grid.props.columns[0].sortable, false);
  grid.props.onColumnHeaderClick({ field: 'label' }); assert.deepEqual(calls, ['label']);
  props.busy = true; f.render(); f.node('DataGrid').props.onColumnHeaderClick({ field: 'label' }); assert.equal(calls.length, 1);
  props.busy = false; f.render(); await f.click('transpose_swap_rows_and_columns');
  f.node('DataGrid').props.onColumnHeaderClick({ field: 'colName' }); assert.equal(calls.length, 1);
  await f.click('transpose_swap_rows_and_columns'); f.props.view = true; props.readonly = true; f.render();
  assert.equal(f.button('add_new_record_ctrl_i'), undefined); assert.equal(f.button('delete_selected_rows'), undefined); assert.equal(f.node('Import'), undefined); assert.equal(f.node('DataGrid').props.checkboxSelection, false); assert.equal(f.node('Export').props.totalCount, 1); f.unmount();
});

test('MySQL vertical splits reuse Oracle SQL drag/keyboard handling with table-specific initial heights', () => {
  for (const [name, height] of [['data', 250], ['structure', 300], ['statistics', 200]]) {
    const calls = [], key = () => {}, mouse = () => {};
    const f = render('src/features/mysql/VerticalSplit.tsx', { name, active: true, initialHeight: height, upper: 'upper content', lower: 'lower content' }, { dependencies: {
      '@/features/sql/SqlPaneLayout': { useSqlPaneLayout: (active, initial) => { calls.push([active, initial]); return { rootRef: { current: null }, height: initial, isResizing: false, separatorProps: { role: 'separator', tabIndex: 0, 'aria-orientation': 'horizontal', onMouseDown: mouse, onKeyDown: key } }; } }
    } });
    assert.equal(f.tree.props['data-testid'], 'mysql-split-' + name);
    assert.equal(f.node('Box', node => Object.hasOwn(node.props, 'data-split-upper')).props.sx.height, height);
    const bar = f.node('Box', node => node.props.role === 'separator'); assert.equal(bar.props.onMouseDown, mouse); assert.equal(bar.props.onKeyDown, key);
    assert.equal(bar.props.tabIndex, 0); assert.equal(bar.props['aria-label'], 'resize_vertical_panes');
    f.props.active = false; f.render(); assert.deepEqual(calls.at(-1), [false, height]); f.unmount();
  }
});

test('MySQL structure and statistics split bounded grids while the relation remains a single view', () => {
  const metadata = { table: { ENGINE: 'InnoDB', TABLE_COMMENT: '', TABLE_COLLATION: 'utf8mb4' }, columns: [], indexes: [], checks: [], triggers: [], relations: [] };
  const f = render('src/features/mysql/table/TableMetadataTab.tsx', { mode: 'structure', controller: { metadata }, props: { active: true, busy: false, disabled: false, readonly: false, schema: 'demo', table: 't' } }, { dependencies: {
    '../VerticalSplit': 'Split', './TableDdlDialog': 'DDL','./tableModel':require('./helpers/loadTypeScript.cjs').loadTypeScript('src/features/mysql/table/tableModel.ts'),
    '@/features/data-grid/GridViewport': { GridViewport: 'Viewport' }, '@/components/data/ExportDialog': 'Export',
    '@mui/x-data-grid': { DataGrid: 'DataGrid', enUS: require('@mui/x-data-grid').enUS, jaJP: require('@mui/x-data-grid').jaJP }
  } });
  assert.equal(f.node('Split').props.name, 'structure'); assert.equal(f.node('Split').props.initialHeight, 300);
  assert.equal(f.nodes().filter(node => node.type === 'DataGrid' && !node.props.autoHeight).length, 1);
  f.props.mode = 'statistics'; f.render(); assert.equal(f.node('Split').props.initialHeight, 200);
  assert.equal(f.nodes().filter(node => node.type === 'DataGrid' && !node.props.autoHeight).length, 2);
  f.props.mode = 'relation'; f.render(); assert.equal(f.node('Split'), undefined); f.unmount();
});
