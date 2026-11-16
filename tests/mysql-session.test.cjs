// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const {test}=require('node:test');const assert=require('node:assert/strict');const {loadModule}=require('./helpers/loadModule.cjs');const {createHookHarness}=require('./helpers/renderHook.cjs');const {loadTypeScript}=require('./helpers/loadTypeScript.cjs');const {componentHarness}=require('./helpers/componentHarness.cjs');
function fixture(){
 const data={full:true,ps:true,event:true,history:true,stats:true,status:'active',thread:90,eventId:2,sql:'SELECT SLEEP(30), 1',runs:[],fail:false,afterFail:false};
 const operator={user:'operator',host:'localhost'},victim={user:'worker',host:'%'},row=()=>({THREAD_ID:String(data.thread),PROCESSLIST_ID:'42',PROCESSLIST_USER:victim.user,PROCESSLIST_HOST:'host',PROCESSLIST_DB:'demo',PROCESSLIST_COMMAND:'Query',PROCESSLIST_TIME:'2',PROCESSLIST_STATE:'User sleep',PROCESSLIST_INFO:data.sql,TYPE:'FOREGROUND',NAME:'thread/sql/one_connection'});
 const service=loadModule('electron/mysql/sessionService.js',{'./userRoleService':{list:async()=>({success:true,snapshot:{accounts:[{...operator,protected:true},{...victim,protected:false}],context:{server:'fixture',scope:data.full?'all':'self',current:operator}}})}},{},{strict:false});
 const client={main:{threadId:1},background:{threadId:2},readonly:false,closing:false,connections:[{threadId:1},{threadId:2},{threadId:3}],getTransactionDetails:()=>({transactionStatus:data.status}),execute:async(sql)=>{
 if(data.afterFail&&data.runs.length)throw new Error('sentinel-secret');
 if(sql.includes('FROM performance_schema.threads')){if(!data.ps)throw new Error('ER_TABLEACCESS_DENIED_ERROR: denied');return {rows:data.ps==='empty'?[]:[row()]};}
 if(sql==='SHOW FULL PROCESSLIST')return {rows:[{Id:42,User:'worker',Host:'host',db:'demo',Command:'Query',Time:2,State:'sleep',Info:data.sql}]};
 if(sql.includes('events_statements_current'))return {rows:data.event?[{THREAD_ID:String(data.thread),EVENT_ID:String(data.eventId),TIMER_START:'100',END_EVENT_ID:null,SQL_TEXT:data.sql}]:[]};
 if(sql.includes('USER_PRIVILEGES'))return {rows:[{PRIVILEGE_TYPE:'SUPER'}]};if(sql.includes('mysql.global_grants'))return {rows:[]};
 if(sql.includes('status_by_thread')){if(!data.stats)throw new Error('ER_TABLEACCESS_DENIED_ERROR: denied');return {rows:[{VARIABLE_NAME:'Questions',VARIABLE_VALUE:'9007199254740993'}]};}
 if(sql.includes('events_statements_history')){if(!data.history)throw new Error('ER_TABLEACCESS_DENIED_ERROR: denied');return {rows:[{SQL_TEXT:"ALTER USER 'worker'@'%' IDENTIFIED BY 'sentinel-secret'"}]};}
 throw new Error('Unexpected session read');
 }};
 client.control={threadId:3,promise:()=>({query:async({sql})=>{data.runs.push(sql);if(data.fail)throw new Error('sentinel-secret');if(data.denied){const error=new Error('sentinel-secret');error.code='ER_KILL_DENIED_ERROR';throw error;}data.eventId++;return [[]];}})};
 const list=async()=>{const r=await service.list(client);assert.equal(r.success,true,r.error);return r.snapshot;};
 const prepare=async(action='cancel')=>{const row=(await list()).sessions[0];return service.review(client,{id:row.id,fingerprint:row.fingerprint,action,...(action==='cancel'?{execution:row.execution}:{})});};
 const execute=(r,extra={})=>service.execute(client,{token:r.token,confirm:'42',acknowledged:true,...extra});return {data,client,service,list,prepare,execute};
}
test('MySQL session snapshots identify current executions and protect app, internal and unverified accounts',async()=>{
 const f=fixture(),r=await f.list(),row=r.sessions[0];assert.equal(row.canCancel,true);assert.equal(f.data.runs.length,0);f.client.connections.push({threadId:42});assert.equal((await f.list()).sessions[0].protected,true);f.client.connections.pop();f.data.full=false;assert.equal((await f.list()).sessions[0].canKill,false);f.data.ps=false;const limited=await f.list();assert.equal(limited.context.source,'processlist');assert.equal(limited.sessions[0].execution,null);assert.equal(limited.sessions[0].canKill,false);f.data.ps='empty';assert.equal((await f.list()).context.source,'processlist');
});
test('MySQL session detail preserves exact counters, redacts authentication SQL and explicitly reports unavailable metrics',async()=>{
 const f=fixture(),row=(await f.list()).sessions[0],r=await f.service.get(f.client,{id:row.id,fingerprint:row.fingerprint});assert.equal(r.success,true,r.error);assert.equal(r.detail.statistics[0].VALUE,'9007199254740993');assert.ok(!JSON.stringify(r).includes('sentinel-secret'));assert.equal(r.detail.previousSqlText,'[Sensitive SQL hidden]');f.data.stats=false;f.data.history=false;const limited=await f.service.get(f.client,{id:row.id,fingerprint:row.fingerprint});assert.equal(limited.detail.statisticsAvailable,false);assert.equal(limited.detail.historyAvailable,false);
});
test('MySQL session control sends only reviewed numeric KILL on the control connection and never touches the main transaction',async()=>{
 const f=fixture(),r=await f.prepare();assert.equal(r.success,true,r.error);assert.equal(f.data.runs.length,0);const result=await f.execute(r.review);assert.equal(result.success,true);assert.equal(result.status,'observed');assert.deepEqual(f.data.runs,['KILL QUERY 42']);assert.equal(f.data.status,'active');assert.equal((await f.execute(r.review)).success,false);assert.equal(f.data.runs.length,1);
});
test('MySQL session actions reject ID reuse, changed statements, expired/reconnected reviews, wrong confirmation and read-only mode',async()=>{
 for(const mode of ['reuse','statement','expired','connection','confirm','readonly','unknown']){const f=fixture(),r=await f.prepare();if(mode==='reuse')f.data.thread++;if(mode==='statement')f.data.eventId++;if(mode==='connection')f.client.control.threadId++;if(mode==='readonly')f.client.readonly=true;if(mode==='unknown')f.data.status='unknown';const original=Date.now;if(mode==='expired')Date.now=()=>original()+70000;try{assert.equal((await f.execute(r.review,mode==='confirm'?{confirm:'42; DROP USER root'}:{})).success,false,mode);assert.equal(f.data.runs.length,0,mode);}finally{Date.now=original;}}
});
test('MySQL session unknown and requested outcomes are not silently retried or reported as completion',async()=>{
 for(const mode of ['fail','afterFail']){const f=fixture(),r=await f.prepare();f.data[mode]=true;const result=await f.execute(r.review);assert.equal(result.status,mode==='fail'?'unknown':'requested');assert.ok(!JSON.stringify(result).includes('sentinel-secret'));await f.execute(r.review);assert.equal(f.data.runs.length,1);}
 const rejected=fixture(),review=await rejected.prepare();rejected.data.denied=true;const refusal=await rejected.execute(review.review);assert.equal(refusal.status,'failed');assert.equal(refusal.error,'mysql_session_failed');assert.ok(!JSON.stringify(refusal).includes('sentinel-secret'));
 const f=fixture();f.data.event=false;assert.equal((await f.list()).sessions[0].canCancel,false);assert.equal((await f.prepare('kill')).success,true);
});
function hookFixture(){const h=createHookHarness(),calls=[],props={active:true,busy:false,readonly:false,setBusy(){},onState(){throw new Error('Session reads must not overwrite transaction state');}},row={id:'42:90',connectionId:'42',threadId:'90',fingerprint:'f',execution:'e',user:'worker',host:'host',command:'Query',canKill:true,canCancel:true,protected:false};let state,fail=false,resolveRead;
 const snapshot={sessions:[row],context:{canManage:true},fetchedAt:'now'},setups=[],pending=[];const react={...h.react,useEffect(callback,dependencies){h.react.useEffect(()=>{setups.push(callback);return callback();},dependencies);}};
 const hook=loadTypeScript('src/features/mysql/dba/useSessionTab.ts',{react,'@/shared/api/desktop':{ipcRenderer:{invoke:async(channel,input)=>{calls.push([channel,input]);if(channel==='list-mysql-sessions'){if(fail)return {success:false,error:'mysql_session_read_failed'};if(resolveRead)return new Promise(resolve=>{resolveRead=resolve;pending.push(resolve);});return {success:true,snapshot};}if(channel==='get-mysql-session-detail')return {success:true,detail:{sessionId:row.id,fingerprint:'f',execution:'e',statistics:[]}};if(channel==='review-mysql-session')return {success:true,review:{token:'one',target:row,action:input.action,sql:'KILL QUERY 42'}};if(channel==='manage-mysql-session')return {success:false,error:'mysql_session_unknown',submitted:true,status:'unknown'};throw new Error('Unexpected session IPC');}}}},{Error,setInterval,clearInterval});
 const render=()=>state=h.render(()=>hook.useSessionTab(props));const flush=async()=>{for(let i=0;i<6;i++){render();h.commit();await h.settle();}render();};return {get state(){return state;},props,calls,row,flush,unmount:h.unmount,replay:()=>{h.unmount();for(const setup of setups.slice())setup();},resolveAll:()=>{for(const resolve of pending)resolve({success:true,snapshot});},setFail:()=>fail=true,delay:()=>resolveRead=true,resolve:r=>resolveRead(r)};
}
test('MySQL session UI confirms exact IDs, requires current detail for cancel, and disables retries after unknown results',async()=>{
 const f=hookFixture();await f.flush();f.state.select(f.row.id);await f.flush();assert.equal(f.state.canCancel,true);await f.state.command('cancel');await f.flush();assert.equal(f.state.canExecute,false);f.state.setConfirm('42');f.state.setAcknowledged(true);await f.flush();assert.equal(f.state.canExecute,true);await f.state.execute();await f.flush();assert.equal(f.state.ready,false);assert.equal(f.state.error,'mysql_session_unknown');assert.equal(f.state.canKill,false);await f.state.execute();assert.equal(f.calls.filter(c=>c[0]==='manage-mysql-session').length,1);f.unmount();
});
test('MySQL session UI clears inactive reviews, rejects hidden selection, and keeps failed refreshes unconfirmed',async()=>{
 const f=hookFixture();await f.flush();f.state.select(f.row.id);await f.flush();f.state.setSearch('not present');await f.flush();assert.equal(f.state.canKill,false);f.state.setSearch('');await f.flush();await f.state.command('kill');await f.flush();assert.ok(f.state.review);f.props.active=false;await f.flush();assert.equal(f.state.review,undefined);f.props.active=true;f.setFail();await f.flush();assert.equal(f.state.ready,false);assert.equal(f.state.canCancel,false);f.unmount();
});
test('MySQL session component uses the Oracle split and protects unavailable actions',()=>{
 const state={rows:[],selectedId:'',pagination:{page:0,pageSize:25},search:'',filter:'all',refreshSeconds:0,canCancel:false,canKill:false},split={ratio:.55};
 const f=componentHarness('src/features/mysql/dba/SessionTab.tsx',{active:true,busy:false,readonly:false},{dependencies:{'./useSessionTab':{useSessionTab:()=>state},'@/features/dba/hooks/useDbaSplit':{useDbaSplit:()=>split},'@/features/data-grid/GridViewport':{GridViewport:'Viewport'},'@/components/data/ExportDialog':'Export','@mui/x-data-grid':{DataGrid:'Grid',enUS:require('@mui/x-data-grid').enUS,jaJP:require('@mui/x-data-grid').jaJP}}});assert.equal(f.button('cancel_sql').props.disabled,true);assert.equal(f.button('kill_session').props.disabled,true);assert.equal(f.nodes().find(n=>n.props.role==='separator').props['aria-orientation'],'horizontal');f.unmount();
});

test('MySQL session UI ignores list responses received after hiding the tab',async()=>{
 const f=hookFixture();await f.flush();f.delay();const pending=f.state.reload();await f.flush();f.props.active=false;await f.flush();f.resolve({success:true,snapshot:{sessions:[{...f.row,user:'late-response'}],context:{canManage:true}}});await pending;await f.flush();assert.equal(f.state.ready,false);assert.ok(!f.state.snapshot.sessions.some(row=>row.user==='late-response'));f.unmount();
});

test('MySQL session UI releases read guards when React replays effect setup and cleanup',async()=>{
 const f=hookFixture();f.delay();await f.flush();assert.equal(f.state.loading,true);f.replay();await f.flush();assert.equal(f.calls.filter(c=>c[0]==='list-mysql-sessions').length,2);f.resolveAll();await f.flush();assert.equal(f.state.ready,true);assert.equal(f.state.loading,false);f.unmount();
});
