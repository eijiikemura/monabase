// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readCredentialFile } = require('../services/credentialFiles');
const { getPackageRoutine, packageInvocation } = require('./packageProgram');
const { randomBytes } = require('node:crypto');
const { t } = require('../i18n');
const { isReadOnlySql } = require('../services/readOnlySql');
const { connectVerifiedSsh } = require('../services/sshHostKeys');
const { app } = require('electron');
const { getCurrentSettings } = require('../services/settings');

const oracledb = require('oracledb');
const { executeTrace } = require('./traceExecutor');
const { Buffer } = require('buffer');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2'); 
const net = require('net');         
const { getOracleDateFormat, getOracleFormatForValue, DEFAULT_DATETIME_FORMAT, formatDateToOutput } = require('./oracleFormatHelper'); 

let currentTimezone = '+09:00'; 
let currentOutputDateFormat = DEFAULT_DATETIME_FORMAT;
let customOracleClientPath = '';

let isThickModeInitialized = false;
let thickModeError = null;

function ensureThickMode() {
  if (isThickModeInitialized) return;

  const candidatePaths = [];
  if (customOracleClientPath && fs.existsSync(customOracleClientPath)) {
    candidatePaths.push(customOracleClientPath);
  }

  if (process.env.ORACLE_HOME && fs.existsSync(process.env.ORACLE_HOME)) {
    const binPath = path.join(process.env.ORACLE_HOME, 'bin');
    if (fs.existsSync(binPath)) {
      candidatePaths.push(binPath);
    }
    candidatePaths.push(process.env.ORACLE_HOME);
  }

  for (const libPath of candidatePaths) {
    try {
      oracledb.initOracleClient({ libDir: libPath });
      isThickModeInitialized = true;
      thickModeError = null;
      console.log(`[OracleClient] Initialized Thick mode using specified libDir: ${libPath}`);
      return;
    } catch (err) {
      if (err.message && err.message.includes('NJS-077')) {
        isThickModeInitialized = true;
        thickModeError = null;
        return;
      }
      console.warn(`[OracleClient] Failed init with path ${libPath}:`, err.message);
    }
  }

  try {
    oracledb.initOracleClient();
    isThickModeInitialized = true;
    thickModeError = null;
    console.log('[OracleClient] Initialized Thick mode using system PATH.');
  } catch (err) {
    if (err.message && err.message.includes('NJS-077')) {
      isThickModeInitialized = true;
      thickModeError = null;
    } else {
      thickModeError = err;
      console.warn('[OracleClient] Thick mode initialization failed (falling back to Thin mode):', err.message);
    }
  }
}

function updateCurrentSettings() {
  const settings = getCurrentSettings();
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  currentTimezone = settings.timezone || `${sign}${hours}:${minutes}`;
  currentOutputDateFormat = settings.outputDateFormat || DEFAULT_DATETIME_FORMAT;
  customOracleClientPath = settings.oracleClientPath || '';
}

updateCurrentSettings();

oracledb.fetchAsString = [ oracledb.CLOB ];
oracledb.fetchAsBuffer = [ oracledb.BLOB ];

function resolveLocalhost(hostStr) {
  if (!hostStr) return hostStr;
  const cleanHost = hostStr.trim().toLowerCase();
  if (cleanHost === 'localhost' || cleanHost === '[localhost]') {
    return '127.0.0.1';
  }
  return hostStr;
}

class OracleClient {
  constructor({ createSshHostVerifier = () => () => false } = {}) {
    this.createSshHostVerifier = createSshHostVerifier;
    this.connection = null;
    this.managedSessions = new Map();
    this.bgPool = [];
    this.BG_POOL_SIZE = 5;

    this.isReadonly = false;
    this.lastConfig = null;
    this.hasUncommittedTx = false; 

    this.sshClient = null;
    this.sshServer = null;
    this.localSshPort = null;
    this.lastSshError = null;

    this.isExecuting = false;
  }

