// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { TablespaceSnapshot, TablespaceDetail, TablespaceOperation, TablespaceReview, TablespaceOutcome, ManagedTablespace } from '@/shared/types/oracleTablespaceTypes';
const initial = (): TablespaceOperation => ({ action: 'create', name: '', sizeMb: '100', autoExtend: true, nextMb: '10', maxMb: '1024', bigfile: false, pathMode: 'omf', path: '' });
const ceilMb = (value: string) => String((BigInt(value) + 1048575n) / 1048576n);
const floorMb = (value: string) => String(BigInt(value) / 1048576n);
export function useTablespaceTab(isActive: boolean) {
  const [snapshot, setSnapshot] = useState<TablespaceSnapshot | null>(null), [detail, setDetail] = useState<TablespaceDetail | null>(null);
  const [ready, setReady] = useState(false), [detailReady, setDetailReady] = useState(false), [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState(''), [detailError, setDetailError] = useState(''), [errorCode, setErrorCode] = useState('');
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all');
  const [dialog, setDialog] = useState(false), [draft, setDraft] = useState<TablespaceOperation>(initial), [review, setReview] = useState<TablespaceReview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [confirmName, setConfirmName] = useState('');
  const [outcome, setOutcome] = useState<TablespaceOutcome | null>(null);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const alive = useRef(false), active = useRef(isActive), ticket = useRef(0), detailTicket = useRef(0), dialogTicket = useRef(0), writing = useRef(false), selectedRef = useRef('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const rows = (snapshot?.tablespaces || []).filter(row => (kind === 'all' || kind === row.kind) && row.name.toLowerCase().includes(search.toLowerCase()));
  const selected = snapshot?.tablespaces.find(row => row.id === selectedId) || null;
  const currentDetail = detail?.target.id === selectedId ? detail : null;
  const loadDetail = useEventCallback(async (target: ManagedTablespace) => {
    const id = ++detailTicket.current; beginLoading(); setDetailReady(false); setDetailError('');
    const valid = () => alive.current && active.current && id === detailTicket.current && selectedRef.current === target.id;
    try {
      const response = await ipcRenderer.invoke('get-oracle-tablespace-detail', { id: target.id, expected: target.fingerprint });
      if (!valid()) return;
      if (!response.success) { setDetailError(response.error); setErrorCode(response.errorCode || ''); return; }
      setDetail(response); setDetailReady(true);
    } catch { if (valid()) setDetailError('ts_detail_failed'); }
    finally { endLoading(); }
  });
  const load = useEventCallback(async () => {
    const id = ++ticket.current; setReady(false); setDetailReady(false); setError(''); setErrorCode(''); beginLoading();
    try {
      const response = await ipcRenderer.invoke('list-oracle-tablespaces');
      if (!alive.current || !active.current || id !== ticket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response); setReady(true);
      const target = response.tablespaces.find(row => row.id === selectedRef.current);
      if (!target) { selectedRef.current = ''; setSelectedId(''); setDetail(null); }
      setDraft(previous => {
        if (previous.action === 'create') return previous;
        const current = response.tablespaces.find(row => row.id === previous.id);
        return current ? { ...previous, expected: current.fingerprint } : previous;
      });
    } catch { if (alive.current && active.current && id === ticket.current) setError('ts_load_failed'); }
    finally { endLoading(); }
  });
  useEffect(() => {
    active.current = isActive;
    if (isActive) void load();
    else { ticket.current++; detailTicket.current++; dialogTicket.current++; setReady(false); setDetailReady(false); setDialog(false); setReview(null); }
  }, [isActive, load]);
  useEffect(() => { if (isActive && selected) void loadDetail(selected); }, [isActive, selected, loadDetail]);
  const select = (id: string) => { if (writing.current || id === selectedRef.current) return; selectedRef.current = id; detailTicket.current++; setSelectedId(id); setDetail(null); setDetailReady(false); setDetailError(''); };
  const can = (action: TablespaceOperation['action']) => {
    const ctx = snapshot?.context;
    if (!isActive || !ready || isLoading || !ctx || ctx.readonly || !ctx.protectionReady) return false;
    if (action === 'create') return ctx.canCreate;
    if (!selected || !rows.some(row => row.id === selected.id) || selected.protected || selected.status !== 'ONLINE' || !detailReady) return false;
    if (action === 'drop') return ctx.canDrop && !selected.dropProtected && !currentDetail?.users.length;
    return ctx.canAlter && (action === 'resize' ? selected.bigfile : !selected.bigfile);
  };
  const open = (action: TablespaceOperation['action']) => {
    if (!can(action) || isBusy()) return;
    dialogTicket.current++; setReview(null); setError(''); setErrorCode(''); setAcknowledged(false); setConfirmName(''); setOutcome(null);
    const file = currentDetail?.files[0];
    setDraft({ ...initial(), action, name: action === 'create' ? '' : selected?.name || '', id: selected?.id, expected: selected?.fingerprint,
      pathMode: snapshot?.context.omf ? 'omf' : 'path', bigfile: action === 'create' ? false : selected?.bigfile,
      ...(action === 'resize' && file ? { sizeMb: ceilMb(file.bytes), autoExtend: file.autoExtend, nextMb: ceilMb(file.nextBytes) === '0' ? '1' : ceilMb(file.nextBytes), maxMb: file.maxBytes ? floorMb(file.maxBytes) : ceilMb(file.bytes) } : {}) });
    setDialog(true);
  };
  const update = (values: Partial<TablespaceOperation>) => { if (isBusy()) return; setDraft(previous => ({ ...previous, ...values })); setReview(null); setAcknowledged(false); setConfirmName(''); };
  const close = () => { if (isBusy()) return; dialogTicket.current++; setDialog(false); setReview(null); };
  const prepare = async () => {
    if (!dialog || !ready || isBusy()) return;
    const id = dialogTicket.current; beginLoading(); setError(''); setErrorCode(''); setReview(null); setAcknowledged(false);
    try {
      const response = await ipcRenderer.invoke('review-oracle-tablespace-operation', draft);
      if (!alive.current || !active.current || id !== dialogTicket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setReview(response);
    } catch { if (alive.current && active.current && id === dialogTicket.current) setError('ts_operation_failed'); }
    finally { endLoading(); }
  };
  const canExecute = dialog && ready && !isLoading && Boolean(review?.canExecute) && acknowledged && (draft.action !== 'drop' || confirmName === review?.request.name);
  const execute = async () => {
    if (!canExecute || !review || isBusy() || writing.current) return;
    writing.current = true; beginLoading(); setReady(false); setDetailReady(false); setError(''); setErrorCode('');
    const id = ++ticket.current, version = dialogTicket.current;
    try {
      const response = await ipcRenderer.invoke('execute-oracle-tablespace-operation', { ...review.request, token: review.token, confirmName });
      if (!alive.current || !active.current || id !== ticket.current || version !== dialogTicket.current) return;
      setOutcome({ completed: response.completed || [], attempted: response.attempted || null, applied: response.applied === true }); setReview(null); setAcknowledged(false);
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response.snapshot); setReady(true); setDialog(false);
      if (!response.snapshot.tablespaces.some(row => row.id === selectedRef.current)) { selectedRef.current = ''; setSelectedId(''); setDetail(null); }
    } catch { if (alive.current && active.current && id === ticket.current) { setError('ts_outcome_unknown'); setReview(null); setAcknowledged(false); } }
    finally { writing.current = false; endLoading(); }
  };
  const reload = async () => { if (isBusy()) return; setReview(null); setAcknowledged(false); await load(); };
  const retryDetail = async () => { if (!isBusy() && selected && ready) await loadDetail(selected); };
  return { snapshot, rows, selected, selectedId, select, detail: currentDetail, ready, detailReady, isLoading, error, detailError, errorCode, search, setSearch, kind, setKind,
    can, open, dialog, draft, update, close, prepare, review, acknowledged, setAcknowledged, confirmName, setConfirmName, canExecute, execute, reload, retryDetail, outcome };
}
