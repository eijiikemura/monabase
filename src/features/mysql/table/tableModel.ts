// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { tokenizeSql } from '@/features/sql/sqlScript';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { Condition } from '@/shared/types/queryConditions';

export interface MysqlColumn {
  COLUMN_NAME: string; DATA_TYPE: string; COLUMN_TYPE: string; IS_NULLABLE: string;
  COLUMN_DEFAULT: unknown; EXTRA: string; COLUMN_COMMENT: string; GENERATION_EXPRESSION: string;
  ORDINAL_POSITION: number | string; PK_POSITION: number | string; CHARACTER_SET_NAME?: string | null;
  COLLATION_NAME?: string | null;
  CHARACTER_MAXIMUM_LENGTH?:string|number|null;NUMERIC_PRECISION?:string|number|null;NUMERIC_SCALE?:string|number|null;DATETIME_PRECISION?:string|number|null;
}
export interface MysqlTable {
  TABLE_NAME: string; TABLE_TYPE: string; ENGINE: string | null; TABLE_COMMENT: string;
  TABLE_ROWS: string | number | null; DATA_LENGTH: string | number | null; INDEX_LENGTH: string | number | null;
  AUTO_INCREMENT: string | number | null; TABLE_COLLATION: string | null; CREATE_TIME: string | null; UPDATE_TIME: string | null;
}
export interface MysqlRelation extends DatabaseRow {
  CONSTRAINT_SCHEMA: string; CONSTRAINT_NAME: string; TABLE_SCHEMA: string; TABLE_NAME: string;
  COLUMN_NAME: string; REFERENCED_TABLE_SCHEMA: string; REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string;
  ORDINAL_POSITION: number | string; UPDATE_RULE: string; DELETE_RULE: string;
}
export interface MysqlTableMetadata {
  table: MysqlTable; columns: MysqlColumn[]; indexes: DatabaseRow[]; checks: DatabaseRow[];
  triggers: DatabaseRow[]; relations: MysqlRelation[];
}
export interface MysqlStatement { sql: string; binds: Record<string, unknown>; }
export interface RecordField { mode: 'default' | 'value' | 'null'; value: string; }

export function quoteMysql(name: string): string {
  if (!name || name.length > 64 || /\u0000/.test(name)) throw new Error('Invalid MySQL identifier.');
  return '`' + name.replaceAll('`', '``') + '`';
}
export const mysqlTableName = (schema: string, name: string) => `${quoteMysql(schema)}.${quoteMysql(name)}`;
export const isGenerated = (column: MysqlColumn) => Boolean(column.GENERATION_EXPRESSION) || /\b(VIRTUAL|STORED) GENERATED\b/i.test(column.EXTRA);
export const isBinary = (column: MysqlColumn) => /^(binary|varbinary|tinyblob|blob|mediumblob|longblob|bit)$/i.test(column.DATA_TYPE);
export const isNumeric = (column: MysqlColumn) => /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|year)$/i.test(column.DATA_TYPE);
export const isSupportedColumn = (column: MysqlColumn) => /^(tinyint|smallint|mediumint|int|bigint|decimal|float|double|year|char|varchar|tinytext|text|mediumtext|longtext|enum|set|date|datetime|timestamp|time|json|binary|varbinary|tinyblob|blob|mediumblob|longblob|bit)$/i.test(column.DATA_TYPE);
export const primaryColumns = (columns: MysqlColumn[]) => columns.filter(column => Number(column.PK_POSITION) > 0).sort((a, b) => Number(a.PK_POSITION) - Number(b.PK_POSITION));
export function canEditTable(metadata: MysqlTableMetadata) {
  return metadata.table.TABLE_TYPE === 'BASE TABLE' && metadata.table.ENGINE?.toLowerCase() === 'innodb' && primaryColumns(metadata.columns).length > 0;
}
export function defaultConditions(columns: MysqlColumn[]): Record<string, Condition> {
  return Object.fromEntries(columns.map(column => [column.COLUMN_NAME, {
    operator: '=', value: '', sort: '', type: !isSupportedColumn(column) || isBinary(column) || column.DATA_TYPE === 'json' ? 'DISABLED' : isNumeric(column) ? 'NUMBER' : 'STRING'
  }]));
}

