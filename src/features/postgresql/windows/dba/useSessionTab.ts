// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { PostgresSessionSnapshot, PostgresSessionCommand } from '@/shared/types/postgresSessionTypes';
export function useSessionTab(isActive: boolean) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<PostgresSessionSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [acting, setActing] = useState(false);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<'all' | 'active' | 'idle-transaction' | 'waiting' | 'idle'>('all');
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [refreshSeconds, setRefreshSeconds] = useState(0), [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const alive = useRef(false), active = useRef(isActive), generation = useRef(0), reading = useRef(false), writing = useRef(false), selectedRef = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const select = (id: string | null) => { if (writing.current) return; selectedRef.current = id; setSelectedId(id); };
  const load = useEventCallback(async () => {
    if (!alive.current || !active.current || reading.current || writing.current) return;
    const version = generation.current; reading.current = true; setLoading(true); setReady(false); setError(''); setErrorCode('');
    try {
      const response = await ipcRenderer.invoke('list-postgres-sessions');
      if (!alive.current || !active.current || generation.current !== version) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response); setReady(true);
      if (selectedRef.current && !response.sessions.some(row => row.id === selectedRef.current)) select(null);
    } catch { if (alive.current && active.current && generation.current === version) setError('pg_session_read_failed'); }
    finally {
      reading.current = false;
      if (alive.current && active.current) { setLoading(false); if (generation.current !== version) void load(); }
    }
  });
  useEffect(() => {
    active.current = isActive; generation.current++; setReady(false);
    if (isActive) void load(); else setLoading(false);
  }, [isActive, load]);
  useEffect(() => { if (!isActive || !refreshSeconds) return; const timer = setInterval(() => { void load(); }, refreshSeconds * 1000); return () => clearInterval(timer); }, [isActive, refreshSeconds, load]);
  useEffect(() => { setPagination(previous => ({ ...previous, page: 0 })); }, [search, filter, scope]);
  const rows = useMemo(() => (snapshot?.sessions || []).filter(row => {
    if (scope === 'current' && row.databaseId !== snapshot?.context.databaseId) return false;
    if (filter === 'active' && row.state !== 'active') return false;
    if (filter === 'idle-transaction' && !row.state?.startsWith('idle in transaction')) return false;
    if (filter === 'waiting' && !row.waitType) return false;
    if (filter === 'idle' && row.state !== 'idle') return false;
    return [row.pid, row.database, row.username, row.program, row.address, row.backendType, row.state, row.waitType, row.waitEvent, row.query].join(' ').toLowerCase().includes(search.toLowerCase());
  }), [snapshot, filter, scope, search]);
  const selected = snapshot?.sessions.find(row => row.id === selectedId) || null;
  const blockers = [...new Map((snapshot?.sessions || []).filter(row => row.pid != null && selected?.blockers.includes(row.pid)).map(row => [row.pid, row])).values()];
  const can = (action: PostgresSessionCommand['action']) => isActive && ready && !loading && !acting && !!selected && rows.some(row => row.id === selected.id) && (action === 'cancel' ? selected.canCancel : selected.canTerminate);
  const inspectBlocker = (pid: number) => {
    const target = blockers.find(row => row.pid === pid); if (!target || !ready || loading || acting) return;
    setFilter('all'); setScope('all'); setSearch(''); select(target.id); setPagination(previous => ({ ...previous, page: 0 }));
  };
  const command = useEventCallback(async (action: PostgresSessionCommand['action']) => {
    if (!can(action) || !selected || reading.current || writing.current) return;
    const target = selected, version = generation.current; writing.current = true;
    try {
      if (!window.confirm(t(action === 'cancel' ? 'pg_lock_cancel_confirm' : 'pg_lock_terminate_confirm', { pid: target.pid, user: target.username, database: target.database, program: target.program, start: target.backendStart }))) return;
      setActing(true); setError(''); setErrorCode(''); setNotice(''); setReady(false);
      const response = await ipcRenderer.invoke('manage-postgres-session', { action, id: target.id, fingerprint: target.fingerprint });
      if (!alive.current || !active.current || version !== generation.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setNotice(response.observationFailed ? 'pg_session_observation_failed' : response.status === 'ended' ? 'pg_session_ended' : response.status === 'query-ended' ? 'pg_session_query_ended' : 'pg_session_requested');
      writing.current = false; await load();
    } catch { if (alive.current && active.current && version === generation.current) { setError('pg_session_outcome_unknown'); setReady(false); } }
    finally {
      writing.current = false;
      if (alive.current) { setActing(false); if (active.current && version !== generation.current) void load(); }
    }
  });
  const copy = async () => { if (!selected?.query) return; try { if (!await ipcRenderer.invoke('copy-to-clipboard', selected.query)) throw Error('Copy failed'); } catch { setError('lock_copy_failed'); } };
  return { snapshot, rows, selected, selectedId, select, ready, loading, acting, error, errorCode, notice, search, setSearch, filter, setFilter, scope, setScope, refreshSeconds, setRefreshSeconds, pagination, setPagination, blockers, inspectBlocker, can, command, load, copy };
}
