// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { loadModule } = require('./helpers/loadModule.cjs');
const { isReadOnlySql } = require('../electron/services/readOnlySql');

function loadClient(database, driver, globals = {}) {
  return loadModule(`electron/${database}/${database}Client.js`, {
    electron: { app: { isPackaged: true } }, '../i18n': { t: key => key },
    ...(database === 'postgres' ? { pg: { Client: driver, types: { setTypeParser() {} } } } : { oracledb: driver, './traceExecutor': {} })
  }, globals, { strict: false });
}

for (const dialect of ['oracle', 'postgresql']) {
  test(`${dialect}: read-only policy rejects procedural blocks, transaction changes, locking and multiple statements`, () => {
    const suffix = dialect === 'oracle' ? ' FROM DUAL' : '';
    for (const sql of [
      'UPDATE items SET value = 1', 'DO $$ BEGIN UPDATE items SET value = 1; END $$',
      'BEGIN READ WRITE', 'SET transaction_read_only = off', 'SHOW transaction_read_only; UPDATE items SET value = 1',
      `SELECT 1${suffix}; UPDATE items SET value = 1`, 'WITH changed AS (DELETE FROM items RETURNING *) SELECT * FROM changed',
      'SELECT * FROM items FOR UPDATE', 'SELECT * INTO new_table FROM items', 'CALL change_data()'
    ]) assert.equal(isReadOnlySql(sql, dialect), false, sql);
    for (const sql of [`SELECT 1${suffix}; -- trailing comment`, `SELECT 'UPDATE; DELETE'${suffix}`,
      `/* comment */ WITH x AS (SELECT 1 AS value${suffix}) SELECT * FROM x`,
      `WITH x(value) AS (SELECT 1${suffix}) SELECT * FROM x`]) assert.equal(isReadOnlySql(sql, dialect), true, sql);
  });
}

test('Oracle read-only policy permits builtins and metadata but rejects autonomous routines and sequences', () => {
  for (const sql of ["SELECT NVL(SUM(amount), 0), TO_CHAR(SYSDATE, 'YYYY') FROM items", "SELECT DBMS_METADATA.GET_DDL('TABLE', :name, :owner) FROM DUAL", "SELECT q'[it'; UPDATE x;]' FROM DUAL"]) assert.equal(isReadOnlySql(sql, 'oracle'), true, sql);
  for (const sql of ['SELECT change_data() FROM DUAL', 'SELECT /* /* */ change_data() FROM DUAL /* */', 'SELECT app.change_data() FROM DUAL', 'SELECT SYS.DBMS_METADATA.GET_DDL(:name) FROM DUAL', 'SELECT seq.NEXTVAL FROM DUAL', 'WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f() FROM DUAL']) assert.equal(isReadOnlySql(sql, 'oracle'), false, sql);
});

test('PostgreSQL read-only policy rejects quoted session mutators and remote execution', () => {
  for (const name of ['pg_terminate_backend', 'pg_cancel_backend', 'set_config', 'dblink_exec', 'pg_advisory_lock', 'pg_logical_emit_message']) {
    assert.equal(isReadOnlySql(`SELECT pg_catalog."${name}"(1)`, 'postgresql'), false, name);
  }
});

test('PostgreSQL configures every connection to default to read-only transactions', async () => {
  const connections = [];
  class Connection extends EventEmitter {
    constructor() { super(); this.queries = []; connections.push(this); }
    async connect() {}
    async query(sql) { this.queries.push(sql); return { rows: [{ pid: 1 }] }; }
    async end() {}
  }
  const Client = loadClient('postgres', Connection);
  const client = new Client();
  await client.connect({ readonly: true });
  assert.equal(connections.length, 7);
  for (const connection of connections) assert.equal(connection.queries[0], 'SET default_transaction_read_only = on');
  await client.disconnect();
});

test('Oracle refuses SYS read-only connections and closes the rejected connection', async () => {
  let closed = false;
  const Client = loadClient('oracle', { async getConnection() {
    return { async execute() { return { rows: [{ USERNAME: 'SYS' }] }; }, async close() { closed = true; } };
  } });
  const client = new Client();
  await assert.rejects(client.connect({ readonly: true }), /read_only_requires_non_sys_user/);
  assert.equal(closed, true);
  assert.equal(client.connection, null);
});

