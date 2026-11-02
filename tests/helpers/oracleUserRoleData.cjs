// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {loadTypeScript}=require('./loadTypeScript.cjs');
const {createHookHarness}=require('./renderHook.cjs');
const service=require('../../electron/oracle/userRoleManagement');
async function createOracleUserRoleHarness(invoke){
 const hook=createHookHarness({doubleUpdates:true});const {useUserRoleTab}=loadTypeScript('src/features/oracle/windows/dba/useUserRoleTab.ts',{react:hook.react,'@/shared/api/desktop':{ipcRenderer:{invoke}}});
 let active=true,state;const render=()=>state=hook.render(()=>useUserRoleTab(active));
 async function flush(){for(let i=0;i<4;i++){render();hook.commit();await hook.settle();}return render();}
 async function waitFor(predicate){const deadline=Date.now()+10000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);throw Error('Oracle user state timeout: '+state.error+' '+state.detailError);}
 await flush();return{get state(){return state;},flush,waitFor,updateActive:value=>{active=value;},unmount:()=>hook.unmount()};
}
function oracleUserRoleFixture(){
 const f={calls:[],requests:[],manager:service.createUserRoleManager(),options:{readonly:false,connectionId:'oracle-users',serverVersion:'23.0.0.0.0'},visible:false,failList:false,failDetail:false,failWrite:null,failAfter:false,noEffect:false,container:'3',dependencies:[],
 users:[{NAME:'TEST',ID:'10',CREATED:'2026-01-01',ACCOUNT_STATUS:'OPEN',AUTHENTICATION_TYPE:'PASSWORD',COMMON:'NO',ORACLE_MAINTAINED:'N'},{NAME:"AppUser's",ID:'20',CREATED:'2026-01-02',ACCOUNT_STATUS:'EXPIRED',AUTHENTICATION_TYPE:'PASSWORD',COMMON:'NO',ORACLE_MAINTAINED:'N'},{NAME:'SYS',ID:'0',CREATED:'2026-01-01',ACCOUNT_STATUS:'OPEN',AUTHENTICATION_TYPE:'PASSWORD',COMMON:'YES',ORACLE_MAINTAINED:'Y'}],
 roles:[{NAME:"Readers's",ID:'30',AUTHENTICATION_TYPE:'NONE',COMMON:'NO',ORACLE_MAINTAINED:'N'},{NAME:'DBA',ID:'2',AUTHENTICATION_TYPE:'NONE',COMMON:'YES',ORACLE_MAINTAINED:'Y'}],
 grants:[{GRANTEE:"AppUser's",NAME:"Readers's",KIND:'ROLE',ADMIN_OPTION:'NO',DEFAULT_ROLE:'YES',COMMON:'NO',INHERITED:'NO'},{GRANTEE:"Readers's",NAME:'CREATE SESSION',KIND:'SYSTEM',ADMIN_OPTION:'NO',DEFAULT_ROLE:null,COMMON:'NO',INHERITED:'NO'},{GRANTEE:'PUBLIC',NAME:'CREATE TABLE',KIND:'SYSTEM',ADMIN_OPTION:'NO',DEFAULT_ROLE:null,COMMON:'NO',INHERITED:'NO'}],
 privileges:['CREATE USER','ALTER USER','DROP USER','CREATE ROLE','DROP ANY ROLE','GRANT ANY ROLE','GRANT ANY PRIVILEGE'],quotas:[{TABLESPACE_NAME:'USERS',USED_BYTES:'9007199254740993123',MAX_BYTES:'1048577'}]};
 f.query=async(sql,binds={})=>{
  f.calls.push([sql,binds]);if(sql===service.IDENTITY_SQL)return{rows:[{DB_NAME:'testdb',CON_ID:f.container,CON_NAME:'FREEPDB1',SESSION_USER:'TEST'}]};
  if(sql==='SELECT PRIVILEGE FROM SESSION_PRIVS')return{rows:f.privileges.map(PRIVILEGE=>({PRIVILEGE}))};
  if(sql===service.USERS_SQL){if(f.failList)throw Error('Disconnected');if(f.visible)throw Object.assign(Error('No dictionary'),{errorNum:942});return{rows:f.users.map(row=>({...row}))};}
  if(sql===service.VISIBLE_USERS_SQL)return{rows:f.users.map(row=>({...row,ACCOUNT_STATUS:null,AUTHENTICATION_TYPE:null}))};
  if(sql===service.rolesSql(f.options.serverVersion!=='12.1.0.2'))return{rows:f.roles.map(row=>({...row}))};
  if(sql===service.grantsSql(f.options.serverVersion!=='12.1.0.2'))return{rows:f.grants.map(row=>({...row}))};
  if(sql===service.MAP_SQL)return{rows:['CREATE SESSION','CREATE TABLE','UNLIMITED TABLESPACE'].map(NAME=>({NAME}))};
  if(sql===service.DEPENDENCIES_SQL){if(f.failDetail)throw Error('Detail failed');return{rows:f.dependencies};}
  if(sql===service.QUOTAS_SQL)return{rows:f.quotas.map(row=>({...row}))};
  if(/^(CREATE|ALTER|DROP|GRANT|REVOKE) /.test(sql)){
   if(f.failWrite)throw f.failWrite;const input=f.pending;
   if(!f.noEffect){
    if(input.action==='create'){const row={NAME:input.newName,ID:'40',AUTHENTICATION_TYPE:input.kind==='USER'?'PASSWORD':'NONE',COMMON:'NO',ORACLE_MAINTAINED:'N',ACCOUNT_STATUS:'OPEN',CREATED:'2026-02-01'};(input.kind==='USER'?f.users:f.roles).push(row);}
    if(input.action==='drop'){f.users=f.users.filter(row=>row.NAME!==input.target.name);f.roles=f.roles.filter(row=>row.NAME!==input.target.name);}
    if(input.action==='lock'){const row=f.users.find(row=>row.NAME===input.target.name);row.ACCOUNT_STATUS=input.locked?'EXPIRED & LOCKED':'EXPIRED';}
    if(input.action==='quota')f.quotas.find(row=>row.TABLESPACE_NAME===input.tablespace).MAX_BYTES=service.quotaBytes(input);
    if(input.action==='grant'){const old=f.grants.find(row=>row.GRANTEE===input.target.name && row.KIND===input.privilegeKind && row.NAME===input.privilege);if(old)old.ADMIN_OPTION=input.admin?'YES':'NO';else f.grants.push({GRANTEE:input.target.name,NAME:input.privilege,KIND:input.privilegeKind,ADMIN_OPTION:input.admin?'YES':'NO',DEFAULT_ROLE:input.privilegeKind==='ROLE'?'YES':null,COMMON:'NO',INHERITED:'NO'});}
    if(input.action==='revoke')f.grants=f.grants.filter(row=>!(row.GRANTEE===input.target.name && row.NAME===input.privilege && row.KIND===input.privilegeKind));
   }
   if(f.failAfter)f.failList=true;return{rows:[]};
  }
  throw Error('Unexpected Oracle user SQL');
 };
 f.execute=input=>{f.pending=input;return f.manager.execute(f.query,input,f.options);};
 f.invoke=async(channel,input)=>{f.requests.push([channel,input]);try{const method={'list-oracle-user-roles':'list','get-oracle-user-role-detail':'detail','review-oracle-user-role-operation':'review','execute-oracle-user-role-operation':'execute'}[channel];if(!method)throw Error('Unexpected channel');const result=await(method==='list'?f.manager.list(f.query,f.options):method==='execute'?f.execute(input):f.manager[method](f.query,input,f.options));return{success:true,...(method==='detail'?{detail:result}:result)};}catch(error){return{success:false,...service.safeError(error)};}};
 return f;
}
module.exports={createOracleUserRoleHarness,oracleUserRoleFixture};