  async setupSshTunnel(config) {
    const privateKey = config.sshAuthType === 'key' ? await readCredentialFile(config.sshKeyFile, 'ssh-private-key') : undefined;
    return new Promise((resolve, reject) => {
      this.sshClient = new Client();
      this.lastSshError = null;

      const sshConfig = {
        host: config.sshHost,
        port: parseInt(config.sshPort, 10) || 22,
        username: config.sshUser,
        readyTimeout: 30000,          
        keepaliveInterval: 15000,     
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
          sock.setKeepAlive(true, 10000); 

          sock.on('error', (sockErr) => { console.error('Local Socket Error:', sockErr); });

          const targetDbHost = config.host || '127.0.0.1';

          this.sshClient.forwardOut(
            '127.0.0.1', sock.remotePort,
            targetDbHost, parseInt(config.port, 10) || 1521,
            (err, stream) => {
              if (err) {
                console.error(t("ssh_tunnel_error_forwarding_to_failed_details", { value0: targetDbHost, value1: err.message }));
                this.lastSshError = new Error(t("forwarding_from_the_jump_server_to_was_refused_details", { value0: targetDbHost, value1: err.message }));
                sock.end();
                return;
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
    updateCurrentSettings();

    if (config.useOsAuth || config.useSysdba || customOracleClientPath) {
      ensureThickMode();
    }

    const safeConfig = {
      ...config,
      host: resolveLocalhost(config.host),
      sshHost: config.useSshTunnel ? resolveLocalhost(config.sshHost) : config.sshHost
    };

    this.lastConfig = safeConfig;
    this.isReadonly = safeConfig.readonly === true;
    this.lastSshError = null;
    this.isExecuting = false;

    for (const bg of this.bgPool) {
      try { await bg.conn.close(); } catch (e) {}
    }
    this.bgPool = [];

    try {
      let targetHost = safeConfig.host;
      let targetPort = safeConfig.port;

      if (safeConfig.useSshTunnel) {
        await this.setupSshTunnel(safeConfig);
        targetHost = '127.0.0.1';
        targetPort = this.localSshPort;
      }

      const connectOptions = {};

      if (safeConfig.database) {
        if (targetHost && targetPort) {
          connectOptions.connectString = `${targetHost}:${targetPort}/${safeConfig.database}`;
        } else {
          connectOptions.connectString = safeConfig.database;
        }
      } else if (targetHost && targetPort) {
        connectOptions.connectString = `${targetHost}:${targetPort}`;
      }

      if (safeConfig.useOsAuth) {
        connectOptions.externalAuth = true;
        delete connectOptions.user;
        delete connectOptions.password;
      } else {
        connectOptions.user = safeConfig.user;
        connectOptions.password = safeConfig.password;
      }

      if (safeConfig.useSysdba) {
        connectOptions.privilege = oracledb.SYSDBA;
      }

      const timeoutMillis = (safeConfig.queryTimeout !== undefined && safeConfig.queryTimeout > 0)
        ? safeConfig.queryTimeout * 1000
        : 0;
      this.connection = await oracledb.getConnection(connectOptions);
      this.managedSessions.clear();
      await this.rememberManagedSession(this.connection);
      this.dbLinkConnectOptions = { ...connectOptions };
      if (timeoutMillis > 0) this.connection.callTimeout = timeoutMillis;
      if (this.isReadonly) {
        const identity = await this.connection.execute('SELECT USER AS USERNAME FROM DUAL', {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        if (safeConfig.useSysdba || identity.rows[0].USERNAME === 'SYS') throw new Error(t('read_only_requires_non_sys_user'));
      }
      try { await this.connection.execute(`ALTER SESSION SET TIME_ZONE = '${currentTimezone}'`); } catch (e) {}

      try {
        const bgConnectOptions = { ...connectOptions };
        for (let i = 0; i < this.BG_POOL_SIZE; i++) {
          const bgConn = await oracledb.getConnection(bgConnectOptions);
          await this.rememberManagedSession(bgConn);
          bgConn.callTimeout = 120000; 
          try { await bgConn.execute(`ALTER SESSION SET TIME_ZONE = '${currentTimezone}'`); } catch (e) {}

          this.bgPool.push({
             id: i + 1,
             conn: bgConn,
             isExecuting: false
          });
        }
      } catch (bgErr) {
        console.warn("[OracleClient] Background pool creation failed:", bgErr);
        for (const bg of this.bgPool) {
          try { await bg.conn.close(); } catch { /* Already failed connections may reject cleanup. */ }
        }
        this.bgPool = [];
      }

    } catch (e) {
      await this.disconnect();
      if (this.lastSshError) {
         throw new Error(t("ssh_connection_error") + this.lastSshError.message);
      }

      if (safeConfig.useOsAuth && !isThickModeInitialized) {
        const detailMsg = thickModeError ? `\n(詳細エラー: ${thickModeError.message})` : '';
        throw new Error(
          t("oracle_client_required_for_os_auth") + detailMsg
        );
      }

      throw new Error(t("connection_error_3") + e.message);
    }
  }

  async disconnect() {
    this.pdbManager = null;
    this.userRoleManager = null; this.userRoleScopeMain = null; this.userRoleScope = null;
    this.tablespaceManager = null;
    this.dbLinkConnectOptions = null;
    if (this.connection) {
        try { await this.connection.close(); } catch (e) {}
        this.connection = null; 
    }
    for (const bg of this.bgPool) {
        try { await bg.conn.close(); } catch (e) {}
    }
    this.bgPool = [];
    this.hasUncommittedTx = false; 
    this.isExecuting = false;

    if (this.sshServer) { this.sshServer.close(); this.sshServer = null; }
    if (this.sshClient) { this.sshClient.end(); this.sshClient = null; }
  }

  async resetConnection() {
    await this.disconnect();
    if (this.lastConfig) await this.connect(this.lastConfig);
  }

  async getAvailableBgConnection() {
    if (this.bgPool.length === 0) return null;
    while (true) {
      if (this.bgPool.length === 0) throw new Error(t("no_background_connection_is_available"));
      const availableIndex = this.bgPool.findIndex(bg => !bg.isExecuting);
      if (availableIndex !== -1) {
        this.bgPool[availableIndex].isExecuting = true;
        return this.bgPool[availableIndex];
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  async getDbVersion() {
    const connInfo = this.bgPool.length > 0 ? await this.getAvailableBgConnection() : { conn: this.connection, isExecuting: false };
    const conn = connInfo ? connInfo.conn : null;
    if (!conn) return t("database_not_connected");

    try {
      const res = await conn.execute(`SELECT BANNER FROM v$version`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return res.rows.map(row => row.BANNER).join('\n');
    } catch (err) {
      return t("failed_to_retrieve_version_information") + err.message;
    } finally {
      if (connInfo && connInfo.id !== undefined) connInfo.isExecuting = false;
    }
  }

  // Check the actual main connection state rather than inferring it from SQL syntax.
  // Do not assume there are no uncommitted changes when the connection is unavailable.
  getMainTransactionState() {
    try {
      const state = this.connection?.transactionInProgress;
      if (typeof state !== 'boolean') return undefined;
      this.hasUncommittedTx = state;
      return state;
    } catch {
      return undefined;
    }
  }

  async getTriggerDefinition(request) {
    const { getTrigger } = require('./triggerDefinition');
    return getTrigger((sql, binds) => this.execute(sql, binds, null, false, true), request);
  }

  async getDatabaseLink(request) {
    const { getLink } = require('./databaseLink');
    return getLink((sql, binds) => this.execute(sql, binds, null, false, true), request, this.isReadonly);
  }

  async rememberManagedSession(connection) {
    const { IDENTITY_SQL, identity } = require('./lockManagement');
    try {
      const row = (await connection.execute(IDENTITY_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows?.[0];
      if (row) {
        const session = identity(row);
        if (Object.values(session).every(Number.isSafeInteger)) this.managedSessions.set(connection, session);
      }
    } catch { /* Lock actions stay disabled when managed session identities cannot be confirmed. */ }
  }

  lockOptions() {
    const connections = [this.connection, ...this.bgPool.map(item => item.conn)].filter(Boolean);
    return { readonly: this.isReadonly, ownSessions: connections.map(conn => this.managedSessions.get(conn)).filter(Boolean),
      protectionReady: connections.length > 0 && connections.every(conn => this.managedSessions.has(conn)) };
  }

  async withLockConnection(run) {
    if (this.bgPool.length === 0) throw new Error('lock_read_failed');
    const slot = await this.getAvailableBgConnection();
    try {
      const { LOCK_SQL } = require('./lockManagement');
      return await run((sql, binds = {}) => slot.conn.execute(sql, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        ...(sql === LOCK_SQL ? { fetchInfo: { SQL_TEXT: { type: oracledb.STRING }, PREV_SQL_TEXT: { type: oracledb.STRING } } } : {})
      }));
    } finally { slot.isExecuting = false; }
  }

  async readOracleLocks() {
    const { readLocks } = require('./lockManagement');
    return this.withLockConnection(query => readLocks(query, this.lockOptions()));
  }

  async terminateOracleLockSession(request) {
    if (this.lockCommandPending) throw new Error('lock_operation_busy');
    this.lockCommandPending = true;
    try {
      const { terminateLockSession } = require('./lockManagement');
      return await this.withLockConnection(query => terminateLockSession(query, request, this.lockOptions()));
    } finally { this.lockCommandPending = false; }
  }

  async withSessionConnection(run) {
    if (!this.bgPool.length) throw new Error('session_read_failed');
    const main = this.connection;
    const slot = await this.getAvailableBgConnection();
    try {
      const { TEXT_SQL, PREV_TEXT_SQL } = require('./sessionManagement');
      const query = (sql, binds = {}) => {
        if (this.connection !== main) throw new Error('session_connection_changed');
        return slot.conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT,
          ...([TEXT_SQL, PREV_TEXT_SQL].includes(sql) ? { fetchInfo: { SQL_TEXT: { type: oracledb.STRING } } } : {}) });
      };
      return await run(query, { ...this.lockOptions(), serverVersion: slot.conn.oracleServerVersionString || '' });
    } finally { slot.isExecuting = false; }
  }

  async listOracleSessions() { return this.withSessionConnection((query, options) => require('./sessionManagement').readSessions(query, options)); }
  async readOracleSessionDetail(request) { return this.withSessionConnection((query, options) => require('./sessionManagement').readDetail(query, request, options)); }
  async manageOracleSession(request) {
    if (this.sessionCommandPending) throw new Error('session_operation_busy');
    this.sessionCommandPending = true;
    try { return await this.withSessionConnection((query, options) => require('./sessionManagement').manageSession(query, request, options)); }
    finally { this.sessionCommandPending = false; }
  }

  async withUserRoleConnection(run) {
    const main = this.connection;
    if (!main || !this.dbLinkConnectOptions) throw Object.assign(Error('ora_user_not_connected'), { userRoleKey: 'ora_user_not_connected' });
    const connection = await oracledb.getConnection({ ...this.dbLinkConnectOptions });
    connection.callTimeout = 120000;
    let reserved = false, result, failure;
    const changed = () => Object.assign(Error('ora_user_connection_changed'), { userRoleKey: 'ora_user_connection_changed' });
    try {
      while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.connection !== main) throw changed();
      this.isExecuting = true; reserved = true;
      const { IDENTITY_SQL } = require('./userRoleManagement');
      const primary = (await main.execute(IDENTITY_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows[0];
      const query = (sql, binds = {}) => {
        if (this.connection !== main) throw changed();
        return connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      };
      const dedicated = (await query(IDENTITY_SQL)).rows[0];
      if (!primary || !dedicated || ['DB_NAME','CON_ID','SESSION_USER'].some(key => String(primary[key]) !== String(dedicated[key]))) throw changed();
      if (this.userRoleScopeMain !== main) { this.userRoleScopeMain = main; this.userRoleScope = randomBytes(24).toString('hex'); }
      result = await run(query, { readonly: this.isReadonly, connectionId: this.userRoleScope, serverVersion: connection.oracleServerVersionString });
      return result;
    } catch (error) { failure = error; throw error; }
    finally {
      try { await connection.close(); }
      catch (error) {
        if (!failure) {
          error.userRoleApplied = result?.applied === true;
          // eslint-disable-next-line no-unsafe-finally -- Preserve known DDL outcomes on cleanup failure.
          throw error;
        }
      }
      finally { if (reserved && this.connection === main) this.isExecuting = false; }
    }
  }
  getUserRoleManager() {
    if (!this.userRoleManager) this.userRoleManager = require('./userRoleManagement').createUserRoleManager();
    return this.userRoleManager;
  }
  async listManagedUserRoles() { return this.withUserRoleConnection((query, options) => this.getUserRoleManager().list(query, options)); }
  async getManagedUserRoleDetail(input) { return this.withUserRoleConnection((query, options) => this.getUserRoleManager().detail(query, input, options)); }
  async reviewUserRoleOperation(input) { return this.withUserRoleConnection((query, options) => this.getUserRoleManager().review(query, input, options)); }
  async executeUserRoleOperation(input) {
    if (this.userRolePending) throw Object.assign(Error('ora_user_busy'), { userRoleKey: 'ora_user_busy' });
    this.userRolePending = true;
    try { return await this.withUserRoleConnection((query, options) => this.getUserRoleManager().execute(query, input, options)); }
    finally { this.userRolePending = false; }
  }

  async withTablespaceConnection(run) {
    if (!this.connection || !this.dbLinkConnectOptions) throw new Error('ts_not_connected');
    const main = this.connection, connection = await oracledb.getConnection({ ...this.dbLinkConnectOptions });
    connection.callTimeout = 120000;
    let reserved = false, result, operationError;
    try {
      while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.connection !== main) throw new Error('ts_connection_changed');
      this.isExecuting = true; reserved = true;
      const { IDENTITY_SQL } = require('./tablespaceManagement');
      const current = (await main.execute(IDENTITY_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows[0];
      const query = (sql, binds = {}) => {
        if (this.connection !== main) throw new Error('ts_connection_changed');
        return connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      };
      const dedicated = (await query(IDENTITY_SQL)).rows[0];
      if (!current || !dedicated || current.DB_NAME !== dedicated.DB_NAME || String(current.CON_ID) !== String(dedicated.CON_ID)) throw new Error('ts_connection_changed');
      result = await run(query, { readonly: this.isReadonly, scope: main }); return result;
    } catch (error) { operationError = error; throw error; }
    finally {
      try { await connection.close(); }
      catch (error) {
        if (!operationError) {
          error.tsCompleted = result?.completed || []; error.tsAttempted = result?.attempted || null;
          // eslint-disable-next-line no-unsafe-finally -- Report known applied work even when cleanup fails.
          throw error;
        }
      } finally { if (reserved && this.connection === main) this.isExecuting = false; }
    }
  }

  getTablespaceManager() {
    if (!this.tablespaceManager) this.tablespaceManager = require('./tablespaceManagement').createTablespaceManager();
    return this.tablespaceManager;
  }
  async listManagedTablespaces() { return this.withTablespaceConnection((query, options) => this.getTablespaceManager().read(query, options)); }
  async getManagedTablespaceDetail(target) { return this.withTablespaceConnection((query, options) => this.getTablespaceManager().detail(query, target, options)); }
  async reviewTablespaceOperation(request) { return this.withTablespaceConnection((query, options) => this.getTablespaceManager().review(query, request, options)); }
  async executeTablespaceOperation(request) {
    if (this.tablespaceCommandPending) throw new Error('ts_busy');
    this.tablespaceCommandPending = true;
    try { return await this.withTablespaceConnection((query, options) => this.getTablespaceManager().execute(query, request, options)); }
    finally { this.tablespaceCommandPending = false; }
  }

  async withPdbManagementConnection(run, root = true) {
    if (!this.connection || !this.dbLinkConnectOptions) throw new Error('pdb_not_connected');
    const main = this.connection;
    const connection = await oracledb.getConnection({ ...this.dbLinkConnectOptions });
    connection.callTimeout = 120000;
    let result, operationError, reservedMain = false;
    try {
      const query = (sql, binds = {}) => {
        if (this.connection !== main) throw new Error('pdb_not_connected');
        return connection.execute(sql,
        Object.fromEntries(Object.entries(binds).map(([key, value]) => [key, value?.pdbOutNumber ? { dir: oracledb.BIND_OUT, type: oracledb.NUMBER } : value])),
        { outFormat: oracledb.OUT_FORMAT_OBJECT });
      };
      const { access, IDENTITY_SQL } = require('./pdbManagement');
      let mainContainer;
      while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
      if (this.connection !== main) throw new Error('pdb_not_connected');
      this.isExecuting = true; reservedMain = true;
      mainContainer = (await main.execute(IDENTITY_SQL, {}, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows[0]?.CON_NAME;
      if (!mainContainer) throw Object.assign(new Error('pdb_access_unknown'), { publicKey: 'pdb_access_unknown' });
      const origin = await access(query);
      if (root && origin.container !== 'CDB$ROOT') {
        if (!origin.common) throw Object.assign(new Error('pdb_root_required'), { publicKey: 'pdb_root_required' });
        await query('ALTER SESSION SET CONTAINER = "CDB$ROOT"');
      }
      if (this.connection !== main) throw new Error('pdb_not_connected');
      result = await run(query, { readonly: this.isReadonly, originContainer: origin.container, protectedContainers: [mainContainer], scope: main });
      return result;
    } catch (error) { operationError = error; throw error; }
    finally {
      try { await connection.close(); }
      catch (error) {
        if (!operationError) {
          error.pdbStage = result?.stage || 'not_started';
          // eslint-disable-next-line no-unsafe-finally -- Cleanup failure must not report an unqualified success.
          throw error;
        }
      } finally { if (reservedMain && this.connection === main) this.isExecuting = false; }
    }
  }

  getPdbManager() {
    if (!this.pdbManager) this.pdbManager = require('./pdbManagement').createPdbManager();
    return this.pdbManager;
  }

  async inspectPdbAccess() { return this.withPdbManagementConnection(query => require('./pdbManagement').access(query), false); }
  async listManagedPdbs() { return this.withPdbManagementConnection((query, options) => this.getPdbManager().list(query, options)); }
  async getManagedPdbDetail(target) { return this.withPdbManagementConnection((query, options) => this.getPdbManager().detail(query, target, options)); }
  async reviewPdbOperation(request) { return this.withPdbManagementConnection((query, options) => this.getPdbManager().review(query, request, options)); }
  async executePdbOperation(request) {
    if (this.pdbOperationPending) throw Object.assign(new Error('pdb_busy'), { publicKey: 'pdb_busy' });
    this.pdbOperationPending = true;
    try { return await this.withPdbManagementConnection((query, options) => this.getPdbManager().execute(query, request, options)); }
    finally { this.pdbOperationPending = false; }
  }

  async withObjectPrivilegeConnection(run) {
    if (!this.bgPool.length) throw new Error('object_priv_not_connected');
    const slot = await this.getAvailableBgConnection();
    try { return await run((sql, binds = {}) => slot.conn.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })); }
    finally { slot.isExecuting = false; }
  }

  async listObjectPrivilegePrincipals() {
    return this.withObjectPrivilegeConnection(query => require('./objectPrivileges').listPrincipals(query));
  }

  async getObjectPrivileges(target) {
    return this.withObjectPrivilegeConnection(query => require('./objectPrivileges').readPrivileges(query, target, this.isReadonly));
  }

  async mutateObjectPrivileges(request) {
    if (!this.connection) throw new Error('object_priv_not_connected');
    if (this.objectPrivilegePending) throw new Error('object_priv_busy');
    this.objectPrivilegePending = true;
    try {
      while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
      this.isExecuting = true;
      try {
        return await require('./objectPrivileges').mutatePrivileges((sql, binds) => this.connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }), request, this.isReadonly);
      } finally { this.isExecuting = false; this.getMainTransactionState(); }
    } finally { this.objectPrivilegePending = false; }
  }

  async listDirectoryDefinitions() {
    const { listDirectories } = require('./directoryDefinition');
    return listDirectories((sql, binds) => this.execute(sql, binds, null, false, true), this.isReadonly);
  }

  async getDirectoryDefinition(name) {
    const { readDirectory } = require('./directoryDefinition');
    return readDirectory((sql, binds) => this.execute(sql, binds, null, false, true), name, this.isReadonly);
  }

  async mutateDirectoryDefinition(request) {
    if (!this.connection) throw new Error('directory_not_connected');
    while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
    this.isExecuting = true;
    const connection = this.connection;
    try {
      const { mutateDirectory } = require('./directoryDefinition');
      return await mutateDirectory((sql, binds) => connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }), request, this.isReadonly);
    } finally { this.isExecuting = false; this.getMainTransactionState(); }
  }

  async saveDatabaseLink(request) {
    if (!this.connection) throw new Error('dblink_not_connected');
    while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
    this.isExecuting = true;
    const connection = this.connection;
    try {
      const { saveLink } = require('./databaseLink');
      return await saveLink((sql, binds) => connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }), request, this.isReadonly);
    } finally { this.isExecuting = false; this.getMainTransactionState(); }
  }

  async testDatabaseLink(request) {
    if (!this.connection || !this.dbLinkConnectOptions) throw new Error('dblink_not_connected');
    // A disposable local session owns the remote link. Closing it releases only this test's resources.
    const connection = await oracledb.getConnection(this.dbLinkConnectOptions);
    connection.callTimeout = 15000;
    try {
      const { testLink } = require('./databaseLink');
      return await testLink((sql, binds) => connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }), request);
    } finally { await connection.close(); }
  }

  async saveTriggerDefinition(request) {
    if (!this.connection) throw new Error(t('database_not_connected'));
    if (this.isReadonly) throw new Error(t('cannot_modify_data_or_structure_while_connected_in_read_only_mode'));
    while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
    this.isExecuting = true;
    const connection = this.connection;
    try {
      const { saveTrigger } = require('./triggerDefinition');
      return await saveTrigger((sql, binds) => connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }), request);
    } finally {
      this.isExecuting = false;
      this.getMainTransactionState();
    }
  }

  async execute(sqlText, binds = {}, schema = null, param4 = false, isBackground = false, container = null) {
    if (!this.connection) throw new Error(t("database_not_connected"));

    let activeConnObj = null;
    if (isBackground === true && this.bgPool.length > 0) {
      activeConnObj = await this.getAvailableBgConnection();
    } else {
      while (this.isExecuting) await new Promise(resolve => setTimeout(resolve, 50));
      this.isExecuting = true;
      activeConnObj = { conn: this.connection, id: 'MAIN' };
    }

    let originalContainer = null;
    let restoreContainer = false;
    let readOnlyTransaction = false;
    try {
      if (container !== null) {
        if (!isBackground || activeConnObj.id === 'MAIN') {
          throw new Error(t("container_specific_operations_require_a_background_connection"));
        }
        if (typeof container !== 'string' || !/^[A-Za-z0-9_$#]+$/.test(container)) {
          throw new Error(t("invalid_container_name"));
        }
        const current = await activeConnObj.conn.execute("SELECT SYS_CONTEXT('USERENV', 'CON_NAME') AS CON_NAME FROM DUAL", {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
        originalContainer = current.rows[0].CON_NAME;
        if (originalContainer !== container) {
          await activeConnObj.conn.execute(`ALTER SESSION SET CONTAINER = "${container}"`);
          restoreContainer = true;
        }
      }
      if (!app.isPackaged) {
        const label = activeConnObj.id === 'MAIN' ? '[OracleClient Main Execute]' : `[OracleClient BG Execute - Pool ID: ${activeConnObj.id}]`;
        console.log(`\n${label}`);
        // Do not log SQL text; it can contain credentials or production data.
        console.log('[oracle] Executing SQL.');
      }

      updateCurrentSettings();

      if (this.isReadonly) {
        if (!isReadOnlySql(sqlText, 'oracle')) throw new Error(t("cannot_modify_data_or_structure_while_connected_in_read_only_mode"));
        await activeConnObj.conn.execute('SET TRANSACTION READ ONLY');
        readOnlyTransaction = true;
      }

      const startTime = Date.now();
      let result;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            result = await activeConnObj.conn.execute(sqlText, binds, {
              outFormat: oracledb.OUT_FORMAT_OBJECT,
              fetchTypeHandler: metadata => metadata.dbType === oracledb.DB_TYPE_NUMBER ? {
                type: oracledb.STRING,
                converter: value => {
                  if (value === null) return null;
                  const integer = /^[+-]?\d+$/.test(value) ? Number(value) : NaN;
                  return Number.isSafeInteger(integer) ? integer : value;
                }
              } : undefined
            });
            break;
          } catch (error) {
            if (!this.isReadonly || error.errorNum !== 1466 || attempt >= 1) throw error;
            // A recent DDL can invalidate Oracle's read snapshot. Retry only this read, once.
            await activeConnObj.conn.rollback();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await activeConnObj.conn.execute('SET TRANSACTION READ ONLY');
          }
        }
      } catch (err) {
        if (err.message.includes('ORA-03113') || err.message.includes('ORA-03114') || err.message.includes('NJS-040')) {
          this.disconnect(); 
          throw new Error(t("the_database_connection_was_lost_possibly_because_of_a_network_error"));
        }
        if (err.message.includes('DPI-1067') || err.message.includes('NJS-115')) {
          throw new Error(t("the_query_exceeded_the_configured_timeout"));
        }
        throw err;
      }

      const executionTime = Date.now() - startTime;

      const processedRows = (result.rows || []).map(row => {
        const newRow = {};
        for (const key of Object.keys(row)) {
          const val = row[key];
          if (val && Buffer.isBuffer(val)) newRow[key] = val.toString('hex').toUpperCase();
          else if (val instanceof Date) newRow[key] = formatDateToOutput(val, currentOutputDateFormat || DEFAULT_DATETIME_FORMAT);
          else newRow[key] = val;
        }
        return newRow;
      });

      return { 
        rows: JSON.parse(JSON.stringify(processedRows)), 
        metaData: JSON.parse(JSON.stringify(result.metaData || [])), 
        rowsAffected: result.rowsAffected, 
        executionTime
      };
    } finally {
      try {
        if (readOnlyTransaction) await activeConnObj.conn.rollback();
        if (restoreContainer) {
          await activeConnObj.conn.execute(`ALTER SESSION SET CONTAINER = "${originalContainer.replace(/"/g, '""')}"`);
        }
      } catch (error) {
        // Do not reuse a connection whose state could not be restored.
        this.bgPool = this.bgPool.filter(connection => connection !== activeConnObj);
        if (activeConnObj.id === 'MAIN') this.connection = null;
        try { await activeConnObj.conn.close(); } catch { /* The connection may already be invalid. */ }
        // eslint-disable-next-line no-unsafe-finally -- Failed session restoration invalidates the result.
        throw error;
      } finally {
        if (activeConnObj.id !== 'MAIN') {
          activeConnObj.isExecuting = false;
        } else {
          this.isExecuting = false;
        }
      }
    }
  }

  async explain(sqlText, inputBinds = {}) {
    if (!this.connection) throw new Error(t("database_not_connected"));
    const bg = await this.getAvailableBgConnection();
    if (!bg) throw new Error(t("no_background_connection_is_available_for_analysis_reconnect_and_try_again"));
    if (this.isReadonly && !isReadOnlySql(sqlText, 'oracle')) {
      bg.isExecuting = false;
      throw new Error(t("cannot_modify_data_or_structure_while_connected_in_read_only_mode"));
    }
    let executionError;

    try {
      const startTime = Date.now();
      // Create and retrieve the plan on the same background connection.
      const statementId = `MB_${randomBytes(12).toString('hex')}`;
      await bg.conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${statementId}' FOR ${sqlText.replace(/;\s*$/, '')}`, inputBinds);
      const binds = { statementId };
      const result = await bg.conn.execute(`SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY('PLAN_TABLE', :statementId))`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const objects = await bg.conn.execute('SELECT ID, OBJECT_OWNER, OBJECT_NAME, OBJECT_TYPE FROM PLAN_TABLE WHERE STATEMENT_ID = :statementId ORDER BY ID', binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const byId = new Map((objects.rows || []).map(row => [String(row.ID), row]));
      const rows = (result.rows || []).map(row => {
        const id = String(row.PLAN_TABLE_OUTPUT || '').match(/^\|\s*\*?\s*(\d+)\s*\|/)?.[1];
        const object = byId.get(id);
        return object ? { ...row, PLAN_OBJECT_OWNER: object.OBJECT_OWNER, PLAN_OBJECT_NAME: object.OBJECT_NAME, PLAN_OBJECT_TYPE: object.OBJECT_TYPE } : row;
      });
      const schemaResult = await bg.conn.execute("SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS EXECUTION_SCHEMA FROM DUAL", [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
      const executionSchema = schemaResult.rows?.[0]?.EXECUTION_SCHEMA;
      if (typeof executionSchema !== 'string' || !executionSchema) throw new Error('The execution schema is unavailable.');
      return {
        executionSchema,
        rows: JSON.parse(JSON.stringify(rows)),
        metaData: JSON.parse(JSON.stringify(result.metaData || [])), 
        executionTime: Date.now() - startTime 
      };
    } catch (error) {
      executionError = error;
      throw error;
    } finally {
      try {
        await bg.conn.rollback();
      } catch (error) {
        // Do not reuse a connection whose cleanup failed.
        this.bgPool = this.bgPool.filter(connection => connection !== bg);
        try { await bg.conn.close(); } catch { /* The connection may already be invalid. */ }
        // eslint-disable-next-line no-unsafe-finally -- Surface cleanup failure only when execution succeeded.
        if (!executionError) throw error;
      } finally {
        bg.isExecuting = false;
      }
    }
  }

  async commit() { 
    if (!this.connection) return;
    while (this.isExecuting) await new Promise(r => setTimeout(r, 50));
    this.isExecuting = true;
    try {
      await this.connection.commit(); 
      for (const bg of this.bgPool) {
        try { await bg.conn.commit(); } catch(e) {}
      }
    } finally {
      this.getMainTransactionState();
      this.isExecuting = false;
    }
  }

  async rollback() { 
    if (!this.connection) return;
    while (this.isExecuting) await new Promise(r => setTimeout(r, 50));
    this.isExecuting = true;
    try {
      await this.connection.rollback(); 
      for (const bg of this.bgPool) {
        try { await bg.conn.rollback(); } catch(e) {}
      }
    } finally {
      this.getMainTransactionState();
      this.isExecuting = false;
    }
  }

  async getSchemas(includeMaintained = false, detailed = false) {
    const connInfo = this.bgPool.length > 0 ? await this.getAvailableBgConnection() : { conn: this.connection, isExecuting: false };
    const conn = connInfo ? connInfo.conn : null;
    if (!conn) throw new Error(t("database_not_connected"));

    const maintainFilter = includeMaintained ? "" : "WHERE ORACLE_MAINTAINED = 'N'";
    const oracleFormat = getOracleDateFormat(currentOutputDateFormat);
    try {
      if (detailed) {
        try { return (await conn.execute(`SELECT USERNAME, ACCOUNT_STATUS, TO_CHAR(CREATED, '${oracleFormat}') AS CREATED FROM DBA_USERS ${maintainFilter} ORDER BY USERNAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows; }
        catch (e) { return (await conn.execute(`SELECT USERNAME, 'UNKNOWN' AS ACCOUNT_STATUS, TO_CHAR(CREATED, '${oracleFormat}') AS CREATED FROM ALL_USERS ${maintainFilter} ORDER BY USERNAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows; }
      } else {
        try { return (await conn.execute(`SELECT USERNAME FROM ALL_USERS ${maintainFilter} ORDER BY USERNAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map(r => r.USERNAME); }
        catch (e) { return (await conn.execute(`SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map(r => r.USERNAME); }
      }
    } catch (err) {
      if (detailed) return (await conn.execute(`SELECT USERNAME, 'UNKNOWN' AS ACCOUNT_STATUS, TO_CHAR(CREATED, '${oracleFormat}') AS CREATED FROM ALL_USERS ORDER BY USERNAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
      else return (await conn.execute(`SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map(r => r.USERNAME);
    } finally {
      if (connInfo && connInfo.id !== undefined) connInfo.isExecuting = false;
    }
  }

  async getObjects(owner, type) {
    const connInfo = this.bgPool.length > 0 ? await this.getAvailableBgConnection() : { conn: this.connection, isExecuting: false };
    const conn = connInfo ? connInfo.conn : null;
    if (!conn) throw new Error(t("database_not_connected"));

    try {
      if (type === 'MATERIALIZED VIEW LOG') {
        return (await conn.execute(`SELECT MASTER AS OBJECT_NAME FROM ALL_MVIEW_LOGS WHERE LOG_OWNER = :owner ORDER BY MASTER`, { owner }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map(r => r.OBJECT_NAME);
      }
      return (await conn.execute(`SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_TYPE = :type ORDER BY OBJECT_NAME`, { owner, type }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map(r => r.OBJECT_NAME);
    } finally {
      if (connInfo && connInfo.id !== undefined) connInfo.isExecuting = false;
    }
  }

  async getColumns(schemaName, tableName) {
    const connInfo = this.bgPool.length > 0 ? await this.getAvailableBgConnection() : { conn: this.connection, isExecuting: false };
    const conn = connInfo ? connInfo.conn : null;
    if (!conn) throw new Error(t("database_not_connected"));

    try {
      return (await conn.execute(`SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tableName ORDER BY COLUMN_ID`, { owner: schemaName, tableName }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows.map(r => r.COLUMN_NAME);
    } finally {
      if (connInfo && connInfo.id !== undefined) connInfo.isExecuting = false;
    }
  }

  async getTablespaces() {
    return (await this.listManagedTablespaces()).tablespaces.map(row => ({ ...row, TABLESPACE_NAME: row.name, BIGFILE: row.bigfile ? 'YES' : 'NO', TOTAL_MB: row.allocatedMb, USED_MB: row.usedMb, FREE_MB: row.freeMb, USED_PERCENT: row.usedPercent }));
  }
  async getTablespaceDetails() { throw new Error('ts_identity_required'); }

  async getDirectories() {
    const connInfo = this.bgPool.length > 0 ? await this.getAvailableBgConnection() : { conn: this.connection, isExecuting: false };
    const conn = connInfo ? connInfo.conn : null;
    if (!conn) throw new Error(t("database_not_connected"));

    try {
      return (await conn.execute(`SELECT OWNER, DIRECTORY_NAME, DIRECTORY_PATH FROM DBA_DIRECTORIES ORDER BY DIRECTORY_NAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows; 
    } catch (err) {
      return (await conn.execute(`SELECT OWNER, DIRECTORY_NAME, DIRECTORY_PATH FROM ALL_DIRECTORIES ORDER BY DIRECTORY_NAME`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows; 
    } finally {
      if (connInfo && connInfo.id !== undefined) connInfo.isExecuting = false;
    }
  }

  async getDirectoryPrivileges(directoryName) {
    const connInfo = this.bgPool.length > 0 ? await this.getAvailableBgConnection() : { conn: this.connection, isExecuting: false };
    const conn = connInfo ? connInfo.conn : null;
    if (!conn) throw new Error(t("database_not_connected"));

    try {
      return (await conn.execute(`SELECT GRANTEE, PRIVILEGE FROM DBA_TAB_PRIVS WHERE TABLE_NAME = :directoryName AND TYPE = 'DIRECTORY' AND PRIVILEGE IN ('READ', 'WRITE')`, { directoryName }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
    } catch (err) {
      return (await conn.execute(`SELECT GRANTEE, PRIVILEGE FROM ALL_TAB_PRIVS WHERE TABLE_NAME = :directoryName AND TYPE = 'DIRECTORY' AND PRIVILEGE IN ('READ', 'WRITE')`, { directoryName }, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows;
    } finally {
      if (connInfo && connInfo.id !== undefined) connInfo.isExecuting = false;
    }
  }

  async getSessions() {
    return (await this.listOracleSessions()).sessions.map(row => ({ ...row, 'SERIAL#': row.SERIAL }));
  }

  async getSessionStats() { throw new Error('session_identity_required'); }
  async killSession() { return { success: false, error: 'session_identity_required' }; }
  async cancelSQL() { return { success: false, error: 'session_identity_required' }; }

  async getLocks() {
    const snapshot = await this.readOracleLocks();
    return snapshot.locks.map(row => ({ ...row, 'SERIAL#': row.SERIAL, LMODE: row.HELD_MODE, REQUEST: row.REQUEST_MODE,
      TIME_SEC: row.HOLD_SECONDS, BLOCKING_SESSION: row.BLOCKING_SID }));
  }

  async executeStored(params) {
    if (!this.connection) throw new Error(t("database_not_connected"));

    while (this.isExecuting) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.isExecuting = true;

    try {
      updateCurrentSettings();
      const { schema, objectName, objectType, args, argTypes, argDirections, isSubProgramFunction, inputDateFormat } = params;

      if (this.isReadonly) {
        return { success: false, error: t("procedure_function_and_package_execution_is_blocked_in_read_only_mode") };
      }

      const packageParameters = objectType === 'PACKAGE' ? await getPackageRoutine(this.connection, params) : null;
      await this.connection.execute(`BEGIN DBMS_OUTPUT.ENABLE(NULL); END;`);

      const bindVars = {}, argumentNames = {};
      const quoteName = value => `"${value.replaceAll('"', '""')}"`;
      let argListSqlArray = [];

      if (args && Object.keys(args).length > 0) {
        for (const name of Object.keys(args)) {
          const key = `mb_arg_${Object.keys(argumentNames).length}`; argumentNames[key] = name;
          const formal = quoteName(name);
          let val = args[name];
          const type = argTypes ? argTypes[name] : '';
          const dirStr = argDirections ? argDirections[name] : 'IN'; 
          let bindDir = dirStr === 'OUT' ? oracledb.BIND_OUT : dirStr === 'IN/OUT' ? oracledb.BIND_INOUT : oracledb.BIND_IN;

          if (bindDir === oracledb.BIND_OUT || bindDir === oracledb.BIND_INOUT) {
            let outType = oracledb.STRING;
            if (type && (type.includes('DATE') || type.includes('TIMESTAMP'))) outType = oracledb.DATE;
            let bindObj = { dir: bindDir, type: outType };
            if (outType === oracledb.STRING) bindObj.maxSize = 4000;
            if (bindDir === oracledb.BIND_INOUT) {
               if (outType === oracledb.DATE && val) bindObj.val = new Date(String(val).replace(/\//g, '-').replace(' ', 'T').padEnd(19, 'T00:00:00'));
               else bindObj.val = val;
            }
            bindVars[key] = bindObj;
            argListSqlArray.push(`${formal} => :${key}`);
          } else {
            if (type && (type.includes('DATE') || type.includes('TIMESTAMP'))) {
              if (!val) argListSqlArray.push(`${formal} => NULL`);
              else {
                argListSqlArray.push(`${formal} => TO_DATE(:${key}, '${getOracleFormatForValue(inputDateFormat, String(val).trim())}')`);
                bindVars[key] = { val: String(val).trim(), dir: oracledb.BIND_IN };
              }
            } else {
              argListSqlArray.push(`${formal} => :${key}`);
              bindVars[key] = { val: val, dir: oracledb.BIND_IN };
            }
          }
        }
      }

      const callTarget = objectType === 'PACKAGE' ? `${quoteName(schema)}.${quoteName(objectName)}.${quoteName(params.subProgram)}` : `${quoteName(schema)}.${quoteName(objectName)}`;
      let callSql = (objectType === 'FUNCTION' || isSubProgramFunction) ? `:ret := ${callTarget}(${argListSqlArray.join(', ')});` : `${callTarget}(${argListSqlArray.join(', ')});`;
      if (objectType === 'FUNCTION' || isSubProgramFunction) bindVars.ret = { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 };

      if (packageParameters) callSql = packageInvocation(callTarget, Boolean(isSubProgramFunction), Object.keys(args || {}), argListSqlArray, packageParameters);
      const result = await this.connection.execute(`BEGIN ${callSql} END;`, bindVars);
      const outRes = await this.connection.execute(`BEGIN DBMS_OUTPUT.GET_LINES(:lines, :numlines); END;`, { lines: { type: oracledb.STRING, dir: oracledb.BIND_OUT, maxArraySize: 1000 }, numlines: { type: oracledb.NUMBER, dir: oracledb.BIND_INOUT, val: 1000 } });

      let returnValues = [];
      if (objectType === 'FUNCTION' || isSubProgramFunction) returnValues.push({ name: 'RETURN_VALUE', value: result.outBinds?.ret ?? '' });

      if (result.outBinds) {
        Object.keys(result.outBinds).forEach(k => {
          if (!['ret', 'lines', 'numlines'].includes(k)) {
            returnValues.push({ name: argumentNames[k] || k.toUpperCase(), value: result.outBinds[k] instanceof Date ? formatDateToOutput(result.outBinds[k], currentOutputDateFormat || DEFAULT_DATETIME_FORMAT) : result.outBinds[k] });
          }
        });
      }
      return { success: true, returnValues, dbmsOutput: outRes.outBinds.lines || [] };
    } catch (err) {
      return { success: false, error: err.message }; 
    } finally {
      this.isExecuting = false;
    }
  }

  async executeTrace(params) {
    if (!this.connection) throw new Error(t("database_not_connected"));

    if (this.isReadonly) {
      return { success: false, error: t("trace_analysis_is_unavailable_in_read_only_mode") };
    }

    while (this.isExecuting) {
      await new Promise(r => setTimeout(r, 50));
    }
    this.isExecuting = true;

    try {
      return await executeTrace(this.connection, params);
    } finally {
      this.isExecuting = false;
    }
  }

  async breakExecution() {
    if (this.connection) {
      try {
        await this.connection.break();
        return { success: true };
      } catch (err) { return { success: false, error: err.message }; }
    }
    return { success: false, error: t("database_not_connected") };
  }
}

module.exports = OracleClient;
