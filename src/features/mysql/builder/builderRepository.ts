// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { parseObjectIdentity } from '@/shared/utils/objectIdentity';
import { backgroundRows } from '@/features/mysql/table/tableRepository';
import { loadMysqlReference } from '@/features/objects/mysqlObjects';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { AiTableColumn } from '@/features/ai/useQueryBuilderAi';

export async function loadBuilderColumns(schema: string, name: string): Promise<AiTableColumn[]> {
  const columns = await backgroundRows(`SELECT COLUMN_NAME name, COLUMN_TYPE dataType, COLUMN_COMMENT comment FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY) ORDER BY ORDINAL_POSITION`, { schema, name });
  if (!columns.length || columns.some(column => typeof column.name !== 'string' || typeof column.dataType !== 'string')) throw new Error('MySQL table or view columns are unavailable.');
  return columns.map(column => ({ name: String(column.name), dataType: String(column.dataType), comment: typeof column.comment === 'string' ? column.comment : null }));
}
export async function loadBuilderTableInfo(fullName: string) {
  const { schema, objectName: name } = parseObjectIdentity(fullName);
  if (!schema || !name) throw new Error('A database-qualified MySQL table or view is required.');
  const tables = await backgroundRows(`SELECT TABLE_TYPE, TABLE_COMMENT FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY)`, { schema, name });
  if (tables.length !== 1 || !['BASE TABLE', 'VIEW'].includes(String(tables[0].TABLE_TYPE))) throw new Error('The MySQL table or view is unavailable.');
  const category: 'TABLE' | 'VIEW' = tables[0].TABLE_TYPE === 'VIEW' ? 'VIEW' : 'TABLE';
  const object: DatabaseObject = { key: JSON.stringify(['mysql', schema, category, name]), dbType: 'mysql', schema, name, category, displayName: name };
  const [reference, columns] = await Promise.all([loadMysqlReference(object), loadBuilderColumns(schema, name)]);
  return { ddl: reference.definition, columns, objectType: category, comment: typeof tables[0].TABLE_COMMENT === 'string' ? tables[0].TABLE_COMMENT : null };
}
