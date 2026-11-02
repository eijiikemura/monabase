// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readInternalText, parsePrivateJson, assertDataSize } = require('../services/dataSafety');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const categories = ['TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY'];
const categoryNames = ['trigger', 'procedure', 'function', 'package-header', 'package-body'];
const objectCategories = ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'MATERIALIZED VIEW LOG',
  'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'TRIGGER', 'DATABASE LINK', 'SYNONYM', 'INDEX', 'TYPE'];
let queue = Promise.resolve();

// Only non-secret destination fields participate; labels and credentials never do.
function createAiHistoryScope(config) {
  const dbType = config.dbType === 'postgres' ? 'postgresql' : config.dbType;
  if (!['oracle', 'postgresql'].includes(dbType)) throw new Error('Invalid AI history database.');
  const tunnel = Boolean(config.useSshTunnel);
  const destination = {
    dbType, host: config.host || '127.0.0.1', port: String(config.port || (dbType === 'oracle' ? 1521 : 5432)),
    database: config.database || '', user: config.user || '',
    useOsAuth: Boolean(config.useOsAuth), useSysdba: Boolean(config.useSysdba),
    ssh: tunnel ? { host: config.sshHost || '127.0.0.1', port: String(config.sshPort || 22), user: config.sshUser || '' } : null
  };
  return createHash('sha256').update(JSON.stringify(destination)).digest('hex');
}

function validateIdentity(value) {
  if (!value || !/^[a-f0-9]{64}$/.test(value.connectionScope) || !['oracle', 'postgresql'].includes(value.dbType) ||
      !categories.includes(value.category) ||
      typeof value.schema !== 'string' || !value.schema.trim() ||
      typeof value.objectName !== 'string' || !value.objectName.trim()) {
    throw new Error('AI会話の保存対象が不正です。');
  }
  if (value.signature !== undefined && typeof value.signature !== 'string') throw new Error('Invalid routine signature.');
  if (value.tableName !== undefined && (value.dbType !== 'postgresql' || value.category !== 'TRIGGER' || typeof value.tableName !== 'string' || !value.tableName || value.tableName.includes('\0'))) throw new Error('Invalid trigger table identity.');
  return { connectionScope: value.connectionScope, dbType: value.dbType, category: value.category, schema: value.schema, objectName: value.objectName,
    ...(value.signature !== undefined ? { signature: value.signature } : {}),
    ...(value.tableName !== undefined ? { tableName: value.tableName } : {}) };
}

function getSourceHistoryFile(directory, value) {
  const identity = validateIdentity(value);
  // Append a hash to avoid collisions from Windows restrictions, case folding, or long names.
  // eslint-disable-next-line no-control-regex -- Control characters are invalid in Windows filenames.
  const label = `${identity.schema}.${identity.objectName}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  const readable = Array.from(label).slice(0, 32).join('');
  const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return path.join(directory, `${identity.dbType}_${categoryNames[categories.indexOf(identity.category)]}_${readable}_${hash}.json`);
}

function validateConversation(value, identity) {
  if (!value || !Array.isArray(value.messages) || !Array.isArray(value.selectedObjects)) {
    throw new Error('保存されたAI会話の形式が不正です。');
  }
  const messages = value.messages.map(message => {
    if (!message || !['user', 'ai', 'system', 'debug'].includes(message.sender) ||
        typeof message.id !== 'string' || typeof message.text !== 'string' ||
        typeof message.timestamp !== 'string') throw new Error('AI会話のメッセージ形式が不正です。');
    const result = { id: message.id, sender: message.sender, text: message.text, timestamp: message.timestamp };
    for (const flag of ['cancelled', 'failed']) {
      if (typeof message[flag] === 'boolean') result[flag] = message[flag];
    }
    if (typeof message.aiContent === 'string') result.aiContent = message.aiContent;
    if (message.adoption !== undefined) {
      const adoption = message.adoption;
      if (message.sender !== 'ai' || !adoption || typeof adoption.summary !== 'string' ||
          !adoption.summary.trim() || adoption.summary.length > 500 || typeof adoption.source !== 'string' ||
          typeof adoption.appliedAt !== 'string' || !Number.isFinite(Date.parse(adoption.appliedAt))) {
        throw new Error('Invalid adopted AI change.');
      }
      result.adoption = { summary: adoption.summary.trim(), source: adoption.source, appliedAt: adoption.appliedAt };
    }

    if (message.usage && ['promptTokens', 'completionTokens'].every(key =>
      Number.isFinite(message.usage[key]) && message.usage[key] >= 0)) {
      result.usage = { promptTokens: message.usage.promptTokens, completionTokens: message.usage.completionTokens };
    }
    return result;
  });
  const selectedObjects = value.selectedObjects.map(object => {
    if (!object || object.dbType !== identity.dbType || !objectCategories.includes(object.category) ||
        !['schema', 'name', 'displayName'].every(key => typeof object[key] === 'string' && object[key])) {
      throw new Error('AI会話の対象オブジェクト形式が不正です。');
    }
    const result = { dbType: object.dbType, category: object.category,
      schema: object.schema, name: object.name, displayName: object.displayName,
      key: JSON.stringify([object.dbType, object.schema, object.category, object.id || object.name]) };
    for (const key of ['id', 'parentName']) if (typeof object[key] === 'string') result[key] = object[key];
    return result;
  });
  return { version: 1, identity, messages, selectedObjects };
}

async function secureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const status = await fs.lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('Invalid AI history directory.');
  if (process.platform !== 'win32') await fs.chmod(directory, 0o700);
}

function saveSourceHistory(directory, value, conversation) {
  const identity = validateIdentity(value);
  const data = validateConversation(conversation, identity);
  const file = getSourceHistoryFile(directory, identity);
  const serialized = JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2);
  assertDataSize(Buffer.byteLength(serialized));
  const task = queue.then(async () => {
    await secureDirectory(directory);
    const temporary = `${file}.${randomUUID()}.tmp`;
    let created = false;
    try {
      const handle = await fs.open(temporary, 'wx', 0o600);
      created = true;
      try { await handle.writeFile(serialized, 'utf8'); }
      finally { await handle.close(); }
      await fs.rename(temporary, file);
    } finally {
      if (created) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  });
  queue = task.catch(() => {});
  return task;
}

async function loadSourceHistory(directory, value) {
  const identity = validateIdentity(value);
  const file = getSourceHistoryFile(directory, identity);
  // Wait for the previous window's save to finish before loading.
  await queue;
  let contents;
  try {
    await secureDirectory(directory);
    contents = await readInternalText(file, { privateFile: true });
  }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const data = parsePrivateJson(contents);
  if (data.version !== 1 || JSON.stringify(validateIdentity(data.identity)) !== JSON.stringify(identity)) {
    throw new Error('保存されたAI会話の対象が一致しません。');
  }
  return validateConversation(data, identity);
}

function deleteSourceHistories(directories, value) {
  const identity = validateIdentity(value);
  const identities = identity.dbType === 'oracle' && identity.category === 'PACKAGE'
    ? [identity, { ...identity, category: 'PACKAGE BODY' }] : [identity];
  const files = directories.flatMap(directory => identities.map(item => getSourceHistoryFile(directory, item)));
  // Wait for pending autosaves before deleting to prevent stale writes.
  const task = queue.then(async () => {
    for (const file of files) {
      try { await fs.unlink(file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  });
  queue = task.catch(() => {});
  return task;
}

module.exports = { createAiHistoryScope, getSourceHistoryFile, saveSourceHistory, loadSourceHistory, deleteSourceHistories };
