// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash, randomBytes } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = key => { throw new Error(key); };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const TYPES = ['SCHEMA', 'TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE'];
const KNOWN_PRIVILEGES = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'USAGE', 'EXECUTE', 'CREATE']);
const CONTEXT_SQL = `SELECT current_database() AS database, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_id,
 current_user AS username, (SELECT oid::text FROM pg_roles WHERE rolname=current_user) AS user_id,
 current_setting('server_version_num')::integer AS version`;
async function context(query, options = {}) {
  const row = (await query(CONTEXT_SQL)).rows[0];
  if (!row?.database_id || !row.user_id || row.version < 110000) fail('pg_priv_context_unknown');
  return { database: row.database, databaseId: row.database_id, user: row.username, userId: row.user_id, readonly: Boolean(options.readonly), version: row.version };
}
function roleSql(version) {
  return `SELECT oid::text AS id, rolname AS name, rolcanlogin AS login, rolsuper AS superuser,
 pg_has_role(current_user,oid,'USAGE') AS usable, pg_has_role(current_user,oid,'${version >= 160000 ? 'SET' : 'MEMBER'}') AS settable FROM pg_roles ORDER BY rolname`;
}
async function principals(query, options) {
  const ctx = await context(query, options), roles = (await query(roleSql(ctx.version))).rows;
  return { context: ctx, principals: [{ id: '0', name: 'PUBLIC', login: false, superuser: false, usable: false, settable: false, kind: 'public' }, ...roles.map(row => ({ ...row, kind: row.login ? 'user' : 'role' }))] };
}
function target(input) {
  if (!input || !TYPES.includes(input.type) || !/^\d+$/.test(input.oid) || typeof input.schema !== 'string' || !input.schema || typeof input.name !== 'string' || !input.name || typeof input.databaseId !== 'string' || typeof input.identity !== 'string') fail('pg_priv_invalid_target');
  return { type: input.type, oid: input.oid, schema: input.schema, name: input.name, databaseId: input.databaseId, identity: input.identity };
}
function objectSql(type, filter) {
  if (type === 'SCHEMA') return `SELECT p.oid::text AS oid, p.nspname AS schema, p.nspname AS name, p.nspowner::text AS owner_id, p.xmin::text AS revision,
 ''::text AS args, format('%I',p.nspname) AS sql_name, p.nspacl AS acl, p.nspacl IS NULL AS default_acl,
 'n'::text AS acl_type, p.oid::text AS namespace_id, (left(p.nspname,3)='pg_' OR p.nspname='information_schema' OR EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_namespace'::regclass AND d.objid=p.oid AND d.deptype='e')) AS protected FROM pg_namespace p WHERE ${filter.replaceAll('n.nspname', 'p.nspname')}`;
  const routine = ['FUNCTION', 'PROCEDURE'].includes(type);
  const fields = routine ? `p.oid::text AS oid, n.nspname AS schema, p.proname AS name, p.proowner::text AS owner_id, p.xmin::text AS revision,
 pg_get_function_identity_arguments(p.oid) AS args, format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) AS sql_name,
 p.proacl AS acl, p.proacl IS NULL AS default_acl, 'f'::text AS acl_type, n.oid::text AS namespace_id` :
    `p.oid::text AS oid, n.nspname AS schema, p.relname AS name, p.relowner::text AS owner_id, p.xmin::text AS revision,
 ''::text AS args, format('%I.%I',n.nspname,p.relname) AS sql_name,
 p.relacl AS acl, p.relacl IS NULL AS default_acl, '${type === 'SEQUENCE' ? 's' : 'r'}'::text AS acl_type, n.oid::text AS namespace_id`;
  const kind = routine ? `p.prokind='${type === 'FUNCTION' ? 'f' : 'p'}'` : `p.relkind IN (${({ TABLE: "'r','p','f'", VIEW: "'v'", 'MATERIALIZED VIEW': "'m'", SEQUENCE: "'S'" })[type]})`;
  return `SELECT ${fields} FROM ${routine ? 'pg_proc' : 'pg_class'} p JOIN pg_namespace n ON n.oid=p.${routine ? 'pronamespace' : 'relnamespace'} WHERE ${kind} AND ${filter}`;
}
const identity = (ctx, row, type, scope = '') => hash([scope, ctx.databaseId, type, row.oid, row.schema, row.name, row.args]);
function mapped(ctx, row, type, options) { return { type, oid: row.oid, schema: row.schema, name: row.name, databaseId: ctx.databaseId, identity: identity(ctx, row, type, options?.connectionId), args: row.args, label: type === 'SCHEMA' ? row.name : `${row.schema}.${row.name}${['FUNCTION', 'PROCEDURE'].includes(type) ? '(' + row.args + ')' : ''}` }; }
async function listObjects(query, input, options) {
  if (!input || !TYPES.includes(input.type) || typeof input.schema !== 'string' || !input.schema || typeof input.search !== 'string' || input.search.length > 500 || !Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 10000000) fail('pg_priv_invalid_target');
  const ctx = await context(query, options), routine = ['FUNCTION', 'PROCEDURE'].includes(input.type);
  const pattern = '%' + input.search.replace(/[\\%_]/g, char => '\\' + char) + '%';
  const sql = objectSql(input.type, `n.nspname=$1 AND p.${routine ? 'proname' : input.type === 'SCHEMA' ? 'nspname' : 'relname'} ILIKE $2 ESCAPE E'\\\\'`) + ` ORDER BY name, args, oid LIMIT 101 OFFSET $3`;
  const rows = (await query(sql, [input.schema, pattern, input.offset])).rows;
  return { objects: rows.slice(0, 100).map(row => mapped(ctx, row, input.type, options)), hasMore: rows.length > 100, context: ctx };
}
function aclSql(type) {
  if (type === 'SCHEMA') return `SELECT x.grantee::text AS grantee_id, x.grantor::text AS grantor_id, x.privilege_type AS privilege, x.is_grantable AS grantable
 FROM pg_namespace p CROSS JOIN LATERAL aclexplode(COALESCE(p.nspacl,acldefault('n',p.nspowner))) x WHERE p.oid=$1::oid ORDER BY x.grantee,x.grantor,x.privilege_type`;
  const routine = ['FUNCTION', 'PROCEDURE'].includes(type);
  return `SELECT x.grantee::text AS grantee_id, x.grantor::text AS grantor_id, x.privilege_type AS privilege, x.is_grantable AS grantable
 FROM ${routine ? 'pg_proc' : 'pg_class'} p CROSS JOIN LATERAL aclexplode(COALESCE(p.${routine ? 'proacl' : 'relacl'},acldefault('${routine ? 'f' : type === 'SEQUENCE' ? 's' : 'r'}',p.${routine ? 'proowner' : 'relowner'}))) x WHERE p.oid=$1::oid ORDER BY x.grantee,x.grantor,x.privilege_type`;
}
const COLUMN_SQL = `SELECT a.attname AS column, x.grantee::text AS grantee_id, x.grantor::text AS grantor_id, x.privilege_type AS privilege, x.is_grantable AS grantable
 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x WHERE a.attrelid=$1::oid AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum,x.grantee,x.grantor,x.privilege_type`;
