// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const {createHash,randomBytes}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=key=>{throw Object.assign(Error('ora_user_'+key),{userRoleKey:'ora_user_'+key});};
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const permission=error=>[942,1031].includes(error?.errorNum) || ['ORA-00942','ORA-01031'].includes(error?.code);
const IDENTITY_SQL="SELECT SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') AS DB_NAME,SYS_CONTEXT('USERENV','CON_ID') AS CON_ID,SYS_CONTEXT('USERENV','CON_NAME') AS CON_NAME,SYS_CONTEXT('USERENV','SESSION_USER') AS SESSION_USER FROM DUAL";
const USERS_SQL=`SELECT USERNAME AS NAME,TO_CHAR(USER_ID) AS ID,TO_CHAR(CREATED,'YYYY-MM-DD HH24:MI:SS') AS CREATED,ACCOUNT_STATUS,AUTHENTICATION_TYPE,COMMON,ORACLE_MAINTAINED,PROFILE,DEFAULT_TABLESPACE,TEMPORARY_TABLESPACE,TO_CHAR(EXPIRY_DATE,'YYYY-MM-DD HH24:MI:SS') AS EXPIRY_DATE FROM DBA_USERS ORDER BY USERNAME`;
const VISIBLE_USERS_SQL=`SELECT USERNAME AS NAME,TO_CHAR(USER_ID) AS ID,TO_CHAR(CREATED,'YYYY-MM-DD HH24:MI:SS') AS CREATED,NULL AS ACCOUNT_STATUS,NULL AS AUTHENTICATION_TYPE,COMMON,ORACLE_MAINTAINED FROM ALL_USERS ORDER BY USERNAME`;
const rolesSql=modern=>`SELECT ROLE AS NAME,${modern?'TO_CHAR(ROLE_ID)':'NULL'} AS ID,AUTHENTICATION_TYPE,COMMON,ORACLE_MAINTAINED FROM DBA_ROLES ORDER BY ROLE`;
const grantsSql=modern=>`SELECT GRANTEE,GRANTED_ROLE AS NAME,'ROLE' AS KIND,ADMIN_OPTION,DEFAULT_ROLE,COMMON,${modern?'INHERITED':'NULL AS INHERITED'} FROM DBA_ROLE_PRIVS UNION ALL SELECT GRANTEE,PRIVILEGE,'SYSTEM',ADMIN_OPTION,NULL,COMMON,${modern?'INHERITED':'NULL'} FROM DBA_SYS_PRIVS ORDER BY GRANTEE,KIND,NAME`;
const MAP_SQL='SELECT NAME FROM SYSTEM_PRIVILEGE_MAP ORDER BY NAME';
const DEPENDENCIES_SQL=`SELECT x.*,COUNT(*) OVER() AS TOTAL FROM (
 SELECT OWNER,OBJECT_NAME AS NAME,OBJECT_TYPE AS KIND,'OWNED' AS RELATION FROM DBA_OBJECTS WHERE OWNER=:name
 UNION SELECT OWNER,NAME,TYPE,'DEPENDENT' FROM DBA_DEPENDENCIES WHERE REFERENCED_OWNER=:name AND OWNER<>:name
 UNION SELECT c.OWNER,c.CONSTRAINT_NAME,'FOREIGN KEY','DEPENDENT' FROM DBA_CONSTRAINTS c JOIN DBA_CONSTRAINTS p ON p.OWNER=c.R_OWNER AND p.CONSTRAINT_NAME=c.R_CONSTRAINT_NAME WHERE c.CONSTRAINT_TYPE='R' AND p.OWNER=:name AND c.OWNER<>:name
 ) x ORDER BY RELATION,OWNER,KIND,NAME FETCH FIRST 200 ROWS ONLY`;
const QUOTAS_SQL=`SELECT t.TABLESPACE_NAME,TO_CHAR(NVL(q.BYTES,NVL(s.USED_BYTES,0))) AS USED_BYTES,TO_CHAR(q.MAX_BYTES) AS MAX_BYTES FROM DBA_TABLESPACES t
 LEFT JOIN DBA_TS_QUOTAS q ON q.TABLESPACE_NAME=t.TABLESPACE_NAME AND q.USERNAME=:name AND q.DROPPED='NO'
 LEFT JOIN (SELECT TABLESPACE_NAME,SUM(BYTES) AS USED_BYTES FROM DBA_SEGMENTS WHERE OWNER=:name GROUP BY TABLESPACE_NAME) s ON s.TABLESPACE_NAME=t.TABLESPACE_NAME
 WHERE t.CONTENTS='PERMANENT' ORDER BY t.TABLESPACE_NAME`;
