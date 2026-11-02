// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import { quoteIdentifier, qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { tokenizeSql } from '@/features/sql/sqlScript';

export interface MviewLogForm {
  targetSchema: string; targetTable: string;
  withPrimaryKey: boolean; withRowid: boolean; withSequence: boolean;
  withCommitScn: boolean; withObjectId: boolean;
  filterColumns: string[]; includingNewValues: boolean;
}
export interface LogColumn { name: string; type: string; eligible: boolean; }
export interface LogMaster {
  id: string; columns: LogColumn[]; primaryKey: boolean; objectTable: boolean; hasLob: boolean;
}
export interface MviewLogMetadata {
  id: string; form: MviewLogForm; logTable: string; source: string; details: Record<string, string>;
}
export const emptyLogForm = (schema: string, table = ''): MviewLogForm => ({
  targetSchema: schema, targetTable: table, withPrimaryKey: true, withRowid: false,
  withSequence: false, withCommitScn: false, withObjectId: false, filterColumns: [], includingNewValues: false
});
export async function logRows<T>(query: string, binds: Record<string, string>) {
  const result = await ipcRenderer.invoke<T>('execute-sql-bg', query, binds);
  if (!result.success || !Array.isArray(result.rows)) throw new Error(result.error || 'mview_log_load_failed');
  return result.rows;
}
export async function readLogMaster(owner: string, tableName: string): Promise<LogMaster> {
  const binds = { owner, tableName };
  const [tables, columns] = await Promise.all([
    logRows<{ ID: string; HAS_PK: number; IS_OBJECT: number }>(`SELECT TO_CHAR(o.OBJECT_ID) AS ID,
      (SELECT COUNT(*) FROM ALL_CONSTRAINTS c WHERE c.OWNER = t.OWNER AND c.TABLE_NAME = t.TABLE_NAME AND c.CONSTRAINT_TYPE = 'P' AND c.STATUS = 'ENABLED') AS HAS_PK,
      (SELECT COUNT(*) FROM ALL_OBJECT_TABLES a WHERE a.OWNER = t.OWNER AND a.TABLE_NAME = t.TABLE_NAME) AS IS_OBJECT
      FROM ALL_TABLES t JOIN ALL_OBJECTS o ON o.OWNER = t.OWNER AND o.OBJECT_NAME = t.TABLE_NAME AND o.OBJECT_TYPE = 'TABLE'
      WHERE t.OWNER = :owner AND t.TABLE_NAME = :tableName`, binds),
    logRows<{ COLUMN_NAME: string; DATA_TYPE: string; DATA_TYPE_OWNER: string | null }>('SELECT COLUMN_NAME, DATA_TYPE, DATA_TYPE_OWNER FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tableName ORDER BY COLUMN_ID', binds)
  ]);
  if (tables.length !== 1 || !columns.length) throw new Error('mview_log_master_missing');
  return { id: tables[0].ID, primaryKey: Number(tables[0].HAS_PK) > 0, objectTable: Number(tables[0].IS_OBJECT) > 0,
    hasLob: columns.some(c => ['BLOB', 'CLOB', 'NCLOB'].includes(c.DATA_TYPE)),
    columns: columns.map(c => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE,
      eligible: !c.DATA_TYPE_OWNER && !['BLOB', 'CLOB', 'NCLOB', 'BFILE', 'LONG', 'LONG RAW'].includes(c.DATA_TYPE) })) };
}