for (const database of ['postgres', 'oracle']) {
  test(`${database}: background pool failure closes partially created connections`, async () => {
    const connections = [];
    class Connection extends EventEmitter {
      constructor() { super(); this.id = connections.length; this.closed = false; connections.push(this); }
      async connect() { if (this.id === 4) throw new Error('Simulated connection limit'); }
      async query() { return { rows: [{ pid: 1 }] }; }
      async execute() { return { rows: [] }; }
      async end() { this.closed = true; }
      async close() { this.closed = true; }
    }
    const driver = database === 'postgres' ? Connection : {
      async getConnection() { if (connections.length === 4) throw new Error('Simulated connection limit'); return new Connection(); }
    };
    const Client = loadClient(database, driver, { console: { ...console, warn() {} } });
    const client = new Client();
    await client.connect({ host: 'unused' });
    assert.equal(client.bgPool.length, 0);
    const backgroundStart = database === 'postgres' ? 2 : 1;
    assert.ok(connections.slice(backgroundStart).every(connection => connection.closed));
    await client.disconnect();
    assert.ok(connections.every(connection => connection.closed));
  });

  test(`${database}: failed SSH setup and failed database authentication close the tunnel`, async () => {
    const driver = database === 'postgres' ? class extends EventEmitter {
      async connect() { throw new Error('Simulated authentication failure'); }
      async end() { await new Promise(resolve => setTimeout(resolve, 5)); }
    } : { async getConnection() { throw new Error('Simulated authentication failure'); } };
    const Client = loadClient(database, driver);
    for (const failSsh of [true, false]) {
      const client = new Client();
      let sshClosed = false, listenerClosed = false;
      client.setupSshTunnel = async () => {
        client.sshClient = { end() { sshClosed = true; } };
        client.sshServer = { close() { listenerClosed = true; } };
        if (failSsh) throw new Error('Simulated SSH failure');
      };
      await assert.rejects(client.connect({ host: 'unused', useSshTunnel: true }));
      assert.equal(sshClosed, true); assert.equal(listenerClosed, true);
      assert.equal(client.sshClient, null); assert.equal(client.sshServer, null);
    }
  });

  test(`${database}: read-only queries use a DB read-only transaction on main and background connections`, async () => {
    const Client = loadClient(database, database === 'postgres' ? class {} : {});
    for (const background of [false, true]) {
      const queries = [];
      const connection = new EventEmitter();
      connection.getTransactionStatus = () => 'I';
      connection.query = async sql => { queries.push(sql); return { rows: [], fields: [], command: 'SELECT' }; };
      connection.execute = async sql => { queries.push(sql); return { rows: [], metaData: [] }; };
      connection.rollback = async () => { queries.push('ROLLBACK'); };
      const client = new Client(); client.isReadonly = true;
      if (database === 'postgres') { client.client = connection; client.bgPool = [{ id: 1, client: connection, isExecuting: false }]; }
      else { client.connection = connection; client.bgPool = [{ id: 1, conn: connection, isExecuting: false }]; }
      const query = database === 'postgres' ? 'SELECT 1' : 'SELECT 1 FROM DUAL';
      await client.execute(query, {}, null, false, background);
      assert.deepEqual(queries, [database === 'postgres' ? 'BEGIN READ ONLY' : 'SET TRANSACTION READ ONLY', query, 'ROLLBACK']);
      queries.length = 0;
      await assert.rejects(client.execute('DO $$ BEGIN UPDATE items SET value = 1; END $$', {}, null, false, background));
      assert.equal(queries.length, 0);
      assert.equal((await client.killSession(1, 1)).success, false);
      assert.equal((await client.cancelSQL(1, 1)).success, false);
    }
  });

  test(`${database}: a failed read-only query rolls back and releases the connection for the next read`, async () => {
    const Client = loadClient(database, database === 'postgres' ? class {} : {});
    const client = new Client(); client.isReadonly = true;
    const queries = [];
    const connection = new EventEmitter();
    const failingQuery = database === 'postgres' ? 'SELECT missing_column' : 'SELECT missing_column FROM DUAL';
    const execute = async sql => {
      queries.push(sql);
      if (sql === failingQuery) throw new Error('Simulated SQL error');
      return { rows: [], metaData: [], command: 'SELECT', fields: [] };
    };
    connection.query = execute; connection.execute = execute;
    connection.rollback = async () => queries.push('ROLLBACK');
    connection.getTransactionStatus = () => 'I';
    if (database === 'postgres') client.client = connection;
    else client.connection = connection;
    await assert.rejects(client.execute(failingQuery), /Simulated SQL error/);
    assert.equal(queries.at(-1), 'ROLLBACK');
    assert.equal(client.isExecuting, false);
    await client.execute(database === 'postgres' ? 'SELECT 1' : 'SELECT 1 FROM DUAL');
    assert.equal(queries.filter(sql => sql === 'ROLLBACK').length, 2);
  });
}

