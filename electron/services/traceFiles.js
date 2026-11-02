// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
const { workspacePath } = require('./workspacePaths');

function createTraceIdentity(config, target) {
  if (!target || typeof target !== 'object' || !['schema', 'objectName', 'objectType'].every(field => typeof target[field] === 'string' && target[field])) {
    throw new Error('A trace requires a schema, object name, and object type.');
  }
  if (target.signature !== undefined && typeof target.signature !== 'string') throw new Error('Invalid routine signature.');
  if (target.tableName !== undefined && (typeof target.tableName !== 'string' || !target.tableName || target.tableName.includes('\0'))) throw new Error('Invalid trigger table identity.');
  // Never include passwords, key files, or API credentials in a storage identity.
  const connection = ['host', 'port', 'database', 'user', 'useOsAuth', 'useSysdba', 'useSshTunnel', 'sshHost', 'sshPort', 'sshUser']
    .map(field => [field, config?.[field] ?? null]);
  return { connection: createHash('sha256').update(JSON.stringify(connection)).digest('hex'),
    schema: target.schema, objectName: target.objectName, objectType: target.objectType,
    signature: target.signature ?? null, ...(target.tableName !== undefined ? { tableName: target.tableName } : {}) };
}

function resolveTraceFile(directory, database, identity) {
  if (!['oracle', 'postgres'].includes(database)) throw new Error('Invalid trace database.');
  // String identities remain available for isolated adapters/tests, never as raw paths.
  const canonical = typeof identity === 'string' ? { objectName: identity } : identity;
  if (!canonical || typeof canonical.objectName !== 'string' || !canonical.objectName) throw new Error('Invalid trace identity.');
  const digest = createHash('sha256').update(JSON.stringify({
    connection: canonical.connection ?? null, schema: canonical.schema ?? null,
    objectName: canonical.objectName, objectType: canonical.objectType ?? null, signature: canonical.signature ?? null, ...(canonical.tableName !== undefined ? { tableName: canonical.tableName } : {})
  })).digest('hex');
  return workspacePath(directory, database, `trace_${digest}.json`);
}

module.exports = { createTraceIdentity, resolveTraceFile };
