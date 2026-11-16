// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import { backgroundRows, loadTableMetadata } from '@/features/mysql/table/tableRepository';
import { mysqlTableName, quoteMysql } from '@/features/mysql/table/tableModel';
import { indexDefinition } from '@/features/mysql/index/indexModel';

export async function loadMysqlIndex(object: DatabaseObject) {
  if (object.dbType !== 'mysql' || object.category !== 'INDEX' || !object.schema || !object.parentName || !object.name) throw new Error('MySQL indexes require an exact database, table and index identity.');
  const metadata = await loadTableMetadata(object.schema, object.parentName);
  const keys = metadata.indexes.filter(row => row.INDEX_NAME === object.name).sort((a, b) => Number(a.SEQ_IN_INDEX) - Number(b.SEQ_IN_INDEX));
  if (!keys.length) throw new Error('The MySQL index is no longer available.');
  const rows = await backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(object.schema, object.parentName)}`, {});
  const tableDdl = rows[0]?.['Create Table']; if (typeof tableDdl !== 'string') throw new Error('MySQL returned no table definition.');
  const definition = indexDefinition(tableDdl, object.name);
  const dependencies = new Map<string, DatabaseRow[]>();
  for (const relation of metadata.relations) {
    const id = JSON.stringify([relation.CONSTRAINT_SCHEMA, relation.TABLE_NAME, relation.CONSTRAINT_NAME]);
    dependencies.set(id, [...dependencies.get(id) || [], relation]);
  }
  const references = [...dependencies.values()].filter(relations => {
    const sorted = relations.sort((a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION));
    const supports = (field: string) => sorted.every((row, i) => keys[i]?.COLUMN_NAME === row[field] && keys[i]?.SUB_PART == null);
    return sorted[0].TABLE_SCHEMA === object.schema && sorted[0].TABLE_NAME === object.parentName && supports('COLUMN_NAME')
      || sorted[0].REFERENCED_TABLE_SCHEMA === object.schema && sorted[0].REFERENCED_TABLE_NAME === object.parentName && supports('REFERENCED_COLUMN_NAME');
  }).map(rows => `${String(rows[0].CONSTRAINT_SCHEMA)}.${String(rows[0].TABLE_NAME)}.${String(rows[0].CONSTRAINT_NAME)}`);
  return { metadata, keys, definition, ddl: `ALTER TABLE ${mysqlTableName(object.schema, object.parentName)} ADD ${definition};`,
    visible: keys[0].IS_VISIBLE === 'YES', unique: Number(keys[0].NON_UNIQUE) === 0, primary: object.name === 'PRIMARY', references,
    fingerprint: JSON.stringify([definition, references]) };
}
export type MysqlIndexDetails = Awaited<ReturnType<typeof loadMysqlIndex>>;
export function dropIndexStatement(object: DatabaseObject, details: MysqlIndexDetails) {
  if (!object.parentName || details.primary || details.references.length) throw new Error('Manage the primary key or related foreign keys before deleting this index.');
  return { sql: `DROP INDEX ${quoteMysql(object.name)} ON ${mysqlTableName(object.schema, object.parentName)}`, binds: {} };
}
