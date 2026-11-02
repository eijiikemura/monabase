// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { DatabaseObject, ObjectCategory } from '@/shared/types/objectTypes';
import { OBJECT_CATEGORIES } from '../objects/objectRepository';

export async function listRelatedObjects(object: DatabaseObject): Promise<DatabaseObject[]> {
  let sql: string;
  if (object.dbType === 'oracle') {
    sql = `SELECT DISTINCT * FROM (SELECT d.REFERENCED_OWNER AS "schema", d.REFERENCED_NAME AS "name",
      d.REFERENCED_TYPE AS "category" FROM ALL_DEPENDENCIES d
      JOIN ALL_USERS u ON u.USERNAME = d.REFERENCED_OWNER AND u.ORACLE_MAINTAINED = 'N'
      WHERE d.OWNER = :schema AND d.NAME = :name AND d.TYPE = :category
      AND d.REFERENCED_LINK_NAME IS NULL
      UNION SELECT r.OWNER, r.TABLE_NAME, 'TABLE' FROM ALL_CONSTRAINTS c
      JOIN ALL_CONSTRAINTS r ON r.OWNER=c.R_OWNER AND r.CONSTRAINT_NAME=c.R_CONSTRAINT_NAME
      WHERE c.OWNER=:schema AND c.TABLE_NAME=:name AND c.CONSTRAINT_TYPE='R' AND :category='TABLE')
      ORDER BY "schema", "category", "name" FETCH FIRST 100 ROWS ONLY`;
  } else {
    if (!object.id || !/^\d+$/.test(object.id)) return [];
    sql = `WITH roots AS (
      SELECT CASE WHEN :category IN ('FUNCTION','PROCEDURE') THEN 'pg_proc'::regclass
        WHEN :category = 'TRIGGER' THEN 'pg_trigger'::regclass
        WHEN :category = 'TYPE' THEN 'pg_type'::regclass ELSE 'pg_class'::regclass END AS classid,
        CAST(:id AS oid) AS objid
      UNION SELECT 'pg_rewrite'::regclass, oid FROM pg_rewrite WHERE ev_class = CAST(:id AS oid)
        AND :category IN ('VIEW','MATERIALIZED VIEW')
    ), refs AS (
      SELECT d.refclassid, d.refobjid FROM pg_depend d JOIN roots r ON r.classid=d.classid AND r.objid=d.objid
      UNION SELECT 'pg_class'::regclass, confrelid FROM pg_constraint
        WHERE conrelid=CAST(:id AS oid) AND contype='f' AND :category='TABLE'
    ), candidates AS (
      SELECT n.nspname AS schema, c.relname AS name, CAST(c.oid AS text) AS id, c.relname AS "displayName",
        CASE WHEN c.relkind IN ('r','p') THEN 'TABLE' WHEN c.relkind='v' THEN 'VIEW'
          WHEN c.relkind='m' THEN 'MATERIALIZED VIEW' WHEN c.relkind='S' THEN 'SEQUENCE' ELSE 'INDEX' END AS category
      FROM refs d JOIN pg_class c ON d.refclassid='pg_class'::regclass AND c.oid=d.refobjid
      JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','S','i','I')
      UNION SELECT n.nspname, p.proname, CAST(p.oid AS text),
        p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', CASE WHEN p.prokind='p' THEN 'PROCEDURE' ELSE 'FUNCTION' END
      FROM refs d JOIN pg_proc p ON d.refclassid='pg_proc'::regclass AND p.oid=d.refobjid
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
    ) SELECT DISTINCT * FROM candidates WHERE schema <> 'information_schema' AND schema NOT LIKE 'pg!_%' ESCAPE '!'
    ORDER BY schema, category, "displayName", id LIMIT 100`;
  }
  const result = await ipcRenderer.invoke('execute-sql-bg', sql, object.dbType === 'oracle'
    ? { schema: object.schema, name: object.name, category: object.category }
    : { id: object.id!, category: object.category });
  if (!result.success) throw new Error('Related objects could not be loaded.');
  return (result.rows || []).flatMap(row => {
    if (typeof row.schema !== 'string' || !row.schema || typeof row.name !== 'string' || !row.name) return [];
    const category = String(row.category) as ObjectCategory;
    if (!(OBJECT_CATEGORIES[object.dbType] as readonly string[]).includes(category)) return [];
    const schema = String(row.schema), name = String(row.name), id = row.id ? String(row.id) : undefined;
    const candidate = { dbType: object.dbType, schema, category, name, ...(id ? { id } : {}),
      displayName: String(row.displayName || row.name), key: JSON.stringify([object.dbType, schema, category, id || name]) };
    return candidate.key === object.key ? [] : [candidate];
  });
}
