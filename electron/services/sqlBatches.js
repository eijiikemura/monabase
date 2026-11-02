// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Associate cancellation with an owned script, even between individual statements.
function createSqlBatches(getClient) {
  const batches = new Map(), watched = new WeakSet();
  const owner = event => event?.sender?.id ?? 0;
  const get = (event, id) => {
    const batch = batches.get(id);
    if (!batch || batch.owner !== owner(event) || batch.client !== getClient()) throw new Error('SQL execution is no longer available.');
    return batch;
  };
  return {
    isReserved() { return [...batches.values()].some(batch => batch.client === getClient()); },
    begin(event, id) {
      for (const [key, batch] of batches) if (batch.client !== getClient()) batches.delete(key);
      if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || batches.has(id) || batches.size >= 64 || !getClient()) throw new Error('Invalid SQL execution request.');
      const batch = { owner: owner(event), client: getClient(), cancelled: false, active: false };
      batches.set(id, batch);
      if (event?.sender?.once && !watched.has(event.sender)) {
        watched.add(event.sender);
        const ownerId = batch.owner;
        event.sender.once('destroyed', () => {
          for (const [key, entry] of batches) if (entry.owner === ownerId) {
            entry.cancelled = true; batches.delete(key);
            if (entry.active) void entry.client.breakExecution().catch(() => {});
          }
        });
      }
    },
    end(event, id) { const batch = get(event, id); if (batch.active) throw new Error('SQL execution is still running.'); batches.delete(id); },
    enter(event, id) {
      if (!id) return null;
      const batch = get(event, id);
      if (batch.cancelled) throw new Error('SQL execution cancelled.');
      if (batch.active) throw new Error('SQL execution is already running.');
      batch.active = true;
      return batch;
    },
    cancel(event, id) {
      const selected = id ? [get(event, id)] : [...batches.values()].filter(batch => batch.owner === owner(event) && batch.client === getClient());
      selected.forEach(batch => { batch.cancelled = true; });
      return selected.some(batch => batch.active);
    }
  };
}
module.exports = { createSqlBatches };
