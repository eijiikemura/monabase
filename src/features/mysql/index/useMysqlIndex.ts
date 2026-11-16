// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { TransactionState } from '@/shared/api/desktopContract';
import { loadTableMetadata } from '../table/tableRepository';
import type { MysqlColumn, MysqlStatement } from '../table/tableModel';
import { mainTransferQuery } from '../sidebarDataTransfer';
import { blankIndexForm, changeIndexStatement, createIndexStatement, type MysqlIndexForm } from './indexModel';
import { dropIndexStatement, loadMysqlIndex, type MysqlIndexDetails } from './indexRepository';

export type MysqlIndexAction = 'delete' | 'visibility' | 'rename';
export interface MysqlIndexProps {
  request?: { id: string; kind: MysqlIndexAction };
  schema: string; object?: DatabaseObject; active: boolean; busy: boolean; readonly: boolean; theme: string;
  setBusy: (busy: boolean) => void; onState: (state: TransactionState) => void;
  onChanged: (object: DatabaseObject) => void; onDropped: () => void;
}
export function useMysqlIndex(props: MysqlIndexProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState(() => blankIndexForm(props.schema));
  const [columns, setColumns] = useState<MysqlColumn[]>([]), [details, setDetails] = useState<MysqlIndexDetails>();
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [review, setReview] = useState<{ statement: MysqlStatement; drop: boolean; fingerprint?: string; form: MysqlIndexForm }>();
  const [attempted, setAttempted] = useState(false), [logs, setLogs] = useState<{ sql: string; message: string; time: string }[]>([]);
  const version = useRef(0), mounted = useRef(true), running = useRef(false), attemptedRef = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocked = props.busy || props.readonly || loading || !columns.length || Boolean(props.object && !details);
  const load = useEventCallback(async () => {
    if (!props.object && !form.table) return;
    const token = ++version.current; setLoading(true); setError(''); setDetails(undefined); setReview(undefined);
    try {
      if (props.object) {
        const next = await loadMysqlIndex(props.object);
        if (!mounted.current || token !== version.current) return;
        setDetails(next); setColumns(next.metadata.columns);
        setForm({ schema: props.object.schema, table: props.object.parentName || '', name: props.object.name,
          type: next.definition.startsWith('SPATIAL ') ? 'SPATIAL' : next.definition.startsWith('FULLTEXT ') ? 'FULLTEXT' : next.keys[0].INDEX_TYPE === 'HASH' ? 'HASH' : 'BTREE',
          unique: next.unique, visible: next.visible, parts: next.keys.map(row => ({ column: String(row.COLUMN_NAME || ''), expression: String(row.EXPRESSION || ''), prefix: row.SUB_PART == null ? '' : String(row.SUB_PART), descending: row.COLLATION === 'D' })) });
      } else {
        const next = await loadTableMetadata(form.schema, form.table);
        if (mounted.current && token === version.current) setColumns(next.columns);
      }
    } catch (failure) { if (mounted.current && token === version.current) setError(failure instanceof Error ? failure.message : t('index_load_failed')); }
    finally { if (mounted.current && token === version.current) setLoading(false); }
  });
  useEffect(() => { void load(); }, [props.object?.key, form.schema, form.table, load]);
  const update = (next: Partial<MysqlIndexForm>) => {
    if (props.busy || props.readonly || loading) return;
    if (next.table !== undefined || next.schema !== undefined) { version.current++; setColumns([]); setDetails(undefined); next = { ...next, parts: [] }; }
    setForm(previous => ({ ...previous, ...next })); setError(''); setReview(undefined); setAttempted(false); attemptedRef.current = false;
  };
  const prepare = (drop = false) => {
    if (blocked || running.current || props.object && !details) return;
    try {
      const statement = drop && props.object && details ? dropIndexStatement(props.object, details)
        : props.object && details ? changeIndexStatement(form.schema, form.table, props.object.name, form.name, form.visible, details.visible)
        : createIndexStatement(form, columns);
      setReview({ statement, drop, fingerprint: details?.fingerprint, form }); setAttempted(false); attemptedRef.current = false; setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
  };
  const handledRequest = useRef('');
  const prepareRequested = useEventCallback(() => {
    const request = props.request;
    if (!request || request.id === handledRequest.current || !details || loading || props.busy || !props.object) return;
    handledRequest.current = request.id;
    if (request.kind === 'rename') return;
    if (props.readonly) return;
    try {
      const next = { ...form, name: props.object.name, visible: request.kind === 'visibility' ? !details.visible : details.visible };
      if (request.kind === 'visibility' && (details.primary || details.references.length)) throw new Error(t('mysql_index_foreign_keys', { names: details.references.join(', ') }));
      const statement = request.kind === 'delete' ? dropIndexStatement(props.object, details)
        : changeIndexStatement(next.schema, next.table, props.object.name, next.name, next.visible, details.visible);
      setForm(next); setError(''); setReview({ statement, drop: request.kind === 'delete', fingerprint: details.fingerprint, form: next });
      setAttempted(false); attemptedRef.current = false;
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
  });
  useEffect(() => { prepareRequested(); }, [props.request?.id, details, loading, props.busy, prepareRequested]);
  const execute = async () => {
    if (!review || blocked || running.current || attemptedRef.current) return;
    running.current = true; attemptedRef.current = true; setAttempted(true); props.setBusy(true); setError('');
    let applied = false;
    try {
      if (props.object) {
        const current = await loadMysqlIndex(props.object);
        if (current.fingerprint !== review.fingerprint) throw new Error(t('index_changed_reload'));
        if (review.drop) dropIndexStatement(props.object, current);
      }
      await mainTransferQuery(review.statement.sql, review.statement.binds, props.onState);
      applied = true;
      if (review.drop) props.onDropped();
      else {
        const { schema, table, name } = review.form;
        props.onChanged({ key: JSON.stringify(['mysql', schema, 'INDEX', table, name]), dbType: 'mysql', category: 'INDEX', schema, parentName: table, name, displayName: `${name} (${table})` });
        if (props.object?.name === name) await load();
      }
      setReview(undefined);
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : t('execution_failed')); }
    finally {
      const message = applied ? t('success') : t('execution_failed');
      if (mounted.current) setLogs(previous => [...previous.slice(-99), { sql: review.statement.sql, message, time: new Date().toLocaleTimeString() }]);
      running.current = false; props.setBusy(false);
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: review.form.schema, objType: 'INDEX' } }));
      window.dispatchEvent(new CustomEvent('reload-source', { detail: { schema: review.form.schema, tableName: review.form.table } }));
      window.dispatchEvent(new CustomEvent('reload-statistics', { detail: { schema: review.form.schema, tableName: review.form.table } }));
      window.dispatchEvent(new Event('mysql-transaction-finished'));
    }
  };
  const closeReview = () => { if (!running.current) { setReview(undefined); setError(''); } };
  return { form, update, columns, details, loading, error, blocked, load, prepare, review, closeReview, attempted, execute, logs, clearLogs: () => setLogs([]) };
}
