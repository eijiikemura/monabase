// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');
const {parseObjectIdentity,qualifiedObjectName,splitObjectName,escapeSqlString}=loadTypeScript('src/shared/utils/objectIdentity.ts');

test('Qualified identities retain dots, case, quotes, apostrophes, Unicode, and spaces inside identifiers',()=>{
 for(const identity of [{schema:'Mixed.Schema',objectName:'order.items'}, {schema:'s"x',objectName:"O'rders"},
   {schema:' 名前 ',objectName:' 表 '}, {schema:'public',objectName:'SalesView'}]) {
   const parsed=parseObjectIdentity(qualifiedObjectName(identity));
   assert.deepEqual(JSON.parse(JSON.stringify(parsed)),identity);
   assert.deepEqual(Array.from(splitObjectName(qualifiedObjectName(identity))),[identity.schema,identity.objectName]);
 }
 assert.equal(escapeSqlString("O'rders"),"O''rders");
});

test('Legacy references remain readable and database-link dots stay in the object name',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(parseObjectIdentity('public.orders'))),{schema:'public',objectName:'orders'});
 assert.deepEqual(JSON.parse(JSON.stringify(parseObjectIdentity('orders','public'))),{schema:'public',objectName:'orders'});
 assert.deepEqual(JSON.parse(JSON.stringify(parseObjectIdentity('APP.REMOTE.EXAMPLE.COM'))),{schema:'APP',objectName:'REMOTE.EXAMPLE.COM'});
 assert.throws(()=>parseObjectIdentity('"unfinished'),/Unterminated/);
});

