// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const grid = { DataGrid: 'DataGrid', GridPagination: 'GridPagination', jaJP: { components: { MuiDataGrid: { defaultProps: { localeText: {} } } } } };
const windowStub = () => ({ addEventListener() {}, removeEventListener() {}, dispatchEvent() {} });

for (const database of ['oracle', 'postgresql']) {
  test(`${database} relation view protects destructive/loading actions and edits a composite foreign key before confirmation`, async () => {
    const actions = [], logic = { t: key => key, isLoading: true, isDialogLoading: true, relationsRows: [], dialogOpen: true, fkName: '', sourceColumns: [], targetTable: '', targetColumns: [], deleteRule: 'NO ACTION', currentTableCols: ['id', 'tenant'], allTables: ['parent'], targetTableCols: ['id', 'tenant'],
      setDialogOpen: value => actions.push(['open', value]), setFkName() {}, setSourceColumns: value => actions.push(['source', Array.from(value)]), setTargetColumns: value => actions.push(['target', Array.from(value)]), setDeleteRule() {}, handleTargetTableChange: value => actions.push(['table', value]), handleOpenAddDialog: () => actions.push(['add']), submitRelation: () => actions.push(['submit']), handleDropRelation: value => actions.push(['drop', value]) };
    const locale = { components: { MuiDataGrid: { defaultProps: { localeText: {} } } } };
    const f = render(`src/features/${database}/windows/table/TableRelationTab.tsx`, { isActive: true, schema: 'test', tableName: 'orders' }, { dependencies: { './useTableRelationTab': { useTableRelationTab: () => logic }, '@mui/x-data-grid': { ...grid, enUS: locale } } });
    assert.equal(f.button('add_relation_2').props.disabled, true); assert.equal(f.node('Box', node => node.props.component === 'fieldset').props.disabled, true);
    const drop = () => f.node('DataGrid').props.columns.find(column => column.field === 'actions').renderCell({ row: { CONSTRAINT_NAME: 'FK_COMPOSITE' } }).children[0].children[0];
    assert.equal(drop().props.disabled, true);
    f.node('Dialog').props.onClose({}, 'backdropClick'); assert.deepEqual(actions, []);
    logic.isLoading = false; logic.isDialogLoading = false; f.render(); await f.click('add_relation_2');
    f.node('Select', node => node.props.label === 'target_columns_multi_select').props.onChange({ target: { value: 'id,tenant' } });
    f.node('Select', node => node.props.label === 'referenced_table').props.onChange({ target: { value: 'parent' } });
    f.node('Select', node => node.props.label === 'referenced_columns_multi_select').props.onChange({ target: { value: ['id', 'tenant'] } });
    assert.deepEqual(actions, [['add'], ['source', ['id', 'tenant']], ['table', 'parent'], ['target', ['id', 'tenant']]]);
    drop().props.onClick(); assert.deepEqual(actions.at(-1), ['drop', 'FK_COMPOSITE']); f.unmount();
  });

  test(`${database} create-table screen validates input, keeps failed definitions and announces only successful creation`, async () => {
    const calls = [], alerts = [], events = []; let fail = true;
    const globals = { alert: value => alerts.push(value), window: { ...windowStub(), dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } };
    const desktop = { ipcRenderer: { invoke: async (channel, sql) => { calls.push([channel, sql]); return channel === 'execute-sql-bg' ? { success: true, rows: [] } : fail ? { success: false, error: 'Creation rejected' } : { success: true }; } } };
    const f = render(`src/features/${database}/windows/table/CreateTableWindow.tsx`, { isActive: true, tabId: 7, schema: 'test' }, {
      globals, dependencies: (React, deps) => ({ '@mui/x-data-grid': grid, '../common/ColumnDefDialog': 'ColumnDialog',
        './useCreateTableWindow': loadTypeScript(`src/features/${database}/windows/table/useCreateTableWindow.ts`, { ...deps, react: React, '@/shared/api/desktop': desktop }, globals) })
    });
    await f.flush(); const create = f.nodes().find(node => node.type === 'Button' && node.props.startIcon?.type === 'Save'); assert.ok(create);
    await create.props.onClick(); assert.equal(alerts.at(-1), 'please_enter_table_name'); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0);
    f.node('TextField', node => node.props.label === 'table_name').props.onChange({ target: { value: 'orders' } }); f.render();
    await f.nodes().find(node => node.type === 'Button' && node.props.startIcon?.type === 'Save').props.onClick(); assert.equal(alerts.at(-1), 'please_add_at_least_one_column');
    f.nodes().find(node => node.type === 'Button' && node.props.startIcon?.type === 'Add').props.onClick(); f.render();
    let dialog = f.node('ColumnDialog'); dialog.props.setDialogState({ ...dialog.props.dialogState, newColName: 'id', newType: database === 'oracle' ? 'NUMBER' : 'INTEGER', newLength: '', newNullable: 'N', isPk: true }); f.render();
    f.node('ColumnDialog').props.onSubmit(); f.render(); assert.equal(f.node('DataGrid').props.rows.length, 1);
    await f.nodes().find(node => node.type === 'Button' && node.props.startIcon?.type === 'Save').props.onClick(); f.render();
    assert.ok(alerts.at(-1).includes('Creation rejected')); assert.equal(events.length, 0); assert.equal(f.node('DataGrid').props.rows.length, 1);
    fail = false; await f.nodes().find(node => node.type === 'Button' && node.props.startIcon?.type === 'Save').props.onClick(); f.render();
    assert.equal(alerts.at(-1), 'table_created'); assert.equal(events.length, 1); assert.equal(events[0].type, 'table-created'); assert.equal(events[0].detail.tabId, 7);
    const writes = calls.filter(call => call[0] === 'execute-sql'); assert.ok(writes.some(call => call[1].startsWith('CREATE TABLE "test".'))); assert.ok(writes.some(call => call[1].includes('PRIMARY KEY')));
    f.props.isActive = false; f.render(); assert.equal(f.tree, null); f.unmount();
  });

  test(`${database} cross-tab screen connects real settings, aggregation, chart choice, errors and object reset`, async () => {
    const calls = [], alerts = []; let phase = 'success', logic;
    const globals = { window: windowStub(), alert: value => alerts.push(value) };
    const desktop = { ipcRenderer: { invoke: async (channel, sql) => {
      calls.push([channel, sql]);
      if (channel === 'load-settings') return { numberFormat: 'comma' };
      if (channel === 'get-objects') return { success: true, objects: ['ORDERS'] };
      if (channel === 'get-schemas') return { success: true, schemas: ['test'] };
      if (String(sql).includes('SELECT DISTINCT')) return { success: true, rows: phase === 'empty' ? [] : phase === 'limit' ? Array.from({ length: 201 }, (_, index) => ({ COL_VAL: String(index), col_val: String(index) })) : [{ COL_VAL: 'USD', col_val: 'USD' }] };
      if (String(sql).includes('ALL_TAB_COLUMNS') || channel === 'execute-sql-bg') return { success: true, rows: ['REGION', 'CURRENCY', 'AMOUNT'].map(name => ({ COLUMN_NAME: name, DATA_TYPE: 'VARCHAR2' })) };
      return phase === 'failure' ? { success: false, error: 'Aggregation rejected' } : { success: true, rows: [{ ROW_VALUE: 'North', USD: '1234' }] };
    } } };
    const f = render(`src/features/${database}/windows/bi/CrossTabWindow.tsx`, { isActive: true, initialSchema: 'test', schemas: ['test'], inputDateFormat: 'YYYY-MM-DD' }, {
      globals, dependencies: (React, deps) => {
        const hook = loadTypeScript(`src/features/${database}/windows/bi/useCrossTabWindow.ts`, { ...deps, react: React, '../common/schemaStorage': { getPgSelectSchema: () => '', savePgSelectSchema() {} }, '@/shared/api/desktop': desktop, 'html-to-image': { toPng() { throw new Error('No chart export expected'); } } }, globals);
        return { './useCrossTabWindow': { ...hook, useCrossTabWindow: props => (logic = hook.useCrossTabWindow(props)) }, '@mui/x-data-grid': grid,
          '@/features/data-grid/StableGridFooter': { GridFooterContent: { Provider: 'Provider' }, StableGridFooter: 'Footer' },
          '@/components/data/ExportDialog': 'Export', '@/components/data/ConditionPanel': 'Conditions', recharts: new Proxy({}, { get: (_, key) => key }) };
      }
    });
    await f.flush(); assert.equal(f.button('start_setup').props.disabled, true);
    await logic.handleGeneratePivot(); assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 0);
    f.node('Select', node => node.props.label === 'object').props.onChange({ target: { value: 'ORDERS' } }); f.render(); await f.click('start_setup');
    assert.equal(logic.columns.length, 3); assert.equal(f.node('Conditions').props.hideSort, true);
    await f.click('execute_cross_tab'); assert.equal(f.node('DataGrid').props.rows[0].USD, '1234'); assert.equal(f.node('DataGrid').props.columns[1].field, 'USD');
    for (const [choice, chart] of [['bar', 'BarChart'], ['line', 'LineChart'], ['area', 'AreaChart']]) { logic.setGraphType(choice); f.render(); assert.ok(f.node(chart)); }
    phase = 'failure'; await f.click('execute_cross_tab'); assert.ok(alerts.length); assert.equal(logic.bottomTab, 2); assert.ok(logic.logs[0].errorLines.length);
    phase = 'empty'; await f.click('execute_cross_tab'); assert.equal(alerts.at(-1), 'no_data_matches_the_specified_filter_condition');
    phase = 'limit'; await f.click('execute_cross_tab'); assert.equal(alerts.at(-1), 'cross_tab_category_limit');
    f.node('Select', node => node.props.label === 'object').props.onChange({ target: { value: 'OTHER' } }); f.render(); assert.equal(f.node('DataGrid'), undefined); assert.equal(logic.columns.length, 0);
    f.props.isActive = false; f.render(); assert.equal(f.tree, null); f.unmount();
  });
}