function effectiveSql(type) {
  const fn = type === 'SCHEMA' ? 'has_schema_privilege' : ['FUNCTION', 'PROCEDURE'].includes(type) ? 'has_function_privilege' : type === 'SEQUENCE' ? 'has_sequence_privilege' : 'has_table_privilege';
  const columns = ['TABLE', 'VIEW', 'MATERIALIZED VIEW'].includes(type);
  return `SELECT r.oid::text AS principal_id, p.privilege, ${fn}(r.oid,$1::oid,p.privilege) AS effective,
 ${columns ? "CASE WHEN p.privilege IN ('SELECT','INSERT','UPDATE','REFERENCES') THEN has_any_column_privilege(r.oid,$1::oid,p.privilege) ELSE false END" : 'false'} AS column_effective,
 has_schema_privilege(r.oid,$3::oid,'USAGE') AS schema_usage,
 ARRAY(SELECT DISTINCT g.grantee_id FROM jsonb_to_recordset($4::jsonb) AS g(grantee_id text, privilege text)
 WHERE g.privilege=p.privilege AND CASE WHEN g.grantee_id='0' THEN true ELSE pg_has_role(r.oid,g.grantee_id::oid,'USAGE') END ORDER BY g.grantee_id) AS sources
 FROM pg_roles r CROSS JOIN unnest($2::text[]) AS p(privilege) ORDER BY r.oid,p.privilege`;
}
async function readPrivileges(query, input, options = {}) {
  const request = target(input), people = await principals(query, options), ctx = people.context;
  if (request.databaseId !== ctx.databaseId) fail('pg_priv_target_changed');
  const row = (await query(objectSql(request.type, 'p.oid=$1::oid'), [request.oid])).rows[0];
  if (!row || row.schema !== request.schema || row.name !== request.name || identity(ctx, row, request.type, options.connectionId) !== request.identity) fail('pg_priv_target_changed');
  const object = mapped(ctx, row, request.type, options);
  const grants = (await query(aclSql(request.type), [row.oid])).rows;
  const columnGrants = ['TABLE', 'VIEW', 'MATERIALIZED VIEW'].includes(request.type) ? (await query(COLUMN_SQL, [row.oid])).rows : [];
  const supported = (await query(`SELECT DISTINCT privilege_type AS privilege FROM aclexplode(acldefault($1::"char",$2::oid)) ORDER BY privilege_type`, [row.acl_type, row.owner_id])).rows.map(entry => entry.privilege);
  if (supported.some(value => !KNOWN_PRIVILEGES.has(value))) fail('pg_priv_metadata_unknown');
  const effective = (await query(effectiveSql(request.type), [row.oid, supported, row.namespace_id, JSON.stringify(grants)])).rows;
  const owner = people.principals.find(role => role.id === row.owner_id);
  if (!owner) fail('pg_priv_metadata_unknown');
  const usable = role => Boolean(role && role.id !== '0' && (role.settable || role.id === owner.id && role.usable));
  const grantors = Object.fromEntries(supported.map(privilege => {
    const candidates = new Set(!row.protected && usable(owner) ? [owner.id] : []);
    for (const grant of grants) if (!row.protected && grant.privilege === privilege && grant.grantable && usable(people.principals.find(role => role.id === grant.grantee_id))) candidates.add(grant.grantee_id);
    return [privilege, [...candidates].sort()];
  }));
  const normalizedGrants = grants.map(grant => ({ ...grant, source: row.default_acl ? 'default' : 'acl', canRevoke: !row.protected && usable(people.principals.find(role => role.id === grant.grantor_id)) }));
  return { object, ownerId: row.owner_id, owner: owner.name, context: ctx, principals: people.principals, grants: normalizedGrants, columnGrants, privileges: supported, effective, grantors,
    fingerprint: hash([options.connectionId, ctx, row.oid, row.revision, row.owner_id, row.args, row.protected, grants, columnGrants, people.principals, effective]), fetchedAt: new Date().toISOString() };
}
async function plan(query, input, options) {
  if (!input || !['grant', 'revoke'].includes(input.action) || typeof input.principalId !== 'string' || !KNOWN_PRIVILEGES.has(input.privilege) || typeof input.expected !== 'string') fail('pg_priv_invalid_request');
  if (['grantOption', 'grantOptionOnly'].some(key => input[key] !== undefined && typeof input[key] !== 'boolean')) fail('pg_priv_invalid_request');
  const detail = await readPrivileges(query, input.object, options);
  if (detail.context.readonly) fail('pg_priv_readonly');
  if (detail.fingerprint !== input.expected) fail('pg_priv_conflict');
  const principal = detail.principals.find(role => role.id === input.principalId);
  if (!principal) fail('pg_priv_principal_changed');
  if (input.grantOption === true && principal.id === '0') fail('pg_priv_public_option');
  if (!detail.privileges.includes(input.privilege)) fail('pg_priv_invalid_request');
  const matching = detail.grants.filter(grant => grant.grantee_id === principal.id && grant.privilege === input.privilege);
  let issuer;
  if (input.action === 'grant') issuer = (detail.grantors[input.privilege] || []).find(id => !input.grantorId || id === input.grantorId);
  else issuer = matching.find(grant => grant.canRevoke && grant.grantor_id === input.grantorId)?.grantor_id;
  if (!issuer) fail('pg_priv_permission');
  const grantor = detail.principals.find(role => role.id === issuer);
  if (!grantor) fail('pg_priv_permission');
  const executionRole = grantor.settable ? grantor : detail.principals.find(role => role.id === detail.context.userId);
  if (!executionRole) fail('pg_priv_permission');
  const existing = matching.find(grant => grant.grantor_id === issuer);
  if (input.action === 'grant' && existing && (!input.grantOption || existing.grantable) || input.action === 'revoke' && input.grantOptionOnly && !existing?.grantable) fail('pg_priv_no_changes');
  const kind = detail.object.type === 'SCHEMA' ? 'SCHEMA' : ['FUNCTION', 'PROCEDURE'].includes(detail.object.type) ? detail.object.type : detail.object.type === 'SEQUENCE' ? 'SEQUENCE' : 'TABLE';
  const sqlName = (await query(objectSql(detail.object.type, 'p.oid=$1::oid'), [detail.object.oid])).rows[0]?.sql_name;
  if (!sqlName) fail('pg_priv_target_changed');
  const destination = principal.id === '0' ? 'PUBLIC' : quote(principal.name);
  const sql = input.action === 'grant' ? `GRANT ${input.privilege} ON ${kind} ${sqlName} TO ${destination}${input.grantOption ? ' WITH GRANT OPTION' : ''}`
    : `REVOKE ${input.grantOptionOnly ? 'GRANT OPTION FOR ' : ''}${input.privilege} ON ${kind} ${sqlName} FROM ${destination} RESTRICT`;
  const request = { object: detail.object, action: input.action, principalId: principal.id, privilege: input.privilege, expected: input.expected, grantorId: issuer, grantOption: input.grantOption === true, grantOptionOnly: input.grantOptionOnly === true };
  const affectedColumns = input.action === 'revoke' ? detail.columnGrants.filter(grant => grant.grantee_id === principal.id && grant.grantor_id === issuer && grant.privilege === input.privilege && (!input.grantOptionOnly || grant.grantable)).map(grant => grant.column) : [];
  return { request, sql, grantor, issuer: executionRole, principal, detail, affectedColumns, signature: hash([request, sql, detail.fingerprint, executionRole]) };
}
function createPrivilegeManager() {
  const reviews = new Map();
  return { principals, listObjects, read: readPrivileges,
    async review(query, input, options) {
      const result = await plan(query, input, options);
      for (const [key, value] of reviews) if (Date.now() - value.time > 300000) reviews.delete(key);
      if (reviews.size >= 100) reviews.delete(reviews.keys().next().value);
      const token = randomBytes(24).toString('hex'); reviews.set(token, { signature: result.signature, scope: options.connectionId, time: Date.now() });
      return { request: result.request, sql: result.sql, grantor: result.grantor, issuer: result.issuer, principal: result.principal, detail: result.detail, affectedColumns: result.affectedColumns, token };
    },
    async mutate(query, input, options) {
      const entry = reviews.get(input?.token);
      if (!entry || entry.scope !== options.connectionId || Date.now() - entry.time > 300000) fail('pg_priv_review_expired');
      const result = await plan(query, input, options);
      if (entry.signature !== result.signature) fail('pg_priv_conflict');
      reviews.delete(input.token);
      await query(`SET LOCAL ROLE ${quote(result.issuer.name)}`);
      await query(result.sql);
      await query(`SET LOCAL ROLE ${quote(result.detail.context.user)}`);
      const detail = await readPrivileges(query, input.object, options);
      if (detail.ownerId !== result.detail.ownerId || detail.object.args !== result.detail.object.args || !detail.principals.some(role => role.id === result.principal.id && role.name === result.principal.name)) fail('pg_priv_target_changed');
      const applied = detail.grants.find(grant => grant.grantee_id === result.principal.id && grant.grantor_id === result.grantor.id && grant.privilege === input.privilege);
      if (input.action === 'grant' ? !applied || input.grantOption && !applied.grantable : input.grantOptionOnly ? applied?.grantable : Boolean(applied)) fail('pg_priv_not_applied');
      if (result.affectedColumns.some(column => detail.columnGrants.some(grant => grant.column === column && grant.grantee_id === result.principal.id && grant.grantor_id === result.grantor.id && grant.privilege === input.privilege && (!input.grantOptionOnly || grant.grantable)))) fail('pg_priv_not_applied');
      return { detail, applied: true };
    }
  };
}
function safeError(error) { return { error: error?.pgPrivUnknown ? 'pg_priv_outcome_unknown' : /^pg_priv_[a-z_]+$/.test(error?.message || '') ? error.message : 'pg_priv_operation_failed', errorCode: /^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : '', applied: error?.pgPrivApplied === true }; }
module.exports = { createPrivilegeManager, principals, listObjects, readPrivileges, CONTEXT_SQL, COLUMN_SQL, roleSql, objectSql, aclSql, effectiveSql, safeError };
