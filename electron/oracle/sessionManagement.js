// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const { IDENTITY_SQL, identity } = require('./lockManagement');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = key => { throw new Error(key); };
const SESSION_SQL = `SELECT s.SID, s.SERIAL# AS SERIAL, s.CON_ID,
 TO_NUMBER(SYS_CONTEXT('USERENV','INSTANCE')) AS INSTANCE_ID,
 s.USERNAME, s.TYPE AS SESSION_TYPE, s.STATUS, s.OSUSER, s.MACHINE, s.PROGRAM,
 TO_CHAR(s.LOGON_TIME,'YYYY-MM-DD HH24:MI:SS') AS LOGON_TIME,
 s.SQL_ID, TO_CHAR(s.SQL_EXEC_START,'YYYY-MM-DD HH24:MI:SS') AS SQL_EXEC_START, TO_CHAR(s.SQL_EXEC_ID) AS SQL_EXEC_ID,
 s.PREV_SQL_ID, s.EVENT, s.STATE, s.WAIT_CLASS,
 CASE WHEN s.STATE = 'WAITING' THEN ROUND(s.WAIT_TIME_MICRO / 1000000, 3) END AS WAIT_SECONDS,
 CASE WHEN s.STATE = 'WAITING' AND s.BLOCKING_SESSION_STATUS = 'VALID' THEN s.BLOCKING_SESSION END AS BLOCKING_SID,
 CASE WHEN s.STATE = 'WAITING' AND s.BLOCKING_SESSION_STATUS = 'VALID' THEN s.BLOCKING_INSTANCE END AS BLOCKING_INSTANCE,
 u.ORACLE_MAINTAINED
 FROM V$SESSION s LEFT JOIN ALL_USERS u ON u.USERNAME = s.USERNAME
 WHERE s.TYPE = 'USER' AND s.CON_ID = TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID'))
 ORDER BY s.LOGON_TIME DESC, s.SID`;
const TEXT_SQL = `SELECT q.SQL_FULLTEXT AS SQL_TEXT FROM V$SESSION s JOIN V$SQLAREA q
 ON q.ADDRESS = s.SQL_ADDRESS AND q.HASH_VALUE = s.SQL_HASH_VALUE AND q.CON_ID = s.CON_ID
 WHERE s.SID = :sid AND s.SERIAL# = :serial AND s.CON_ID = :container`;
const PREV_TEXT_SQL = TEXT_SQL.replaceAll('s.SQL_ADDRESS', 's.PREV_SQL_ADDR').replaceAll('s.SQL_HASH_VALUE', 's.PREV_HASH_VALUE');
const STATS_SQL = `WITH stats AS (
 SELECT st.STATISTIC#, st.VALUE, ROW_NUMBER() OVER (PARTITION BY st.STATISTIC# ORDER BY CASE WHEN st.CON_ID = :container THEN 0 ELSE 1 END) AS rn
 FROM V$SESSTAT st WHERE st.SID = :sid AND st.CON_ID IN (0, :container)
 AND EXISTS (SELECT 1 FROM V$SESSION s WHERE s.SID = st.SID AND s.SERIAL# = :serial AND s.CON_ID = :container)
), names AS (
 SELECT n.STATISTIC#, n.NAME, ROW_NUMBER() OVER (PARTITION BY n.STATISTIC# ORDER BY CASE WHEN n.CON_ID = :container THEN 0 ELSE 1 END) AS rn
 FROM V$STATNAME n WHERE n.CON_ID IN (0, :container)
)
 SELECT TO_CHAR(st.STATISTIC#) AS STAT_ID, n.NAME, TO_CHAR(st.VALUE, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,''') AS VALUE
 FROM stats st JOIN names n ON n.STATISTIC# = st.STATISTIC# AND n.rn = 1
 WHERE st.rn = 1 AND st.VALUE > 0 ORDER BY n.NAME`;
