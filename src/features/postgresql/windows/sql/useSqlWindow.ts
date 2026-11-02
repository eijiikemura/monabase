// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { useSqlExecution } from '@/features/sql/useSqlExecution';
import { findSqlBindNames } from '@/features/sql/sqlScript';
import type { AiContext } from '@/shared/types/aiTypes';

import { getErrorMessage } from "@/shared/utils/errorUtils";
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'sql-formatter';
import { EditorView } from '@codemirror/view'; 

import { savePgSelectSchema, getPgSelectSchema } from '../common/schemaStorage';
import { ipcRenderer } from '@/shared/api/desktop';

export interface CompileError { line: number; col: number; text: string; }
export interface LogEntry { time: string; sql: string; execTime: string | number; resultMsg: string; errorLines?: string[]; }
export interface SqlHistoryEntry { id: string; executeTime: string; sql: string; duration: string | number; rowCount: number | null; }

export interface SqlWindowProps { 
  tabId: number; type: 'sql' | 'table'; title: string; initialSql: string; 
  isActive: boolean; dateFormat: string; dbInfo?: string; inputDateFormat?: string;
  schemas?: string[]; 
  dbName?: string;   
  userName?: string; 
  isAiEnabled?: boolean; 
  onOpenAiSidebar?: (context: AiContext | null) => void;
}

export const useSqlWindow = (props: SqlWindowProps) => {
  const { initialSql, isActive, dateFormat, dbName = '', userName = '' } = props;
  const { t } = useTranslation();

  const [sqlText, setSqlText] = useState<string>(initialSql);
  const [isExplainMode, setIsExplainMode] = useState<boolean>(false);
  
  const [ignoreBindVars, setIgnoreBindVars] = useState<boolean>(false);

  
  const [historyLimit, setHistoryLimit] = useState<number>(100);
  const [localInputDateFormat, setLocalInputDateFormat] = useState<string>(props.inputDateFormat || 'YYYY/MM/DD');
  const editorRef = useRef<ReactCodeMirrorRef>(null);


  const [bindValues, setBindValues] = useState<{ [key: string]: string }>({});
  const [bindTypes, setBindTypes] = useState<{ [key: string]: string }>({});

  const [selectedSchema, setSelectedSchemaState] = useState<string>('');

  useEffect(() => {
    if (props.schemas && props.schemas.length > 0 && userName) {
      const savedSchema = getPgSelectSchema(dbName, userName);
      if (savedSchema && props.schemas.includes(savedSchema)) {
        setSelectedSchemaState(savedSchema);
      }
    }
  }, [props.schemas, dbName, userName]);

  const setSelectedSchema = useCallback((newSchema: string) => {
    setSelectedSchemaState(newSchema);
    if (userName && newSchema) {
      savePgSelectSchema(dbName, userName, newSchema);
    }
  }, [dbName, userName]);

  const execution = useSqlExecution({ dialect: 'postgresql', sqlText, editorRef, bindValues, bindTypes, ignoreBindVars, inputDateFormat: localInputDateFormat, dateFormat, isExplainMode, schema: selectedSchema });
  const { columns, rows, isExplainResult, explainSnapshot, resultSummary, bottomTab, setBottomTab, logs, setLogs, historyLogs, isLoading, setIsLoading, compileErrors, setCompileErrors, clearHistory, handleExecuteSql } = execution;

  const bindVariables = useMemo(() => ignoreBindVars ? [] : findSqlBindNames(sqlText, 'postgresql'), [sqlText, ignoreBindVars]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const settings = await ipcRenderer.invoke('load-settings');
        if (settings) {
          if (settings.sqlHistoryLimit) setHistoryLimit(settings.sqlHistoryLimit);
          if (settings.inputDateFormat) setLocalInputDateFormat(settings.inputDateFormat);
        }
      } catch { /* Auxiliary failures must not affect the main operation's result. */ }

    };
    fetchData();
  }, [t]);

  useEffect(() => {
    if (!isActive) return; 
    const handleInsertText = (e: WindowEventMap['insert-editor-text']) => {
      const textToInsert = e.detail;
      if (!textToInsert) return;
      setSqlText(prev => prev + ((prev && !prev.endsWith(' ') && !prev.endsWith('\n')) ? ' ' : '') + textToInsert);
    };
    window.addEventListener('insert-editor-text', handleInsertText);
    return () => window.removeEventListener('insert-editor-text', handleInsertText);
  }, [isActive]);

  const handleFormatSql = useCallback(() => {
    try { 
      setSqlText(prev => format(prev, { language: 'postgresql', keywordCase: 'upper' })); 
    } catch (e: unknown) {
      notify(t("sql_formatting_failed_error_details") + getErrorMessage(e) + ')');
    }
  }, [t]);

  useEffect(() => {
    if (!isActive) return; 
    const handleKeyDown = (e: KeyboardEvent) => { 
      if (e.key === 'F5') { 
        e.preventDefault(); 
        handleExecuteSql(e); 
      } 
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleExecuteSql]); 

  const handleClearLogs = useCallback(() => { 
    if (window.confirm(t("clear_all_execution_logs"))) {
      setLogs([]); 
      setCompileErrors([]); 
    } 
  }, [t, setLogs, setCompileErrors]);

  const handleClearHistory = useCallback(async () => { 
    if (window.confirm(t("clear_all_execution_history"))) {
      await clearHistory();
    } 
  }, [t, clearHistory]);
  
  const handleConsoleClick = useCallback((lineText: string) => {
    const match = lineText.match(/Line (\d+):/i) || lineText.match(/行\s+(\d+)/i);
    if (match && editorRef.current && editorRef.current.view) {
      const lineNum = parseInt(match[1], 10);
      const view = editorRef.current.view;
      if (lineNum > 0 && lineNum <= view.state.doc.lines) {
        const pos = view.state.doc.line(lineNum).from; 
        view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) }); 
        view.focus(); 
      }
    }
  }, []);

  return {
    resultSummary,
    privateExecution: execution.privateExecution, setPrivateExecution: execution.setPrivateExecution,
    progress: execution.progress, isCancelling: execution.isCancelling, handleCancelSql: execution.handleCancelSql,
    sqlText, setSqlText, columns, rows, isExplainResult, explainSnapshot,
    isExplainMode, setIsExplainMode,
    bottomTab, setBottomTab, logs, historyLogs, historyLimit,
    localInputDateFormat, isLoading, setIsLoading, compileErrors,
    editorRef, bindValues, setBindValues, bindTypes, setBindTypes, bindVariables,
    handleFormatSql, handleExecuteSql, handleClearLogs, handleClearHistory, handleConsoleClick,
    selectedSchema, setSelectedSchema,
    ignoreBindVars, setIgnoreBindVars
  };
};
