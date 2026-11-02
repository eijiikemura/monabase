// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const definitions = {
  TABLE: ['ALTER', 'DELETE', 'INDEX', 'INSERT', 'REFERENCES', 'SELECT', 'UPDATE', 'DEBUG'],
  VIEW: ['DELETE', 'INSERT', 'SELECT', 'UPDATE', 'REFERENCES', 'DEBUG'],
  'MATERIALIZED VIEW': ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  SEQUENCE: ['ALTER', 'SELECT'], FUNCTION: ['EXECUTE', 'DEBUG'], PROCEDURE: ['EXECUTE', 'DEBUG'], PACKAGE: ['EXECUTE', 'DEBUG'], TYPE: ['EXECUTE', 'DEBUG']
};
const fail = key => { throw Object.assign(new Error(key), { publicKey: key }); };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function name(value) {
  if (typeof value !== 'string' || !value.trim() || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || Buffer.byteLength(value) > 128) fail('object_priv_invalid');
  return value;
}
function identity(target) {
  if (!target || !Object.hasOwn(definitions, target.type)) fail('object_priv_invalid');
  return { owner: name(target.owner), name: name(target.name), type: target.type };
}
async function catalog(query, full, visible, binds = {}) {
  try { return { rows: (await query(full, binds)).rows, scope: 'all' }; }
  catch (error) { if (![942, 1031].includes(error.errorNum) && !['ORA-00942', 'ORA-01031'].includes(error.code)) throw error; }
  return { rows: (await query(visible, binds)).rows, scope: 'visible' };
}
async function context(query, readonly) {
  const user = (await query("SELECT SYS_CONTEXT('USERENV', 'SESSION_USER') AS PRIV_USER FROM DUAL", {})).rows[0]?.PRIV_USER;
  if (!user) fail('object_priv_load_failed');
  const privs = (await query('SELECT PRIVILEGE FROM SESSION_PRIVS', {})).rows;
  return { user, readonly, grantAny: !readonly && privs.some(row => row.PRIVILEGE === 'GRANT ANY OBJECT PRIVILEGE') };
}
async function listPrincipals(query) {
  const users = (await query('SELECT USERNAME AS NAME, ORACLE_MAINTAINED FROM ALL_USERS ORDER BY USERNAME', {})).rows;
  const roles = await catalog(query, 'SELECT ROLE AS NAME, ORACLE_MAINTAINED FROM DBA_ROLES ORDER BY ROLE', "SELECT GRANTED_ROLE AS NAME, 'N' AS ORACLE_MAINTAINED FROM USER_ROLE_PRIVS ORDER BY GRANTED_ROLE");
  return { rolesComplete: roles.scope === 'all', principals: [{ name: 'PUBLIC', kind: 'public', maintained: false },
    ...users.map(row => ({ name: row.NAME, kind: 'user', maintained: row.ORACLE_MAINTAINED === 'Y' })),
    ...roles.rows.map(row => ({ name: row.NAME, kind: 'role', maintained: row.ORACLE_MAINTAINED === 'Y' }))] };
}
async function readPrivileges(query, target, readonly = false) {
  const object = identity(target), ctx = await context(query, readonly);
  const objects = await catalog(query,
    "SELECT TO_CHAR(OBJECT_ID) AS ID, TO_CHAR(LAST_DDL_TIME, 'YYYY-MM-DD HH24:MI:SS') AS DDL_TIME FROM DBA_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE = :type",
    "SELECT TO_CHAR(OBJECT_ID) AS ID, TO_CHAR(LAST_DDL_TIME, 'YYYY-MM-DD HH24:MI:SS') AS DDL_TIME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE = :type", object);
  if (objects.rows.length !== 1 || !objects.rows[0].ID) fail('object_priv_missing');
  const grantsSql = full => `SELECT GRANTEE, GRANTOR, PRIVILEGE, GRANTABLE, HIERARCHY, COMMON, INHERITED FROM ${full ? 'DBA' : 'ALL'}_TAB_PRIVS WHERE ${full ? 'OWNER' : 'TABLE_SCHEMA'} = :owner AND TABLE_NAME = :name AND TYPE = :type ORDER BY GRANTEE, GRANTOR, PRIVILEGE`;
  const grants = await catalog(query, grantsSql(true), grantsSql(false), object);
  let columns = { rows: [], scope: 'all' };
  if (['TABLE', 'VIEW', 'MATERIALIZED VIEW'].includes(object.type)) columns = await catalog(query,
    'SELECT GRANTEE, GRANTOR, COLUMN_NAME, PRIVILEGE, GRANTABLE FROM DBA_COL_PRIVS WHERE OWNER = :owner AND TABLE_NAME = :name ORDER BY GRANTEE, GRANTOR, COLUMN_NAME, PRIVILEGE',
    'SELECT GRANTEE, GRANTOR, COLUMN_NAME, PRIVILEGE, GRANTABLE FROM ALL_COL_PRIVS WHERE TABLE_SCHEMA = :owner AND TABLE_NAME = :name ORDER BY GRANTEE, GRANTOR, COLUMN_NAME, PRIVILEGE', { owner: object.owner, name: object.name });
  const scope = [objects.scope, grants.scope, columns.scope].includes('visible') ? 'visible' : 'all';
  const rows = grants.rows.map(row => ({ grantee: row.GRANTEE, grantor: row.GRANTOR, privilege: row.PRIVILEGE, grantable: row.GRANTABLE === 'YES', hierarchy: row.HIERARCHY === 'YES', common: row.COMMON === 'YES', inherited: row.INHERITED === 'YES',
    canRevoke: !readonly && row.GRANTOR === ctx.user && row.COMMON !== 'YES' && row.INHERITED !== 'YES' }));
  const columnGrants = columns.rows.map(row => ({ grantee: row.GRANTEE, grantor: row.GRANTOR, column: row.COLUMN_NAME, privilege: row.PRIVILEGE, grantable: row.GRANTABLE === 'YES' }));
  let privileges = definitions[object.type];
  if (object.type === 'MATERIALIZED VIEW') {
    const metadata = await catalog(query,
      'SELECT UPDATABLE FROM DBA_MVIEWS WHERE OWNER = :owner AND MVIEW_NAME = :name',
      'SELECT UPDATABLE FROM ALL_MVIEWS WHERE OWNER = :owner AND MVIEW_NAME = :name', { owner: object.owner, name: object.name });
    // DML grants apply only to materialized views verified as updatable.
    if (metadata.rows.length !== 1 || metadata.rows[0].UPDATABLE !== 'Y') privileges = ['SELECT'];
  }
  const canGrant = Object.fromEntries(privileges.map(privilege => [privilege, !readonly && (ctx.user === object.owner || ctx.grantAny || rows.some(row => row.grantee === ctx.user && row.privilege === privilege && row.grantable && !row.inherited))]));
  const fingerprint = createHash('sha256').update(JSON.stringify([object, objects.rows, scope, grants.rows, columns.rows])).digest('hex');
  return { object, context: ctx, grants: rows, columnGrants, privileges, canGrant, scope, fingerprint };
}
async function mutatePrivileges(query, request, readonly = false) {
  if (readonly) fail('object_priv_readonly');
  if (!request || !['grant', 'revoke'].includes(request.action)) fail('object_priv_invalid');
  const target = identity(request.object), grantee = name(request.grantee), privilege = request.privilege;
  if (!definitions[target.type].includes(privilege)) fail('object_priv_invalid');
  const current = await readPrivileges(query, target, readonly);
  if (!current.privileges.includes(privilege)) fail('object_priv_restricted');
  if (request.expected !== current.fingerprint) fail('object_priv_conflict');
  if (grantee === target.owner) fail('object_priv_restricted');
  const matching = current.grants.filter(row => row.grantee === grantee && row.privilege === privilege);
  const columnMatch = current.columnGrants.some(row => row.grantee === grantee && row.privilege === privilege);
  if (columnMatch) fail('object_priv_restricted');
  if (request.action === 'grant') {
    if (!current.canGrant[privilege]) fail('object_priv_restricted');
    if (matching.length) return { detail: current, applied: false };
    const list = await listPrincipals(query);
    const recipient = list.principals.find(row => row.name === grantee);
    if (privilege === 'REFERENCES' && recipient?.kind !== 'user') fail('object_priv_restricted');
    if (!recipient) fail('object_priv_unknown_recipient');
  } else {
    if (!matching.length) return { detail: current, applied: false };
    if (current.scope !== 'all' && current.context.user !== target.owner || matching.some(row => !row.canRevoke || row.grantable || row.hierarchy)) fail('object_priv_restricted');
  }
  const recipient = grantee === 'PUBLIC' ? 'PUBLIC' : quote(grantee);
  const sql = request.action === 'grant' ? `GRANT ${privilege} ON ${quote(target.owner)}.${quote(target.name)} TO ${recipient}` : `REVOKE ${privilege} ON ${quote(target.owner)}.${quote(target.name)} FROM ${recipient}`;
  await query(sql, {});
  try { return { detail: await readPrivileges(query, target, readonly), applied: true }; }
  catch (error) { error.applied = true; throw error; }
}
function safeError(error) {
  const code = String(error?.code || '');
  return { error: /^object_priv_[a-z_]+$/.test(error?.publicKey || '') ? error.publicKey : 'object_priv_operation_failed', errorCode: /^(ORA|NJS|DPI)-\d+$/.test(code) ? code : '', applied: error?.applied === true };
}
module.exports = { identity, listPrincipals, readPrivileges, mutatePrivileges, safeError };
