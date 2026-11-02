// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { OracleSession, OracleSessionSnapshot, OracleSessionDetail } from '@/shared/types/oracleSessionTypes';
export function useSessionTab(isActive: boolean) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<OracleSessionSnapshot | null>(null), [detail, setDetail] = useState<OracleSessionDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false), [detailReady, setDetailReady] = useState(false);
  const [loading, setLoading] = useState(false), [detailLoading, setDetailLoading] = useState(false), [acting, setActing] = useState(false);
  const [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [detailErrorCode, setDetailErrorCode] = useState(''), [errorCode, setErrorCode] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<'all' | 'active' | 'waiting'>('all'), [refreshSeconds, setRefreshSeconds] = useState(0);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const alive = useRef(false), active = useRef(isActive), ticket = useRef(0), detailTicket = useRef(0), reading = useRef(false), detailing = useRef(0), writing = useRef(false), selectedRef = useRef<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const select = (id: string | null) => { if (writing.current || id === selectedRef.current) return; selectedRef.current = id; detailTicket.current++; detailing.current = 0; setDetailLoading(false); setSelectedId(id); setDetail(null); setDetailReady(false); setDetailError(''); setDetailErrorCode(''); };
  const loadDetail = useEventCallback(async (row: OracleSession) => {
    if (!alive.current || !active.current || writing.current) return;
    const id = ++detailTicket.current; detailing.current = id; setDetailReady(false); setDetailLoading(true); setDetailError(''); setDetailErrorCode('');
    const valid = () => alive.current && active.current && id === detailTicket.current && row.id === selectedRef.current;
    try {
      const response = await ipcRenderer.invoke('get-oracle-session-detail', { id: row.id, fingerprint: row.fingerprint });
      if (!valid()) return;
      if (!response.success) { setDetailError(response.error); setDetailErrorCode(response.errorCode || ''); return; }
      if (response.sessionId !== row.id || response.fingerprint !== row.fingerprint || response.execution !== row.execution) { setDetailError('session_sql_changed'); return; }
      setDetail(response); setDetailReady(true);
    } catch { if (valid()) setDetailError('session_detail_failed'); }
    finally { if (detailing.current === id) detailing.current = 0; if (alive.current && id === detailTicket.current) setDetailLoading(false); }
  });
  const load = useEventCallback(async () => {
    if (!alive.current || !active.current || reading.current || writing.current) return;
    const id = ++ticket.current; reading.current = true; setReady(false); setDetailReady(false); setLoading(true); setError(''); setErrorCode('');
    try {
      const response = await ipcRenderer.invoke('list-oracle-sessions');
      if (!alive.current || !active.current || id !== ticket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response); setReady(true);
      const selected = response.sessions.find(row => row.id === selectedRef.current);
      if (!selected && selectedRef.current) select(null);
    } catch { if (alive.current && active.current && id === ticket.current) setError('session_read_failed'); }
    finally { if (id === ticket.current) { reading.current = false; if (alive.current) setLoading(false); } }
  });
  useEffect(() => {
    active.current = isActive;
    if (isActive) void load();
    else { ticket.current++; detailTicket.current++; reading.current = false; detailing.current = 0; setReady(false); setDetailReady(false); setLoading(false); setDetailLoading(false); }
  }, [isActive, load]);
  const selected = snapshot?.sessions.find(row => row.id === selectedId) || null;
  useEffect(() => { if (isActive && selected) void loadDetail(selected); }, [isActive, selected, loadDetail]);
  useEffect(() => { if (!isActive || !refreshSeconds) return; const timer = setInterval(() => { if (!reading.current && !detailing.current && !writing.current) void load(); }, refreshSeconds * 1000); return () => clearInterval(timer); }, [isActive, refreshSeconds, load]);
  useEffect(() => { setPagination(previous => ({ ...previous, page: 0 })); }, [filter, search]);
  const rows = useMemo(() => (snapshot?.sessions || []).filter(row => (filter !== 'active' || row.STATUS === 'ACTIVE') && (filter !== 'waiting' || row.STATE === 'WAITING' && row.WAIT_CLASS !== 'Idle')
    && [row.SID, row.SERIAL, row.USERNAME, row.OSUSER, row.PROGRAM, row.MACHINE, row.SQL_ID, row.EVENT].join(' ').toLowerCase().includes(search.toLowerCase())), [snapshot, filter, search]);
  const currentDetail = detail?.sessionId === selected?.id ? detail : null;
  const canKill = isActive && ready && !loading && !acting && !detailLoading && Boolean(snapshot?.context.canManage) && Boolean(selected && !selected.protected && selected.STATUS !== 'KILLED' && rows.some(row => row.id === selected.id));
  const canCancel = canKill && Boolean(snapshot?.context.cancelSupported && selected?.STATUS === 'ACTIVE' && selected.SQL_ID && selected.SQL_EXEC_ID && selected.SQL_EXEC_START && detailReady && currentDetail?.execution === selected.execution);
  const command = useEventCallback(async (action: 'kill' | 'cancel') => {
    if (!(action === 'kill' ? canKill : canCancel) || !selected || writing.current || reading.current || detailing.current) return;
    writing.current = true;
    const generation = ticket.current;
    try {
      if (!window.confirm(t(action === 'kill' ? 'session_kill_confirm' : 'session_cancel_confirm', { sid: selected.SID, serial: selected.SERIAL, user: selected.USERNAME, program: selected.PROGRAM, instance: selected.INSTANCE_ID, container: selected.CON_ID, sql: selected.SQL_ID }))) return;
      setActing(true); setError(''); setErrorCode(''); setNotice(''); setReady(false); setDetailReady(false);
      const response = await ipcRenderer.invoke('manage-oracle-session', { action, id: selected.id, fingerprint: selected.fingerprint, ...(action === 'cancel' ? { execution: selected.execution } : {}) });
      if (!alive.current || !active.current) return;
      if (generation !== ticket.current) { writing.current = false; await load(); return; }
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setNotice(action === 'cancel' ? 'session_cancel_requested' : response.status === 'marked' ? 'session_kill_marked' : 'session_kill_requested');
      writing.current = false; await load();
    } catch { if (alive.current && active.current) { if (generation !== ticket.current) { writing.current = false; await load(); } else { setError('session_outcome_unknown'); setReady(false); } } }
    finally { writing.current = false; if (alive.current) setActing(false); }
  });
  const reload = async () => { if (reading.current || writing.current || detailing.current) return; await load(); };
  const retryDetail = async () => { if (selected && ready && !detailing.current && !writing.current) await loadDetail(selected); };
  const copy = async (text: string) => { try { if (!await ipcRenderer.invoke('copy-to-clipboard', text)) throw new Error('Copy failed'); } catch { setDetailError('session_copy_failed'); } };
  return { snapshot, rows, selected, selectedId, select, detail: currentDetail, ready, detailReady, loading, detailLoading, acting, error, detailError, detailErrorCode, errorCode, notice,
    search, setSearch, filter, setFilter, refreshSeconds, setRefreshSeconds, pagination, setPagination, canKill, canCancel, command, reload, retryDetail, copy };
}
