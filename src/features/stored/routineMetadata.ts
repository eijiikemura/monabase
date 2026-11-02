// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { resolvePgRoutine } from '@/features/postgresql/routineIdentity';
export interface RoutineDependency { schema: string; name: string; type: string; }
export interface RoutineInformation { identity: string; status: string; result: string; language: string; security: string; references: RoutineDependency[]; dependents: RoutineDependency[]; }
async function rows<T>(sql: string, binds: Record<string, string>) {
  const res = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!res.success) throw new Error(res.error);
  return res.rows;
}
export async function loadRoutineInformation(database: 'oracle' | 'postgresql', schema: string, name: string, kind: 'PROCEDURE' | 'FUNCTION', signature?: string): Promise<RoutineInformation> {
  if (database === 'oracle') {
    const binds = { schema, name, kind };
    const [metadata, references, dependents] = await Promise.all([
      rows<{ STATUS: string; AUTHID: string; RESULT: string }>(`SELECT o.STATUS, p.AUTHID,
        (SELECT DATA_TYPE FROM ALL_ARGUMENTS a WHERE a.OWNER = o.OWNER AND a.OBJECT_NAME = o.OBJECT_NAME AND a.PACKAGE_NAME IS NULL AND a.POSITION = 0 AND ROWNUM = 1) AS RESULT
        FROM ALL_OBJECTS o LEFT JOIN ALL_PROCEDURES p ON p.OWNER = o.OWNER AND p.OBJECT_NAME = o.OBJECT_NAME AND p.PROCEDURE_NAME IS NULL
        WHERE o.OWNER = :schema AND o.OBJECT_NAME = :name AND o.OBJECT_TYPE = :kind`, binds),
      rows<RoutineDependency>(`SELECT DISTINCT REFERENCED_OWNER AS "schema", REFERENCED_NAME AS "name", REFERENCED_TYPE AS "type" FROM ALL_DEPENDENCIES WHERE OWNER = :schema AND NAME = :name AND TYPE = :kind ORDER BY "schema", "name", "type"`, binds),
      rows<RoutineDependency>(`SELECT DISTINCT OWNER AS "schema", NAME AS "name", TYPE AS "type" FROM ALL_DEPENDENCIES WHERE REFERENCED_OWNER = :schema AND REFERENCED_NAME = :name AND REFERENCED_TYPE = :kind ORDER BY "schema", "name", "type"`, binds)
    ]);
    if (!metadata.length) throw new Error('Routine metadata is unavailable.');
    return { identity: `${schema}.${name}`, status: metadata[0].STATUS, result: metadata[0].RESULT || '—', language: 'PL/SQL', security: metadata[0].AUTHID, references, dependents };
  }
  const selected = await resolvePgRoutine(ipcRenderer, { schema, objectName: name, objectType: kind, signature });
  const binds = { oid: selected.oid };
  const [metadata, references, dependents] = await Promise.all([
    rows<{ result: string; language: string; security: boolean }>(`SELECT pg_get_function_result(p.oid) AS result, l.lanname AS language, p.prosecdef AS security FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang WHERE p.oid = CAST(:oid AS oid)`, binds),
    rows<RoutineDependency>(`SELECT DISTINCT n.nspname AS schema, c.relname AS name, 'RELATION' AS type FROM pg_depend d JOIN pg_class c ON c.oid = d.refobjid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE d.classid = 'pg_proc'::regclass AND d.objid = CAST(:oid AS oid) AND d.refclassid = 'pg_class'::regclass ORDER BY schema, name`, binds),
    rows<RoutineDependency>(`SELECT DISTINCT n.nspname AS schema, c.relname AS name, 'VIEW' AS type FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class c ON c.oid = r.ev_class JOIN pg_namespace n ON n.oid = c.relnamespace WHERE d.refclassid = 'pg_proc'::regclass AND d.refobjid = CAST(:oid AS oid) AND d.classid = 'pg_rewrite'::regclass ORDER BY schema, name`, binds)
  ]);
  if (!metadata.length) throw new Error('Routine metadata is unavailable.');
  return { identity: `${schema}.${name}(${selected.signature})`, status: 'DEFINED', result: metadata[0].result || '—', language: metadata[0].language,
    security: metadata[0].security ? 'SECURITY DEFINER' : 'SECURITY INVOKER', references, dependents };
}
