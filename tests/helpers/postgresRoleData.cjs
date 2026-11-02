// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {loadTypeScript}=require('./loadTypeScript.cjs');
const {createHookHarness}=require('./renderHook.cjs');
const service=require('../../electron/postgres/roleManagement');
const privileges=require('../../electron/postgres/objectPrivileges');
async function createPostgresRoleHarness(invoke){
 const hook=createHookHarness({doubleUpdates:true});
 const {useUserRoleTab}=loadTypeScript('src/features/postgresql/windows/dba/useUserRoleTab.ts',{react:hook.react,'@/shared/api/desktop':{ipcRenderer:{invoke}}});
 let active=true,state;const render=()=>state=hook.render(()=>useUserRoleTab(active));
 async function flush(){for(let i=0;i<4;i++){render();hook.commit();await hook.settle();}return render();}
 async function waitFor(predicate){const deadline=Date.now()+10000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);throw Error('Role hook timeout: '+state.error+' '+state.detailError);}
 await flush();return{get state(){return state;},flush,waitFor,updateActive:value=>{active=value;},unmount:()=>hook.unmount()};
}
function roleRow(oid,name,extra={}){return{oid,name,login:false,superuser:false,create_database:false,create_role:false,inherit:true,replication:false,bypass_rls:false,connection_limit:-1,valid_until:null,settings:[],actor_admin:false,actor_usable:false,...extra};}
function postgresRoleFixture(){
 const f={calls:[],requests:[],options:{readonly:false,connectionId:'role-scope'},manager:service.createRoleManager(),version:160000,failList:false,failDetail:false,writeError:null,noEffect:false,dependencies:[],
 roles:[roleRow('10','bootstrap',{superuser:true}),roleRow('100','TestAdmin',{login:true,superuser:true,create_role:true,actor_admin:true,actor_usable:true}),roleRow('200','AppUser\'"',{login:true}),roleRow('300','Readers\'"'),roleRow('400','Inherited'),roleRow('500','pg_monitor'),roleRow('600','pgx')],
 memberships:[{roleId:'300',memberId:'200',grantorId:'10',admin:false,inherit:true,set:true},{roleId:'400',memberId:'300',grantorId:'10',admin:false,inherit:false,set:true}]};
 f.query=async(sql,binds=[])=>{
  f.calls.push([sql,binds]);
  if(sql===privileges.CONTEXT_SQL)return{rows:[{database:'demo',database_id:'5',username:'TestAdmin',user_id:'100',version:f.version}]};
  if(sql!==service.ROLES_SQL && sql.includes('rolcanlogin AS login'))return{rows:f.roles.map(row=>({id:row.oid,name:row.name,login:row.login,superuser:row.superuser,usable:row.actor_usable,settable:row.actor_usable}))};
  if(sql===service.SETTINGS_SQL)return{rows:[{max_length:63,session_id:'100'}]};
  if(sql===service.ROLES_SQL){if(f.failList)throw Error('Private role metadata error');return{rows:f.roles.map(row=>({...row}))};}
  if(sql===service.membershipSql(f.version))return{rows:f.memberships.map(row=>({role_id:row.roleId,member_id:row.memberId,grantor_id:row.grantorId,admin:row.admin,inherit:f.version>=160000?row.inherit:null,set:f.version>=160000?row.set:null}))};
  if(sql===service.DEPENDENCIES_SQL){if(f.failDetail)throw Error('Private detail error');return{rows:f.dependencies};}
  if(sql.includes('AS settable FROM pg_catalog.pg_roles')){const reachable=service.reachable(f.memberships,binds[0]);return{rows:f.roles.filter(row=>row.oid!==binds[0]).map(row=>({oid:row.oid,member:reachable.has(row.oid),usable:reachable.has(row.oid),settable:reachable.has(row.oid)}))};}
  if(/^(CREATE|ALTER|DROP) ROLE|^(GRANT|REVOKE) /.test(sql)){
   if(f.writeError)throw f.writeError;
   const input=f.pending;
   if(!f.noEffect){
    if(input.action==='create')f.roles.push(roleRow('700',input.newName,{login:input.login}));
    if(input.action==='drop')f.roles=f.roles.filter(row=>row.oid!==input.target.oid);
    if(['login','superuser'].includes(input.action))f.roles.find(row=>row.oid===input.target.oid)[input.action]=input.enabled;
    if(input.action==='grant'){
     let grant=f.memberships.find(row=>row.roleId===input.roleId && row.memberId===input.target.oid && (f.version<160000 || row.grantorId===input.grantorId));
     if(!grant){grant={roleId:input.roleId,memberId:input.target.oid,grantorId:input.grantorId};f.memberships.push(grant);}Object.assign(grant,{admin:input.admin,inherit:input.inherit ?? null,set:input.set ?? null});
    }
    if(input.action==='revoke')f.memberships=f.memberships.filter(row=>{if(row.roleId!==input.roleId || row.memberId!==input.target.oid || row.grantorId!==input.grantorId)return true;if(input.revokeOption==='membership' || !input.revokeOption)return false;row[input.revokeOption]=false;return true;});
   }
   return{rows:[]};
  }
  throw Error('Unexpected role query');
 };
 f.execute=async input=>{f.pending=input;return f.manager.execute(f.query,input,f.options);};
 f.invoke=async(channel,input)=>{f.requests.push([channel,input]);try{const method={'list-postgres-roles':'list','get-postgres-role-detail':'detail','review-postgres-role-operation':'review','execute-postgres-role-operation':'execute'}[channel];if(!method)throw Error('Unexpected channel');const result=await(method==='list'?f.manager.list(f.query,f.options):method==='execute'?f.execute(input):f.manager[method](f.query,input,f.options));return{success:true,...(method==='detail'?{detail:result}:result)};}catch(error){return{success:false,...service.safeError(error)};}};
 return f;
}
module.exports={createPostgresRoleHarness,postgresRoleFixture,roleRow};
