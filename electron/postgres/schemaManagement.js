// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash, randomBytes } = require('node:crypto');
const privileges = require('./objectPrivileges');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => '"' + value.replaceAll('"','""') + '"';
const fail = key => { throw new Error(key); };
const SYSTEM = name => name.startsWith('pg_') || name === 'information_schema';
const OWNER_CANDIDATES_SQL = `SELECT oid::text AS id FROM pg_roles WHERE has_database_privilege(oid,current_database(),'CREATE') AND pg_has_role($1::oid,oid,$2) ORDER BY rolname`;
const SCHEMAS_SQL = `SELECT n.oid::text AS oid,n.nspname AS name,n.nspowner::text AS owner_id,pg_get_userbyid(n.nspowner) AS owner,n.xmin::text AS revision,n.nspacl::text AS acl,
 EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_namespace'::regclass AND d.objid=n.oid AND d.deptype='e') AS extension_owned
 FROM pg_namespace n ORDER BY n.nspname`;
const DATABASE_SQL = `SELECT has_database_privilege(current_user,current_database(),'CREATE') AS can_create,current_setting('max_identifier_length')::integer AS max_length`;
const OWNER_SQL = `SELECT oid::text AS id,has_database_privilege(oid,current_database(),'CREATE') AS database_create FROM pg_roles ORDER BY oid`;
const OBJECTS_SQL = `WITH refs AS (SELECT DISTINCT d.classid,d.objid,d.objsubid FROM pg_depend d WHERE d.refclassid='pg_namespace'::regclass AND d.refobjid=$1::oid AND d.deptype='n')
 SELECT r.classid::text AS class_id,r.objid::text AS object_id,r.objsubid AS sub_id,i.type,i.schema,i.name,i.identity,COUNT(*) OVER()::text AS total
 FROM refs r CROSS JOIN LATERAL pg_identify_object(r.classid,r.objid,r.objsubid) i ORDER BY i.type,i.identity,r.classid,r.objid,r.objsubid LIMIT 200`;
const DEPENDENCIES_SQL = `WITH RECURSIVE edges AS (
 SELECT classid,objid,objsubid,refclassid,refobjid,refobjsubid FROM pg_depend WHERE deptype IN ('n','a','i','P','S')
 UNION SELECT refclassid,refobjid,refobjsubid,classid,objid,objsubid FROM pg_depend WHERE deptype='i'),
 affected(classid,objid,objsubid) AS (
 SELECT 'pg_namespace'::regclass::oid,$1::oid,0
 UNION SELECT e.classid,e.objid,e.objsubid FROM edges e JOIN affected a ON e.refclassid=a.classid AND e.refobjid=a.objid AND (a.objsubid=0 OR e.refobjsubid=a.objsubid))
 SELECT a.classid::text AS class_id,a.objid::text AS object_id,a.objsubid AS sub_id,i.type,i.schema,i.name,i.identity,COUNT(*) OVER()::text AS total
 FROM affected a CROSS JOIN LATERAL pg_identify_object(a.classid,a.objid,a.objsubid) i
 ORDER BY i.schema NULLS FIRST,i.type,i.identity,a.classid,a.objid,a.objsubid LIMIT 500`;
