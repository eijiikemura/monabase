// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const IDENTITY_SQL = "SELECT TO_NUMBER(SYS_CONTEXT('USERENV','SID')) AS SID, TO_NUMBER(SYS_CONTEXT('USERENV','INSTANCE')) AS INSTANCE_ID, TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID')) AS CON_ID FROM DUAL";
// Local-instance/current-container view; a remote blocker is identified but never targeted here.
const LOCK_SQL = `SELECT l.SID, s.SERIAL# AS SERIAL,
 TO_NUMBER(SYS_CONTEXT('USERENV','INSTANCE')) AS INSTANCE_ID, s.CON_ID,
 s.USERNAME, s.OSUSER, s.PROGRAM, s.MACHINE, s.STATUS, s.TYPE AS SESSION_TYPE,
 TO_CHAR(s.LOGON_TIME, 'YYYY-MM-DD HH24:MI:SS') AS LOGON_TIME,
 l.TYPE, l.ID1, l.ID2, l.LMODE AS HELD_MODE, l.REQUEST AS REQUEST_MODE, l.BLOCK,
 l.CTIME AS HOLD_SECONDS,
 CASE WHEN s.STATE = 'WAITING' THEN ROUND(s.WAIT_TIME_MICRO / 1000000, 3) END AS WAIT_SECONDS,
 s.EVENT,
 CASE WHEN s.BLOCKING_SESSION_STATUS = 'VALID' AND s.STATE = 'WAITING' THEN s.BLOCKING_SESSION END AS BLOCKING_SID,
 CASE WHEN s.BLOCKING_SESSION_STATUS = 'VALID' AND s.STATE = 'WAITING' THEN s.BLOCKING_INSTANCE END AS BLOCKING_INSTANCE,
 (SELECT COUNT(*) FROM V$SESSION w WHERE w.BLOCKING_SESSION_STATUS = 'VALID'
  AND w.STATE = 'WAITING' AND w.BLOCKING_SESSION = s.SID AND w.CON_ID = s.CON_ID
  AND w.BLOCKING_INSTANCE = TO_NUMBER(SYS_CONTEXT('USERENV','INSTANCE'))) AS WAITERS,
 o.OWNER AS OBJECT_OWNER, o.OBJECT_NAME, o.OBJECT_TYPE,
 s.SQL_ID, sq.SQL_FULLTEXT AS SQL_TEXT, s.PREV_SQL_ID, prev.SQL_FULLTEXT AS PREV_SQL_TEXT,
 u.ORACLE_MAINTAINED
 FROM V$LOCK l JOIN V$SESSION s ON s.SID = l.SID AND s.CON_ID = l.CON_ID
 LEFT JOIN ALL_OBJECTS o ON o.OBJECT_ID = CASE WHEN l.TYPE = 'TM' THEN l.ID1
   WHEN s.STATE = 'WAITING' AND s.EVENT LIKE 'enq: TX%' AND s.ROW_WAIT_OBJ# > 0 THEN s.ROW_WAIT_OBJ# END
 LEFT JOIN V$SQLAREA sq ON sq.ADDRESS = s.SQL_ADDRESS AND sq.HASH_VALUE = s.SQL_HASH_VALUE AND sq.CON_ID = s.CON_ID
 LEFT JOIN V$SQLAREA prev ON prev.ADDRESS = s.PREV_SQL_ADDR AND prev.HASH_VALUE = s.PREV_HASH_VALUE AND prev.CON_ID = s.CON_ID
 LEFT JOIN ALL_USERS u ON u.USERNAME = s.USERNAME
 WHERE l.TYPE IN ('TX', 'TM') AND s.TYPE = 'USER' AND s.USERNAME IS NOT NULL
 AND s.CON_ID = TO_NUMBER(SYS_CONTEXT('USERENV','CON_ID'))
 ORDER BY l.CTIME DESC, l.SID, l.TYPE, l.ID1, l.ID2`;
