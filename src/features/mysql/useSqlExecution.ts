// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { AppSettings } from '@/shared/types/appTypes';
import type { ExplainSnapshot, LogEntry, SqlResultSummary } from '@/shared/types/sqlTypes';
import type { ColumnMetadata, DatabaseRow } from '@/shared/types/databaseTypes';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { findSqlBindNames, splitSqlScript } from '@/features/sql/sqlScript';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { useSqlHistory } from '@/features/sql/useSqlHistory';
import {mysqlErrorLocation,type MysqlEditorError} from './mysqlEditor';
import { withRowIdentity } from '@/features/data-grid/rowIdentity';

export function useSqlExecution({ text, bindText, prepareBinds, prepareSql, schema, editor, settings, busy, disabled, setBusy, onState }: {
  text: string; bindText?: string; prepareBinds?:(source:string)=>Record<string,unknown>; prepareSql?:(source:string)=>string; schema: string; editor: React.RefObject<ReactCodeMirrorRef>; settings: AppSettings;
  busy: boolean; disabled: boolean; setBusy: (value: boolean) => void; onState: (state: TransactionState) => void;
}) {
  const { t } = useTranslation();
  const history = useSqlHistory();
  const [isExplainMode, setIsExplainMode] = useState(false), [privateExecution, setPrivateExecution] = useState(false);
  const [bottomTab, setBottomTab] = useState(0), [logs, setLogs] = useState<LogEntry[]>([]);
  const [rows, setRows] = useState<DatabaseRow[]>([]), [metadata, setMetadata] = useState<ColumnMetadata[]>([]);
  const [isExplainResult, setIsExplainResult] = useState(false), [explainSnapshot, setExplainSnapshot] = useState<ExplainSnapshot | null>(null);
  const [resultSummary, setResultSummary] = useState<SqlResultSummary | null>(null), [error, setError] = useState('');
  const [editorError,setEditorError]=useState<MysqlEditorError|null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const running = useRef<{ id: string; stop: boolean; started: boolean } | null>(null), mounted = useRef(true);
  const observed = useRef<{ key: string; evidence: NonNullable<ExplainSnapshot['observedExecution']> } | null>(null);
  useEffect(() => {
    mounted.current = true;
    const stop = () => { if (running.current) running.current.stop = true; };
    window.addEventListener('cancel-sql-script', stop);
    return () => {
      mounted.current = false; window.removeEventListener('cancel-sql-script', stop);
      if (running.current) { running.current.stop = true; if (running.current.started) void ipcRenderer.invoke('cancel-execution', running.current.id).catch(() => {}); }
    };
  }, []);
  const cancel = async () => {
    const run = running.current;
    if (!run || run.stop) return;
    run.stop = true;
    if (run.started) await ipcRenderer.invoke('cancel-execution', run.id);
  };
  const execute = async () => {
    if (running.current || busy || disabled) return;
    const run = { id: crypto.randomUUID(), stop: false, started: false };
    running.current = run; setBusy(true); setError(''); setEditorError(null); setNotices([]);
    let sensitive = privateExecution;
    try {
      const view = editor.current?.view;
      const selection = view?.state.selection.main;
      const fullSource=view?view.state.doc.toString():text,sourceStart=view&&selection&&!selection.empty?selection.from:0;
      const source = view && selection && !selection.empty ? view.state.sliceDoc(selection.from, selection.to) : text;
      const binds: unknown=prepareBinds?prepareBinds(source):JSON.parse(bindText||'{}');
      if(!binds||typeof binds!=='object'||Array.isArray(binds))throw new Error(t('mysql_bind_json'));
      const statements = splitSqlScript(source, 'mysql');
      if (!statements.length) throw new Error(t('mysql_empty_sql'));
      const privacy = await ipcRenderer.invoke('inspect-sql-privacy', statements.map(item => item.text), 'mysql');
      if (!Array.isArray(privacy) || privacy.length !== statements.length || privacy.some(item => typeof item?.sensitive !== 'boolean')) throw new Error('Invalid SQL privacy response.');
      if (run.stop || !mounted.current) return;
      const begun = await ipcRenderer.invoke('begin-sql-batch', run.id);
      if (!begun.success) throw new Error(begun.error);
      run.started = true;
      let statementStart=0;
      for (let index = 0; index < statements.length && !run.stop && mounted.current; index++) {
        sensitive = privateExecution || privacy[index].sensitive;
        const statement = statements[index].text, time = new Date().toLocaleString();
        const displaySql = sensitive ? t('sql_private_statement_hidden') : statement;
        const executionSql=prepareSql?prepareSql(statement):statement;
        const relativeStart=source.indexOf(statement,statementStart);statementStart=relativeStart+statement.length;
        let response;
        try { response = await ipcRenderer.invoke(isExplainMode ? 'explain-sql' : 'execute-sql', executionSql, binds as Record<string, unknown>, schema, run.id); }
        catch (failure) { onState({ transactionStatus: 'unknown' }); throw failure; }
        if (!mounted.current) return;
        onState(response);
        if (run.stop || response.cancelled) throw new Error(t('sql_script_cancelled'));
        if (!response.success) {
          const message = sensitive ? t('sql_sensitive_error_hidden') : response.error;
          const line=!sensitive&&executionSql.split('\n').length===statement.split('\n').length?mysqlErrorLocation(fullSource,statement,relativeStart<0?-1:sourceStart+relativeStart,response.mysqlErrorLine):null;
          if(line)setEditorError({source:fullSource,line,message});
          setLogs(old => [{ time, sql: displaySql, execTime: '-', resultMsg: message, errorLines: [line?`[ERROR] Line ${line}: ${message}`:message] }, ...old].slice(0, 1000));
          if (!sensitive && settings.sqlHistoryEnabled !== false) void history.addHistory({ executeTime: time, sql: statement, duration: '-', rowCount: null });
          throw new Error(message);
        }
        const resultRows = response.rows.map((row, id) => withRowIdentity({ ...row }, id + 1));
        const count = response.rowsAffected ?? resultRows.length;
        const key = JSON.stringify([executionSql, schema, binds]);
        if (response.metaData.length) {
          setRows(resultRows); setMetadata(response.metaData); setIsExplainResult(isExplainMode);
          setResultSummary({ rowCount: isExplainMode ? null : count, durationMs: response.executionTime, completedAt: time });
          setExplainSnapshot(isExplainMode && !sensitive ? {
            sql: executionSql, schema: response.executionSchema || schema, rows: response.rows.map(row => ({ ...row })),
            planKind: 'estimated', planningDurationMs: response.executionTime,
            binds: Object.entries(binds).filter(([name]) => findSqlBindNames(statement, 'mysql').includes(name.toUpperCase())).map(([name, value]) => ({ name, placeholder: name, type: value === null ? 'NULL' : typeof value, value: value === null ? null : String(value) })),
            ...(observed.current?.key === key ? { observedExecution: observed.current.evidence } : {})
          } : null);
        }
        if (!isExplainMode && !sensitive) observed.current = { key, evidence: { requestDurationMs: response.executionTime, returnedRowCount: resultRows.length, completedAt: time } };
        setLogs(old => [{ time, sql: displaySql, execTime: response.executionTime, resultMsg: isExplainMode ? t('parse_complete') : `${response.command || ''} · ${count} ${t('mysql_rows')}` }, ...old].slice(0, 1000));
        setNotices(response.notices || []); setBottomTab(response.metaData.length ? 0 : 1);
        if (!sensitive && settings.sqlHistoryEnabled !== false) void history.addHistory({ executeTime: time, sql: statement, duration: response.executionTime, rowCount: isExplainMode ? null : count });
        if (!isExplainMode && ['CREATE', 'ALTER', 'DROP', 'RENAME', 'TRUNCATE'].includes(response.command || '')) window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: {} }));
      }
    } catch (failure) {
      if (mounted.current) { setError(sensitive ? t('sql_sensitive_error_hidden') : t(getErrorMessage(failure))); setBottomTab(1); setExplainSnapshot(null); }
    } finally {
      if (run.started) await ipcRenderer.invoke('end-sql-batch', run.id).catch(() => {});
      if (running.current === run) running.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  return { ...history, execute, cancel, executing: Boolean(running.current), isExplainMode, setIsExplainMode, privateExecution, setPrivateExecution,
    editorError, rows, metadata, bottomTab, setBottomTab, logs, setLogs, error, setError, notices, isExplainResult, explainSnapshot, resultSummary };
}