// Read only the top-level WITH column list, never physical log/system columns or storage clauses.
export function logFilterColumns(source: string): string[] {
  const tokens = tokenizeSql(source, 'oracle');
  let depth = 0, withClause = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], word = token.kind === 'word' ? token.text.toUpperCase() : '';
    if (!depth && ['INCLUDING', 'EXCLUDING', 'PURGE', 'FOR'].includes(word) && withClause) break;
    if (!depth && word === 'WITH') { withClause = true; continue; }
    if (token.text === '(') {
      if (!depth && withClause) {
        const columns: string[] = [];
        let expectColumn = true;
        for (let j = i + 1; j < tokens.length; j++) {
          const col = tokens[j];
          if (col.text === ')' && !expectColumn) return columns;
          if (expectColumn && (col.kind === 'word' || col.kind === 'quoted' && col.text.startsWith('"'))) {
            columns.push(col.kind === 'quoted' ? col.text.slice(1, -1).replaceAll('""', '"') : col.text.toUpperCase());
          } else if (expectColumn || col.text !== ',') throw new Error('mview_log_load_failed');
          expectColumn = !expectColumn;
        }
        throw new Error('mview_log_load_failed');
      }
      depth++;
    } else if (token.text === ')') depth--;
  }
  return [];
}
export async function readMviewLog(owner: string, tableName: string): Promise<MviewLogMetadata | null> {
  const records = await logRows<Record<string, unknown>>(`SELECT l.*, TO_CHAR(o.OBJECT_ID) AS LOG_ID,
    TO_CHAR(l.LAST_PURGE_DATE, 'YYYY-MM-DD HH24:MI:SS') AS LAST_PURGE_TEXT,
    TO_CHAR(l.PURGE_START, 'YYYY-MM-DD HH24:MI:SS') AS PURGE_START_TEXT
    FROM ALL_MVIEW_LOGS l JOIN ALL_OBJECTS o ON o.OWNER = l.LOG_OWNER AND o.OBJECT_NAME = l.LOG_TABLE AND o.OBJECT_TYPE = 'TABLE'
    WHERE l.LOG_OWNER = :owner AND l.MASTER = :tableName`, { owner, tableName });
  if (!records.length) return null;
  if (records.length !== 1) throw new Error('mview_log_load_failed');
  const r = records[0];
  const ddl = await logRows<{ DDL: string }>("SELECT DBMS_METADATA.GET_DDL('MATERIALIZED_VIEW_LOG', :logTable, :owner) AS DDL FROM DUAL", { owner, logTable: String(r.LOG_TABLE) });
  if (typeof ddl[0]?.DDL !== 'string' || !ddl[0].DDL.trim()) throw new Error('mview_log_load_failed');
  const source = ddl[0].DDL.trim().replace(/;?$/, ';');
  return { id: String(r.LOG_ID), logTable: String(r.LOG_TABLE), source,
    form: { targetSchema: owner, targetTable: tableName, withPrimaryKey: r.PRIMARY_KEY === 'YES', withRowid: r.ROWIDS === 'YES', withSequence: r.SEQUENCE === 'YES', withCommitScn: r.COMMIT_SCN_BASED === 'YES', withObjectId: r.OBJECT_ID === 'YES', filterColumns: logFilterColumns(source), includingNewValues: r.INCLUDE_NEW_VALUES === 'YES' },
    details: Object.fromEntries(['LOG_OWNER', 'MASTER', 'LOG_TABLE', 'PRIMARY_KEY', 'ROWIDS', 'OBJECT_ID', 'SEQUENCE', 'COMMIT_SCN_BASED', 'INCLUDE_NEW_VALUES', 'PURGE_ASYNCHRONOUS', 'PURGE_DEFERRED', 'PURGE_START_TEXT', 'PURGE_INTERVAL', 'LAST_PURGE_TEXT', 'LAST_PURGE_STATUS', 'NUM_ROWS_PURGED'].map(key => [key, String(r[key] ?? '')])) };
}
const keys = ['withPrimaryKey', 'withRowid', 'withSequence', 'withObjectId'] as const;
const clauses = { withPrimaryKey: 'PRIMARY KEY', withRowid: 'ROWID', withSequence: 'SEQUENCE', withObjectId: 'OBJECT ID' };
export function logValidation(form: MviewLogForm, master: LogMaster | null, baseline?: MviewLogForm): string | null {
  if (!master || !form.targetSchema || !form.targetTable) return 'mview_log_master_missing';
  if (!form.withPrimaryKey && !form.withRowid && !form.withObjectId) return 'mview_log_key_required';
  if (form.withPrimaryKey && !master.primaryKey) return 'mview_log_pk_required';
  if (form.withObjectId && !master.objectTable) return 'mview_log_object_required';
  if (form.withCommitScn && master.hasLob) return 'mview_log_lob_scn';
  if (new Set(form.filterColumns).size !== form.filterColumns.length || form.filterColumns.some(name => !master.columns.some(c => c.name === name && c.eligible))) return 'mview_log_invalid_columns';
  if (baseline && (form.targetSchema !== baseline.targetSchema || form.targetTable !== baseline.targetTable || form.withCommitScn !== baseline.withCommitScn || keys.some(key => baseline[key] && !form[key]) || baseline.filterColumns.some(c => !form.filterColumns.includes(c)))) return 'mview_log_recreate_required';
  return null;
}
export function logSql(form: MviewLogForm, baseline?: MviewLogForm): string {
  const target = qualifiedObjectName({ schema: form.targetSchema, objectName: form.targetTable });
  const additions: string[] = keys.filter(key => form[key] && !baseline?.[key]).map(key => clauses[key]);
  if (!baseline && form.withCommitScn) additions.push('COMMIT SCN');
  const columns = form.filterColumns.filter(c => !baseline?.filterColumns.includes(c));
  const clause = additions.join(', ') + (columns.length ? ` (${columns.map(quoteIdentifier).join(', ')})` : '');
  if (!baseline) return `CREATE MATERIALIZED VIEW LOG ON ${target}\nWITH ${clause}\n${form.includingNewValues ? 'INCLUDING' : 'EXCLUDING'} NEW VALUES;`;
  const change = [clause ? 'ADD ' + clause : '', form.includingNewValues !== baseline.includingNewValues ? `${form.includingNewValues ? 'INCLUDING' : 'EXCLUDING'} NEW VALUES` : ''].filter(Boolean);
  return change.length ? `ALTER MATERIALIZED VIEW LOG ON ${target}\n${change.join('\n')};` : '';
}
export function sameLog(a: MviewLogMetadata, b: MviewLogMetadata): boolean {
  // DML can allocate deferred storage and change native DDL without changing recording settings.
  // Purge counters and physical allocation must not create false conflicts after normal use.
  return a.id === b.id && a.logTable === b.logTable && JSON.stringify({ ...a.form, filterColumns: [...a.form.filterColumns].sort() }) === JSON.stringify({ ...b.form, filterColumns: [...b.form.filterColumns].sort() });
}
