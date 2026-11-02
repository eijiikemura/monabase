// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { OracleLock, OracleLockSnapshot } from '@/shared/types/oracleLockTypes';

export function useLockTab(isActive: boolean) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<OracleLockSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [acting, setActing] = useState(false);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<'all' | 'waiting' | 'blocking'>('all');
  const [refreshSeconds, setRefreshSeconds] = useState(0);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const alive = useRef(false), active = useRef(isActive), ticket = useRef(0), reading = useRef(0), writing = useRef(false), selectedRef = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const select = (id: string | null) => { selectedRef.current = id; setSelectedId(id); };
  const load = useEventCallback(async () => {
    if (!alive.current || !active.current || reading.current || writing.current) return false;
    const request = ++ticket.current; reading.current = request;
    setReady(false); setLoading(true); setError(''); setErrorCode('');
    try {
      const result = await ipcRenderer.invoke('list-oracle-locks');
      if (!alive.current || !active.current || request !== ticket.current) return false;
      if (!result.success) { setError(result.error); setErrorCode(result.errorCode || ''); return false; }
      setSnapshot(result); setReady(true);
      if (selectedRef.current && !result.locks.some(row => row.id === selectedRef.current)) select(null);
      return true;
    } catch {
      if (alive.current && active.current && request === ticket.current) setError('lock_read_failed');
      return false;
    } finally {
      if (reading.current === request) reading.current = 0;
      if (alive.current && request === ticket.current) setLoading(false);
    }
  });
  useEffect(() => {
    active.current = isActive;
    if (!isActive) { ticket.current++; reading.current = 0; setReady(false); setLoading(false); return; }
    void load();
  }, [isActive, load]);
  useEffect(() => {
    if (!isActive || refreshSeconds === 0) return;
    const timer = setInterval(() => { void load(); }, refreshSeconds * 1000);
    return () => clearInterval(timer);
  }, [isActive, refreshSeconds, load]);
  useEffect(() => { setPagination(previous => ({ ...previous, page: 0 })); }, [filter, search]);
  const rows = useMemo(() => (snapshot?.locks || []).filter(row => {
    if (filter === 'waiting' && row.REQUEST_MODE === 0) return false;
    if (filter === 'blocking' && row.WAITERS === 0 && row.BLOCK !== 1 && row.BLOCK !== 2) return false;
    const text = [row.SID, row.USERNAME, row.OSUSER, row.PROGRAM, row.MACHINE, row.OBJECT_OWNER, row.OBJECT_NAME, `${row.OBJECT_OWNER}.${row.OBJECT_NAME}`, row.EVENT, row.SQL_ID].join(' ').toLowerCase();
    return text.includes(search.toLowerCase());
  }), [filter, search, snapshot]);
  const selected = snapshot?.locks.find(row => row.id === selectedId) || null;
  const blocker = selected?.BLOCKING_SID && selected.BLOCKING_INSTANCE === snapshot?.context.instance
    ? snapshot.locks.find(row => row.SID === selected.BLOCKING_SID && row.CON_ID === selected.CON_ID && row.INSTANCE_ID === selected.BLOCKING_INSTANCE) || null : null;
  const canKill = ready && !loading && !acting && !!snapshot?.context.canKill && !!selected && !selected.protected && rows.some(row => row.id === selected.id);
  const inspectBlocker = () => { if (!ready || !blocker) return; setFilter('all'); setSearch(''); select(blocker.id); setPagination(previous => ({ ...previous, page: 0 })); };
  const killSelected = useEventCallback(async () => {
    if (!canKill || !selected || writing.current || reading.current) return;
    const target: OracleLock = selected;
    writing.current = true;
    try {
      if (!window.confirm(t('lock_kill_confirm', { sid: target.SID, serial: target.SERIAL, user: target.USERNAME, program: target.PROGRAM, instance: target.INSTANCE_ID, container: target.CON_ID }))) return;
      setActing(true); setError(''); setNotice('');
      const result = await ipcRenderer.invoke('terminate-oracle-lock-session', { id: target.id, fingerprint: target.fingerprint });
      if (!alive.current || !active.current) return;
      if (!result.success) { setError(result.error); setErrorCode(result.errorCode || ''); setReady(false); return; }
      setNotice(result.status === 'marked' ? 'lock_kill_marked' : 'lock_kill_requested');
      writing.current = false;
      await load();
    } catch { if (alive.current && active.current) { setError('lock_operation_failed'); setReady(false); } }
    finally { writing.current = false; if (alive.current) setActing(false); }
  });
  const copySql = async (text: string) => {
    try { const result = await ipcRenderer.invoke('copy-to-clipboard', text); if (!result) throw new Error('Copy failed'); }
    catch { setError('lock_copy_failed'); }
  };
  return { t, snapshot, rows, selected, selectedId, select, blocker, inspectBlocker, canKill, killSelected, copySql,
    ready, loading, acting, error, errorCode, notice, load, search, setSearch, filter, setFilter, refreshSeconds, setRefreshSeconds, pagination, setPagination };
}
