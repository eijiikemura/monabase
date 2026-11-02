// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer, subscribeTransactionState } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { runGitOperation } from '@/features/git/gitOperation';
import { alterMviewSql, createMviewSql, mviewIdentifier, type MviewForm } from '@/features/materialized-view/mviewSql';
import { readMview, readMviewRelations, readMviewSource, type MviewMetadata } from '@/features/materialized-view/mviewMetadata';
import type { SqlDialect } from '@/features/sql/sqlScript';
export interface MviewWindowProps { tabId: number; schema: string; mviewName: string; isNew: boolean; isActive: boolean; allSchemas: string[]; inputDateFormat?: string; outputDateFormat?: string; }
interface GitTask { kind: 'record' | 'delete' | 'rename'; schema: string; name: string; oldName?: string; renamed?: boolean; }
const initial = (p: MviewWindowProps): MviewForm => ({ schema: p.schema || p.allSchemas[0] || '', mviewName: p.mviewName, selectSql: 'SELECT * FROM table_name', withData: true, refreshMethod: 'FORCE', refreshTiming: 'ON DEMAND', isUpdatable: false, isRealTime: false, startWith: '', next: '' });
const signature = (m: MviewMetadata) => JSON.stringify([m.id, m.form.selectSql, m.form.refreshMethod, m.form.refreshTiming, m.form.next, m.form.isUpdatable, m.form.isRealTime]);
export function useMviewWindow(database: SqlDialect, props: MviewWindowProps) {
  const { schema, mviewName, isNew, isActive, tabId } = props;
  const { t } = useTranslation();
  const completion = useRef<(() => void) | null>(null), refreshTransaction = useRef(false);
  const [activeTab, setActiveTab] = useState(0), [formData, setForm] = useState(() => initial(props));
  const [metadata, setMetadata] = useState<MviewMetadata | null>(null), [sourceText, setSourceText] = useState(''), [ready, setReady] = useState(isNew), [loadError, setLoadError] = useState(''), [error, setError] = useState('');
  const [conflict, setConflict] = useState<MviewMetadata | null>(null), [dataRevision, setDataRevision] = useState(0);
  const [logs, setLogs] = useState<{ time: string; sql: string; resultMsg: string; errorLines?: string[] }[]>([]), [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [consoleWidth, setConsoleWidth] = useState(350), [isResizing, setIsResizing] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshMethod, setRefreshMethod] = useState('FORCE'), [concurrent, setConcurrent] = useState(false), [gitPending, setGitPending] = useState(false);
  const [relations, setRelations] = useState<string[]>([]), [infoError, setInfoError] = useState(''), [infoLoading, setInfoLoading] = useState(false);
  const [advancedSupported, setAdvancedSupported] = useState(false);
  const baseline = useRef<MviewMetadata | null>(null), formRef = useRef(formData), request = useRef(0), infoRequest = useRef(0), edits = useRef(0), readyRef = useRef(isNew), task = useRef<GitTask | null>(null);
  formRef.current = formData;
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const message = (cause: unknown) => { const value = getErrorMessage(cause); return value.startsWith('mview_') ? t(value) : value; };
  const recordError = (cause: unknown, sql = '') => { const value = message(cause); setError(value); setIsConsoleOpen(true); setLogs(previous => [{ time: new Date().toLocaleString(), sql, resultMsg: t('error_occurred'), errorLines: [value] }, ...previous]); };
  const dirty = () => baseline.current && JSON.stringify(formRef.current) !== JSON.stringify(baseline.current.form);
  const loadSource = useEventCallback(async (discard: boolean = false) => {
    if (isNew || refreshTransaction.current) return;
    const generation = ++request.current, edited = edits.current, keep = dirty();
    readyRef.current = false; setReady(false); setLoadError(''); beginLoading();
    try {
      const m = await readMview(database, schema, mviewName), source = await readMviewSource(database, schema, mviewName, m);
      if (generation !== request.current) return;
      setMetadata(m); setSourceText(source); readyRef.current = true; setReady(true);
      if ((!keep || discard) && edited === edits.current) { baseline.current = m; setForm(m.form); setConflict(null); }
      if (!baseline.current) baseline.current = m;
    } catch (cause) { if (generation === request.current) setLoadError(message(cause)); }
    finally { endLoading(); }
  });
  const reset = useEventCallback(() => { request.current++; infoRequest.current++; baseline.current = null; edits.current = 0; readyRef.current = isNew; task.current = null; completion.current = null; refreshTransaction.current = false;
    setForm(initial(props)); setMetadata(null); setReady(isNew); setLoadError(''); setError(''); setSourceText(''); setConflict(null); setRelations([]); setInfoError(''); setInfoLoading(false); setActiveTab(0); setGitPending(false); setConcurrent(false); setRefreshPending(false); });
  useEffect(() => { reset(); const r = request, i = infoRequest; return () => { r.current++; i.current++; }; }, [database, schema, mviewName, isNew, reset]);
  useEffect(() => { if (isActive && !isNew && !refreshPending) void loadSource(); }, [isActive, isNew, schema, mviewName, refreshPending, loadSource]);
  useEffect(() => {
    if (database !== 'oracle' || !isActive) return;
    let active = true;
    void ipcRenderer.invoke('get-db-info').then(result => {
      if (!active) return;
      const version = /(?:Release|Version)\s+(\d+)\.(\d+)/i.exec(result.success ? result.info : '');
      setAdvancedSupported(!!version && (Number(version[1]) > 12 || Number(version[1]) === 12 && Number(version[2]) >= 2));
    }).catch(() => { if (active) setAdvancedSupported(false); });
    return () => { active = false; };
  }, [database, isActive]);
  useEffect(() => {
    if (!isResizing) return;
    const move = (event: MouseEvent) => setConsoleWidth(Math.min(800, Math.max(200, window.innerWidth - event.clientX))), stop = () => setIsResizing(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
  }, [isResizing]);
  const setFormData = (update: SetStateAction<MviewForm>) => {
    if (isBusy()) return;
    edits.current++; setError(''); setConflict(null);
    setForm(previous => { const next = typeof update === 'function' ? update(previous) : update; return isNew ? next : { ...next, schema, mviewName, selectSql: previous.selectSql, isUpdatable: previous.isUpdatable, isRealTime: previous.isRealTime }; });
  };
  const onTransaction = useEventCallback((pending: boolean) => {
    if (!pending && refreshTransaction.current) { refreshTransaction.current = false; setRefreshPending(false); setDataRevision(value => value + 1); }
  });
  useEffect(() => subscribeTransactionState(onTransaction), [onTransaction]);
  const [renameTo, setRenameTo] = useState('');
  const preview = (() => { try { return { sql: isNew ? createMviewSql(database, formData) : database === 'oracle' && baseline.current ? alterMviewSql(schema, mviewName, formData, baseline.current.form) : '', error: '' }; } catch (cause) { return { sql: '', error: message(cause) }; } })();
  const checkCurrent = async () => {
    const latest = await readMview(database, schema, mviewName);
    if (!baseline.current || signature(latest) !== signature(baseline.current)) { setConflict(latest); throw new Error('mview_conflict'); }
    return latest;
  };
  const runPendingGit = useEventCallback(async () => {
    const pending = task.current; if (!pending) return;
    const dbType = database === 'oracle' ? 'ORACLE' : 'POSTGRES';
    if (pending.kind === 'delete') {
      const result = await runGitOperation(t, 'git-delete-object', { dbType, schema: pending.schema, objectType: 'MATERIALIZED VIEW', objectName: pending.name });
      if (!result.success) throw new Error('mview_git_pending');
    } else {
      if (pending.kind === 'rename' && !pending.renamed) {
        const result = await runGitOperation(t, 'git-rename-object', { dbType, schema: pending.schema, objectType: 'MATERIALIZED VIEW', oldName: pending.oldName!, newName: pending.name });
        if (!result.success) throw new Error('mview_git_pending');
        pending.renamed = true;
      }
      const source = await readMviewSource(database, pending.schema, pending.name);
      const result = await runGitOperation(t, 'git-commit', { dbType, schema: pending.schema, objectType: 'MATERIALIZED VIEW', objectName: pending.name, sourceText: source, message: t('update_materialized_view', { value0: pending.name }) });
      if (!result.success) throw new Error('mview_git_pending');
    }
    task.current = null; setGitPending(false); const done = completion.current; completion.current = null; done?.();
  });
  const retryGit = useEventCallback(async () => {
    if (isBusy() || !task.current) return;
    beginLoading(); setError('');
    try { await runPendingGit(); } catch (cause) { recordError(cause); } finally { endLoading(); }
  });
  const sidebar = () => window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'MATERIALIZED VIEW' } }));
  const mutate = useEventCallback(async (kind: 'save' | 'delete' | 'rename' | 'refresh') => {
    if (isBusy() || !readyRef.current || task.current || refreshTransaction.current) return;
    if (isNew && kind !== 'save') return;
    const generation = request.current; let sql = ''; let binds: Record<string, string> = {}; let destination = mviewName;
    beginLoading(); setError('');
    try {
      if (kind === 'save') {
        if (!isNew && database === 'postgresql') return;
        if (!isNew && !preview.sql && !preview.error) { alert(t('mview_no_changes')); return; }
        if (preview.error) throw new Error(preview.error);
        sql = preview.sql.replace(/;$/, ''); destination = isNew ? formData.mviewName : mviewName;
        if (isNew && database === 'oracle' && (formData.isRealTime || formData.refreshTiming === 'ON STATEMENT') && !advancedSupported) throw new Error('mview_version_required');
        if (!isNew) {
          if ((formData.startWith || formData.next !== baseline.current?.form.next) && !metadata?.scheduleKnown) throw new Error('mview_schedule_unknown');
          await checkCurrent();
        }
      } else {
        const latest = await checkCurrent();
        const target = qualifiedObjectName({ schema, objectName: mviewName });
        if (kind === 'delete') {
          if (!window.confirm(t('mview_delete_confirm', { target }))) return;
          sql = `DROP MATERIALIZED VIEW ${target}`;
        } else if (kind === 'rename') {
          mviewIdentifier(database, renameTo); if (renameTo === mviewName) return;
          if (!window.confirm(t('mview_rename_confirm', { target, name: renameTo }))) return;
          sql = `ALTER MATERIALIZED VIEW ${target} RENAME TO ${quoteIdentifier(renameTo)}`; destination = renameTo;
        } else {
          if (database === 'postgresql') {
            if (concurrent && !latest.concurrent) throw new Error('mview_concurrent_unavailable');
            sql = `REFRESH MATERIALIZED VIEW ${concurrent ? 'CONCURRENTLY ' : ''}${target}`;
          } else {
            if (!['FAST', 'COMPLETE', 'FORCE'].includes(refreshMethod)) throw new Error('mview_invalid_options');
            sql = 'BEGIN DBMS_MVIEW.REFRESH(list => :target, method => :method, atomic_refresh => TRUE); END;';
            binds = { target, method: { FAST: 'F', COMPLETE: 'C', FORCE: '?' }[refreshMethod]! };
          }
          if (!window.confirm(t('mview_refresh_confirm', { target }))) return;
        }
      }
      if (generation !== request.current) return;
      const response = await ipcRenderer.invoke('execute-sql', sql, binds, isNew ? formData.schema : schema);
      if (!response.success) throw new Error(response.error);
      if (generation !== request.current) return;
      setLogs(previous => [{ time: new Date().toLocaleString(), sql, resultMsg: t('success') }, ...previous]);
      if (kind === 'refresh' && database === 'postgresql') { refreshTransaction.current = response.hasUncommittedTx === true; setRefreshPending(refreshTransaction.current); }
      setDataRevision(value => value + 1); sidebar();
      if (kind !== 'refresh') {
        completion.current = () => {
          if (kind === 'save' && isNew) window.dispatchEvent(new CustomEvent('mview-created', { detail: { tabId, schema: formData.schema, mviewName: destination } }));
          if (kind === 'delete' || kind === 'rename') {
            window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema, objectName: mviewName, objectType: 'MATERIALIZED VIEW', ...(kind === 'rename' ? { reason: 'rename' as const } : {}) } }));
            window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
            if (kind === 'rename') window.dispatchEvent(new CustomEvent('open-mview-tab', { detail: { schema, mviewName: destination } }));
          }
        };
        task.current = { kind: kind === 'save' ? 'record' : kind, schema: isNew ? formData.schema : schema, name: destination, oldName: mviewName }; setGitPending(true);
        try { await runPendingGit(); } catch (cause) { recordError(cause); }
      }
      if (kind === 'delete' || kind === 'rename' || isNew) { readyRef.current = false; setReady(false); }
      else if (!(kind === 'refresh' && database === 'postgresql' && response.hasUncommittedTx === true)) {
        if (kind === 'save') baseline.current = null;
        await loadSource();
      }
    } catch (cause) { if (generation === request.current) recordError(cause, sql); }
    finally { endLoading(); }
  });
  const keepLocalChanges = () => { if (isBusy() || !conflict) return; baseline.current = conflict; setMetadata(conflict); setForm(previous => ({ ...previous, selectSql: conflict.form.selectSql })); setConflict(null); };
  const discardChanges = () => { if (!isBusy() && window.confirm(t('mview_discard_confirm'))) void loadSource(true); };
  const loadInformation = useEventCallback(async () => {
    if (refreshTransaction.current) return;
    const generation = ++infoRequest.current; setInfoLoading(true); setInfoError('');
    try { const result = await readMviewRelations(database, schema, mviewName); if (generation === infoRequest.current) setRelations(result); }
    catch (cause) { if (generation === infoRequest.current) setInfoError(message(cause)); }
    finally { if (generation === infoRequest.current) setInfoLoading(false); }
  });
  useEffect(() => { if (isActive && !isNew && activeTab === 3 && !refreshPending) void loadInformation(); }, [isActive, isNew, activeTab, dataRevision, refreshPending, loadInformation]);
  return { activeTab, setActiveTab, formData, setFormData, metadata, sourceText, ready, loadError, error, isLoading, loadSource, previewSql: preview.sql, previewError: preview.error,
    conflict, keepLocalChanges, discardChanges, dataRevision, logs, setLogs, isConsoleOpen, setIsConsoleOpen, consoleWidth, isResizing, setIsResizing,
    refreshPending, renameTo, setRenameTo, refreshMethod, setRefreshMethod, concurrent, setConcurrent, advancedSupported, gitPending, retryGit, relations, infoError, infoLoading, loadInformation,
    handleExecute: () => mutate('save'), handleDelete: () => mutate('delete'), handleRename: () => mutate('rename'), handleRefreshMView: () => mutate('refresh') };
}
