// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
export interface ViewColumn { name: string; type: string; nullable: string; }
export interface ViewDependency { schema: string; name: string; type: string; }
export interface ViewMetadata { status: string; columns: ViewColumn[]; references: ViewDependency[]; dependents: ViewDependency[]; }
async function rows<T>(sql: string, binds: Record<string, string>) {
  const result = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!result.success) throw new Error(result.error);
  return result.rows;
}
export async function loadViewMetadata(database: 'oracle' | 'postgresql', schema: string, name: string): Promise<ViewMetadata> {
  const binds = { schema, name };
  if (database === 'oracle') {
    const [status, columns, references, dependents] = await Promise.all([
      rows<{ STATUS: string }>(`SELECT STATUS FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_NAME = :name AND OBJECT_TYPE = 'VIEW'`, binds),
      rows<ViewColumn>(`SELECT COLUMN_NAME AS "name", DATA_TYPE AS "type", NULLABLE AS "nullable" FROM ALL_TAB_COLUMNS WHERE OWNER = :schema AND TABLE_NAME = :name ORDER BY COLUMN_ID`, binds),
      rows<ViewDependency>(`SELECT DISTINCT REFERENCED_OWNER AS "schema", REFERENCED_NAME AS "name", REFERENCED_TYPE AS "type" FROM ALL_DEPENDENCIES WHERE OWNER = :schema AND NAME = :name AND TYPE = 'VIEW' ORDER BY "schema", "name", "type"`, binds),
      rows<ViewDependency>(`SELECT DISTINCT OWNER AS "schema", NAME AS "name", TYPE AS "type" FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :schema AND REFERENCED_NAME = :name AND REFERENCED_TYPE = 'VIEW' ORDER BY "schema", "name", "type"`, binds)
    ]);
    if (!status[0]?.STATUS) throw new Error('View metadata is unavailable.');
    return { status: status[0].STATUS, columns, references, dependents };
  }
  const [status, columns, references, dependents] = await Promise.all([
    rows<{ status: string }>(`SELECT 'VALID' AS status FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :schema AND c.relname = :name AND c.relkind = 'v'`, binds),
    rows<ViewColumn>(`SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, CASE WHEN a.attnotnull THEN 'N' ELSE 'Y' END AS nullable FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :schema AND c.relname = :name AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, binds),
    rows<ViewDependency>(`SELECT DISTINCT rn.nspname AS schema, ref.relname AS name,
      CASE ref.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS type
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_rewrite r ON r.ev_class = c.oid
      JOIN pg_depend d ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid AND d.refclassid = 'pg_class'::regclass
      JOIN pg_class ref ON ref.oid = d.refobjid JOIN pg_namespace rn ON rn.oid = ref.relnamespace
      WHERE n.nspname = :schema AND c.relname = :name AND ref.oid <> c.oid ORDER BY schema, name, type`, binds),
    rows<ViewDependency>(`SELECT DISTINCT rn.nspname AS schema, ref.relname AS name,
      CASE ref.relkind WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'VIEW' END AS type
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_depend d ON d.refclassid = 'pg_class'::regclass AND d.refobjid = c.oid AND d.classid = 'pg_rewrite'::regclass
      JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class ref ON ref.oid = r.ev_class JOIN pg_namespace rn ON rn.oid = ref.relnamespace
      WHERE n.nspname = :schema AND c.relname = :name AND ref.oid <> c.oid ORDER BY schema, name, type`, binds)
  ]);
  if (!status.length) throw new Error('View metadata is unavailable.');
  return { status: status[0].status, columns, references, dependents };
}
