// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { sql } from '@codemirror/lang-sql';
import { plsqlDialect } from '../common/plsqlDialect';
import { ipcRenderer } from '@/shared/api/desktop';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { emptyLogForm, logRows, readLogMaster, readMviewLog, logValidation, logSql, sameLog,
  type MviewLogForm, type LogMaster, type MviewLogMetadata } from '@/features/oracle/mviewLogDefinition';
import type { DatabaseObject } from '@/shared/types/objectTypes';

export interface MaterializedViewLogWindowProps {
  tabId: number; schema: string; tableName: string; isNew: boolean; isActive: boolean; allSchemas: string[];
}
export interface LogEntry { time: string; sql: string; resultMsg: string; errorLines?: string[]; }
export const useMaterializedViewLogWindow = (props: MaterializedViewLogWindowProps) => {
  const { tabId, schema, tableName, isNew, isActive, allSchemas } = props;
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0), [bottomTab, setBottomTab] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [consoleWidth, setConsoleWidth] = useState(350), [isResizing, setIsResizing] = useState(false);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const [formData, setFormData] = useState<MviewLogForm>(() => emptyLogForm(schema || allSchemas[0] || '', tableName));
  const [metadata, setMetadata] = useState<MviewLogMetadata | null>(null);
  const [master, setMaster] = useState<LogMaster | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [reload, setReload] = useState(0), [revision, setRevision] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loggedTables, setLoggedTables] = useState<string[]>([]);
  const generation = useRef(0);
  const loadedIdentity = useRef('');
  const identity = JSON.stringify([isNew, isNew ? formData.targetSchema : schema, isNew ? formData.targetTable : tableName]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const reportError = useEventCallback((failure: unknown, statement: string = '') => {
    const message = getErrorMessage(failure);
    setError(message);
    setLogs(previous => [{ time: new Date().toLocaleString(), sql: statement, resultMsg: t('error_occurred'), errorLines: [t(message)] }, ...previous]);
    setIsConsoleOpen(true);
  });
  const applyMetadata = useEventCallback((next: MviewLogMetadata, preserve: boolean) => {
    if (preserve && metadata) {
      setFormData(current => {
        const merged = { ...next.form };
        for (const key of ['withPrimaryKey', 'withRowid', 'withSequence', 'withCommitScn', 'withObjectId', 'includingNewValues'] as const) {
          if (current[key] !== metadata.form[key]) merged[key] = current[key];
        }
        merged.filterColumns = [...new Set([...next.form.filterColumns, ...current.filterColumns.filter(c => !metadata.form.filterColumns.includes(c))])];
        return merged;
      });
    } else setFormData(next.form);
    setMetadata(next); setReady(true); setRevision(v => v + 1);
  });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      let newWidth = window.innerWidth - e.clientX; 
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 800) newWidth = 800;
      setConsoleWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [isResizing]);

  useEffect(() => {
    const ticket = ++generation.current;
    if (!isActive) return;
    let cancelled = false;
    const currentIdentity = identity;
    const owner = isNew ? formData.targetSchema : schema;
    const name = isNew ? formData.targetTable : tableName;
    const valid = () => !cancelled && ticket === generation.current && identityRef.current === currentIdentity;
    setReady(false); setError('');
    if (!name || !owner) { setMaster(null); return; }
    beginLoading();
    void (async () => {
      try {
        const [nextMaster, next] = await Promise.all([readLogMaster(owner, name), readMviewLog(owner, name)]);
        if (!valid()) return;
        setMaster(nextMaster);
        if (isNew) {
          if (next) throw new Error('mview_log_exists');
          setMetadata(null);
          if (loadedIdentity.current !== currentIdentity) setFormData(current => ({ ...current, withPrimaryKey: nextMaster.primaryKey, withRowid: !nextMaster.primaryKey }));
          setReady(true);
        } else {
          if (!next) throw new Error('mview_log_missing');
          applyMetadata(next, loadedIdentity.current === currentIdentity);
        }
        loadedIdentity.current = currentIdentity;
      } catch (failure) { if (valid()) reportError(failure); }
      finally { endLoading(); }
    })();
    return () => { cancelled = true; };
  }, [identity, isNew, isActive, schema, tableName, formData.targetSchema, formData.targetTable, reload, beginLoading, endLoading, reportError, applyMetadata]);

  useEffect(() => () => { generation.current++; }, []);
  const validation = logValidation(formData, master, isNew ? undefined : metadata?.form);
  const createSql = useMemo(() => logSql(formData), [formData]);
  const alterSql = useMemo(() => metadata ? logSql(formData, metadata.form) : '', [formData, metadata]);
  const canExecute = ready && !isLoading && !validation && (isNew || Boolean(alterSql));
  const canDelete = ready && !isLoading && !isNew && Boolean(metadata);
  const retry = () => { if (!isBusy()) setReload(v => v + 1); };
  const handleCopy = async (value: string) => {
    const ticket = generation.current;
    try { await navigator.clipboard.writeText(value); }
    catch (failure) { if (ticket === generation.current) reportError(failure); }
  };
  const openPicker = async () => {
    if (isBusy() || !isNew) return;
    beginLoading(); setError('');
    const currentIdentity = identity, ticket = generation.current;
    const valid = () => identityRef.current === currentIdentity && ticket === generation.current;
    try {
      const rows = await logRows<{ MASTER: string }>('SELECT MASTER FROM ALL_MVIEW_LOGS WHERE LOG_OWNER = :owner', { owner: formData.targetSchema });
      if (!valid()) return;
      setLoggedTables(rows.map(r => r.MASTER)); setPickerOpen(true);
    } catch (failure) { if (valid()) reportError(failure); }
    finally { endLoading(); }
  };
  const selectTable = (objects: DatabaseObject[]) => {
    if (isBusy() || !isNew || !objects[0]) return;
    const object = objects[0];
    if (object.schema !== formData.targetSchema || object.category !== 'TABLE') return;
    setReady(false); setMaster(null); setMetadata(null); setError('');
    setFormData(emptyLogForm(object.schema, object.name)); setPickerOpen(false);
    setReload(v => v + 1);
  };
  const setSchema = (owner: string) => {
    if (isBusy() || !isNew) return;
    setReady(false); setMaster(null); setMetadata(null); setError('');
    setFormData(emptyLogForm(owner));
  };
  const toggleColumn = (column: string, checked: boolean) => {
    if (isBusy() || !ready || !checked && metadata?.form.filterColumns.includes(column)) return;
    setFormData(current => ({ ...current, filterColumns: checked ? [...new Set([...current.filterColumns, column])] : current.filterColumns.filter(c => c !== column) }));
  };
  const mutate = async (remove: boolean) => {
    if (isBusy() || !ready || remove && !canDelete) return;
    if (!remove && validation) { reportError(new Error(validation)); return; }
    if (!isNew && !metadata) return;
    if (!isNew && (formData.targetSchema !== schema || formData.targetTable !== tableName)) return;
    // No-op detection is structural and never depends on translated SQL comments.
    if (!remove && !isNew && !alterSql) return;
    const owner = formData.targetSchema, name = formData.targetTable;
    const target = qualifiedObjectName({ schema: owner, objectName: name });
    if (remove && !window.confirm(t('mview_log_delete_confirm', { target }))) return;
    const ticket = generation.current, currentIdentity = identity;
    const valid = () => ticket === generation.current && identityRef.current === currentIdentity;
    const statement = remove ? `DROP MATERIALIZED VIEW LOG ON ${target}` : (isNew ? createSql : alterSql).replace(/;$/, '');
    beginLoading(); setError('');
    try {
      const [fresh, freshMaster] = await Promise.all([readMviewLog(owner, name), readLogMaster(owner, name)]);
      if (!valid()) return;
      if (isNew ? fresh !== null : !fresh || !metadata || !sameLog(metadata, fresh)) {
        setReady(false); throw new Error(isNew ? 'mview_log_exists' : 'mview_log_conflict');
      }
      if (master?.id !== freshMaster.id) { setReady(false); throw new Error('mview_log_conflict'); }
      const invalid = remove ? null : logValidation(formData, freshMaster, fresh?.form);
      if (invalid) { setReady(false); throw new Error(invalid); }
      const response = await ipcRenderer.invoke('execute-sql', statement);
      if (!valid()) return;
      if (!response.success) throw new Error(response.error);
      setLogs(previous => [{ time: new Date().toLocaleString(), sql: statement, resultMsg: t('success') }, ...previous]);
      setIsConsoleOpen(true);
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: owner, objType: 'MATERIALIZED VIEW LOG' } }));
      setReady(false);
      if (remove) {
        window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
      } else {
        const next = await readMviewLog(owner, name);
        if (!valid()) return;
        if (!next) throw new Error('mview_log_missing');
        applyMetadata(next, false); setMaster(freshMaster);
        if (isNew) window.dispatchEvent(new CustomEvent('mview-log-created', { detail: { tabId, schema: owner, tableName: name } }));
      }
    } catch (failure) {
      if (valid()) { setReady(false); reportError(failure, statement); }
    } finally { endLoading(); }
  };
  const editorExtensions = useMemo(() => [sql({ dialect: plsqlDialect })], []);
  return {
    activeTab, setActiveTab, bottomTab, setBottomTab, logs, setLogs, isConsoleOpen, setIsConsoleOpen,
    consoleWidth, isResizing, setIsResizing, isLoading, ready, error, retry, validation,
    master, metadata, revision, logTableName: metadata?.logTable || '',
    formData, setFormData, initialFormData: metadata?.form,
    canExecute, canDelete, handleExecute: () => mutate(false), handleDelete: () => mutate(true),
    handleCopy, toggleColumn, createSql, alterSql, editorExtensions,
    pickerOpen, setPickerOpen, openPicker, selectTable, setSchema, loggedTables
  };
};
