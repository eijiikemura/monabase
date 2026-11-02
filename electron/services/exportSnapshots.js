// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { randomUUID } = require('node:crypto');
const { isReadOnlySql } = require('./readOnlySql');

// Materialize one statement on the main connection without opening or finishing a transaction.
function createExportSnapshots({ getClient, getDialect, t, idleTimeoutMs = 300000 }) {
  const snapshots = new Map();
  const owners = new Map();
  const unavailable = () => new Error(t('export_snapshot_unavailable'));
  function remove(entry) {
    clearTimeout(entry.timer);
    entry.owner.removeListener?.('destroyed', entry.destroyed);
    if (owners.get(entry.owner) === entry) owners.delete(entry.owner);
    snapshots.delete(entry.id);
    entry.closed = true;
    entry.rows = null;
  }
  function touch(entry) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => remove(entry), idleTimeoutMs);
    entry.timer.unref?.();
  }
  async function open(owner, sql) {
    const client = getClient();
    if (!client || !owner || owner.isDestroyed?.()) throw unavailable();
    if (typeof sql !== 'string' || !isReadOnlySql(sql, getDialect())) throw new Error(t('export_requires_read_only_query'));
    const previous = owners.get(owner);
    if (previous) remove(previous);
    const entry = { id: randomUUID(), client, owner, closed: false, rows: null };
    entry.destroyed = () => remove(entry);
    owners.set(owner, entry);
    owner.once?.('destroyed', entry.destroyed);
    try {
      const result = await client.execute(sql, {}, null, false, false);
      if (entry.closed || getClient() !== client || owner.isDestroyed?.()) throw unavailable();
      if (!Array.isArray(result.rows)) throw unavailable();
      entry.rows = result.rows;
      entry.count = result.rows.length;
      snapshots.set(entry.id, entry);
      touch(entry);
      return { exportId: entry.id, rowCount: entry.count };
    } catch (error) {
      remove(entry);
      throw error;
    }
  }
  function read(owner, id, offset, limit) {
    const entry = snapshots.get(id);
    if (!entry || entry.owner !== owner) throw unavailable();
    if (getClient() !== entry.client || owner.isDestroyed?.()) { remove(entry); throw unavailable(); }
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
      throw new Error('Invalid export chunk range.');
    }
    const rows = entry.rows.slice(offset, offset + limit);
    const done = offset + rows.length >= entry.count;
    if (done) remove(entry); else touch(entry);
    return { rows, done };
  }
  function close(owner, id) {
    const entry = snapshots.get(id);
    if (entry && entry.owner !== owner) throw unavailable();
    if (entry) remove(entry);
  }
  function clear() { for (const entry of Array.from(owners.values())) remove(entry); }
  return { open, read, close, clear };
}

module.exports = { createExportSnapshots };
