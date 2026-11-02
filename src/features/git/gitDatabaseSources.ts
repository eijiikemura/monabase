// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { GitReviewSource } from '@/shared/api/desktopContract';
import type { DatabaseObject, DbType, ObjectCategory } from '@/shared/types/objectTypes';
import { ipcRenderer } from '@/shared/api/desktop';
import { listObjects, loadObjectReference } from '@/features/objects/objectRepository';
import { getFullTableDDL } from '@/features/postgresql/windows/common/ddlHelper';
import type { TFunction } from 'i18next';

export type GitDatabaseObject = Omit<DatabaseObject, 'category'> & { category: ObjectCategory | 'PACKAGE BODY' };

export const gitSourceCategories = (db: DbType): string[] => db === 'oracle'
  ? ['FUNCTION', 'PROCEDURE', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TABLE', 'VIEW', 'SEQUENCE', 'INDEX', 'TYPE', 'SYNONYM', 'MATERIALIZED VIEW']
  : ['FUNCTION', 'PROCEDURE', 'TRIGGER', 'TABLE', 'VIEW', 'SEQUENCE', 'INDEX', 'TYPE', 'MATERIALIZED VIEW'];

async function query<Row extends Record<string, unknown>>(sql: string, binds: Record<string, string>) {
  const result = await ipcRenderer.invoke<Row>('execute-sql-bg', sql, binds);
  if (!result.success) throw new Error(result.error);
  return result.rows || [];
}
export async function readGitDatabaseSource(object: GitDatabaseObject, t: TFunction): Promise<GitReviewSource> {
  const base = { dbType: object.dbType.toUpperCase(), schema: object.schema, objectType: object.category,
    objectName: object.name, key: object.key, displayName: object.displayName };
  if (object.dbType === 'postgresql' && ['FUNCTION', 'PROCEDURE'].includes(object.category)) {
    const rows = await query<{ signature: string; ddl: string }>(`SELECT oidvectortypes(p.proargtypes) AS signature, pg_get_functiondef(p.oid) AS ddl
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.oid=CAST(:id AS oid) AND n.nspname=:schema AND p.proname=:name`, { id: object.id || '', schema: object.schema, name: object.name });
    if (rows.length !== 1 || !rows[0].ddl) throw new Error(t('git_source_unavailable'));
    return { ...base, sourceText: rows[0].ddl, signature: rows[0].signature };
  }
  if (object.dbType === 'postgresql' && object.category === 'TABLE') {
    return { ...base, sourceText: await getFullTableDDL(ipcRenderer, object.schema, object.name, t) };
  }
  if (object.category === 'PACKAGE BODY') {
    if (object.dbType !== 'oracle') throw new Error('Unsupported package body.');
    const rows = await query<{ text: string }>(`WITH source AS (SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY', :name, :schema) AS ddl FROM DUAL)
      SELECT DBMS_LOB.SUBSTR(ddl,1000,(LEVEL-1)*1000+1) AS "text" FROM source
      CONNECT BY LEVEL<=CEIL(DBMS_LOB.GETLENGTH(ddl)/1000) ORDER BY LEVEL`, { name: object.name, schema: object.schema });
    const sourceText = rows.map(row => row.text).join('');
    if (!sourceText.trim()) throw new Error(t('git_source_unavailable'));
    return { ...base, sourceText };
  }
  const reference = await loadObjectReference({ ...object, category: object.category });
  if (object.dbType === 'postgresql' && object.category === 'TRIGGER' &&
      (typeof reference.details.functionDefinition !== 'string' || !reference.details.functionDefinition.trim() ||
       !object.parentName || reference.details.tableName !== object.parentName)) throw new Error(t('git_source_unavailable'));

  return { ...base, sourceText: object.dbType === 'postgresql' && object.category === 'TRIGGER'
    ? `${reference.details.functionDefinition};\n\n${reference.definition};` : reference.definition,
    ...(object.dbType === 'postgresql' && object.category === 'TRIGGER' ? { tableName: object.parentName } : {}) };
}
export async function listGitDatabaseObjects(db: DbType, schema: string, category: string): Promise<GitDatabaseObject[]> {
  if (!gitSourceCategories(db).includes(category)) throw new Error('Invalid source category.');
  if (category === 'PACKAGE BODY') {
    const rows = await query<{ name: string }>(`SELECT OBJECT_NAME AS "name" FROM ALL_OBJECTS WHERE OWNER=:schema AND OBJECT_TYPE='PACKAGE BODY' ORDER BY OBJECT_NAME`, { schema });
    // The Git category is separate from the shared object picker category.
    return rows.map(row => ({ key: JSON.stringify([db, schema, category, row.name]), dbType: db, schema,
      category: 'PACKAGE BODY', name: row.name, displayName: row.name }));
  }
  const objects: DatabaseObject[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await listObjects({ dbType: db, schema, category: category as ObjectCategory, searchText: '', offset });
    objects.push(...page); if (page.length < 100) return objects;
  }
}
