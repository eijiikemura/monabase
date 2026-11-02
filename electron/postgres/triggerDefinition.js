// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { t } = require('../i18n');
const { randomUUID } = require('node:crypto');
const { scanSql } = require('../services/sqlTokens');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const target = (schema, name) => `${quote(schema)}.${quote(name)}`;

const metadataSql = `SELECT t.oid::text AS trigger_oid, t.tgname AS trigger_name, t.tgtype,
  ARRAY(SELECT a.attname FROM unnest(t.tgattr::smallint[]) WITH ORDINALITY cols(attnum, position)
    JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = cols.attnum ORDER BY cols.position) AS update_columns,
  t.tgenabled AS enabled, c.relkind, c.relname AS table_name, n.nspname AS schema_name,
  p.proname AS function_name, fn.nspname AS function_schema, p.prosrc AS function_body,
  l.lanname AS language, pg_get_triggerdef(t.oid) AS trigger_ddl, pg_get_functiondef(p.oid) AS function_ddl,
  (SELECT count(*) FROM pg_trigger other WHERE other.tgfoid = p.oid) AS function_users,
  (t.tgconstraint <> 0 OR t.tgqual IS NOT NULL OR t.tgattr::text <> '' OR t.tgnargs <> 0
    OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL OR t.tgisinternal) AS complex
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace fn ON fn.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = $1 AND t.tgname = $2 AND ($3::text IS NULL OR c.relname = $3)`;
const args = request => [request.schema, request.triggerName, request.tableName || null];
function validateIdentity(request) {
  if (!request || !['schema', 'triggerName'].every(key => typeof request[key] === 'string' && request[key] && !request[key].includes('\0')) ||
      (request.tableName !== undefined && (typeof request.tableName !== 'string' || !request.tableName || request.tableName.includes('\0')))) throw new Error('Invalid trigger identity.');
}
function triggerWhen(source) {
  const tokens = scanSql(source);
  const at = tokens.findIndex(token => token.kind === 'word' && token.text.toUpperCase() === 'WHEN');
  if (at < 0 || tokens[at + 1]?.text !== '(') return null;
  let depth = 0;
  for (let index = at + 1; index < tokens.length; index++) {
    if (tokens[index].kind !== 'symbol') continue;
    if (tokens[index].text === '(') depth++;
    if (tokens[index].text === ')' && --depth === 0) return source.slice(tokens[at + 1].end, tokens[index].start);
  }
  throw new Error('Invalid trigger WHEN clause.');
}
function settings(row) {
  const type = Number(row.tgtype);
  return { timing: type & 64 ? 'INSTEAD OF' : type & 2 ? 'BEFORE' : 'AFTER',
    forEachRow: Boolean(type & 1), events: [[4, 'INSERT'], [16, 'UPDATE'], [8, 'DELETE'], [32, 'TRUNCATE']].filter(([bit]) => type & bit).map(([, name]) => name) };
}
function dollarBody(body) {
  let tag = '$monabase$';
  while (body.includes(tag)) tag = tag.slice(0, -1) + '_$';
  return `${tag}${body}${tag}`;
}
function replaceFunctionBody(source, body) {
  const tokens = scanSql(source);
  const index = tokens.findIndex((token, i) => token.kind === 'word' && token.text.toUpperCase() === 'AS' && tokens[i + 1]?.kind === 'quoted');
  if (index < 0 || !source.startsWith('CREATE OR REPLACE FUNCTION')) throw new Error('Unsupported function definition.');
  const literal = tokens[index + 1];
  return source.slice(0, literal.start) + dollarBody(body) + source.slice(literal.end);
}
function createTriggerSql(request, functionSchema, functionName) {
  return `CREATE TRIGGER ${quote(request.triggerName)} ${request.timing} ${request.events.join(' OR ')} ON ${target(request.schema, request.tableName)} FOR EACH ${request.forEachRow ? 'ROW' : 'STATEMENT'} EXECUTE FUNCTION ${target(functionSchema, functionName)}()`;
}

// Called only inside the client's reserved main-connection DDL transaction.
async function saveTrigger(connection, request) {
  validateIdentity(request);
  if (typeof request.isNew !== 'boolean' || typeof request.body !== 'string' || typeof request.tableName !== 'string' ||
      !['BEFORE', 'AFTER', 'INSTEAD OF'].includes(request.timing) || typeof request.forEachRow !== 'boolean' ||
      !Array.isArray(request.events) || !request.events.length || new Set(request.events).size !== request.events.length ||
      !request.events.every(event => ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'].includes(event))) throw new Error('Invalid trigger settings.');
  const query = text => connection.query({ text, queryMode: 'extended' });
  if (request.isNew) {
    // CREATE, rather than CREATE OR REPLACE, cannot overwrite another trigger's function.
    const functionName = `mb_trg_${randomUUID().replaceAll('-', '')}`;
    await query(`CREATE FUNCTION ${target(request.schema, functionName)}() RETURNS trigger LANGUAGE plpgsql AS ${dollarBody(request.body)}`);
    await query(createTriggerSql(request, request.schema, functionName));
    return;
  }
  const result = await connection.query(metadataSql, args(request));
  if (result.rows.length !== 1) throw new Error('Trigger could not be uniquely resolved.');
  const row = result.rows[0], expected = request.expected;
  if (!expected || expected.triggerOid !== row.trigger_oid || expected.triggerDefinition !== row.trigger_ddl ||
      expected.functionDefinition !== row.function_ddl || expected.enabled !== row.enabled) throw new Error(t('trigger_definition_changed_reload'));
  if (row.language !== 'plpgsql') throw new Error(t('trigger_plpgsql_only'));
  const current = settings(row);
  const changed = current.timing !== request.timing || current.forEachRow !== request.forEachRow ||
    current.events.length !== request.events.length || current.events.some(event => !request.events.includes(event));
  if (changed && row.complex) throw new Error(t('trigger_complex_settings_edit_blocked'));
  const bodyChanged = row.function_body !== request.body;
  if (bodyChanged && Number(row.function_users) !== 1) throw new Error(t('trigger_shared_function_edit_blocked'));
  if (bodyChanged) await query(replaceFunctionBody(row.function_ddl, request.body));
  if (changed) {
    await query(`DROP TRIGGER ${quote(row.trigger_name)} ON ${target(row.schema_name, row.table_name)}`);
    await query(createTriggerSql(request, row.function_schema, row.function_name));
    const modes = { O: 'ENABLE', D: 'DISABLE', R: 'ENABLE REPLICA', A: 'ENABLE ALWAYS' };
    if (!Object.hasOwn(modes, row.enabled)) throw new Error('Unknown trigger enable mode.');
    await query(`ALTER TABLE ${target(row.schema_name, row.table_name)} ${modes[row.enabled]} TRIGGER ${quote(row.trigger_name)}`);
  }
}
module.exports = { triggerWhen, metadataSql, args, validateIdentity, settings, replaceFunctionBody, saveTrigger };
