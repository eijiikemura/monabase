// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const mysql = require('mysql2');
const fs = require('node:fs');
const net = require('node:net');
const { observeTransactionState } = require('./transactionState');
const { inspectSql, assertReadOnly } = require('./sqlText');
const quote = name => '`' + name.replaceAll('`', '``') + '`';
const MAX_ROWS = 10000, MAX_BYTES = 16 * 1024 * 1024;

class MysqlClient {
  constructor({createSshHostVerifier=()=>()=>false}={}) { this.createSshHostVerifier=createSshHostVerifier; this.queue = Promise.resolve(); this.backgroundQueue = Promise.resolve(); this.connections = []; }
  enqueue(operation, background = false) {
    const key = background ? 'backgroundQueue' : 'queue';
    const result = this[key].then(operation);
    this[key] = result.catch(() => {});
    return result;
  }
  async connect(config) {
    if (config.useOsAuth || config.useSysdba) throw new Error('MySQL requires username/password database authentication.');
    // Host fields often contain surrounding whitespace after copy/paste.
    // Normalize only the address; database names, users and passwords are exact.
    const host = typeof config.host === 'string' ? config.host.trim() : '';
    if (!config.database || !config.user || !host) throw new Error('MySQL host, database and username are required.');
    if (config.mysqlSslMode !== undefined && !['disable', 'verify-full'].includes(config.mysqlSslMode)) throw new Error('Invalid MySQL TLS mode.');
    const port = Number(config.port || 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid MySQL port.');
    if (config.mysqlSslMode === 'verify-full' && net.isIP(host)) throw new Error('MySQL verified TLS currently requires a DNS hostname matching the certificate, not an IP address.');
    const ssl = config.mysqlSslMode === 'verify-full' ? { rejectUnauthorized: true, verifyIdentity: true,
      ...(config.mysqlSslCaFile ? { ca: this.readCa(config.mysqlSslCaFile) } : {}) } : undefined;
    const options = { host, port, user: config.user, password: config.password || '', database: config.database,
      ssl, connectTimeout: 10000, rowsAsArray: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
      dateStrings: true, jsonStrings: true, multipleStatements: false, compress: false, flags: '-LOCAL_FILES', charset: 'utf8mb4',
      enableCleartextPlugin: false };
    this.traceOptions=options;
    this.lastConfig={...config,host};
    this.closing = false;
    this.mainSchema = config.database;
    this.readonly = Boolean(config.readonly);
    this.timeout = Number(config.queryTimeout || 0);
    if (!Number.isFinite(this.timeout) || this.timeout < 0 || this.timeout > 86400) throw new Error('Invalid query timeout.');
    try {
      if(config.useSshTunnel){
        const {MysqlSshTransport}=require('./sshTransport');
        this.sshTransport=new MysqlSshTransport(this.createSshHostVerifier,()=>{
          this.monitor?.invalidate();for(const connection of this.connections)connection.destroy();
        });
        await this.sshTransport.connect(config);
      }
      for (let index = 0; index < 3; index++) {
        // Keep the original DB hostname for TLS identity/SNI even when SSH supplies the socket.
        const stream=this.sshTransport?await this.sshTransport.open(host,port):undefined;
        let connection;try{connection=mysql.createConnection({...options,...(stream?{stream}:{})});}catch(error){stream?.destroy();throw error;}
        this.connections.push(connection);
        connection.on('error', () => {});
        if (index === 0) { this.main = connection; this.monitor = observeTransactionState(connection, { trackWrites: true }); }
        await connection.promise().connect();
        if (index === 0) this.monitor.verifyCapabilities();
      }
      [this.main, this.background, this.control] = this.connections;
      const [[version]] = await this.background.promise().query('SELECT VERSION(), @@SESSION.sql_mode, @@default_storage_engine');
      if (!/^8\.4\./.test(version[0]) || /mariadb/i.test(version[0])) throw new Error('This workspace supports MySQL 8.4 only.');
      if (/\b(NO_BACKSLASH_ESCAPES|ANSI_QUOTES)\b/.test(version[1])) throw new Error('MySQL ANSI_QUOTES and NO_BACKSLASH_ESCAPES modes are not yet supported.');
      if (version[2].toLowerCase() !== 'innodb') throw new Error('MySQL default storage engine must be InnoDB.');
      this.version = `MySQL ${version[0]}`;
      const [[session]] = await this.main.promise().query('SELECT VERSION(), @@session.time_zone, @@session.sql_mode, @@character_set_connection, @@collation_connection, @@lower_case_table_names');
      this.aiEnvironment = { version: String(session[0]), timezone: String(session[1]), sqlMode: String(session[2]), characterSet: String(session[3]), collation: String(session[4]), lowerCaseTableNames: String(session[5]) };
      await this.main.promise().query("SET SESSION session_track_transaction_info = 'STATE'");
      await this.main.promise().query('SET SESSION autocommit = 0');
      if (this.readonly) await this.main.promise().query('SET SESSION TRANSACTION READ ONLY');
      await this.background.promise().query('SET SESSION TRANSACTION READ ONLY');
      await this.background.promise().query('SET SESSION autocommit = 1');
    } catch (error) {
      // A rejected handshake may never complete mysql2's graceful end callback.
      // No work is allowed before connect resolves, so failed initialization can close directly.
      this.closing = true;
      for (const connection of this.connections) connection.destroy();
      this.sshTransport?.close();this.sshTransport=null;
      this.connections = []; this.main = null; this.background = null; this.control = null; this.monitor?.invalidate();
      if (error.message?.startsWith('This workspace') || error.message?.startsWith('MySQL ')) throw error;
      throw new Error(`MySQL connection failed (${error.code || 'CONNECTION_ERROR'}). Check the address, credentials and TLS settings.`);
    }
  }
  async openTraceConnection() {
    if(this.closing||!this.main)throw new Error('MySQL is not connected.');
    const stream=this.sshTransport?await this.sshTransport.open(this.traceOptions.host,this.traceOptions.port):undefined;
    let db;try{db=mysql.createConnection({...this.traceOptions,...(stream?{stream}:{})});db.on('error',()=>{});await db.promise().connect();return db;}
    catch(error){db?.destroy();stream?.destroy();throw error;}
  }
  readCa(file) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('MySQL CA must be a PEM file of at most 1 MiB.');
    const ca = fs.readFileSync(file, 'utf8');
    if (!ca.includes('-----BEGIN CERTIFICATE-----')) throw new Error('MySQL CA file must contain a PEM certificate.');
    return ca;
  }
  getMainTransactionState() { const state = this.monitor?.get(); return !state || state.transactionStatus === 'unknown' ? undefined : state.hasUncommittedTx; }
  getTransactionDetails() { return this.monitor?.get() || { transactionStatus: 'unknown' }; }
  async getAiDatabaseContext() {
    return this.enqueue(async () => {
      if (this.closing || !this.main || this.getTransactionDetails().transactionStatus === 'unknown') throw new Error('MySQL context is unavailable.');
      return { ...this.aiEnvironment, dbType: 'mysql', session: 'main', readOnlyMode: this.readonly, schema: this.mainSchema };
    });
  }
  getDbVersion() { return this.version; }
  async getSchemas() {
    return this.enqueue(async () => { const [rows] = await this.background.promise().query({ sql: 'SHOW DATABASES', timeout: 10000 }); return rows.map(row => row[0]); }, true);
  }
  async execute(sql, binds = {}, schema = null, _unused = false, background = false) {
    const statement = inspectSql(sql, binds, mysql.escape);
    if (background || this.readonly) assertReadOnly(statement);
    return this.enqueue(async () => {
      const db = background ? this.background : this.main;
      if (!db || this.closing) throw new Error('MySQL is not connected.');
      if (!background && this.getTransactionDetails().transactionStatus === 'unknown') throw new Error('MySQL transaction state is unknown. Reconnect before executing more SQL.');
      if (schema && (background || schema !== this.mainSchema)) {
        if (typeof schema !== 'string' || schema.length > 64) throw new Error('Invalid database name.');
        try { await db.promise().query('USE ' + quote(schema)); if (!background) this.mainSchema = schema; }
        catch (error) { if (!background) { try { await db.promise().query('SHOW WARNINGS'); } catch { this.monitor.invalidate(); } } throw new Error(error.sqlMessage || 'Could not select the MySQL database.'); }
      }
      const start = performance.now();
      const result = await this.run(db, statement);
      return { ...result, executionTime: performance.now() - start, executionSchema: schema || undefined, command: statement.command };
    }, background);
  }
  async getFunction(request) { return require('./procedureService').getProcedure(this,request,'FUNCTION'); }
  async mutateFunction(request) { const result=await require('./procedureService').mutateProcedure(this,request,'FUNCTION');const {procedure,...rest}=result;return {...rest,...(procedure?{routine:procedure}:{})}; }
  async getProcedure(request) { return require('./procedureService').getProcedure(this,request); }
  async mutateProcedure(request) { return require('./procedureService').mutateProcedure(this,request); }
  async executeStored(request) { return require('./procedureService').executeStored(this,request); }
  async getTrigger(request) { return require('./triggerService').getTrigger(this, request); }
  async mutateTrigger(request) { return require('./triggerService').mutateTrigger(this, request); }
  async explain(sql, binds = {}, schema = null) {
    const statement = inspectSql(sql, binds, mysql.escape);
    if (!['SELECT', 'WITH'].includes(statement.command)) throw new Error('MySQL plan analysis supports SELECT statements only.');
    assertReadOnly(statement);
    // Use an estimated plan, never EXPLAIN ANALYZE or an extra execution.
    let result;try{result=await this.execute('EXPLAIN FORMAT=JSON ' + statement.sql, {}, schema);}catch(error){delete error.mysqlErrorLine;throw error;}
    // Plan rewriting may change line offsets; do not invent an editor location.
    if (result.rows.length !== 1) throw new Error('MySQL execution plan is unavailable.');
    const plan = Object.values(result.rows[0])[0];
    if (typeof plan !== 'string' || !JSON.parse(plan)?.query_block) throw new Error('Unsupported MySQL JSON plan format.');
    return { ...result, rows: [{ PLAN_TABLE_OUTPUT: plan }], metaData: [{ name: 'PLAN_TABLE_OUTPUT', dbTypeName: 'JSON' }] };
  }
  async run(db, statement) {
    const execution = db === this.main ? { db, threadId: db.threadId, cancelled: false } : null;
    if (execution) this.active = execution;
    let timer;
    if (execution && this.timeout) timer = setTimeout(() => { void this.breakExecution().catch(() => {}); }, this.timeout * 1000);
    let fields = [], rows = [], bytes = 0, rowCount = 0, resultCount=0, rowKeyBytes=0, header, limitError;
    const frames=[];
    try {
      await new Promise((resolve, reject) => {
        // Escape values at lexer-identified bind positions only. mysql2/MySQL
        // prepared CAST(? AS UNSIGNED) can narrow a maximum unsigned BIGINT.
        // Never use whole-string placeholder substitution inside quoted text.
        const command = db.query({ sql: statement.sql, rowsAsArray: true, ...(execution ? {} : { timeout: 10000 }) });
        command.on('fields', value => {
          rowKeyBytes=statement.collectResults&&value?Buffer.byteLength(JSON.stringify(value.map(field=>field.name))):0;
          if(statement.collectResults&&value?.length){
            resultCount++;bytes+=Buffer.byteLength(JSON.stringify(value.map(field=>[field.name,field.columnType])));
            if(!limitError&&(resultCount>100||bytes>MAX_BYTES)){
              limitError=new Error('MySQL procedure results exceed 100 result sets or 16 MiB. Reduce the procedure output.');
              if(execution)void this.breakExecution().catch(()=>{});else db.destroy();
            }
          }
          if(statement.collectResults&&fields.length&&!limitError)frames.push({fields,rows});fields=value||[];rows=[];
        });
        command.on('result', row => {
          if (!Array.isArray(row)) { header = row; return; }
          if (limitError) return;
          bytes += Buffer.byteLength(JSON.stringify(row)) + rowKeyBytes;
          if (++rowCount > MAX_ROWS || bytes > MAX_BYTES) {
            limitError = new Error('MySQL result exceeds 10,000 rows or 16 MiB. Add a LIMIT or narrower filters.');
            if (execution) void this.breakExecution().catch(() => {});
            else db.destroy();
            return;
          }
          rows.push(row);
        });
        command.once('error', reject);
        command.once('end', resolve);
      });
      if (limitError) throw limitError;
      if (execution?.cancelled) throw new Error('MySQL execution was cancelled. The transaction has not been automatically rolled back.');
      const convert = (fields, rows) => {
      const used = new Set();
      const metaData = fields.map(field => {
        let name = field.name, suffix = 2;
        while (used.has(name)) name = `${field.name}_${suffix++}`;
        used.add(name);
        const type = mysql.Types[field.columnType] || 'UNKNOWN';
        return { name, dbTypeName: type === 'DATETIME' ? 'TIMESTAMP' : type === 'LONGLONG' ? 'BIGINT' : type === 'NEWDECIMAL' ? 'DECIMAL' : type };
      });
      const mappedRows = rows.map(row => Object.fromEntries(metaData.map((field, index) => [field.name, Buffer.isBuffer(row[index]) ? row[index].toString('hex') : row[index]])));
      return {rows:mappedRows,metaData};
      };
      const result=convert(fields,rows);
      if(statement.collectResults&&fields.length)frames.push({fields,rows});
      return { ...result, ...(statement.collectResults?{resultSets:frames.map(frame=>convert(frame.fields,frame.rows))}:{}), rowsAffected: header?.affectedRows, notices: header?.warningStatus ? [`MySQL reported ${header.warningStatus} warning(s). Run SHOW WARNINGS to inspect them.`] : [] };
    } catch (error) {
      // ERR packets do not include server status. SHOW WARNINGS preserves the
      // diagnostics and reports status without replaying or rolling back SQL.
      if (execution && !error.fatal && !db._closing) {
        try { await db.promise().query('SHOW WARNINGS'); } catch { this.monitor.invalidate(); }
      } else if (execution) this.monitor.invalidate();
      const failure=limitError || new Error(`${error.code ? error.code + ': ' : ''}${error.sqlMessage || error.message}`);
      const match=error.code==='ER_PARSE_ERROR'&&typeof error.sqlMessage==='string'?/\bat line ([1-9]\d*)\s*$/.exec(error.sqlMessage):null;
      if(match&&Number.isSafeInteger(Number(match[1])))failure.mysqlErrorLine=Number(match[1]);
      throw failure;
    } finally {
      clearTimeout(timer);
      if (execution?.cancelPromise) await execution.cancelPromise;
      if (this.active === execution) this.active = null;
    }
  }
  async breakExecution() {
    const active = this.active;
    if (!active) return { success: true };
    if (!active.cancelPromise) {
      active.cancelled = true;
      // Hold the main queue until this request finishes: a late KILL can never
      // cancel a subsequent statement. No caller-supplied connection IDs.
      active.cancelPromise = this.control.promise().query({ sql: `KILL QUERY ${Number(active.threadId)}`, timeout: 5000 }).then(() => ({ success: true }), () => {
        this.monitor.invalidate(); this.main.destroy(); this.control.destroy(); return { success: false, error: 'MySQL cancellation could not be confirmed. Reconnect before continuing.' };
      });
    }
    return active.cancelPromise;
  }
  async commit() { return this.finish('COMMIT'); }
  async rollback() { return this.finish('ROLLBACK'); }
  async finish(sql) {
    return this.enqueue(async () => {
      if (this.getTransactionDetails().transactionStatus === 'unknown') throw new Error('MySQL transaction state is unknown. Reconnect; do not automatically retry COMMIT.');
      await this.run(this.main, inspectSql(sql));
    });
  }
  async disconnect() {
    this.closing = true;
    await this.breakExecution();
    await Promise.all([this.queue, this.backgroundQueue]);
    for (const db of this.connections) {
      try { await db.promise().end(); } catch { db.destroy(); }
    }
    this.sshTransport?.close();this.sshTransport=null;
    this.connections = []; this.main = null; this.background=null;this.control=null; this.monitor?.invalidate();
  }
}
module.exports = MysqlClient;
