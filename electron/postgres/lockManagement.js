// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const session = require('./sessionManagement');
const { CONTEXT_SQL, TARGET_SQL } = session;
const LOCK_SQL = `SELECT l.locktype, l.database::text AS database_id, d.datname AS database_name, l.relation::text AS relation_id,
 n.nspname AS schema_name, c.relname AS object_name, l.page, l.tuple, l.virtualxid, l.transactionid::text AS transaction_id,
 l.classid::text AS class_id, l.objid::text AS object_id, l.objsubid, l.virtualtransaction, l.pid, l.mode, l.granted, l.fastpath,
 a.backend_start::text, a.query_start::text, a.xact_start::text, a.usesysid::text AS user_id, a.usename AS username,
 a.datid::text AS session_database_id, a.datname AS session_database, a.application_name AS program, a.client_addr::text AS address,
 a.backend_type, a.state, a.wait_event_type, a.wait_event, a.query,
 CASE WHEN a.pid IS NOT NULL THEN pg_blocking_pids(a.pid) ELSE ARRAY[]::integer[] END AS blockers,
 EXTRACT(EPOCH FROM (clock_timestamp()-a.query_start))::text AS query_seconds,
 r.rolsuper AS target_superuser,
 CASE WHEN a.usesysid IS NOT NULL THEN pg_has_role(current_user,a.usesysid,'USAGE') ELSE false END AS member
 FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid LEFT JOIN pg_database d ON d.oid=l.database
 LEFT JOIN pg_class c ON c.oid=l.relation AND (l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) OR l.database=0)
 LEFT JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_roles r ON r.oid=a.usesysid`;
async function readLocks(query, options = {}) {
  const context = await session.readContext(query, 'pg_lock');
  const protectionReady = options.protectionReady === true;
  const source = (await query(LOCK_SQL)).rows;
  const locks = source.map(row => {
    const identity = [options.connectionId || '', context.database_id, row.pid, row.backend_start, row.locktype, row.database_id, row.relation_id, row.page, row.tuple, row.virtualxid, row.transaction_id, row.class_id, row.object_id, row.objsubid, row.virtualtransaction, row.mode];
    const safety = session.protection(context, row, options);
    const visible = session.visibleQuery(row);
    return { id: hash(identity), fingerprint: hash([identity, row.granted, row.query_start, row.query, row.user_id, row.session_database_id]),
      pid: row.pid, backendStart: row.backend_start, queryStart: row.query_start, userId: row.user_id, databaseId: row.session_database_id,
      database: row.session_database || row.database_name, username: row.username, program: row.program, address: row.address, backendType: row.backend_type,
      state: row.state, kind: row.locktype, mode: row.mode, granted: row.granted, schema: row.schema_name, object: row.object_name,
      relationId: row.relation_id, transactionId: row.transaction_id, query: visible ? row.query : null, querySeconds: row.query_seconds,
      waitType: row.wait_event_type, waitEvent: row.wait_event, transactionStart: row.xact_start,
      blockers: [...new Set(row.blockers || [])], ...safety };
  });
  const waiterPids = new Map();
  for (const row of locks) for (const pid of row.blockers) {
    if (!waiterPids.has(pid)) waiterPids.set(pid, new Set());
    if (row.pid) waiterPids.get(pid).add(row.pid);
  }
  for (const row of locks) row.waiters = waiterPids.get(row.pid)?.size || 0;
  return { locks, context: { database: context.database, databaseId: context.database_id, readonly: Boolean(options.readonly), protectionReady, scope: 'cluster' }, fetchedAt: new Date().toISOString() };
}
async function manageLock(query, input, options) {
  session.validateCommand(input, options, 'pg_lock');
  const snapshot = await readLocks(query, options), row = snapshot.locks.find(row => row.id === input.id && row.fingerprint === input.fingerprint);
  if (!row) throw new Error('pg_lock_target_changed');
  return session.signalSession(query, input, row, 'pg_lock');
}
function safeError(error) { return session.safeError(error, 'pg_lock'); }
module.exports = { CONTEXT_SQL, LOCK_SQL, TARGET_SQL, readLocks, manageLock, safeError };
