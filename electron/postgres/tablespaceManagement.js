// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash, randomBytes } = require('node:crypto');
const privileges = require('./objectPrivileges');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const fail = key => { throw Error(`pg_ts_${key}`); };
const CONTEXT_SQL = `SELECT current_setting('max_identifier_length')::integer AS max_length,
 (SELECT dattablespace::text FROM pg_catalog.pg_database WHERE datname=current_database()) AS default_id`;
const LIST_SQL = `SELECT t.oid::text AS oid,t.spcname AS name,t.spcowner::text AS owner_id,
 pg_catalog.pg_get_userbyid(t.spcowner) AS owner,pg_catalog.pg_tablespace_location(t.oid) AS location,
 t.xmin::text AS revision,t.spcacl::text AS acl,t.spcoptions AS options FROM pg_catalog.pg_tablespace t ORDER BY t.spcname`;
const SIZE_SQL = 'SELECT pg_catalog.pg_tablespace_size($1::oid)::text AS bytes';
const DATABASES_SQL = `SELECT d.oid::text AS oid,d.datname AS name,d.dattablespace=$1::oid AS default_space,
 d.oid IN (SELECT pg_catalog.pg_tablespace_databases($1::oid)) AS has_files FROM pg_catalog.pg_database d
 WHERE d.dattablespace=$1::oid OR d.oid IN (SELECT pg_catalog.pg_tablespace_databases($1::oid)) ORDER BY d.oid`;
const OBJECTS_SQL = `SELECT c.oid::text AS oid,n.nspname AS schema,c.relname AS name,c.relkind AS kind,COUNT(*) OVER()::text AS total
 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE c.reltablespace=$1::oid OR (c.reltablespace=0 AND $1::oid=$2::oid AND c.relkind IN ('r','i','m','S','t'))
 ORDER BY n.nspname,c.relname,c.oid LIMIT 200`;