function identity(row) { return { sid: Number(row.SID), instance: Number(row.INSTANCE_ID), container: Number(row.CON_ID) }; }
function sameSession(a, b) { return a.sid === b.sid && a.instance === b.instance && a.container === b.container; }
function lockRow(row, ownSessions) {
  const result = { ...row, ...Object.fromEntries(['SID', 'SERIAL', 'INSTANCE_ID', 'CON_ID', 'ID1', 'ID2', 'HELD_MODE', 'REQUEST_MODE', 'BLOCK', 'WAITERS', 'HOLD_SECONDS'].map(key => [key, Number(row[key])])) };
  result.id = JSON.stringify([result.INSTANCE_ID, result.CON_ID, result.SID, result.SERIAL, result.TYPE, result.ID1, result.ID2]);
  result.fingerprint = createHash('sha256').update(JSON.stringify([result.id, row.LOGON_TIME, row.USERNAME, row.PROGRAM])).digest('hex');
  result.protected = row.ORACLE_MAINTAINED !== 'N' || row.SESSION_TYPE !== 'USER' || ['SYS', 'SYSTEM'].includes(row.USERNAME) || ownSessions.some(own => sameSession(own, identity(result)));
  delete result.ORACLE_MAINTAINED; delete result.SESSION_TYPE;
  return result;
}
async function readLocks(query, { readonly = false, ownSessions = [], protectionReady = false } = {}) {
  const current = (await query(IDENTITY_SQL)).rows?.[0];
  if (!current) throw new Error('lock_read_failed');
  const privileges = (await query("SELECT PRIVILEGE FROM SESSION_PRIVS WHERE PRIVILEGE = 'ALTER SYSTEM'")).rows;
  if (!Array.isArray(privileges)) throw new Error('lock_read_failed');
  const rows = (await query(LOCK_SQL)).rows;
  if (!Array.isArray(rows)) throw new Error('lock_read_failed');
  const context = { instance: Number(current.INSTANCE_ID), container: Number(current.CON_ID), readonly, protectionReady,
    canKill: !readonly && protectionReady && privileges.some(row => row.PRIVILEGE === 'ALTER SYSTEM') };
  return { locks: rows.map(row => lockRow(row, [...ownSessions, identity(current)])), context, fetchedAt: new Date().toISOString() };
}
async function terminateLockSession(query, request, options) {
  if (!request || typeof request.id !== 'string' || typeof request.fingerprint !== 'string') throw new Error('lock_target_changed');
  if (options.readonly) throw new Error('lock_readonly');
  const snapshot = await readLocks(query, options);
  if (!snapshot.context.protectionReady) throw new Error('lock_protection_unavailable');
  if (!snapshot.context.canKill) throw new Error('lock_privilege_required');
  const row = snapshot.locks.find(item => item.id === request.id && item.fingerprint === request.fingerprint);
  if (!row) throw new Error('lock_target_changed');
  if (row.protected) throw new Error('lock_session_protected');
  for (const value of [row.SID, row.SERIAL]) if (!Number.isSafeInteger(value) || value < 0) throw new Error('lock_target_changed');
  try { await query(`ALTER SYSTEM KILL SESSION '${row.SID},${row.SERIAL}' IMMEDIATE`); }
  catch (error) {
    if (error.errorNum === 31 || error.code === 'ORA-00031') return { status: 'marked' };
    throw error;
  }
  return { status: 'requested' };
}
function safeLockError(error) {
  const key = typeof error.message === 'string' && /^lock_[a-z_]+$/.test(error.message) ? error.message : 'lock_operation_failed';
  const code = String(error.code || error.message?.match(/\b(?:ORA|NJS|DPI)-\d+\b/)?.[0] || '').match(/^(?:ORA|NJS|DPI)-\d+$/)?.[0] || '';
  return { error: key, errorCode: code };
}
module.exports = { IDENTITY_SQL, LOCK_SQL, identity, readLocks, terminateLockSession, safeLockError };
