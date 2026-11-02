// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';
import type { GridColDef } from '@mui/x-data-grid';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { ExplainSnapshot, LogEntry, SqlResultSummary } from '@/shared/types/sqlTypes';
import { ipcRenderer } from '@/shared/api/desktop';
import { buildGridColumns } from '@/features/data-grid/dataGridHelper';
import { withRowIdentity } from '@/features/data-grid/rowIdentity';
import { splitSqlScript, findSqlBindNames, type SqlDialect } from '@/features/sql/sqlScript';
import { prepareSqlStatement, parseDdlAction } from '@/features/sql/sqlExecutionPlan';
import { useSqlHistory } from '@/features/sql/useSqlHistory';
import { getErrorMessage } from '@/shared/utils/errorUtils';

export interface SqlCompileError { line: number; col: number; text: string }
interface StatementOutcome {
  columns: GridColDef[];
  rows: DatabaseRow[];
  status: 'success' | 'error' | 'cancelled';
  errors: SqlCompileError[];
  explain: ExplainSnapshot | null;
  isExplain: boolean;
  summary?: SqlResultSummary;
}
interface Options {
  dialect: SqlDialect;
  sqlText: string;
  editorRef: React.RefObject<ReactCodeMirrorRef>;
  bindValues: Record<string, string>;
  bindTypes: Record<string, string>;
  ignoreBindVars: boolean;
  inputDateFormat: string;
  dateFormat: string;
  isExplainMode: boolean;
  schema?: string;
}
export function useSqlExecution(options: Options) {
  const { t } = useTranslation();
  const history = useSqlHistory();
  const [privateExecution, setPrivateExecution] = useState(false);
  const [columns, setColumns] = useState<GridColDef[]>([]), [rows, setRows] = useState<DatabaseRow[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]), [bottomTab, setBottomTab] = useState(0);
  const [compileErrors, setCompileErrors] = useState<SqlCompileError[]>([]);
  const [isLoading, setIsLoading] = useState(false), [isExplainResult, setIsExplainResult] = useState(false);
  const [resultSummary, setResultSummary] = useState<SqlResultSummary | null>(null);
  const [explainSnapshot, setExplainSnapshot] = useState<ExplainSnapshot | null>(null);
  const lastObservedExecution = useRef<{ key: string; observation: NonNullable<ExplainSnapshot['observedExecution']> } | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 }), [isCancelling, setIsCancelling] = useState(false);
  const mounted = useRef(true), run = useRef<{ id: string; stop: boolean; started: boolean } | null>(null);
  useEffect(() => {
    mounted.current = true;
    const running = run;
    const stop = () => { if (running.current) { running.current.stop = true; setIsCancelling(true); } };
    window.addEventListener('cancel-sql-script', stop);
    return () => {
      mounted.current = false;
      window.removeEventListener('cancel-sql-script', stop);
      if (running.current) {
        running.current.stop = true;
        if (running.current.started) void ipcRenderer.invoke('cancel-execution', running.current.id).catch(() => {});
      }
    };
  }, []);
  const show = useCallback((result: StatementOutcome) => {
    setCompileErrors(result.errors);
    setExplainSnapshot(result.explain);
    // Keep only the latest successful row result, even if later statements fail or return no rows.
    if (result.status === 'success' && result.columns.length) {
      setColumns(result.columns); setRows(result.rows);
      setIsExplainResult(result.isExplain);
      setResultSummary(result.summary || null);
    }
    setBottomTab(result.status === 'success' && result.columns.length ? 0 : 1);
  }, []);
  const handleCancelSql = async () => {
    const current = run.current;
    if (!current || current.stop) return;
    current.stop = true; setIsCancelling(true);
    if (!current.started) return;
    try {
      const response = await ipcRenderer.invoke('cancel-execution', current.id);
      if (!response.success && mounted.current) notify(t('sql_cancel_failed', { error: response.error }));
    } catch { if (mounted.current) notify(t('sql_cancel_failed', { error: '' })); }
  };
  const handleExecuteSql = useCallback(async (event?: React.SyntheticEvent | KeyboardEvent) => {
    event?.stopPropagation(); event?.preventDefault();
    if (run.current) return;
    const { dialect, editorRef, bindValues, bindTypes, inputDateFormat, dateFormat, isExplainMode, ignoreBindVars, schema } = options;
    if (dialect === 'postgresql' && !schema) { notify(t('execution_schema_required')); return; }
    let target = options.sqlText, startOffset = 0;
    const view = editorRef.current?.view;
    if (view && !view.state.selection.main.empty) {
      const selection = view.state.selection.main;
      target = view.state.sliceDoc(selection.from, selection.to);
      startOffset = view.state.doc.lineAt(selection.from).number - 1;
    }
    const statements = splitSqlScript(target, dialect);
    if (!statements.length) return;
    let prepared;
    try { prepared = statements.map(statement => prepareSqlStatement(statement.text, dialect, bindValues, bindTypes, inputDateFormat, ignoreBindVars)); }
    catch { notify(t('sql_invalid_bind')); return; }
    const current = { id: crypto.randomUUID(), stop: false, started: false };
    run.current = current; setIsLoading(true); setIsCancelling(false); setProgress({ current: 0, total: statements.length });
    window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: true }));
    try {
      const privacy = await ipcRenderer.invoke('inspect-sql-privacy', statements.map(statement => statement.text), dialect);
      if (!Array.isArray(privacy) || privacy.length !== statements.length || privacy.some(item =>
        !item || typeof item.sensitive !== 'boolean' || typeof item.command !== 'string')) throw new Error('Invalid SQL privacy response.');
      if (current.stop || !mounted.current) return;
      const begun = await ipcRenderer.invoke('begin-sql-batch', current.id);
      if (!begun.success) throw new Error(begun.error);
      current.started = true;
      for (let index = 0; index < statements.length; index++) {
        if (current.stop || !mounted.current) break;
        setProgress({ current: index + 1, total: statements.length });
        window.dispatchEvent(new CustomEvent('sql-script-progress', { detail: { current: index + 1, total: statements.length } }));
        const statement = statements[index], request = prepared[index];
        const sensitive = privateExecution || privacy[index].sensitive;
        const displaySql = privateExecution ? t('sql_private_statement_hidden') : sensitive ? t('sql_sensitive_statement_hidden', { command: privacy[index].command }) : statement.text;
        let result: StatementOutcome;
        const time = new Date().toLocaleString();
        try {
          const response = await ipcRenderer.invoke(isExplainMode ? 'explain-sql' : 'execute-sql', request.sql, request.binds, schema || null, current.id);
          if (!mounted.current) break;
          const cancelled = current.stop || response.cancelled === true;
          if (cancelled) current.stop = true;
          if (response.success && !cancelled) {
            const executionKey = JSON.stringify([request.sql, response.executionSchema || schema, request.binds]);
            const observed = lastObservedExecution.current;
            if (!isExplainMode && !sensitive) lastObservedExecution.current = { key: executionKey, observation: {
              requestDurationMs: typeof response.executionTime === 'number' && Number.isFinite(response.executionTime) ? response.executionTime : null,
              returnedRowCount: response.rows?.length || 0, completedAt: time
            } };
            const metadata = response.metaData?.length ? response.metaData : Object.keys(response.rows?.[0] || {}).map(name => ({ name }));
            // PostgreSQL values stay exact in rows; only the display follows the selected format.
            const columns = buildGridColumns(metadata, dateFormat, {}, { preserveDetails: dialect !== 'postgresql' });
            const rows = (response.rows || []).map((row, index) => withRowIdentity({ ...row }, index + 1));
            result = { isExplain: isExplainMode, columns, rows, status: 'success', errors: [],
              summary: { rowCount: isExplainMode ? null : rows.length, completedAt: time,
                durationMs: typeof response.executionTime === 'number' && Number.isFinite(response.executionTime) && response.executionTime >= 0 ? response.executionTime : null },
              explain: isExplainMode && !sensitive ? { sql: request.sql, schema: response.executionSchema || schema, rows: rows.map(row => ({ ...row })),
                planKind: 'estimated', planningDurationMs: response.executionTime,
                binds: ignoreBindVars ? [] : findSqlBindNames(statement.text, dialect).map((name, index) => ({ name, placeholder: `mb_input_${index}`, type: bindTypes[name] || 'STRING', value: request.binds[`mb_input_${index}`] ?? null })),
                ...(observed?.key === executionKey ? { observedExecution: observed.observation } : {}) } : null };
            const affected = ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY', 'MOVE'].includes(response.command || '') || (!columns.length && response.rowsAffected !== undefined);
            const rowCount = isExplainMode ? null : affected ? (response.rowsAffected ?? null) : columns.length ? rows.length : null;
            const resultMsg = isExplainMode ? t('parse_complete') : affected ? `${response.rowsAffected ?? 0}${t('row_processed')}` :
              columns.length ? `${rows.length}${t('row_fetched')}` : t('sql_statement_complete');
            setLogs(old => [{ time, sql: displaySql, execTime: response.executionTime, resultMsg }, ...old]);
            if (!sensitive) void history.addHistory({ executeTime: time, sql: displaySql, duration: response.executionTime, rowCount });
            if (!isExplainMode) {
              const ddl = parseDdlAction(statement.text, dialect);
              if (ddl?.objType === 'SCHEMA') window.dispatchEvent(new CustomEvent('refresh-schemas'));
              else if (ddl) window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { ...ddl, schema: ddl.schema || schema } }));
            }
          } else {
            const message = cancelled ? t('sql_script_cancelled') : sensitive ? t('sql_sensitive_error_hidden') : response.error || t('error_occurred');
            const errors: SqlCompileError[] = [];
            const lines = message.split('\n').map(text => {
              const line = text.match(/(?:line|行)\s+(\d+)/i);
              if (line) {
                const number = Number(line[1]) + startOffset + statement.lineOffset;
                errors.push({ line: number, col: 1, text }); return `[ERROR] Line ${number}: ${text}`;
              }
              return `[ERROR] ${text}`;
            });
            result = { isExplain: isExplainMode, columns: [], rows: [], status: cancelled ? 'cancelled' : 'error', errors, explain: null };
            setLogs(old => [{ time, sql: displaySql, execTime: '-', resultMsg: message, errorLines: lines }, ...old]);
            if (!sensitive) void history.addHistory({ executeTime: time, sql: displaySql, duration: '-', rowCount: null });
            if (!cancelled) notify(t('sql_statement_failed', { number: index + 1, error: message }));
          }
        } catch (error: unknown) {
          if (!mounted.current) break;
          const message = current.stop ? t('sql_script_cancelled') : sensitive ? t('sql_sensitive_error_hidden') : getErrorMessage(error);
          result = { isExplain: isExplainMode, columns: [], rows: [], status: current.stop ? 'cancelled' : 'error', errors: [], explain: null };
          setLogs(old => [{ time, sql: displaySql, execTime: '-', resultMsg: message, errorLines: [`[ERROR] ${message}`] }, ...old]);
          if (!current.stop) notify(t('sql_statement_failed', { number: index + 1, error: message }));
        }
        show(result);
        if (result.status !== 'success') break;
      }
    } catch (error: unknown) { if (mounted.current && !current.stop) notify(t('sql_statement_failed', { number: 1, error: getErrorMessage(error) })); }
    finally {
      if (current.started) await ipcRenderer.invoke('end-sql-batch', current.id).catch(() => {});
      if (run.current === current) run.current = null;
      if (mounted.current) { setIsLoading(false); setIsCancelling(false); }
      window.dispatchEvent(new CustomEvent('sql-script-progress', { detail: null }));
      window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: false }));
    }
  }, [options, t, show, history, privateExecution]);
  return { columns, rows, logs, setLogs, bottomTab, setBottomTab, compileErrors, setCompileErrors, isLoading, setIsLoading,
    privateExecution, setPrivateExecution,
    isExplainResult, explainSnapshot, resultSummary, progress, isCancelling, handleCancelSql, handleExecuteSql,
    historyLogs: history.historyLogs, clearHistory: history.clearHistory };
}
