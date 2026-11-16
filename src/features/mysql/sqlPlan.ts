// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { ExplainNode } from '@/features/sql/explainTypes';
import type { ExplainSnapshot } from '@/shared/types/sqlTypes';
import { tokenizeSql } from '@/features/sql/sqlScript';
import { backgroundRows } from '@/features/mysql/table/tableRepository';
import { mysqlTableName } from '@/features/mysql/table/tableModel';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function readMysqlPlan(rows: DatabaseRow[]): JsonObject {
  const raw = rows[0]?.PLAN_TABLE_OUTPUT;
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!object(parsed) || !object(parsed.query_block)) throw new Error('Unsupported MySQL JSON execution plan.');
  return parsed;
}
export function parseMysqlPlan(rows: DatabaseRow[]) {
  let count = 0;
  const tree: ExplainNode[] = [], predicates: string[] = [];
  const walk = (value: unknown, parent: ExplainNode[], label: string, depth: number) => {
    if (depth > 64 || ++count > 4000) throw new Error('MySQL execution plan is too complex.');
    if (Array.isArray(value)) { value.forEach(item => walk(item, parent, label, depth + 1)); return; }
    if (!object(value)) return;
    const cost = object(value.cost_info) ? value.cost_info : {};
    const node: ExplainNode = { id: String(count), hasAsterisk: Boolean(value.attached_condition || value.index_condition),
      operation: label === 'table' ? String(value.access_type || 'TABLE') : label.replaceAll('_', ' ').toUpperCase(),
      name: String(value.table_name || value.key || ''), rowsVal: String(value.rows_produced_per_join ?? value.rows_examined_per_scan ?? ''),
      bytes: String(cost.data_read_per_join ?? ''), cost: String(cost.query_cost ?? cost.prefix_cost ?? cost.read_cost ?? ''), time: '-', children: [] };
    // table_name can be an alias or a materialized CTE. Never turn it into a guessed object identity.
    parent.push(node);
    for (const field of ['attached_condition', 'index_condition', 'message']) if (typeof value[field] === 'string') predicates.push(`${node.id} - ${value[field]}`);
    for (const [key, child] of Object.entries(value)) if (!['cost_info', 'used_columns', 'possible_keys', 'used_key_parts', 'ref'].includes(key) && (object(child) || Array.isArray(child))) walk(child, node.children, key, depth + 1);
  };
  walk(readMysqlPlan(rows).query_block, tree, 'query_block', 0);
  return { tree, predicates, headerText: ['MySQL execution plan (EXPLAIN FORMAT=JSON, estimated)'] };
}

