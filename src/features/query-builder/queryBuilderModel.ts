// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { parseObjectIdentity, qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';

export interface QueryTable { id: string; name: string; columns: string[]; x: number; y: number }
export interface QueryField { id: string; tableId: string; tableName: string; columnName: string; sort: string; criteria: string; orCriteria: string; show: boolean; groupBy: string }
export interface QueryJoin { id: string; fromTableId: string; fromCol: string; toTableId: string; toCol: string; joinType: string }
export interface QuerySettings { queryTables: QueryTable[]; queryFields: QueryField[]; queryJoins: QueryJoin[] }
export interface QueryDocument extends QuerySettings { version: 1; dbType: 'oracle' | 'postgresql'; selectedSchema: string }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
function fail(code: string): never { throw new Error(code); }
const aggregate = (field: QueryField) => !!field.groupBy && field.groupBy !== 'GROUP BY';

function validCondition(value: string) {
  // Ignore quoted content while rejecting statement separators, comments and subqueries.
  let expression = '';
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "'" || value[i] === '"') {
      const quote = value[i]; let closed = false;
      for (i++; i < value.length; i++) {
        if (value[i] === quote) {
          if (value[i + 1] === quote) i++;
          else { closed = true; break; }
        }
      }
      if (!closed) fail('qb_invalid_condition');
      expression += ' literal ';
    } else expression += value[i];
  }
  if (/[;]|--|\/\*|\b(SELECT|FROM|JOIN|UNION|WITH|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|COMMIT|ROLLBACK)\b/i.test(expression)) fail('qb_invalid_condition');
}

export function validateQuerySettings(value: unknown): QuerySettings {
  if (!record(value) || !Array.isArray(value.queryTables) || !Array.isArray(value.queryFields) || !Array.isArray(value.queryJoins)) fail('qb_invalid_file');
  const tables: QueryTable[] = [], fields: QueryField[] = [], joins: QueryJoin[] = [];
  const ids = new Set<string>(), names = new Set<string>();
  for (const item of value.queryTables) {
    if (!record(item) || !text(item.id) || !text(item.name) || !Array.isArray(item.columns) || !item.columns.length ||
        !item.columns.every(text) || new Set(item.columns).size !== item.columns.length ||
        typeof item.x !== 'number' || !Number.isFinite(item.x) || typeof item.y !== 'number' || !Number.isFinite(item.y) || ids.has(item.id)) fail('qb_invalid_table');
    const parsed = parseObjectIdentity(item.name);
    if (!parsed.schema || !parsed.objectName) fail('qb_invalid_table');
    const canonical = qualifiedObjectName(parsed);
    if (names.has(canonical)) fail('qb_invalid_table');
    ids.add(item.id); names.add(canonical);
    tables.push({ id: item.id, name: canonical, columns: [...item.columns], x: item.x, y: item.y });
  }
  const byId = new Map(tables.map(table => [table.id, table]));
  ids.clear();
  for (const item of value.queryFields) {
    if (!record(item) || !text(item.id) || ids.has(item.id) || typeof item.tableId !== 'string' || typeof item.columnName !== 'string') fail('qb_invalid_field');
    const table = byId.get(item.tableId);
    if (!table || typeof item.tableName !== 'string' || qualifiedObjectName(parseObjectIdentity(item.tableName)) !== table.name || !table.columns.includes(item.columnName) ||
        typeof item.criteria !== 'string' || typeof item.orCriteria !== 'string' || typeof item.show !== 'boolean' ||
        typeof item.sort !== 'string' || !['', 'ASC', 'DESC'].includes(item.sort) ||
        typeof item.groupBy !== 'string' || !['', 'GROUP BY', 'SUM', 'COUNT', 'MIN', 'MAX', 'AVG'].includes(item.groupBy)) fail('qb_invalid_field');
    validCondition(item.criteria); validCondition(item.orCriteria); ids.add(item.id);
    fields.push({ id: item.id, tableId: item.tableId, tableName: table.name, columnName: item.columnName, sort: item.sort,
      criteria: item.criteria, orCriteria: item.orCriteria, show: item.show, groupBy: item.groupBy });
  }
  ids.clear();
  for (const item of value.queryJoins) {
    if (!record(item) || !text(item.id) || ids.has(item.id) || typeof item.fromTableId !== 'string' || typeof item.toTableId !== 'string' ||
        typeof item.fromCol !== 'string' || typeof item.toCol !== 'string' || typeof item.joinType !== 'string' ||
        !['INNER', 'LEFT', 'RIGHT'].includes(item.joinType) || item.fromTableId === item.toTableId ||
        !byId.get(item.fromTableId)?.columns.includes(item.fromCol) || !byId.get(item.toTableId)?.columns.includes(item.toCol)) fail('qb_invalid_join');
    ids.add(item.id);
    joins.push({ id: item.id, fromTableId: item.fromTableId, fromCol: item.fromCol, toTableId: item.toTableId, toCol: item.toCol, joinType: item.joinType });
  }
  return { queryTables: tables, queryFields: fields, queryJoins: joins };
}