function hookState() {
 const slots=[]; let cursor=0;
 return { reset(){cursor=0;}, react:{
  useState(initial){const index=cursor++;if(!(index in slots))slots[index]=typeof initial==='function'?initial():initial;
   return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
  useRef(initial){const index=cursor++;slots[index]??={current:initial};return slots[index];},
  useEffect(){},useLayoutEffect(){},useMemo:callback=>callback(),useCallback:callback=>callback
 }};
}

for(const db of ['oracle','postgresql']) {
 test(`${db}: Object tabs retain separate identities, deduplicate exact names, and distinguish case`,()=>{
  const state=hookState();
  const events=loadTypeScript('src/shared/hooks/useEventCallback.ts',{react:state.react});
  const workspaceTabs=loadTypeScript('src/shared/hooks/useWorkspaceTabs.ts',{react:state.react,'./useEventCallback':events});
  const module=loadTypeScript(`src/features/${db}/useApp${db==='oracle'?'Oracle':'Postgresql'}.ts`,{
   react:state.react,'./triggerIdentity': loadTypeScript('src/features/postgresql/triggerIdentity.ts'), 'react-i18next':{useTranslation:()=>({t:key=>key})},
   '@/shared/hooks/useEventCallback':events, '@/features/table/useTableOpening': { useTableOpening: () => open => open() },
   '@/shared/hooks/useWorkspaceTabs':workspaceTabs,
   '@/shared/utils/objectIdentity':{parseObjectIdentity,qualifiedObjectName},
   ...(db==='postgresql'?{'./routineIdentity':loadTypeScript('src/features/postgresql/routineIdentity.ts')}:{ }),
   '../ai/aiHistoryCleanup':{deleteAiHistoryForObject(){}},'../git/useGlobalGit':{useGlobalGit:()=>({})},
   '../ai/useAiSettings':{useAiSettings:()=>({})},'@/shared/api/desktop':{ipcRenderer:{invoke:async()=>({})}}
  },{window:{},alert(){}});
  const useApp=module[db==='oracle'?'useAppOracle':'useAppPostgresql'];
  const render=()=>{state.reset();return useApp({user:'APP'},{maxTabs:20},[]);};
  const identity={schema:'Mixed.Schema',objectName:'Order.Items'};
  render().handleAddTab('table',qualifiedObjectName(identity));
  render().handleAddTab('table',qualifiedObjectName(identity));
  render().handleAddTab('table',qualifiedObjectName({...identity,objectName:'order.items'}));
  const tabs=render().tabs.filter(tab=>tab.type==='table');
  assert.equal(tabs.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(tabs[0].objectIdentity)),identity);
  assert.ok(tabs[0].title.includes('Order.Items'));
  const routine = { schema: 'Mixed.Schema', objectName: 'Total(税別)', objectType: 'FUNCTION', signature: 'numeric, timestamp with time zone' };
  const routineKey = value => db === 'postgresql' ? loadTypeScript('src/features/postgresql/routineIdentity.ts').routineTabKey(value) : qualifiedObjectName(value);
  render().handleAddTab('stored', routineKey(routine), 'FUNCTION');
  const first = render().tabs.find(tab => tab.type === 'stored'); assert.equal(first.title, 'functionTotal(税別)');
  render().handleAddTab('stored', routineKey(routine), 'FUNCTION'); assert.equal(render().activeTabId, first.id);
  if(db==='postgresql') {
   render().handleAddTab('stored', routineKey({...routine,signature:'text'}), 'FUNCTION');
   const overloads=render().tabs.filter(tab=>tab.type==='stored'); assert.equal(overloads.length,2);
   assert.equal(overloads[0].title,overloads[1].title); assert.notEqual(overloads[0].fullObjectName,overloads[1].fullObjectName);
   const {workspaceTabDescription}=loadTypeScript('src/components/navigation/workspaceTabDescription.ts');
   assert.ok(workspaceTabDescription(overloads[0],key=>key).includes('(numeric, timestamp with time zone)'));
   render().handleAddTab('stored',routineKey(routine),'FUNCTION'); assert.equal(render().activeTabId,first.id);
  }
  render().handleAddTab('create-stored','Mixed.Schema','PROCEDURE'); const created=render().activeTabId;
  render().handleStoredCreated(created,{...routine,objectName:'NewRoutine',objectType:'PROCEDURE'});
  assert.equal(render().tabs.find(tab=>tab.id===created).title,'procedure NewRoutine');
  if(db==='oracle') {
   for(const kind of ['PACKAGE','PACKAGE BODY']) render().handleAddTab('package',qualifiedObjectName({schema:'Mixed.Schema',objectName:'Package(名前)'}),kind);
   const packages=render().tabs.filter(tab=>tab.type==='package'); assert.equal(packages.length,2);
   assert.deepEqual(Array.from(packages,tab=>tab.title),['package_spec Package(名前)','package_body Package(名前)']);
  }
 });
 test(`${db}: View source loading preserves mixed-case and dotted identifiers`,async()=>{
  const state=hookState(),requests=[];
  const identity={schema:'Mixed.Schema',objectName:"Sales.View's"};
  const ddl=`CREATE VIEW ${qualifiedObjectName(identity)} AS SELECT 1 AS value`;
  const invoke=async(...args)=>{requests.push(args);return {success:true,rows:db==='oracle'?[{DDL:ddl}]:[{definition:'SELECT 1 AS value'}]};};
  const sqlModule={sql:()=>({}),PostgreSQL:{language:{data:{of:()=>({})}}}};
  const helpers={...{parseObjectIdentity,qualifiedObjectName,splitObjectName,escapeSqlString},quoteIdentifier:value=>`"${value.replace(/"/g,'""')}"`};
  const events=loadTypeScript('src/shared/hooks/useEventCallback.ts',{react:state.react});
  const editableSource=loadTypeScript('src/features/objects/useEditableSource.ts',{react:state.react,'@/shared/hooks/useEventCallback':events});
  const module=loadTypeScript(`src/features/${db}/windows/view/useViewWindow.ts`,{
   react:state.react,'react-i18next':{useTranslation:()=>({t:key=>key})},'@codemirror/lint': { linter: () => [] }, '@codemirror/lang-sql':sqlModule,
   '@/features/objects/useEditableSource':editableSource,
   '@/shared/utils/objectIdentity':helpers,'@/shared/utils/errorUtils':{getErrorMessage:error=>error.message},
   '@/features/sql/hooks/useDbCompletions':{useDbCompletions:()=>({dbCompletions:[],dbSchema:{}})},
   '@/shared/api/desktop':{ipcRenderer:{invoke}},
   ...(db==='oracle'?{'../common/plsqlDialect':{plsqlDialect:{language:{data:{of:()=>({})}}},oracleBuiltinCompletions:[]},
    '../common/loadOracleDdl':loadTypeScript('src/features/oracle/windows/common/loadOracleDdl.ts')}:{})
  });
  const render=()=>{state.reset();return module.useViewWindow({tabId:1,isActive:true,fullViewName:qualifiedObjectName(identity)});};
  await render().loadSource();
  assert.equal(render().schema,identity.schema);
  assert.equal(render().viewName,identity.objectName);
  assert.ok(render().sourceText.includes(qualifiedObjectName(identity)));
  assert.equal(requests[0][0],'execute-sql-bg');
  if(db==='oracle') assert.deepEqual(JSON.parse(JSON.stringify(requests[0][2])),{ddlType:'VIEW',name:identity.objectName,owner:identity.schema});
  else {assert.ok(!requests[0][1].includes(identity.objectName));assert.deepEqual(JSON.parse(JSON.stringify(requests[0][2])),{schema:identity.schema,name:identity.objectName});}
 });
}
