// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const fail = key => { const error = new Error(key); error.publicKey = key; throw error; };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const control = value => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
function exactName(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('"') || control(value) || Buffer.byteLength(value, 'utf8') > 128) fail('directory_invalid_name');
  return value;
}
function pathName(value) {
  if (typeof value !== 'string' || !value.trim() || control(value) || Buffer.byteLength(value, 'utf8') > 4000 || value.split(/[\\/]/).includes('..')) fail('directory_invalid_path');
  return value;
}
function accessError(error) { return ['ORA-00942', 'ORA-01031'].includes(error.code) || [942, 1031].includes(error.errorNum); }
async function catalog(query, full, visible, binds = {}) {
  try { return { rows: (await query(full, binds)).rows, scope: 'all' }; }
  catch (error) { if (!accessError(error)) throw error; }
  return { rows: (await query(visible, binds)).rows, scope: 'visible' };
}
async function readContext(query, readonly = false) {
  const user = (await query("SELECT SYS_CONTEXT('USERENV', 'SESSION_USER') AS DIRECTORY_USER FROM DUAL", {})).rows[0]?.DIRECTORY_USER;
  if (!user) fail('directory_load_failed');
  const privileges = new Set((await query('SELECT PRIVILEGE FROM SESSION_PRIVS', {})).rows.map(row => row.PRIVILEGE));
  const roles = (await query('SELECT ROLE FROM SESSION_ROLES', {})).rows.map(row => row.ROLE);
  return { user, readonly, canCreate: !readonly && privileges.has('CREATE ANY DIRECTORY'), canDrop: !readonly && privileges.has('DROP ANY DIRECTORY'), grantAny: !readonly && privileges.has('GRANT ANY OBJECT PRIVILEGE'), roles };
}
const directorySql = (full, where = '') => `SELECT d.OWNER, d.DIRECTORY_NAME, d.DIRECTORY_PATH, TO_CHAR(o.OBJECT_ID) AS DIRECTORY_ID,
  TO_CHAR(o.LAST_DDL_TIME, 'YYYY-MM-DD HH24:MI:SS') AS DDL_TIME FROM ${full ? 'DBA' : 'ALL'}_DIRECTORIES d
  LEFT JOIN ${full ? 'DBA' : 'ALL'}_OBJECTS o ON o.OWNER = d.OWNER AND o.OBJECT_NAME = d.DIRECTORY_NAME AND o.OBJECT_TYPE = 'DIRECTORY'
  ${where} ORDER BY d.DIRECTORY_NAME`;