async function list(query, options = {}) {
  const people = await privileges.principals(query, options), settings = (await query(CONTEXT_SQL)).rows[0];
  const actor = people.principals.find(role => role.id === people.context.userId);
  if (!actor || !Number.isSafeInteger(settings?.max_length) || !settings.default_id) fail('metadata_unknown');
  const context = { ...people.context, maxIdentifierLength: settings.max_length, defaultId: settings.default_id, canCreate: !options.readonly && actor.superuser === true, scope: 'cluster' };
  const tablespaces = (await query(LIST_SQL)).rows.map(row => {
    const owner = people.principals.find(role => role.id === row.owner_id), protectedTarget = row.name.startsWith('pg_') || !owner;
    const canAct = !context.readonly && !protectedTarget && (actor.superuser === true || owner?.usable === true);
    const identity = hash([options.connectionId,context.databaseId,row.oid]);
    return { oid:row.oid,identity,name:row.name,ownerId:row.owner_id,owner:row.owner,location:row.location,
      locationKind:row.name==='pg_default'?'default':row.name==='pg_global'?'global':'custom',options:row.options || [],protected:protectedTarget,
      canRename:canAct,canDrop:canAct,canChangeOwner:canAct,
      fingerprint:hash([identity,row,people.principals,context]) };
  });
  return { tablespaces,principals:people.principals.filter(role=>role.id!=='0'),context,fetchedAt:new Date().toISOString() };
}
function find(snapshot,input) {
  if (!input || typeof input.oid!=='string' || typeof input.identity!=='string' || typeof input.name!=='string') fail('invalid_target');
  const row=snapshot.tablespaces.find(row=>row.oid===input.oid && row.identity===input.identity && row.name===input.name);
  if (!row) fail('target_changed'); return row;
}
async function optional(query,sql,binds) {
  try { return { rows:(await query(sql,binds)).rows,error:'' }; }
  catch(error) { if(error.code==='42501')return{rows:[],error:'pg_ts_permission'};throw error; }
}
async function detail(query,input,options) {
  const snapshot=await list(query,options),tablespace=find(snapshot,input);
  const size=await optional(query,SIZE_SQL,[tablespace.oid]);
  const databases=await optional(query,DATABASES_SQL,[tablespace.oid]);
  const objects=(await query(OBJECTS_SQL,[tablespace.oid,snapshot.context.defaultId])).rows;
  const total=Number(objects[0]?.total || 0);if(!Number.isSafeInteger(total))fail('metadata_unknown');
  return { tablespace,bytes:size.rows[0]?.bytes ?? null,sizeError:size.error,databases:databases.rows,databasesError:databases.error,
    objects,objectCount:total,objectsTruncated:total>objects.length,ownerCandidates:snapshot.principals.filter(role=>role.settable).map(role=>role.id),
    fingerprint:hash([tablespace.fingerprint,databases.rows,databases.error,objects,total]),fetchedAt:snapshot.fetchedAt };
}
function validName(value,ctx) {
  if(typeof value!=='string' || !value || value!==value.trim() || [...value].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || value.startsWith('pg_') || Buffer.byteLength(value)>ctx.maxIdentifierLength)fail('invalid_name');return value;
}
function location(value) {
  if(typeof value!=='string' || !value || value!==value.trim() || [...value].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || !(/^(\/|[A-Za-z]:[\\/])/.test(value)) || value.length>4096)fail('invalid_location');
  // Escape-string literals retain apostrophes and backslashes independently of session settings.
  return "E'"+value.replaceAll('\\','\\\\').replaceAll("'","''")+"'";
}
async function plan(query,input,options) {
  if(!input || !['create','rename','owner','drop'].includes(input.action))fail('invalid_request');
  const snapshot=await list(query,options);if(snapshot.context.readonly)fail('readonly');
  let target=null,info=null,owner=null,name=null,sql;
  if(['create','rename'].includes(input.action)){
    name=validName(input.newName,snapshot.context);if(snapshot.tablespaces.some(row=>row.name===name))fail('name_exists');
  }
  if(input.action==='create'){
    if(!snapshot.context.canCreate)fail('permission');
    owner=snapshot.principals.find(role=>role.id===(input.ownerId || snapshot.context.userId) && role.settable);if(!owner)fail('permission');
    sql=`CREATE TABLESPACE ${quote(name)} OWNER ${quote(owner.name)} LOCATION ${location(input.location)}`;
  }else{
    target=find(snapshot,input.target);info=await detail(query,input.target,options);
    if(typeof input.expected!=='string' || input.expected!==info.fingerprint)fail('conflict');
    if(target.protected)fail('protected');
    if(input.action==='rename'){
      if(!target.canRename)fail('permission');sql=`ALTER TABLESPACE ${quote(target.name)} RENAME TO ${quote(name)}`;
    }else if(input.action==='owner'){
      if(!target.canChangeOwner)fail('permission');owner=snapshot.principals.find(role=>role.id===input.ownerId && info.ownerCandidates.includes(role.id));
      if(!owner)fail('permission');if(owner.id===target.ownerId)fail('no_changes');
      sql=`ALTER TABLESPACE ${quote(target.name)} OWNER TO ${quote(owner.name)}`;
    }else{
      if(!target.canDrop)fail('permission');
      if(info.databasesError || info.objectsTruncated)fail('usage_unknown');
      if(info.databases.length || info.objectCount)fail('not_empty');
      sql=`DROP TABLESPACE ${quote(target.name)}`;
    }
  }
  const request={action:input.action,...(target?{target:{oid:target.oid,identity:target.identity,name:target.name},expected:input.expected}:{}),...(name?{newName:name}:{}),...(owner?{ownerId:owner.id}:{}),...(input.action==='create'?{location:input.location}:{})};
  return {request,sql,detail:info,snapshot};
}
function signature(result){return hash([result.request,result.sql,result.detail?.fingerprint,result.snapshot.tablespaces,result.snapshot.principals,result.snapshot.context]);}
function createTablespaceManager(){
  const reviews=new Map();return{list,detail,
    async review(query,input,options){
      const result=await plan(query,input,options);for(const [key,value]of reviews)if(Date.now()-value.time>300000)reviews.delete(key);
      if(reviews.size>=100)reviews.delete(reviews.keys().next().value);const token=randomBytes(24).toString('hex');
      reviews.set(token,{scope:options.connectionId,time:Date.now(),signature:signature(result)});
      return{request:result.request,sql:result.sql,detail:result.detail,token};
    },
    async execute(query,input,options){
      const entry=reviews.get(input?.token);if(!entry || entry.scope!==options.connectionId || Date.now()-entry.time>300000)fail('review_expired');
      const result=await plan(query,input,options);if(entry.signature!==signature(result))fail('conflict');
      if(input.action==='drop' && input.confirmName!==result.request.target.name)fail('confirmation_mismatch');
      reviews.delete(input.token);
      try{await query(result.sql);}catch(error){if(!/^[0-9A-Z]{5}$/.test(error.code || '') || /^(08|57P0)/.test(error.code || ''))error.pgTsUnknown=true;throw error;}
      try{
        const snapshot=await list(query,options),selected=input.action==='create'?snapshot.tablespaces.find(row=>row.name===result.request.newName):snapshot.tablespaces.find(row=>row.oid===result.request.target.oid);
        if(input.action==='drop'?Boolean(selected):!selected || selected.name!==(result.request.newName || result.request.target.name) || selected.ownerId!==(result.request.ownerId || result.detail.tablespace.ownerId))fail('verification_failed');
        return{snapshot,selectedOid:selected?.oid || null,applied:true};
      }catch(error){error.pgTsApplied=true;throw error;}
    }
  };
}
function safeError(error){return{error:error?.pgTsUnknown?'pg_ts_outcome_unknown':/^pg_ts_[a-z_]+$/.test(error?.message || '')?error.message:'pg_ts_operation_failed',errorCode:/^[0-9A-Z]{5}$/.test(error?.code || '')?error.code:'',applied:error?.pgTsApplied===true};}
module.exports={createTablespaceManager,list,detail,LIST_SQL,CONTEXT_SQL,SIZE_SQL,DATABASES_SQL,OBJECTS_SQL,safeError};
