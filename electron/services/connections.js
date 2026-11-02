// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('./jsonFiles');
const FIELDS = ['password', 'sshPassword'];
const LEGACY = { password: 'hex' };

// Scope each secret to its recipient; labels, ordering and names are presentation only.
function connectionScopes(config = {}) {
  const host = value => String(value || '').trim().toLowerCase();
  const port = (value, fallback) => Number(value) || fallback;
  const dbType = config.dbType === 'postgres' ? 'postgresql' : config.dbType || 'oracle';
  const ssh = [host(config.sshHost), port(config.sshPort, 22), config.sshUser || '',
    config.sshAuthType || 'password', config.sshAuthType === 'key' ? config.sshKeyFile || '' : ''];
  return {
    sshPassword: JSON.stringify(ssh),
    password: JSON.stringify([dbType, host(config.host), port(config.port, dbType === 'oracle' ? 1521 : 5432),
      config.database || '', config.user || '', !!config.useOsAuth, !!config.useSysdba,
      config.useSshTunnel ? ssh : null, config.pgSslMode || 'disable', config.pgSslCaFile || '', config.pgSslServerName || ''])
  };
}

function createConnectionStore(file, vault) {
  const readRecords = () => {
    if (!fs.existsSync(file)) return [];
    const records = readJsonFile(file, value => Array.isArray(value) && value.every(isJsonObject));
    if (!Array.isArray(records)) throw new Error('Invalid connection settings.');
    return records;
  };
  const persist = records => atomicWriteJson(file, records);
  const identity = name => `connection:${name}`;

  function load() {
    const records = readRecords();
    const restored = records.map(record => vault.read(record, FIELDS, identity(record.name), LEGACY));
    // Migrate legacy records without leaving SSH passwords on disk.
    if (records.some(record => FIELDS.some(field => Object.hasOwn(record, field)))) {
      const prepared = restored.map((record, index) => vault.prepareWrite(record, FIELDS, identity(record.name), records[index], LEGACY));
      persist(prepared.map(entry => entry.record));
      prepared.forEach(entry => entry.commit());
    }
    return restored;
  }

  function save(connection, originalName) {
    connection = { ...connection };
    delete connection.aiHistoryScope;
    if (connection.environmentLabel !== undefined && (typeof connection.environmentLabel !== 'string' || connection.environmentLabel.length > 40)) throw Error('Invalid environment label.');
    if (connection.environmentColor !== undefined && !['neutral','blue','green','orange','red','purple'].includes(connection.environmentColor)) throw Error('Invalid environment color.');
    if (connection.pgSslMode !== undefined && !['disable', 'verify-full'].includes(connection.pgSslMode)) throw new Error('Invalid TLS mode.');
    for (const field of ['pgSslCaFile', 'pgSslServerName']) if (connection[field] !== undefined && typeof connection[field] !== 'string') throw new Error('Invalid TLS settings.');
    const records = readRecords();
    const index = originalName ? records.findIndex(record => record.name === originalName) : -1;
    if (records.some((record, position) => position !== index && record.name === connection.name)) {
      throw Object.assign(new Error('A saved connection already uses that name.'), { code: 'CONNECTION_NAME_CONFLICT' });
    }
    const previousIdentity = identity(originalName || connection.name);
    const previousScope = connectionScopes(records[index]);
    const nextScope = connectionScopes(connection);
    const prepared = vault.prepareWrite(connection, FIELDS, previousIdentity, records[index], LEGACY, {
      consistentSave: true,
      canRetain: Object.fromEntries(FIELDS.map(field => [field, previousScope[field] === nextScope[field]]))
    });
    if (index < 0) records.push(prepared.record); else records[index] = prepared.record;
    persist(records);
    prepared.commit();
    vault.rename(previousIdentity, identity(connection.name));
    return { credentialsPersisted: vault.isPersisted(identity(connection.name)) };
  }

  function reorder(connections) {
    const previous = readRecords();
    const byName = new Map(previous.map(record => [record.name, record]));
    const names = connections.map(connection => connection.name);
    if (names.length !== previous.length || new Set(names).size !== names.length || names.some(name => !byName.has(name))) {
      throw new Error('Connection ordering must contain every saved connection exactly once.');
    }
    persist(names.map(name => byName.get(name)));
  }

  function remove(name) {
    persist(readRecords().filter(record => record.name !== name));
    vault.forget(identity(name));
  }

  return { load, save, reorder, remove };
}

module.exports = { createConnectionStore };
