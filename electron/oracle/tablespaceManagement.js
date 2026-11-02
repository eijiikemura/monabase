// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash, randomBytes } = require('node:crypto');
const MB = 1048576n;
const fail = key => { throw new Error(key); };
const permission = error => [942, 1031].includes(error?.errorNum) || ['ORA-00942', 'ORA-01031'].includes(error?.code);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const control = value => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
function exactName(value) {
  if (typeof value !== 'string' || !value.trim() || control(value) || value.includes('"') || Buffer.byteLength(value) > 128) fail('ts_invalid_name');
  return value;
}
function createName(value) {
  if (typeof value !== 'string') fail('ts_invalid_name');
  if (value.startsWith('"') && value.endsWith('"')) return exactName(value.slice(1, -1));
  if (!/^[A-Za-z][A-Za-z0-9_$#]*$/.test(value)) fail('ts_invalid_name');
  return exactName(value.toUpperCase());
}
function bytes(value) { if (!/^\d+$/.test(String(value))) fail('ts_invalid_metadata'); return BigInt(value); }
function mb(value) { if (value == null) return null; const amount = bytes(value); const scaled = (amount * 100n + MB / 2n) / MB; return `${scaled / 100n}.${String(scaled % 100n).padStart(2, '0')}`; }
function size(value) { if (typeof value !== 'string' || !/^[1-9]\d{0,11}$/.test(value)) fail('ts_invalid_size'); return BigInt(value) * MB; }
const IDENTITY_SQL = "SELECT SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') AS DB_NAME, SYS_CONTEXT('USERENV','CON_ID') AS CON_ID, SYS_CONTEXT('USERENV','CON_NAME') AS CON_NAME, SYS_CONTEXT('USERENV','INSTANCE') AS INSTANCE_ID FROM DUAL";
const TABLESPACE_SQL = `SELECT t.TABLESPACE_NAME, t.CONTENTS, t.STATUS, t.BIGFILE, t.BLOCK_SIZE, TO_CHAR(v.TS#) AS TS_ID
 FROM DBA_TABLESPACES t LEFT JOIN V$TABLESPACE v ON v.NAME = t.TABLESPACE_NAME AND v.CON_ID = TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID')) ORDER BY t.TABLESPACE_NAME`;
const FILE_SQL = `SELECT d.TABLESPACE_NAME, TO_CHAR(d.FILE_ID) AS FILE_ID, d.FILE_NAME, TO_CHAR(d.BYTES) AS BYTES, d.AUTOEXTENSIBLE,
 TO_CHAR(d.MAXBYTES) AS MAXBYTES, TO_CHAR(d.INCREMENT_BY * t.BLOCK_SIZE) AS NEXT_BYTES, d.ONLINE_STATUS,
 TO_CHAR(v.CREATION_CHANGE#) AS CREATION_ID, 'DATAFILE' AS KIND
 FROM DBA_DATA_FILES d JOIN DBA_TABLESPACES t ON t.TABLESPACE_NAME = d.TABLESPACE_NAME
 LEFT JOIN V$DATAFILE v ON v.FILE# = d.FILE_ID AND v.CON_ID = TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID'))
 UNION ALL SELECT d.TABLESPACE_NAME, TO_CHAR(d.FILE_ID), d.FILE_NAME, TO_CHAR(d.BYTES), d.AUTOEXTENSIBLE,
 TO_CHAR(d.MAXBYTES), TO_CHAR(d.INCREMENT_BY * t.BLOCK_SIZE), d.STATUS, TO_CHAR(v.CREATION_CHANGE#), 'TEMPFILE'
 FROM DBA_TEMP_FILES d JOIN DBA_TABLESPACES t ON t.TABLESPACE_NAME = d.TABLESPACE_NAME
 LEFT JOIN V$TEMPFILE v ON v.FILE# = d.FILE_ID AND v.CON_ID = TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID'))`;
const FREE_SQL = 'SELECT TABLESPACE_NAME, TO_CHAR(FILE_ID) AS FILE_ID, TO_CHAR(SUM(BYTES)) AS FREE_BYTES FROM DBA_FREE_SPACE GROUP BY TABLESPACE_NAME, FILE_ID';
const TEMP_SQL = 'SELECT TABLESPACE_NAME, TO_CHAR(TABLESPACE_SIZE) AS TOTAL_BYTES, TO_CHAR(FREE_SPACE) AS FREE_BYTES FROM DBA_TEMP_FREE_SPACE';
async function optional(query, sql) {
  try { return { known: true, rows: (await query(sql)).rows }; }
  catch (error) { if (!permission(error)) throw error; return { known: false, rows: [] }; }
}
async function readTablespaces(query, options = {}) {
  const row = (await query(IDENTITY_SQL)).rows?.[0];
  if (!row?.DB_NAME || row.CON_ID == null || !row.CON_NAME) fail('ts_identity_unknown');
  const privileges = new Set((await query('SELECT PRIVILEGE FROM SESSION_PRIVS')).rows.map(item => item.PRIVILEGE));
  const defaults = await optional(query, "SELECT PROPERTY_VALUE FROM DATABASE_PROPERTIES WHERE PROPERTY_NAME IN ('DEFAULT_PERMANENT_TABLESPACE', 'DEFAULT_TEMP_TABLESPACE')");
  const omf = await optional(query, "SELECT NAME, VALUE FROM V$PARAMETER WHERE NAME IN ('db_create_file_dest', 'db_block_size')");
  let rows, scope = 'all';
  try { rows = (await query(TABLESPACE_SQL)).rows; }
  catch (error) {
    if (!permission(error)) throw error;
    rows = (await query('SELECT TABLESPACE_NAME, CONTENTS, STATUS, BIGFILE, BLOCK_SIZE FROM USER_TABLESPACES ORDER BY TABLESPACE_NAME')).rows; scope = 'visible';
  }
  const files = await optional(query, FILE_SQL), free = await optional(query, FREE_SQL), temporary = await optional(query, TEMP_SQL);
  const context = { database: row.DB_NAME, container: String(row.CON_ID), containerName: row.CON_NAME, instance: String(row.INSTANCE_ID), readonly: Boolean(options.readonly), scope,
    canCreate: !options.readonly && privileges.has('CREATE TABLESPACE'), canAlter: !options.readonly && privileges.has('ALTER TABLESPACE'), canDrop: !options.readonly && privileges.has('DROP TABLESPACE'),
    omf: omf.known && Boolean(omf.rows.find(entry => entry.NAME === 'db_create_file_dest')?.VALUE), blockSize: Number(omf.rows.find(entry => entry.NAME === 'db_block_size')?.VALUE || 0), protectionReady: defaults.known && defaults.rows.length === 2 && defaults.rows.every(entry => typeof entry.PROPERTY_VALUE === 'string' && entry.PROPERTY_VALUE.length > 0) && scope === 'all' && files.known };
  const mappedFiles = files.rows.map(file => ({ id: JSON.stringify([context.database, context.container, file.KIND, file.FILE_ID, file.CREATION_ID]), fileId: String(file.FILE_ID), creationId: file.CREATION_ID == null ? null : String(file.CREATION_ID),
    tablespace: file.TABLESPACE_NAME, path: file.FILE_NAME, kind: file.KIND, bytes: String(file.BYTES), sizeMb: mb(file.BYTES), autoExtend: file.AUTOEXTENSIBLE === 'YES',
    maxBytes: file.AUTOEXTENSIBLE === 'YES' ? String(file.MAXBYTES) : null, maxMb: file.AUTOEXTENSIBLE === 'YES' ? mb(file.MAXBYTES) : null, nextBytes: String(file.NEXT_BYTES || '0'), nextMb: mb(file.NEXT_BYTES || '0'), online: ['ONLINE', 'SYSTEM', 'AVAILABLE'].includes(file.ONLINE_STATUS) }));
  const tablespaces = rows.map(item => {
    const children = mappedFiles.filter(file => file.tablespace === item.TABLESPACE_NAME);
    const known = files.known && children.length > 0;
    let total = known ? children.reduce((sum, file) => sum + bytes(file.bytes), 0n) : null, remaining = null;
    if (item.CONTENTS === 'TEMPORARY') {
      const usage = temporary.rows.filter(entry => entry.TABLESPACE_NAME === item.TABLESPACE_NAME);
      // Multiple instance/local-temp rows cannot safely be collapsed into one allocation figure.
      if (temporary.known && usage.length === 1 && item.STATUS === 'ONLINE') { total = bytes(usage[0].TOTAL_BYTES); remaining = bytes(usage[0].FREE_BYTES); }
    } else if (free.known && known && item.STATUS === 'ONLINE' && children.every(file => file.online)) {
      remaining = free.rows.filter(entry => entry.TABLESPACE_NAME === item.TABLESPACE_NAME).reduce((sum, entry) => sum + bytes(entry.FREE_BYTES), 0n);
    }
    if (total == null || remaining == null || total <= 0n || remaining > total) remaining = null;
    const used = remaining == null ? null : total - remaining;
    const limit = known ? children.reduce((sum, file) => sum + (file.autoExtend ? bytes(file.maxBytes) > bytes(file.bytes) ? bytes(file.maxBytes) : bytes(file.bytes) : bytes(file.bytes)), 0n) : null;
    const protectedTarget = !context.protectionReady || ['SYSTEM', 'SYSAUX'].includes(item.TABLESPACE_NAME) || item.CONTENTS !== 'PERMANENT';
    const dropProtected = protectedTarget || defaults.rows.some(entry => entry.PROPERTY_VALUE === item.TABLESPACE_NAME);
    const identityKnown = item.TS_ID != null && children.length > 0 && children.every(file => file.creationId != null);
    const id = JSON.stringify([context.database, context.container, item.TS_ID || null, item.TABLESPACE_NAME, children.map(file => [file.fileId, file.creationId]).sort()]);
    return { id, name: item.TABLESPACE_NAME, kind: item.CONTENTS, status: item.STATUS, bigfile: item.BIGFILE === 'YES', blockSize: Number(item.BLOCK_SIZE), protected: protectedTarget || !identityKnown, dropProtected: dropProtected || !identityKnown,
      allocatedMb: mb(total), usedMb: mb(used), freeMb: mb(remaining), maxMb: mb(limit), usedPercent: used == null ? null : Number(used * 10000n / total) / 100,
      fingerprint: hash([id, item.STATUS, item.BIGFILE, item.CONTENTS, item.BLOCK_SIZE, protectedTarget, dropProtected, children.map(file => [file.id, file.path, file.bytes, file.autoExtend, file.maxBytes, file.nextBytes]).sort()]) };
  });
  return { context, tablespaces, files: mappedFiles, fetchedAt: new Date().toISOString() };
}
async function readDetail(query, request, options) {
  const snapshot = await readTablespaces(query, options);
  const target = snapshot.tablespaces.find(row => row.id === request?.id && row.fingerprint === request?.expected);
  if (!target) fail('ts_conflict');
  const refs = await query('SELECT USERNAME, DEFAULT_TABLESPACE, TEMPORARY_TABLESPACE FROM DBA_USERS WHERE DEFAULT_TABLESPACE = :name OR TEMPORARY_TABLESPACE = :name ORDER BY USERNAME', { name: target.name });
  const quotas = await query('SELECT USERNAME, TO_CHAR(MAX_BYTES) AS MAX_BYTES FROM DBA_TS_QUOTAS WHERE TABLESPACE_NAME = :name ORDER BY USERNAME', { name: target.name });
  const segments = await query('SELECT OWNER, SEGMENT_NAME, PARTITION_NAME, SEGMENT_TYPE, COUNT(*) OVER () AS TOTAL_COUNT FROM DBA_SEGMENTS WHERE TABLESPACE_NAME = :name ORDER BY OWNER, SEGMENT_NAME, SEGMENT_TYPE, PARTITION_NAME FETCH FIRST 200 ROWS ONLY', { name: target.name });
  return { target, files: snapshot.files.filter(file => file.tablespace === target.name), users: refs.rows, quotas: quotas.rows, segments: segments.rows, segmentCount: Number(segments.rows[0]?.TOTAL_COUNT || 0), fetchedAt: snapshot.fetchedAt };
}
function normalize(input) {
  if (!input || !['create', 'add', 'resize', 'drop'].includes(input.action)) fail('ts_invalid_request');
  const request = { action: input.action, name: input.action === 'create' ? createName(input.name) : exactName(input.name), id: input.id || '', expected: input.expected || '' };
  if (input.action === 'drop') return request;
  request.sizeMb = String(input.sizeMb); size(request.sizeMb);
  if (typeof input.autoExtend !== 'boolean') fail('ts_invalid_request'); request.autoExtend = input.autoExtend;
  request.nextMb = input.autoExtend ? String(input.nextMb) : ''; request.maxMb = input.autoExtend ? String(input.maxMb) : '';
  if (input.autoExtend) { size(request.nextMb); if (size(request.maxMb) < size(request.sizeMb) || size(request.nextMb) > size(request.maxMb)) fail('ts_invalid_size'); }
  request.bigfile = input.bigfile === true;
  request.pathMode = input.pathMode || 'omf';
  if (!['omf', 'path'].includes(request.pathMode)) fail('ts_invalid_request');
  request.path = input.action === 'resize' || request.pathMode === 'omf' ? '' : input.path;
  if (request.path && (typeof request.path !== 'string' || control(request.path) || request.path.split(/[\\/]/).includes('..') || !/^(\/|[A-Za-z]:[\\/]|\\\\|\+)/.test(request.path) || Buffer.byteLength(request.path) > 4000)) fail('ts_invalid_path');
  if (input.action !== 'resize' && request.pathMode === 'path' && !request.path) fail('ts_invalid_path');
  return request;
}
async function plan(query, input, options) {
  const request = normalize(input), snapshot = await readTablespaces(query, options), ctx = snapshot.context;
  if (ctx.readonly) fail('ts_readonly');
  if (!ctx.protectionReady) fail('ts_protection_unknown');
  const target = snapshot.tablespaces.find(row => row.id === request.id && row.name === request.name);
  let detail = null;
  if (request.action === 'create') {
    if (!ctx.canCreate) fail('ts_permission');
    if (snapshot.tablespaces.some(row => row.name === request.name)) fail('ts_exists');
  } else {
    if (!target || target.fingerprint !== request.expected) fail('ts_conflict');
    if (target.protected || target.status !== 'ONLINE') fail('ts_protected');
    if (!(request.action === 'drop' ? ctx.canDrop : ctx.canAlter)) fail('ts_permission');
    if (request.action === 'add' && target.bigfile || request.action === 'resize' && !target.bigfile) fail('ts_invalid_request');
    detail = await readDetail(query, { id: target.id, expected: target.fingerprint }, options);
    if (request.action === 'drop' && target.dropProtected) fail('ts_protected');
    if (request.action === 'resize' && target.dropProtected && size(request.sizeMb) < bytes(detail.files[0]?.bytes)) fail('ts_protected');
    if (request.action === 'drop' && detail.users.length) fail('ts_referenced');
  }
  if (['create', 'add'].includes(request.action)) {
    if (request.pathMode === 'omf' && !ctx.omf) fail('ts_omf_unavailable');
    if (request.path && snapshot.files.some(file => file.path === request.path)) fail('ts_file_exists');
  }
  const blockSize = target?.blockSize || ctx.blockSize;
  if (request.action !== 'drop') {
    if (!Number.isSafeInteger(blockSize) || blockSize <= 0) fail('ts_invalid_metadata');
    const limit = ((target?.bigfile ?? request.bigfile) ? (1n << 32n) - 1n : (1n << 22n) - 1n) * BigInt(blockSize);
    if (size(request.sizeMb) > limit || request.autoExtend && size(request.maxMb) > limit) fail('ts_size_limit');
  }
  const suffix = request.autoExtend ? `AUTOEXTEND ON NEXT ${request.nextMb}M MAXSIZE ${request.maxMb}M` : 'AUTOEXTEND OFF';
  const name = quote(request.name), file = request.pathMode === 'path' ? literal(request.path) + ' ' : '';
  const steps = [];
  if (request.action === 'create') steps.push({ kind: 'create', sql: `CREATE ${request.bigfile ? 'BIGFILE' : 'SMALLFILE'} TABLESPACE ${name} DATAFILE ${file}SIZE ${request.sizeMb}M ${suffix}` });
  if (request.action === 'add') steps.push({ kind: 'add', sql: `ALTER TABLESPACE ${name} ADD DATAFILE ${file}SIZE ${request.sizeMb}M ${suffix}` });
  if (request.action === 'drop') steps.push({ kind: 'drop', sql: `DROP TABLESPACE ${name} INCLUDING CONTENTS AND DATAFILES` });
  if (request.action === 'resize') {
    const files = detail.files;
    if (files.length !== 1) fail('ts_invalid_metadata');
    const current = files[0];
    if (size(request.sizeMb) !== bytes(current.bytes)) steps.push({ kind: 'resize', sql: `ALTER TABLESPACE ${name} RESIZE ${request.sizeMb}M` });
    if (current.autoExtend !== request.autoExtend || request.autoExtend && (bytes(current.nextBytes) !== size(request.nextMb) || bytes(current.maxBytes) !== size(request.maxMb))) steps.push({ kind: 'autoextend', sql: `ALTER TABLESPACE ${name} ${suffix}` });
  }
  const signature = hash([request, ctx, target?.fingerprint || null, detail?.users, detail?.quotas, detail?.segmentCount, detail?.segments]);
  return { request, snapshot, target, detail, steps, signature };
}
function createTablespaceManager() {
  const reviews = new Map();
  return { read: readTablespaces, detail: readDetail,
    async review(query, request, options) {
      const result = await plan(query, request, options);
      for (const [key, entry] of reviews) if (Date.now() - entry.time > 300000) reviews.delete(key);
      if (reviews.size >= 100) reviews.delete(reviews.keys().next().value);
      const token = randomBytes(24).toString('hex'); reviews.set(token, { signature: result.signature, scope: options.scope, time: Date.now() });
      return { token, request: { ...result.request, name: result.request.action === 'create' ? quote(result.request.name) : result.request.name }, detail: result.detail, steps: result.steps, canExecute: result.steps.length > 0, shrinking: result.request.action === 'resize' && size(result.request.sizeMb) < bytes(result.detail.files[0].bytes) };
    },
    async execute(query, input, options) {
      const entry = reviews.get(input?.token);
      if (!entry || entry.scope !== options.scope || Date.now() - entry.time > 300000) fail('ts_review_expired');
      const result = await plan(query, input, options);
      if (entry.signature !== result.signature) fail('ts_conflict');
      if (input.action === 'drop' && input.confirmName !== result.request.name) fail('ts_confirm_name');
      reviews.delete(input.token);
      const completed = []; let attempted = null;
      try {
        for (const step of result.steps) { attempted = step.kind; await query(step.sql); completed.push(step.kind); attempted = null; }
        return { completed, attempted, applied: completed.length > 0, snapshot: await readTablespaces(query, options) };
      } catch (error) { error.tsCompleted = completed; error.tsAttempted = attempted; throw error; }
    }
  };
}
function safeError(error) {
  return { error: /^ts_[a-z_]+$/.test(error?.message || '') ? error.message : 'ts_operation_failed', errorCode: /^(ORA|NJS|DPI)-\d+$/.test(error?.code || '') ? error.code : '',
    completed: error?.tsCompleted || [], attempted: error?.tsAttempted || null, applied: Boolean(error?.tsCompleted?.length) };
}
module.exports = { createTablespaceManager, readTablespaces, readDetail, IDENTITY_SQL, TABLESPACE_SQL, FILE_SQL, FREE_SQL, TEMP_SQL, mb, safeError };
