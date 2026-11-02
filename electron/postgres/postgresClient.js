// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readCredentialFile } = require('../services/credentialFiles');
const { postgresTlsOptions } = require('./tlsOptions');
const triggerDefinition = require('./triggerDefinition');
const { t } = require('../i18n');
const { isReadOnlySql } = require('../services/readOnlySql');
const { connectVerifiedSsh } = require('../services/sshHostKeys');

const { Client, types } = require('pg');
const { randomUUID } = require('node:crypto');
const { scanSql } = require('../services/sqlTokens');
const { bindSql, classifySql } = require('./sqlText');
const { app } = require('electron');
const SshClient = require('ssh2').Client; 
const net = require('net');               

// Exact PostgreSQL integers/decimals cross IPC as strings, including array elements.
types.setTypeParser(20, value => value);
types.setTypeParser(1700, value => value);
// Keep timestamp microseconds and timezone offsets intact across IPC.
for (const oid of [1082, 1114, 1184]) types.setTypeParser(oid, value => value);
for (const oid of [1182, 1115, 1185]) types.setTypeParser(oid, value => types.getTypeParser(1009, 'text')(value));
// PostgreSQL arrays use the same quoting/NULL grammar as text arrays.
types.setTypeParser(1231, value => types.getTypeParser(1009, 'text')(value));

function resolveLocalhost(hostStr) {
  if (!hostStr) return hostStr;
  const cleanHost = hostStr.trim().toLowerCase();
  if (cleanHost === 'localhost' || cleanHost === '[localhost]') {
    return '127.0.0.1';
  }
  return hostStr;
}

class PostgresClient {
  constructor({ createSshHostVerifier = () => () => false } = {}) {
    this.createSshHostVerifier = createSshHostVerifier;
    this.client = null;
    this.metaClient = null;
    this.bgPool = [];
    this.BG_POOL_SIZE = 5;

    this.lastConfig = null;
    this.hasUncommittedTx = false;
    this.isReadonly = false;
    this.currentPid = null;

    this.sshClient = null;
    this.sshServer = null;
    this.localSshPort = null;

    this.isExecuting = false;
  }

