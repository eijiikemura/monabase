// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');const {componentHarness}=require('./helpers/componentHarness.cjs');
const model=loadTypeScript('src/features/mysql/table/columnDefinition.ts',{}, {Error});const {structureRows}=loadTypeScript('src/features/mysql/table/tableStructureModel.ts');
const column={COLUMN_NAME:'label',DATA_TYPE:'varchar',COLUMN_TYPE:'varchar(80)',IS_NULLABLE:'YES',COLUMN_DEFAULT:'before',EXTRA:'',COLUMN_COMMENT:'old',GENERATION_EXPRESSION:'',PK_POSITION:0,CHARACTER_MAXIMUM_LENGTH:'80'};
const metadata={table:{TABLE_TYPE:'BASE TABLE',ENGINE:'InnoDB'},columns:[column],indexes:[],checks:[],triggers:[],relations:[]};
const native="CREATE TABLE `t` (`label` varchar(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'before' COMMENT 'old' /*!80023 INVISIBLE */, KEY `label` (`label`)) ENGINE=InnoDB";
const build=(edit,source=native,m=metadata)=>model.buildColumnChange('demo','t',m,{...model.columnForm(m.columns[0]),...edit},model.columnDefinition(source,m.columns[0].COLUMN_NAME));
test('MySQL structure separates type and dimensions, blanks non-primary keys and records unique key positions',()=>{
 const m={...metadata,columns:[column,{...column,COLUMN_NAME:'amount',DATA_TYPE:'decimal',COLUMN_TYPE:'decimal(20,8) unsigned',NUMERIC_PRECISION:'20',NUMERIC_SCALE:'8',CHARACTER_MAXIMUM_LENGTH:null},{...column,COLUMN_NAME:'id',PK_POSITION:1}],indexes:[{INDEX_NAME:'u',NON_UNIQUE:0,COLUMN_NAME:'label',SEQ_IN_INDEX:1},{INDEX_NAME:'u',NON_UNIQUE:0,COLUMN_NAME:'amount',SEQ_IN_INDEX:2},{INDEX_NAME:'PRIMARY',NON_UNIQUE:0,COLUMN_NAME:'id',SEQ_IN_INDEX:1}]};
 const rows=structureRows(m);assert.equal(rows[0].TYPE_DISPLAY,'VARCHAR');assert.equal(rows[0].LENGTH_PRECISION,'80');assert.equal(rows[0].PK_DISPLAY,'');assert.equal(rows[0].UK_DATA[0].position,'1');assert.equal(rows[1].UK_DATA[0].composite,true);assert.equal(rows[1].TYPE_DISPLAY,'DECIMAL UNSIGNED');assert.equal(rows[1].LENGTH_PRECISION,'(20, 8)');assert.equal(rows[2].PK_DISPLAY,'1');assert.equal(rows[2].UK_DATA.length,0);
 for(const type of ['timestamp','datetime','time','date'])for(const precision of [0,'0',null]){const row=structureRows({...metadata,columns:[{...column,DATA_TYPE:type,CHARACTER_MAXIMUM_LENGTH:null,DATETIME_PRECISION:precision}]})[0];assert.equal(row.LENGTH_PRECISION,'');}
 assert.equal(structureRows({...metadata,columns:[{...column,DATA_TYPE:'timestamp',DATETIME_PRECISION:'6'}]})[0].LENGTH_PRECISION,'6');
});
test('MySQL column edits preserve native attributes and bind user values instead of interpolating them',()=>{
 const result=build({name:'renamed',length:'120',comment:"新しい ' comment",defaultMode:'literal',defaultValue:"x';DROP TABLE t;--"});
 assert.match(result.sql,/CHANGE COLUMN `label` `renamed` VARCHAR\(120\)/);assert.match(result.sql,/CHARACTER SET utf8mb4 COLLATE utf8mb4_bin/);assert.match(result.sql,/DEFAULT :columnDefault COMMENT :columnComment INVISIBLE/);assert.equal(result.binds.columnDefault,"x';DROP TABLE t;--");assert.equal(result.binds.columnComment,"新しい ' comment");assert.ok(!result.sql.includes('DROP'));
 assert.throws(()=>build({}),/No column changes/);assert.throws(()=>build({length:'0'}),/range/);assert.throws(()=>build({defaultMode:'expression',defaultValue:'1); DROP TABLE t;--'}));
});
test('MySQL column edits keep generated expressions, temporal updates, binary defaults and AUTO_INCREMENT',()=>{
 for(const [col,sql] of [
 [{...column,COLUMN_NAME:'id',DATA_TYPE:'bigint',COLUMN_TYPE:'bigint unsigned',PK_POSITION:1,IS_NULLABLE:'NO',EXTRA:'auto_increment'},'`id` bigint unsigned NOT NULL AUTO_INCREMENT'],
 [{...column,DATA_TYPE:'timestamp',COLUMN_TYPE:'timestamp(6)',COLUMN_DEFAULT:'CURRENT_TIMESTAMP(6)'},'`label` timestamp(6) NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)'],
 [{...column,DATA_TYPE:'int',COLUMN_TYPE:'int',EXTRA:'STORED GENERATED',GENERATION_EXPRESSION:'(`id` + 1)'},'`label` int GENERATED ALWAYS AS ((`id` + 1)) STORED'],
 [{...column,DATA_TYPE:'bit',COLUMN_TYPE:'bit(1)'},"`label` bit(1) DEFAULT b'0'"]]){
 const m={...metadata,columns:[col]},source='CREATE TABLE `t` ('+sql+') ENGINE=InnoDB';const result=build({comment:'updated'},source,m);assert.ok(result.sql.endsWith(sql+' COMMENT :columnComment'));if(col.PK_POSITION)assert.throws(()=>build({nullable:true},source,m),/Primary key/);
 if(col.GENERATION_EXPRESSION)assert.throws(()=>build({defaultMode:'literal',defaultValue:'1'},source,m),/Generated/);
 if(col.DATA_TYPE==='bit')assert.ok(!build({defaultMode:'none'},source,m).sql.includes("b'0'"));
 }
});
test('MySQL column type changes validate DECIMAL, enum members, null defaults and name collisions',()=>{
 assert.match(build({type:'DECIMAL',length:'12',scale:'3'}).sql,/DECIMAL\(12,3\)/);assert.ok(!build({type:'INT',length:''}).sql.includes('COLLATE'));assert.throws(()=>build({type:'DECIMAL',length:'2',scale:'3'}),/Scale/);
 assert.match(build({type:'ENUM',members:"'a','b'"}).sql,/ENUM\('a','b'\)/);assert.throws(()=>build({type:'ENUM',members:"'a', SLEEP(9)"}));assert.throws(()=>build({nullable:false,defaultMode:'null'}),/nullable/);
 assert.throws(()=>build({name:'existing'},native,{...metadata,columns:[column,{...column,COLUMN_NAME:'existing'}]}),/already exists/);assert.match(build({defaultMode:'expression',defaultValue:'CURRENT_TIMESTAMP(6)'}).sql,/DEFAULT \(CURRENT_TIMESTAMP \( 6 \)\)/);
});
test('MySQL structure categories start collapsed and the column edit action opens the full editor',()=>{
 const f=componentHarness('src/features/mysql/table/TableMetadataTab.tsx',{mode:'structure',controller:{metadata},props:{schema:'demo',table:'t',active:true}}, {dependencies:{'../VerticalSplit':'Split','./TableDdlDialog':'DDL','./ColumnEditorDialog':'Editor','@/components/data/ExportDialog':'Export','@/features/data-grid/GridViewport':{GridViewport:'Viewport'},'@mui/x-data-grid':{DataGrid:'Grid',enUS:require('@mui/x-data-grid').enUS,jaJP:require('@mui/x-data-grid').jaJP}}});
 for(const kind of ['checks','triggers']){const button=f.node('Button',n=>n.props['data-testid']==='mysql-structure-'+kind);assert.equal(button.props['aria-expanded'],false);button.props.onClick();f.render();assert.equal(f.node('Button',n=>n.props['data-testid']==='mysql-structure-'+kind).props['aria-expanded'],true);}
 const grid=f.node('Grid',n=>!n.props.autoHeight),fields=grid.props.columns.map(c=>c.field);assert.ok(fields.includes('UK_DATA'));assert.ok(fields.includes('LENGTH_PRECISION'));assert.ok(!fields.includes('EXTRA'));assert.ok(!fields.includes('GENERATION_EXPRESSION'));
 const cell=grid.props.columns.find(c=>c.field==='__actions').renderCell({row:column});cell.children[0].children[0].children[0].props.onClick();f.render();assert.equal(f.node('Editor').props.columnName,'label');assert.ok(!f.text().includes('mysql_table_structure_help'));assert.ok(!f.text().includes('mysql_auto_increment_observed_help'));assert.equal(grid.props.rows[0].PK_DISPLAY,'');f.unmount();
});
function dialogFixture({stale=false,denied=false,readonly=false}={}){
 let reads=0,writes=0,closes=0;const t=key=>key;
 const repo={backgroundRows:async()=>{reads++;if(denied)throw new Error('metadata denied');return [{'Create Table':stale&&reads>1?native.replace('varchar(80)','varchar(90)'):native}];},loadTableMetadata:async()=>metadata};
 const f=componentHarness('src/features/mysql/table/ColumnEditorDialog.tsx',{schema:'demo',table:'t',columnName:'label',metadata,busy:false,readonly,failureMessage:'',onExecute:async()=>{writes++;return true;},onClose:()=>closes++},{dependencies:{'./tableRepository':repo,'react-i18next':{useTranslation:()=>({t})}},globals:{Error}});
 return {f,get reads(){return reads;},get writes(){return writes;},get closes(){return closes;}};
}
test('MySQL column dialog loads the native definition, invalidates previews and requires the exact table name',async()=>{
 const run=dialogFixture(),f=run.f;await f.flush();assert.equal(run.reads,1);
 f.node('TextField',n=>n.props.label==='length').props.onChange({target:{value:'120'}});f.render();await f.click('preview');assert.equal(f.button('execute').props.disabled,true);
 f.node('TextField',n=>n.props.label==='comment').props.onChange({target:{value:'changed'}});f.render();assert.equal(f.node('TextField',n=>n.props.label==='mysql_table_confirm_name'),undefined);await f.click('preview');f.node('TextField',n=>n.props.label==='mysql_table_confirm_name').props.onChange({target:{value:'wrong'}});f.render();assert.equal(f.button('execute').props.disabled,true);
 f.node('TextField',n=>n.props.label==='mysql_table_confirm_name').props.onChange({target:{value:'t'}});f.render();await f.click('execute');await f.flush();assert.equal(run.writes,1);assert.equal(run.closes,1);assert.equal(f.button('execute').props.disabled,true);f.unmount();
});
test('MySQL column dialog refuses stale definitions, read-only edits and failed metadata reads without DDL',async()=>{
 for(const options of [{stale:true},{denied:true},{readonly:true}]){
 const run=dialogFixture(options),f=run.f;await f.flush();
 if(options.stale){f.node('TextField',n=>n.props.label==='comment').props.onChange({target:{value:'changed'}});f.render();await f.click('preview');f.node('TextField',n=>n.props.label==='mysql_table_confirm_name').props.onChange({target:{value:'t'}});f.render();await f.click('execute');await f.flush();assert.ok(f.text().includes('mysql_column_changed'));assert.equal(f.button('execute').props.disabled,true);}
 if(options.denied){assert.ok(f.text().includes('metadata denied'));assert.equal(f.button('preview').props.disabled,true);assert.ok(f.button('retry'));}
 if(options.readonly)assert.equal(f.node('TextField',n=>n.props.label==='column_name').props.disabled,true);
 assert.equal(run.writes,0);f.unmount();
 }
});