async function catalog(query,sql,fallback){try{return{rows:(await query(sql)).rows,complete:true};}catch(error){if(!permission(error) || !fallback)throw error;return{rows:(await query(fallback)).rows,complete:false};}}
function modernVersion(version){const [major,minor]=String(version || '').split('.').map(Number);if(!Number.isInteger(major) || major<12)fail('version_unknown');return major>12 || minor>=2;}
async function list(query,options={}){
 const ctx=(await query(IDENTITY_SQL)).rows[0];if(!ctx?.DB_NAME || ctx.CON_ID==null || !ctx.SESSION_USER)fail('identity_unknown');
 const modern=modernVersion(options.serverVersion),privileges=(await query('SELECT PRIVILEGE FROM SESSION_PRIVS')).rows.map(row=>row.PRIVILEGE).sort();
 const users=await catalog(query,USERS_SQL,VISIBLE_USERS_SQL),roles=await catalog(query,rolesSql(modern),"SELECT GRANTED_ROLE AS NAME,NULL AS ID,NULL AS AUTHENTICATION_TYPE,NULL AS COMMON,NULL AS ORACLE_MAINTAINED FROM USER_ROLE_PRIVS ORDER BY GRANTED_ROLE");
 const grants=await catalog(query,grantsSql(modern),"SELECT USER AS GRANTEE,GRANTED_ROLE AS NAME,'ROLE' AS KIND,ADMIN_OPTION,DEFAULT_ROLE,NULL AS COMMON,NULL AS INHERITED FROM USER_ROLE_PRIVS UNION ALL SELECT USER,PRIVILEGE,'SYSTEM',ADMIN_OPTION,NULL,NULL,NULL FROM USER_SYS_PRIVS");
 grants.rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 const complete=users.complete && roles.complete && grants.complete;
 const context={database:ctx.DB_NAME,containerId:String(ctx.CON_ID),container:ctx.CON_NAME,user:ctx.SESSION_USER,readonly:Boolean(options.readonly),scope:complete?'all':'visible',modern,maxNameBytes:modern?128:30,privileges};
 const writable=complete && !options.readonly && context.containerId!=='1';context.canCreateUser=writable && privileges.includes('CREATE USER');context.canCreateRole=writable && modern && privileges.includes('CREATE ROLE');
 const principals=[...users.rows.map(row=>({...row,KIND:'USER'})),...roles.rows.map(row=>({...row,KIND:'ROLE'}))].map(row=>{
  const self=row.KIND==='USER' && row.NAME===context.user,maintained=row.ORACLE_MAINTAINED!=='N',common=row.COMMON!=='NO',unknown=!row.ID || !row.AUTHENTICATION_TYPE;
  const protectedTarget=!writable || self || maintained || common || unknown || (row.KIND==='ROLE' && row.AUTHENTICATION_TYPE!=='NONE');
  const identity=hash([options.connectionId,context.database,context.containerId,row.KIND,row.ID,row.NAME,row.CREATED]);
  const lockKnown=typeof row.ACCOUNT_STATUS==='string' && /^(OPEN|EXPIRED|LOCKED)/.test(row.ACCOUNT_STATUS);
  return{identity,id:row.ID==null?null:String(row.ID),name:row.NAME,kind:row.KIND,created:row.CREATED || null,status:row.ACCOUNT_STATUS || null,locked:lockKnown?row.ACCOUNT_STATUS.includes('LOCKED'):null,authentication:row.AUTHENTICATION_TYPE || null,common,maintained,self,protected:protectedTarget,
   profile:row.PROFILE || null,defaultTablespace:row.DEFAULT_TABLESPACE || null,temporaryTablespace:row.TEMPORARY_TABLESPACE || null,expiry:row.EXPIRY_DATE || null,
   canPassword:writable && row.KIND==='USER' && !maintained && !common && row.AUTHENTICATION_TYPE==='PASSWORD' && privileges.includes('ALTER USER'),
   canLock:!protectedTarget && row.KIND==='USER' && lockKnown && privileges.includes('ALTER USER'),canDrop:!protectedTarget && privileges.includes(row.KIND==='ROLE'?'DROP ANY ROLE':'DROP USER'),
   canQuota:!protectedTarget && row.KIND==='USER' && privileges.includes('ALTER USER'),fingerprint:hash([identity,row,context,grants.rows])};
 });
 return{principals,grants:grants.rows.map(row=>({grantee:row.GRANTEE,name:row.NAME,kind:row.KIND,admin:row.ADMIN_OPTION==='YES',defaultRole:row.DEFAULT_ROLE==null?null:row.DEFAULT_ROLE==='YES',common:row.COMMON==='YES',inherited:row.INHERITED==null?null:row.INHERITED==='YES'})),context,fetchedAt:new Date().toISOString()};
}
function find(snapshot,input){const target=snapshot.principals.find(row=>row.identity===input?.identity && row.name===input.name && row.kind===input.kind);if(!target)fail('target_changed');return target;}
function paths(snapshot,name){const visited=new Set([name,'PUBLIC']),queue=[name,'PUBLIC'];for(let i=0;i<queue.length;i++)for(const grant of snapshot.grants)if(grant.kind==='ROLE' && grant.grantee===queue[i] && !visited.has(grant.name)){visited.add(grant.name);queue.push(grant.name);}return visited;}
function canGrant(snapshot,target,candidate){if(target.protected)return false;const privs=snapshot.context.privileges;return privs.includes(candidate.kind==='ROLE'?'GRANT ANY ROLE':'GRANT ANY PRIVILEGE') || snapshot.grants.some(grant=>grant.kind===candidate.kind && grant.name===candidate.name && grant.grantee===snapshot.context.user && grant.admin && !grant.common && grant.inherited===false);}
async function optional(query,sql,binds){try{return{rows:(await query(sql,binds)).rows,error:''};}catch(error){if(!permission(error))throw error;return{rows:[],error:'ora_user_permission'};}}
async function detail(query,input,options){
 const snapshot=await list(query,options),target=find(snapshot,input),sources=paths(snapshot,target.name);
 const grants=snapshot.grants.filter(grant=>grant.grantee===target.name).map(grant=>({...grant,canRevoke:!grant.common && grant.inherited===false && canGrant(snapshot,target,grant)}));
 const effective=snapshot.grants.filter(grant=>sources.has(grant.grantee)).map(grant=>({...grant,source:grant.grantee,direct:grant.grantee===target.name}));
 const dependencies=target.kind==='USER'?await optional(query,DEPENDENCIES_SQL,{name:target.name}):{rows:[],error:''};
 const quotas=target.kind==='USER'?await optional(query,QUOTAS_SQL,{name:target.name}):{rows:[],error:''};
 const count=Number(dependencies.rows[0]?.TOTAL || 0);if(!Number.isSafeInteger(count))fail('metadata_unknown');
 const systems=(await query(MAP_SQL)).rows;
 const candidates=[...snapshot.principals.filter(row=>row.kind==='ROLE' && row.name!==target.name).map(row=>({kind:'ROLE',name:row.name})),...systems.filter(row=>/^[A-Z][A-Z0-9_ ]*$/.test(row.NAME)).map(row=>({kind:'SYSTEM',name:row.NAME}))].filter(row=>canGrant(snapshot,target,row) && !(row.kind==='ROLE' && paths(snapshot,row.name).has(target.name)));
 const related=snapshot.grants.filter(grant=>grant.kind==='ROLE' && grant.name===target.name);
 return{target,grants,effective,candidates,related,dependencies:dependencies.rows.map(row=>({owner:row.OWNER,name:row.NAME,kind:row.KIND,relation:row.RELATION})),dependencyCount:count,dependenciesTruncated:count>dependencies.rows.length,dependenciesError:dependencies.error,
  quotas:quotas.rows.map(row=>({tablespace:row.TABLESPACE_NAME,usedBytes:String(row.USED_BYTES),maxBytes:row.MAX_BYTES==null?null:String(row.MAX_BYTES)})),quotaError:quotas.error,
  unlimited:snapshot.grants.some(grant=>grant.kind==='SYSTEM' && grant.grantee===target.name && grant.name==='UNLIMITED TABLESPACE'),
  fingerprint:hash([target.fingerprint,grants,dependencies.rows,dependencies.error,quotas.rows.map(row=>[row.TABLESPACE_NAME,row.MAX_BYTES]),quotas.error,related]),fetchedAt:snapshot.fetchedAt};
}
function validName(name,limit){if(typeof name!=='string' || !name || name!==name.trim() || name.includes('"') || [...name].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || Buffer.byteLength(name)>limit || name.toUpperCase()==='PUBLIC')fail('invalid_name');return name;}
function quotaBytes(input){if(input.unlimited===true)return '-1';if(input.unlimited!==false || typeof input.amount!=='string' || !/^\d{1,19}$/.test(input.amount) || !['B','K','M','G','T'].includes(input.unit))fail('invalid_quota');const bytes=BigInt(input.amount)*1024n**BigInt(['B','K','M','G','T'].indexOf(input.unit));if(bytes>9223372036854775807n)fail('invalid_quota');return String(bytes);}
async function plan(query,input,options){
 if(!input || !['create','password','lock','drop','grant','revoke','quota'].includes(input.action))fail('invalid_request');const snapshot=await list(query,options),ctx=snapshot.context;
 if(ctx.readonly)fail('readonly');if(ctx.scope!=='all' || ctx.containerId==='1')fail('restricted');
 let target=null,info=null,request={action:input.action},sql;
 if(input.action==='create'){
  if(!['USER','ROLE'].includes(input.kind) || !(input.kind==='USER'?ctx.canCreateUser:ctx.canCreateRole))fail('permission');const name=validName(input.newName,ctx.maxNameBytes);if(snapshot.principals.some(row=>row.name===name))fail('name_exists');request={action:'create',kind:input.kind,newName:name};sql=input.kind==='USER'?`CREATE USER ${quote(name)} IDENTIFIED BY "<redacted>"`:`CREATE ROLE ${quote(name)} NOT IDENTIFIED`;
 }else{
  target=find(snapshot,input.target);info=await detail(query,input.target,options);if(info.fingerprint!==input.expected)fail('conflict');request={action:input.action,target:{identity:target.identity,name:target.name,kind:target.kind},expected:input.expected};
  if(input.action==='password'){if(!target.canPassword)fail('protected');sql=`ALTER USER ${quote(target.name)} IDENTIFIED BY "<redacted>"`;}
  else if(input.action==='lock'){if(!target.canLock || typeof input.locked!=='boolean')fail('protected');if(input.locked===target.locked)fail('no_changes');request.locked=input.locked;sql=`ALTER USER ${quote(target.name)} ACCOUNT ${input.locked?'LOCK':'UNLOCK'}`;}
  else if(input.action==='drop'){
   if(!target.canDrop || typeof input.cascade!=='boolean')fail('protected');if(info.dependenciesError || info.dependenciesTruncated)fail('dependencies_unknown');
   if(target.kind==='ROLE' && input.cascade)fail('invalid_request');if(target.kind==='USER' && !input.cascade && info.dependencies.some(row=>row.relation==='OWNED'))fail('has_objects');
   request.cascade=input.cascade;sql=`DROP ${target.kind} ${quote(target.name)}${input.cascade?' CASCADE':''}`;
  }else if(input.action==='quota'){
   if(!target.canQuota || info.quotaError)fail('permission');const row=info.quotas.find(row=>row.tablespace===input.tablespace);if(!row)fail('invalid_quota');const amount=quotaBytes(input);if(amount===row.maxBytes)fail('no_changes');
   request={...request,tablespace:row.tablespace,amount:input.amount,unit:input.unit,unlimited:input.unlimited};sql=`ALTER USER ${quote(target.name)} QUOTA ${amount==='-1'?'UNLIMITED':amount} ON ${quote(row.tablespace)}`;
  }else{
   const candidate={kind:input.privilegeKind,name:input.privilege};if(!['ROLE','SYSTEM'].includes(candidate.kind) || typeof candidate.name!=='string' || !canGrant(snapshot,target,candidate))fail('permission');
   const existing=info.grants.filter(grant=>grant.kind===candidate.kind && grant.name===candidate.name);if(existing.some(grant=>grant.common || grant.inherited!==false))fail('restricted');
   if(input.action==='grant'){
    if(!info.candidates.some(row=>row.name===candidate.name && row.kind===candidate.kind) || typeof input.admin!=='boolean')fail('invalid_privilege');
    if(existing.length && (!input.admin || existing.some(grant=>grant.admin)))fail('no_changes');
   }else if(!existing.length || existing.some(grant=>!grant.canRevoke))fail('permission');
   request={...request,privilegeKind:candidate.kind,privilege:candidate.name,...(input.action==='grant'?{admin:input.admin}:{})};
   const privilege=candidate.kind==='ROLE'?quote(candidate.name):candidate.name;
   sql=input.action==='grant'?`GRANT ${privilege} TO ${quote(target.name)}${input.admin?' WITH ADMIN OPTION':''}`:`REVOKE ${privilege} FROM ${quote(target.name)}`;
   if(ctx.containerId!=='0')sql+=' CONTAINER=CURRENT';
  }
 }
 return{request,sql,detail:info,snapshot};
}
const signature=result=>hash([result.request,result.sql,result.detail?.fingerprint,result.snapshot.principals,result.snapshot.grants,result.snapshot.context]);
function createUserRoleManager(){const reviews=new Map();return{list,detail,
 async review(query,input,options){const result=await plan(query,input,options);for(const[key,value]of reviews)if(Date.now()-value.time>300000)reviews.delete(key);if(reviews.size>=100)reviews.delete(reviews.keys().next().value);const token=randomBytes(24).toString('hex');reviews.set(token,{time:Date.now(),scope:options.connectionId,signature:signature(result)});return{request:result.request,sql:result.sql,detail:result.detail,token};},
 async execute(query,input,options){const entry=reviews.get(input?.token);if(!entry || entry.scope!==options.connectionId || Date.now()-entry.time>300000)fail('review_expired');const result=await plan(query,input,options);if(signature(result)!==entry.signature)fail('conflict');if(input.action==='drop' && input.confirmName!==result.request.target.name)fail('confirmation_mismatch');
  let sql=result.sql;if(input.action==='password' || input.action==='create' && input.kind==='USER'){if(typeof input.password!=='string' || !input.password || Buffer.byteLength(input.password)>30 || /["\r\n]/.test(input.password) || input.password.includes('\0'))fail('invalid_password');sql=sql.slice(0,-'"<redacted>"'.length)+quote(input.password);}
  reviews.delete(input.token);try{await query(sql);}catch(error){if(!error.errorNum || [3113,3114,3135,1013].includes(error.errorNum))error.userRoleUnknown=true;throw error;}
  try{const snapshot=await list(query,options),selected=input.action==='create'?snapshot.principals.find(row=>row.name===result.request.newName && row.kind===result.request.kind):snapshot.principals.find(row=>row.identity===result.request.target.identity);
   if(input.action==='drop'?Boolean(selected):!selected || selected.name!==(result.request.newName || result.request.target.name))fail('verification_failed');
   if(input.action==='lock' && selected.locked!==result.request.locked)fail('verification_failed');
   if(['grant','revoke','quota'].includes(input.action)){const updated=await detail(query,selected,options),r=result.request;if(input.action==='quota'?updated.quotas.find(row=>row.tablespace===r.tablespace)?.maxBytes!==quotaBytes(r):input.action==='grant'?!updated.grants.some(row=>row.kind===r.privilegeKind && row.name===r.privilege && (!r.admin || row.admin)):updated.grants.some(row=>row.kind===r.privilegeKind && row.name===r.privilege))fail('verification_failed');}
   return{snapshot,selectedIdentity:selected?.identity || null,applied:true};
  }catch(error){error.userRoleApplied=true;throw error;}
 }
};}
function safeError(error){const code=String(error?.code || (error?.errorNum?'ORA-'+String(error.errorNum).padStart(5,'0'):''));return{error:error?.userRoleUnknown?'ora_user_outcome_unknown':error?.userRoleKey || 'ora_user_operation_failed',errorCode:/^(ORA|NJS|DPI)-\d+$/.test(code)?code:'',applied:error?.userRoleApplied===true};}
module.exports={createUserRoleManager,list,detail,IDENTITY_SQL,USERS_SQL,VISIBLE_USERS_SQL,rolesSql,grantsSql,MAP_SQL,DEPENDENCIES_SQL,QUOTAS_SQL,quotaBytes,safeError};
