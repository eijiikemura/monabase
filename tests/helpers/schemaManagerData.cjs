// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {loadTypeScript}=require('./loadTypeScript.cjs');
const {createHookHarness}=require('./renderHook.cjs');
const schemaService=require('../../electron/postgres/schemaManagement');
const privilegeService=require('../../electron/postgres/objectPrivileges');
async function createSchemaManagerHarness(invoke){
  const hook=createHookHarness({doubleUpdates:true}),events=[];
  const {useSchemaManagerTab}=loadTypeScript('src/features/postgresql/windows/dba/useSchemaManagerTab.ts',{react:hook.react,'@/shared/api/desktop':{ipcRenderer:{invoke}}},{window:{dispatchEvent:event=>{events.push(event);return true;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}});
  let active=true,state;const render=()=>state=hook.render(()=>useSchemaManagerTab(active));
  async function flush(){for(let i=0;i<4;i++){render();hook.commit();await hook.settle();}return render();}
  async function waitFor(predicate){const deadline=Date.now()+10000;do{await flush();if(predicate(state))return state;await new Promise(resolve=>setTimeout(resolve,10));}while(Date.now()<deadline);throw Error('Schema manager timed out: '+state.error+' '+state.detailError+' '+state.errorCode);}
  await flush();return{get state(){return state;},flush,waitFor,events,updateActive:value=>{active=value;},unmount:()=>hook.unmount()};
}
function schemaFixture(){
 const f={calls:[],requests:[],options:{readonly:false,connectionId:'schema-scope'},failList:false,failDetail:false,noEffect:false,objects:[],dependencies:[],dependencyTotal:null,
 roles:[{id:'10',name:'test',login:true,superuser:false,usable:true,settable:true},{id:'20',name:'other_owner',login:false,superuser:false,usable:false,settable:true},{id:'30',name:'reader',login:false,superuser:false,usable:false,settable:false}],
 schemas:[{oid:'50',name:'Te\'st"',owner_id:'10',owner:'test',revision:'1',acl:'test',extension_owned:false},{oid:'51',name:'pgx',owner_id:'10',owner:'test',revision:'1',acl:'test',extension_owned:false},{oid:'52',name:'toast',owner_id:'10',owner:'test',revision:'1',acl:'test',extension_owned:false},{oid:'53',name:'public',owner_id:'10',owner:'test',revision:'1',acl:'test',extension_owned:false},{oid:'54',name:'pg_catalog',owner_id:'10',owner:'test',revision:'1',acl:'test',extension_owned:false}],acl:[]};
 const q=value=>'"'+value.replaceAll('"','""')+'"';
 const grants=row=>f.acl.length?f.acl:[{grantee_id:row.owner_id,grantor_id:row.owner_id,privilege:'USAGE',grantable:false},{grantee_id:row.owner_id,grantor_id:row.owner_id,privilege:'CREATE',grantable:false}];
 f.query=async(sql,binds=[])=>{
  f.calls.push([sql,binds]);
  if(sql===privilegeService.CONTEXT_SQL)return{rows:[{database:'demo',database_id:'5',username:'test',user_id:'10',version:160000}]};
  if(sql===schemaService.DATABASE_SQL)return{rows:[{can_create:true,max_length:63}]};
  if(sql===schemaService.OWNER_SQL)return{rows:f.roles.map(role=>({id:role.id,database_create:role.id!=='30'}))};
  if(sql===schemaService.OWNER_CANDIDATES_SQL)return{rows:[{id:'10'},{id:'20'}]};
  if(sql===schemaService.SCHEMAS_SQL){if(f.failList)throw Error('List unavailable');return{rows:f.schemas.map(row=>({...row}))};}
  if(sql.startsWith('SELECT oid::text AS id'))return{rows:f.roles.map(role=>({...role}))};
  if(sql.includes(' AS sql_name,')){
   if(f.failDetail)throw Error('Detail unavailable');
   const rows=sql.includes('LIMIT 101')?f.schemas.filter(row=>row.name===binds[0]):f.schemas.filter(row=>row.oid===binds[0]);
   return{rows:rows.map(row=>({oid:row.oid,schema:row.name,name:row.name,owner_id:row.owner_id,revision:row.revision,args:'',sql_name:q(row.name),default_acl:false,acl_type:'n',namespace_id:row.oid,protected:row.name.startsWith('pg_')||row.name==='information_schema'||row.extension_owned}))};
  }
  if(sql.startsWith('SELECT x.grantee::text'))return{rows:grants(f.schemas.find(row=>row.oid===binds[0])).map(row=>({...row}))};
  if(sql.startsWith('SELECT DISTINCT privilege_type'))return{rows:[{privilege:'CREATE'},{privilege:'USAGE'}]};
  if(sql.startsWith('SELECT r.oid::text AS principal_id'))return{rows:f.roles.flatMap(role=>binds[1].map(privilege=>({principal_id:role.id,privilege,effective:grants(f.schemas.find(row=>row.oid===binds[0])).some(g=>[role.id,'0'].includes(g.grantee_id)&&g.privilege===privilege),column_effective:false,schema_usage:true,sources:grants(f.schemas.find(row=>row.oid===binds[0])).filter(g=>[role.id,'0'].includes(g.grantee_id)&&g.privilege===privilege).map(g=>g.grantee_id)})))};
  if(sql===schemaService.OBJECTS_SQL)return{rows:f.objects.map(row=>({...row,total:String(f.objects.length)}))};
  if(sql===schemaService.DEPENDENCIES_SQL){const root={class_id:'2615',object_id:binds[0],sub_id:0,type:'schema',schema:null,name:f.schemas.find(row=>row.oid===binds[0]).name,identity:'test'};const rows=[root,...f.dependencies];return{rows:rows.map(row=>({...row,total:String(f.dependencyTotal??rows.length)}))};}
  if(sql.startsWith('SET LOCAL ROLE'))return{};
  if(/^(CREATE|ALTER|DROP) SCHEMA/.test(sql)){
   if(f.noEffect)return{};const names=[...sql.matchAll(/"((?:[^"]|"")*)"/g)].map(match=>match[1].replaceAll('""','"'));
   if(sql.startsWith('CREATE')){const role=f.roles.find(role=>role.name===names[1]);f.schemas.push({oid:'90',name:names[0],owner_id:role.id,owner:role.name,revision:'1',acl:null,extension_owned:false});}
   else{const row=f.schemas.find(row=>row.name===names[0]);if(sql.includes(' RENAME TO '))row.name=names[1];else if(sql.includes(' OWNER TO ')){const role=f.roles.find(role=>role.name===names[1]);row.owner_id=role.id;row.owner=role.name;}else f.schemas=f.schemas.filter(entry=>entry!==row);row.revision=String(Number(row.revision)+1);}return{};
  }
  if(/^(GRANT|REVOKE) /.test(sql)){const row=f.schemas[0],current=grants(row);f.acl=sql.startsWith('GRANT')?[...current,{grantee_id:'30',grantor_id:'10',privilege:'USAGE',grantable:false}]:current.filter(grant=>!(grant.grantee_id==='30'&&grant.privilege==='USAGE'));row.revision=String(Number(row.revision)+1);return{};}
  throw Error('Unexpected schema query: '+sql);
 };
 f.manager=schemaService.createSchemaManager();f.privilegeManager=privilegeService.createPrivilegeManager();
 f.target=async()=>{const row=(await f.manager.list(f.query,f.options)).schemas[0];return{oid:row.oid,identity:row.identity,name:row.name};};
 f.request=async(action='rename',extra={})=>{const target=await f.target(),detail=await f.manager.detail(f.query,target,f.options);return{action,target,expected:detail.fingerprint,newName:'Renamed',ownerId:'20',cascade:false,...extra};};
 f.invoke=async(channel,input)=>{
  f.requests.push([channel,input]);try{
   if(channel==='list-postgres-schemas')return{success:true,...await f.manager.list(f.query,f.options)};
   if(channel==='get-postgres-schema-detail')return{success:true,detail:await f.manager.detail(f.query,input,f.options)};
   if(channel==='review-postgres-schema-operation')return{success:true,...await f.manager.review(f.query,input,f.options)};
   if(channel==='execute-postgres-schema-operation')return{success:true,...await f.manager.execute(f.query,input,f.options)};
   if(channel==='review-postgres-object-privilege')return{success:true,...await f.privilegeManager.review(f.query,input,f.options)};
   if(channel==='mutate-postgres-object-privilege')return{success:true,...await f.privilegeManager.mutate(f.query,input,f.options)};
   throw Error('Unexpected channel');
  }catch(error){return{success:false,...schemaService.safeError(error)};}
 };
 return f;
}
module.exports={createSchemaManagerHarness,schemaFixture};
