// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { mysqlCrossTab } = require('./helpers/mysqlCrossTab.cjs');
const model = loadTypeScript('src/features/mysql/bi/crossTabModel.ts');
const columns = [{ name: 'region', type: 'VARCHAR' },{ name: 'category', type: 'VARCHAR' },{ name: 'amount', type: 'DECIMAL' },{ name: 'stamp', type: 'TIMESTAMP' },{ name: 'numeric_text', type: 'VARCHAR' }];
const settings = () => ({ version: 1, dbType: 'mysql', schema: 'mb_test', objectType: 'TABLE', selectedObject: 'demo', rowField: 'region', rowCastType: 'STRING', rowDateFormat: 'YYYYMMDD', rowDateGroup: 'NONE', rowNumGroup: model.defaultNumberGroup(), colField: 'category', colCastType: 'STRING', colDateFormat: 'YYYYMMDD', colDateGroup: 'NONE', colNumGroup: model.defaultNumberGroup(), valField: 'amount', aggType: 'SUM', conditions: model.defaultConditions(columns) });
async function fixture() {
  let mode = 'success';
  const f = await mysqlCrossTab(async (channel, sql) => {
    if (channel === 'show-save-dialog') return { canceled: false, filePath: '/tmp/cross-tab-test.json' };
    if (channel === 'save-file') return { success: true };
    if (channel === 'execute-sql-bg') {
      if (/TABLE_NAME name/.test(sql)) return { success: true, rows: [{ name: 'demo' }] };
      if (/SELECT TABLE_TYPE/.test(sql)) return { success: true, rows: [{ TABLE_TYPE: 'BASE TABLE' }] };
      return { success: true, rows: columns };
    }
    if (mode === 'transport') throw new Error('Fixture disconnected');
    if (/SELECT DISTINCT/.test(sql)) return { success: true, rows: mode === 'empty' ? [] : mode === 'limit' ? Array.from({ length: 201 },(_,i)=>({COL_VAL:String(i)})) : [{ COL_VAL: 'ROW_VALUE' },{ COL_VAL: "USD'雪" }], transactionStatus: 'active', hasUncommittedTx: true };
    if (mode === 'failure') return { success: false, error: 'Fixture aggregate failed', transactionStatus: 'active', hasUncommittedTx: true };
    return { success: true, rows: [{ ROW_VALUE: 'North', ROW_SORT: 'North', pivot_0: '12345678901234567890.123456789012345678', pivot_1: null }], transactionStatus: 'active', hasUncommittedTx: true };
  });
  return Object.assign(f, { setMode: value => { mode = value; } });
}
test('MySQL cross-tab builds bound conditional aggregates, date and numeric classes with collision-free categories', () => {
  const state = settings(); state.selectedObject = 'odd`"table'; state.conditions.region.value = "O'Brien\\%_";
  const query = model.buildCrossTab(state, columns, 'YYYY/MM/DD'), request = query.pivot(['ROW_VALUE',"USD'雪"]);
  assert.match(request.sql,/`mb_test`\.`odd``"table`/); assert.ok(!request.sql.includes("O'Brien")); assert.ok(!request.sql.includes("USD'雪")); assert.equal(request.binds.c1,"USD'雪"); assert.match(request.sql,/SUM\(CASE WHEN q.COL_VALUE = :c0 THEN q.VAL_VALUE END\) AS `pivot_0`/);
  assert.equal(model.formatPivotNumber('12345678901234567890.123456789012345678','comma'),'12,345,678,901,234,567,890.123456789012345678');
  state.rowField='stamp'; state.rowCastType='NONE'; state.rowDateGroup='QUARTER'; state.colField='amount'; state.colCastType='NUMBER'; state.colNumGroup={enable:true,start:10,end:30,step:10};
  const grouped = model.buildCrossTab(state,columns,'YYYY/MM/DD'); assert.match(grouped.distinct,/FLOOR/); assert.match(grouped.pivot(['10-19']).sql,/'-Q'/);
  assert.throws(()=>model.buildCrossTab({...state,colNumGroup:{enable:true,start:10,end:0,step:0}},columns,''));
  assert.throws(()=>model.parseCrossTabSettings({...state,dbType:'oracle'},columns)); assert.throws(()=>model.parseCrossTabSettings({...state,aggType:'COUNT); DROP TABLE demo'},columns));
  const cast = model.buildCrossTab({...settings(),rowField:'numeric_text',rowCastType:'NUMBER'},columns,'YYYY/MM/DD'); assert.match(cast.validation,/REGEXP_LIKE/);
});
test('MySQL cross-tab controller preserves exact results, native transactions, filters, JSON and chart export', async () => {
  const f = await fixture();
  try {
    f.state.handleChangeObject({target:{value:'demo'}}); await f.flush(); await f.state.handleFetchColumns(); await f.flush(); assert.equal(f.state.columns.length,5);
    f.state.handleConditionChange('region','value','North'); await f.flush(); await f.state.handleGeneratePivot(); await f.flush();
    assert.equal(f.state.pivotRows[0].pivot_0,'12345678901234567890.123456789012345678'); assert.equal(f.state.pivotColumns[1].headerName,'ROW_VALUE'); assert.equal(f.state.pivotColumns[1].field,'pivot_0'); assert.equal(f.states.at(-1).hasUncommittedTx,true);
    assert.equal(f.state.pivotColumns[1].valueFormatter({value:'1000.25'}),'1,000.25');
    await f.state.handleExportSettings(); await f.flush(); const saved = f.calls.find(call=>call[0]==='save-file'); assert.equal(JSON.parse(saved[2]).dbType,'mysql');
    f.state.handleImportFileChange({target:{files:[{size:100}],value:'chosen'}}); f.readers.at(-1).result=saved[2]; await f.readers.at(-1).onload(); await f.flush(); assert.equal(f.state.conditions.region.value,'North');
    await f.state.handleGeneratePivot(); await f.flush(); await f.state.handleCopyGraph(); await f.flush(); assert.ok(f.calls.some(call=>call[0]==='clipboard'));
    assert.ok(!f.calls.some(call=>/commit|rollback/.test(call[0])));
  } finally { f.unmount(); }
});
test('MySQL cross-tab failures, empty data, category bounds and transport loss do not replace prior results or finish transactions', async () => {
  const f = await fixture();
  try {
    f.state.handleChangeObject({target:{value:'demo'}}); await f.flush(); await f.state.handleFetchColumns(); await f.flush(); await f.state.handleGeneratePivot(); await f.flush();
    for (const mode of ['failure','empty','limit','transport']) { f.setMode(mode); await f.state.handleGeneratePivot(); await f.flush(); assert.equal(f.state.bottomTab,2); assert.equal(f.state.pivotRows.length,1); assert.ok(f.state.logs[0].errorLines.length); }
    assert.equal(f.states.at(-1).transactionStatus,'unknown');
    f.props.disabled=true; await f.flush(); const before=f.calls.length; await f.state.handleGeneratePivot(); assert.equal(f.calls.length,before);
  } finally { f.unmount(); }
});
test('Shared Oracle/MySQL cross-tab panel retains setup, filters, exports and chart styles without unsupported object types', async () => {
  const { componentHarness } = require('./helpers/componentHarness.cjs');
  const h = await fixture();
  h.state.handleChangeObject({target:{value:'demo'}}); await h.flush(); await h.state.handleFetchColumns(); await h.flush(); await h.state.handleGeneratePivot(); await h.flush();
  const f = componentHarness('src/features/cross-tab/CrossTabPanel.tsx', { tabId:1,isActive:true,schemas:['mb_test'],initialSchema:'mb_test',inputDateFormat:'YYYY/MM/DD',dbType:'mysql',language:'en',controller:h.state }, { dependencies:{
    './crossTabTypes':loadTypeScript('src/features/cross-tab/crossTabTypes.ts'), '@/features/data-grid/StableGridFooter':{GridFooterContent:{Provider:'Provider'},StableGridFooter:'Footer'},
    '@/components/data/ExportDialog':'Export', '@/components/data/ConditionPanel':'Conditions', recharts:new Proxy({},{get:(_,key)=>key})
  }});
  try {
    assert.ok(!f.text().includes('MATERIALIZED VIEW')); assert.equal(f.node('Conditions').props.hideSort,true); assert.equal(f.node('DataGrid').props.getRowId(h.state.pivotRows[0]),0);
    assert.equal(f.node('Box').props.component,'fieldset'); assert.equal(f.node('BarChart'),undefined);
    h.state.setBottomTab(1); await h.flush(); f.props.controller=h.state; f.render();
    for(const [type,chart] of [['bar','BarChart'],['line','LineChart'],['area','AreaChart']]){h.state.setGraphType(type);await h.flush();f.props.controller=h.state;f.render();assert.ok(f.node(chart));assert.equal(f.node('DataGrid'),undefined);}
    f.props.disabled=true;f.render();assert.equal(f.node('Box').props.disabled,true);f.props.isActive=false;f.render();assert.equal(f.tree,null);
  }finally{f.unmount();h.unmount();}
});
test('MySQL cross-tab imports are atomic, reject foreign formats and stale reads, and cannot start work after unmount', async () => {
  const f = await fixture();
  try {
    f.state.handleChangeObject({target:{value:'demo'}});await f.flush();await f.state.handleFetchColumns();await f.flush();
    f.state.handleImportFileChange({target:{files:[{size:100}],value:'selected'}});f.readers.at(-1).result=JSON.stringify({...settings(),dbType:'oracle'});await f.readers.at(-1).onload();await f.flush();assert.equal(f.state.selectedObject,'demo');assert.ok(f.alerts.includes('mysql_cross_tab_invalid_settings'));
    f.state.handleImportFileChange({target:{files:[{size:100}],value:'selected'}});const reader=f.readers.at(-1);f.state.handleConditionChange('region','value','modified');await f.flush();reader.result=JSON.stringify(settings());await reader.onload();await f.flush();assert.equal(f.state.conditions.region.value,'modified');assert.equal(f.alerts.at(-1),'mysql_cross_tab_settings_outdated');
    f.state.handleImportFileChange({target:{files:[{size:2*1024*1024}],value:'selected'}});assert.equal(f.alerts.at(-1),'mysql_cross_tab_file_limit');
    f.unmount();const before=f.calls.length;await f.state.handleGeneratePivot();assert.equal(f.calls.length,before);
  }finally{f.unmount();}
});
