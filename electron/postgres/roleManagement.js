// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash, randomBytes } = require('node:crypto');
const privileges = require('./objectPrivileges');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "E'" + value.replaceAll('\\', '\\\\').replaceAll("'", "''") + "'";
const fail = key => { throw Error(`pg_role_${key}`); };
const SETTINGS_SQL = `SELECT current_setting('max_identifier_length')::integer AS max_length,
 (SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=session_user) AS session_id`;
const ROLES_SQL = `SELECT oid::text,rolname AS name,rolcanlogin AS login,rolsuper AS superuser,rolcreatedb AS create_database,
 rolcreaterole AS create_role,rolinherit AS inherit,rolreplication AS replication,rolbypassrls AS bypass_rls,
 rolconnlimit AS connection_limit,rolvaliduntil::text AS valid_until,rolconfig AS settings,
 pg_catalog.pg_has_role(current_user,oid,'MEMBER WITH ADMIN OPTION') AS actor_admin,
 pg_catalog.pg_has_role(current_user,oid,'USAGE') AS actor_usable FROM pg_catalog.pg_roles ORDER BY rolname`;
function membershipSql(version) {
  return `SELECT roleid::text AS role_id,member::text AS member_id,grantor::text AS grantor_id,admin_option AS admin,
 ${version >= 160000 ? 'inherit_option AS inherit,set_option AS set' : 'NULL::boolean AS inherit,NULL::boolean AS set'} FROM pg_catalog.pg_auth_members ORDER BY roleid,member,grantor`;
}
const DEPENDENCIES_SQL = `SELECT d.dbid::text AS database_id,b.datname AS database,d.classid::text AS class_id,d.objid::text AS object_id,d.objsubid AS sub_id,d.deptype AS dependency_type,
 CASE WHEN d.dbid=0 OR d.dbid=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database()) THEN pg_catalog.pg_describe_object(d.classid,d.objid,d.objsubid) END AS description,
 COUNT(*) OVER()::text AS total FROM pg_catalog.pg_shdepend d LEFT JOIN pg_catalog.pg_database b ON b.oid=d.dbid
 WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.refobjid=$1::oid ORDER BY d.dbid,d.classid,d.objid,d.objsubid,d.deptype LIMIT 200`;
