// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { splitDefaultExpressions, type ArgumentModes } from '@/features/stored/routineArguments';
import { routineDiagnostics } from '@/features/stored/routineDiagnostics';
import { runGitOperation } from '@/features/git/gitOperation';
import { buildPgTraceProgram } from './traceProgramBuilder';
import { resolvePgRoutine, quotePgIdentifier } from '@/features/postgresql/routineIdentity';
import { pgRoutineInputTypes } from '@/features/postgresql/sqlTokens';
import { createStoredTemplate, parseStoredIdentity, type StoredIdentity, type StoredCreationOptions } from "@/features/stored/storedCreation";
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import type { ReturnValue, TraceSimulator } from "@/shared/types/traceTypes";

import type { Completion } from '@codemirror/autocomplete';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef, useCallback, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { validateArguments, buildFinalArgs, buildArgTypes, buildArgDirections, parseLocalCompletions } from "@/features/stored/storedCommon";
import type { ArgInfo, CompileError } from "@/features/stored/storedCommon";

import { formatDbmsOutputLog } from "@/shared/utils/dateFormatter";
import { ipcRenderer } from '@/shared/api/desktop';

export function useStoredLogic(schema: string, objectName: string, objectType: string, isActive: boolean, simulator: TraceSimulator, inputDateFormat: string, outputDateFormat: string, creation: StoredCreationOptions = {}) {
  const { t } = useTranslation();
  const { parseTraceLogs, clearSimulation, loadSimulation } = simulator;

  // Disable actions from the initial render until all information is loaded.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(!creation.isNew);
  const [isExecuting, setIsExecuting] = useState(false);
  const [routineSignature, setRoutineSignature] = useState<string | undefined>(creation.signature);
  const initialLoadStarted = useRef(Boolean(creation.isNew));
  const [sourceText, setSourceTextState] = useState(() => creation.isNew ? createStoredTemplate('postgresql', schema, objectType) : t("fetching_data"));
  const [savedSourceText, setSavedSourceText] = useState(() => creation.isNew ? createStoredTemplate('postgresql', schema, objectType) : t("fetching_data"));
  
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
  const [, setTargetCompileDate] = useState<string | null>(null);
  
  const [compileErrors, setCompileErrors] = useState<CompileError[]>([]);
  const [localCompletions, setLocalCompletions] = useState<Completion[]>([]);

  const [loadError, setLoadError] = useState('');
  const [, setTriggerDisplaySql] = useState<string>('');

  const loadObjectInfo = useCallback(async (_keepSelection: boolean = false, identity?: StoredIdentity, compiledSource?: string) => {
    const loadSchema = identity?.schema ?? schema;
    const loadName = identity?.objectName ?? objectName;
    const loadType = identity?.objectType ?? objectType;
    const version = ++loadVersion.current, edit = editVersion.current;
    const keepDraft = loadedOnce.current && textRef.current !== savedRef.current;
    readyRef.current = false; setMetadataReady(false); setLoadError('');
    beginLoading();
    try {
      const selected = await resolvePgRoutine(ipcRenderer, { schema: loadSchema, objectName: loadName,
        objectType: loadType as StoredIdentity['objectType'], signature: identity?.signature ?? routineSignature });
      const argRes = await ipcRenderer.invoke<{ data_type: string; proargnames?: string[]; proargmodes?: string[]; pronargs?: number; pronargdefaults?: number; defaults?: string }>('execute-sql-bg',
        `SELECT p.proargnames, p.proargmodes, p.pronargs, p.pronargdefaults, pg_get_expr(p.proargdefaults, 0) AS defaults, format_type(a.oid, null) AS data_type
         FROM pg_proc p CROSS JOIN unnest(COALESCE(p.proallargtypes, p.proargtypes::oid[])) WITH ORDINALITY AS a(oid, pos)
         WHERE p.oid = CAST(:oid AS oid) ORDER BY a.pos`, { oid: selected.oid });
      if (!argRes.success) throw new Error(argRes.error);
      if (typeof selected.ddl !== 'string' || !selected.ddl.trim()) throw new Error(t('failed_to_fetch_source'));
      if (!Array.isArray(argRes.rows) || argRes.rows.some(arg => typeof arg.data_type !== 'string' || !arg.data_type)) throw new Error(t('routine_metadata_required'));
      const names = argRes.rows[0]?.proargnames || [], modes = argRes.rows[0]?.proargmodes || [];
      const defaults = splitDefaultExpressions(argRes.rows[0]?.defaults || '');
      const firstDefault = Number(argRes.rows[0]?.pronargs || 0) - Number(argRes.rows[0]?.pronargdefaults || 0);
      let inputIndex = 0;
      const args: ArgInfo[] = argRes.rows.map((row, idx) => {
        const direction = ['o', 't'].includes(modes[idx]) ? 'OUT' : modes[idx] === 'b' ? 'IN/OUT' : 'IN';
        const defaultValue = direction !== 'OUT' && inputIndex >= firstDefault ? defaults[inputIndex - firstDefault] : undefined;
        if (direction !== 'OUT') inputIndex++;
        return { ARGUMENT_NAME: names[idx] || `ARG${idx + 1}`, DATA_TYPE: row.data_type, IN_OUT: direction,
          POSITION: idx + 1, DEFAULT_LENGTH: 0, DEFAULTED: defaultValue !== undefined ? 'Y' : 'N', DEFAULT_VALUE: defaultValue };
      });
      if (version !== loadVersion.current) return;
      const newSource = compiledSource ?? selected.ddl.trim().replace(/;?\s*$/, ';');
      setRoutineSignature(selected.signature); setObjectValid(true);
      if (edit === editVersion.current && (compiledSource !== undefined || !keepDraft)) setSourceTextState(newSource);
      setSavedSourceText(newSource); setLocalCompletions(parseLocalCompletions(newSource));
      setArgumentsList(args);
      setArgValues(previous => Object.fromEntries(args.filter(arg => arg.POSITION > 0 && arg.ARGUMENT_NAME).map(arg => [arg.ARGUMENT_NAME, previous[arg.ARGUMENT_NAME] ?? ''])));
      setArgumentModes(previous => Object.fromEntries(args.filter(arg => arg.POSITION > 0 && arg.ARGUMENT_NAME).map(arg => [arg.ARGUMENT_NAME,
        previous[arg.ARGUMENT_NAME] === 'default' && arg.DEFAULTED !== 'Y' ? 'value' : previous[arg.ARGUMENT_NAME] || 'value'])));
      loadedOnce.current = true; readyRef.current = true; setMetadataReady(true);
      try {
        const traceDataRes = await ipcRenderer.invoke('get-trace-data', { schema: loadSchema, objectName: loadName, objectType: loadType, signature: selected.signature });
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
  }, [beginLoading, endLoading, schema, objectName, objectType, loadSimulation, routineSignature, t]);

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
      const target = { ...parseStoredIdentity(compiledSnapshot, 'postgresql', schema, objectType), signature: pgRoutineInputTypes(compiledSnapshot) };
      if (target.schema !== schema || (!creation.isNew && target.objectName !== objectName)) throw new Error(t('the_program_schema_or_name_does_not_match_the_target'));
      if (!creation.isNew) {
        const [original, entered] = await Promise.all([
          resolvePgRoutine(ipcRenderer, { schema, objectName, objectType: objectType as StoredIdentity['objectType'], signature: routineSignature }),
          resolvePgRoutine(ipcRenderer, target)
        ]);
        if (original.oid !== entered.oid) throw new Error(t('routine_signature_changed'));
      }
      const res = await ipcRenderer.invoke('execute-sql', compiledSnapshot);

      if (res.success) {
        const compiled = await resolvePgRoutine(ipcRenderer, target);
        target.signature = compiled.signature;
        setRoutineSignature(compiled.signature);
        // Save updated source with Git integration.
        try {
          await runGitOperation(t, 'git-commit', {
            dbType: 'POSTGRES',
            schema: target.schema,
            objectType: target.objectType, // FUNCTION or PROCEDURE.
            objectName: target.objectName,
            signature: target.signature,
            sourceText: compiledSnapshot,
            message: t("update", { value0: target.objectName })
          });
        } catch (e) {
          console.error("Failed to commit to Git.", e);
        }

        clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null);
        setCompileErrors([]); setDbmsOutputs([]); onComplete([], []); 
        alert(t("compilation_successful"));
        window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: target.schema, objType: objectType } }));
        await loadObjectInfo(false, target, compiledSnapshot);
        if (creation.isNew) creation.onCreated?.(target);
      } else {
        const errorText = res.error || '';
        const parsedErrors = routineDiagnostics(compiledSnapshot, { error: errorText, errorPosition: res.errorPosition, errorContext: res.errorContext });
        setCompileErrors(parsedErrors);
        setDbmsOutputs([t("compilation_error"), ...errorText.split('\n').map((e: string) => `[ERROR] ${e}`)]);
        onComplete(parsedErrors, errorText.split('\n'));
        alert(t("an_error_occurred_during_compilation_check_the_displayed_error_details"));
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      setCompileErrors([]);
      setDbmsOutputs([`[ERROR] ${message}`]);
      onComplete([], [message]);
      alert(message);
    } finally { endLoading(); }
  };

  const handleExecute = async (onComplete: (success: boolean, hasReturnValues?: boolean) => void, onValidationError?: () => void) => {
    if (isBusy()) return;
    if (!readyRef.current || !objectValid) { alert(t('routine_metadata_required')); onComplete(false); return; }
    const errorMsg = validateArguments(argumentsList, argValues, argumentModes);
    if (errorMsg) { if(onValidationError) onValidationError(); setTimeout(() => alert(errorMsg), 50); onComplete(false); return; }

    const finalArgs = buildFinalArgs(argumentsList, argValues, argumentModes);
    setIsExecuting(true);
    beginLoading();
    try {
      const timestamp = new Date().toLocaleString('ja-JP');
      const res = await ipcRenderer.invoke('execute-stored', {
        schema, objectName, objectType, signature: routineSignature, args: finalArgs, argumentModes,
        argTypes: buildArgTypes(argumentsList), argDirections: buildArgDirections(argumentsList), inputDateFormat
      });
      if (res.success) {
        const retVals: ReturnValue[] = res.returnValues ?? [];
        setReturnValues(retVals);

        const outputs = [
          t("execution_successful"),
          `[LOG] ${timestamp} ${t("execution_complete")}`
        ];
        if (res.dbmsOutput && res.dbmsOutput.length > 0) {
           outputs.push("");
           outputs.push(t("notice_log"));
           res.dbmsOutput.forEach((n: string) => outputs.push(`[LOG] ${n}`));
        }
        setDbmsOutputs(outputs);

        setCompileErrors([]); onComplete(true, retVals.length > 0);
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

    const finalArgs = buildFinalArgs(argumentsList, argValues, argumentModes);
    const argTypes = buildArgTypes(argumentsList);
    const argDirections = buildArgDirections(argumentsList); 
    beginLoading(); setDbmsOutputs([t("trace_analysis_log")]); setTraceArguments(finalArgs);
    
    let sqlText = '';

    setIsExecuting(true);
    try {
      sqlText = buildPgTraceProgram({ schema, objectType, sourceText, finalArgs, argumentsList, inputDateFormat, t });
      setTriggerDisplaySql(sourceText);
      const res = await ipcRenderer.invoke('execute-trace', { schema, objectName, objectType, signature: routineSignature, sourceText: sqlText, originalSourceText: sourceText, args: finalArgs, argTypes, argDirections, argumentModes, inputDateFormat, skipParse: true });
      if (res.errorCode === 'TRACE_MAIN_TRANSACTION_PENDING' ||
          res.errorCode === 'TRACE_MAIN_CONNECTION_BUSY') {
        setDbmsOutputs([`[ERROR] ${res.error}`]);
        alert(res.error);
        onComplete(false);
        return;
      }
      if (res.success) {
        setReturnValues(res.returnValues ?? []);
        
        if (res.dbmsOutput) {
          const formattedOutputs = res.dbmsOutput.map((line: string) => formatDbmsOutputLog(line, outputDateFormat));
          setDbmsOutputs([
            t("trace_analysis_successful"),
            ...formattedOutputs.map((l: string) => `[LOG] ${l}`),
            "",
            t("auto_generated_debugging_program"),
            res.generatedSource || sqlText
          ]);
        }

        if (res.variablesTrace) parseTraceLogs(res.variablesTrace, autoStart);
        setTraceDateTime(res.traceDate || new Date().toLocaleString('ja-JP')); 
        setTargetCompileDate(res.targetCompileDate || null);
        setCompileErrors([]); 
        
        onComplete(true);
      } else {
        let errorText = res.error || '';
        let genSource = sqlText;
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
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      setDbmsOutputs([`[ERROR] ${message}`]);
      alert(message);
      onComplete(false);
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
    simulator.handleSimulateStep(action);
  };

  const handleDelete = async (tabId: number) => {
    if (isBusy()) return;
    if (window.confirm(t("opening_quote") + objectName + t("this_operation_cannot_be_undone"))) {
      beginLoading();
      try {
        const selected = await resolvePgRoutine(ipcRenderer, { schema, objectName, objectType: objectType as StoredIdentity['objectType'], signature: routineSignature });
        const sqlText = `DROP ${objectType} ${quotePgIdentifier(schema)}.${quotePgIdentifier(objectName)}(${selected.signature})`;
        const res = await ipcRenderer.invoke('execute-sql', sqlText);
        if (res.success) {
          try { await ipcRenderer.invoke('delete-trace-db', { schema, objectName, objectType, signature: routineSignature }); } catch { /* Auxiliary failures must not affect the main operation's result. */  }

          // Delete with Git integration.
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'POSTGRES',
              schema: schema,
              objectType: objectType, // FUNCTION or PROCEDURE.
              objectName: objectName, signature: routineSignature
            });
          } catch (e) {
            console.error("Failed to delete the object from Git.", e);
          }

          alert(t("deleted"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: objectType } }));
          window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: schema, objectName: objectName, objectType: objectType, signature: routineSignature } }));
          window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
        } else {
          alert(t("delete_error_3") + res.error);
        }
      } catch (e: unknown) { alert(t("delete_error_3") + getErrorMessage(e)); } finally { endLoading(); }
    }
  };

  const hasUnsavedChanges = sourceText !== savedSourceText && sourceText !== t("fetching_data");

  return {
    metadataReady, objectValid, argumentModes, setArgumentModes, loadError,
    signature: routineSignature, isLoading, isExecuting, sourceText, setSourceText, argumentsList, argValues, setArgValues,
    returnValues, dbmsOutputs, compileErrors, setCompileErrors, 
    traceArguments, traceDateTime, localCompletions, handleCompile, handleExecute, 
    handleTraceExecute, handleClearLogs, handleSimulationAction, handleDelete, 
    hasUnsavedChanges, loadObjectInfo 
  };
}