function mapSession(row, own) {
  const result = { ...row };
  for (const field of ['SID', 'SERIAL', 'INSTANCE_ID', 'CON_ID']) {
    result[field] = Number(row[field]);
    if (!Number.isSafeInteger(result[field]) || result[field] < 0) fail('session_invalid_identity');
  }
  result.id = JSON.stringify([result.INSTANCE_ID, result.CON_ID, result.SID, result.SERIAL, row.LOGON_TIME]);
  result.fingerprint = hash([result.id, row.USERNAME, row.PROGRAM]);
  result.execution = hash([row.SQL_ID, row.SQL_EXEC_START, row.SQL_EXEC_ID]);
  result.protected = row.ORACLE_MAINTAINED !== 'N' || row.SESSION_TYPE !== 'USER' || !row.USERNAME || ['SYS', 'SYSTEM'].includes(row.USERNAME)
    || own.some(item => item.sid === result.SID && item.instance === result.INSTANCE_ID && item.container === result.CON_ID);
  delete result.ORACLE_MAINTAINED; delete result.SESSION_TYPE;
  return result;
}
async function readSessions(query, options = {}) {
  const current = (await query(IDENTITY_SQL)).rows?.[0];
  if (!current) fail('session_read_failed');
  const privileges = (await query("SELECT PRIVILEGE FROM SESSION_PRIVS WHERE PRIVILEGE = 'ALTER SYSTEM'")).rows;
  const rows = (await query(SESSION_SQL)).rows;
  if (!Array.isArray(rows) || !Array.isArray(privileges)) fail('session_read_failed');
  const context = { instance: Number(current.INSTANCE_ID), container: Number(current.CON_ID), readonly: Boolean(options.readonly), protectionReady: Boolean(options.protectionReady),
    canManage: !options.readonly && Boolean(options.protectionReady) && privileges.some(row => row.PRIVILEGE === 'ALTER SYSTEM'),
    cancelSupported: Number.parseInt(options.serverVersion || '', 10) >= 18 };
  return { sessions: rows.map(row => mapSession(row, [...(options.ownSessions || []), identity(current)])), context, fetchedAt: new Date().toISOString() };
}
function target(snapshot, request) {
  if (!request || typeof request.id !== 'string' || typeof request.fingerprint !== 'string') fail('session_target_changed');
  const row = snapshot.sessions.find(item => item.id === request.id && item.fingerprint === request.fingerprint);
  if (!row) fail('session_target_changed');
  return row;
}
async function readDetail(query, request, options) {
  const before = target(await readSessions(query, options), request);
  const binds = { sid: before.SID, serial: before.SERIAL, container: before.CON_ID };
  const statistics = (await query(STATS_SQL, binds)).rows.map(row => ({ id: String(row.STAT_ID), NAME: row.NAME, VALUE: String(row.VALUE) }));
  const sqlText = (await query(TEXT_SQL, binds)).rows?.[0]?.SQL_TEXT || null;
  const previousSqlText = (await query(PREV_TEXT_SQL, binds)).rows?.[0]?.SQL_TEXT || null;
  const after = target(await readSessions(query, options), request);
  // Do not label SQL from different executions as one consistent observation.
  if (after.execution !== before.execution || after.PREV_SQL_ID !== before.PREV_SQL_ID) fail('session_sql_changed');
  return { sessionId: before.id, fingerprint: before.fingerprint, execution: before.execution, statistics, sqlText, previousSqlText, fetchedAt: new Date().toISOString() };
}
async function manageSession(query, request, options) {
  if (!request || !['kill', 'cancel'].includes(request.action)) fail('session_invalid_request');
  if (options.readonly) fail('session_readonly');
  const snapshot = await readSessions(query, options);
  if (!snapshot.context.protectionReady) fail('session_protection_unavailable');
  if (!snapshot.context.canManage) fail('session_privilege_required');
  const row = target(snapshot, request);
  if (row.protected) fail('session_protected');
  if (row.STATUS === 'KILLED') fail('session_already_marked');
  if (request.action === 'cancel') {
    if (!snapshot.context.cancelSupported) fail('session_cancel_unsupported');
    if (request.execution !== row.execution || row.STATUS !== 'ACTIVE' || !/^[0-9a-z]{13}$/.test(row.SQL_ID || '') || !row.SQL_EXEC_START || !row.SQL_EXEC_ID) fail('session_sql_changed');
  }
  const command = request.action === 'kill' ? `ALTER SYSTEM KILL SESSION '${row.SID},${row.SERIAL}' IMMEDIATE`
    : `ALTER SYSTEM CANCEL SQL '${row.SID},${row.SERIAL},${row.SQL_ID}'`;
  try { await query(command); }
  catch (error) { if (request.action === 'kill' && (error.errorNum === 31 || error.code === 'ORA-00031')) return { status: 'marked' }; throw error; }
  return { status: 'requested' };
}
function safeError(error) {
  return { error: /^session_[a-z_]+$/.test(error?.message || '') ? error.message : 'session_operation_failed', errorCode: /^(ORA|NJS|DPI)-\d+$/.test(error?.code || '') ? error.code : '' };
}
module.exports = { SESSION_SQL, TEXT_SQL, PREV_TEXT_SQL, STATS_SQL, readSessions, readDetail, manageSession, safeError };
