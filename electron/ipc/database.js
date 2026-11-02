// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createAiHistoryScope } = require('../ai/sourceHistory');
const { getAiDatabaseContext } = require('../services/aiDatabaseContext');
const { parsePrivateJson, readInternalText, assertDataSize, dataError } = require('../services/dataSafety');
const { createSqlBatches } = require('../services/sqlBatches');
const { createExportSnapshots } = require('../services/exportSnapshots');
const fs = require('node:fs');
const { createTraceIdentity, resolveTraceFile } = require('../services/traceFiles');
const { getStoragePaths } = require('../services/storagePaths');
const { TraceDatabase: OracleTraceDatabase } = require('../oracle/traceDb');
const OracleClient = require('../oracle/oracleClient');
const { executeTrace: executeOracleTrace } = require('../oracle/traceExecutor');
const PostgresClient = require('../postgres/postgresClient');
const { executeTracePg } = require('../postgres/traceExecutorPg');
const { TraceDatabase: PgTraceDatabase } = require('../postgres/traceDb');

function registerDatabaseHandlers({ getValidatedSettings, ipcMain, state, t, createSshHostVerifier }) {
  state.aiHistoryScopes ??= new Map();
  const sqlBatches = createSqlBatches(() => state.client);
  ipcMain.handle('get-ai-database-context', async () => {
    const client = state.client;
    try {
      if (!client) throw new Error(t('database_not_connected'));
      if (sqlBatches.isReserved()) throw new Error('AI context requires an idle SQL workspace.');
      const environment = await getAiDatabaseContext(client, state.type);
      if (state.client !== client) throw new Error(t('database_not_connected'));
      return { success: true, environment };
    } catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('begin-sql-batch', (event, id) => { try { sqlBatches.begin(event, id); return { success: true }; } catch (error) { return { success: false, error: error.message }; } });
  ipcMain.handle('end-sql-batch', (event, id) => { try { sqlBatches.end(event, id); return { success: true }; } catch (error) { return { success: false, error: error.message }; } });


  const exports = createExportSnapshots({ getClient: () => state.client,
    getDialect: () => state.type === 'oracle' ? 'oracle' : 'postgresql', t });
  ipcMain.handle('open-data-export', async (event, sql) => {
    try { return { success: true, ...await exports.open(event.sender, sql) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('read-data-export', async (event, id, offset, limit) => {
    try { return { success: true, ...exports.read(event.sender, id, offset, limit) }; }
    catch (error) { return { success: false, error: error.message }; }
  });
  ipcMain.handle('close-data-export', async (event, id) => {
    try { exports.close(event.sender, id); return { success: true }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  let connectionQueue = Promise.resolve();
  const enqueueConnectionChange = operation => {
    const result = connectionQueue.then(operation);
    // A rejected disconnect must not prevent subsequent connection requests.
    connectionQueue = result.catch(() => {});
    return result;
  };

  const pendingCleanup = new Set();
  const closeConnections = async () => {
    const previous = state.client;
    exports.clear();
    state.client = null;
    state.type = null;
    if (previous) pendingCleanup.add(previous);
    for (const client of pendingCleanup) {
      await client.disconnect();
      pendingCleanup.delete(client);
    }
  };

  ipcMain.handle('disconnect-db', () => enqueueConnectionChange(async () => {
    await closeConnections();
    return true;
  }));

  ipcMain.handle('get-db-info', async () => {
    try {
      if (!state.client) return { success: false, error: t("not_connected") };
      const info = await state.client.getDbVersion();
      return { success: true, info };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('connect-db', (event, config) => enqueueConnectionChange(async () => {
    let candidate;
    try {
      if (config.dbType === 'oracle') {
        candidate = new OracleClient({ createSshHostVerifier });
      } else if (config.dbType === 'postgres' || config.dbType === 'postgresql') {
        candidate = new PostgresClient({ createSshHostVerifier });
      } else {
        throw new Error(t("unsupported_database_type"));
      }

      const settings = getValidatedSettings();
      const finalConfig = {
        ...config,
        queryTimeout: settings.queryTimeout !== undefined ? settings.queryTimeout : 0
      };
      await closeConnections();

      // Publish a candidate only after it has connected successfully.
      await candidate.connect(finalConfig);
      state.client = candidate;
      state.type = config.dbType;
      const aiHistoryScope = createAiHistoryScope(finalConfig);
      state.aiHistoryScopes.set(aiHistoryScope, config.dbType === 'postgres' ? 'postgresql' : config.dbType);
      return { success: true, aiHistoryScope };
    } catch (err) {
      try { await candidate?.disconnect(); } catch {
        if (candidate) pendingCleanup.add(candidate);
      }
      return { success: false, error: err.message };
    }
  }));

  // Return the main connection's actual state on both success and failure.
  // Preserve the displayed state when the connection state cannot be determined.
  function getMainTransactionStateResponse(dbClient) {
    if (typeof dbClient?.getMainTransactionState !== 'function') return {};
    const state = dbClient.getMainTransactionState();
    return typeof state === 'boolean' ? { hasUncommittedTx: state } : {};
  }

  // Always execute SQL on the main connection.
  ipcMain.handle('execute-sql', async (event, sqlText, binds = {}, schema = null, batchId = null) => {
    const dbClient = state.client;
    let batch;
    try {
      batch = sqlBatches.enter(event, batchId);
      const processedBinds = {};
      for (const key in binds) {
        if (binds[key] instanceof ArrayBuffer) {
          processedBinds[key] = Buffer.from(binds[key]);
        } else if (binds[key] && binds[key].type === 'Buffer') {
           processedBinds[key] = Buffer.from(binds[key].data);
        } else if (binds[key] instanceof Uint8Array) {
           processedBinds[key] = Buffer.from(binds[key]);
        } else {
           processedBinds[key] = binds[key];
        }
      }
      return { success: true, ...(await dbClient.execute(sqlText, processedBinds, schema, false, false)), ...getMainTransactionStateResponse(dbClient), ...(batch?.cancelled ? { cancelled: true } : {}) };
    } catch (err) {
      const position = Number(err.position);
      return { success: false, error: err.message, ...(Number.isSafeInteger(position) && position > 0 ? { errorPosition: position } : {}), ...(typeof err.where === 'string' ? { errorContext: err.where } : {}), ...getMainTransactionStateResponse(dbClient), ...(batch?.cancelled ? { cancelled: true } : {}) };
    } finally { if (batch) batch.active = false; }
  });

  ipcMain.handle('execute-sql-bg', async (event, sqlText, binds = {}, schema = null, container = null) => {
    try {
      const processedBinds = {};
      for (const key in binds) {
        if (binds[key] instanceof ArrayBuffer) {
          processedBinds[key] = Buffer.from(binds[key]);
        } else if (binds[key] && binds[key].type === 'Buffer') {
           processedBinds[key] = Buffer.from(binds[key].data);
        } else if (binds[key] instanceof Uint8Array) {
           processedBinds[key] = Buffer.from(binds[key]);
        } else {
           processedBinds[key] = binds[key];
        }
      }
      return { success: true, ...(await state.client.execute(sqlText, processedBinds, schema, false, true, container)) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  for (const [channel, method] of [['get-postgres-trigger', 'getTriggerDefinition'], ['save-postgres-trigger', 'saveTriggerDefinition']]) {
    ipcMain.handle(channel, async (_event, request) => {
      const dbClient = state.client;
      try {
        if (!['postgres', 'postgresql'].includes(state.type) || typeof dbClient?.[method] !== 'function') throw new Error('PostgreSQL trigger operation is unavailable.');
        const trigger = await dbClient[method](request);
        return { success: true, ...(channel === 'get-postgres-trigger' ? { trigger } : getMainTransactionStateResponse(dbClient)) };
      } catch (error) {
        return { success: false, error: error.message, ...(channel === 'save-postgres-trigger' ? getMainTransactionStateResponse(dbClient) : {}) };
      }
    });
  }

  for (const [channel, method] of [['get-oracle-trigger', 'getTriggerDefinition'], ['save-oracle-trigger', 'saveTriggerDefinition']]) {
    ipcMain.handle(channel, async (_event, request) => {
      const dbClient = state.client;
      try {
        if (state.type !== 'oracle' || typeof dbClient?.[method] !== 'function') throw new Error('Oracle trigger operation is unavailable.');
        const trigger = await dbClient[method](request);
        return { success: true, trigger, ...(channel.startsWith('save-') ? getMainTransactionStateResponse(dbClient) : {}) };
      } catch (error) {
        return { success: false, error: error.message, ...(channel.startsWith('save-') ? getMainTransactionStateResponse(dbClient) : {}) };
      }
    });
  }

  for (const [channel, method] of [['get-oracle-dblink', 'getDatabaseLink'], ['save-oracle-dblink', 'saveDatabaseLink'], ['test-oracle-dblink', 'testDatabaseLink']]) {
    ipcMain.handle(channel, async (_event, request) => {
      const dbClient = state.client;
      try {
        if (state.type !== 'oracle' || typeof dbClient?.[method] !== 'function') throw new Error('dblink_not_connected');
        return { success: true, ...(await dbClient[method](request)), ...(channel === 'save-oracle-dblink' ? getMainTransactionStateResponse(dbClient) : {}) };
      } catch (error) {
        return { success: false, ...require('../oracle/databaseLink').safeError(error), ...(channel === 'save-oracle-dblink' ? getMainTransactionStateResponse(dbClient) : {}) };
      }
    });
  }

  for (const [channel, method] of [['inspect-oracle-pdb-access', 'inspectPdbAccess'], ['list-oracle-pdbs', 'listManagedPdbs'], ['get-oracle-pdb-detail', 'getManagedPdbDetail'], ['review-oracle-pdb-operation', 'reviewPdbOperation'], ['execute-oracle-pdb-operation', 'executePdbOperation']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'oracle' || typeof state.client?.[method] !== 'function') throw new Error('pdb_not_connected');
        return { success: true, ...await state.client[method](request) };
      } catch (error) { return { success: false, ...require('../oracle/pdbManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-oracle-tablespaces', 'listManagedTablespaces'], ['get-oracle-tablespace-detail', 'getManagedTablespaceDetail'], ['review-oracle-tablespace-operation', 'reviewTablespaceOperation'], ['execute-oracle-tablespace-operation', 'executeTablespaceOperation']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'oracle' || typeof state.client?.[method] !== 'function') throw new Error('ts_not_connected');
        return { success: true, ...await state.client[method](request) };
      } catch (error) { return { success: false, ...require('../oracle/tablespaceManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-oracle-sessions', 'listOracleSessions'], ['get-oracle-session-detail', 'readOracleSessionDetail'], ['manage-oracle-session', 'manageOracleSession']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'oracle' || typeof state.client?.[method] !== 'function') throw new Error('session_not_connected');
        return { success: true, ...await state.client[method](request) };
      } catch (error) { return { success: false, ...require('../oracle/sessionManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-oracle-user-roles', 'listManagedUserRoles'], ['get-oracle-user-role-detail', 'getManagedUserRoleDetail'], ['review-oracle-user-role-operation', 'reviewUserRoleOperation'], ['execute-oracle-user-role-operation', 'executeUserRoleOperation']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'oracle' || typeof state.client?.[method] !== 'function') throw Error('Unavailable');
        const result = await state.client[method](request);
        return { success: true, ...(channel === 'get-oracle-user-role-detail' ? { detail: result } : result) };
      } catch (error) { return { success: false, ...require('../oracle/userRoleManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-postgres-roles', 'listManagedRoles'], ['get-postgres-role-detail', 'getManagedRoleDetail'], ['review-postgres-role-operation', 'reviewRoleOperation'], ['execute-postgres-role-operation', 'executeRoleOperation']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'postgresql' || typeof state.client?.[method] !== 'function') throw Error('pg_role_not_connected');
        const result = await state.client[method](request);
        return { success: true, ...(channel === 'get-postgres-role-detail' ? { detail: result } : result) };
      } catch (error) { return { success: false, ...require('../postgres/roleManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-postgres-tablespaces', 'listPostgresTablespaces'], ['get-postgres-tablespace-detail', 'getPostgresTablespaceDetail'], ['review-postgres-tablespace-operation', 'reviewPostgresTablespaceOperation'], ['execute-postgres-tablespace-operation', 'executePostgresTablespaceOperation']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'postgresql' || typeof state.client?.[method] !== 'function') throw Error('pg_ts_not_connected');
        const result = await state.client[method](request);
        return { success: true, ...(channel === 'get-postgres-tablespace-detail' ? { detail: result } : result) };
      } catch (error) { return { success: false, ...require('../postgres/tablespaceManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-postgres-schemas', 'listManagedSchemas'], ['get-postgres-schema-detail', 'getManagedSchemaDetail'], ['review-postgres-schema-operation', 'reviewSchemaOperation'], ['execute-postgres-schema-operation', 'executeSchemaOperation']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'postgresql' || typeof state.client?.[method] !== 'function') throw new Error('pg_schema_not_connected');
        const result = await state.client[method](request);
        return { success: true, ...(channel === 'get-postgres-schema-detail' ? { detail: result } : result) };
      } catch (error) { return { success: false, ...require('../postgres/schemaManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-postgres-privilege-principals', 'listPostgresPrivilegePrincipals'], ['list-postgres-privilege-objects', 'listPostgresPrivilegeObjects'], ['get-postgres-object-privileges', 'readPostgresPrivileges'], ['review-postgres-object-privilege', 'reviewPostgresPrivilege'], ['mutate-postgres-object-privilege', 'mutatePostgresPrivilege']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'postgresql' || typeof state.client?.[method] !== 'function') throw new Error('pg_priv_not_connected');
        const result = await state.client[method](request);
        return { success: true, ...(['get-postgres-object-privileges'].includes(channel) ? { detail: result } : result) };
      } catch (error) { return { success: false, ...require('../postgres/objectPrivileges').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-postgres-sessions', 'readPostgresSessions'], ['manage-postgres-session', 'managePostgresSession']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'postgresql' || typeof state.client?.[method] !== 'function') throw new Error('pg_session_not_connected');
        return { success: true, ...await state.client[method](request) };
      } catch (error) { return { success: false, ...require('../postgres/sessionManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-postgres-locks', 'readPostgresLocks'], ['manage-postgres-lock', 'managePostgresLock']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'postgresql' || typeof state.client?.[method] !== 'function') throw new Error('pg_lock_not_connected');
        return { success: true, ...await state.client[method](request) };
      } catch (error) { return { success: false, ...require('../postgres/lockManagement').safeError(error) }; }
    });
  }

  for (const [channel, method] of [['list-oracle-locks', 'readOracleLocks'], ['terminate-oracle-lock-session', 'terminateOracleLockSession']]) {
    ipcMain.handle(channel, async (_event, request) => {
      try {
        if (state.type !== 'oracle' || typeof state.client?.[method] !== 'function') throw new Error('lock_not_connected');
        return { success: true, ...await state.client[method](request) };
      } catch (error) { return { success: false, ...require('../oracle/lockManagement').safeLockError(error) }; }
    });
  }

  for (const [channel, method] of [['list-oracle-privilege-principals', 'listObjectPrivilegePrincipals'], ['get-oracle-object-privileges', 'getObjectPrivileges'], ['mutate-oracle-object-privileges', 'mutateObjectPrivileges']]) {
    ipcMain.handle(channel, async (_event, request) => {
      const client = state.client;
      const writing = channel === 'mutate-oracle-object-privileges';
      try {
        if (state.type !== 'oracle' || typeof client?.[method] !== 'function') throw new Error('object_priv_not_connected');
        const result = await client[method](request);
        return { success: true, ...(channel === 'get-oracle-object-privileges' ? { detail: result } : result), ...(writing ? getMainTransactionStateResponse(client) : {}) };
      } catch (error) { return { success: false, ...require('../oracle/objectPrivileges').safeError(error), ...(writing ? getMainTransactionStateResponse(client) : {}) }; }
    });
  }

  for (const [channel, method] of [['list-oracle-directories', 'listDirectoryDefinitions'], ['get-oracle-directory', 'getDirectoryDefinition'], ['mutate-oracle-directory', 'mutateDirectoryDefinition']]) {
    ipcMain.handle(channel, async (_event, request) => {
      const client = state.client;
      try {
        if (state.type !== 'oracle' || typeof client?.[method] !== 'function') throw new Error('directory_not_connected');
        const result = await client[method](request);
        return { success: true, ...(channel === 'get-oracle-directory' ? { detail: result } : result), ...(channel === 'mutate-oracle-directory' ? getMainTransactionStateResponse(client) : {}) };
      } catch (error) {
        return { success: false, ...require('../oracle/directoryDefinition').safeDirectoryError(error), ...(channel === 'mutate-oracle-directory' ? getMainTransactionStateResponse(client) : {}) };
      }
    });
  }

  ipcMain.handle('execute-ddl-batch', async (_event, statements) => {
    const dbClient = state.client;
    try {
      if (!['postgres', 'postgresql'].includes(state.type) || typeof dbClient?.executeDdlBatch !== 'function') {
        throw new Error('Atomic DDL batches are supported only on PostgreSQL.');
      }
      await dbClient.executeDdlBatch(statements);
      return { success: true, ...getMainTransactionStateResponse(dbClient) };
    } catch (error) {
      return { success: false, error: error.message, ...getMainTransactionStateResponse(dbClient) };
    }
  });

  ipcMain.handle('explain-sql', async (event, sqlText, binds = {}, schema = null, batchId = null) => {
    const dbClient = state.client;
    let batch;
    try {
      batch = sqlBatches.enter(event, batchId);
      return { success: true, ...(await dbClient.explain(sqlText, binds, schema)), ...(batch?.cancelled ? { cancelled: true } : {}) };
    } catch (err) {
      return { success: false, error: err.message, ...(batch?.cancelled ? { cancelled: true } : {}) };
    } finally { if (batch) batch.active = false; }
  });

  ipcMain.handle('commit-db', async () => {
    const dbClient = state.client;
    try {
      await dbClient.commit();
      return { success: true, ...getMainTransactionStateResponse(dbClient) };
    } catch (err) {
      return { success: false, error: err.message, ...getMainTransactionStateResponse(dbClient) };
    }
  });

  ipcMain.handle('rollback-db', async () => {
    const dbClient = state.client;
    try {
      await dbClient.rollback();
      return { success: true, ...getMainTransactionStateResponse(dbClient) };
    } catch (err) {
      return { success: false, error: err.message, ...getMainTransactionStateResponse(dbClient) };
    }
  });

  ipcMain.handle('get-schemas', async (event, includeMaintained, detailed) => {
    try {
      return { success: true, schemas: await state.client.getSchemas(includeMaintained, detailed) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-objects', async (event, owner, type) => {
    try {
      return { success: true, objects: await state.client.getObjects(owner, type) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-tablespaces', async () => {
    try {
      return { success: true, tablespaces: await state.client.getTablespaces() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-tablespace-details', async (event, tablespaceName) => {
    try {
      return { success: true, datafiles: await state.client.getTablespaceDetails(tablespaceName) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-directories', async () => {
    try {
      return { success: true, directories: await state.client.getDirectories() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-directory-privileges', async (event, directoryName) => {
    try {
      return { success: true, privileges: await state.client.getDirectoryPrivileges(directoryName) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-sessions', async () => {
    try {
      return { success: true, sessions: await state.client.getSessions() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-session-stats', async (event, sid) => {
    try {
      return { success: true, stats: await state.client.getSessionStats(sid) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('kill-session', async (event, sid, serial) => {
    return await state.client.killSession(sid, serial);
  });

  ipcMain.handle('cancel-sql', async (event, sid, serial) => {
    return await state.client.cancelSQL(sid, serial);
  });

  ipcMain.handle('get-locks', async () => {
    try {
      return { success: true, locks: await state.client.getLocks() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-columns', async (event, schemaName, tableName) => {
    try { return { success: true, columns: await state.client.getColumns(schemaName, tableName) }; } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('execute-stored', async (event, params) => {
    const dbClient = state.client;
    try {
      if (dbClient && typeof dbClient.executeStored === 'function') {
        return { success: true, ...(await dbClient.executeStored(params)), ...getMainTransactionStateResponse(dbClient) };
      } else {
        throw new Error(t("unsupported_database_type"));
      }
    } catch (err) { return { success: false, error: err.message, ...getMainTransactionStateResponse(dbClient) }; }
  });

  ipcMain.handle('cancel-execution', async (event, batchId) => {
    try {
      const active = sqlBatches.cancel(event, batchId);
      if (batchId && !active) return { success: true };
      if (state.client && typeof state.client.breakExecution === 'function') {
        return await state.client.breakExecution();
      }
      return { success: false, error: t("cancellation_is_not_supported") };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('start-debug', async (event, params) => {
    try {
      if (state.client && typeof state.client.startDebug === 'function') {
        return { success: true, ...(await state.client.startDebug(params)) };
      }
      throw new Error(t("this_feature_is_not_supported"));
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('step-debug', async (event, params) => {
    try {
      if (state.client && typeof state.client.stepDebug === 'function') {
        return await state.client.stepDebug(params);
      }
      throw new Error(t("this_feature_is_not_supported"));
    } catch (err) { return { success: false, error: err.message }; }
  });

  ipcMain.handle('execute-trace', async (event, params) => {
    const dbClient = state.client;
    try {
      if (!dbClient) {
        throw new Error(t("database_not_connected"));
      }

      if (dbClient.isReadonly) throw new Error(t("trace_analysis_is_unavailable_in_read_only_mode"));
      if (dbClient.isExecuting) {
        return {
          success: false,
          errorCode: 'TRACE_MAIN_CONNECTION_BUSY',
          error: t("trace_main_connection_busy")
        };
      }

      // Prevent other SQL from using the main connection during the state check.
      dbClient.isExecuting = true;
      let hasMainTransaction;
      try {
        if (state.type === 'oracle') {
          hasMainTransaction = dbClient.getMainTransactionState();
          if (typeof hasMainTransaction !== 'boolean') {
            throw new Error(t("cannot_analyze_traces_because_the_main_connection_s_transaction_state_is_unknown"));
          }
        } else if (state.type === 'postgres' || state.type === 'postgresql') {
          hasMainTransaction = dbClient.getMainTransactionState();
          if (typeof hasMainTransaction !== 'boolean') {
            throw new Error(t("cannot_analyze_traces_because_the_main_connection_s_transaction_state_is_unknown"));
          }
        } else {
          throw new Error(t("trace_analysis_is_not_available_for_this_database"));
        }
      } finally {
        dbClient.isExecuting = false;
      }

      if (hasMainTransaction) {
        return {
          success: false,
          errorCode: 'TRACE_MAIN_TRANSACTION_PENDING',
          hasUncommittedTx: hasMainTransaction,
          error: t("trace_requires_clean_transaction")
        };
      }

      params = { ...params, traceIdentity: createTraceIdentity(dbClient.lastConfig, params.traceTarget || params) };
      if (state.type === 'oracle') {
        const rawConn = dbClient.connection || dbClient.client || dbClient.db || dbClient.conn || dbClient;
        return { success: true, ...(await executeOracleTrace(rawConn, params)), ...getMainTransactionStateResponse(dbClient) };
      } else if (state.type === 'postgres' || state.type === 'postgresql') {
        return { success: true, ...(await executeTracePg(dbClient, params)), ...getMainTransactionStateResponse(dbClient) };
      } else {
        throw new Error("Tracing is currently supported only for Oracle and PostgreSQL.");
      }
    } catch (err) {
      return { success: false, error: err.message, ...getMainTransactionStateResponse(dbClient) };
    }
  });

  ipcMain.handle('delete-trace-db', async (event, target) => {
    try {
      const objectName = createTraceIdentity(state.client?.lastConfig, target);
      if (state.type === 'oracle') {
        OracleTraceDatabase.deleteDatabase(objectName);
      } else if (state.type === 'postgres' || state.type === 'postgresql') {
        PgTraceDatabase.deleteDatabase(objectName);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-trace-for-ai', async (_event, params) => {
    let file;
    const originalClient = state.client;
    try {
      const dbType = state.type === 'postgres' ? 'postgresql' : state.type;
      if (params?.dbType !== dbType ||
          !['oracle', 'postgresql'].includes(dbType)) {
        throw new Error('接続先が変更されました。対象ウィンドウから再度依頼してください。');
      }
      const identity = createTraceIdentity(state.client?.lastConfig, params);
      const approvedBytes = params.approvedBytes ?? 1_000_000;
      if (!Number.isSafeInteger(approvedBytes) || approvedBytes < 1_000_000) throw new Error('Invalid approved trace size.');
      const directory = dbType === 'oracle' ? 'oracle' : 'postgres';
      const filePath = resolveTraceFile(getStoragePaths().traceDirectory, directory, identity);
      file = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
      const status = await file.stat();
      if (!status.isFile()) throw dataError('internal_data_not_regular');
      const { size } = status;
      assertDataSize(size);
      if (size > approvedBytes) {
        return { success: false, requiresConfirmation: true, sizeBytes: size };
      }
      const content = await readInternalText(filePath);
      // Check again if the file has grown since the initial check.
      if (Buffer.byteLength(content) > approvedBytes) {
        return {
          success: false, requiresConfirmation: true,
          sizeBytes: Buffer.byteLength(content)
        };
      }
      const trace = parsePrivateJson(content);
      if (!trace.traceInfo || !Array.isArray(trace.traceSteps) ||
          trace.traceSteps.length === 0) {
        throw new Error('解析対象のトレースがありません。トレース解析を実行してください。');
      }
      const latestDbType = state.type === 'postgres' ? 'postgresql' : state.type;
      if (latestDbType !== dbType || state.client !== originalClient) {
        throw new Error('接続先が変更されました。対象ウィンドウから再度依頼してください。');
      }
      return { success: true, content };
    } catch (error) {
      return {
        success: false,
        error: error.code === 'ENOENT'
          ? 'トレース解析ログファイルがありません。トレース解析を実行してください。'
          : error.message
      };
    } finally {
      await file?.close();
    }
  });

  ipcMain.handle('get-trace-data', async (event, target) => {
    try {
      const objectName = createTraceIdentity(state.client?.lastConfig, target);
      let DBClass = null;

      if (state.type === 'oracle') {
        DBClass = OracleTraceDatabase;
      } else if (state.type === 'postgres' || state.type === 'postgresql') {
        DBClass = PgTraceDatabase;
      } else {
        throw new Error("Unsupported DB Type for Trace");
      }

      if (!DBClass.exists(objectName)) {
        return { success: true, info: null, steps: [] };
      }

      const db = new DBClass(objectName);
      await db.init();
      const info = await db.getTraceInfo();
      const steps = await db.getTraceSteps();
      db.close();

      const parsedSteps = steps.map(step => ({
        lineNum: step.line_num,
        loopPath: step.loop_path,
        variables: step.variables_json ? parsePrivateJson(step.variables_json) : {},
        logText: step.log_text
      }));

      return { success: true, info, steps: parsedSteps };
    } catch (err) {
      console.error('get-trace-data Error:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerDatabaseHandlers };
