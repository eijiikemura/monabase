// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { backgroundRows } from '@/features/mysql/table/tableRepository';
import { listMysqlObjects } from '@/features/objects/mysqlObjects';
import { quoteMysql } from '@/features/mysql/table/tableModel';
import { scalarType } from './crossTabModel';
import type { ColumnInfo } from '@/features/cross-tab/crossTabTypes';
export async function crossTabObjects(schema: string, type: string): Promise<string[]> {
  quoteMysql(schema); if (!['TABLE','VIEW'].includes(type)) throw new Error('Invalid MySQL cross-tab object type.');
  const objects: string[] = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const page = await listMysqlObjects(schema, type as 'TABLE' | 'VIEW', '', offset);
    if (objects.length + page.length > 10000) throw new Error('mysql_cross_tab_object_limit');
    objects.push(...page.map(object => object.name)); if (page.length < 100) return [...new Set(objects)];
  }
  throw new Error('mysql_cross_tab_object_limit');
}
export async function crossTabColumns(schema: string, name: string, type: string): Promise<ColumnInfo[]> {
  quoteMysql(schema); quoteMysql(name); if (!['TABLE','VIEW'].includes(type)) throw new Error('Invalid MySQL cross-tab object type.');
  const tables = await backgroundRows('SELECT TABLE_TYPE FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY)', { schema, name });
  if (tables.length !== 1 || tables[0].TABLE_TYPE !== (type === 'TABLE' ? 'BASE TABLE' : 'VIEW')) throw new Error('The MySQL table or view is unavailable.');
  const rows = await backgroundRows('SELECT COLUMN_NAME name, DATA_TYPE type FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY) ORDER BY ORDINAL_POSITION', { schema, name });
  const columns = rows.filter(row => typeof row.name === 'string' && typeof row.type === 'string' && scalarType(row.type)).map(row => ({ name: String(row.name), type: String(row.type).toUpperCase() }));
  if (!columns.length) throw new Error('mysql_cross_tab_no_columns');
  return columns;
}
