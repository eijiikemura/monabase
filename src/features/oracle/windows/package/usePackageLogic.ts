// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { loadPackagePrograms, loadPackageArguments, loadPackageStatus, packageScalarType, type PackageProgram, type PackageStatus } from '@/features/stored/packageMetadata';
import type { ArgumentModes } from '@/features/stored/routineArguments';
import { oracleCompileLineOffset } from '@/features/stored/storedCommon';
import { runGitOperation } from '@/features/git/gitOperation';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import type { TraceSimulator, ReturnValue } from "@/shared/types/traceTypes";
import type { Completion } from '@codemirror/autocomplete';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { validateArguments, buildFinalArgs, buildArgTypes, buildArgDirections, checkAndClearOldTrace, parseLocalCompletions } from "@/features/stored/storedCommon";
import type { ArgInfo, CompileError } from "@/features/stored/storedCommon";
import { createPackageTemplate, compilePackageSource, loadPackageSource, type PackageCreationOptions, type PackageIdentity } from "@/features/stored/packageCreation";

import { ipcRenderer } from '@/shared/api/desktop';

export function usePackageLogic(schema: string, objectName: string, objectType: PackageIdentity['objectType'], isActive: boolean, simulator: TraceSimulator, inputDateFormat: string, creation: PackageCreationOptions = {}) {
  const { t } = useTranslation();
  const { parseTraceLogs, clearSimulation, loadSimulation } = simulator;

  // Disable actions from the initial render until all information is loaded.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(!creation.isNew);
  const [isExecuting, setIsExecuting] = useState(false);
  const initialLoadingReserved = useRef(!creation.isNew);
  const initialLoadStarted = useRef(false);
  const [sourceText, setSourceTextState] = useState(() => creation.isNew ? createPackageTemplate(schema, objectType) : t("fetching_data"));
  const editVersion = useRef(0), definitionRequest = useRef(0), definitionReady = useRef(false), loadedOnce = useRef(false);
  const sourceRef = useRef(sourceText); sourceRef.current = sourceText;
  const savedRef = useRef(sourceText);
  const setSourceText = useCallback((next: string) => { editVersion.current++; setSourceTextState(next); }, []);
  const [metadataReady, setMetadataReady] = useState(false), [objectValid, setObjectValid] = useState(false);
  const [definitionLoadError, setDefinitionLoadError] = useState('');
  const [statuses, setStatuses] = useState<PackageStatus[]>([]);
  const [argumentModes, setArgumentModes] = useState<ArgumentModes>({});
  const [savedSourceText, setSavedSourceText] = useState(() => sourceText);
  
  const [argumentsList, setArgumentsList] = useState<ArgInfo[]>([]);
  const [argValues, setArgValues] = useState<{ [key: string]: string }>({});
  const [returnValues, setReturnValues] = useState<ReturnValue[]>([]);
  const [dbmsOutputs, setDbmsOutputs] = useState<string[]>([]);
  
  const [traceArguments, setTraceArguments] = useState<Record<string, string | number | null>>({});
  const [traceDateTime, setTraceDateTime] = useState<string | null>(null);
  const [targetCompileDate, setTargetCompileDate] = useState<string | null>(null);
  
  const [compileErrors, setCompileErrors] = useState<CompileError[]>([]);
  const [localCompletions, setLocalCompletions] = useState<Completion[]>([]);

  const [subPrograms, setSubPrograms] = useState<PackageProgram[]>([]);
  const programsRef = useRef<PackageProgram[]>([]);
  const [selectedSubProgram, setSelectedSubProgramState] = useState<string>('');
  const selectedSubProgramRef = useRef('');
  const argumentRequest = useRef(0);
  const readyArguments = useRef<string | null>(null);
  const [loadedArgumentTarget, setLoadedArgumentTarget] = useState<string | null>(null);
  const [argumentLoadError, setArgumentLoadError] = useState('');
  const invalidateArguments = useCallback(() => {
    argumentRequest.current++;
    readyArguments.current = null;
  }, []);
  const setSelectedSubProgram = useCallback((next: string) => {
    if (next !== selectedSubProgramRef.current) {
      invalidateArguments();
      setLoadedArgumentTarget(null);
      setArgumentLoadError('');
      setArgumentsList([]);
      setArgValues({});
      setArgumentModes({});
      clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null); setReturnValues([]);
    }
    selectedSubProgramRef.current = next;
    setSelectedSubProgramState(next);
  }, [invalidateArguments, clearSimulation]);
  useEffect(() => () => { invalidateArguments(); definitionRequest.current++; definitionReady.current = false; }, [schema, objectName, objectType, invalidateArguments]);

  const loadArguments = useEventCallback(async (key?: string) => {
    const program = programsRef.current.find(item => item.key === key);
    if (!program) return;
    invalidateArguments();
    const request = argumentRequest.current;
    const target = JSON.stringify([schema, objectName, key]);
    setLoadedArgumentTarget(null); setArgumentLoadError(''); beginLoading();
    try {
      const rows = await loadPackageArguments(schema, objectName, program.PROCEDURE_NAME, program.SUBPROGRAM_ID);
      if (request !== argumentRequest.current || key !== selectedSubProgramRef.current) return;
      if (rows.some(row => !Number.isInteger(row.POSITION) || !row.DATA_TYPE || (row.POSITION > 0 && !row.ARGUMENT_NAME))) throw new Error(t('package_arguments_unavailable'));
      setArgumentsList(rows);
      if (rows.some(row => !packageScalarType(row.DATA_TYPE) || row.TYPE_NAME)) throw new Error(t('package_unsupported_argument'));
      setArgValues(previous => Object.fromEntries(rows.filter(row => row.POSITION > 0).map(row => [row.ARGUMENT_NAME, previous[row.ARGUMENT_NAME] ?? ''])));
      readyArguments.current = target; setLoadedArgumentTarget(target);
    } catch (error: unknown) {
      if (request !== argumentRequest.current || key !== selectedSubProgramRef.current) return;
      setArgumentLoadError(getErrorMessage(error));
      setDbmsOutputs(previous => [...previous, `[ERROR] ${getErrorMessage(error)}`]);
    } finally { endLoading(); }
  });

  const loadObjectInfo = useEventCallback(async (keepSelection: boolean = false, compiledSource?: string) => {
    const request = ++definitionRequest.current, edit = editVersion.current;
    const dirty = loadedOnce.current && sourceRef.current !== savedRef.current;
    const currentSelected = selectedSubProgramRef.current;
    definitionReady.current = false; setMetadataReady(false); setDefinitionLoadError('');
    invalidateArguments(); setLoadedArgumentTarget(null); beginLoading();
    try {
      const [newSource, programs, status] = await Promise.all([
        loadPackageSource(schema, objectName, objectType), loadPackagePrograms(schema, objectName), loadPackageStatus(schema, objectName)
      ]);
      if (request !== definitionRequest.current) return;
      if (!status.some(row => row.OBJECT_TYPE === objectType) || !status.some(row => row.OBJECT_TYPE === 'PACKAGE')) throw new Error(t('package_reload_required'));
      const diagnostics = await ipcRenderer.invoke<{ LINE: number; POSITION: number; TEXT: string; ATTRIBUTE?: string }>('execute-sql-bg',
        'SELECT LINE, POSITION, TEXT, ATTRIBUTE FROM ALL_ERRORS WHERE OWNER = :owner AND NAME = :name AND TYPE = :type ORDER BY SEQUENCE', { owner: schema, name: objectName, type: objectType });
      if (!diagnostics.success || !Array.isArray(diagnostics.rows)) throw new Error(diagnostics.error || t('package_reload_required'));
      if (request !== definitionRequest.current) return;
      if (edit === editVersion.current && (!dirty || compiledSource !== undefined)) setSourceTextState(newSource);
      savedRef.current = newSource; setSavedSourceText(newSource); loadedOnce.current = true;
      setLocalCompletions(parseLocalCompletions(newSource));
      setStatuses(status); setObjectValid(status.filter(row => objectType === 'PACKAGE BODY' || row.OBJECT_TYPE === 'PACKAGE').every(row => row.STATUS === 'VALID'));
      const errors = diagnostics.rows.filter(row => row.ATTRIBUTE !== 'WARNING').map(row => ({ line: row.LINE + oracleCompileLineOffset(compiledSource ?? newSource), col: row.POSITION || 1, text: row.TEXT }));
      setCompileErrors(errors);
      if (diagnostics.rows.length) setDbmsOutputs(diagnostics.rows.map(row => `[${row.ATTRIBUTE === 'WARNING' ? 'WARNING' : 'ERROR'}] Line ${row.LINE}: ${row.TEXT}`));
      programsRef.current = programs; setSubPrograms(programs);
      definitionReady.current = true; setMetadataReady(true);
      const selected = keepSelection && programs.some(program => program.key === currentSelected) ? currentSelected : programs[0]?.key || '';
      setSelectedSubProgram(selected);
      if (selected) await loadArguments(selected);
      // Trace history is optional and cannot make valid definition metadata unusable.
      try {
        const trace = await ipcRenderer.invoke('get-trace-data', { schema, objectName, objectType: 'PACKAGE' });
        if (request !== definitionRequest.current) return;
        const chosen = programs.find(program => program.key === selected);
        if (trace.success && trace.info && chosen && trace.info.sub_program === chosen.PROCEDURE_NAME && programs.filter(program => program.PROCEDURE_NAME === chosen.PROCEDURE_NAME).length === 1) {
          setTraceDateTime(trace.info.compile_date); setTargetCompileDate(trace.info.target_compile_date || null);
          if (trace.info.arguments) setTraceArguments(JSON.parse(trace.info.arguments));
          if (trace.steps?.length) loadSimulation(trace.steps);
        }
      } catch (error) { if (request === definitionRequest.current) setDbmsOutputs(previous => [...previous, `[ERROR] ${getErrorMessage(error)}`]); }
    } catch (error: unknown) {
      if (request !== definitionRequest.current) return;
      setDefinitionLoadError(getErrorMessage(error)); setDbmsOutputs(previous => [...previous, `[ERROR] ${getErrorMessage(error)}`]);
    } finally { endLoading(); }
  });

  useEffect(() => {
    if (creation.isNew || !isActive || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    // Release the initial loading guard after loadObjectInfo completes.
    void loadObjectInfo().finally(() => {
      if (initialLoadingReserved.current) {
        initialLoadingReserved.current = false;
        endLoading();
      }
    });
  }, [creation.isNew, isActive, loadObjectInfo, endLoading]);

  const handleCompile = async (onComplete: (errors: CompileError[], output: string[]) => void) => {
    if (isBusy()) return;
    if (!creation.isNew && !definitionReady.current) { alert(t('package_reload_required')); return; }
    const compiledSource = sourceText;
    beginLoading();
    try {
      const result = await compilePackageSource(schema, objectName, objectType, compiledSource, Boolean(creation.isNew));

      if (result.success) {
        clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null);
        setCompileErrors([]); setDbmsOutputs(result.messages); onComplete([], result.messages);
        alert(t("compilation_successful"));
        window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: result.identity.schema, objType: objectType } }));
        if (creation.isNew) {
          setSavedSourceText(sourceText);
          creation.onCreated?.(result.identity);
        } else {
          await loadObjectInfo(true, compiledSource);
        }
      } else {
        if (result.isSyntaxError) {
          setObjectValid(false);
          clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null);
          setCompileErrors(result.errors);
          setDbmsOutputs([t("compilation_error"), ...result.messages]);
          onComplete(result.errors, result.messages);
          alert(t("syntax_error_during_compilation_check_the_console_for_details"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: objectType } }));
        } else {
          setDbmsOutputs([t("compilation_error"), ...result.messages]);
          alert(t("compilation_error_occurred_check_the_console_for_details"));
          onComplete([], []);
        }
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      setDbmsOutputs([t("compilation_error"), `[ERROR] ${message}`]);
      onComplete([], [message]);
      alert(t("compilation_failed") + '\n' + message);
    } finally { endLoading(); }
  };

  const handleExecute = async (onComplete: (success: boolean, hasReturnValues?: boolean) => void, onValidationError?: () => void) => {
    if (creation.isNew || isBusy()) return;
    if (!definitionReady.current || !objectValid || !selectedSubProgram || readyArguments.current !== JSON.stringify([schema, objectName, selectedSubProgram])) { onComplete(false); return; }
    const errorMsg = validateArguments(argumentsList, argValues, argumentModes);
    if (errorMsg) { if(onValidationError) onValidationError(); setTimeout(() => alert(errorMsg), 50); onComplete(false); return; }

    const isFunction = argumentsList.some(a => a.POSITION === 0);
    const finalArgs: Record<string, string | number | null> = buildFinalArgs(argumentsList, argValues, argumentModes);
    const argTypes = buildArgTypes(argumentsList);
    const argDirections = buildArgDirections(argumentsList); 


    const program = subPrograms.find(item => item.key === selectedSubProgram)!;
    setIsExecuting(true);
    beginLoading();
    try {
      const res = await ipcRenderer.invoke('execute-stored', { 
        schema, objectName, subProgram: program.PROCEDURE_NAME, subProgramId: program.SUBPROGRAM_ID, argumentModes, objectType: 'PACKAGE',
        args: finalArgs, argTypes, argDirections, inputDateFormat, isSubProgramFunction: isFunction 
      });
      if (res.success) {
        setReturnValues(res.returnValues || []); if (res.dbmsOutput) setDbmsOutputs(prev => [...prev, ...(res.dbmsOutput || [])]);
        setCompileErrors([]); onComplete(true, res.returnValues && res.returnValues.length > 0);
      } else {
        const parsedErrors = res.error.split('\n').map((e: string) => { const m = e.match(/(line|行)\s+(\d+)/i); return m ? { line: parseInt(m[2], 10), col: 1, text: e } : null; }).filter(Boolean) as CompileError[];
        setCompileErrors(parsedErrors); setDbmsOutputs([t("execution_error"), ...res.error.split('\n').map((e:string) => `[ERROR] ${e}`)]);
        alert(t("execution_error_occurred_check_the_console_for_details")); onComplete(false);
      }
    } catch (err: unknown) { alert(t("unexpected_error") + getErrorMessage(err)); onComplete(false); } finally {
      endLoading();
      setIsExecuting(false);
    }
  };

  const handleTraceExecute = async (autoStart: boolean = false, onComplete: (success: boolean) => void, onValidationError?: () => void) => {
    if (creation.isNew || isBusy()) return;
    if (!definitionReady.current || !objectValid || !selectedSubProgram || readyArguments.current !== JSON.stringify([schema, objectName, selectedSubProgram])) { onComplete(false); return; }
    if (sourceText !== savedSourceText) { alert(t('package_trace_compile_first')); onComplete(false); return; }
    const program = subPrograms.find(item => item.key === selectedSubProgram)!;
    const errorMsg = validateArguments(argumentsList, argValues, argumentModes);
    if (errorMsg) { if(onValidationError) onValidationError(); setTimeout(() => alert(errorMsg), 50); onComplete(false); return; }

    const isFunction = argumentsList.some(a => a.POSITION === 0);
    const finalArgs: Record<string, string | number | null> = buildFinalArgs(argumentsList, argValues, argumentModes);
    const argTypes = buildArgTypes(argumentsList);
    const argDirections = buildArgDirections(argumentsList); 


    setIsExecuting(true);
    beginLoading(); setDbmsOutputs([t("trace_analysis_log")]); setTraceArguments(finalArgs);

    try {
      const res = await ipcRenderer.invoke('execute-trace', { 
        schema, objectName, objectType, sourceText, args: finalArgs, argTypes, argDirections, inputDateFormat,
        subProgram: program.PROCEDURE_NAME, subProgramId: program.SUBPROGRAM_ID, argumentModes, isSubProgramFunction: isFunction
      });
      if (res.errorCode === 'TRACE_MAIN_TRANSACTION_PENDING' ||
          res.errorCode === 'TRACE_MAIN_CONNECTION_BUSY') {
        setDbmsOutputs([`[ERROR] ${res.error}`]);
        alert(res.error);
        onComplete(false);
        return;
      }
      
      if (res.success) {
        setReturnValues(res.returnValues || []); 
        
        if (res.dbmsOutput) {
          setDbmsOutputs([
            t("trace_analysis_successful"),
            ...res.dbmsOutput.map((l: string) => `[LOG] ${l}`),
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
    } catch (err: unknown) { alert(t("unexpected_error") + getErrorMessage(err)); onComplete(false); } finally {
      endLoading();
      setIsExecuting(false);
    }
  };

  const handleClearLogs = useCallback(() => {
    if (isBusy()) return;
    setDbmsOutputs([]); clearSimulation(); setTraceDateTime(null); setTargetCompileDate(null);
  }, [isBusy, clearSimulation]);

  const handleSimulationAction = async (action: 'start' | 'resume' | 'step_over' | 'step_into' | 'step_out' | 'stop') => {
    if (creation.isNew || isBusy()) return;
    if (action === 'start') {
      const isValid = await checkAndClearOldTrace(schema, objectName, objectType, targetCompileDate, handleClearLogs);
      if (!isValid) return; 
    }
    simulator.handleSimulateStep(action);
  };

  const handleDelete = async (tabId: number) => {
    if (creation.isNew || isBusy()) return;
    if (window.confirm(t("opening_quote") + objectName + t("this_operation_cannot_be_undone"))) {
      beginLoading();
      try {
        const safeSchema = schema ? `${quoteIdentifier(schema)}.` : '';
        const sqlText = `DROP ${objectType} ${safeSchema}${quoteIdentifier(objectName)}`;
        const res = await ipcRenderer.invoke('execute-sql', sqlText);
        if (res.success) {
          
          try {
            await ipcRenderer.invoke('delete-trace-db', { schema, objectName, objectType: 'PACKAGE' });
          } catch (e) {
            console.warn(t("failed_to_delete_trace_db_file"), e);
          }

          // Delete with Git integration.
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'ORACLE',
              schema: schema,
              objectType: objectType, // PACKAGE or PACKAGE BODY.
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
    isLoading, isExecuting, sourceText, setSourceText, argumentsList, argValues, setArgValues,
    returnValues, dbmsOutputs, compileErrors, setCompileErrors, traceArguments, traceDateTime, 
    localCompletions, subPrograms, selectedSubProgram, setSelectedSubProgram, loadArguments,
    metadataReady, objectValid, definitionLoadError, statuses, argumentModes, setArgumentModes,
    selectedSubProgramName: subPrograms.find(program => program.key === selectedSubProgram)?.PROCEDURE_NAME || '',
    argumentLoadError, canExecuteSubProgram: metadataReady && objectValid && Boolean(selectedSubProgram) && loadedArgumentTarget === JSON.stringify([schema, objectName, selectedSubProgram]),
    handleCompile, handleExecute, handleTraceExecute, handleClearLogs, handleSimulationAction, 
    handleDelete, hasUnsavedChanges, loadObjectInfo 
  };
}
