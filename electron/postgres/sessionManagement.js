// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (prefix, suffix) => { throw new Error(`${prefix}_${suffix}`); };
const CONTEXT_SQL = `SELECT current_database() AS database, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_id,
 current_user AS username, pg_backend_pid() AS reader_pid, current_setting('server_version_num')::int AS version,
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser, pg_has_role(current_user,'pg_signal_backend','USAGE') AS signal`;
const SESSION_SQL = `SELECT a.pid,a.backend_start::text,a.query_start::text,a.xact_start::text,a.state_change::text,
 a.usesysid::text AS user_id,a.usename AS username,a.datid::text AS session_database_id,a.datname AS session_database,
 a.application_name AS program,a.client_addr::text AS address,a.client_port,a.backend_type,a.state,a.wait_event_type,a.wait_event,a.query,
 pg_blocking_pids(a.pid) AS blockers,
 CASE WHEN a.state='active' THEN EXTRACT(EPOCH FROM (clock_timestamp()-a.query_start))::text END AS query_seconds,
 EXTRACT(EPOCH FROM (clock_timestamp()-a.xact_start))::text AS transaction_seconds,
 EXTRACT(EPOCH FROM (clock_timestamp()-a.state_change))::text AS state_seconds,
 r.rolsuper AS target_superuser,CASE WHEN a.usesysid IS NOT NULL THEN pg_has_role(current_user,a.usesysid,'USAGE') ELSE false END AS member
 FROM pg_stat_activity a LEFT JOIN pg_roles r ON r.oid=a.usesysid ORDER BY a.pid`;
const TARGET_SQL = 'SELECT pid, state, query_start::text FROM pg_stat_activity WHERE pid=$1 AND backend_start::text=$2 AND datid::text=$3 AND usesysid::text=$4';
function visibleQuery(row) { return typeof row.query === 'string' && row.query !== '<insufficient privilege>' && row.query !== '<command string not enabled>'; }
function protection(context, row, options = {}) {
  const own = new Set([...(options.ownPids || []), context.reader_pid]);
  const protectedTarget = options.protectionReady !== true || !Number.isSafeInteger(row.pid) || row.pid <= 0 || own.has(row.pid) || row.backend_type !== 'client backend' || !row.backend_start || !row.session_database_id || !row.user_id || row.target_superuser == null;
  const permission = context.superuser === true || row.target_superuser === false && (context.signal === true || row.member === true);
  const canTerminate = !options.readonly && !protectedTarget && permission;
  return { protected: protectedTarget, canTerminate, canCancel: canTerminate && visibleQuery(row) && Boolean(row.query) && row.state === 'active' && Boolean(row.query_start) };
}
async function readContext(query, prefix = 'pg_session') {
  const row = (await query(CONTEXT_SQL)).rows[0];
  if (!row?.database_id || !Number.isSafeInteger(row.reader_pid) || row.version < 100000) fail(prefix, 'identity_unknown');
  return row;
}
function validateCommand(input, options, prefix = 'pg_session') {
  if (!input || !['terminate', 'cancel'].includes(input.action) || typeof input.id !== 'string' || typeof input.fingerprint !== 'string') fail(prefix, 'invalid_request');
  if (options.readonly) fail(prefix, 'readonly');
}
async function signalSession(query, input, row, prefix = 'pg_session') {
  if (!(input.action === 'terminate' ? row.canTerminate : row.canCancel)) fail(prefix, 'protected');
  const binds = [row.pid, row.backendStart, row.databaseId, row.userId, row.queryStart];
  const fn = input.action === 'terminate' ? 'pg_terminate_backend' : 'pg_cancel_backend';
  let response;
  try {
    // Recheck the backend generation and observed SQL inside the signalling statement.
    response = await query(`SELECT ${fn}(pid) AS accepted FROM pg_stat_activity WHERE pid=$1 AND backend_start::text=$2 AND datid::text=$3 AND usesysid::text=$4 AND query_start IS NOT DISTINCT FROM $5::timestamptz AND backend_type='client backend'${input.action === 'cancel' ? " AND state='active'" : ''}`, binds);
  } catch (error) { if (!['42501', '22023', '42883', '42601'].includes(error.code)) error.pgSignalOutcomeUnknown = true; throw error; }
  if (response.rows[0]?.accepted !== true) fail(prefix, 'not_accepted');
  let status = 'requested';
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = (await query(TARGET_SQL, binds.slice(0, 4))).rows[0];
      if (!current) { status = 'ended'; break; }
      if (input.action === 'cancel' && (current.state !== 'active' || current.query_start !== row.queryStart)) { status = 'query-ended'; break; }
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch { return { status, observationFailed: true }; }
  return { status, observationFailed: false };
}
async function readSessions(query, options = {}) {
  const context = await readContext(query), source = (await query(SESSION_SQL)).rows;
  const sessions = source.map(row => {
    const identity = [options.connectionId || '', context.database_id, row.pid, row.backend_start, row.session_database_id, row.user_id];
    return { id: hash(identity), fingerprint: hash([identity, row.query_start, row.query, row.backend_type]),
      pid: row.pid, backendStart: row.backend_start, queryStart: row.query_start, transactionStart: row.xact_start, stateChangedAt: row.state_change,
      userId: row.user_id, databaseId: row.session_database_id, database: row.session_database, username: row.username,
      program: row.program, address: row.address, port: row.client_port, backendType: row.backend_type, state: row.state,
      waitType: row.wait_event_type, waitEvent: row.wait_event, blockers: [...new Set(row.blockers || [])],
      query: visibleQuery(row) ? row.query : null, queryVisibility: row.query === '<command string not enabled>' || row.state === 'disabled' ? 'disabled' : visibleQuery(row) ? 'visible' : row.query === '<insufficient privilege>' || row.state == null ? 'restricted' : 'unavailable',
      querySeconds: row.query_seconds, transactionSeconds: row.transaction_seconds, stateSeconds: row.state_seconds,
      ...protection(context, row, options) };
  });
  return { sessions, context: { database: context.database, databaseId: context.database_id, readonly: Boolean(options.readonly), protectionReady: options.protectionReady === true, scope: 'cluster' }, fetchedAt: new Date().toISOString() };
}
async function manageSession(query, input, options) {
  validateCommand(input, options);
  const snapshot = await readSessions(query, options), row = snapshot.sessions.find(row => row.id === input.id && row.fingerprint === input.fingerprint);
  if (!row) fail('pg_session', 'target_changed');
  return signalSession(query, input, row);
}
function safeError(error, prefix = 'pg_session') {
  return { error: error?.pgSignalOutcomeUnknown ? `${prefix}_outcome_unknown` : new RegExp(`^${prefix}_[a-z_]+$`).test(error?.message || '') ? error.message : `${prefix}_operation_failed`, errorCode: /^[0-9A-Z]{5}$/.test(error?.code || '') ? error.code : '' };
}
module.exports = { CONTEXT_SQL, SESSION_SQL, TARGET_SQL, readContext, visibleQuery, protection, validateCommand, signalSession, readSessions, manageSession, safeError };
