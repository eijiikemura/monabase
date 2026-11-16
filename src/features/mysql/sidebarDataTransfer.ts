// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { Condition } from '@/shared/types/queryConditions';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { TransactionState } from '@/shared/api/desktopContract';
import { buildGridColumns, getFormattedValue } from '@/features/data-grid/dataGridHelper';
import { previewImport } from '@/features/table/importData';
import type { TFunction } from 'i18next';
import type { ExportDataFetcher } from '@/features/table/exportSnapshot';
import { loadTableMetadata } from './table/tableRepository';
import { insertStatement, isGenerated, mysqlTableName, primaryColumns, quoteMysql, tableQuery, type MysqlTableMetadata } from './table/tableModel';

export async function mainTransferQuery(sql: string, binds: Record<string, unknown>, onState: (state: TransactionState) => void, schema?: string) {
  let result;
  try { result = schema ? await ipcRenderer.invoke('execute-sql', sql, binds, schema) : await ipcRenderer.invoke('execute-sql', sql, binds); }
  catch (failure) { onState({ transactionStatus: 'unknown' }); throw failure; }
  onState(result);
  if (!result.success) throw new Error(result.error);
  return result;
}
export async function prepareMysqlTransfer(schema: string, table: string, format: string) {
  const metadata = await loadTableMetadata(schema, table);
  const descriptors = metadata.columns.map(column => ({ name: column.COLUMN_NAME, dbTypeName: column.DATA_TYPE === 'datetime' ? 'TIMESTAMP' : column.DATA_TYPE.toUpperCase() }));
  return { metadata, columns: buildGridColumns(descriptors, format, {}, { preserveDetails: false }), formatRows: (rows: DatabaseRow[]) => rows.map(row => Object.fromEntries(descriptors.map(column => [column.name,
    row[column.name] === null ? null : /^(DATE|TIMESTAMP)$/.test(column.dbTypeName) ? getFormattedValue(row[column.name], column, format, { preserveDetails: false }) : row[column.name]
  ]))) };
}

// One main-session SELECT materializes the export. Never mix pages from different snapshots.
// The MySQL driver's 10,000-row/16-MiB limit fails explicitly; it never exports a truncated result.
export function createMysqlSidebarExport(schema: string, table: string, metadata: MysqlTableMetadata, formatRows: (rows: DatabaseRow[]) => DatabaseRow[], onState: (state: TransactionState) => void, setBusy: (busy: boolean) => void, conditions?: Record<string, Condition>): ExportDataFetcher {
  let snapshot: Promise<DatabaseRow[]> | undefined;
  const fetch: ExportDataFetcher = async (offset, limit) => {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5000) throw new Error('Invalid export range.');
    if (!snapshot) snapshot = (async () => {
      setBusy(true);
      try {
        const keys = primaryColumns(metadata.columns);
        const filtered = conditions ? tableQuery(schema, table, metadata.columns, conditions, 0, 100) : undefined;
        const sql = filtered ? filtered.sql.replace(/ LIMIT 100 OFFSET 0$/, '') : `SELECT ${metadata.columns.map(column => quoteMysql(column.COLUMN_NAME)).join(', ')} FROM ${mysqlTableName(schema, table)}` + (keys.length ? ' ORDER BY ' + keys.map(column => quoteMysql(column.COLUMN_NAME)).join(', ') : '');
        return formatRows((await mainTransferQuery(sql, filtered?.binds || {}, onState)).rows);
      } finally { setBusy(false); }
    })();
    return (await snapshot).slice(offset, offset + limit);
  };
  fetch.close = async () => { try { await snapshot; } finally { snapshot = undefined; } };
  return fetch;
}
export async function importMysqlSidebarRows(schema: string, table: string, metadata: MysqlTableMetadata, records: string[][], header: boolean, progress: (percent: number, text: string) => void, onState: (state: TransactionState) => void, t: TFunction) {
  const columns = metadata.columns.filter(column => !isGenerated(column)).map(column => column.COLUMN_NAME);
  const preview = previewImport(records, columns, header, t);
  const statements = records.slice(header ? 1 : 0).map(record => insertStatement(schema, table, metadata, Object.fromEntries(preview.targets.flatMap((name, index) => name ? [[name, { mode: 'value' as const, value: record[index] }]] : []))));
  let completed = 0;
  try {
    for (const statement of statements) {
      const result = await mainTransferQuery(statement.sql, statement.binds, onState);
      if (result.rowsAffected !== 1) throw new Error(t('import_count_unconfirmed'));
      completed++;
      if (result.notices?.length) throw new Error(result.notices.join('\n'));
      progress(completed / statements.length * 100, `${completed}/${statements.length}`);
    }
  } catch (failure) { throw new Error(t('mysql_table_import_partial', { count: completed }) + ' ' + (failure instanceof Error ? failure.message : t('execution_failed'))); }
}
