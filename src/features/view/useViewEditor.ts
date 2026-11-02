// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useEditableSource } from '@/features/objects/useEditableSource';
import { runGitOperation } from '@/features/git/gitOperation';
import { loadOracleDdl } from '@/features/oracle/windows/common/loadOracleDdl';
import { qualifiedObjectName, quoteIdentifier, splitObjectName } from '@/shared/utils/objectIdentity';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { validateViewDefinition } from '@/features/view/viewDefinition';
import { loadViewMetadata, type ViewMetadata } from '@/features/view/viewMetadata';
export interface ViewEditorProps { tabId: number; fullViewName: string; isActive: boolean; }
export interface ViewDiagnostic { line: number; col: number; text: string; }

export function useViewEditor(database: 'oracle' | 'postgresql', props: ViewEditorProps) {
  const { t } = useTranslation();
  const [schema, viewName] = splitObjectName(props.fullViewName || '', database === 'oracle' ? '' : 'public');
  const identity = JSON.stringify([database, schema, viewName]);
  const [activeTab, setActiveTab] = useState(0);
  const [operationLoading, setOperationLoading] = useState(false);
  const operation = useRef(false);
  const lifetime = useRef(0);
  const identityRef = useRef(identity); identityRef.current = identity;
  useEffect(() => () => { lifetime.current++; }, [identity]);
  const [dbmsOutputs, setDbmsOutputs] = useState<string[]>([]);
  const [compileErrors, setCompileErrors] = useState<ViewDiagnostic[]>([]);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [metadata, setMetadata] = useState<ViewMetadata | null>(null);
  const [metadataError, setMetadataError] = useState('');
  const [metadataLoading, setMetadataLoading] = useState(false);
  const metadataVersion = useRef(0);
  useEffect(() => {
    setMetadata(null); setMetadataError('');
    const generation = metadataVersion;
    return () => { generation.current++; };
  }, [identity]);

  const fetchSource = useEventCallback(async () => {
    if (database === 'oracle') return loadOracleDdl(ipcRenderer, 'VIEW', viewName, schema);
    const res = await ipcRenderer.invoke<{ definition: string }>('execute-sql-bg',
      'SELECT definition FROM pg_views WHERE schemaname = :schema AND viewname = :name', { schema, name: viewName });
    if (!res.success) throw new Error(res.error);
    const definition = res.rows[0]?.definition;
    if (typeof definition !== 'string' || !definition.trim()) throw new Error('View source could not be loaded.');
    return `CREATE OR REPLACE VIEW ${qualifiedObjectName({ schema, objectName: viewName })} AS\n${definition}`;
  });
  const source = useEditableSource(identity, fetchSource, '', t('failed_to_fetch_source'));
  const loadSource = useEventCallback(async () => { if (!operation.current) await source.loadSource(); });
  useEffect(() => {
    if (props.isActive && viewName && [1, 2].includes(activeTab) && source.sourceStatus === 'idle') void loadSource();
  }, [props.isActive, viewName, activeTab, source.sourceStatus, loadSource]);
  const reloadMetadata = useEventCallback(async () => {
    const version = ++metadataVersion.current, key = identityRef.current;
    setMetadataLoading(true); setMetadataError('');
    try {
      const data = await loadViewMetadata(database, schema, viewName);
      if (version === metadataVersion.current && key === identityRef.current) setMetadata(data);
    } catch (error) {
      if (version === metadataVersion.current && key === identityRef.current) setMetadataError(getErrorMessage(error));
    } finally { if (version === metadataVersion.current) setMetadataLoading(false); }
  });
  useEffect(() => {
    if (props.isActive && activeTab === 3 && !metadata && !metadataError && !metadataLoading) void reloadMetadata();
  }, [props.isActive, activeTab, metadata, metadataError, metadataLoading, reloadMetadata]);
  const handleSave = useEventCallback(async () => {
    if (operation.current || !source.isSourceReady()) return;
    const snapshot = source.sourceText, savedIdentity = identityRef.current, version = lifetime.current;
    let statement;
    try { statement = validateViewDefinition(snapshot, database, schema, viewName); }
    catch { alert(t('view_target_definition_required')); return; }
    operation.current = true; setOperationLoading(true); setCompileErrors([]); setDbmsOutputs([]);
    const current = () => version === lifetime.current && savedIdentity === identityRef.current;
    try {
      const res = await ipcRenderer.invoke('execute-sql', statement.text);
      if (!current()) return;
      if (res.success) {
        setDataRevision(value => value + 1); metadataVersion.current++;
        setMetadata(null); setMetadataError(''); setMetadataLoading(false);
        window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'VIEW' } }));
      }
      let diagnostics: ViewDiagnostic[] = [];
      if (res.success && database === 'oracle') {
        const errors = await ipcRenderer.invoke<{ LINE: number; POSITION: number; TEXT: string }>('execute-sql-bg',
          "SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = :schema AND NAME = :name AND TYPE = 'VIEW' ORDER BY SEQUENCE", { schema, name: viewName });
        if (!current()) return;
        if (!errors.success) throw new Error(errors.error);
        diagnostics = errors.rows.map(error => ({ line: Math.max(1, Number(error.LINE)) + statement.lineOffset, col: Number(error.POSITION) || 1, text: error.TEXT }));
      }
      if (!res.success || diagnostics.length) {
        const error = res.success ? diagnostics.map(item => item.text).join('\n') : res.error;
        if (!res.success && res.errorPosition) {
          // PostgreSQL positions count Unicode characters, not UTF-16 code units.
          const before = Array.from(statement.text).slice(0, res.errorPosition - 1).join('');
          diagnostics = [{ line: statement.lineOffset + before.split('\n').length, col: before.split('\n').at(-1)!.length + 1, text: res.error }];
        }
        setCompileErrors(diagnostics); setDbmsOutputs([t('compilation_error'), error]);
        alert(t('compilation_error_occurred_check_the_console_for_details')); return;
      }
      source.setSavedSourceText(snapshot);
      const git = await runGitOperation(t, 'git-commit', { dbType: database === 'oracle' ? 'ORACLE' : 'POSTGRES', schema,
        objectType: 'VIEW', objectName: viewName, sourceText: snapshot, message: t('update_view', { value0: viewName }) });
      if (!current()) return;
      if (!git.success) setDbmsOutputs([t('view_git_failed', { error: git.error })]);
      alert(t('view_updated_successfully'));
    } catch (error) {
      if (current()) { setDbmsOutputs([getErrorMessage(error)]); alert(t('connection_error_occurred_check_the_console')); }
    } finally { operation.current = false; if (current()) setOperationLoading(false); }
  });
  const handleDelete = useEventCallback(async () => {
    if (operation.current || source.sourceStatus === 'loading') return;
    if (!window.confirm(t('view_3') + viewName + t('this_operation_cannot_be_undone'))) return;
    operation.current = true; setOperationLoading(true);
    const version = lifetime.current, key = identityRef.current;
    try {
      const res = await ipcRenderer.invoke('execute-sql', `DROP VIEW ${schema ? quoteIdentifier(schema) + '.' : ''}${quoteIdentifier(viewName)}`);
      if (!res.success) throw new Error(res.error);
      await runGitOperation(t, 'git-delete-object', { dbType: database === 'oracle' ? 'ORACLE' : 'POSTGRES', schema, objectType: 'VIEW', objectName: viewName });
      if (version !== lifetime.current || key !== identityRef.current) return;
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'VIEW' } }));
      window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema, objectName: viewName, objectType: 'VIEW' } }));
      window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: props.tabId } }));
    } catch (error) { if (version === lifetime.current && key === identityRef.current) alert(t('delete_error_3') + getErrorMessage(error)); }
    finally { operation.current = false; if (version === lifetime.current) setOperationLoading(false); }
  });
  const isLoading = operationLoading || source.sourceStatus === 'loading';
  return { ...source, schema, viewName, activeTab, setActiveTab, isLoading, loadSource, handleSave, handleDelete,
    canSave: source.sourceStatus === 'success' && !isLoading && Boolean(source.sourceText.trim()),
    hasUnsavedChanges: source.sourceText !== source.savedSourceText, dbmsOutputs, compileErrors, editorRef,
    handleClearLogs: () => setDbmsOutputs([]), dataRevision, metadata, metadataError, metadataLoading, reloadMetadata };
}