// Bind every value. Only catalog identifiers, whitelisted operators and integers become SQL text.
export function tableQuery(schema: string, table: string, columns: MysqlColumn[], conditions: Record<string, Condition>, page: number, size: number, count = false): MysqlStatement {
  if (!Number.isSafeInteger(page) || page < 0 || ![100, 500, 1000].includes(size) || !Number.isSafeInteger(page * size)) throw new Error('Invalid table page.');
  const binds: Record<string, unknown> = {}, filters: string[] = [], sorts: { priority: number; sql: string }[] = [];
  for (const column of columns) {
    const condition = conditions[column.COLUMN_NAME];
    if (!condition || condition.type === 'DISABLED') continue;
    const name = quoteMysql(column.COLUMN_NAME), key = `f${filters.length}`;
    if (condition.value !== '') {
      if (!['=', '<>', '<=', '>=', 'LIKE'].includes(condition.operator)) throw new Error('Invalid filter operator.');
      if (condition.type === 'NUMBER' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(condition.value)) throw new Error('Enter an exact numeric filter value.');
      if (condition.operator === 'LIKE') {
        binds[key] = '%' + condition.value.replace(/[!%_]/g, '!$&') + '%'; filters.push(`${name} LIKE :${key} ESCAPE '!'`);
      } else { binds[key] = condition.value; filters.push(`${name} ${condition.operator} :${key}`); }
    }
    if (condition.sort.trim()) {
      const match = condition.sort.trim().match(/^([1-9]\d{0,2})(?:\s+(ASC|DESC))?$/i);
      if (!match) throw new Error('Sort must be a priority and optional ASC/DESC, such as 1 DESC.');
      sorts.push({ priority: Number(match[1]), sql: `${name} ${match[2]?.toUpperCase() || 'ASC'}` });
    }
  }
  const projection = columns.map(column => quoteMysql(column.COLUMN_NAME)).join(', ');
  if (!projection) throw new Error('Table columns are unavailable.');
  const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
  const order = sorts.sort((a, b) => a.priority - b.priority).map(item => item.sql);
  for (const pk of primaryColumns(columns)) if (!sorts.some(sort => sort.sql.startsWith(quoteMysql(pk.COLUMN_NAME) + ' '))) order.push(quoteMysql(pk.COLUMN_NAME));
  return { sql: `SELECT ${count ? 'COUNT(*) AS total' : projection} FROM ${mysqlTableName(schema, table)}${where}` +
    (count ? '' : (order.length ? ' ORDER BY ' + order.join(', ') : '') + ` LIMIT ${size} OFFSET ${page * size}`), binds };
}

function valueExpression(column: MysqlColumn, value: unknown, key: string, binds: Record<string, unknown>): string {
  if (value === null) {
    if (column.IS_NULLABLE !== 'YES') throw new Error(`${column.COLUMN_NAME} does not allow NULL.`);
    binds[key] = null; return ':' + key;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error('Unsupported table value.');
  if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) throw new Error('Use text for exact large numbers.');
  const text = String(value);
  if (isNumeric(column) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) throw new Error(`${column.COLUMN_NAME}: invalid number.`);
  if (column.DATA_TYPE === 'json') JSON.parse(text);
  binds[key] = text;
  if (isBinary(column)) {
    if (!/^(?:[0-9a-f]{2})*$/i.test(text)) throw new Error(`${column.COLUMN_NAME}: enter hexadecimal byte pairs.`);
    return column.DATA_TYPE === 'bit' ? `CAST(CONV(:${key},16,10) AS UNSIGNED)` : `UNHEX(:${key})`;
  }
  return ':' + key;
}

// Compare the complete original image so another session's changes are never silently overwritten.
function originalPredicate(metadata: MysqlTableMetadata, original: DatabaseRow, binds: Record<string, unknown>): string {
  if (!canEditTable(metadata)) throw new Error('Editing requires an InnoDB base table with a primary key.');
  const predicates = primaryColumns(metadata.columns).map((column, index) => {
    const key = `pk${index}`, value = original[column.COLUMN_NAME];
    if (value === undefined || value === null || !isSupportedColumn(column)) throw new Error('The original primary key is unavailable.');
    return `${quoteMysql(column.COLUMN_NAME)} <=> ${valueExpression(column, value, key, binds)}`;
  });
  metadata.columns.forEach((column, index) => {
    const name = quoteMysql(column.COLUMN_NAME), key = `old${index}`;
    const value = original[column.COLUMN_NAME];
    if (value === undefined) throw new Error('The original row is incomplete. Refresh before editing.');
    if (!isSupportedColumn(column)) throw new Error('This row contains a type that cannot be compared safely.');
    binds[key] = value;
    predicates.push(isBinary(column) ? `${name} <=> ${value === null ? ':' + key : valueExpression(column, value, key, binds)}` : `CAST(${name} AS BINARY) <=> CAST(:${key} AS BINARY)`);
  });
  return predicates.join(' AND ');
}
export function updateStatement(schema: string, table: string, metadata: MysqlTableMetadata, original: DatabaseRow, changes: DatabaseRow): MysqlStatement {
  const binds: Record<string, unknown> = {}, assignments: string[] = [];
  for (const [name, value] of Object.entries(changes)) {
    const column = metadata.columns.find(column => column.COLUMN_NAME === name);
    if (!column || isGenerated(column) || Number(column.PK_POSITION) > 0 || !isSupportedColumn(column)) throw new Error('This column cannot be edited.');
    assignments.push(`${quoteMysql(name)} = ${valueExpression(column, value, `v${assignments.length}`, binds)}`);
  }
  if (!assignments.length) throw new Error('No changes to save.');
  return { sql: `UPDATE ${mysqlTableName(schema, table)} SET ${assignments.join(', ')} WHERE ${originalPredicate(metadata, original, binds)} LIMIT 1`, binds };
}
export function deleteStatement(schema: string, table: string, metadata: MysqlTableMetadata, original: DatabaseRow): MysqlStatement {
  const binds: Record<string, unknown> = {};
  return { sql: `DELETE FROM ${mysqlTableName(schema, table)} WHERE ${originalPredicate(metadata, original, binds)} LIMIT 1`, binds };
}
export function rowReadStatement(schema: string, table: string, metadata: MysqlTableMetadata, original: DatabaseRow): MysqlStatement {
  const binds: Record<string, unknown> = {};
  const keys = primaryColumns(metadata.columns);
  if (!keys.length) throw new Error('The primary key is unavailable.');
  const predicate = keys.map((column, index) => `${quoteMysql(column.COLUMN_NAME)} <=> ${valueExpression(column, original[column.COLUMN_NAME], `pk${index}`, binds)}`).join(' AND ');
  return { sql: `SELECT ${metadata.columns.map(column => quoteMysql(column.COLUMN_NAME)).join(', ')} FROM ${mysqlTableName(schema, table)} WHERE ${predicate} LIMIT 1`, binds };
}
export function insertStatement(schema: string, table: string, metadata: MysqlTableMetadata, fields: Record<string, RecordField>): MysqlStatement {
  if (metadata.table.ENGINE?.toLowerCase() !== 'innodb' || metadata.table.TABLE_TYPE !== 'BASE TABLE') throw new Error('Inserts require an InnoDB base table.');
  const binds: Record<string, unknown> = {}, names: string[] = [], values: string[] = [];
  for (const [name, field] of Object.entries(fields)) {
    const column = metadata.columns.find(column => column.COLUMN_NAME === name);
    if (!column || isGenerated(column)) throw new Error('This column cannot be inserted.');
    if (field.mode === 'default') continue;
    if (!isSupportedColumn(column)) throw new Error('Unsupported insert type.');
    names.push(quoteMysql(name)); values.push(valueExpression(column, field.mode === 'null' ? null : field.value, `v${values.length}`, binds));
  }
  return { sql: `INSERT INTO ${mysqlTableName(schema, table)} (${names.join(', ')}) VALUES (${values.join(', ')})`, binds };
}


