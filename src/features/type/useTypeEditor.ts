// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { runGitOperation } from '@/features/git/gitOperation';
import { readOracleType, oracleTypeStatement, oracleTypeDiagnostics, type OracleTypeDiagnostic } from '@/features/oracle/typeDefinition';
import { parsePostgresType, planPostgresTypeChanges, postgresTypeSource, readPostgresType, PostgresTypeError } from '@/features/postgresql/typeDefinition';
import { postgresTypeDiagnostics } from './typeDiagnostics';

export interface TypeEditorProps { tabId: number; schema: string; typeName: string; isActive: boolean; }
export interface TypeChangePlan { source: string; statements: string[]; completed: number; failed: boolean; error: string; }
export function useTypeEditor(database: 'oracle' | 'postgresql', props: TypeEditorProps) {
  const { schema, typeName, tabId, isActive } = props;
  const { t } = useTranslation();
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const [sourceText, setSource] = useState(''), [savedSourceText, setSavedSource] = useState('');
  const [sourceError, setSourceError] = useState(''), [sourceReady, setSourceReady] = useState(false);
  const [compileErrors, setCompileErrors] = useState<OracleTypeDiagnostic[]>([]), [dbmsOutputs, setDbmsOutputs] = useState<string[]>([]);
  const [bottomTab, setBottomTab] = useState(1), [mainTab, setMainTab] = useState(0), [hasOpenedVersionTab, setOpenedVersionTab] = useState(false);
  const [changePlan, setChangePlan] = useState<TypeChangePlan | null>(null);
  const version = useRef(0), edits = useRef(0), loaded = useRef(false), ready = useRef(false), started = useRef(false);
  const sourceRef = useRef(sourceText), savedRef = useRef(savedSourceText);
  sourceRef.current = sourceText; savedRef.current = savedSourceText;
  const setSourceText = useEventCallback((update: React.SetStateAction<string>) => { edits.current++; setSource(update); });
  const setTab = useEventCallback((value: number) => { setMainTab(value); if (value === 1) setOpenedVersionTab(true); });
  const errorMessage = useEventCallback((error: unknown) => {
    if (error instanceof PostgresTypeError) {
      const keys = { definition_invalid: 'postgres_type_definition_invalid', unsupported_change: 'postgres_type_change_unsupported', identity_change: 'postgres_type_identity_change_unsupported', metadata_unavailable: 'postgres_type_metadata_unavailable', unsupported_kind: 'postgres_type_kind_unsupported' };
      return t(keys[error.code]);
    }
    const text = getErrorMessage(error);
    return text === 'type_definition_invalid' || text === 'type_identity_mismatch' ? t(text) : text;
  });
  const read = useEventCallback(async () => database === 'oracle' ? readOracleType(schema, typeName) : {
    source: postgresTypeSource(await readPostgresType(schema, typeName)), diagnostics: [] as OracleTypeDiagnostic[]
  });
  const loadObjectInfo = useEventCallback(async () => {
    const request = ++version.current, edit = edits.current, dirty = loaded.current && sourceRef.current !== savedRef.current;
    ready.current = false; setSourceReady(false); setSourceError(''); beginLoading();
    try {
      const result = await read();
      if (request !== version.current) return;
      setSavedSource(result.source); savedRef.current = result.source;
      if (edits.current === edit && !dirty) setSource(result.source);
      setCompileErrors(result.diagnostics); loaded.current = true; ready.current = true; setSourceReady(true);
      if (result.diagnostics.length) { setDbmsOutputs(result.diagnostics.map(item => `[${item.severity.toUpperCase()}] ${item.kind} Line ${item.line}, Col ${item.col}: ${item.text}`)); setBottomTab(1); }
    } catch (cause) {
      if (request !== version.current) return;
      const message = errorMessage(cause); setSourceError(message); setDbmsOutputs(previous => [...previous, `[ERROR] ${message}`]); setBottomTab(1);
    } finally { endLoading(); }
  });
  useEffect(() => {
    version.current++; loaded.current = false; ready.current = false; started.current = false;
    setSource(''); setSavedSource(''); setSourceReady(false); setSourceError(''); setCompileErrors([]); setChangePlan(null);
    const request = version;
    return () => { request.current++; };
  }, [database, schema, typeName]);
  useEffect(() => { if (isActive && !started.current) { started.current = true; void loadObjectInfo(); } }, [isActive, database, schema, typeName, loadObjectInfo]);
  const refreshSidebar = () => window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'TYPE' } }));
  const recordSaved = useEventCallback(async (snapshot: string, saved: string) => {
    setSavedSource(saved); savedRef.current = saved;
    setSource(previous => previous === snapshot ? saved : previous);
    const result = await runGitOperation(t, 'git-commit', { dbType: database === 'oracle' ? 'ORACLE' : 'POSTGRES', schema, objectType: 'TYPE', objectName: typeName, sourceText: saved, message: t('update_type', { value0: typeName }) });
    if (!result.success) { setDbmsOutputs(previous => [...previous, `[ERROR] ${result.error}`]); alert(t('postgres_type_saved_git_failed', { error: result.error })); }
    else alert(t(database === 'oracle' ? 'compilation_successful' : 'save_compile_successful'));
    refreshSidebar();
  });
  const fail = (cause: unknown) => { const message = errorMessage(cause); setDbmsOutputs([t('compilation_error'), `[ERROR] ${message}`]); setBottomTab(1); alert(t(database === 'oracle' ? 'type_save_failed' : 'postgres_type_save_failed', { error: message })); };
  const handleCompile = useEventCallback(async () => {
    if (isBusy()) return;
    if (!ready.current) { alert(sourceError || t('type_metadata_required')); return; }
    const snapshot = sourceRef.current;
    beginLoading(); let ddlSucceeded = false;
    try {
      if (database === 'oracle') {
        const statement = oracleTypeStatement(snapshot, schema, typeName);
        const executed = await ipcRenderer.invoke('execute-sql', statement);
        if (!executed.success) throw new Error(executed.error);
        ddlSucceeded = true; refreshSidebar();
        // Validate native diagnostics/status before saving a successful definition to Git.
        const diagnostics = await oracleTypeDiagnostics(schema, typeName, 'TYPE', snapshot);
        setCompileErrors(diagnostics); setDbmsOutputs(diagnostics.map(item => `[${item.severity.toUpperCase()}] TYPE Line ${item.line}, Col ${item.col}: ${item.text}`)); setBottomTab(1);
        if (diagnostics.some(item => item.severity === 'error')) { alert(t('syntax_error_during_compilation_check_the_console_for_details')); return; }
        const result = await readOracleType(schema, typeName);
        if (result.diagnostics.some(item => item.severity === 'error') || !result.status.some(item => item.OBJECT_TYPE === 'TYPE' && item.STATUS === 'VALID')) throw new Error(t('type_invalid_status'));
        setCompileErrors(sourceRef.current === snapshot ? result.diagnostics : []);
        await recordSaved(snapshot, result.source);
      } else {
        const desired = parsePostgresType(snapshot, schema), current = await readPostgresType(schema, typeName);
        const statements = planPostgresTypeChanges(current, desired);
        if (statements.length) setChangePlan({ source: snapshot, statements, completed: 0, failed: false, error: '' });
        else { setCompileErrors([]); setDbmsOutputs([t('execution_successful')]); await recordSaved(snapshot, postgresTypeSource(current)); }
      }
    } catch (cause) {
      if (ddlSucceeded) { ready.current = false; setSourceReady(false); setSourceError(errorMessage(cause)); }
      fail(cause);
    }
    finally { endLoading(); }
  });
  const handleConfirmCompile = useEventCallback(async () => {
    if (isBusy() || !changePlan || changePlan.failed || !ready.current) return;
    if (changePlan.source !== sourceRef.current) { setChangePlan(null); alert(t('type_preview_changed')); return; }
    const plan = changePlan;
    beginLoading(); let completed = 0;
    try {
      const current = await readPostgresType(schema, typeName);
      const actual = planPostgresTypeChanges(current, parsePostgresType(plan.source, schema));
      if (JSON.stringify(actual) !== JSON.stringify(plan.statements)) {
        setChangePlan({ ...plan, statements: actual, completed: 0 }); alert(t('type_preview_changed')); return;
      }
      for (const statement of plan.statements) {
        const result = await ipcRenderer.invoke('execute-sql', statement);
        if (!result.success) {
          setCompileErrors(postgresTypeDiagnostics(plan.source, statement, result).map(item => ({ ...item, kind: 'TYPE', severity: 'error' })));
          throw new Error(result.error);
        }
        completed++; setChangePlan({ ...plan, completed });
      }
      const saved = postgresTypeSource(await readPostgresType(schema, typeName));
      setCompileErrors([]); setDbmsOutputs([t('execution_successful')]); setBottomTab(1); setChangePlan(null);
      await recordSaved(plan.source, saved);
    } catch (cause) {
      const message = errorMessage(cause);
      setChangePlan({ ...plan, completed, failed: true, error: message });
      setDbmsOutputs([t('type_partial_result', { completed, total: plan.statements.length }), `[ERROR] ${message}`]); setBottomTab(1);
      // Keep the requested draft; refresh only its saved baseline after partial DDL success.
      try { const current = await readPostgresType(schema, typeName); const saved = postgresTypeSource(current); setSavedSource(saved); savedRef.current = saved; }
      catch (readError) { ready.current = false; setSourceReady(false); setSourceError(errorMessage(readError)); }
      refreshSidebar();
    } finally { endLoading(); }
  });
  const closeChangePlan = useEventCallback(() => { if (!isBusy()) setChangePlan(null); });
  const retryChangePlan = useEventCallback(async () => { if (isBusy()) return; setChangePlan(null); await handleCompile(); });
  const handleDelete = useEventCallback(async () => {
    if (isBusy() || !ready.current) return;
    if (!window.confirm(t('type_3') + typeName + t('this_operation_cannot_be_undone_2'))) return;
    beginLoading();
    try {
      const result = await ipcRenderer.invoke('execute-sql', `DROP TYPE ${qualifiedObjectName({ schema, objectName: typeName })}${database === 'postgresql' ? ' RESTRICT' : ''}`);
      if (!result.success) throw new Error(result.error);
      await runGitOperation(t, 'git-delete-object', { dbType: database === 'oracle' ? 'ORACLE' : 'POSTGRES', schema, objectType: 'TYPE', objectName: typeName });
      refreshSidebar(); window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema, objectName: typeName, objectType: 'TYPE' } }));
      window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } })); alert(t('deleted'));
    } catch (cause) { alert(t('delete_error_3') + errorMessage(cause)); }
    finally { endLoading(); }
  });
  const handleClearLogs = useEventCallback(() => { if (!isBusy()) setDbmsOutputs([]); });
  return { isLoading, sourceText, setSourceText, sourceError, sourceReady, compileErrors, dbmsOutputs, bottomTab, setBottomTab, mainTab, setMainTab: setTab, hasOpenedVersionTab,
    hasUnsavedChanges: sourceText !== savedSourceText, changePlan, handleCompile, handleConfirmCompile, closeChangePlan, retryChangePlan, handleDelete, handleClearLogs, loadObjectInfo };
}
