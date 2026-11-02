// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { loadModule } = require('../helpers/loadModule.cjs');
const { safeError } = require('../../electron/oracle/pdbManagement');

// Never use the ordinary integration config or run destructive PDB tests by default.
if (process.env.MONABASE_PDB_DISPOSABLE !== '1' || !process.env.MONABASE_PDB_TEST_CONFIG) {
  throw new Error('Explicit disposable-CDB opt-in and a separate config file are required. See docs/TESTING.md.');
}
const config = JSON.parse(fs.readFileSync(process.env.MONABASE_PDB_TEST_CONFIG, 'utf8'));
if (config.disposableCdb !== true || !config.expectedDatabase || config.connection?.useSysdba !== true) {
  throw new Error('A disposable CDB, expected database identity and SYSDBA connection must be explicitly configured.');
}
const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
test('Disposable CDB: create, open, close and drop only this run-owned PDB', { timeout: 600000 }, async () => {
  const client = new Client(), name = 'MBT_' + randomBytes(8).toString('hex').toUpperCase();
  let createAttempted = false, guid = null, failure;
  const run = async request => {
    const plan = await client.reviewPdbOperation(request);
    assert.equal(plan.canExecute, true);
    return client.executePdbOperation({ ...request, token: plan.token, confirmName: name, password: 'Mb1_' + randomBytes(16).toString('hex') });
  };
  try {
    await client.connect(config.connection);
    const access = await client.inspectPdbAccess();
    assert.equal(access.container, 'CDB$ROOT'); assert.equal(access.database, config.expectedDatabase); assert.equal(access.sysdba, true);
    let snapshot = await client.listManagedPdbs();
    assert.equal(snapshot.context.omf, true, 'The disposable CDB must have Oracle Managed Files configured.');
    assert.equal(snapshot.pdbs.some(row => row.name === name), false);
    createAttempted = true;
    snapshot = (await run({ action: 'create', name, user: 'MBT_ADMIN', pathMode: 'omf' })).snapshot;
    let pdb = snapshot.pdbs.find(row => row.name === name); assert.ok(pdb); guid = pdb.id;
    assert.equal(pdb.openMode, 'MOUNTED');
    snapshot = (await run({ action: 'open', target: name, expected: pdb.fingerprint })).snapshot;
    pdb = snapshot.pdbs.find(row => row.name === name); assert.equal(pdb.id, guid); assert.equal(pdb.openMode, 'READ WRITE');
    snapshot = (await run({ action: 'close', target: name, expected: pdb.fingerprint })).snapshot;
    pdb = snapshot.pdbs.find(row => row.name === name); assert.equal(pdb.openMode, 'MOUNTED');
    snapshot = (await run({ action: 'drop', target: name, expected: pdb.fingerprint })).snapshot;
    assert.equal(snapshot.pdbs.some(row => row.name === name), false);
  } catch (error) { failure = safeError(error); }
  finally {
    try {
      if (createAttempted) {
        let pdb = (await client.listManagedPdbs()).pdbs.find(row => row.name === name);
        if (pdb) {
          if (guid) assert.equal(pdb.id, guid, 'Never clean up a replacement PDB.');
          assert.match(pdb.name, /^MBT_[0-9A-F]{16}$/);
          if (pdb.openMode !== 'MOUNTED' && pdb.status !== 'UNPLUGGED') {
            await run({ action: 'close', target: name, expected: pdb.fingerprint });
            pdb = (await client.listManagedPdbs()).pdbs.find(row => row.name === name);
          }
          await run({ action: 'drop', target: name, expected: pdb.fingerprint });
        }
      }
    } catch (error) { failure = { ...safeError(error), cleanupFailed: true }; }
    try { await client.disconnect(); } catch { failure = { ...failure, cleanupFailed: true }; }
  }
  if (failure) throw new Error('Disposable PDB test failed: ' + JSON.stringify(failure));
});