export function autoIncrementColumn(metadata: MysqlTableMetadata): MysqlColumn | undefined {
  return metadata.columns.find(column => /\bauto_increment\b/i.test(column.EXTRA));
}

export function autoIncrementMaximum(column: MysqlColumn): string {
  const bits: Record<string, number> = { tinyint: 8, smallint: 16, mediumint: 24, int: 32, integer: 32, bigint: 64 };
  const width = bits[column.DATA_TYPE.toLowerCase()];
  if (!width) throw new Error('AUTO_INCREMENT management requires an integer column.');
  return ((1n << BigInt(width - (/\bunsigned\b/i.test(column.COLUMN_TYPE) ? 0 : 1))) - 1n).toString();
}

export function autoIncrementValue(metadata: MysqlTableMetadata, input: string): string {
  const column = autoIncrementColumn(metadata);
  if (!column || metadata.table.TABLE_TYPE !== 'BASE TABLE' || metadata.table.ENGINE?.toLowerCase() !== 'innodb') throw new Error('AUTO_INCREMENT changes require an InnoDB table with an auto-increment column.');
  const value = input.trim();
  if (!/^\d{1,20}$/.test(value) || BigInt(value) < 1n || BigInt(value) > BigInt(autoIncrementMaximum(column))) throw new Error('Enter a positive integer within the auto-increment column range.');
  return BigInt(value).toString();
}

// SHOW CREATE exposes the live counter; INFORMATION_SCHEMA.TABLES may cache it.
export function autoIncrementCounter(source: string): string {
  // Native SHOW CREATE includes version comments (for example invisible indexes).
  // Treat them only as opaque metadata comments; this text is never executed.
  const tokens = tokenizeSql(source.replace(/\/\*!(?=\d{5,6}\s)/g, '/* '), 'mysql');
  if (tokens[0]?.text.toUpperCase() !== 'CREATE' || tokens[1]?.text.toUpperCase() !== 'TABLE') throw new Error('MySQL returned no table definition.');
  let depth = 0, hasBody = false, completedBody = false;
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.text === '(') { depth++; hasBody = true; }
    else if (token.text === ')') { depth--; if(depth===0)completedBody=true; if(depth<0)throw new Error('MySQL returned an incomplete table definition.'); }
    else if (completedBody && depth === 0 && token.kind === 'word' && token.text.toUpperCase() === 'AUTO_INCREMENT') {
      const value = tokens[i + 1]?.text === '=' ? tokens[i + 2]?.text : undefined;
      if (!value || !/^\d{1,20}$/.test(value) || BigInt(value) < 1n || BigInt(value) > 18446744073709551615n) throw new Error('MySQL returned an invalid auto-increment counter.');
      return BigInt(value).toString();
    }
  }
  if(!hasBody||!completedBody||depth!==0)throw new Error('MySQL returned an incomplete table definition.');
  // MySQL omits the table option while the counter is at its initial value.
  return '1';
}