  async setupSshTunnel(config) {
    const privateKey = config.sshAuthType === 'key' ? await readCredentialFile(config.sshKeyFile, 'ssh-private-key') : undefined;
    return new Promise((resolve, reject) => {
      this.sshClient = new SshClient();

      const sshConfig = {
        host: config.sshHost,
        port: parseInt(config.sshPort, 10) || 22,
        username: config.sshUser,
        readyTimeout: 30000,
        keepaliveInterval: 5000, 
        keepaliveCountMax: 3
      };

      if (config.sshAuthType === 'key') {
        sshConfig.privateKey = privateKey;
        if (config.sshPassword) sshConfig.passphrase = config.sshPassword;
      } else {
        sshConfig.password = config.sshPassword;
        sshConfig.tryKeyboard = true; 
      }

      this.sshClient.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        if (prompts.length > 0 && config.sshPassword) {
          finish([config.sshPassword]);
        } else {
          finish([]);
        }
      });

      this.sshClient.on('ready', () => {
        this.sshServer = net.createServer((sock) => {
          sock.setKeepAlive(true, 5000); 
          sock.on('error', (sockErr) => { console.error('Local Socket Error:', sockErr); });

          const targetDbHost = config.host || '127.0.0.1';

          this.sshClient.forwardOut(
            '127.0.0.1', sock.remotePort, targetDbHost, parseInt(config.port, 10) || 5432,
            (err, stream) => {
              if (err) {
                console.error(t("ssh_tunnel_error_forwarding_to_failed_details", { value0: targetDbHost, value1: err.message }));
                sock.end(); return;
              }
              sock.pipe(stream);
              stream.pipe(sock);
              stream.on('error', (streamErr) => { console.error('SSH Stream Error:', streamErr); sock.end(); });
            }
          );
        });

        this.sshServer.listen(0, '127.0.0.1', () => {
          this.localSshPort = this.sshServer.address().port;
          resolve();
        });
        this.sshServer.on('error', (err) => { reject(err); });
      }).on('error', (err) => {
        reject(new Error(t("ssh_connection_error") + err.message));
      });
      connectVerifiedSsh(this.sshClient, sshConfig, this.createSshHostVerifier, t);
    });
  }

  async connect(config) {

    const safeConfig = {
      ...config,
      host: resolveLocalhost(config.host),
      sshHost: config.useSshTunnel ? resolveLocalhost(config.sshHost) : config.sshHost
    };

    this.lastConfig = safeConfig;
    this.isReadonly = safeConfig.readonly === true;

    for (const bg of this.bgPool) {
      try { await bg.client.end(); } catch (e) {}
    }
    this.bgPool = [];

    try {
      const ssl = await postgresTlsOptions(safeConfig);
      let targetHost = safeConfig.host;
      let targetPort = safeConfig.port || 5432;

      if (safeConfig.useSshTunnel) {
        await this.setupSshTunnel(safeConfig);
        targetHost = '127.0.0.1';
        targetPort = this.localSshPort;
      }

      const timeoutMillis = (safeConfig.queryTimeout !== undefined && safeConfig.queryTimeout > 0)
        ? safeConfig.queryTimeout * 1000 : 0;

      const baseClientConfig = {
        ssl,
        host: targetHost, port: targetPort, database: safeConfig.database, user: safeConfig.user, password: safeConfig.password,
        keepAlive: true, keepAliveInitialDelayMillis: 5000,
        query_timeout: timeoutMillis > 0 ? timeoutMillis : undefined,
        statement_timeout: timeoutMillis > 0 ? timeoutMillis : undefined
      };

      this.client = new Client(baseClientConfig);
      this.metaClient = new Client({ ...baseClientConfig, query_timeout: 120000, statement_timeout: 120000 });

      this.client.on('error', (err) => { console.error('PostgreSQL Main Client Error:', err.message); this.disconnect(); });
      this.metaClient.on('error', (err) => { console.error('PostgreSQL Meta Client Error (Non-fatal):', err.message); });
      await this.client.connect();
      await this.metaClient.connect(); 
      if (this.isReadonly) {
        await this.client.query('SET default_transaction_read_only = on');
        await this.metaClient.query('SET default_transaction_read_only = on');
      }

      try {
        for (let i = 0; i < this.BG_POOL_SIZE; i++) {
          const bgCli = new Client({ ...baseClientConfig, query_timeout: 120000, statement_timeout: 120000 });
          bgCli.on('error', (err) => { console.error(`PostgreSQL BG Client [${i + 1}] Error:`, err.message); });
          this.bgPool.push({
            id: i + 1,
            client: bgCli,
            isExecuting: false
          });
          await bgCli.connect();
          if (this.isReadonly) await bgCli.query('SET default_transaction_read_only = on');
        }
      } catch (bgErr) {
        console.warn("[PostgresClient] Background pool creation failed, proceeding with main connection:", bgErr);
        for (const bg of this.bgPool) {
          try { await bg.client.end(); } catch { /* Already failed connections may reject cleanup. */ }
        }
        this.bgPool = [];
      }

      const pidRes = await this.client.query('SELECT pg_backend_pid() AS pid');
      this.currentPid = pidRes.rows[0].pid;

      try {
        await this.client.query("SET statement_timeout = '2s'");
        await this.client.query("SELECT 1");
        await this.client.query("RESET statement_timeout");
      } catch (warmupErr) {
        try { await this.client.query("RESET statement_timeout"); } catch(e) {}
      }
    } catch (e) {
      await this.disconnect();
      throw new Error(t("connection_error_3") + e.message);
    }
  }

  async disconnect() {
    if (this.client) { try { await this.client.end(); } catch (e) {} this.client = null; }
    if (this.metaClient) { try { await this.metaClient.end(); } catch (e) {} this.metaClient = null; }

    for (const bg of this.bgPool) {
      try { await bg.client.end(); } catch (e) {}
    }
    this.bgPool = [];

    this.hasUncommittedTx = false;
    this.currentPid = null;
    this.activityScopeMain = null; this.activityScope = null;
    this.tablespaceScopeMain = null; this.tablespaceScope = null; this.tablespaceManager = null;
    this.privilegeScopeMain = null; this.privilegeScope = null; this.privilegeManager = null; this.schemaManager = null; this.roleManager = null;
    this.isExecuting = false;

    if (this.sshServer) { this.sshServer.close(); this.sshServer = null; }
    if (this.sshClient) { this.sshClient.end(); this.sshClient = null; }
  }

  async getAvailableBgClient() {
    if (this.bgPool.length === 0) return null;

    while (true) {
      if (this.bgPool.length === 0) throw new Error(t("no_background_connection_is_available"));
      const available = this.bgPool.find(bg => !bg.isExecuting);
      if (available) {
        available.isExecuting = true;
        return available;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async breakExecution() {
    if (!this.lastConfig || !this.currentPid) return { success: false, error: "キャンセルのための情報が不足しています。" };
    let cancelClient = null;
    let targetHost = this.lastConfig.host;
    let targetPort = this.lastConfig.port || 5432;
    if (this.lastConfig.useSshTunnel && this.localSshPort) { targetHost = '127.0.0.1'; targetPort = this.localSshPort; }
    try {
      cancelClient = new Client({ ssl: await postgresTlsOptions(this.lastConfig), host: targetHost, port: targetPort, database: this.lastConfig.database, user: this.lastConfig.user, password: this.lastConfig.password, query_timeout: 10000 });
      await cancelClient.connect();
      await cancelClient.query('SELECT pg_cancel_backend($1)', [this.currentPid]);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; } finally { if (cancelClient) await cancelClient.end(); }
  }

  async resetConnection() {
    await this.disconnect();
    if (this.lastConfig) await this.connect(this.lastConfig);
  }

  async getDbVersion() {
    if (!this.metaClient) return t("database_not_connected");
    try {
      const res = await this.metaClient.query('SELECT version();');
      const socket = this.client?.connection?.stream;
      const transport = socket?.encrypted ? socket.authorized ? 'security_tls_verified' : 'security_tls_unverified' : 'security_tls_disabled';
      return res.rows[0].version + ' · ' + t(transport);
    } catch (err) { return t("failed_to_retrieve_version_information") + err.message; }
  }

  // Check the connection's actual state, including transactions after errors.
  // Do not assume there are no uncommitted changes when the state is unknown.
  getMainTransactionState() {
    try {
      if (this.client?.readyForQuery === false) return undefined;
      const status = this.client?.getTransactionStatus?.();
      if (!['I', 'T', 'E'].includes(status)) return undefined;
      const state = status !== 'I';
      this.hasUncommittedTx = state;
      return state;
    } catch {
      return undefined;
    }
  }

  // Wait for completion if an error event arrives before the connection state update.
  // Stop waiting on disconnect or timeout and treat the state as unknown.
  async waitForQueryCompletion(client) {
    if (client?.readyForQuery !== false) return;
    await new Promise(resolve => {
      const finish = () => {
        clearTimeout(timeout);
        client.removeListener('drain', finish);
        client.removeListener('error', finish);
        client.removeListener('end', finish);
        resolve();
      };
      const timeout = setTimeout(finish, 2000);
      client.once('drain', finish);
      client.once('error', finish);
      client.once('end', finish);
    });
  }

  async executeStored({ schema, objectName, objectType, signature, args, argumentModes, inputDateFormat }) {
    if (this.isReadonly) throw new Error(t("procedure_function_and_package_execution_is_blocked_in_read_only_mode"));
    const quote = name => `"${name.replace(/"/g, '""')}"`;
    const binds = { schema, name: objectName, kind: objectType === 'PROCEDURE' ? 'p' : 'f' };
    if (signature !== undefined) binds.routine = `${quote(schema)}.${quote(objectName)}(${signature})`;
    const metadata = await this.execute(`SELECT p.proargnames AS names, p.proargmodes AS modes, p.pronargs, p.pronargdefaults,
      (SELECT count(*) FROM pg_proc other WHERE other.pronamespace = p.pronamespace AND other.proname = p.proname AND other.prokind = p.prokind) AS overloads,
      ARRAY(SELECT format_type(arg, NULL) FROM unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) arg) AS types
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = :schema AND p.proname = :name AND p.prokind = :kind
      ${signature !== undefined ? 'AND p.oid = to_regprocedure(:routine)' : ''}`, binds, null, false, true);
    if (metadata.rows.length !== 1) throw new Error(t('routine_selection_required'));
    const selected = metadata.rows[0];
    const values = {};
    const expressions = [];
    const format = (inputDateFormat || 'YYYY-MM-DD HH:mm:ss').replace(/HH/g, 'HH24').replace(/hh/g, 'HH12').replace(/mm/g, 'MI').replace(/ss/g, 'SS');
    let inputIndex = 0, omitted = false;
    selected.types.forEach((type, index) => {
      const mode = selected.modes?.[index] || 'i';
      if (['o', 't'].includes(mode) && objectType === 'FUNCTION') return;
      const key = `value${index}`, name = selected.names?.[index] || `ARG${index + 1}`;
      const requested = argumentModes?.[name];
      if (mode !== 'o' && mode !== 't') inputIndex++;
      if (requested === 'default') {
        if (mode === 'o' || inputIndex <= Number(selected.pronargs) - Number(selected.pronargdefaults) || Number(selected.overloads) !== 1) throw new Error(t('routine_default_ambiguous'));
        omitted = true; return;
      }
      const value = mode === 'o' ? null : args[name];
      values[key] = value === undefined || (value === '' && requested !== 'value') ? null : value;
      if (/^(date|timestamp)/i.test(type) && values[key] !== null) {
        values.format = format;
        expressions.push(`CAST(to_timestamp(:${key}, :format) AS ${type})`);
      } else expressions.push(`${mode === 'v' ? 'VARIADIC ' : ''}CAST(:${key} AS ${type})`);
      if (omitted) {
        if (!selected.names?.[index] || mode === 'v') throw new Error(t('routine_default_ambiguous'));
        expressions[expressions.length - 1] = `${quote(name)} => ${expressions.at(-1)}`;
      }
    });
    const call = `${quote(schema)}.${quote(objectName)}(${expressions.join(', ')})`;
    const result = await this.execute(objectType === 'PROCEDURE' ? `CALL ${call}` : `SELECT * FROM ${call}`, values);
    return { returnValues: Object.entries(result.rows[0] || {}).map(([name, value]) => ({ name, value })), dbmsOutput: result.notices || [] };
  }

  // Apply related DDL on one reserved main connection; never split a replacement across pool clients.
  async executeDdlBatch(statements) {
    if (!Array.isArray(statements) || !statements.length || statements.length > 20) throw new Error('Invalid DDL batch.');
    for (const statement of statements) {
      if (typeof statement !== 'string') throw new Error('Invalid DDL statement.');
      const tokens = scanSql(statement);
      const end = tokens.findIndex(token => token.kind === 'symbol' && token.text === ';');
      if (!tokens.length || !['CREATE', 'ALTER', 'DROP'].includes(tokens[0].text.toUpperCase()) ||
          (end >= 0 && end !== tokens.length - 1)) throw new Error('Expected one DDL statement per batch entry.');
    }
    return this.runDdlTransaction(async connection => {
      for (const text of statements) await connection.query({ text, queryMode: 'extended' });
    });
  }

  async getTriggerDefinition(request) {
    triggerDefinition.validateIdentity(request);
    const result = await this.execute(triggerDefinition.metadataSql, triggerDefinition.args(request), null, false, true);
    if (result.rows.length !== 1) throw new Error('Trigger could not be uniquely resolved.');
    return { ...result.rows[0], when_condition: triggerDefinition.triggerWhen(result.rows[0].trigger_ddl) };
  }

  async saveTriggerDefinition(request) {
    triggerDefinition.validateIdentity(request);
    return this.runDdlTransaction(connection => triggerDefinition.saveTrigger(connection, request));
  }

  async runDdlTransaction(operation) {
    if (this.isReadonly) throw new Error(t('cannot_modify_data_or_structure_while_connected_in_read_only_mode'));
    while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
    const connection = this.client;
    if (!connection) throw new Error(t('database_not_connected'));
    this.isExecuting = true;
    let started = false;
    try {
      const status = connection.getTransactionStatus?.();
      if (!['I', 'T', 'E'].includes(status)) throw new Error('Cannot determine transaction state before DDL.');
      // Keep the existing Oracle-compatible pre-DDL commit policy for earlier main edits.
      if (status !== 'I') await connection.query('COMMIT');
      await connection.query('BEGIN'); started = true;
      await operation(connection);
      await connection.query('COMMIT'); started = false;
    } catch (error) {
      if (started) {
        try { await connection.query('ROLLBACK'); }
        catch (cleanupError) {
          // An uncertain transaction must not be returned to the application for reuse.
          if (this.client === connection) this.client = null;
          try { await connection.end(); } catch { /* Preserve both execution and rollback errors. */ }
          throw new AggregateError([error, cleanupError], 'DDL failed and rollback failed; reconnect before retrying.');
        }
      }
      throw error;
    } finally {
      this.getMainTransactionState();
      this.isExecuting = false;
    }
  }

  async execute(sqlText, binds = {}, schema = null, _isRetry = false, isBackground = false) {
    if (!this.client) throw new Error(t("database_not_connected"));

    let activeClientObj = null;

    if (isBackground === true && this.bgPool.length > 0) {
      activeClientObj = await this.getAvailableBgClient();
    } else {
      while (this.isExecuting) { await new Promise(resolve => setTimeout(resolve, 50)); }
      this.isExecuting = true;
      activeClientObj = { client: this.client, id: 'MAIN' };
    }

    const activeClient = activeClientObj.client;
    let savepoint = null;
    let readOnlyTransaction = false;

    try {
      if (!app.isPackaged) {
        const label = activeClientObj.id === 'MAIN' ? '[PostgresClient Main Execute]' : `[PostgresClient BG Execute - Pool ID: ${activeClientObj.id}]`;
        console.log(`\n${label}`);
        // Do not log SQL text; it can contain credentials or production data.
        console.log('[postgres] Executing SQL.');
      }

      const { text: pgSql, values: pgValues } = bindSql(sqlText, binds);
      const { firstWord, isDml, canUseSavepoint } = classifySql(sqlText);
      if (this.isReadonly && !isReadOnlySql(sqlText, 'postgresql')) {
        throw new Error(t("cannot_modify_data_or_structure_while_connected_in_read_only_mode"));
      }
      if (this.isReadonly) {
        await activeClient.query('BEGIN READ ONLY');
        readOnlyTransaction = true;
      }

      // Base existing behavior, such as automatic BEGIN, on the target connection's state.
      const transactionStatus = activeClient.getTransactionStatus?.();
      if (isDml && transactionStatus === 'I') {
          await activeClient.query('BEGIN');
      } else if (activeClientObj.id === 'MAIN' && ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE'].includes(firstWord)) {
          // Keep administrative operations on other connections from affecting the main transaction.
          if (transactionStatus === 'T' || transactionStatus === 'E') await activeClient.query('COMMIT');
      }

      // A savepoint protects earlier edits without retrying the failed statement.
      // Explicit transaction commands, DDL, CALL, and DO retain their own semantics.
      if (!this.isReadonly && canUseSavepoint && activeClient.getTransactionStatus?.() === 'T') {
        const name = `monabase_stmt_${randomUUID().replaceAll('-', '')}`;
        await activeClient.query(`SAVEPOINT ${name}`);
        savepoint = name;
      }
      const startTime = Date.now();
      if (schema) await activeClient.query(`SET search_path TO "${schema.replace(/"/g, '""')}"`);

      let notices = [];
      activeClient.on('notice', (msg) => { notices.push(msg.message); });

      const result = pgValues.length > 0 ? await activeClient.query(pgSql, pgValues) : await activeClient.query(pgSql);
      const executionTime = Date.now() - startTime;
      activeClient.removeAllListeners('notice');
      if (savepoint) {
        await activeClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        savepoint = null;
      }

      const resArray = Array.isArray(result) ? result : [result];
      let totalRows = [];
      let metaData = [];
      let rowsAffected = 0;

      for(const res of resArray) {
          if (res.fields?.length) {
              totalRows = totalRows.concat(res.rows);
              metaData = res.fields ? res.fields.map(f => {
                  let dbTypeName = 'VARCHAR';
                  let fetchType = 2001; 
                  switch(f.dataTypeID) {
                      case 20: case 21: case 23: case 700: case 701: case 1700: 
                          dbTypeName = 'NUMBER'; fetchType = 2002; break;
                      case 1082: dbTypeName = 'DATE'; fetchType = 2003; break;
                      case 1114: case 1184: dbTypeName = 'TIMESTAMP'; fetchType = 2010; break;
                      case 16: dbTypeName = 'BOOLEAN'; break;
                      case 17: dbTypeName = 'BLOB'; fetchType = 2008; break;
                      default: dbTypeName = 'VARCHAR'; break;
                  }
                  return { name: f.name, dbTypeName, fetchType };
              }) : [];
          }
          if (['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY', 'MOVE'].includes(res.command)) rowsAffected += res.rowCount || 0;
      }

      return { rows: totalRows, metaData: metaData, rowsAffected: rowsAffected, command: resArray.at(-1)?.command || undefined, executionTime: executionTime, notices: notices };
    } catch (err) {
      await this.waitForQueryCompletion(activeClient);
      activeClient.removeAllListeners('notice');
      if (savepoint && activeClient.readyForQuery !== false && ['T', 'E'].includes(activeClient.getTransactionStatus?.())) {
        try {
          await activeClient.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          await activeClient.query(`RELEASE SAVEPOINT ${savepoint}`);
        } catch {
          // Preserve the original error and pending state; never roll back other edits.
        }
      }
      if (err.message.includes('timeout') || err.code === '57014') {
        throw new Error(t("the_query_was_canceled_or_exceeded_the_configured_timeout"));
      }
      throw err;
    } finally {
      if (readOnlyTransaction) {
        try { await activeClient.query('ROLLBACK'); }
        catch (error) {
          if (activeClientObj.id === 'MAIN') await this.disconnect();
          else {
            this.bgPool = this.bgPool.filter(connection => connection !== activeClientObj);
            try { await activeClient.end(); } catch { /* The connection may already be invalid. */ }
          }
          activeClientObj.isExecuting = false;
          this.isExecuting = false;
          // eslint-disable-next-line no-unsafe-finally -- Never reuse a connection after failed cleanup.
          throw error;
        }
      }
      if (schema) { try { await activeClient.query('RESET search_path'); } catch (e) { } }
      if (activeClientObj.id !== 'MAIN') {
        activeClientObj.isExecuting = false;
      } else {
        this.getMainTransactionState();
        this.isExecuting = false; 
      }
    }
  }

  async explain(sqlText, binds = {}, schema = null) {
    if (!this.client) throw new Error(t("database_not_connected"));
    const bg = await this.getAvailableBgClient();
    if (!bg) throw new Error(t("no_background_connection_is_available_for_analysis_reconnect_and_try_again"));
    if (this.isReadonly && !isReadOnlySql(sqlText, 'postgresql')) {
      bg.isExecuting = false;
      throw new Error(t("cannot_modify_data_or_structure_while_connected_in_read_only_mode"));
    }
    let executionError;
    try {
       const startTime = Date.now();
       const bound = bindSql(sqlText.replace(/;\s*$/, ''), binds);
       const explainSql = `EXPLAIN (VERBOSE, FORMAT JSON) ${bound.text}`;
       await bg.client.query('BEGIN');
       // Apply the schema only during analysis; roll back to restore the previous state.
       if (schema) await bg.client.query(`SET LOCAL search_path TO "${schema.replace(/"/g, '""')}"`);
       const result = bound.values.length ? await bg.client.query(explainSql, bound.values) : await bg.client.query(explainSql);
       const planData = result.rows[0]['QUERY PLAN'];
       const planJson = typeof planData === 'string' ? planData : JSON.stringify(planData);
       return { rows: [{ PLAN_TABLE_OUTPUT: planJson }], metaData: [{ name: 'PLAN_TABLE_OUTPUT' }], executionTime: Date.now() - startTime };
    } catch (err) {
       executionError = err;
       throw err;
    } finally {
       try {
         await bg.client.query('ROLLBACK');
       } catch (error) {
         // Do not reuse a connection whose cleanup failed.
         this.bgPool = this.bgPool.filter(connection => connection !== bg);
         try { await bg.client.end(); } catch { /* The connection may already be invalid. */ }
         // eslint-disable-next-line no-unsafe-finally -- Surface cleanup failure only when execution succeeded.
         if (!executionError) throw error;
       } finally {
         bg.isExecuting = false;
       }
    }
  }

  async commit() {
    if (!this.client) return;
    while (this.isExecuting) await new Promise(r => setTimeout(r, 50));
    this.isExecuting = true;
    try {
      await this.client.query('COMMIT'); 
      for (const bg of this.bgPool) {
        try { await bg.client.query('COMMIT'); } catch(e) {}
      }
    } finally {
      await this.waitForQueryCompletion(this.client);
      this.getMainTransactionState();
      this.isExecuting = false; 
    }
  }

  async rollback() {
    if (!this.client) return;
    while (this.isExecuting) await new Promise(r => setTimeout(r, 50));
    this.isExecuting = true;
    try {
      await this.client.query('ROLLBACK'); 
      for (const bg of this.bgPool) {
        try { await bg.client.query('ROLLBACK'); } catch(e) {}
      }
    } finally {
      await this.waitForQueryCompletion(this.client);
      this.getMainTransactionState();
      this.isExecuting = false; 
    }
  }

  async getSchemas(includeMaintained = false, detailed = false) {
      const cliObj = this.bgPool.length > 0 ? await this.getAvailableBgClient() : { client: this.metaClient || this.client, id: 'FALLBACK' };
      const cli = cliObj ? cliObj.client : null;
      if (!cli) throw new Error(t("database_not_connected"));
      try {
          if (detailed) {
            const sql = `SELECT schema_name AS "USERNAME", 'OPEN' AS "ACCOUNT_STATUS", null AS "CREATED" FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name`;
            const res = await cli.query(sql); return res.rows;
          } else {
            const sql = `SELECT schema_name AS "USERNAME" FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name`;
            const res = await cli.query(sql); return res.rows.map(row => row.USERNAME);
          }
      } catch (err) { 
        throw new Error(err.message); 
      } finally {
        if (cliObj && cliObj.id !== 'FALLBACK') cliObj.isExecuting = false;
      }
  }

  async getObjects(owner, type) {
    let sql = '';
    switch (type.toUpperCase()) {
        case 'TABLE': sql = `SELECT table_name AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`; break;
        case 'VIEW': sql = `SELECT table_name AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'VIEW' ORDER BY table_name`; break;
        case 'SEQUENCE': sql = `SELECT s.relname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace WHERE s.relkind = 'S' AND n.nspname = $1 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = s.oid AND d.deptype IN ('a', 'i') AND d.classid = 'pg_class'::regclass AND d.refclassid = 'pg_class'::regclass) ORDER BY s.relname`; break;
        case 'FUNCTION': sql = `SELECT p.proname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = $1 AND p.prokind = 'f' AND p.prorettype != 'pg_catalog.trigger'::regtype ORDER BY p.proname`; break;
        case 'PROCEDURE': sql = `SELECT routine_name AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM information_schema.routines WHERE routine_schema = $1 AND routine_type = 'PROCEDURE' ORDER BY routine_name`; break;
        case 'MATERIALIZED VIEW': sql = `SELECT matviewname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname`; break;
        case 'INDEX': sql = `SELECT indexname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`; break;
        case 'TRIGGER': sql = `SELECT t.tgname AS "OBJECT_NAME", CASE WHEN t.tgenabled = 'O' THEN 'VALID' ELSE 'DISABLED' END AS "STATUS", c.relname AS "TABLE_NAME" FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $1 AND t.tgisinternal = false ORDER BY t.tgname`; break;
        case 'TYPE': sql = `SELECT t.typname AS "OBJECT_NAME", 'VALID' AS "STATUS", NULL AS "TABLE_NAME" FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace LEFT JOIN pg_class c ON c.oid = t.typrelid WHERE n.nspname = $1 AND (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND c.relkind = 'c')) ORDER BY t.typname`; break;
        default: return [];
    }
    const cliObj = this.bgPool.length > 0 ? await this.getAvailableBgClient() : { client: this.metaClient || this.client, id: 'FALLBACK' };
    const cli = cliObj ? cliObj.client : null;
    if (!cli) throw new Error(t("database_not_connected"));
    try {
      const res = await cli.query(sql, [owner]);
      return res.rows.map(row => ({ name: row.OBJECT_NAME, status: row.STATUS, tableName: row.TABLE_NAME })); 
    } finally {
      if (cliObj && cliObj.id !== 'FALLBACK') cliObj.isExecuting = false;
    }
  }

  async getColumns(schemaName, tableName) {
    const cliObj = this.bgPool.length > 0 ? await this.getAvailableBgClient() : { client: this.metaClient || this.client, id: 'FALLBACK' };
    const cli = cliObj ? cliObj.client : null;
    if (!cli) throw new Error(t("database_not_connected"));

    const sql = `SELECT column_name AS "COLUMN_NAME" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`;

    try {
      const res = await cli.query(sql, [schemaName, tableName]);
      return res.rows.map(r => r.COLUMN_NAME);
    } finally {
      if (cliObj && cliObj.id !== 'FALLBACK') cliObj.isExecuting = false;
    }
  }

  async getTablespaces() { return (await this.listPostgresTablespaces()).tablespaces.map(row => ({ ...row, TABLESPACE_NAME: row.name, OWNER: row.owner, LOCATION: row.location })); }
  async getTablespaceDetails() { throw Error('pg_ts_identity_required'); }
  async getDirectories() { return []; }
  async getDirectoryPrivileges(directoryName) { return []; }

  async getSessions() {
    return (await this.readPostgresSessions()).sessions.map(row => ({ ...row, SID: row.pid, USERNAME: row.username, STATUS: row.state, MACHINE: row.address, PROGRAM: row.program, SQL_ID: row.query }));
  }
  async getSessionStats() { throw new Error('pg_session_stats_unavailable'); }
  async killSession() { return { success: false, error: 'pg_session_identity_required' }; }
  async cancelSQL() { return { success: false, error: 'pg_session_identity_required' }; }

  async withPrivilegeConnection(run, write = false) {
    const main = this.client;
    if (!main || !this.bgPool.length) throw new Error('pg_priv_not_connected');
    if (write && this.isReadonly) throw new Error('pg_priv_readonly');
    const slot = await this.getAvailableBgClient();
    let transaction = false, committing = false, result;
    const remove = async () => {
      this.bgPool = this.bgPool.filter(entry => entry !== slot);
      try { await slot.client.end(); } catch { /* Failed connections must not return to the pool. */ }
    };
    try {
      if (this.client !== main) throw new Error('pg_priv_connection_changed');
      if (slot.client.getTransactionStatus?.() !== 'I') throw new Error('pg_priv_busy');
      if (this.privilegeScopeMain !== main) { this.privilegeScopeMain = main; this.privilegeScope = randomUUID(); }
      const query = (sql, binds = []) => {
        if (this.client !== main || !this.bgPool.includes(slot)) throw new Error('pg_priv_connection_changed');
        return slot.client.query(sql, binds);
      };
      await query(write ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); transaction = true;
      await query('SET LOCAL search_path = pg_catalog');
      result = await run(query, { readonly: this.isReadonly, connectionId: this.privilegeScope });
      if (write) { committing = true; await query('COMMIT'); committing = false; }
      else await query('ROLLBACK');
      transaction = false;
      return result;
    } catch (error) {
      if (committing) error.pgPrivUnknown = true;
      if (transaction) {
        try { await slot.client.query('ROLLBACK'); }
        catch { await remove(); }
      }
      throw error;
    } finally { slot.isExecuting = false; }
  }
  getPrivilegeManager() {
    if (!this.privilegeManager) this.privilegeManager = require('./objectPrivileges').createPrivilegeManager();
    return this.privilegeManager;
  }
  async listPostgresPrivilegePrincipals() { return this.withPrivilegeConnection((query, options) => this.getPrivilegeManager().principals(query, options)); }
  async listPostgresPrivilegeObjects(input) { return this.withPrivilegeConnection((query, options) => this.getPrivilegeManager().listObjects(query, input, options)); }
  async readPostgresPrivileges(input) { return this.withPrivilegeConnection((query, options) => this.getPrivilegeManager().read(query, input, options)); }
  async reviewPostgresPrivilege(input) { return this.withPrivilegeConnection((query, options) => this.getPrivilegeManager().review(query, input, options)); }
  async mutatePostgresPrivilege(input) {
    if (this.privilegeCommandPending) throw new Error('pg_priv_busy');
    this.privilegeCommandPending = true;
    try { return await this.withPrivilegeConnection((query, options) => this.getPrivilegeManager().mutate(query, input, options), true); }
    finally { this.privilegeCommandPending = false; }
  }

  getRoleManager() {
    if (!this.roleManager) this.roleManager = require('./roleManagement').createRoleManager();
    return this.roleManager;
  }
  async listManagedRoles() { return this.withPrivilegeConnection((query, options) => this.getRoleManager().list(query, options)); }
  async getManagedRoleDetail(input) { return this.withPrivilegeConnection((query, options) => this.getRoleManager().detail(query, input, options)); }
  async reviewRoleOperation(input) { return this.withPrivilegeConnection((query, options) => this.getRoleManager().review(query, input, options)); }
  async executeRoleOperation(input) {
    if (this.roleCommandPending) throw Error('pg_role_busy');
    this.roleCommandPending = true;
    try { return await this.withPrivilegeConnection((query, options) => this.getRoleManager().execute(query, input, options), true); }
    finally { this.roleCommandPending = false; }
  }

  getTablespaceManager() {
    if (!this.tablespaceManager) this.tablespaceManager = require('./tablespaceManagement').createTablespaceManager();
    return this.tablespaceManager;
  }
  async withTablespaceConnection(run, write = false) {
    const main = this.client;
    if (!main || !this.bgPool.length) throw Error('pg_ts_not_connected');
    if (write && this.isReadonly) throw Error('pg_ts_readonly');
    const slot = await this.getAvailableBgClient();
    try {
      if (this.client !== main) throw Error('pg_ts_connection_changed');
      if (slot.client.getTransactionStatus?.() !== 'I') throw Error('pg_ts_busy');
      if (this.tablespaceScopeMain !== main) { this.tablespaceScopeMain = main; this.tablespaceScope = randomUUID(); }
      const query = (sql, binds = []) => {
        if (this.client !== main || !this.bgPool.includes(slot)) throw Error('pg_ts_connection_changed');
        return slot.client.query(sql, binds);
      };
      // CREATE/DROP TABLESPACE require autocommit; never commit another operation's work.
      return await run(query, { readonly: this.isReadonly, connectionId: this.tablespaceScope });
    } catch (error) {
      if (error.pgTsUnknown || /^(08|57P0)/.test(error.code || '')) {
        this.bgPool = this.bgPool.filter(entry => entry !== slot);
        try { await slot.client.end(); } catch { /* Broken connections must not return to the pool. */ }
      }
      throw error;
    } finally { slot.isExecuting = false; }
  }
  async listPostgresTablespaces() { return this.withTablespaceConnection((query, options) => this.getTablespaceManager().list(query, options)); }
  async getPostgresTablespaceDetail(input) { return this.withTablespaceConnection((query, options) => this.getTablespaceManager().detail(query, input, options)); }
  async reviewPostgresTablespaceOperation(input) { return this.withTablespaceConnection((query, options) => this.getTablespaceManager().review(query, input, options)); }
  async executePostgresTablespaceOperation(input) {
    if (this.tablespaceCommandPending) throw Error('pg_ts_busy');
    this.tablespaceCommandPending = true;
    try { return await this.withTablespaceConnection((query, options) => this.getTablespaceManager().execute(query, input, options), true); }
    finally { this.tablespaceCommandPending = false; }
  }

  getSchemaManager() {
    if (!this.schemaManager) this.schemaManager = require('./schemaManagement').createSchemaManager();
    return this.schemaManager;
  }
  async listManagedSchemas() { return this.withPrivilegeConnection((query, options) => this.getSchemaManager().list(query, options)); }
  async getManagedSchemaDetail(input) { return this.withPrivilegeConnection((query, options) => this.getSchemaManager().detail(query, input, options)); }
  async reviewSchemaOperation(input) { return this.withPrivilegeConnection((query, options) => this.getSchemaManager().review(query, input, options)); }
  async executeSchemaOperation(input) {
    if (this.schemaCommandPending) throw new Error('pg_schema_busy');
    this.schemaCommandPending = true;
    try { return await this.withPrivilegeConnection((query, options) => this.getSchemaManager().execute(query, input, options), true); }
    finally { this.schemaCommandPending = false; }
  }

  async withActivityConnection(run, prefix = 'pg_lock') {
    const main = this.client;
    if (!main || !this.bgPool.length) throw new Error(`${prefix}_not_connected`);
    const slot = await this.getAvailableBgClient();
    try {
      if (this.client !== main) throw new Error(`${prefix}_connection_changed`);
      if (slot.client.getTransactionStatus?.() && slot.client.getTransactionStatus() !== 'I') throw new Error(`${prefix}_busy`);
      if (this.activityScopeMain !== main) { this.activityScopeMain = main; this.activityScope = randomUUID(); }
      const clients = [main, this.metaClient, ...this.bgPool.map(entry => entry.client)];
      const pids = clients.map(client => client?.processID);
      const query = (sql, binds = []) => {
        if (this.client !== main || !this.bgPool.includes(slot)) throw new Error(`${prefix}_connection_changed`);
        return slot.client.query(sql, binds);
      };
      return await run(query, { readonly: this.isReadonly, connectionId: this.activityScope, ownPids: pids, protectionReady: pids.every(pid => Number.isSafeInteger(pid) && pid > 0) });
    } finally { slot.isExecuting = false; }
  }
  async readPostgresLocks() { return this.withActivityConnection((query, options) => require('./lockManagement').readLocks(query, options)); }
  async managePostgresLock(request) {
    if (this.activityCommandPending) throw new Error('pg_lock_busy');
    this.activityCommandPending = true;
    try { return await this.withActivityConnection((query, options) => require('./lockManagement').manageLock(query, request, options)); }
    finally { this.activityCommandPending = false; }
  }
  async readPostgresSessions() { return this.withActivityConnection((query, options) => require('./sessionManagement').readSessions(query, options), 'pg_session'); }
  async managePostgresSession(request) {
    if (this.activityCommandPending) throw new Error('pg_session_busy');
    this.activityCommandPending = true;
    try { return await this.withActivityConnection((query, options) => require('./sessionManagement').manageSession(query, request, options), 'pg_session'); }
    finally { this.activityCommandPending = false; }
  }
  async getLocks() {
    return (await this.readPostgresLocks()).locks.map(row => ({ ...row, SID: row.pid, TYPE: row.kind, LMODE: row.mode, REQUEST: row.granted }));
  }
}

module.exports = PostgresClient;
