// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { inspectSynonymTarget, readSynonym, readSynonymDependents, readSynonymSource, sameSynonym, synonymDbLink, synonymSql, synonymTargetWindow,
  type SynonymDefinition, type SynonymTargetInfo, type SynonymTargetWindow } from '@/features/oracle/synonymDefinition';
import type { DatabaseObject } from '@/shared/types/objectTypes';

export interface SynonymWindowProps {
  tabId: number; schema: string; synonymName: string; isNew: boolean; isActive: boolean; allSchemas: string[];
  onOpenTarget?: (type: SynonymTargetWindow, schema: string, name: string) => void;
}
export interface LogEntry { time: string; sql: string; resultMsg: string; errorLines?: string[]; }
export interface SynonymForm { isPublic: boolean; schema: string; synonymName: string; targetSchema: string; targetObject: string; dbLink: string; }
const formFor = (d: SynonymDefinition): SynonymForm => ({ isPublic: d.owner === 'PUBLIC', schema: d.owner, synonymName: d.name, targetSchema: d.targetSchema, targetObject: d.targetObject, dbLink: d.dbLink });
const initialForm = (props: SynonymWindowProps): SynonymForm => ({ isPublic: props.schema === 'PUBLIC', schema: props.schema === 'PUBLIC' ? props.allSchemas[0] || '' : props.schema,
  synonymName: props.synonymName, targetSchema: props.schema === 'PUBLIC' ? props.allSchemas[0] || '' : props.schema, targetObject: '', dbLink: '' });
