// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { ipcRenderer } from '@/shared/api/desktop';
import type { DatabaseRow, OracleIndexStatistics, PgIndexStatistics } from '@/shared/types/databaseTypes';

export interface IndexConstraint {
  name: string; kind: string; schema: string; table: string; references: number;
}
export interface IndexDetails {
  ddl: string; tableSchema: string; table: string; keys: string[]; expression: string;
  unique: boolean; primary: boolean; bitmap: boolean; reverse: boolean; visible: boolean;
  constraints: IndexConstraint[]; statistics: (OracleIndexStatistics & PgIndexStatistics) | null;
}
async function rows<T = DatabaseRow>(sql: string, binds: Record<string, string>) {
  const result = await ipcRenderer.invoke<T>('execute-sql-bg', sql, binds);
  if (!result.success || !Array.isArray(result.rows)) throw new Error('Index metadata could not be retrieved.');
  return result.rows;
}
export async function loadIndexDetails(database: 'oracle' | 'postgresql', schema: string, name: string): Promise<IndexDetails> {
  const binds = { schema, name };
  if (database === 'postgresql') {
    const metadata = await rows<{ table_schema: string; table_name: string; ddl: string; indisunique: boolean; expression: string | null }>(`
      SELECT tn.nspname AS table_schema, t.relname AS table_name, i.indisunique,
        pg_get_indexdef(i.indexrelid) AS ddl, pg_get_expr(i.indexprs, i.indrelid) AS expression
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_namespace n ON n.oid = ic.relnamespace
      JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
      WHERE n.nspname = :schema AND ic.relname = :name`, binds);
    const row = metadata[0];
    if (!row?.ddl || !row.table_name || !row.table_schema) throw new Error('Index definition is unavailable.');
    const [keys, constraints, statistics] = await Promise.all([
      rows<{ column_name: string | null; key_expression: string }>(`
        SELECT a.attname AS column_name, pg_get_indexdef(i.indexrelid, pos.n, true) AS key_expression
        FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_namespace n ON n.oid = ic.relnamespace
        CROSS JOIN LATERAL generate_series(1, i.indnkeyatts) pos(n)
        LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[pos.n - 1]
        WHERE n.nspname = :schema AND ic.relname = :name ORDER BY pos.n`, binds),
      rows<{ constraint_name: string; kind: string; references: string | number }>(`
        SELECT con.conname AS constraint_name, con.contype AS kind,
          (SELECT COUNT(*) FROM pg_constraint ref WHERE ref.contype = 'f' AND ref.conindid = con.conindid) AS "references"
        FROM pg_constraint con JOIN pg_class ic ON ic.oid = con.conindid JOIN pg_namespace n ON n.oid = ic.relnamespace
        WHERE n.nspname = :schema AND ic.relname = :name AND con.contype IN ('p', 'u', 'x') ORDER BY con.conname`, binds),
      rows<PgIndexStatistics>(`SELECT s.idx_scan, s.idx_tup_read, s.idx_tup_fetch,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size, io.idx_blks_read, io.idx_blks_hit,
        st.last_analyze, st.last_autoanalyze, st.last_vacuum, st.last_autovacuum
        FROM pg_stat_user_indexes s LEFT JOIN pg_statio_user_indexes io ON s.indexrelid = io.indexrelid
        LEFT JOIN pg_stat_user_tables st ON s.relid = st.relid WHERE s.schemaname = :schema AND s.indexrelname = :name`, binds)
    ]);
    if (!keys.length) throw new Error('Index keys are unavailable.');
    return { ddl: row.ddl, tableSchema: row.table_schema, table: row.table_name,
      keys: keys.map(key => key.column_name || key.key_expression), expression: row.expression || '',
      unique: row.indisunique, primary: constraints.some(c => c.kind === 'p'), bitmap: false, reverse: false, visible: true,
      constraints: constraints.map(c => ({ name: c.constraint_name, kind: c.kind, schema: row.table_schema, table: row.table_name, references: Number(c.references) })), statistics: statistics[0] || null };
  }
  const metadata = await rows<{ TABLE_OWNER: string; TABLE_NAME: string; INDEX_TYPE: string; UNIQUENESS: string; VISIBILITY: string }>(
    `SELECT TABLE_OWNER, TABLE_NAME, INDEX_TYPE, UNIQUENESS, VISIBILITY FROM ALL_INDEXES WHERE OWNER = :schema AND INDEX_NAME = :name`, binds);
  const row = metadata[0];
  if (!row?.TABLE_NAME || !row.TABLE_OWNER) throw new Error('Index definition is unavailable.');
  const [ddl, keys, expressions, constraints, statistics] = await Promise.all([
    rows<{ DDL: string }>(`SELECT DBMS_METADATA.GET_DDL('INDEX', :name, :schema) AS DDL FROM DUAL`, binds),
    rows<{ COLUMN_NAME: string }>(`SELECT COLUMN_NAME FROM ALL_IND_COLUMNS WHERE INDEX_OWNER = :schema AND INDEX_NAME = :name ORDER BY COLUMN_POSITION`, binds),
    rows<{ COLUMN_EXPRESSION: string }>(`SELECT COLUMN_EXPRESSION FROM ALL_IND_EXPRESSIONS WHERE INDEX_OWNER = :schema AND INDEX_NAME = :name ORDER BY COLUMN_POSITION`, binds),
    rows<{ CONSTRAINT_NAME: string; CONSTRAINT_TYPE: string; OWNER: string; TABLE_NAME: string; REFERENCE_COUNT: number }>(`
      SELECT c.CONSTRAINT_NAME, c.CONSTRAINT_TYPE, c.OWNER, c.TABLE_NAME,
        (SELECT COUNT(*) FROM ALL_CONSTRAINTS r WHERE r.CONSTRAINT_TYPE = 'R' AND r.R_OWNER = c.OWNER AND r.R_CONSTRAINT_NAME = c.CONSTRAINT_NAME) AS REFERENCE_COUNT
      FROM ALL_CONSTRAINTS c WHERE c.INDEX_OWNER = :schema AND c.INDEX_NAME = :name AND c.CONSTRAINT_TYPE IN ('P','U') ORDER BY c.CONSTRAINT_NAME`, binds),
    rows<OracleIndexStatistics>(`SELECT BLEVEL, LEAF_BLOCKS, DISTINCT_KEYS, NUM_ROWS, SAMPLE_SIZE,
      TO_CHAR(LAST_ANALYZED, 'YYYY-MM-DD HH24:MI:SS') AS LAST_ANALYZED FROM ALL_INDEXES WHERE OWNER = :schema AND INDEX_NAME = :name`, binds)
  ]);
  if (!ddl[0]?.DDL?.trim() || !keys.length) throw new Error('Index definition is incomplete.');
  return { ddl: ddl[0].DDL, tableSchema: row.TABLE_OWNER, table: row.TABLE_NAME, keys: keys.map(key => key.COLUMN_NAME),
    expression: expressions.map(value => value.COLUMN_EXPRESSION).join(', '), unique: row.UNIQUENESS === 'UNIQUE',
    primary: constraints.some(c => c.CONSTRAINT_TYPE === 'P'), bitmap: row.INDEX_TYPE.includes('BITMAP'), reverse: row.INDEX_TYPE.includes('/REV'), visible: row.VISIBILITY !== 'INVISIBLE',
    constraints: constraints.map(c => ({ name: c.CONSTRAINT_NAME, kind: c.CONSTRAINT_TYPE, schema: c.OWNER, table: c.TABLE_NAME, references: Number(c.REFERENCE_COUNT) })), statistics: statistics[0] || null };
}

export function indexDropPlan(database: 'oracle' | 'postgresql', schema: string, name: string, details: IndexDetails) {
  for (const constraint of details.constraints) {
    if (!constraint.name || !constraint.schema || !constraint.table || !Number.isSafeInteger(constraint.references) || constraint.references < 0) throw new Error('Index dependencies are incomplete.');
  }
  if (details.constraints.length > 1) return { blocked: 'index_multiple_constraints', sql: '', constraint: null };
  const constraint = details.constraints[0] || null;
  if (constraint && database === 'oracle') return { blocked: 'index_oracle_constraint_blocked', sql: '', constraint };
  if (constraint?.references) return { blocked: 'index_references_blocked', sql: '', constraint };
  return { blocked: '', constraint, sql: constraint
    ? `ALTER TABLE ${quoteIdentifier(constraint.schema)}.${quoteIdentifier(constraint.table)} DROP CONSTRAINT ${quoteIdentifier(constraint.name)}`
    : `DROP INDEX ${quoteIdentifier(schema)}.${quoteIdentifier(name)}` };
}
