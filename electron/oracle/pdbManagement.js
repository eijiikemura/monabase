// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash, randomBytes } = require('node:crypto');
const fail = key => { throw Object.assign(new Error(key), { publicKey: key }); };
const quote = text => '"' + text.replaceAll('"', '""') + '"';
const literal = text => "'" + text.replaceAll("'", "''") + "'";
const control = text => [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
function pdbName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_$#]{0,29}$/.test(value) || ['CDB$ROOT', 'PDB$SEED'].includes(value.toUpperCase())) fail('pdb_invalid_name');
  return value.toUpperCase();
}
function username(value) {
  if (typeof value !== 'string' || !value.trim() || control(value) || value.includes('"') || Buffer.byteLength(value) > 128) fail('pdb_invalid_user');
  return value;
}
function serverPath(value) {
  if (typeof value !== 'string' || !value.trim() || control(value) || value.split(/[\\/]/).includes('..') || Buffer.byteLength(value) > 4000 || !/^(\/|[A-Za-z]:[\\/]|\\\\|\+)/.test(value)) fail('pdb_invalid_path');
  return value;
}
function password(value) {
  if (typeof value !== 'string' || !value || value.includes('"') || control(value) || Buffer.byteLength(value) > 128) fail('pdb_invalid_password');
  return quote(value);
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const IDENTITY_SQL = "SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS USERNAME, SYS_CONTEXT('USERENV','CON_NAME') AS CON_NAME, SYS_CONTEXT('USERENV','CON_ID') AS CON_ID, SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') AS DB_NAME, SYS_CONTEXT('USERENV','INSTANCE_NAME') AS INSTANCE_NAME, SYS_CONTEXT('USERENV','ISDBA') AS IS_DBA FROM DUAL";
async function access(query) {
  const row = (await query(IDENTITY_SQL)).rows[0];
  const common = (await query('SELECT COMMON FROM USER_USERS')).rows[0]?.COMMON === 'YES';
  if (!row?.CON_NAME || !row.DB_NAME || !row.USERNAME) fail('pdb_access_unknown');
  return { user: row.USERNAME, container: row.CON_NAME, containerId: String(row.CON_ID), database: row.DB_NAME, instance: row.INSTANCE_NAME || '', common, sysdba: row.IS_DBA === 'TRUE' };
}
async function rootContext(query, options) {
  const identity = await access(query);
  if (identity.container !== 'CDB$ROOT') fail('pdb_root_required');
  const privs = new Set((await query('SELECT PRIVILEGE FROM SESSION_PRIVS')).rows.map(row => row.PRIVILEGE));
  const database = (await query('SELECT OPEN_MODE, LOG_MODE FROM V$DATABASE')).rows[0];
  const localUndo = (await query("SELECT PROPERTY_VALUE FROM DATABASE_PROPERTIES WHERE PROPERTY_NAME = 'LOCAL_UNDO_ENABLED'")).rows[0]?.PROPERTY_VALUE;
  const parameters = (await query("SELECT NAME, VALUE FROM V$PARAMETER WHERE NAME = 'db_create_file_dest'")).rows;
  return { ...identity, readonly: Boolean(options.readonly), writable: database?.OPEN_MODE === 'READ WRITE',
    canCreate: privs.has('CREATE PLUGGABLE DATABASE'), canAlter: identity.sysdba, canDrop: identity.sysdba, canPassword: identity.sysdba || privs.has('ALTER USER'),
    omf: Boolean(parameters.find(row => row.NAME === 'db_create_file_dest')?.VALUE),
    hotClone: database?.LOG_MODE === 'ARCHIVELOG' && String(localUndo).toUpperCase() === 'TRUE' };
}
const PDB_SQL = `SELECT d.PDB_ID, d.PDB_NAME, RAWTOHEX(d.GUID) AS GUID, TO_CHAR(d.DBID) AS DBID, d.STATUS,
  v.OPEN_MODE, v.RESTRICTED, ROUND(v.TOTAL_SIZE / 1048576, 2) AS SIZE_MB
  FROM DBA_PDBS d LEFT JOIN V$PDBS v ON v.CON_ID = d.PDB_ID WHERE d.PDB_NAME <> 'PDB$SEED' ORDER BY d.PDB_ID`;
async function list(query, options = {}) {
  const context = await rootContext(query, options);
  const rows = (await query(PDB_SQL)).rows;
  const pdbs = rows.map(row => {
    const result = { id: String(row.GUID || `unknown:${row.PDB_ID}`), conId: Number(row.PDB_ID), name: row.PDB_NAME, dbid: String(row.DBID || ''), status: row.STATUS,
      openMode: row.OPEN_MODE || null, restricted: row.RESTRICTED || null, sizeMb: row.SIZE_MB == null ? null : Number(row.SIZE_MB),
      protected: !row.GUID || !row.DBID || !options.originContainer || row.PDB_NAME === options.originContainer || options.protectedContainers?.includes(row.PDB_NAME) || ['CDB$ROOT', 'PDB$SEED'].includes(row.PDB_NAME) };
    return { ...result, fingerprint: digest([context.database, context.instance, result]) };
  });
  return { context, pdbs, seedFiles: await files(query, 'PDB$SEED') };
}
function normalize(input) {
  if (!input || !['create', 'clone', 'open', 'close', 'drop', 'unplug', 'plugin', 'mode', 'password'].includes(input.action)) fail('pdb_invalid_request');
  const action = input.action;
  const target = input.target ? pdbName(input.target) : '';
  const name = ['create', 'clone', 'plugin'].includes(action) ? pdbName(input.name) : '';
  if (!['create', 'plugin'].includes(action) && !target) fail('pdb_invalid_request');
  const request = { action, target, name, expected: typeof input.expected === 'string' ? input.expected : '' };
  if (['create', 'password'].includes(action)) request.user = username(input.user);
  if (['plugin', 'unplug'].includes(action)) request.path = serverPath(input.path);
  if (action === 'mode') { if (!['READ ONLY', 'READ WRITE'].includes(input.mode)) fail('pdb_invalid_request'); request.mode = input.mode; }
  if (['create', 'clone'].includes(action)) {
    if (input.pathMode !== undefined && !['convert', 'omf'].includes(input.pathMode)) fail('pdb_invalid_request');
    request.pathMode = input.pathMode === 'convert' ? 'convert' : 'omf';
    request.conversions = request.pathMode === 'convert' ? input.conversions : [];
    if (!Array.isArray(request.conversions) || request.conversions.length > 50 || request.pathMode === 'convert' && !request.conversions.length) fail('pdb_invalid_path');
    request.conversions = request.conversions.map(pair => {
      if (!pair || typeof pair !== 'object') fail('pdb_invalid_path');
      const source = serverPath(pair.source), destination = serverPath(pair.destination);
      if (source === destination || !/[\\/]$/.test(source) || !/[\\/]$/.test(destination)) fail('pdb_invalid_path');
      return { source, destination };
    });
    if (new Set(request.conversions.map(pair => pair.source)).size !== request.conversions.length) fail('pdb_invalid_path');
    const sources = request.conversions.map(pair => pair.source);
    if (sources.some((source, i) => sources.some((other, j) => i !== j && source.startsWith(other)))) fail('pdb_invalid_path');
  }
  return request;
}
async function inPdb(query, target, work) {
  await query(`ALTER SESSION SET CONTAINER = ${quote(target)}`);
  try { return await work(); }
  finally { await query('ALTER SESSION SET CONTAINER = "CDB$ROOT"'); }
}
async function localUsers(query, target) {
  return inPdb(query, pdbName(target), async () => (await query("SELECT USERNAME FROM DBA_USERS WHERE COMMON = 'NO' AND ORACLE_MAINTAINED = 'N' ORDER BY USERNAME")).rows.map(row => row.USERNAME));
}
async function files(query, source) {
  return (await query('SELECT FILE_NAME FROM (SELECT d.NAME AS FILE_NAME FROM V$DATAFILE d JOIN V$PDBS p ON p.CON_ID = d.CON_ID WHERE p.NAME = :name UNION SELECT d.NAME AS FILE_NAME FROM V$TEMPFILE d JOIN V$PDBS p ON p.CON_ID = d.CON_ID WHERE p.NAME = :name) ORDER BY FILE_NAME', { name: source })).rows.map(row => String(row.FILE_NAME));
}
async function compatibility(query, request) {
  const result = await query("BEGIN :compatible := CASE WHEN DBMS_PDB.CHECK_PLUG_COMPATIBILITY(pdb_descr_file => :path, pdb_name => :name) THEN 1 ELSE 0 END; END;", { path: request.path, name: request.name, compatible: { pdbOutNumber: true } });
  const violations = (await query("SELECT TYPE, MESSAGE, ACTION FROM PDB_PLUG_IN_VIOLATIONS WHERE NAME = :name AND STATUS = 'PENDING' ORDER BY TIME, LINE", { name: request.name })).rows.map(row => ({ type: row.TYPE, message: row.MESSAGE, action: row.ACTION }));
  return { compatible: Number(result.outBinds?.compatible) === 1 && !violations.some(row => row.type === 'ERROR'), violations };
}
async function inspect(query, input, options) {
  const request = normalize(input), snapshot = await list(query, options), ctx = snapshot.context;
  if (ctx.readonly || !ctx.writable) fail('pdb_readonly');
  const target = snapshot.pdbs.find(row => row.name === request.target);
  const existing = snapshot.pdbs.find(row => row.name === request.name);
  if (request.target && (!target || !target.id || target.id.startsWith('unknown:') || !target.dbid || target.fingerprint !== request.expected)) fail('pdb_conflict');
  if (target?.protected && ['close', 'drop', 'unplug', 'mode', 'password'].includes(request.action)) fail('pdb_protected');
  if (['create', 'clone', 'plugin'].includes(request.action)) {
    if (!ctx.canCreate) fail('pdb_permission');
    if (existing && !(request.action === 'plugin' && request.target === existing.name && existing.status === 'UNPLUGGED')) fail('pdb_exists');
  } else if (!(request.action === 'drop' ? ctx.canDrop : request.action === 'password' ? ctx.canPassword : ctx.canAlter)) fail('pdb_permission');
  if (['close', 'password'].includes(request.action) && !['READ WRITE', 'READ ONLY', 'MIGRATE'].includes(target.openMode)) fail('pdb_invalid_state');
  if (request.action === 'password' && target.openMode !== 'READ WRITE') fail('pdb_invalid_state');
  if (['open', 'mode', 'unplug'].includes(request.action) && (target.openMode !== 'MOUNTED' || target.status === 'UNPLUGGED')) fail('pdb_invalid_state');
  if (request.action === 'close' && target.status === 'UNPLUGGED') fail('pdb_invalid_state');
  if (request.action === 'clone' && !(target.openMode === 'READ ONLY' || ctx.hotClone && target.openMode === 'READ WRITE') || request.action === 'clone' && target.status === 'UNPLUGGED') fail('pdb_invalid_state');
  if (request.action === 'drop' && !(target.openMode === 'MOUNTED' || target.status === 'UNPLUGGED')) fail('pdb_invalid_state');
  let users = [], datafiles = [], check = null;
  if (request.action === 'password') {
    users = await localUsers(query, target.name);
    if (!users.includes(request.user)) fail('pdb_invalid_user');
    const allowed = await inPdb(query, target.name, async () => (await query('SELECT PRIVILEGE FROM SESSION_PRIVS')).rows.some(row => row.PRIVILEGE === 'ALTER USER'));
    if (!allowed) fail('pdb_permission');
  }
  if (request.action === 'clone') {
    const permitted = await inPdb(query, target.name, async () => (await query('SELECT PRIVILEGE FROM SESSION_PRIVS')).rows.some(row => row.PRIVILEGE === 'CREATE PLUGGABLE DATABASE'));
    if (!permitted) fail('pdb_permission');
  }
  if (['create', 'clone'].includes(request.action)) {
    datafiles = await files(query, request.action === 'create' ? 'PDB$SEED' : target.name);
    if (request.pathMode === 'omf' && !ctx.omf) fail('pdb_path_required');
    if (request.pathMode === 'convert' && (!datafiles.length || datafiles.some(file => !request.conversions.some(pair => file.startsWith(pair.source))))) fail('pdb_path_incomplete');
  }
  if (request.action === 'plugin') {
    if (existing && (!ctx.canDrop || existing.protected)) fail('pdb_protected');
    check = await compatibility(query, request);
  }
  const stages = request.action === 'plugin' ? [...(existing ? ['remove_catalog'] : []), 'attach'] : [request.action];
  return { request, snapshot, target, existing, datafiles, users, compatibility: check, stages,
    signature: digest([request, ctx, target || null, existing || null, datafiles, users]) };
}
function createPdbManager() {
  const reviews = new Map();
  return {
    list,
    async detail(query, target, options) {
      const snapshot = await list(query, options), row = snapshot.pdbs.find(pdb => pdb.name === pdbName(target));
      if (!row) fail('pdb_missing');
      return { target: row, files: await files(query, row.name), users: row.openMode === 'READ WRITE' ? await localUsers(query, row.name) : [] };
    },
    async review(query, request, options) {
      const plan = await inspect(query, request, options);
      for (const [key, value] of reviews) if (Date.now() - value.time > 300000) reviews.delete(key);
      if (reviews.size >= 100) reviews.delete(reviews.keys().next().value);
      const token = randomBytes(24).toString('hex');
      if (!plan.compatibility || plan.compatibility.compatible) reviews.set(token, { signature: plan.signature, time: Date.now(), scope: options.scope });
      return { token: reviews.has(token) ? token : '', request: plan.request, target: plan.target || null, stages: plan.stages, datafiles: plan.datafiles, compatibility: plan.compatibility, canExecute: reviews.has(token) };
    },
    async execute(query, input, options) {
      const reviewed = reviews.get(input?.token);
      if (!reviewed || reviewed.scope !== options.scope || Date.now() - reviewed.time > 300000) fail('pdb_review_expired');
      const plan = await inspect(query, input, options), request = plan.request;
      if (plan.signature !== reviewed.signature) fail('pdb_conflict');
      if (plan.compatibility && !plan.compatibility.compatible) fail('pdb_incompatible');
      if ((request.action === 'drop' || plan.existing && request.action === 'plugin') && input.confirmName !== (plan.target?.name || request.name)) fail('pdb_confirmation_required');
      let statement;
      const target = request.target ? quote(request.target) : '';
      const conversion = request.pathMode === 'convert' ? ` FILE_NAME_CONVERT = (${request.conversions.flatMap(pair => [literal(pair.source), literal(pair.destination)]).join(', ')})` : '';
      switch (request.action) {
        case 'create': statement = `CREATE PLUGGABLE DATABASE ${quote(request.name)} ADMIN USER ${quote(request.user)} IDENTIFIED BY ${password(input.password)}${conversion}`; break;
        case 'clone': statement = `CREATE PLUGGABLE DATABASE ${quote(request.name)} FROM ${target}${conversion}`; break;
        case 'open': statement = `ALTER PLUGGABLE DATABASE ${target} OPEN`; break;
        case 'mode': statement = `ALTER PLUGGABLE DATABASE ${target} OPEN ${request.mode}`; break;
        case 'close': statement = `ALTER PLUGGABLE DATABASE ${target} CLOSE IMMEDIATE`; break;
        case 'drop': statement = `DROP PLUGGABLE DATABASE ${target} ${plan.target.status === 'UNPLUGGED' ? 'KEEP' : 'INCLUDING'} DATAFILES`; break;
        case 'unplug': statement = `ALTER PLUGGABLE DATABASE ${target} UNPLUG INTO ${literal(request.path)}`; break;
        case 'plugin': statement = `CREATE PLUGGABLE DATABASE ${quote(request.name)} USING ${literal(request.path)} NOCOPY`; break;
        case 'password': statement = `ALTER USER ${quote(request.user)} IDENTIFIED BY ${password(input.password)}`; break;
      }
      reviews.delete(input.token);
      let stage = 'not_started';
      try {
        if (request.action === 'plugin' && plan.existing) {
          stage = 'outcome_unknown';
          await query(`DROP PLUGGABLE DATABASE ${quote(plan.existing.name)} KEEP DATAFILES`);
          stage = 'catalog_removed';
        }
        if (request.action === 'password') {
          await query(`ALTER SESSION SET CONTAINER = ${target}`);
          try { stage = 'outcome_unknown'; await query(statement); stage = 'applied'; }
          finally { await query('ALTER SESSION SET CONTAINER = "CDB$ROOT"'); }
        } else { if (stage !== 'catalog_removed') stage = 'outcome_unknown'; await query(statement); stage = 'applied'; }
        try { return { snapshot: await list(query, options), stage, applied: true }; }
        catch (error) { error.pdbStage = stage; throw error; }
      } catch (error) { error.pdbStage = stage; throw error; }
    }
  };
}
function safeError(error) {
  const code = String(error?.code || '');
  return { error: /^pdb_[a-z_]+$/.test(error?.publicKey || '') ? error.publicKey : 'pdb_operation_failed', errorCode: /^(ORA|NJS|DPI)-\d+$/.test(code) ? code : '',
    stage: error?.pdbStage || 'not_started', applied: error?.pdbStage === 'applied' };
}
module.exports = { createPdbManager, access, safeError, pdbName, serverPath, IDENTITY_SQL, PDB_SQL };