export function parseQueryDocument(source: string, dbType: QueryDocument['dbType']): QueryDocument {
  const parsed: unknown = JSON.parse(source);
  if (!record(parsed) || parsed.version !== 1 || parsed.dbType !== dbType || typeof parsed.selectedSchema !== 'string') fail('qb_invalid_file');
  const settings = validateQuerySettings(parsed);
  generateQuerySql(settings);
  return { version: 1, dbType, selectedSchema: parsed.selectedSchema, ...settings };
}

export function generateQuerySql(input: QuerySettings): string {
  const { queryTables: tables, queryFields: fields, queryJoins: joins } = validateQuerySettings(input);
  if (!tables.length) return '';
  if (fields.length && !fields.some(field => field.show)) fail('qb_no_fields');
  const aliases = new Map(tables.map((table, index) => [table.id, `t${index + 1}`]));
  const column = (tableId: string, name: string) => `${aliases.get(tableId)}.${quoteIdentifier(name)}`;
  const source = (id: string) => `${tables.find(table => table.id === id)!.name} ${aliases.get(id)}`;
  const invert = (type: string) => type === 'LEFT' ? 'RIGHT' : type === 'RIGHT' ? 'LEFT' : 'INNER';
  const groups = new Map<string, { from: string; to: string; type: string; conditions: string[] }>();
  for (const join of joins) {
    const key = JSON.stringify([join.fromTableId, join.toTableId].sort());
    let group = groups.get(key);
    if (!group) { group = { from: join.fromTableId, to: join.toTableId, type: join.joinType, conditions: [] }; groups.set(key, group); }
    const type = group.from === join.fromTableId ? join.joinType : invert(join.joinType);
    if (group.type !== type) fail('qb_invalid_join');
    const condition = `${column(join.fromTableId, join.fromCol)} = ${column(join.toTableId, join.toCol)}`;
    if (!group.conditions.includes(condition)) group.conditions.push(condition);
  }
  const remaining = [...groups.values()], processed = new Set<string>(), components: string[] = [];
  while (processed.size < tables.length) {
    const root = remaining.find(group => !processed.has(group.from) && !processed.has(group.to))?.from ?? tables.find(table => !processed.has(table.id))!.id;
    const connected = new Set([root]); processed.add(root);
    let component = source(root), progress = true;
    while (progress) {
      progress = false;
      for (let index = 0; index < remaining.length; index++) {
        const group = remaining[index], from = connected.has(group.from), to = connected.has(group.to);
        if (from && to) fail('qb_cyclic_join');
        if (!from && !to) continue;
        const next = from ? group.to : group.from;
        if (processed.has(next)) fail('qb_cyclic_join');
        component += `\n  ${from ? group.type : invert(group.type)} JOIN ${source(next)} ON ${group.conditions.join(' AND ')}`;
        connected.add(next); processed.add(next); remaining.splice(index, 1); progress = true; break;
      }
    }
    components.push(component);
  }
  if (remaining.length) fail('qb_cyclic_join');
  const selected = fields.filter(field => field.show);
  const hasAggregate = fields.some(field => aggregate(field) && (field.show || !!field.sort));
  const expression = (field: QueryField) => aggregate(field) ? `${field.groupBy}(${column(field.tableId, field.columnName)})` : column(field.tableId, field.columnName);
  const groupFields = fields.filter(field => field.groupBy === 'GROUP BY' || (hasAggregate && field.show && !aggregate(field)));
  const groupExpressions = [...new Set(groupFields.map(field => column(field.tableId, field.columnName)))];
  if (hasAggregate && fields.some(field => field.sort && !aggregate(field) && !groupExpressions.includes(column(field.tableId, field.columnName)))) fail('qb_invalid_aggregate');
  const where = fields.flatMap(field => {
    const conditions = [field.criteria, field.orCriteria].filter(Boolean).map(condition => `${column(field.tableId, field.columnName)} ${condition}`);
    return conditions.length ? [conditions.length === 1 ? conditions[0] : `(${conditions.join(' OR ')})`] : [];
  });
  const order = fields.filter(field => field.sort).map(field => `${expression(field)} ${field.sort}`);
  return `SELECT\n  ${selected.length ? selected.map(expression).join(',\n  ') : '*'}\nFROM\n  ${components.map(component => components.length > 1 && component.includes(' JOIN ') ? `(${component})` : component).join('\n  CROSS JOIN ')}` +
    (where.length ? `\nWHERE\n  ${where.join(' AND\n  ')}` : '') +
    (groupExpressions.length ? `\nGROUP BY\n  ${groupExpressions.join(', ')}` : '') + (order.length ? `\nORDER BY\n  ${order.join(', ')}` : '');
}

export function queryBuilderErrorMessage(code: string, t: (key: string) => string) {
  const messages: Record<string, string> = {
    qb_invalid_file: t('qb_invalid_file'), qb_invalid_table: t('qb_invalid_table'), qb_invalid_field: t('qb_invalid_field'),
    qb_invalid_join: t('qb_invalid_join'), qb_cyclic_join: t('qb_cyclic_join'), qb_no_fields: t('qb_no_fields'),
    qb_invalid_condition: t('qb_invalid_condition'), qb_invalid_aggregate: t('qb_invalid_aggregate')
  };
  return messages[code] || t('qb_invalid_settings');
}
