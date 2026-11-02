// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Persist ciphertext only. Never interpret a failed decryption as an empty secret.
function createCredentialVault(safeStorage) {
  const sessions = new Map();
  const readable = new Map();
  const persistence = new Map();
  const available = () => {
    try {
      return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch { return false; }
  };
  const previousEntry = (record, field, legacy) => {
    if (record.encryptedCredentials?.[field]) return record.encryptedCredentials[field];
    const value = record[field];
    if (legacy[field] && typeof value === 'string' && value &&
        (legacy[field] !== 'hex' || /^(?:[\da-f]{2}){8,}$/i.test(value))) {
      return { data: value, encoding: legacy[field] };
    }
    return undefined;
  };

  function read(record, fields, identity, legacy = {}) {
    const result = { ...record };
    delete result.encryptedCredentials;
    delete result.unavailableCredentials;
    const restored = new Set();
    const unavailableCredentials = [];
    const session = sessions.get(identity) || {};
    for (const field of fields) {
      const entry = previousEntry(record, field, legacy);
      result[field] = '';
      if (entry) {
        try {
          if (!available()) throw new Error('Secure storage unavailable.');
          result[field] = safeStorage.decryptString(Buffer.from(entry.data, entry.encoding));
          restored.add(field);
        } catch {
          if (!session[field]) unavailableCredentials.push(field);
        }
      } else if (typeof record[field] === 'string') {
        result[field] = record[field];
        restored.add(field);
      }
    }
    readable.set(identity, restored);
    if (unavailableCredentials.length) result.unavailableCredentials = unavailableCredentials;
    return { ...result, ...session };
  }

  function prepareWrite(record, fields, identity, previous = {}, legacy = {}, policy = {}) {
    const savedSecrets = fields.some(field => previousEntry(previous, field, legacy));
    const fail = code => { throw Object.assign(new Error(code === 'CREDENTIAL_CONTEXT_CHANGED'
      ? 'Re-enter credentials before changing their destination. Existing settings were preserved.'
      : 'Secure credential storage failed. Existing settings were preserved.'), { code }); };
    const result = { ...record };
    delete result.unavailableCredentials;
    const secrets = {};
    const encryptedCredentials = {};
    const restored = new Set(readable.get(identity));
    let persisted = true;
    for (const field of fields) {
      const value = typeof record[field] === 'string' ? record[field] : '';
      const oldEntry = previousEntry(previous, field, legacy);
      delete result[field];
      if (!value && oldEntry && !restored.has(field)) {
        if (policy.canRetain?.[field] === false) fail('CREDENTIAL_CONTEXT_CHANGED');
        encryptedCredentials[field] = oldEntry;
        continue;
      }
      secrets[field] = value;
      if (!value) {
        restored.add(field);
        continue;
      }
      try {
        if (!available()) throw new Error('Secure storage unavailable.');
        if (value) encryptedCredentials[field] = {
          data: safeStorage.encryptString(value).toString('base64'), encoding: 'base64'
        };
        restored.add(field);
      } catch {
        // Publishing only new metadata would attach an old secret to the new target.
        if (policy.consistentSave && savedSecrets) fail('CREDENTIAL_SAVE_FAILED');
        if (oldEntry) encryptedCredentials[field] = oldEntry;
        if (value) persisted = false;
        restored.delete(field);
      }
    }
    result.encryptedCredentials = encryptedCredentials;
    return { record: result, commit() {
      sessions.set(identity, secrets);
      readable.set(identity, restored);
      persistence.set(identity, persisted);
    } };
  }

  function write(...args) {
    const prepared = prepareWrite(...args);
    prepared.commit();
    return prepared.record;
  }

  function forget(identity) {
    sessions.delete(identity);
    readable.delete(identity);
    persistence.delete(identity);
  }
  function rename(from, to) {
    if (from === to) return;
    for (const map of [sessions, readable, persistence]) {
      if (map.has(from)) map.set(to, map.get(from));
    }
    forget(from);
  }
  return { read, write, prepareWrite, available, forget, rename, isPersisted: identity => persistence.get(identity) !== false };
}

module.exports = { createCredentialVault };