test('Oracle retries only read-only ORA-01466 once with a fresh read-only snapshot', async () => {
  for (const readonly of [true, false]) {
    const Client = loadClient('oracle', {}, { setTimeout: callback => callback() });
    const client = new Client(); client.isReadonly = readonly;
    const query = 'SELECT value FROM items', queries = [];
    let attempts = 0;
    client.connection = {
      async execute(sql) {
        queries.push(sql);
        if (sql === query && ++attempts === 1) throw Object.assign(new Error('Stale snapshot'), { errorNum: 1466 });
        return { rows: [], metaData: [] };
      },
      async rollback() { queries.push('ROLLBACK'); }
    };
    if (readonly) {
      await client.execute(query);
      assert.equal(attempts, 2);
      assert.deepEqual(queries, ['SET TRANSACTION READ ONLY', query, 'ROLLBACK', 'SET TRANSACTION READ ONLY', query, 'ROLLBACK']);
    } else {
      await assert.rejects(client.execute(query), /Stale snapshot/);
      assert.equal(attempts, 1);
      assert.deepEqual(queries, [query]);
    }
  }
});

test('Oracle surfaces persistent ORA-01466 after one retry and rolls back its read-only transaction', async () => {
  const Client = loadClient('oracle', {}, { setTimeout: callback => callback() });
  const client = new Client(); client.isReadonly = true;
  let attempts = 0, rollbacks = 0;
  client.connection = {
    async execute(sql) {
      if (sql.startsWith('SELECT')) { attempts++; throw Object.assign(new Error('Stale snapshot'), { errorNum: 1466 }); }
      return {};
    },
    async rollback() { rollbacks++; }
  };
  await assert.rejects(client.execute('SELECT value FROM items'), /Stale snapshot/);
  assert.equal(attempts, 2); assert.equal(rollbacks, 2); assert.equal(client.isExecuting, false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function connectionHarness(Client) {
  const handlers = new Map(), state = { client: null, type: null };
  const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', {
    '../oracle/traceDb': {}, '../postgres/traceDb': {},
    '../oracle/oracleClient': Client, '../postgres/postgresClient': Client,
    '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {}
  }, {}, { strict: false });
  registerDatabaseHandlers({ state, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getValidatedSettings: () => ({ queryTimeout: 0 }), t: key => key });
  return { state, invoke: (channel, ...args) => handlers.get(channel)(null, ...args) };
}

test('Overlapping connects serialize a late failure before publishing the successful next connection', async () => {
  const firstStarted = deferred(), firstResult = deferred(), candidates = [];
  class Candidate {
    constructor() { this.closed = false; candidates.push(this); }
    async connect(config) {
      this.name = config.name;
      if (config.name === 'first') { firstStarted.resolve(); await firstResult.promise; }
    }
    async disconnect() { this.closed = true; }
  }
  const h = connectionHarness(Candidate);
  const first = h.invoke('connect-db', { dbType: 'oracle', name: 'first' });
  await firstStarted.promise;
  assert.equal(h.state.client, null, 'An incomplete connection must not be exposed');
  const second = h.invoke('connect-db', { dbType: 'postgresql', name: 'second' });
  assert.equal(candidates.length, 1);
  firstResult.reject(new Error('Simulated late failure'));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.success, false); assert.equal(b.success, true);
  assert.equal(candidates[0].closed, true);
  assert.equal(h.state.client, candidates[1]); assert.equal(h.state.type, 'postgresql');
  await h.invoke('disconnect-db');
});

test('A queued disconnect waits for an in-flight connect and closes the completed candidate', async () => {
  const started = deferred(), result = deferred(); let closed = false;
  class Candidate {
    async connect() { started.resolve(); await result.promise; }
    async disconnect() { closed = true; }
  }
  const h = connectionHarness(Candidate);
  const connecting = h.invoke('connect-db', { dbType: 'oracle' });
  await started.promise;
  const disconnecting = h.invoke('disconnect-db');
  assert.equal(closed, false); assert.equal(h.state.client, null);
  result.resolve();
  await Promise.all([connecting, disconnecting]);
  assert.equal(closed, true); assert.equal(h.state.client, null); assert.equal(h.state.type, null);
});

test('A connect queued behind a slow disconnect is published only after cleanup completes', async () => {
  const started = deferred(), result = deferred(); const candidates = [];
  class Candidate {
    constructor() { this.id = candidates.length; candidates.push(this); }
    async connect() {}
    async disconnect() { if (this.id === 0) { started.resolve(); await result.promise; } }
  }
  const h = connectionHarness(Candidate);
  await h.invoke('connect-db', { dbType: 'oracle' });
  const disconnecting = h.invoke('disconnect-db');
  await started.promise;
  const connecting = h.invoke('connect-db', { dbType: 'postgresql' });
  assert.equal(h.state.client, null); assert.equal(candidates.length, 1);
  result.resolve(); await Promise.all([disconnecting, connecting]);
  assert.equal(h.state.client, candidates[1]); assert.equal(h.state.type, 'postgresql');
  await h.invoke('disconnect-db');
});

