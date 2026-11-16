// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { ViewMetadata, ViewDependency } from '@/features/view/viewMetadata';
import { backgroundRows } from '@/features/mysql/table/tableRepository';
import { loadMysqlReference } from '@/features/objects/mysqlObjects';
import { mysqlViewStatement } from '@/features/mysql/view/viewModel';

export async function loadMysqlView(object: DatabaseObject) {
  if (object.dbType !== 'mysql' || object.category !== 'VIEW' || !object.schema || !object.name) throw new Error('An exact MySQL view identity is required.');
  const binds = { schema: object.schema, name: object.name };
  const matches = `CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:name AS BINARY)`;
  const results = await Promise.allSettled([
    loadMysqlReference(object),
    backgroundRows(`SELECT CHECK_OPTION,IS_UPDATABLE,DEFINER,SECURITY_TYPE,CHARACTER_SET_CLIENT,COLLATION_CONNECTION FROM information_schema.VIEWS WHERE ${matches}`, binds),
    backgroundRows(`SELECT COLUMN_NAME name,COLUMN_TYPE type,IS_NULLABLE nullable FROM information_schema.COLUMNS WHERE ${matches} ORDER BY ORDINAL_POSITION`, binds),
    backgroundRows<ViewDependency>(`SELECT u.TABLE_SCHEMA AS \`schema\`,u.TABLE_NAME AS name,COALESCE(t.TABLE_TYPE,'TABLE') AS type
      FROM information_schema.VIEW_TABLE_USAGE u LEFT JOIN information_schema.TABLES t ON CAST(t.TABLE_SCHEMA AS BINARY)=CAST(u.TABLE_SCHEMA AS BINARY) AND CAST(t.TABLE_NAME AS BINARY)=CAST(u.TABLE_NAME AS BINARY)
      WHERE CAST(u.VIEW_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(u.VIEW_NAME AS BINARY)=CAST(:name AS BINARY) ORDER BY \`schema\`,name`, binds),
    backgroundRows<ViewDependency>(`SELECT VIEW_SCHEMA AS \`schema\`,VIEW_NAME AS name,'VIEW' AS type FROM information_schema.VIEW_TABLE_USAGE WHERE ${matches} ORDER BY \`schema\`,name`, binds)
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
  const reference = results[0].status === 'fulfilled' ? results[0].value : undefined;
  const settings = results[1].status === 'fulfilled' ? results[1].value[0] : undefined;
  if (!reference || !settings) throw new Error('MySQL view metadata is unavailable. Check SHOW VIEW and dictionary privileges.');
  const columns = results[2].status === 'fulfilled' ? results[2].value : [];
  const unique = (items: ViewDependency[]) => [...new Map(items.map(item => [JSON.stringify([item.schema,item.name,item.type]),item])).entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,item]) => item);
  const metadata: ViewMetadata = { status: 'METADATA AVAILABLE', columns: columns.map(row => ({ name: String(row.name), type: String(row.type), nullable: String(row.nullable) })),
    references: unique(results[3].status === 'fulfilled' ? results[3].value : []), dependents: unique(results[4].status === 'fulfilled' ? results[4].value : []) };
  return { native: reference.definition, source: mysqlViewStatement(reference.definition, object.schema, object.name).sql,
    settings, metadata, fingerprint: JSON.stringify([reference.definition, metadata.dependents]) };
}
export type MysqlViewDetails = Awaited<ReturnType<typeof loadMysqlView>>;
