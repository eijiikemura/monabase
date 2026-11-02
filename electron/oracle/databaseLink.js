// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const { scanSql } = require('../services/sqlTokens');
const fail = key => { const error = new Error(key); error.publicKey = key; throw error; };
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const hasControl = value => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const unsafeHost = value => [...value].some(char => { const n = char.charCodeAt(0); return n === 127 || n < 32 && ![9, 10, 13].includes(n); });
const literal = value => "'" + value.replaceAll("'", "''") + "'";
function linkName(value) {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z][A-Za-z0-9_$#]*(?:[.@][A-Za-z0-9_$#]+)*$/.test(value)) fail('dblink_invalid_name');
  return value.toUpperCase();
}
function userName(value, original = '') {
  if (typeof value !== 'string' || !value.trim()) fail('dblink_invalid_user');
  const text = value.trim();
  const quoted = text.startsWith('"') && text.endsWith('"');
  const name = quoted ? text.slice(1, -1) : text === original ? text : text.toUpperCase();
  if (!name || Buffer.byteLength(name, 'utf8') > 128 || (name.includes('"') || hasControl(name)) || !quoted && text !== original && !/^[\p{L}][\p{L}\p{N}_$#]*$/u.test(text)) fail('dblink_invalid_user');
  return name;
}
function checkedForm(form, original) {
  if (!form || typeof form.isPublic !== 'boolean' || typeof form.host !== 'string' || !form.host.trim() || unsafeHost(form.host) || Buffer.byteLength(form.host, 'utf8') > 4000) fail('dblink_invalid_host');
  if (typeof form.password !== 'string' || (form.password.includes('"') || hasControl(form.password)) || Buffer.byteLength(form.password, 'utf8') > 128) fail('dblink_invalid_password');
  return { name: linkName(form.name), username: userName(form.username, original?.username), password: form.password, host: form.host.trim(), isPublic: form.isPublic };
}
function createSql(form, masked = false) {
  return `CREATE ${form.isPublic ? 'PUBLIC ' : ''}DATABASE LINK ${linkName(form.name)}\nCONNECT TO ${quote(form.username)} IDENTIFIED BY ${quote(masked ? '********' : form.password)}\nUSING ${literal(form.host)}`;
}
function safeError(error) {
  // Driver messages can echo SQL/credentials. Return only controlled keys and error codes.
  const code = String(error?.code || error?.message?.match(/\b(?:ORA|NJS|DPI)-\d+\b/)?.[0] || '');
  return { error: typeof error?.publicKey === 'string' && /^dblink_[a-z_]+$/.test(error.publicKey) ? error.publicKey : 'dblink_operation_failed',
    errorCode: /^(?:ORA|NJS|DPI)-\d+$/.test(code) ? code : '', phase: error?.phase || undefined };
}
async function context(query, readonly = false) {
  const identity = (await query("SELECT SYS_CONTEXT('USERENV', 'SESSION_USER') AS LINK_USER, SYS_CONTEXT('USERENV', 'DB_DOMAIN') AS LINK_DOMAIN FROM DUAL", {})).rows[0];
  if (!identity?.LINK_USER) fail('dblink_load_failed');
  const privileges = new Set((await query('SELECT PRIVILEGE FROM SESSION_PRIVS', {})).rows.map(row => row.PRIVILEGE));
  return { user: identity.LINK_USER, domain: identity.LINK_DOMAIN || '', readonly,
    createPrivate: privileges.has('CREATE DATABASE LINK'), createPublic: privileges.has('CREATE PUBLIC DATABASE LINK'),
    alterPrivate: privileges.has('ALTER DATABASE LINK'), alterPublic: privileges.has('ALTER PUBLIC DATABASE LINK'), dropPublic: privileges.has('DROP PUBLIC DATABASE LINK') };
}
const effectiveName = (name, ctx) => name.includes('.') || !ctx.domain ? name : name + '.' + ctx.domain.toUpperCase();
async function readLink(query, schema, name) {
  if (typeof schema !== 'string' || !schema || hasControl(schema)) fail('dblink_invalid_owner');
  const rows = (await query("SELECT OWNER, DB_LINK, USERNAME, HOST, TO_CHAR(CREATED, 'YYYY-MM-DD HH24:MI:SS') AS CREATED_TEXT FROM ALL_DB_LINKS WHERE OWNER = :owner AND DB_LINK = :name", { owner: schema, name: linkName(name) })).rows;
  if (!rows.length) return null;
  if (rows.length !== 1) fail('dblink_load_failed');
  const r = rows[0];
  let native = '', auth = 'unknown';
  try {
    native = (await query("SELECT DBMS_METADATA.GET_DDL('DB_LINK', :name, :owner) AS DDL FROM DUAL", { name: r.DB_LINK, owner: r.OWNER })).rows[0]?.DDL;
    if (typeof native !== 'string' || !native.trim()) native = '';
    const words = scanSql(native, 'oracle').filter(token => token.kind === 'word').map(token => token.text.toUpperCase());
    // Oracle can omit the entire CONNECT clause from GET_DDL. Never mistake shared/credential links for ordinary fixed-user links.
    if (words[0] === 'CREATE' && words.includes('DATABASE') && words.includes('LINK') && !words.includes('SHARED') && !words.includes('AUTHENTICATED') && !words.includes('WITH')) {
      if (words.includes('CURRENT_USER')) auth = 'current';
      else if (typeof r.USERNAME === 'string' && r.USERNAME && r.USERNAME !== 'CURRENT_USER') auth = 'fixed';
      // A missing username does not reliably distinguish connected-user from current-user links.
    }
  } catch { /* Metadata visibility must not become guessed editable defaults. */ }
  const form = { name: r.DB_LINK, username: r.USERNAME || '', host: r.HOST || '', isPublic: r.OWNER === 'PUBLIC' };
  return { schema: r.OWNER, name: r.DB_LINK, username: form.username, host: form.host, created: r.CREATED_TEXT || '', auth, editable: auth === 'fixed',
    fingerprint: createHash('sha256').update(JSON.stringify([r.OWNER, r.DB_LINK, r.USERNAME, r.HOST, r.CREATED_TEXT, native])).digest('hex'),
    source: auth === 'fixed' ? createSql(form, true) + ';' : `-- Connection credentials and unsupported authentication details are omitted.\n-- ${r.OWNER}.${r.DB_LINK}` };
}
async function getLink(query, request, readonly = false) {
  const ctx = await context(query, readonly);
  if (!request || typeof request.name !== 'string') fail('dblink_invalid_name');
  return { context: ctx, link: request.name ? await readLink(query, request.schema, request.name) : null };
}
async function saveLink(query, request, readonly = false) {
  if (readonly) fail('dblink_readonly');
  if (!request || !['create', 'save', 'drop'].includes(request.action)) fail('dblink_invalid_request');
  // Validate the complete candidate before any DROP or even metadata request.
  const preliminary = request.action === 'drop' ? null : checkedForm(request.form);
  const ctx = await context(query, readonly);
  const isNew = request.action === 'create';
  const name = isNew ? effectiveName(preliminary.name, ctx) : linkName(request.name);
  const owner = isNew ? preliminary.isPublic ? 'PUBLIC' : ctx.user : request.schema;
  if (request.schema !== owner || owner !== ctx.user && owner !== 'PUBLIC') fail('dblink_owner_restricted');
  const current = await readLink(query, owner, name);
  if (isNew && current) fail('dblink_exists');
  if (!isNew && (!current || request.expected !== current.fingerprint)) fail('dblink_conflict');
  if (!isNew && !current.editable) fail('dblink_unsupported');
  const isPublic = owner === 'PUBLIC';
  if (request.action === 'drop') {
    if (isPublic && !ctx.dropPublic) fail('dblink_privilege');
    await query(`DROP ${isPublic ? 'PUBLIC ' : ''}DATABASE LINK ${name}`, {});
    return { phase: 'dropped', link: null, context: ctx };
  }
  const form = checkedForm(request.form, current);
  if (effectiveName(form.name, ctx) !== name || form.isPublic !== isPublic) fail('dblink_identity_fixed');
  const recreate = !isNew && (form.username !== current.username || form.host !== current.host);
  if (!isNew && !recreate && !form.password) return { phase: 'unchanged', link: current, context: ctx };
  if (!form.password) fail('dblink_password_required');
  if ((isNew || recreate) && !(isPublic ? ctx.createPublic : ctx.createPrivate)) fail('dblink_privilege');
  if (recreate && (!request.confirmRecreate || isPublic && !ctx.dropPublic)) fail('dblink_recreate_required');
  if (!isNew && !recreate && !(isPublic ? ctx.alterPublic : ctx.alterPrivate)) fail('dblink_privilege');
  let phase;
  if (recreate) { await query(`DROP ${isPublic ? 'PUBLIC ' : ''}DATABASE LINK ${name}`, {}); phase = 'dropped-only'; }
  try {
    if (isNew || recreate) { await query(createSql({ ...form, name }), {}); phase = isNew ? 'created' : 'recreated'; }
    else { await query(`ALTER ${isPublic ? 'PUBLIC ' : ''}DATABASE LINK ${name} CONNECT TO ${quote(form.username)} IDENTIFIED BY ${quote(form.password)}`, {}); phase = 'altered'; }
    const link = await readLink(query, owner, name);
    if (!link) fail('dblink_load_failed');
    return { phase, link, context: ctx };
  } catch (error) { error.phase = phase; throw error; }
}
async function testLink(query, request) {
  const { context: ctx, link } = await getLink(query, request);
  if (!link || link.fingerprint !== request.expected) fail('dblink_conflict');
  if (link.schema !== ctx.user && link.schema !== 'PUBLIC') fail('dblink_owner_restricted');
  if (link.schema === 'PUBLIC' && await readLink(query, ctx.user, link.name)) fail('dblink_shadowed');
  const started = Date.now();
  const result = await query(`SELECT 1 AS LINK_OK FROM DUAL@${linkName(link.name)}`, {});
  if (Number(result.rows[0]?.LINK_OK) !== 1) fail('dblink_test_failed');
  return { elapsedMs: Date.now() - started };
}
module.exports = { linkName, userName, checkedForm, createSql, safeError, context, getLink, saveLink, testLink };
