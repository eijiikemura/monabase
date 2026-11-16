// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { mysqlTableName, quoteMysql, type MysqlColumn, type MysqlStatement } from '@/features/mysql/table/tableModel';
export interface MysqlIndexPart { column: string; expression: string; prefix: string; descending: boolean; }
export interface MysqlIndexForm { schema: string; table: string; name: string; type: 'BTREE' | 'FULLTEXT' | 'SPATIAL' | 'HASH'; unique: boolean; visible: boolean; parts: MysqlIndexPart[]; }
export const blankIndexForm = (schema: string): MysqlIndexForm => ({ schema, table: '', name: '', type: 'BTREE', unique: false, visible: true, parts: [] });

// SHOW CREATE is trusted server output. Split its outer column/key list without splitting expressions or literals.
export function tableDefinitionParts(ddl: string): string[] {
  const start = ddl.indexOf('('); if (start < 0) throw new Error('MySQL table definition is unavailable.');
  let depth = 1, quote = '', begin = start + 1;
  const parts: string[] = [];
  for (let i = begin; i < ddl.length; i++) {
    const char = ddl[i];
    if (quote) {
      if (char === '\\' && quote !== '`') { i++; continue; }
      if (char === quote) { if (ddl[i + 1] === quote) i++; else quote = ''; }
      continue;
    }
    if (char === '`' || char === "'" || char === '"') { quote = char; continue; }
    if (char === '(') depth++;
    if (char === ')') { if (--depth === 0) { parts.push(ddl.slice(begin, i).trim()); return parts; } }
    if (char === ',' && depth === 1) { parts.push(ddl.slice(begin, i).trim()); begin = i + 1; }
  }
  throw new Error('MySQL table definition is incomplete.');
}
export function indexDefinition(ddl: string, name: string): string {
  const found = tableDefinitionParts(ddl).filter(part => name === 'PRIMARY' ? /^PRIMARY KEY\s*\(/.test(part) : new RegExp('^(?:UNIQUE |FULLTEXT |SPATIAL )?KEY ' + quoteMysql(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(').test(part));
  if (found.length !== 1) throw new Error('The exact MySQL index definition is unavailable.');
  return found[0];
}
function checkedExpression(value: string): string {
  const input = value.trim();
  if (!input || input.length > 4096) throw new Error('Enter an index expression.');
  let depth = 0, quote = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) { if (c === '\\') throw new Error('Use doubled quotes instead of backslashes in index expressions.'); if (c === quote) { if (input[i + 1] === quote) i++; else quote = ''; } continue; }
    if (c === "'" || c === '`') { quote = c; continue; }
    if (c === ';' || c === '#' || c === '"' || input.slice(i, i + 2) === '--' || input.slice(i, i + 2) === '/*' || /\u0000/.test(c)) throw new Error('Index expressions cannot contain statements or comments.');
    if (c === '(') depth++; if (c === ')' && --depth < 0) throw new Error('Unbalanced index expression.');
  }
  if (quote || depth || /\b(SELECT|UNION|INTO|OUTFILE|DUMPFILE)\b/i.test(input)) throw new Error('Enter a single scalar index expression.');
  return input;
}
export function createIndexStatement(form: MysqlIndexForm, columns: MysqlColumn[]): MysqlStatement {
  if (form.name.toUpperCase() === 'PRIMARY' || !['BTREE', 'FULLTEXT', 'SPATIAL'].includes(form.type) || !form.parts.length || form.parts.length > 16) throw new Error('Enter a valid index name and 1–16 key parts.');
  if (form.type !== 'BTREE' && (form.unique || !form.visible)) throw new Error('FULLTEXT and SPATIAL indexes must be visible and cannot be UNIQUE.');
  const seen = new Set<string>();
  const parts = form.parts.map(part => {
    if (Boolean(part.column) === Boolean(part.expression)) throw new Error('Choose a column or an expression for each index part.');
    let value: string;
    if (part.expression) {
      if (form.type !== 'BTREE' || part.prefix) throw new Error('Expressions require BTREE without a prefix length.');
      value = '(' + checkedExpression(part.expression) + ')';
    } else {
      const column = columns.find(column => column.COLUMN_NAME === part.column);
      if (!column) throw new Error('The index column is unavailable.');
      value = quoteMysql(part.column);
      if (part.prefix) {
        if (form.type !== 'BTREE' || !/^[1-9]\d{0,4}$/.test(part.prefix) || !/^(?:char|varchar|binary|varbinary|tinytext|text|mediumtext|longtext|tinyblob|blob|mediumblob|longblob)$/.test(column.DATA_TYPE)) throw new Error('Prefix length requires a string/binary BTREE column and a positive integer.');
        value += '(' + Number(part.prefix) + ')';
      }
    }
    if (seen.has(value)) throw new Error('Duplicate index key part.'); seen.add(value);
    if (form.type !== 'BTREE' && part.descending) throw new Error('Descending key parts require BTREE.');
    return value + (part.descending ? ' DESC' : '');
  });
  return { sql: `CREATE ${form.unique ? 'UNIQUE ' : form.type === 'BTREE' ? '' : form.type + ' '}INDEX ${quoteMysql(form.name)} ON ${mysqlTableName(form.schema, form.table)} (${parts.join(', ')})${form.visible ? '' : ' INVISIBLE'}`, binds: {} };
}
export function changeIndexStatement(schema: string, table: string, name: string, nextName: string, visible: boolean, wasVisible: boolean): MysqlStatement {
  if (name === 'PRIMARY') throw new Error('Manage the primary key from the table structure window.');
  if (name !== nextName && visible !== wasVisible) throw new Error('Rename and visibility changes must be applied separately in MySQL.');
  const changes: string[] = [];
  if (name !== nextName) { if (nextName.toUpperCase() === 'PRIMARY') throw new Error('PRIMARY is a reserved index name.'); changes.push(`RENAME INDEX ${quoteMysql(name)} TO ${quoteMysql(nextName)}`); }
  // Keep one native change per statement: MySQL rejects combined rename/visibility changes.
  if (visible !== wasVisible) changes.push(`ALTER INDEX ${quoteMysql(nextName)} ${visible ? 'VISIBLE' : 'INVISIBLE'}`);
  if (!changes.length) throw new Error('No index changes.');
  return { sql: `ALTER TABLE ${mysqlTableName(schema, table)} ${changes.join(', ')}`, binds: {} };
}
