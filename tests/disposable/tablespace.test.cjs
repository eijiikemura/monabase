// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { loadModule } = require('../helpers/loadModule.cjs');
const { safeError } = require('../../electron/oracle/tablespaceManagement');
// Storage mutation requires a separately provisioned disposable database, never the ordinary integration config.
if (process.env.MONABASE_TABLESPACE_DISPOSABLE !== '1' || !process.env.MONABASE_TABLESPACE_TEST_CONFIG) throw Error('Explicit disposable database opt-in and a separate tablespace config are required.');
const config = JSON.parse(fs.readFileSync(process.env.MONABASE_TABLESPACE_TEST_CONFIG, 'utf8'));
if (config.disposableDatabase !== true || !config.expectedDatabase || !config.expectedContainer || !config.connection) throw Error('Declare the disposable database, container and connection explicitly.');
const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } } }, {}, { strict: false });
test('Disposable Oracle: create, resize and drop only a run-owned BIGFILE with OMF', { timeout: 300000 }, async () => {
  const client = new Client(), name = 'MBT_' + randomBytes(8).toString('hex').toUpperCase(); let attempted = false, identity = null, failure;
  const inspect = async () => {
    const snapshot = await client.listManagedTablespaces();
    assert.equal(snapshot.context.database, config.expectedDatabase); assert.equal(snapshot.context.containerName, config.expectedContainer);
    assert.equal(snapshot.context.omf, true); return snapshot;
  };
  const run = async request => { const plan = await client.reviewTablespaceOperation(request); assert.equal(plan.canExecute, true); return client.executeTablespaceOperation({ ...plan.request, token: plan.token, confirmName: name }); };
  try {
    await client.connect(config.connection); const before = await inspect(); assert.equal(before.tablespaces.some(row => row.name === name), false);
    const create = await client.reviewTablespaceOperation({ action: 'create', name, sizeMb: '16', autoExtend: false, bigfile: true, pathMode: 'omf' });
    attempted = true; await client.executeTablespaceOperation({ ...create.request, token: create.token });
    let target = (await inspect()).tablespaces.find(row => row.name === name); assert.ok(target); identity = target.id;
    await run({ action: 'resize', name, id: target.id, expected: target.fingerprint, sizeMb: '24', autoExtend: true, nextMb: '8', maxMb: '64' });
    target = (await inspect()).tablespaces.find(row => row.name === name); assert.equal(target.id, identity); assert.equal(target.allocatedMb, '24.00'); assert.equal(target.maxMb, '64.00');
    await run({ action: 'drop', name, id: target.id, expected: target.fingerprint }); assert.equal((await inspect()).tablespaces.some(row => row.name === name), false);
  } catch (error) { failure = safeError(error); }
  finally {
    try { if (attempted) { const target = (await inspect()).tablespaces.find(row => row.name === name); if (target) { assert.ok(!identity || target.id === identity, 'Do not delete a replaced tablespace'); await run({ action: 'drop', name, id: target.id, expected: target.fingerprint }); } } }
    catch (error) { failure = failure || safeError(error); }
    finally { await client.disconnect(); }
  }
  assert.equal(failure, undefined, JSON.stringify(failure));
});