const definition = row => ({ name: row.DIRECTORY_NAME, path: row.DIRECTORY_PATH, owner: row.OWNER, objectId: row.DIRECTORY_ID == null ? null : String(row.DIRECTORY_ID), ddlTime: row.DDL_TIME || '' });
async function listDirectories(query, readonly = false) {
  const context = await readContext(query, readonly);
  const result = await catalog(query, directorySql(true), directorySql(false));
  const users = (await query('SELECT USERNAME AS NAME, ORACLE_MAINTAINED FROM ALL_USERS ORDER BY USERNAME', {})).rows;
  const roles = await catalog(query, 'SELECT ROLE AS NAME, ORACLE_MAINTAINED FROM DBA_ROLES ORDER BY ROLE', "SELECT GRANTED_ROLE AS NAME, 'N' AS ORACLE_MAINTAINED FROM USER_ROLE_PRIVS ORDER BY GRANTED_ROLE");
  return { context, directories: result.rows.map(definition), scope: result.scope, rolesComplete: roles.scope === 'all',
    principals: [{ name: 'PUBLIC', kind: 'public', maintained: false }, ...users.map(row => ({ name: row.NAME, kind: 'user', maintained: row.ORACLE_MAINTAINED === 'Y' })), ...roles.rows.map(row => ({ name: row.NAME, kind: 'role', maintained: row.ORACLE_MAINTAINED === 'Y' }))] };
}
async function readDirectory(query, name, readonly = false) {
  exactName(name);
  const context = await readContext(query, readonly);
  const result = await catalog(query, directorySql(true, 'WHERE d.DIRECTORY_NAME = :name'), directorySql(false, 'WHERE d.DIRECTORY_NAME = :name'), { name });
  if (result.rows.length !== 1) fail('directory_missing');
  const directory = definition(result.rows[0]);
  const grantSql = (full) => `SELECT GRANTEE, GRANTOR, PRIVILEGE, GRANTABLE FROM ${full ? 'DBA' : 'ALL'}_TAB_PRIVS
    WHERE ${full ? 'OWNER' : 'TABLE_SCHEMA'} = :owner AND TABLE_NAME = :name AND TYPE = 'DIRECTORY'
    AND PRIVILEGE IN ('READ', 'WRITE', 'EXECUTE') ORDER BY GRANTEE, GRANTOR, PRIVILEGE, GRANTABLE`;
  const privileges = await catalog(query, grantSql(true), grantSql(false), { owner: directory.owner, name });
  const grants = privileges.rows.map(row => ({ grantee: row.GRANTEE, grantor: row.GRANTOR, privilege: row.PRIVILEGE, grantable: row.GRANTABLE === 'YES',
    canRevoke: !readonly && (row.GRANTOR === context.user || context.user === 'SYS') && ['READ', 'WRITE'].includes(row.PRIVILEGE) }));
  const protectedTargets = new Set(grants.filter(grant => !grant.canRevoke).map(grant => JSON.stringify([grant.grantee, grant.privilege])));
  for (const grant of grants) if (protectedTargets.has(JSON.stringify([grant.grantee, grant.privilege]))) grant.canRevoke = false;
  const canGrant = privilege => !readonly && (context.grantAny || grants.some(grant => grant.grantee === context.user && grant.privilege === privilege && grant.grantable));
  const signature = [directory, privileges.scope, grants.map(({ grantee, grantor, privilege, grantable }) => [grantee, grantor, privilege, grantable]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))];
  return { directory, context, grants, scope: privileges.scope, canGrant: { READ: canGrant('READ'), WRITE: canGrant('WRITE') },
    sessionGrants: grants.filter(grant => grant.grantee === context.user || grant.grantee === 'PUBLIC' || context.roles.includes(grant.grantee)),
    fingerprint: createHash('sha256').update(JSON.stringify(signature)).digest('hex') };
}
async function mutateDirectory(query, request, readonly = false) {
  if (readonly) fail('directory_readonly');
  if (!request || !['create', 'replace', 'drop', 'grant', 'revoke'].includes(request.action)) fail('directory_invalid_request');
  const name = exactName(request.name);
  if (['create', 'replace'].includes(request.action)) pathName(request.path);
  if (['grant', 'revoke'].includes(request.action)) { exactName(request.grantee); if (!['READ', 'WRITE'].includes(request.privilege)) fail('directory_invalid_privilege'); }
  const context = await readContext(query, readonly);
  let current;
  if (request.action === 'create') {
    if (!context.canCreate) fail('directory_permission');
    const existing = await catalog(query, directorySql(true, 'WHERE d.DIRECTORY_NAME = :name'), directorySql(false, 'WHERE d.DIRECTORY_NAME = :name'), { name });
    if (existing.rows.length) fail('directory_exists');
  } else {
    current = await readDirectory(query, name, readonly);
    if (!current.directory.objectId || request.expected !== current.fingerprint) fail('directory_conflict');
  }
  let statement;
  switch (request.action) {
    case 'create': statement = `CREATE DIRECTORY ${quote(name)} AS '${request.path.replaceAll("'", "''")}'`; break;
    case 'replace':
      if (!context.canCreate) fail('directory_permission');
      if (request.path === current.directory.path) return { detail: current, applied: false };
      statement = `CREATE OR REPLACE DIRECTORY ${quote(name)} AS '${request.path.replaceAll("'", "''")}'`; break;
    case 'drop':
      if (!context.canDrop) fail('directory_permission');
      statement = `DROP DIRECTORY ${quote(name)}`; break;
    case 'grant': {
      const existing = current.grants.filter(row => row.grantee === request.grantee && row.privilege === request.privilege);
      if (existing.length) return { detail: current, applied: false };
      if (!current.canGrant[request.privilege]) fail('directory_permission');
      const principals = await listDirectories(query, readonly);
      if (!principals.principals.some(principal => principal.name === request.grantee)) fail('directory_unknown_grantee');
      statement = `GRANT ${request.privilege} ON DIRECTORY ${quote(name)} TO ${request.grantee === 'PUBLIC' ? 'PUBLIC' : quote(request.grantee)}`;
      break;
    }
    case 'revoke': {
      const matching = current.grants.filter(row => row.grantee === request.grantee && row.privilege === request.privilege);
      if (!matching.length) return { detail: current, applied: false };
      // An aggregate checkbox must never imply another grantor's privilege can be revoked.
      if (matching.some(row => !row.canRevoke)) fail('directory_revoke_restricted');
      statement = `REVOKE ${request.privilege} ON DIRECTORY ${quote(name)} FROM ${request.grantee === 'PUBLIC' ? 'PUBLIC' : quote(request.grantee)}`;
      break;
    }
  }
  await query(statement, {});
  try { return { detail: request.action === 'drop' ? null : await readDirectory(query, name, readonly), applied: true }; }
  catch (error) { error.applied = true; throw error; }
}
function safeDirectoryError(error) {
  const code = String(error?.code || error?.message?.match(/\b(?:ORA|NJS|DPI)-\d+\b/)?.[0] || '');
  return { error: /^directory_[a-z_]+$/.test(error?.publicKey || '') ? error.publicKey : 'directory_operation_failed', errorCode: /^(?:ORA|NJS|DPI)-\d+$/.test(code) ? code : '', applied: error?.applied === true };
}
module.exports = { exactName, pathName, readContext, listDirectories, readDirectory, mutateDirectory, safeDirectoryError };
