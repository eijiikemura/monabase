// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { DatabaseObject, ObjectCategory, ObjectReference } from '@/shared/types/objectTypes';
import type { DatabaseRow } from '@/shared/types/databaseTypes';

const quote = (name: string) => '`' + name.replaceAll('`', '``') + '`';
const categories: readonly ObjectCategory[] = ['TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'INDEX'];
async function query(sql: string, binds: Record<string, string | number> = {}): Promise<DatabaseRow[]> {
  const response = await ipcRenderer.invoke('execute-sql-bg', sql, binds);
  if (!response.success) throw new Error(response.error);
  return response.rows;
}
export async function listMysqlObjects(schema: string, category: ObjectCategory, search: string, offset: number): Promise<DatabaseObject[]> {
  if (!categories.includes(category) || !schema || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid MySQL object request.');
  const bindings: Record<string, string | number> = { schema, pattern: '%' + search.replace(/[!%_]/g, value => '!' + value) + '%', offset };
  let sql: string;
  if (category === 'TABLE' || category === 'VIEW') {
    bindings.kind = category === 'TABLE' ? 'BASE TABLE' : 'VIEW';
    sql = 'SELECT TABLE_NAME name FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND (@@lower_case_table_names<>0 OR CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY)) AND TABLE_TYPE=:kind AND TABLE_NAME LIKE :pattern ESCAPE \'!\' ORDER BY CAST(TABLE_NAME AS BINARY) LIMIT 100 OFFSET :offset';
  } else if (category === 'INDEX') {
    sql = `SELECT INDEX_NAME name,TABLE_NAME parentName FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=:schema AND (@@lower_case_table_names<>0 OR CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY))
      AND (INDEX_NAME LIKE :pattern ESCAPE '!' OR TABLE_NAME LIKE :pattern ESCAPE '!')
      GROUP BY TABLE_SCHEMA,TABLE_NAME,INDEX_NAME ORDER BY CAST(INDEX_NAME AS BINARY),CAST(TABLE_NAME AS BINARY) LIMIT 100 OFFSET :offset`;
  } else if (category === 'TRIGGER') {
    sql = 'SELECT TRIGGER_NAME name, EVENT_OBJECT_TABLE parentName FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=:schema AND (@@lower_case_table_names<>0 OR CAST(TRIGGER_SCHEMA AS BINARY)=CAST(:schema AS BINARY)) AND TRIGGER_NAME LIKE :pattern ESCAPE \'!\' ORDER BY CAST(TRIGGER_NAME AS BINARY) LIMIT 100 OFFSET :offset';
  } else {
    bindings.kind = category;
    sql = 'SELECT ROUTINE_NAME name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=:schema AND (@@lower_case_table_names<>0 OR CAST(ROUTINE_SCHEMA AS BINARY)=CAST(:schema AS BINARY)) AND ROUTINE_TYPE=:kind AND ROUTINE_NAME LIKE :pattern ESCAPE \'!\' ORDER BY CAST(ROUTINE_NAME AS BINARY) LIMIT 100 OFFSET :offset';
  }
  const rows = await query(sql, bindings);
  return rows.map(row => {
    const name = String(row.name);
    return { key: JSON.stringify(category === 'INDEX' ? ['mysql', schema, category, row.parentName, name] : ['mysql', schema, category, name]), dbType: 'mysql', schema, category, name, displayName: category === 'INDEX' ? `${name} (${String(row.parentName)})` : name,
      ...(typeof row.parentName === 'string' ? { parentName: row.parentName } : {}) };
  });
}
export async function loadMysqlReference(object: DatabaseObject): Promise<ObjectReference> {
  if (object.dbType !== 'mysql' || !categories.includes(object.category) || !object.schema || !object.name) throw new Error('Invalid MySQL source identity.');
  if (object.category === 'INDEX') {
    const { loadMysqlIndex } = await import('@/features/mysql/index/indexRepository');
    const details = await loadMysqlIndex(object);
    return { definition: details.ddl, details: { schema: object.schema, table: object.parentName, keys: details.keys, references: details.references } };
  }
  const qualified = quote(object.schema) + '.' + quote(object.name);
  const rows = await query(`SHOW CREATE ${object.category} ${qualified}`);
  const column = object.category === 'TRIGGER' ? 'SQL Original Statement' : `Create ${object.category[0] + object.category.slice(1).toLowerCase()}`;
  const definition = rows[0]?.[column];
  if (typeof definition !== 'string' || !definition.trim()) throw new Error('MySQL returned no readable source definition. Check SHOW_ROUTINE, SHOW VIEW or TRIGGER privileges.');
  const details: Record<string, unknown> = { schema: object.schema, category: object.category };
  for (const key of ['sql_mode', 'character_set_client', 'collation_connection', 'Database Collation']) {
    if (typeof rows[0][key] === 'string') details[key] = rows[0][key];
  }
  if (object.category === 'TABLE' || object.category === 'VIEW') {
    details.columns = await query(`SELECT COLUMN_NAME name, COLUMN_TYPE type, IS_NULLABLE nullable, COLUMN_DEFAULT defaultValue,
      COLUMN_COMMENT comment, COLUMN_KEY columnKey, EXTRA extra FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=:schema AND (@@lower_case_table_names<>0 OR CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY)) AND TABLE_NAME=:name
      AND (@@lower_case_table_names<>0 OR (CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY))) ORDER BY ORDINAL_POSITION`, { schema: object.schema, name: object.name });
  } else if (object.category === 'FUNCTION' || object.category === 'PROCEDURE') {
    details.parameters = await query(`SELECT PARAMETER_NAME name, PARAMETER_MODE mode, DTD_IDENTIFIER type, ORDINAL_POSITION position
      FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA=:schema AND SPECIFIC_NAME=:name ORDER BY ORDINAL_POSITION`, { schema: object.schema, name: object.name });
  } else if (object.parentName) details.tableName = object.parentName;
  const settings = ['sql_mode', 'character_set_client', 'collation_connection', 'Database Collation'].filter(key => typeof details[key] === 'string').map(key => `-- MySQL ${key}: ${JSON.stringify(details[key])}`);
  return { definition: [...settings, definition].join('\n'), details };
}