// Candidates come from SQL identifiers, never from the plan's table aliases.
export function mysqlPlanTableCandidates(sql: string, defaultSchema: string) {
  const tokens = tokenizeSql(sql, 'mysql'), candidates = new Map<string, { schema: string; table: string }>();
  const identifier = (index: number) => tokens[index]?.kind === 'word' ? tokens[index].text : tokens[index]?.text.startsWith('`') ? tokens[index].text.slice(1, -1).replaceAll('``', '`') : null;
  const ctes = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    const name = identifier(index);
    if (!name) continue;
    let next = index + 1;
    if (tokens[next]?.text === '(') {
      let nesting = 1; next++;
      while (next < tokens.length && nesting) { if (tokens[next].text === '(') nesting++; if (tokens[next].text === ')') nesting--; next++; }
    }
    if (tokens[next]?.text.toUpperCase() === 'AS' && tokens[next + 1]?.text === '(') ctes.add(name);
  }
  const contexts: boolean[] = [false];
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], word = token.kind === 'word' ? token.text.toUpperCase() : '';
    if (token.text === '(') { contexts[++depth] = false; continue; }
    if (token.text === ')') { depth = Math.max(0, depth - 1); continue; }
    if (['WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'UNION', 'ON', 'USING'].includes(word)) contexts[depth] = false;
    if (['FROM', 'JOIN'].includes(word)) contexts[depth] = true;
    else if (token.text !== ',' || !contexts[depth]) continue;
    const first = identifier(index + 1);
    if (!first || tokens[index + 2]?.text === '(') continue;
    const qualified = tokens[index + 2]?.text === '.';
    const second = qualified ? identifier(index + 3) : null;
    if (qualified && !second || !qualified && ctes.has(first)) continue;
    const identity = { schema: qualified ? first : defaultSchema, table: qualified ? second! : first };
    candidates.set(JSON.stringify(identity), identity);
    if (candidates.size > 30) throw new Error('MySQL tuning context is limited to 30 table references.');
  }
  return [...candidates.values()];
}
export async function buildMysqlTuningPrompt(snapshot: ExplainSnapshot, dbInfo: string | undefined, includeBindValues: boolean, language: string) {
  const plan = readMysqlPlan(snapshot.rows);
  const masked = !includeBindValues && Boolean(snapshot.binds?.length);
  // Predicates and arbitrary plan text may contain escaped/coerced bind values.
  // Keep structural identifiers and numeric estimates, not expression strings.
  const identifiers = new Set(['table_name', 'access_type', 'key', 'possible_keys', 'used_key_parts', 'used_columns']);
  const estimates = new Set(['query_cost', 'prefix_cost', 'read_cost', 'eval_cost', 'sort_cost', 'filtered', 'data_read_per_join']);
  const redact = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map(item => redact(item, key));
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([field, item]) => [field, redact(item, field)]));
    if (typeof value === 'string' && !identifiers.has(key) && !(estimates.has(key) && /^\d+(?:\.\d+)?[KMGT]?$/i.test(value))) return '[not shared]';
    return value;
  };
  const planText = JSON.stringify(masked ? redact(plan) : plan, null, 2);
  let output = `[AI SQL Tuning Request]\nDatabase: MySQL 8.4\nEnvironment: ${dbInfo || 'MySQL 8.4'}\nExecution database: ${snapshot.schema || '(unknown)'}\nRespond in ${language === 'ja' ? 'Japanese' : 'English'}.\nAnalyze bottlenecks and propose SQL rewrites and indexes only when justified. Preserve query results, NULL handling, ordering and transaction semantics. Distinguish evidence from assumptions. Never claim a proposed improvement was measured.\n\n[Target SQL]\n${snapshot.sql}\n\n[Estimated execution plan]\n${planText}\n\n[Execution evidence]\n${JSON.stringify({ planKind: 'estimated', planningDurationMs: snapshot.planningDurationMs, observedExecution: snapshot.observedExecution || null, binds: snapshot.binds?.map(bind => ({ ...bind, value: includeBindValues ? bind.value : '[not shared]' })) || [], bindValuesShared: includeBindValues })}\nPlanning duration is not SQL execution duration. This is EXPLAIN FORMAT=JSON, not EXPLAIN ANALYZE. An earlier observed execution, if supplied, is only for identical SQL, binds and database. No additional target execution is performed for this request. Optimizer row counts, costs and catalog statistics are estimates. No application row values are included. Plan predicates and arbitrary expression strings are hidden unless bind sharing is enabled; structural identifiers and numeric estimates remain available.\n\n[Related table metadata]\n`;
  const candidates = mysqlPlanTableCandidates(snapshot.sql, snapshot.schema || '');
  for (const { schema, table } of candidates) {
    if (!schema) { output += '\nUnresolved database for a table reference; metadata not guessed.\n'; continue; }
    const binds = { schema, table };
    const found = await backgroundRows(`SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_ROWS,DATA_LENGTH,INDEX_LENGTH,TABLE_COLLATION,UPDATE_TIME FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:table AS BINARY)`, binds);
    if (!found.length) { output += `\nUnresolved reference ${JSON.stringify({ schema, table })}: possibly a CTE/derived table or an inaccessible object. Metadata omitted.\n`; continue; }
    const ddlRows = await backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(schema, table)}`, {});
    const ddl = ddlRows[0]?.['Create Table'] ?? ddlRows[0]?.['Create View'];
    if (typeof ddl !== 'string') throw new Error('MySQL tuning DDL is unavailable.');
    const indexes = await backgroundRows(`SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,EXPRESSION,CARDINALITY,INDEX_TYPE,IS_VISIBLE FROM information_schema.STATISTICS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:table AS BINARY) ORDER BY INDEX_NAME,SEQ_IN_INDEX`, binds);
    output += `\n--- ${JSON.stringify({ schema, table })} ---\n[DDL]\n${ddl}\n[Estimated statistics]\n${JSON.stringify(found)}\n[Indexes]\n${JSON.stringify(indexes)}\n`;
  }
  if (!candidates.length) output += 'No table reference could be resolved from the statement; no metadata was guessed.\n';
  return output + '\nMetadata may have changed since the plan was obtained. Review all generated SQL before executing it.\n';
}