test('The connection queue survives rejected cleanup and unsupported requests preserve an active connection', async () => {
  let failCleanup = true;
  class Candidate {
    async connect() {}
    async disconnect() { if (failCleanup) { failCleanup = false; throw new Error('Simulated cleanup failure'); } }
  }
  const h = connectionHarness(Candidate);
  await h.invoke('connect-db', { dbType: 'oracle' });
  await assert.rejects(h.invoke('disconnect-db'), /Simulated cleanup failure/);
  assert.equal((await h.invoke('connect-db', { dbType: 'postgresql' })).success, true);
  const active = h.state.client;
  assert.equal((await h.invoke('connect-db', { dbType: 'unsupported' })).success, false);
  assert.equal(h.state.client, active); assert.equal(h.state.type, 'postgresql');
  await h.invoke('disconnect-db');
});

test('PostgreSQL metadata methods acquire and release real background-client slots and preserve exact names', async () => {
  const Client = loadClient('postgres', class {});
  const client = new Client(), requests = [];
  const slot = { id: 1, isExecuting: false, client: { async query(...args) {
    requests.push(args);
    if (args[0].includes("current_setting('server_version_num')")) return { rows: [{ database: 'demo', database_id: '5', reader_pid: 12, version: 160000, superuser: false, signal: false }] };
    return { rows: args[0].includes('column_name') ? [{ COLUMN_NAME: 'N"ame' }] : [] };
  } } };
  client.bgPool = [slot];
  client.client = {};
  assert.equal((await client.getColumns("Team's Data", 'OrderItems'))[0], 'N"ame');
  assert.equal(JSON.stringify(requests[0][1]), JSON.stringify(["Team's Data", 'OrderItems']));
  for (const kind of ['TABLE', 'VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'MATERIALIZED VIEW', 'INDEX', 'TRIGGER', 'TYPE']) {
    await client.getObjects("Team's Data", kind);
    const [query, values] = requests.at(-1);
    assert.ok(!query.includes("Team's Data")); assert.ok(query.includes('$1'));
    assert.equal(values[0], "Team's Data"); assert.equal(slot.isExecuting, false);
  }
  const beforeUnsupported = requests.length;
  await client.getObjects('test', 'UNSUPPORTED');
  assert.equal(requests.length, beforeUnsupported);
  assert.equal(slot.isExecuting, false, 'Unsupported kinds must not reserve a background slot');
  await client.getSessions(); await client.getLocks();
  assert.equal(slot.isExecuting, false);
  slot.client.query = async () => { throw new Error('Simulated metadata error'); };
  for (const operation of [() => client.getObjects('test', 'TABLE'), () => client.getColumns('test', 'Items'), () => client.getSessions(), () => client.getLocks()]) {
    await assert.rejects(operation(), /Simulated metadata error/);
    assert.equal(slot.isExecuting, false);
  }
});

test('Failed disconnects remain available for retry and block new connections until cleanup succeeds', async () => {
  const attempts = [], connected = [];
  let refuse = true, nextId = 0;
  class Candidate {
    constructor() { this.id = nextId++; }
    async connect() { connected.push(this.id); }
    async disconnect() {
      attempts.push(this.id);
      if (this.id === 0 && refuse) throw new Error('Simulated persistent cleanup failure');
    }
  }
  const h = connectionHarness(Candidate);
  await h.invoke('connect-db', { dbType: 'oracle' });
  await assert.rejects(h.invoke('disconnect-db'), /persistent cleanup failure/);
  assert.equal(h.state.client, null); assert.equal(h.state.type, null);
  assert.equal((await h.invoke('connect-db', { dbType: 'postgresql' })).success, false);
  assert.deepEqual(connected, [0]);
  await assert.rejects(h.invoke('disconnect-db'), /persistent cleanup failure/);
  assert.equal(attempts.filter(id => id === 0).length, 3);
  refuse = false;
  assert.equal(await h.invoke('disconnect-db'), true);
  assert.equal(attempts.filter(id => id === 0).length, 4);
  assert.equal((await h.invoke('connect-db', { dbType: 'postgresql' })).success, true);
  assert.equal(connected.length, 2);
  await h.invoke('disconnect-db');
});
