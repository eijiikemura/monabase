// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GridPaginationModel, GridRowSelectionModel } from '@mui/x-data-grid';
import type { AppSettings } from '@/shared/types/appTypes';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { Condition } from '@/shared/types/queryConditions';
import { getRowIdentity, withRowIdentity } from '@/features/data-grid/rowIdentity';
import { waitForTablePaint } from '@/features/table/useTableOpening';
import { previewImport } from '@/features/table/importData';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { loadTableMetadata, executeTableStatement } from './tableRepository';
import { defaultConditions, tableQuery, updateStatement, insertStatement, deleteStatement, rowReadStatement, type MysqlStatement, type MysqlTableMetadata, type RecordField } from './tableModel';

export interface MysqlTableProps {
  schema: string; table: string; active: boolean; settings: AppSettings; readonly: boolean;
  busy: boolean; disabled: boolean; setBusy: (value: boolean) => void; onState: (state: TransactionState) => void;
  onDropped?: () => void; onOpenCheck?: (name?: string, drop?: boolean) => void; onOpenTrigger?: (name: string, drop?: boolean) => void; onCreateTrigger?: () => void;
}
export function useMysqlTable(props: MysqlTableProps, dataActive: boolean) {
  const { schema, table, active, busy, disabled, readonly, setBusy, onState } = props;
  const { t } = useTranslation();
  const [metadata, setMetadata] = useState<MysqlTableMetadata>();
  const [rows, setRows] = useState<DatabaseRow[]>([]), [error, setError] = useState('');
  const [conditions, setConditions] = useState<Record<string, Condition>>({}), [applied, setApplied] = useState<Record<string, Condition>>({});
  const [pagination, setPagination] = useState<GridPaginationModel>({ page: 0, pageSize: 100 });
  const [selection, setSelection] = useState<GridRowSelectionModel>([]);
  const [total, setTotal] = useState(0), [logs, setLogs] = useState<{ sql: string; error?: string }[]>([]);
  const [metadataDirty, setMetadataDirty] = useState(false);
  const [dirty, setDirty] = useState(true), [loaded, setLoaded] = useState(false);
  const running = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const appendLog = (sql: string, error?: string) => { if (mounted.current) setLogs(previous => [...previous.slice(-99), { sql, error }]); };
  const main = async (statement: MysqlStatement) => {
    try {
      let response;
      try { response = await executeTableStatement(statement); }
      catch (failure) { onState({ transactionStatus: 'unknown' }); throw failure; }
      onState(response);
      if (!response.success) throw new Error(response.error);
      appendLog(statement.sql);
      return response;
    } catch (failure) {
      // Transport failures have no server transaction packet. Never guess it is idle.
      appendLog(statement.sql, failure instanceof Error ? failure.message : t('execution_failed'));
      throw failure;
    }
  };
  const readPage = async (meta: MysqlTableMetadata, filters: Record<string, Condition>, page: GridPaginationModel) => {
    const count = await main(tableQuery(schema, table, meta.columns, filters, page.page, page.pageSize, true));
    if (!mounted.current) return;
    const result = await main(tableQuery(schema, table, meta.columns, filters, page.page, page.pageSize));
    if (!mounted.current) return;
    const exactCount = String(count.rows[0]?.total ?? '');
    if (!/^\d+$/.test(exactCount) || BigInt(exactCount) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(t('mysql_table_count_too_large'));
    setTotal(Number(exactCount));
    setRows(result.rows.map((row, index) => withRowIdentity(row, index)));
    setSelection([]); setDirty(false); setLoaded(true);
  };
  const operation = useEventCallback(async (work: () => Promise<void>, preserveError = false) => {
    if (running.current || busy || disabled) return;
    running.current = true; setBusy(true); if (!preserveError) setError('');
    try { await waitForTablePaint(); if (mounted.current) await work(); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : t('execution_failed');
      if (mounted.current) setError(previous => preserveError && previous ? previous + '\n' + message : message);
    }
    finally { running.current = false; setBusy(false); }
  });
  const initialize = useEventCallback(() => operation(async () => {
    const meta = await loadTableMetadata(schema, table);
    if (!mounted.current) return;
    setMetadata(meta);
    const filters = defaultConditions(meta.columns);
    setConditions(filters); setApplied(filters);
    await readPage(meta, filters, { page: 0, pageSize: 100 });
  }));
  const attempted = useRef(false);
  useEffect(() => { if (active && !busy && !disabled && !attempted.current) { attempted.current = true; void initialize(); } }, [active, busy, disabled, initialize]);
  const refresh = useEventCallback((withData = true) => operation(async () => {
    const meta = await loadTableMetadata(schema, table);
    if (!mounted.current) return;
    setMetadata(meta);
    const defaults = defaultConditions(meta.columns);
    const filters = Object.fromEntries(meta.columns.map(column => [column.COLUMN_NAME, applied[column.COLUMN_NAME] || defaults[column.COLUMN_NAME]]));
    setApplied(filters); setConditions(previous => Object.fromEntries(meta.columns.map(column => [column.COLUMN_NAME, previous[column.COLUMN_NAME] || defaults[column.COLUMN_NAME]])));
    if (withData) await readPage(meta, filters, pagination);
  }));
  useEffect(() => {
    const changed = (event: WindowEventMap['reload-statistics']) => { if (event.detail.schema === schema && event.detail.tableName === table) setMetadataDirty(true); };
    window.addEventListener('reload-statistics', changed);
    return () => window.removeEventListener('reload-statistics', changed);
  }, [schema, table]);
  useEffect(() => { if (metadataDirty && active && !busy && !disabled) { setMetadataDirty(false); void refresh(false); } }, [metadataDirty, active, busy, disabled, refresh]);
  const search = useEventCallback((filters: Record<string, Condition> = conditions) => operation(async () => {
    if (!metadata) { attempted.current = false; throw new Error(t('mysql_table_metadata_retry')); }
    const page = { ...pagination, page: 0 };
    await readPage(metadata, filters, page); setApplied(structuredClone(filters)); setPagination(page);
  }));
  const sortByColumn = useEventCallback((field: string) => {
    if (running.current || busy || disabled || !Object.hasOwn(conditions, field) || conditions[field].type === 'DISABLED') return;
    const current = conditions[field].sort.trim().toUpperCase();
    const next = current === '1' || current === '1 ASC' ? '1 DESC' : '1';
    const filters = Object.fromEntries(Object.entries(conditions).map(([name, condition]) => [name, { ...condition, sort: name === field ? next : '' }]));
    setConditions(filters);
    void search(filters);
  });
  const changePage = useEventCallback((page: GridPaginationModel) => operation(async () => {
    if (!metadata) return;
    const requested = page.pageSize !== pagination.pageSize ? { ...page, page: 0 } : page;
    await readPage(metadata, applied, requested); setPagination(requested);
  }));
  const reloadAfterTransaction = useCallback(() => setDirty(true), []);
  useEffect(() => {
    window.addEventListener('mysql-transaction-finished', reloadAfterTransaction);
    return () => window.removeEventListener('mysql-transaction-finished', reloadAfterTransaction);
  }, [reloadAfterTransaction]);
  const reloadDirty = useEventCallback(() => operation(async () => { setDirty(false); if (metadata) await readPage(metadata, applied, pagination); }, true));
  useEffect(() => { if (active && dataActive && dirty && loaded && !busy && !disabled) void reloadDirty(); }, [active, dataActive, dirty, loaded, busy, disabled, reloadDirty]);
  const write = async (statement: MysqlStatement, expectOne: boolean) => {
    if (readonly) throw new Error(t('read_only_2'));
    const result = await main(statement);
    if (expectOne && result.rowsAffected !== 1) throw new Error(t('mysql_table_row_changed'));
    if (result.notices?.length) setError(result.notices.join('\n') + ' ' + t('mysql_table_write_applied'));
  };
  const saveRecord = useEventCallback((fields: Record<string, RecordField>, original?: DatabaseRow) => {
    let saved = false;
    return operation(async () => {
      if (!metadata) return;
      if (original) {
        const changes = Object.fromEntries(Object.entries(fields).filter(([name, field]) => field.mode !== 'default' && !Object.is(field.mode === 'null' ? null : field.value, original[name])).map(([name, field]) => [name, field.mode === 'null' ? null : field.value]));
        await write(updateStatement(schema, table, metadata, original, changes), true);
      } else await write(insertStatement(schema, table, metadata, fields), true);
      saved = true;
      await readPage(metadata, applied, pagination);
    }).then(() => saved);
  });
  const updateCell = useEventCallback(async (next: DatabaseRow, original: DatabaseRow) => {
    if (running.current || busy || disabled || readonly || !metadata) throw new Error(t('mysql_table_edit_unavailable'));
    running.current = true; setBusy(true); setError('');
    try {
      const changes = Object.fromEntries(metadata.columns.filter(column => !Object.is(next[column.COLUMN_NAME], original[column.COLUMN_NAME])).map(column => [column.COLUMN_NAME, next[column.COLUMN_NAME]]));
      if (!Object.keys(changes).length) return original;
      await write(updateStatement(schema, table, metadata, original, changes), true);
      const fetched = await main(rowReadStatement(schema, table, metadata, original));
      if (fetched.rows.length !== 1) throw new Error(t('mysql_table_write_applied'));
      const updated = withRowIdentity(fetched.rows[0], getRowIdentity(original));
      setRows(previous => previous.map(row => getRowIdentity(row) === getRowIdentity(original) ? updated : row));
      return updated;
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); throw failure; }
    finally { running.current = false; setBusy(false); }
  });
  const deleteRows = useEventCallback((selected: DatabaseRow[]) => operation(async () => {
    if (!metadata || readonly) return;
    let completed = 0;
    try {
      for (const row of selected) { await write(deleteStatement(schema, table, metadata, row), true); completed++; }
    } catch (failure) { throw new Error(t('mysql_table_delete_partial', { count: completed }) + ' ' + (failure instanceof Error ? failure.message : t('execution_failed'))); }
    finally { setDirty(true); }
  }));
  const executeDdl = useEventCallback((statement: MysqlStatement) => {
    let applied = false;
    return operation(async () => {
      if (readonly) throw new Error(t('read_only_2'));
      await main(statement); applied = true;
      if (/^DROP TABLE\s/i.test(statement.sql)) { props.onDropped?.(); return; }
      // Reload within the same guard. A close callback can run before React has
      // rendered busy=false, so starting another guarded operation there loses the refresh.
      try {
        const fresh = await loadTableMetadata(schema, table);
        if (mounted.current) setMetadata(fresh);
      } catch (failure) {
        throw new Error(t('mysql_table_ddl_applied_refresh_failed') + ' ' + (failure instanceof Error ? failure.message : t('execution_failed')));
      }
      // Even failed DDL may commit. Refresh all visible table tabs after the explicit attempt.
    }).finally(() => { window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'INDEX' } })); window.dispatchEvent(new CustomEvent('reload-source', { detail: { schema, tableName: table } })); window.dispatchEvent(new Event('mysql-transaction-finished')); }).then(() => applied);
  });
  const importRows = useEventCallback(async (records: string[][], progress: (percent: number, text: string) => void, header: boolean) => {
    if (running.current || busy || disabled || readonly || !metadata) throw new Error(t('mysql_table_edit_unavailable'));
    const columns = metadata.columns.filter(column => !column.GENERATION_EXPRESSION).map(column => column.COLUMN_NAME);
    const preview = previewImport(records, columns, header, t);
    const statements = records.slice(header ? 1 : 0).map(record => insertStatement(schema, table, metadata, Object.fromEntries(preview.targets.flatMap((name, index) => name ? [[name, { mode: 'value' as const, value: record[index] }]] : []))));
    running.current = true; setBusy(true); setError('');
    let completed = 0;
    try {
      for (const statement of statements) { await write(statement, true); completed++; progress(completed / statements.length * 100, `${completed}/${statements.length}`); }
    } catch (failure) {
      const message = t('mysql_table_import_partial', { count: completed }) + ' ' + (failure instanceof Error ? failure.message : t('execution_failed'));
      setError(message); throw new Error(message);
    } finally { setDirty(true); running.current = false; setBusy(false); }
  });
  return { metadata, rows, error, setError, conditions, setConditions, applied, pagination, total, selection, setSelection, logs, loaded, running,
    refresh, search, sortByColumn, changePage, saveRecord, updateCell, deleteRows, executeDdl, importRows };
}
