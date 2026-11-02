// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {loadTypeScript}=require('./loadTypeScript.cjs');
const {createHookHarness}=require('./renderHook.cjs');
const service=require('../../electron/postgres/tablespaceManagement');
const privileges=require('../../electron/postgres/objectPrivileges');
async function createPostgresTablespaceHarness(invoke){
 const hook=createHookHarness({doubleUpdates:true});
 const {useTablespaceTab}=loadTypeScript('src/features/postgresql/windows/dba/useTablespaceTab.ts',{react:hook.react,'@/shared/api/desktop':{ipcRenderer:{invoke}}});
 let active=true,state;const render=()=>state=hook.render(()=>useTablespaceTab(active));
 async function flush(){for(let i=0;i<4;i++){render();hook.commit();await hook.settle();}return render();}
 async function waitFor(predicate){const deadline=Date.now()+10000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);throw Error('Tablespace hook timeout: '+state.error+' '+state.detailError);}
 await flush();return{get state(){return state;},flush,waitFor,updateActive:value=>{active=value;},unmount:()=>hook.unmount()};
}
function postgresTablespaceFixture(){
 const f={calls:[],requests:[],options:{readonly:false,connectionId:'ts-scope'},manager:service.createTablespaceManager(),failList:false,failDetail:false,failWrite:null,noEffect:false,failAfter:false,deniedSize:false,deniedDatabases:false,databases:[],objects:[],bytes:'900719925474099312345',
 roles:[{id:'10',name:'test',login:true,superuser:true,usable:true,settable:true},{id:'20',name:'other"owner',login:false,superuser:false,usable:false,settable:true}],
 tablespaces:[{oid:'50',name:'Custom\'"',owner_id:'10',owner:'test',location:'/srv/test',revision:'1',acl:null,options:[]},{oid:'1663',name:'pg_default',owner_id:'10',owner:'test',location:'',revision:'1',acl:null,options:[]},{oid:'1664',name:'pg_global',owner_id:'10',owner:'test',location:'',revision:'1',acl:null,options:[]}]};
 f.query=async(sql,binds=[])=>{
  f.calls.push([sql,binds]);
  if(sql===privileges.CONTEXT_SQL)return{rows:[{database:'demo',database_id:'5',username:'test',user_id:'10',version:160000}]};
  if(sql.includes('rolcanlogin AS login'))return{rows:f.roles.map(row=>({...row}))};
  if(sql===service.CONTEXT_SQL)return{rows:[{max_length:63,default_id:'1663'}]};
  if(sql===service.LIST_SQL){if(f.failList)throw Error('Private network detail');return{rows:f.tablespaces.map(row=>({...row}))};}
  if(sql===service.SIZE_SQL){if(f.failDetail)throw Error('Detail failed');if(f.deniedSize)throw Object.assign(Error('Denied'),{code:'42501'});return{rows:[{bytes:f.bytes}]};}
  if(sql===service.DATABASES_SQL){if(f.deniedDatabases)throw Object.assign(Error('Denied'),{code:'42501'});return{rows:f.databases};}
  if(sql===service.OBJECTS_SQL)return{rows:f.objects};
  if(/^(CREATE|ALTER|DROP) TABLESPACE/.test(sql)){
   if(f.failWrite)throw f.failWrite;
   if(!f.noEffect){
    if(sql.startsWith('CREATE'))f.tablespaces.push({oid:'51',name:f.newName || 'Created',owner_id:'10',owner:'test',location:'/srv/new',revision:'2',options:[]});
    else if(sql.startsWith('DROP'))f.tablespaces=f.tablespaces.filter(row=>row.oid!=='50');
    else if(sql.includes('RENAME TO'))f.tablespaces[0]={...f.tablespaces[0],name:f.newName || 'Renamed',revision:'2'};
    else f.tablespaces[0]={...f.tablespaces[0],owner_id:'20',owner:f.roles[1].name,revision:'2'};
   }
   if(f.failAfter)f.failList=true;return{rows:[]};
  }
  throw Error('Unexpected tablespace SQL');
 };
 f.invoke=async(channel,input)=>{f.requests.push([channel,input]);try{const method={'list-postgres-tablespaces':'list','get-postgres-tablespace-detail':'detail','review-postgres-tablespace-operation':'review','execute-postgres-tablespace-operation':'execute'}[channel];if(!method)throw Error('Unexpected channel');const result=await(method==='list'?f.manager.list(f.query,f.options):f.manager[method](f.query,input,f.options));return{success:true,...(method==='detail'?{detail:result}:result)};}catch(error){return{success:false,...service.safeError(error)};}};
 return f;
}
module.exports={createPostgresTablespaceHarness,postgresTablespaceFixture};
