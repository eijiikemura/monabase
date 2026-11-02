// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { dbLinkForm, dbLinkPlan, emptyDbLink, fullLinkName } from '@/features/oracle/dbLinkDefinition';
import type { DbLinkForm, DbLinkContext, DbLinkMetadata, DbLinkIdentity, DbLinkPhase } from '@/shared/types/dbLinkTypes';
export interface DbLinkWindowProps { tabId: number; schema: string; dbLinkName: string; isNew: boolean; isActive: boolean; allSchemas: string[]; }
interface LinkLog { time: string; sql: string; message: string; code: string; }
export function useDbLinkWindow(props: DbLinkWindowProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => emptyDbLink(props.dbLinkName, props.schema === 'PUBLIC'));
  const [context, setContext] = useState<DbLinkContext | null>(null), [saved, setSaved] = useState<DbLinkMetadata | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [errorCode, setErrorCode] = useState('');
  const [phase, setPhase] = useState<DbLinkPhase | undefined>(), [reload, setReload] = useState(0);
  const [activeTab, setActiveTab] = useState(0), [logs, setLogs] = useState<LinkLog[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false), [testResult, setTestResult] = useState<number | null>(null);
  const [consoleWidth, setConsoleWidth] = useState(350), [isResizing, setIsResizing] = useState(false);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const generation = useRef(0), loaded = useRef('');
  const completed = useRef<DbLinkIdentity | null>(null);
  const identity = JSON.stringify([props.schema, props.dbLinkName, props.isNew]);
  const identityRef = useRef(identity); identityRef.current = identity;
  const plan = useMemo(() => dbLinkPlan(form, context, phase === 'dropped-only' ? null : saved), [form, context, saved, phase]);
  const apply = useEventCallback((next: DbLinkMetadata, preserve: boolean) => {
    setForm(current => {
      const baseline = saved ? dbLinkForm(saved) : null, incoming = dbLinkForm(next);
      return preserve && baseline ? { ...incoming, username: current.username !== baseline.username ? current.username : incoming.username,
        host: current.host !== baseline.host ? current.host : incoming.host, password: current.password } : incoming;
    });
    setSaved(next); setReady(true);
  });
  const failure = useEventCallback((key: string, code: string = '', sql: string = '') => {
    setError(key); setErrorCode(code); setConsoleOpen(true);
    setLogs(previous => [{ time: new Date().toLocaleString(), sql, message: key, code }, ...previous]);
  });
  const notifyCreated = useEventCallback((link: DbLinkMetadata) => {
    window.dispatchEvent(new CustomEvent('dblink-created', { detail: { tabId: props.tabId, schema: link.schema, linkName: link.name } }));
  });
  useEffect(() => {
    const ticket = ++generation.current;
    if (!props.isActive) return;
    let cancelled = false;
    const valid = () => !cancelled && ticket === generation.current && identityRef.current === identity;
    const same = loaded.current === identity;
    if (!same) { completed.current = null; setSaved(null); setContext(null); setForm(emptyDbLink(props.dbLinkName, props.schema === 'PUBLIC')); setPhase(undefined); }
    setReady(false); setError(''); setErrorCode(''); setTestResult(null);
    beginLoading();
    void (async () => {
      try {
        const request = completed.current || { schema: props.schema, name: props.isNew ? '' : props.dbLinkName };
        const response = await ipcRenderer.invoke('get-oracle-dblink', request);
        if (!valid()) return;
        if (!response.success) { failure(response.error, response.errorCode); return; }
        setContext(response.context);
        if (request.name && !response.link) { failure('dblink_missing'); return; }
        if (response.link) {
          apply(response.link, same); setPhase(undefined);
          if (props.isNew && completed.current) notifyCreated(response.link);
          completed.current = null;
        } else setReady(true);
        loaded.current = identity;
      } catch { if (valid()) failure('dblink_load_failed'); }
      finally { endLoading(); }
    })();
    return () => { cancelled = true; };
  }, [props.isActive, props.isNew, props.schema, props.dbLinkName, identity, reload, beginLoading, endLoading, failure, apply, notifyCreated]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!isResizing) return;
    const move = (event: MouseEvent) => setConsoleWidth(Math.max(200, Math.min(800, window.innerWidth - event.clientX)));
    const up = () => setIsResizing(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [isResizing]);
  const setFormData = (change: SetStateAction<DbLinkForm>) => {
    if (isBusy()) return;
    setForm(current => {
      const next = typeof change === 'function' ? change(current) : change;
      return props.isNew ? next : { ...next, name: props.dbLinkName, isPublic: props.schema === 'PUBLIC' };
    });
    setTestResult(null);
  };
  const owned = context && saved && (saved.schema === context.user || saved.schema === 'PUBLIC');
  const canDelete = Boolean(ready && !isLoading && saved?.editable && owned && !context?.readonly && (saved.schema !== 'PUBLIC' || context.dropPublic));
  const canTest = Boolean(ready && !isLoading && saved && owned);
  const canExecute = Boolean((ready || phase === 'dropped-only') && !completed.current && !isLoading && !plan.error && plan.kind !== 'unchanged');
  const retry = () => { if (!isBusy()) setReload(value => value + 1); };
  const copy = async (kind: 'saved' | 'pending') => {
    const ticket = generation.current;
    try { await navigator.clipboard.writeText(kind === 'saved' ? saved?.source || '' : plan.sql); }
    catch { if (ticket === generation.current) failure('dblink_copy_failed'); }
  };
  const refreshSidebar = (owner: string) => window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: owner, objType: 'DATABASE LINK' } }));
  const execute = async (drop = false) => {
    if (isBusy() || (drop ? !canDelete : !canExecute)) return;
    if (!context) return;
    const owner = saved?.schema || (form.isPublic ? 'PUBLIC' : context.user), name = saved?.name || fullLinkName(form.name, context.domain);
    const target = `${owner}.${name}`;
    if (drop && !window.confirm(t('dblink_delete_confirm', { target }))) return;
    if (!drop && plan.kind === 'recreate' && !window.confirm(t('dblink_recreate_confirm', { target }))) return;
    if (!drop && form.isPublic && (props.isNew || phase === 'dropped-only') && !window.confirm(t('dblink_public_confirm', { target }))) return;
    const sql = drop ? `DROP ${owner === 'PUBLIC' ? 'PUBLIC ' : ''}DATABASE LINK ${name};` : plan.sql;
    const ticket = generation.current, currentIdentity = identity;
    const valid = () => ticket === generation.current && identityRef.current === currentIdentity;
    beginLoading(); setError(''); setErrorCode(''); setTestResult(null);
    try {
      const response = await ipcRenderer.invoke('save-oracle-dblink', { schema: owner, name, action: drop ? 'drop' : props.isNew || phase === 'dropped-only' ? 'create' : 'save',
        ...(drop ? {} : { form: { ...form } }), expected: saved?.fingerprint, confirmRecreate: plan.kind === 'recreate' });
      if (!valid()) return;
      if (!response.success) {
        setReady(false); setPhase(response.phase || (phase === 'dropped-only' ? 'dropped-only' : undefined));
        if (response.phase) {
          refreshSidebar(owner);
          if (response.phase !== 'dropped-only') { completed.current = { schema: owner, name }; setForm(current => ({ ...current, password: '' })); }
        }
        failure(response.error, response.errorCode, sql); return;
      }
      setPhase(response.phase); setForm(current => ({ ...current, password: '' }));
      setLogs(previous => [{ time: new Date().toLocaleString(), sql, message: 'success', code: '' }, ...previous]); setConsoleOpen(true);
      refreshSidebar(owner);
      if (drop) {
        setReady(false);
        window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: owner, objectName: name, objectType: 'DATABASE LINK' } }));
        window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: props.tabId } }));
      } else if (response.link) {
        apply(response.link, false); setPhase(undefined);
        if (props.isNew) notifyCreated(response.link);
      } else { setReady(false); completed.current = { schema: owner, name }; failure('dblink_load_failed'); }
    } catch { if (valid()) { setReady(false); failure('dblink_operation_failed', '', sql); } }
    finally { endLoading(); }
  };
  const testConnection = async () => {
    if (isBusy() || !canTest || !saved) return;
    const ticket = generation.current;
    beginLoading(); setTestResult(null); setError(''); setErrorCode('');
    try {
      const response = await ipcRenderer.invoke('test-oracle-dblink', { schema: saved.schema, name: saved.name, expected: saved.fingerprint });
      if (ticket !== generation.current) return;
      if (!response.success) failure(response.error, response.errorCode);
      else setTestResult(response.elapsedMs);
    } catch { if (ticket === generation.current) failure('dblink_test_failed'); }
    finally { endLoading(); }
  };
  return { form, setFormData, context, saved, ready, isLoading, error, errorCode, phase, plan,
    activeTab, setActiveTab, logs, setLogs, consoleOpen, setConsoleOpen, consoleWidth, isResizing, setIsResizing,
    canDelete, canExecute, canTest, retry, copy, execute, testConnection, testResult };
}
