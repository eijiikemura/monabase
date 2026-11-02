// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { type ArgumentModes } from '@/features/stored/routineArguments';
import { runGitOperation } from '@/features/git/gitOperation';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { createStoredTemplate, parseStoredIdentity, type StoredIdentity, type StoredCreationOptions } from "@/features/stored/storedCreation";
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import type { ReturnValue, TraceSimulator } from "@/shared/types/traceTypes";

import type { Completion } from '@codemirror/autocomplete';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef, useCallback, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { validateArguments, buildFinalArgs, buildArgTypes, buildArgDirections, checkAndClearOldTrace, executeCompile, oracleCompileLineOffset, oracleCompileStatement, parseLocalCompletions } from "@/features/stored/storedCommon";
import type { ArgInfo, CompileError } from "@/features/stored/storedCommon";

import { formatDbmsOutputLog } from "@/shared/utils/dateFormatter";
import { ipcRenderer } from '@/shared/api/desktop';

export function useStoredLogic(schema: string, objectName: string, objectType: string, isActive: boolean, simulator: TraceSimulator, inputDateFormat: string, outputDateFormat: string, creation: StoredCreationOptions = {}) {
  const { t } = useTranslation();
  const { parseTraceLogs, clearSimulation, loadSimulation } = simulator;

  // Disable actions from the initial render until all information is loaded.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(!creation.isNew);
  const [isExecuting, setIsExecuting] = useState(false);
  const initialLoadStarted = useRef(Boolean(creation.isNew));
  const [sourceText, setSourceTextState] = useState(() => creation.isNew ? createStoredTemplate('oracle', schema, objectType) : t("fetching_data"));
  const [savedSourceText, setSavedSourceText] = useState(() => creation.isNew ? createStoredTemplate('oracle', schema, objectType) : t("fetching_data"));
  
  const [metadataReady, setMetadataReady] = useState(false);
  const readyRef = useRef(false);
  const [objectValid, setObjectValid] = useState(true);
  const loadVersion = useRef(0), editVersion = useRef(0);
  const loadedOnce = useRef(false);
  const textRef = useRef(sourceText), savedRef = useRef(savedSourceText);
  textRef.current = sourceText; savedRef.current = savedSourceText;
  const setSourceText = useEventCallback((value: SetStateAction<string>) => { editVersion.current++; setSourceTextState(value); });
  const [argumentModes, setArgumentModes] = useState<ArgumentModes>({});
  useEffect(() => {
    initialLoadStarted.current = Boolean(creation.isNew); readyRef.current = false; setMetadataReady(false);
    const generation = loadVersion;
    return () => { generation.current++; };
  }, [schema, objectName, objectType, creation.isNew]);

  const [argumentsList, setArgumentsList] = useState<ArgInfo[]>([]);
  const [argValues, setArgValues] = useState<{ [key: string]: string }>({});
  const [returnValues, setReturnValues] = useState<ReturnValue[]>([]);
  const [dbmsOutputs, setDbmsOutputs] = useState<string[]>([]);
  
  const [traceArguments, setTraceArguments] = useState<Record<string, string | number | null>>({});
  const [traceDateTime, setTraceDateTime] = useState<string | null>(null);
  const [targetCompileDate, setTargetCompileDate] = useState<string | null>(null);
  
  const [compileErrors, setCompileErrors] = useState<CompileError[]>([]);
  const [localCompletions, setLocalCompletions] = useState<Completion[]>([]);
  const [loadError, setLoadError] = useState('');

  const loadObjectInfo = useCallback(async (_keepSelection: boolean = false, identity?: StoredIdentity, compiledSource?: string) => {
    const loadSchema = identity?.schema ?? schema;
    const loadName = identity?.objectName ?? objectName;
    const loadType = identity?.objectType ?? objectType;
    const version = ++loadVersion.current, edit = editVersion.current;
    const keepDraft = loadedOnce.current && textRef.current !== savedRef.current;
    readyRef.current = false; setMetadataReady(false); setLoadError('');
    beginLoading();
    try {
      const binds = { owner: loadSchema, name: loadName, type: loadType };
      const [res, argRes, statusRes] = await Promise.all([
        ipcRenderer.invoke<{ DDL: string }>('execute-sql-bg', 'SELECT DBMS_METADATA.GET_DDL(:type, :name, :owner) AS DDL FROM DUAL', binds),
        ipcRenderer.invoke<ArgInfo>('execute-sql-bg', 'SELECT ARGUMENT_NAME, DATA_TYPE, IN_OUT, POSITION, DEFAULT_LENGTH, DEFAULTED FROM ALL_ARGUMENTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND PACKAGE_NAME IS NULL ORDER BY POSITION', { owner: loadSchema, name: loadName }),
        ipcRenderer.invoke<{ STATUS: string }>('execute-sql-bg', 'SELECT STATUS FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_NAME = :name AND OBJECT_TYPE = :type', binds)
      ]);
      if (!res.success || typeof res.rows?.[0]?.DDL !== 'string' || !res.rows[0].DDL.trim()) throw new Error(!res.success ? res.error : t('failed_to_fetch_source'));
      if (!argRes.success) throw new Error(argRes.error);
      if (!statusRes.success || !statusRes.rows[0]?.STATUS) throw new Error(!statusRes.success ? statusRes.error : t('failed_to_fetch_source'));
      const valid = statusRes.rows[0].STATUS.trim() === 'VALID';
      let diagnostics: CompileError[] = [];
      if (!valid) {
        const errors = await ipcRenderer.invoke<{ LINE: number; POSITION: number; TEXT: string }>('execute-sql-bg', 'SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = :type ORDER BY SEQUENCE', binds);
        if (!errors.success) throw new Error(errors.error);
        diagnostics = errors.rows.map(row => ({ line: row.LINE + oracleCompileLineOffset(compiledSource || res.rows[0].DDL), col: row.POSITION || 1, text: row.TEXT }));
      }
      if (version !== loadVersion.current) return;
      const newSource = compiledSource ?? (res.rows[0].DDL.replace(/\/\s*$/, '').trim() + '\n/');
      const args = argRes.rows;
      if (!Array.isArray(args) || args.some(arg => !Number.isInteger(arg.POSITION) || typeof arg.DATA_TYPE !== 'string' || !arg.DATA_TYPE || (arg.POSITION > 0 && !arg.ARGUMENT_NAME))) throw new Error(t('routine_metadata_required'));
      setObjectValid(valid); setCompileErrors(diagnostics);
      if (diagnostics.length) setDbmsOutputs(diagnostics.map(error => `[ERROR] Line ${error.line}: ${error.text}`));
      if (edit === editVersion.current && (compiledSource !== undefined || !keepDraft)) setSourceTextState(newSource);
      setSavedSourceText(newSource); setLocalCompletions(parseLocalCompletions(newSource));
      setArgumentsList(args);
      setArgValues(previous => Object.fromEntries(args.filter(arg => arg.POSITION > 0 && arg.ARGUMENT_NAME).map(arg => [arg.ARGUMENT_NAME, previous[arg.ARGUMENT_NAME] ?? ''])));
      setArgumentModes(previous => Object.fromEntries(args.filter(arg => arg.POSITION > 0 && arg.ARGUMENT_NAME).map(arg => [arg.ARGUMENT_NAME,
        previous[arg.ARGUMENT_NAME] === 'default' && arg.DEFAULTED !== 'Y' ? 'value' : previous[arg.ARGUMENT_NAME] || 'value'])));
      loadedOnce.current = true; readyRef.current = true; setMetadataReady(true);
      try {
      const traceDataRes = await ipcRenderer.invoke('get-trace-data', { schema: loadSchema, objectName: loadName, objectType: loadType });
      if (version === loadVersion.current && traceDataRes.success && traceDataRes.info) {
        setTraceDateTime(traceDataRes.info.compile_date);
        if (traceDataRes.info.target_compile_date) {
          setTargetCompileDate(traceDataRes.info.target_compile_date);
        }
        if (traceDataRes.info.arguments) {
          const parsedArgs = JSON.parse(traceDataRes.info.arguments);
          setTraceArguments(parsedArgs); 
        }
        if (traceDataRes.steps && traceDataRes.steps.length > 0) loadSimulation(traceDataRes.steps);
      }

      } catch { /* Optional trace history must not invalidate loaded definition and arguments. */ }
    } catch (error: unknown) {
      if (version !== loadVersion.current) return;
      readyRef.current = false; setMetadataReady(false); setLoadError(getErrorMessage(error));
      setDbmsOutputs(previous => [...previous, `[ERROR] ${getErrorMessage(error)}`]);
    } finally { endLoading(); }
  }, [
    beginLoading, endLoading, schema, objectName,
    objectType, t, loadSimulation
  ]);

  useEffect(() => {
    if (creation.isNew || !isActive || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    // Release the initial loading guard after loadObjectInfo completes.
    void loadObjectInfo().finally(endLoading);
  }, [isActive, creation.isNew, loadObjectInfo, endLoading]);

  useEffect(() => {
    const handleSidebarCompileError = (e: WindowEventMap['sidebar-compile-error']) => {
      const { schema: errSchema, objectName: errObjName, objectType: errObjType, errors, logs } = e.detail;
      if (errSchema === schema && errObjName === objectName && errObjType === objectType) {
        setCompileErrors(errors || []);
        setDbmsOutputs(logs || []);
        loadObjectInfo();
      }
    };

    window.addEventListener('sidebar-compile-error', handleSidebarCompileError);
    return () => {
      window.removeEventListener('sidebar-compile-error', handleSidebarCompileError);
    };
  }, [schema, objectName, objectType, loadObjectInfo]);

  const handleCompile = async (onComplete: (errors: CompileError[], output: string[]) => void) => {
    if (isBusy()) return;
    if (!creation.isNew && !readyRef.current) { alert(t('routine_metadata_required')); return; }
    const compiledSnapshot = sourceText;
    beginLoading();
    try {
      const sqlText = oracleCompileStatement(compiledSnapshot);
      const target: StoredIdentity = parseStoredIdentity(sqlText, 'oracle', schema, objectType);
      if (target.schema !== schema || (!creation.isNew && target.objectName !== objectName)) {
        throw new Error(t('the_program_schema_or_name_does_not_match_the_target'));
      }
      const result = creation.isNew ? await (async () => {
        const executed = await ipcRenderer.invoke('execute-sql', sqlText);
        if (!executed.success) return { success: false, isSyntaxError: false, errors: [], messages: [executed.error || t("compilation_failed")] };
        const errorsResult = await ipcRenderer.invoke<{ LINE: number; POSITION: number; TEXT: string }>('execute-sql-bg',
          'SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = :type ORDER BY SEQUENCE',
          { owner: target.schema, name: target.objectName, type: target.objectType });
        if (!errorsResult.success) throw new Error(errorsResult.error || t("failed_to_check_compilation_results"));
        const errors: CompileError[] = (errorsResult.rows || []).map((row: { LINE: number; POSITION: number; TEXT: string }) => ({ line: row.LINE + oracleCompileLineOffset(compiledSnapshot), col: row.POSITION || 1, text: row.TEXT }));
        return { success: errors.length === 0, isSyntaxError: errors.length > 0, errors,
          messages: errors.map(error => `[ERROR] Line ${error.line}: ${error.text}`) };
      })() : await executeCompile(target.schema, target.objectName, sqlText, target.objectType);

      if (result.success) {
        clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null);
        setCompileErrors([]); setDbmsOutputs([]); onComplete([], []); 
        alert(t("compilation_successful"));
        window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: target.schema, objType: target.objectType } }));
        await loadObjectInfo(false, target, compiledSnapshot);
        if (creation.isNew) creation.onCreated?.(target);
      } else {
        if (result.isSyntaxError) {
          setObjectValid(false);
          clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null);
          setCompileErrors(result.errors);
          setDbmsOutputs([t("compilation_error"), ...result.messages]);
          onComplete(result.errors, result.messages);
          alert(t("syntax_errors_occurred_during_compilation_check_the_displayed_error_details"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: target.schema, objType: target.objectType } }));
        } else {
          setDbmsOutputs([t("compilation_error"), ...result.messages]);
          alert(t("an_error_occurred_during_compilation_check_the_displayed_error_details"));
          onComplete([], []);
        }
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      setCompileErrors([{ line: 1, col: 1, text: message }]);
      setDbmsOutputs([`[ERROR] ${message}`]);
      onComplete([{ line: 1, col: 1, text: message }], [message]);
      alert(message);
    } finally { endLoading(); }
  };

  const handleExecute = async (onComplete: (success: boolean, hasReturnValues?: boolean) => void, onValidationError?: () => void) => {
    if (isBusy()) return;
    if (!readyRef.current || !objectValid) { alert(t('routine_metadata_required')); onComplete(false); return; }
    const errorMsg = validateArguments(argumentsList, argValues, argumentModes);
    if (errorMsg) { if(onValidationError) onValidationError(); setTimeout(() => alert(errorMsg), 50); onComplete(false); return; }

    const finalArgs: Record<string, string | number | null> = buildFinalArgs(argumentsList, argValues, argumentModes);
    const argTypes = buildArgTypes(argumentsList);
    const argDirections = buildArgDirections(argumentsList); 


    setIsExecuting(true);
    beginLoading();
    try {
      const res = await ipcRenderer.invoke('execute-stored', { schema, objectName, objectType, args: finalArgs, argTypes, argDirections, argumentModes, inputDateFormat });
      if (res.success) {
        const formattedReturnValues = (res.returnValues || []).map((ret: ReturnValue) => {
          if (typeof ret.value === 'string') {
            return { ...ret, value: formatDbmsOutputLog(ret.value, outputDateFormat) };
          }
          return ret;
        });
        setReturnValues(formattedReturnValues); 

        if (res.dbmsOutput) {
           const formattedOutputs = res.dbmsOutput.map((line: string) => formatDbmsOutputLog(line, outputDateFormat));
           setDbmsOutputs(prev => [...prev, ...formattedOutputs]);
        }
        setCompileErrors([]); onComplete(true, res.returnValues && res.returnValues.length > 0);
      } else {
        const parsedErrors = res.error.split('\n').map((e: string) => { const m = e.match(/(line|行)\s+(\d+)/i); return m ? { line: parseInt(m[2], 10), col: 1, text: e } : null; }).filter(Boolean) as CompileError[];
        setCompileErrors(parsedErrors); setDbmsOutputs([t("execution_error"), ...res.error.split('\n').map((e:string) => `[ERROR] ${e}`)]);
        alert(t("execution_error_occurred_check_the_console_for_details")); onComplete(false);
      }
    } catch (err: unknown) { alert(t("unexpected_error") + getErrorMessage(err)); } finally {
      endLoading();
      setIsExecuting(false);
    }
  };

  const handleTraceExecute = async (autoStart: boolean = false, onComplete: (success: boolean) => void, onValidationError?: () => void) => {
    if (isBusy()) return;
    if (!readyRef.current || !objectValid) { alert(t('routine_metadata_required')); onComplete(false); return; }
    const errorMsg = validateArguments(argumentsList, argValues, argumentModes);
    if (errorMsg) { if(onValidationError) onValidationError(); setTimeout(() => alert(errorMsg), 50); onComplete(false); return; }

    const finalArgs: Record<string, string | number | null> = buildFinalArgs(argumentsList, argValues, argumentModes);
    const argTypes = buildArgTypes(argumentsList);
    const argDirections = buildArgDirections(argumentsList); 


    setIsExecuting(true);
    beginLoading(); setDbmsOutputs([t("trace_analysis_log")]); setTraceArguments(finalArgs);
    
    try {
      const res = await ipcRenderer.invoke('execute-trace', { schema, objectName, objectType, sourceText, args: finalArgs, argTypes, argDirections, argumentModes, inputDateFormat });
      if (res.errorCode === 'TRACE_MAIN_TRANSACTION_PENDING' ||
          res.errorCode === 'TRACE_MAIN_CONNECTION_BUSY') {
        setDbmsOutputs([`[ERROR] ${res.error}`]);
        alert(res.error);
        onComplete(false);
        return;
      }
      if (res.success) {
        const formattedReturnValues = (res.returnValues || []).map((ret: ReturnValue) => {
          if (typeof ret.value === 'string') {
            return { ...ret, value: formatDbmsOutputLog(ret.value, outputDateFormat) };
          }
          return ret;
        });
        setReturnValues(formattedReturnValues); 
        
        if (res.dbmsOutput) {
          const formattedOutputs = res.dbmsOutput.map((line: string) => formatDbmsOutputLog(line, outputDateFormat));

          setDbmsOutputs([
            t("trace_analysis_successful"),
            ...formattedOutputs.map((l: string) => `[LOG] ${l}`),
            "",
            t("auto_generated_debugging_program"),
            res.generatedSource || sourceText
          ]);
        }

        if (res.variablesTrace) parseTraceLogs(res.variablesTrace, autoStart);
        setTraceDateTime(res.traceDate || new Date().toLocaleString('ja-JP')); 
        setTargetCompileDate(res.targetCompileDate || null);
        setCompileErrors([]); 
        
        onComplete(true);
      } else {
        let errorText = res.error || '';
        let genSource = sourceText;
        if (errorText.includes('__GENERATED_SOURCE__')) {
           const parts = errorText.split('__GENERATED_SOURCE__');
           errorText = parts[0].trim();
           genSource = parts[1].trim();
        }

        const parsedErrors = errorText.split('\n').map((e: string) => { const m = e.match(/(line|行)\s+(\d+)/i); return m ? { line: parseInt(m[2], 10), col: 1, text: e } : null; }).filter(Boolean) as CompileError[];
        setCompileErrors(parsedErrors); 
        
        setDbmsOutputs([
          t("trace_analysis_error"),
          ...errorText.split('\n').map((e: string) => `[ERROR] ${e}`),
          "",
          t("auto_generated_debugging_program"),
          genSource
        ]);

        alert(t("error_during_trace_analysis_check_console_for_details"));
        onComplete(false);
      }
    } finally {
      endLoading();
      setIsExecuting(false);
    }
  };

  const handleClearLogs = useCallback(() => {
    if (isBusy()) return;
    setDbmsOutputs([]); clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null); 
  }, [isBusy, clearSimulation]);

  const handleSimulationAction = async (action: 'start' | 'resume' | 'step_over' | 'step_into' | 'step_out' | 'stop') => {
    if (isBusy()) return;
    if (action === 'start') {
      const isValid = await checkAndClearOldTrace(schema, objectName, objectType, targetCompileDate, handleClearLogs);
      if (!isValid) return; 
    }
    simulator.handleSimulateStep(action);
  };

  const handleDelete = async (tabId: number) => {
    if (isBusy()) return;
    if (window.confirm(t("opening_quote") + objectName + t("this_operation_cannot_be_undone"))) {
      beginLoading();
      try {
        const safeSchema = schema ? `${quoteIdentifier(schema)}.` : '';
        const sqlText = `DROP ${objectType} ${safeSchema}${quoteIdentifier(objectName)}`;
        const res = await ipcRenderer.invoke('execute-sql', sqlText);
        if (res.success) {
          
          try {
            await ipcRenderer.invoke('delete-trace-db', { schema, objectName, objectType });
          } catch (e) {
            console.warn(t("failed_to_delete_trace_db_file"), e);
          }

          // Delete with Git integration.
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'ORACLE',
              schema: schema,
              objectType: objectType, // FUNCTION or PROCEDURE.
              objectName: objectName
            });
          } catch (e) {
            console.error("Failed to delete the object from Git.", e);
          }

          alert(t("deleted"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: objectType } }));
          window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: schema, objectName: objectName, objectType: objectType } }));
          window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
        } else {
          alert(t("delete_error_3") + res.error);
        }
      } catch (e: unknown) {
        alert(t("delete_error_3") + getErrorMessage(e));
      } finally {
        endLoading();
      }
    }
  };

  const hasUnsavedChanges = sourceText !== savedSourceText && sourceText !== t("fetching_data");

  return {
    metadataReady, objectValid, argumentModes, setArgumentModes, loadError,
    isLoading, isExecuting, sourceText, setSourceText, argumentsList, argValues, setArgValues,
    returnValues, dbmsOutputs, compileErrors, setCompileErrors, 
    traceArguments, traceDateTime, localCompletions, handleCompile, handleExecute, 
    handleTraceExecute, handleClearLogs, handleSimulationAction, handleDelete, 
    hasUnsavedChanges, loadObjectInfo
  };
}
