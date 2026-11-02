// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { EventEmitter } = require('node:events');
const { createExportSnapshots } = require('../../electron/services/exportSnapshots');

// Use the production snapshot service, replacing only the database/IPC transport.
function snapshotDesktop(invoke, dialect = 'postgresql') {
  const sender = new EventEmitter();
  const client = { execute: async (...args) => {
    const result = await invoke('execute-sql', ...args);
    if (!result.success) throw new Error(result.error);
    return result;
  } };
  const snapshots = createExportSnapshots({ getClient: () => client, getDialect: () => dialect, t: key => key });
  return { ipcRenderer: { async invoke(channel, ...args) {
    try {
      if (channel === 'open-data-export') return { success: true, ...await snapshots.open(sender, ...args) };
      if (channel === 'read-data-export') return { success: true, ...snapshots.read(sender, ...args) };
      if (channel === 'close-data-export') { snapshots.close(sender, ...args); return { success: true }; }
      return await invoke(channel, ...args);
    } catch (error) { return { success: false, error: error.message }; }
  } }, close: () => snapshots.clear() };
}

module.exports = { snapshotDesktop };