async function listSchemas(query, options = {}) {
  const people = await privileges.principals(query, options), database = (await query(DATABASE_SQL)).rows[0];
  if (!database || !Number.isSafeInteger(database.max_length) || database.max_length <= 0) fail('pg_schema_metadata_unknown');
  const ownership = (await query(OWNER_SQL)).rows;
  const principals = people.principals.map(role => ({ ...role, databaseCreate: ownership.find(entry => entry.id === role.id)?.database_create === true }));
  const context = { ...people.context, canCreate: !options.readonly && database.can_create === true, maxIdentifierLength: database.max_length };
  const schemas = (await query(SCHEMAS_SQL)).rows.map(row => {
    const owner = principals.find(role => role.id === row.owner_id);
    const system = SYSTEM(row.name), protectedTarget = system || row.name === 'public' || row.extension_owned || !owner;
    const actor = principals.find(role => role.id === context.userId);
    const issuer = owner?.usable || actor?.superuser ? actor : owner?.settable ? owner : null;
    const canAct = !options.readonly && Boolean(issuer) && !protectedTarget;
    const identity = hash([options.connectionId,context.databaseId,row.oid]);
    return { oid: row.oid, identity, name: row.name, ownerId: row.owner_id, owner: row.owner, system, protected: protectedTarget, extensionOwned: row.extension_owned,
      issuerId: issuer?.id || null, canDrop: Boolean(canAct), canRename: Boolean(canAct && issuer.databaseCreate), canChangeOwner: Boolean(canAct),
      fingerprint: hash([identity,row.name,row.owner_id,row.revision,row.acl,protectedTarget,principals,context]) };
  });
  return { schemas, principals, context, fetchedAt: new Date().toISOString() };
}
function find(snapshot, input) {
  if (!input || typeof input.oid !== 'string' || typeof input.identity !== 'string' || typeof input.name !== 'string') fail('pg_schema_invalid_target');
  const row = snapshot.schemas.find(row => row.oid === input.oid && row.identity === input.identity && row.name === input.name);
  if (!row) fail('pg_schema_target_changed');
  return row;
}
async function readDetail(query, input, options) {
  const snapshot = await listSchemas(query, options), schema = find(snapshot,input);
  const target = (await privileges.listObjects(query,{ schema: schema.name,type:'SCHEMA',search:'',offset:0 },options)).objects.find(row => row.oid === schema.oid);
  if (!target) fail('pg_schema_target_changed');
  const acl = await privileges.readPrivileges(query,target,options);
  const objects = (await query(OBJECTS_SQL,[schema.oid])).rows;
  const dependencies = (await query(DEPENDENCIES_SQL,[schema.oid])).rows;
  const ownerCandidates = schema.issuerId ? (await query(OWNER_CANDIDATES_SQL,[schema.issuerId,snapshot.context.version>=160000?'SET':'MEMBER'])).rows.map(row=>row.id) : [];
  const dependencyCount = Number(dependencies[0]?.total || 0);
  if (![Number(objects[0]?.total || 0),dependencyCount].every(Number.isSafeInteger)) fail('pg_schema_metadata_unknown');
  return { schema, privileges: acl, ownerCandidates, objects, objectCount: Number(objects[0]?.total || 0), dependencies, dependencyCount, dependenciesTruncated: dependencyCount > dependencies.length,
    fingerprint: hash([schema.fingerprint,acl.fingerprint,ownerCandidates,objects,dependencies]), fetchedAt: snapshot.fetchedAt };
}
function newName(value, context) {
  if (typeof value !== 'string' || !value || value !== value.trim() || [...value].some(char=>char.charCodeAt(0)<32 || char.charCodeAt(0)===127) || Buffer.byteLength(value) > context.maxIdentifierLength || value.startsWith('pg_')) fail('pg_schema_invalid_name');
  return value;
}
async function plan(query,input,options) {
  if (!input || !['create','rename','owner','drop'].includes(input.action)) fail('pg_schema_invalid_request');
  const snapshot = await listSchemas(query,options), ctx = snapshot.context;
  if (ctx.readonly) fail('pg_schema_readonly');
  const name = ['create','rename'].includes(input.action) ? newName(input.newName,ctx) : '';
  if (name && snapshot.schemas.some(row => row.name === name)) fail('pg_schema_name_exists');
  let detail = null, selected = null, issuer = null, owner = null, sql;
  if (input.action === 'create') {
    if (!ctx.canCreate) fail('pg_schema_permission');
    owner = snapshot.principals.find(role => role.id === (input.ownerId || ctx.userId) && role.settable && role.id !== '0');
    if (!owner) fail('pg_schema_permission');
    issuer = snapshot.principals.find(role => role.id === ctx.userId);
    sql = `CREATE SCHEMA ${quote(name)} AUTHORIZATION ${quote(owner.name)}`;
  } else {
    selected = find(snapshot,input.target);
    detail = await readDetail(query,input.target,options);
    if (typeof input.expected !== 'string' || input.expected !== detail.fingerprint) fail('pg_schema_conflict');
    if (selected.protected) fail('pg_schema_protected');
    issuer = snapshot.principals.find(role => role.id === selected.issuerId);
    if (!issuer) fail('pg_schema_permission');
    if (input.action === 'rename') {
      if (!selected.canRename) fail('pg_schema_permission');
      sql = `ALTER SCHEMA ${quote(selected.name)} RENAME TO ${quote(name)}`;
    } else if (input.action === 'owner') {
      owner = snapshot.principals.find(role => role.id === input.ownerId && detail.ownerCandidates.includes(role.id) && role.id !== '0');
      if (!selected.canChangeOwner || !owner) fail('pg_schema_permission');
      if (owner.id === selected.ownerId) fail('pg_schema_no_changes');
      sql = `ALTER SCHEMA ${quote(selected.name)} OWNER TO ${quote(owner.name)}`;
    } else {
      if (!selected.canDrop || typeof input.cascade !== 'boolean') fail('pg_schema_permission');
      if (input.cascade && (detail.dependenciesTruncated || detail.dependencies.some(row => row.schema && SYSTEM(row.schema)))) fail('pg_schema_dependencies_unknown');
      if (!input.cascade && detail.objectCount > 0) fail('pg_schema_not_empty');
      sql = `DROP SCHEMA ${quote(selected.name)} ${input.cascade ? 'CASCADE' : 'RESTRICT'}`;
    }
  }
  if (!issuer) fail('pg_schema_permission');
  const request = { action: input.action, ...(selected ? { target: { oid: selected.oid,identity: selected.identity,name: selected.name },expected: input.expected } : {}), ...(name ? { newName: name } : {}), ...(owner ? { ownerId: owner.id } : {}), ...(input.action === 'drop' ? { cascade: input.cascade } : {}) };
  return { request,sql,issuer,detail,snapshot };
}
function createSchemaManager() {
  const reviews = new Map();
  return { list:listSchemas,detail:readDetail,
    async review(query,input,options) {
      const result = await plan(query,input,options);
      for (const [key,entry] of reviews) if (Date.now()-entry.time>300000) reviews.delete(key);
      if (reviews.size>=100) reviews.delete(reviews.keys().next().value);
      const token = randomBytes(24).toString('hex');
      // Observation timestamps are deliberately excluded from the comparison.
      const signature = hash([result.request,result.sql,result.issuer,result.detail?.fingerprint || null,result.snapshot.schemas,result.snapshot.principals,result.snapshot.context]);
      reviews.set(token,{signature,scope:options.connectionId,time:Date.now()});
      return { request:result.request,sql:result.sql,issuer:result.issuer,detail:result.detail,token };
    },
    async execute(query,input,options) {
      const entry = reviews.get(input?.token);
      if (!entry || entry.scope!==options.connectionId || Date.now()-entry.time>300000) fail('pg_schema_review_expired');
      const result = await plan(query,input,options);
      const signature = hash([result.request,result.sql,result.issuer,result.detail?.fingerprint || null,result.snapshot.schemas,result.snapshot.principals,result.snapshot.context]);
      if (signature!==entry.signature) fail('pg_schema_conflict');
      if (input.action==='drop' && input.confirmName!==result.request.target.name) fail('pg_schema_confirmation_mismatch');
      reviews.delete(input.token);
      await query(`SET LOCAL ROLE ${quote(result.issuer.name)}`); await query(result.sql); await query(`SET LOCAL ROLE ${quote(result.snapshot.context.user)}`);
      const snapshot = await listSchemas(query,options);
      const selected = input.action==='create' ? snapshot.schemas.find(row=>row.name===result.request.newName) : snapshot.schemas.find(row=>row.oid===result.request.target.oid);
      if (input.action==='drop' ? Boolean(selected) : !selected || selected.name!==(result.request.newName || result.request.target?.name) || selected.ownerId!==(result.request.ownerId || result.detail?.schema.ownerId)) fail('pg_schema_not_applied');
      if (selected && !snapshot.principals.some(role=>role.id===selected.ownerId && role.name===(result.snapshot.principals.find(role=>role.id===selected.ownerId)?.name))) fail('pg_schema_conflict');
      return { snapshot,selectedOid:selected?.oid || null,applied:true,change:{ action:input.action,oid:selected?.oid || result.request.target.oid,oldName:result.request.target?.name || null,newName:selected?.name || null } };
    }
  };
}
function safeError(error) {
  const inherited = privileges.safeError(error);
  return { ...inherited,error:/^pg_schema_[a-z_]+$/.test(error?.message || '') ? error.message : inherited.error==='pg_priv_operation_failed'?'pg_schema_operation_failed':inherited.error };
}
module.exports = { createSchemaManager,listSchemas,readDetail,SCHEMAS_SQL,DATABASE_SQL,OWNER_SQL,OBJECTS_SQL,DEPENDENCIES_SQL,OWNER_CANDIDATES_SQL,safeError };
