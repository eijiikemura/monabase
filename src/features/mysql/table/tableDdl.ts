// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { mysqlTableName, quoteMysql, autoIncrementValue, type MysqlTableMetadata, type MysqlStatement } from './tableModel';

export type TableDdlAction = 'auto-increment' | 'comment' | 'add-column' | 'rename-column' | 'drop-column' | 'drop-table' | 'add-index' | 'drop-index' | 'add-check' | 'drop-check' | 'add-relation' | 'drop-relation';
export interface TableDdlInput {
  action: TableDdlAction; name: string; value: string; type: string; nullable: boolean;
  unique: boolean; columns: string[]; targetSchema: string; targetTable: string; targetColumns: string[];
  deleteRule: string; updateRule: string;
}
export function buildTableDdl(schema: string, table: string, input: TableDdlInput, metadata?: MysqlTableMetadata): MysqlStatement {
  const target = mysqlTableName(schema, table), binds: Record<string, unknown> = {};
  const list = (names: string[]) => { if (!names.length || new Set(names).size !== names.length) throw new Error('Select distinct columns.'); return names.map(quoteMysql).join(', '); };
  const name = () => quoteMysql(input.name);
  let clause: string;
  switch (input.action) {
    case 'auto-increment':
      if (!metadata) throw new Error('Reload the table metadata before changing AUTO_INCREMENT.');
      clause = `AUTO_INCREMENT = ${autoIncrementValue(metadata, input.value)}`; break;
    case 'comment': binds.comment = input.value; clause = 'COMMENT = :comment'; break;
    case 'add-column': {
      // Advanced types/default expressions remain explicit SQL operations; do not interpolate arbitrary type text.
      const type = input.type.trim().toUpperCase();
      if (!/^(?:(?:TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT)(?: UNSIGNED)?|(?:DECIMAL|NUMERIC)\(\d{1,2},\d{1,2}\)|(?:VARCHAR|CHAR|VARBINARY|BINARY)\([1-9]\d{0,4}\)|TEXT|MEDIUMTEXT|LONGTEXT|BLOB|JSON|DATE|TIME(?:\([0-6]\))?|DATETIME(?:\([0-6]\))?|TIMESTAMP(?:\([0-6]\))?|DOUBLE|FLOAT)$/.test(type)) throw new Error('Choose a supported MySQL column type.');
      clause = `ADD COLUMN ${name()} ${type} ${input.nullable ? 'NULL' : 'NOT NULL'}`; break;
    }
    case 'rename-column': clause = `RENAME COLUMN ${name()} TO ${quoteMysql(input.value)}`; break;
    case 'drop-column': clause = `DROP COLUMN ${name()}`; break;
    case 'drop-table': return { sql: `DROP TABLE ${target}`, binds };
    case 'add-index': clause = `ADD ${input.unique ? 'UNIQUE ' : ''}INDEX ${name()} (${list(input.columns)})`; break;
    case 'drop-index':
      if (input.name === 'PRIMARY') throw new Error('Dropping a primary key requires an explicit SQL review.');
      clause = `DROP INDEX ${name()}`; break;
    case 'add-check':
      if (!input.value.trim()) throw new Error('Enter a CHECK expression.');
      clause = `ADD CONSTRAINT ${name()} CHECK (${input.value})`; break;
    case 'drop-check': clause = `DROP CHECK ${name()}`; break;
    case 'add-relation': {
      if (input.columns.length !== input.targetColumns.length) throw new Error('The foreign key column counts must match.');
      for (const rule of [input.deleteRule, input.updateRule]) if (!['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].includes(rule)) throw new Error('Invalid foreign key rule.');
      clause = `ADD CONSTRAINT ${name()} FOREIGN KEY (${list(input.columns)}) REFERENCES ${mysqlTableName(input.targetSchema, input.targetTable)} (${list(input.targetColumns)}) ON DELETE ${input.deleteRule} ON UPDATE ${input.updateRule}`; break;
    }
    case 'drop-relation': clause = `DROP FOREIGN KEY ${name()}`; break;
  }
  return { sql: `ALTER TABLE ${target} ${clause}`, binds };
}
