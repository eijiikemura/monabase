// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { runGitOperation } from '@/features/git/gitOperation';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { AppSettings } from '@/shared/types/appTypes';
import { mainTransferQuery } from '../sidebarDataTransfer';
import { mysqlTableName } from '../table/tableModel';
import { loadMysqlView, type MysqlViewDetails } from './viewRepository';
import { mysqlViewStatement } from './viewModel';

export interface MysqlViewProps {
  object: DatabaseObject; tabId: number; active: boolean; busy: boolean; readonly: boolean; disabled: boolean; settings: AppSettings;
  request?: string; setBusy: (busy: boolean) => void; onState: (state: TransactionState) => void; onDropped: () => void;
}
export function useMysqlView(props: MysqlViewProps) {
  const { t } = useTranslation(), { object } = props;
  const [text, setDraft] = useState(''), [saved, setSaved] = useState(''), [details, setDetails] = useState<MysqlViewDetails>();
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [dataRevision, setDataRevision] = useState(0);
  const [review, setReview] = useState<{ drop: boolean; sql: string; text: string; fingerprint: string }>();
  const [attempted, setAttempted] = useState(false), [logs, setLogs] = useState<{ sql: string; message: string }[]>([]);
  const version = useRef(0), running = useRef(false), attemptedRef = useRef(false), mounted = useRef(true), baseline = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useEventCallback(async () => {
    const token = ++version.current, before = baseline.current; setLoading(true); setError(''); setReview(undefined);
    try {
      const next = await loadMysqlView(object);
      if (!mounted.current || token !== version.current) return;
      baseline.current = next.source; setSaved(next.source); setDetails(next);
      setDraft(previous => !before || previous === before ? next.source : previous);
    } catch (failure) { if (mounted.current && token === version.current) { setError(failure instanceof Error ? failure.message : t('execution_failed')); setDetails(undefined); } }
    finally { if (mounted.current && token === version.current) setLoading(false); }
  });
  useEffect(() => { void load(); }, [object.key, load]);
  const locked = props.busy || props.disabled || props.readonly || loading || !details;
  const setText = (value: string) => { if (props.busy || loading || props.readonly || props.disabled) return; setDraft(value); setReview(undefined); };
  const prepare = useEventCallback((drop: boolean = false) => {
    if (locked || running.current || !details) return;
    try {
      if (drop && details.metadata.dependents.length) throw new Error(t('mysql_view_dependents_blocked'));
      const statement = drop ? `DROP VIEW ${mysqlTableName(object.schema, object.name)}` : mysqlViewStatement(text, object.schema, object.name).sql;
      setReview({ sql: statement, text, drop, fingerprint: details.fingerprint }); setAttempted(false); attemptedRef.current = false; setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
  });
  const handled = useRef('');
  useEffect(() => {
    if (props.request && handled.current !== props.request && !locked) { handled.current = props.request; prepare(true); }
  }, [props.request, locked, prepare]);
  const execute = async () => {
    if (locked || !review || !details || running.current || attemptedRef.current || review.text !== text) return;
    running.current = true; attemptedRef.current = true; setAttempted(true); props.setBusy(true); setError('');
    let applied = false, message = '';
    try {
      const current = await loadMysqlView(object);
      if (current.fingerprint !== review.fingerprint) throw new Error(t('mysql_view_changed_reload'));
      if (review.drop && current.metadata.dependents.length) throw new Error(t('mysql_view_dependents_blocked'));
      await mainTransferQuery(review.sql, {}, props.onState, object.schema); applied = true;
      // Invalidate data even if source/Git refresh fails after the DDL was applied.
      setDataRevision(value => value + 1); setReview(undefined);
      if (review.drop) {
        const git = await runGitOperation(t, 'git-delete-object', { dbType: 'MYSQL', schema: object.schema, objectType: 'VIEW', objectName: object.name });
        if (!git.success) window.alert(t('mysql_view_git_failed'));
        props.onDropped();
      } else {
        setDraft(review.sql); setSaved(review.sql); baseline.current = review.sql;
        const next = await loadMysqlView(object);
        if (mounted.current) { setDetails(next); setDraft(next.source); setSaved(next.source); baseline.current = next.source; }
        const git = await runGitOperation(t, 'git-commit', { dbType: 'MYSQL', schema: object.schema, objectType: 'VIEW', objectName: object.name, sourceText: next.native, message: `Update view ${object.name}` });
        if (!git.success && mounted.current) setError(t('mysql_view_git_failed'));
      }
      message = t('success');
    } catch (failure) {
      message = failure instanceof Error ? failure.message : t('execution_failed');
      if (mounted.current) { setError((applied ? t('mysql_view_applied_refresh_failed') + ' ' : '') + message); if (applied) setDetails(undefined); }
    } finally {
      if (mounted.current) setLogs(previous => [...previous.slice(-99), { sql: review.sql, message }]);
      running.current = false; props.setBusy(false);
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: object.schema, objType: 'VIEW' } }));
      window.dispatchEvent(new Event('mysql-transaction-finished'));
    }
  };
  return { text, setText, saved, details, loading, error, dataRevision, review, attempted, logs, locked, load, prepare, execute,
    closeReview: () => { if (!running.current) setReview(undefined); }, clearLogs: () => setLogs([]) };
}
