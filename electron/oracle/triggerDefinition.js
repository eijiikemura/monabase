// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { scanSql } = require('../services/sqlTokens');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const identity = request => {
  if (!request || !['schema', 'triggerName'].every(key => typeof request[key] === 'string' && request[key].length && !request[key].includes('\0'))) throw new Error('Invalid trigger identity.');
  return { owner: request.schema, name: request.triggerName };
};

// ALL_SOURCE contains the stored definition without DBMS_METADATA's trailing ALTER statement.
async function getTrigger(query, request) {
  const binds = identity(request);
  const result = await query(`SELECT TRIGGER_TYPE, TRIGGERING_EVENT, TABLE_OWNER, TABLE_NAME,
    BASE_OBJECT_TYPE, REFERENCING_NAMES, WHEN_CLAUSE, STATUS, ACTION_TYPE, CROSSEDITION
    FROM ALL_TRIGGERS WHERE OWNER = :owner AND TRIGGER_NAME = :name`, binds);
  if (result.rows.length !== 1) throw new Error('Trigger could not be uniquely resolved.');
  const row = { ...result.rows[0] };
  for (const key of ['TRIGGER_TYPE', 'TRIGGERING_EVENT', 'BASE_OBJECT_TYPE', 'STATUS', 'ACTION_TYPE', 'CROSSEDITION']) {
    if (typeof row[key] === 'string') row[key] = row[key].trimEnd();
  }
  const sourceResult = await query(`SELECT TEXT FROM ALL_SOURCE WHERE OWNER = :owner AND NAME = :name AND TYPE = 'TRIGGER' ORDER BY LINE`, binds);
  const source = sourceResult.rows.map(line => line.TEXT).join('');
  if (!source.trim()) throw new Error('Trigger source is unavailable.');
  const tokens = scanSql(source, 'oracle');
  const words = tokens.filter(token => token.kind === 'word').map(token => token.text.toUpperCase());
  const bodyToken = tokens.find(token => token.kind === 'word' && ['BEGIN', 'DECLARE'].includes(token.text.toUpperCase()));
  const editable = Boolean(bodyToken) && ['TABLE', 'VIEW'].includes(row.BASE_OBJECT_TYPE) &&
    row.TABLE_OWNER === request.schema && row.ACTION_TYPE === 'PL/SQL' &&
    row.CROSSEDITION === 'NO' && !words.includes('COMPOUND');
  const columns = await query(`SELECT COLUMN_NAME FROM ALL_TRIGGER_COLS WHERE TRIGGER_OWNER = :owner AND TRIGGER_NAME = :name AND COLUMN_LIST = 'YES' ORDER BY COLUMN_NAME`, binds);
  const errors = await query(`SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = 'TRIGGER' ORDER BY SEQUENCE`, binds);
  const bodyOffset = bodyToken?.start ?? source.length;
  return { ...row, source, body: editable ? source.slice(bodyOffset) : source,
    header: source.slice(0, bodyOffset), headerLines: source.slice(0, bodyOffset).split('\n').length - 1,
    editable, updateColumns: columns.rows.map(col => col.COLUMN_NAME), errors: errors.rows };
}

function alias(value, defaultName) {
  if (!value?.trim() || value.trim().toUpperCase() === defaultName) return '';
  const trimmed = value.trim();
  if (/^"(?:[^"]|"")+"$/.test(trimmed)) return trimmed;
  if (!/^[\p{L}][\p{L}\p{N}_$#]*$/u.test(trimmed)) throw new Error('Invalid trigger alias.');
  return quote(trimmed.toUpperCase());
}
function createSql(request) {
  identity(request);
  if (typeof request.body !== 'string' || !request.body.trim() || typeof request.tableName !== 'string' || !request.tableName || request.tableName.includes('\0') ||
      !['BEFORE', 'AFTER', 'INSTEAD OF'].includes(request.timing) || typeof request.forEachRow !== 'boolean' ||
      !Array.isArray(request.events) || !request.events.length || new Set(request.events).size !== request.events.length ||
      !request.events.every(event => ['INSERT', 'UPDATE', 'DELETE'].includes(event)) ||
      !Array.isArray(request.updateColumns) || !request.updateColumns.every(col => typeof col === 'string' && col && !col.includes('\0'))) throw new Error('Invalid trigger settings.');
  const events = request.events.map(event => event === 'UPDATE' && request.updateColumns.length ? `UPDATE OF ${request.updateColumns.map(quote).join(', ')}` : event);
  const aliases = [['NEW', request.aliasNew], ['OLD', request.aliasOld]].map(([name, value]) => {
    const identifier = alias(value, name); return identifier ? `${name} AS ${identifier}` : '';
  }).filter(Boolean);
  return `CREATE TRIGGER ${quote(request.schema)}.${quote(request.triggerName)}\n${request.timing} ${events.join(' OR ')}\nON ${quote(request.schema)}.${quote(request.tableName)}\n` +
    (aliases.length ? `REFERENCING ${aliases.join(' ')}\n` : '') +
    (request.forEachRow && request.timing !== 'INSTEAD OF' ? 'FOR EACH ROW\n' : '') + request.body;
}
function replaceBody(current, body) {
  if (!current.editable || typeof body !== 'string' || !body.trim()) throw new Error('This trigger is read-only in the trigger editor.');
  // Set the saved state in CREATE itself: a disabled trigger must never be temporarily enabled.
  const tokens = scanSql(current.header, 'oracle');
  const when = tokens.find(token => token.kind === 'word' && token.text.toUpperCase() === 'WHEN');
  let header = current.header;
  const beforeWhen = when?.start ?? header.length;
  const mode = tokens.filter(token => token.start < beforeWhen && token.kind === 'word' && ['ENABLE', 'DISABLE'].includes(token.text.toUpperCase()));
  for (const token of mode.reverse()) header = header.slice(0, token.start) + header.slice(token.end);
  const remainingWhen = scanSql(header, 'oracle').find(token => token.kind === 'word' && token.text.toUpperCase() === 'WHEN');
  const at = remainingWhen?.start ?? header.length;
  const status = current.STATUS === 'DISABLED' ? 'DISABLE' : current.STATUS === 'ENABLED' ? 'ENABLE' : null;
  if (!status) throw new Error('Unknown trigger status.');
  header = header.slice(0, at) + `\n${status}\n` + header.slice(at);
  return `CREATE OR REPLACE ${header}${body}`;
}
async function saveTrigger(query, request) {
  identity(request);
  if (typeof request.isNew !== 'boolean') throw new Error('Invalid trigger settings.');
  let statement;
  if (request.isNew) statement = createSql(request);
  else {
    const current = await getTrigger(query, request);
    if (!request.expected || request.expected.source !== current.source || request.expected.status !== current.STATUS) throw new Error('Trigger definition changed. Reload before saving.');
    statement = replaceBody(current, request.body);
  }
  try { await query(statement, {}); }
  catch (error) { if (error.errorNum !== 24344) throw error; }
  return getTrigger(query, request);
}
module.exports = { identity, getTrigger, createSql, replaceBody, saveTrigger };