export const useSynonymWindow = (props: SynonymWindowProps) => {
  const { schema, synonymName, isNew, isActive, tabId } = props;
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0), [logs, setLogs] = useState<LogEntry[]>([]), [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [formData, setForm] = useState<SynonymForm>(() => initialForm(props));
  const [ready, setReady] = useState(isNew), [loadError, setLoadError] = useState(''), [operationError, setOperationError] = useState('');
  const [sourceText, setSourceText] = useState(''), [sourceReady, setSourceReady] = useState(false), [sourceError, setSourceError] = useState('');
  const [savedDefinition, setSavedDefinition] = useState<SynonymDefinition | null>(null), [conflict, setConflict] = useState<SynonymDefinition | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [consoleWidth, setConsoleWidth] = useState(350), [isResizing, setIsResizing] = useState(false);
  useEffect(() => {
    if (!isResizing) return;
    const move = (event: MouseEvent) => setConsoleWidth(Math.min(800, Math.max(200, window.innerWidth - event.clientX)));
    const stop = () => setIsResizing(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', stop);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', stop); };
  }, [isResizing]);
  const [targetInfo, setTargetInfo] = useState<SynonymTargetInfo | null>(null), [dependents, setDependents] = useState<Awaited<ReturnType<typeof readSynonymDependents>>>([]);
  const [infoError, setInfoError] = useState(''), [infoLoading, setInfoLoading] = useState(false);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const baseline = useRef<SynonymDefinition | null>(null), readyRef = useRef(isNew), generation = useRef(0), infoGeneration = useRef(0), editVersion = useRef(0);
  const formRef = useRef(formData); formRef.current = formData;
  const definitionFor = (form: SynonymForm): SynonymDefinition => ({ owner: isNew ? form.isPublic ? 'PUBLIC' : form.schema : schema, name: isNew ? form.synonymName : synonymName,
    targetSchema: form.targetSchema, targetObject: form.targetObject, dbLink: synonymDbLink(form.dbLink), editionable: baseline.current?.editionable ?? null });
  const message = (error: unknown) => { const value = getErrorMessage(error); return value.startsWith('synonym_') ? t(value) : value; };
  const setFormData = (update: SetStateAction<SynonymForm>) => {
    if (isBusy()) return;
    editVersion.current++; setOperationError(''); setConflict(null);
    setForm(previous => {
      const next = typeof update === 'function' ? update(previous) : update;
      return isNew ? next : { ...next, schema, synonymName, isPublic: schema === 'PUBLIC' };
    });
  };
  const loadSynonym = useEventCallback(async (discard: boolean = false) => {
    if (isNew) return;
    const request = ++generation.current, edited = editVersion.current;
    let dirty = false;
    try { dirty = !!baseline.current && !sameSynonym(baseline.current, definitionFor(formRef.current)); } catch { dirty = true; }
    readyRef.current = false; setReady(false); setLoadError(''); setSourceError(''); setSourceReady(false); beginLoading();
    try {
      const [definition, source] = await Promise.allSettled([readSynonym(schema, synonymName), readSynonymSource(schema, synonymName)]);
      if (request !== generation.current) return;
      if (source.status === 'fulfilled') { setSourceText(source.value); setSourceReady(true); }
      else setSourceError(message(source.reason));
      if (definition.status === 'rejected') throw definition.reason;
      if (!definition.value) throw new Error('synonym_not_found');
      const d = definition.value; setSavedDefinition(d);
      if (edited === editVersion.current && (!dirty || discard)) { baseline.current = d; setForm(formFor(d)); setConflict(null); }
      if (!baseline.current) baseline.current = d;
      readyRef.current = true; setReady(true);
    } catch (error) { if (request === generation.current) setLoadError(message(error)); }
    finally { endLoading(); }
  });
  const resetIdentity = useEventCallback(() => {
    generation.current++; infoGeneration.current++; baseline.current = null; readyRef.current = isNew; editVersion.current = 0;
    setForm(initialForm(props)); setReady(isNew); setLoadError(''); setOperationError(''); setSavedDefinition(null); setConflict(null);
    setSourceText(''); setSourceReady(false); setSourceError(''); setTargetInfo(null); setDependents([]); setInfoError(''); setPickerOpen(false); setActiveTab(0);
  });
  useEffect(() => {
    resetIdentity();
    const requests = generation, info = infoGeneration;
    return () => { requests.current++; info.current++; };
  }, [schema, synonymName, isNew, resetIdentity]);
  useEffect(() => { if (isActive && !isNew) void loadSynonym(); }, [isActive, isNew, schema, synonymName, loadSynonym]);
  const preview = (() => {
    try { return { sql: synonymSql(definitionFor(formData), !isNew), error: '' }; }
    catch (error) { return { sql: '', error: message(error) }; }
  })();
  const changed = !isNew && !!baseline.current && (preview.error !== '' || !sameSynonym(baseline.current, definitionFor(formData)));
  const recordError = (error: unknown, sql = '') => {
    const text = message(error); setOperationError(text); setIsConsoleOpen(true);
    setLogs(previous => [{ time: new Date().toLocaleString(), sql, resultMsg: t('error_occurred'), errorLines: [text] }, ...previous]);
  };
  const refreshSidebar = (owner: string) => window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: owner, objType: 'SYNONYM' } }));
  const handleExecute = useEventCallback(async () => {
    if (isBusy() || !readyRef.current) return;
    let statement = ''; const request = generation.current;
    beginLoading(); setOperationError('');
    try {
      const desired = definitionFor(formData); statement = synonymSql(desired, !isNew);
      if (!isNew && baseline.current && sameSynonym(baseline.current, desired)) { alert(t('synonym_no_changes')); return; }
      const latest = await readSynonym(desired.owner, desired.name);
      if (request !== generation.current) return;
      if (isNew && latest) throw new Error('synonym_name_exists');
      if (!isNew) {
        if (!latest) throw new Error('synonym_not_found');
        if (sameSynonym(latest, desired)) { baseline.current = latest; setSavedDefinition(latest); setConflict(null); alert(t('synonym_no_changes')); return; }
        if (!baseline.current || !sameSynonym(latest, baseline.current)) { setConflict(latest); return; }
      }
      if (desired.owner === 'PUBLIC' && !window.confirm(t('synonym_public_confirm', { name: desired.name, target: qualifiedObjectName({ schema: desired.targetSchema, objectName: desired.targetObject }) }))) return;
      const response = await ipcRenderer.invoke('execute-sql', statement);
      if (!response.success) throw new Error(response.error);
      if (request !== generation.current) return;
      baseline.current = desired; setSavedDefinition(desired); setConflict(null); refreshSidebar(desired.owner);
      setLogs(previous => [{ time: new Date().toLocaleString(), sql: statement, resultMsg: t('success') }, ...previous]);
      if (isNew) window.dispatchEvent(new CustomEvent('synonym-created', { detail: { tabId, schema: desired.owner, synonymName: desired.name } }));
      else await loadSynonym();
      alert(t('synonym_saved'));
    } catch (error) { if (request === generation.current) recordError(error, statement); }
    finally { endLoading(); }
  });
  const handleDelete = useEventCallback(async () => {
    if (isNew || isBusy() || !readyRef.current) return;
    if (!window.confirm(t('synonym_delete_confirm', { target: qualifiedObjectName({ schema, objectName: synonymName }) }))) return;
    beginLoading(); const request = generation.current;
    try {
      const latest = await readSynonym(schema, synonymName);
      if (request !== generation.current) return;
      if (!latest) throw new Error('synonym_not_found');
      if (!baseline.current || !sameSynonym(latest, baseline.current)) { setConflict(latest); return; }
      const sql = `DROP ${schema === 'PUBLIC' ? 'PUBLIC ' : ''}SYNONYM ${schema === 'PUBLIC' ? quoteIdentifier(synonymName) : qualifiedObjectName({ schema, objectName: synonymName })}`;
      const response = await ipcRenderer.invoke('execute-sql', sql);
      if (!response.success) throw new Error(response.error);
      if (request !== generation.current) return;
      refreshSidebar(schema); window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema, objectName: synonymName, objectType: 'SYNONYM' } }));
      window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
    } catch (error) { if (request === generation.current) recordError(error); }
    finally { endLoading(); }
  });
  const keepLocalChanges = () => {
    if (!conflict || isBusy()) return;
    baseline.current = conflict; setSavedDefinition(conflict); setConflict(null); editVersion.current++;
  };
  const discardChanges = () => { if (!isBusy() && window.confirm(t('synonym_discard_confirm'))) void loadSynonym(true); };
  const loadInformation = useEventCallback(async (remote: boolean = false) => {
    if (!savedDefinition) return;
    const request = ++infoGeneration.current; setInfoError(''); setInfoLoading(true);
    try {
      const [target, dependencies] = await Promise.all([inspectSynonymTarget(savedDefinition, remote), readSynonymDependents(savedDefinition.owner, savedDefinition.name)]);
      if (request === infoGeneration.current) { setTargetInfo(target); setDependents(dependencies); }
    } catch (error) { if (request === infoGeneration.current) { setTargetInfo({ state: 'unknown', types: [] }); setInfoError(message(error)); } }
    finally { if (request === infoGeneration.current) setInfoLoading(false); }
  });
  useEffect(() => { if (isActive && activeTab === 2 && savedDefinition) void loadInformation(); }, [isActive, activeTab, savedDefinition, loadInformation]);
  const openTarget = (type: string) => {
    if (!readyRef.current || infoLoading || savedDefinition?.dbLink || !savedDefinition || targetInfo?.state !== 'found') return;
    const windowType = synonymTargetWindow(type);
    if (windowType) props.onOpenTarget?.(windowType, savedDefinition.targetSchema, savedDefinition.targetObject);
  };
  const selectTarget = (objects: DatabaseObject[]) => {
    const object = objects[0];
    if (object) setFormData(previous => ({ ...previous, targetSchema: object.schema, targetObject: object.name, dbLink: '' }));
  };
  const copySource = async (planned = false) => {
    if (isBusy() || (planned ? !preview.sql : !sourceReady)) return;
    try { await navigator.clipboard.writeText(planned ? preview.sql : sourceText); }
    catch (error) { setOperationError(t('synonym_copy_failed', { error: getErrorMessage(error) })); }
  };
  return { activeTab, setActiveTab, logs, setLogs, isConsoleOpen, setIsConsoleOpen, isLoading, formData, setFormData, ready, loadError, operationError,
    sourceText, sourceReady, sourceError, generatedSql: preview.sql, previewError: preview.error, changed, savedDefinition, conflict, keepLocalChanges, discardChanges,
    consoleWidth, isResizing, setIsResizing, pickerOpen, setPickerOpen, selectTarget, loadSynonym, handleExecute, handleDelete, copySource, infoLoading, infoError, targetInfo, dependents, loadInformation, openTarget };
};
