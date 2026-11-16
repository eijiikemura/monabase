// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { MysqlStatement, MysqlColumn } from './table/tableModel';
import { mysqlTableName, quoteMysql } from './table/tableModel';

export type SidebarTableAction = 'rename' | 'copy' | 'analyze' | 'truncate' | 'drop';
export function buildSidebarTableAction(action: SidebarTableAction, schema: string, table: string, newName: string, columns: MysqlColumn[]): MysqlStatement {
  const source = mysqlTableName(schema, table);
  switch (action) {
    case 'rename':
      if (newName === table) throw new Error('Enter a different table name.');
      return { sql: `RENAME TABLE ${source} TO ${mysqlTableName(schema, newName)}`, binds: {} };
    case 'copy':
      if (!columns.length || newName === table) throw new Error('Choose a different table name and readable columns.');
      return { sql: `CREATE TABLE ${mysqlTableName(schema, newName)} ENGINE=InnoDB AS SELECT ${columns.map(column => quoteMysql(column.COLUMN_NAME)).join(', ')} FROM ${source}`, binds: {} };
    case 'analyze': return { sql: `ANALYZE TABLE ${source}`, binds: {} };
    case 'truncate': return { sql: `TRUNCATE TABLE ${source}`, binds: {} };
    case 'drop': return { sql: `DROP TABLE ${source}`, binds: {} };
  }
}
export interface NewMysqlColumn {
  id: number; name: string; type: string; nullable: boolean; primary: boolean; autoIncrement: boolean;
  defaultMode: 'none' | 'null' | 'literal' | 'current-timestamp'; defaultValue: string; comment: string;
}
export function validateColumnType(input: string): string {
  const type = input.trim().toUpperCase();
  if (!/^(?:(?:TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)(?: UNSIGNED)?|(?:DECIMAL|NUMERIC)\(\d{1,2},\d{1,2}\)|(?:VARCHAR|CHAR|VARBINARY|BINARY)\([1-9]\d{0,4}\)|TEXT|MEDIUMTEXT|LONGTEXT|BLOB|JSON|DATE|TIME(?:\([0-6]\))?|DATETIME(?:\([0-6]\))?|TIMESTAMP(?:\([0-6]\))?|DOUBLE|FLOAT)$/.test(type)) throw new Error('Choose a supported MySQL column type.');
  return type;
}
export function buildCreateMysqlTable(schema: string, name: string, comment: string, columns: NewMysqlColumn[]): MysqlStatement {
  if (!columns.length || columns.length > 1000) throw new Error('Define between 1 and 1,000 columns.');
  if (new Set(columns.map(column => column.name.toLowerCase())).size !== columns.length) throw new Error('Column names must be unique.');
  const binds: Record<string, unknown> = { tableComment: comment };
  const auto = columns.filter(column => column.autoIncrement);
  const primary = columns.filter(column => column.primary);
  if (auto.length > 1 || auto.length && (!auto[0].primary || primary[0]?.id !== auto[0].id)) throw new Error('AUTO_INCREMENT must be the first primary-key column, with only one per table.');
  const definitions = columns.map((column, index) => {
    const type = validateColumnType(column.type);
    if (column.autoIncrement && !/^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)(?: UNSIGNED)?$/.test(type)) throw new Error('AUTO_INCREMENT requires an integer column.');
    let definition = `${quoteMysql(column.name)} ${type} ${column.primary || !column.nullable ? 'NOT NULL' : 'NULL'}`;
    if (column.defaultMode !== 'none' && column.autoIncrement) throw new Error('AUTO_INCREMENT cannot have an explicit default.');
    if (column.defaultMode === 'null') {
      if (column.primary || !column.nullable) throw new Error('This column cannot default to NULL.');
      definition += ' DEFAULT NULL';
    } else if (column.defaultMode === 'literal') { binds[`default${index}`] = column.defaultValue; definition += ` DEFAULT :default${index}`; }
    else if (column.defaultMode === 'current-timestamp') {
      if (!/^(DATETIME|TIMESTAMP)/.test(type)) throw new Error('CURRENT_TIMESTAMP requires a datetime or timestamp column.');
      definition += ' DEFAULT CURRENT_TIMESTAMP' + (type.match(/\([0-6]\)/)?.[0] || '');
    }
    if (column.autoIncrement) definition += ' AUTO_INCREMENT';
    binds[`comment${index}`] = column.comment;
    return definition + ` COMMENT :comment${index}`;
  });
  if (primary.length) definitions.push(`PRIMARY KEY (${primary.map(column => quoteMysql(column.name)).join(', ')})`);
  return { sql: `CREATE TABLE ${mysqlTableName(schema, name)} (\n  ${definitions.join(',\n  ')}\n) ENGINE=InnoDB COMMENT = :tableComment`, binds };
}