function reachable(memberships,start) {
  const visited=new Set(),queue=[start];
  for(let i=0;i<queue.length;i++)for(const entry of memberships)if(entry.memberId===queue[i] && !visited.has(entry.roleId)){visited.add(entry.roleId);queue.push(entry.roleId);}
  return visited;
}
async function list(query,options={}) {
  const context=await privileges.principals(query,options),settings=(await query(SETTINGS_SQL)).rows[0],source=(await query(ROLES_SQL)).rows;
  const actor=source.find(role=>role.oid===context.context.userId);
  if(!actor || !settings?.session_id || !Number.isSafeInteger(settings.max_length) || settings.max_length<=0)fail('metadata_unknown');
  const ctx={...context.context,sessionUserId:settings.session_id,maxIdentifierLength:settings.max_length,canCreate:!options.readonly && (actor.superuser===true || actor.create_role===true),scope:'cluster'};
  const memberships=(await query(membershipSql(ctx.version))).rows.map(row=>({roleId:row.role_id,memberId:row.member_id,grantorId:row.grantor_id,admin:row.admin,inherit:row.inherit,set:row.set}));
  const roles=source.map(row=>{
    const system=row.name.startsWith('pg_'),self=[ctx.userId,ctx.sessionUserId].includes(row.oid),protectedTarget=system || self;
    const authority=actor.superuser===true || actor.create_role===true && !row.superuser && !row.replication && (ctx.version<160000 || row.actor_admin===true);
    const canModify=!options.readonly && !protectedTarget && authority;
    const identity=hash([options.connectionId,ctx.databaseId,row.oid]);
    return {oid:row.oid,identity,name:row.name,login:row.login,superuser:row.superuser,createDatabase:row.create_database,createRole:row.create_role,inherit:row.inherit,replication:row.replication,bypassRls:row.bypass_rls,
      connectionLimit:row.connection_limit,validUntil:row.valid_until,settings:row.settings || [],system,self,protected:protectedTarget,
      canPassword:!options.readonly && !system && (row.oid===ctx.userId || authority),canLogin:canModify,canSuperuser:!options.readonly && !protectedTarget && actor.superuser===true,
      canDrop:canModify,actorAdmin:row.actor_admin,actorUsable:row.actor_usable,
      fingerprint:hash([identity,row,memberships,ctx])};
  });
  return {roles,memberships,context:ctx,fetchedAt:new Date().toISOString()};
}
function find(snapshot,target) {
  if(!target || typeof target.oid!=='string' || typeof target.identity!=='string' || typeof target.name!=='string')fail('invalid_target');
  const role=snapshot.roles.find(role=>role.oid===target.oid && role.identity===target.identity && role.name===target.name);
  if(!role)fail('target_changed');return role;
}
function grantors(snapshot,role) {
  const actor=snapshot.roles.find(row=>row.oid===snapshot.context.userId);
  if(actor.superuser)return [snapshot.context.version>=160000?'10':actor.oid].filter(id=>snapshot.roles.some(row=>row.oid===id));
  if(snapshot.context.version<160000)return actor.createRole && !role.superuser || role.actorAdmin ? [actor.oid]:[];
  const ids=new Set(role.actorAdmin?[actor.oid]:[]);
  for(const grant of snapshot.memberships)if(grant.roleId===role.oid && grant.admin && snapshot.roles.some(row=>row.oid===grant.memberId && row.actorUsable))ids.add(grant.memberId);
  return [...ids];
}
function canRevoke(snapshot,member,grant) {
  const actor=snapshot.roles.find(role=>role.oid===snapshot.context.userId),role=snapshot.roles.find(role=>role.oid===grant.roleId);
  if(snapshot.context.readonly || member.protected || !role || role.superuser && !actor.superuser)return false;
  if(actor.superuser)return true;
  if(snapshot.context.version<160000)return actor.createRole || role.actorAdmin;
  return grantors(snapshot,role).includes(grant.grantorId);
}
async function detail(query,target,options) {
  const snapshot=await list(query,options),role=find(snapshot,target);
  const dependencies=(await query(DEPENDENCIES_SQL,[role.oid])).rows,total=Number(dependencies[0]?.total || 0);
  if(!Number.isSafeInteger(total))fail('metadata_unknown');
  const edges=snapshot.memberships.filter(entry=>entry.memberId===role.oid).map(entry=>({...entry,canRevoke:canRevoke(snapshot,role,entry)}));
  const effectiveSql=`SELECT oid::text AS oid,pg_catalog.pg_has_role($1::oid,oid,'MEMBER') AS member,pg_catalog.pg_has_role($1::oid,oid,'USAGE') AS usable,
 pg_catalog.pg_has_role($1::oid,oid,'${snapshot.context.version>=160000?'SET':'MEMBER'}') AS settable FROM pg_catalog.pg_roles WHERE oid<>$1::oid ORDER BY oid`;
  const effective=(await query(effectiveSql,[role.oid])).rows;
  const indirect=reachable(snapshot.memberships,role.oid);
  const effectiveRoles=snapshot.roles.filter(row=>indirect.has(row.oid)).map(row=>({oid:row.oid,name:row.name,...effective.find(entry=>entry.oid===row.oid),direct:edges.some(entry=>entry.roleId===row.oid)}));
  const candidates=snapshot.roles.filter(row=>row.oid!==role.oid && !reachable(snapshot.memberships,row.oid).has(role.oid)).map(row=>({oid:row.oid,name:row.name,grantorIds:grantors(snapshot,row)})).filter(row=>row.grantorIds.length);
  return {role,memberships:edges,members:snapshot.memberships.filter(entry=>entry.roleId===role.oid),effectiveRoles,candidates,
    dependencies,dependencyCount:total,dependenciesTruncated:total>dependencies.length,
    fingerprint:hash([role.fingerprint,dependencies,total]),fetchedAt:snapshot.fetchedAt};
}
function newName(value,context) {
  if(typeof value!=='string' || !value || value!==value.trim() || [...value].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || value.startsWith('pg_') || value.toLowerCase()==='public' || Buffer.byteLength(value)>context.maxIdentifierLength)fail('invalid_name');return value;
}
async function plan(query,input,options) {
  if(!input || !['create','password','login','superuser','grant','revoke','drop'].includes(input.action))fail('invalid_request');
  const snapshot=await list(query,options),ctx=snapshot.context;if(ctx.readonly)fail('readonly');
  let info=null,target=null,sql,request={action:input.action};
  if(input.action==='create'){
    if(!ctx.canCreate)fail('permission');const name=newName(input.newName,ctx);if(snapshot.roles.some(role=>role.name===name))fail('name_exists');
    if(typeof input.login!=='boolean' || !['set','none'].includes(input.passwordMode) || !input.login && input.passwordMode!=='none')fail('invalid_request');
    request={action:input.action,newName:name,login:input.login,passwordMode:input.passwordMode};
    sql=`CREATE ROLE ${quote(name)} ${input.login?'LOGIN':'NOLOGIN'} PASSWORD ${input.passwordMode==='set'?"'<redacted>'":'NULL'}`;
  }else{
    target=find(snapshot,input.target);info=await detail(query,input.target,options);
    if(input.expected!==info.fingerprint)fail('conflict');
    request={action:input.action,target:{oid:target.oid,identity:target.identity,name:target.name},expected:input.expected};
    if(input.action==='password'){
      if(!target.canPassword)fail('permission');if(!['set','none'].includes(input.passwordMode))fail('invalid_request');request.passwordMode=input.passwordMode;
      sql=`ALTER ROLE ${quote(target.name)} PASSWORD ${input.passwordMode==='set'?"'<redacted>'":'NULL'}`;
    }else if(['login','superuser'].includes(input.action)){
      if(!(input.action==='login'?target.canLogin:target.canSuperuser))fail('protected');if(typeof input.enabled!=='boolean')fail('invalid_request');
      if(target[input.action]===input.enabled)fail('no_changes');request.enabled=input.enabled;
      sql=`ALTER ROLE ${quote(target.name)} ${input.action==='login'?(input.enabled?'LOGIN':'NOLOGIN'):(input.enabled?'SUPERUSER':'NOSUPERUSER')}`;
    }else if(input.action==='drop'){
      if(!target.canDrop)fail('protected');if(info.dependencyCount || info.dependenciesTruncated)fail('dependencies');sql=`DROP ROLE ${quote(target.name)}`;
    }else{
      if(target.protected)fail('protected');
      const role=snapshot.roles.find(role=>role.oid===input.roleId);if(!role || role.oid===target.oid)fail('invalid_membership');
      const actor=snapshot.roles.find(role=>role.oid===ctx.userId);if(role.superuser && !actor.superuser)fail('permission');
      request.roleId=role.oid;request.grantorId=input.grantorId;
      const grantor=snapshot.roles.find(row=>row.oid===input.grantorId);if(!grantor)fail('permission');
      const grantedBy=ctx.version>=160000?` GRANTED BY ${quote(grantor.name)}`:'';
      if(input.action==='grant'){
        if(!grantors(snapshot,role).includes(grantor.oid) || reachable(snapshot.memberships,role.oid).has(target.oid))fail('permission');
        if(typeof input.admin!=='boolean' || ctx.version>=160000 && (typeof input.inherit!=='boolean' || typeof input.set!=='boolean') || ctx.version<160000 && (input.inherit!==undefined || input.set!==undefined))fail('invalid_request');
        request={...request,admin:input.admin,...(ctx.version>=160000?{inherit:input.inherit,set:input.set}:{})};
        const existing=snapshot.memberships.find(row=>row.roleId===role.oid && row.memberId===target.oid && (ctx.version<160000 || row.grantorId===grantor.oid));
        if(existing && existing.admin===input.admin && (ctx.version<160000 || existing.inherit===input.inherit && existing.set===input.set))fail('no_changes');
        if(ctx.version<160000 && existing?.admin && !input.admin)fail('use_revoke_option');
        sql=`GRANT ${quote(role.name)} TO ${quote(target.name)}${ctx.version>=160000?` WITH ADMIN ${input.admin?'TRUE':'FALSE'}, INHERIT ${input.inherit?'TRUE':'FALSE'}, SET ${input.set?'TRUE':'FALSE'}`:input.admin?' WITH ADMIN OPTION':''}${grantedBy}`;
      }else{
        const entry=info.memberships.find(row=>row.roleId===role.oid && row.grantorId===grantor.oid);
        if(!entry || !entry.canRevoke)fail('permission');
        const option=input.revokeOption || 'membership';if(!['membership','admin','inherit','set'].includes(option) || ctx.version<160000 && ['inherit','set'].includes(option))fail('invalid_request');
        if(option!=='membership' && entry[option]!==true)fail('no_changes');request.revokeOption=option;
        sql=`REVOKE ${option==='membership'?'':option.toUpperCase()+' OPTION FOR '}${quote(role.name)} FROM ${quote(target.name)}${grantedBy} RESTRICT`;
      }
    }
  }
  return{request,sql,detail:info,snapshot};
}
const signature=result=>hash([result.request,result.sql,result.detail?.fingerprint,result.snapshot.roles,result.snapshot.memberships,result.snapshot.context]);
function createRoleManager(){
  const reviews=new Map();return{list,detail,
    async review(query,input,options){
      const result=await plan(query,input,options);for(const [key,entry]of reviews)if(Date.now()-entry.time>300000)reviews.delete(key);
      if(reviews.size>=100)reviews.delete(reviews.keys().next().value);const token=randomBytes(24).toString('hex');
      // Reviews retain only a metadata signature. Plaintext passwords never enter stored state or responses.
      reviews.set(token,{time:Date.now(),scope:options.connectionId,signature:signature(result)});
      return{request:result.request,sql:result.sql,detail:result.detail,token};
    },
    async execute(query,input,options){
      const entry=reviews.get(input?.token);if(!entry || entry.scope!==options.connectionId || Date.now()-entry.time>300000)fail('review_expired');
      const result=await plan(query,input,options);if(signature(result)!==entry.signature)fail('conflict');
      if(input.action==='drop' && input.confirmName!==result.request.target.name)fail('confirmation_mismatch');
      let sql=result.sql;
      if(result.request.passwordMode==='set'){
        if(typeof input.password!=='string' || !input.password || input.password.includes('\0') || Buffer.byteLength(input.password)>4096)fail('invalid_password');
        // Only the final driver call receives the actual password. Never return this SQL or a driver message.
        sql=sql.slice(0,-"'<redacted>'".length)+literal(input.password);
      }
      reviews.delete(input.token);await query(sql);
      const snapshot=await list(query,options),selected=input.action==='create'?snapshot.roles.find(role=>role.name===result.request.newName):snapshot.roles.find(role=>role.oid===result.request.target.oid);
      if(input.action==='drop'?Boolean(selected):!selected || selected.name!==(result.request.newName || result.request.target?.name))fail('not_applied');
      if(input.action==='create' && selected.login!==result.request.login || input.action==='login' && selected.login!==result.request.enabled || input.action==='superuser' && selected.superuser!==result.request.enabled)fail('not_applied');
      if(['grant','revoke'].includes(input.action)){
        const r=result.request,m=snapshot.memberships.find(m=>m.memberId===selected.oid && m.roleId===r.roleId && (snapshot.context.version<160000 || m.grantorId===r.grantorId));
        if(input.action==='grant'? !m || m.admin!==r.admin || snapshot.context.version>=160000 && (m.inherit!==r.inherit || m.set!==r.set):r.revokeOption==='membership'?Boolean(m):!m || m[r.revokeOption]!==false)fail('not_applied');
      }
      return{snapshot,selectedOid:selected?.oid || null,applied:true,passwordChanged:['create','password'].includes(input.action)};
    }
  };
}
const SAFE_KEYS=new Set(['metadata_unknown','invalid_target','target_changed','invalid_name','invalid_request','readonly','permission','name_exists','conflict','protected','no_changes','dependencies','invalid_membership','use_revoke_option','review_expired','confirmation_mismatch','invalid_password','not_applied','busy','not_connected','connection_changed'].map(key=>'pg_role_'+key));
function safeError(error){const inherited={'pg_priv_busy':'pg_role_busy','pg_priv_readonly':'pg_role_readonly','pg_priv_not_connected':'pg_role_not_connected','pg_priv_connection_changed':'pg_role_connection_changed'};return{error:error?.pgPrivUnknown?'pg_role_outcome_unknown':SAFE_KEYS.has(error?.message)?error.message:inherited[error?.message] || 'pg_role_operation_failed',errorCode:/^[0-9A-Z]{5}$/.test(error?.code || '')?error.code:''};}
module.exports={createRoleManager,list,detail,SETTINGS_SQL,ROLES_SQL,DEPENDENCIES_SQL,membershipSql,reachable,safeError};
