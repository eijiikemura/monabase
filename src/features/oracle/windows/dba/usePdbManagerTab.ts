// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { ManagedPdb, PdbAction, PdbDetail, PdbOperation, PdbReview, PdbSnapshot, PdbStage } from '@/shared/types/pdbTypes';
export interface PdbDraft extends PdbOperation { password: string; confirmName: string; acknowledged: boolean; }
const emptyDraft = (): PdbDraft => ({ action: 'create', name: '', target: '', user: '', path: '', mode: 'READ WRITE', pathMode: 'omf', conversions: [], password: '', confirmName: '', acknowledged: false });
export function usePdbManagerTab(isActive: boolean) {
  const [snapshot, setSnapshot] = useState<PdbSnapshot | null>(null), [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState(''), [stage, setStage] = useState<PdbStage>('not_started');
  const [selectedId, setSelectedId] = useState(''), [search, setSearch] = useState('');
  const [dialog, setDialog] = useState(false), [draft, setDraft] = useState<PdbDraft>(emptyDraft);
  const [review, setReview] = useState<PdbReview | null>(null), [detail, setDetail] = useState<PdbDetail | null>(null);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const alive = useRef(false), active = useRef(isActive), generation = useRef(0), writing = useRef(false), dialogVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useEventCallback(async () => {
    const ticket = ++generation.current; setReady(false); setError(''); setErrorCode(''); beginLoading();
    try {
      const response = await ipcRenderer.invoke('list-oracle-pdbs');
      if (!alive.current || !active.current || generation.current !== ticket) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response); setReady(true); setStage(previous => previous === 'outcome_unknown' ? 'not_started' : previous);
      // A partial attachment requires a new review of the now-current catalog.
      setDraft(previous => {
        if (!previous.target) return previous;
        const target = response.pdbs.find(row => row.name === previous.target);
        return { ...previous, target: target?.name || (previous.action === 'plugin' ? '' : previous.target), expected: target?.fingerprint || '', acknowledged: false, confirmName: '' };
      });
    } catch { if (alive.current && active.current && generation.current === ticket) setError('pdb_operation_failed'); }
    finally { endLoading(); }
  });
  useEffect(() => {
    active.current = isActive;
    if (isActive) void load();
    else { generation.current++; dialogVersion.current++; setReady(false); setDialog(false); setDraft(emptyDraft()); setReview(null); setDetail(null); }
  }, [isActive, load]);
  const rows = (snapshot?.pdbs || []).filter(row => row.name.toLowerCase().includes(search.toLowerCase()));
  const selected = rows.find(row => row.id === selectedId) || null;
  const can = (action: PdbAction, target: ManagedPdb | null = selected) => {
    const ctx = snapshot?.context;
    if (!ready || isLoading || !isActive || !ctx || ctx.readonly || !ctx.writable) return false;
    if (action === 'create' || action === 'plugin' && !target) return ctx.canCreate;
    if (!target || !target.id || target.id.startsWith('unknown:') || !target.dbid) return false;
    if (target.protected && ['close', 'drop', 'mode', 'unplug', 'password'].includes(action)) return false;
    if (action === 'clone') return ctx.canCreate && target.status !== 'UNPLUGGED' && (target.openMode === 'READ ONLY' || ctx.hotClone && target.openMode === 'READ WRITE');
    if (action === 'plugin') return ctx.canCreate && ctx.canDrop && !target.protected && target.status === 'UNPLUGGED';
    if (action === 'drop') return ctx.canDrop && (target.status === 'UNPLUGGED' || target.openMode === 'MOUNTED');
    if (action === 'password') return ctx.canPassword && target.openMode === 'READ WRITE' && target.status !== 'UNPLUGGED';
    if (!ctx.canAlter || target.status === 'UNPLUGGED') return false;
    if (['open', 'mode', 'unplug'].includes(action)) return target.openMode === 'MOUNTED';
    return ['READ WRITE', 'READ ONLY', 'MIGRATE'].includes(target.openMode || '');
  };
  const open = async (action: PdbAction, target: ManagedPdb | null = selected) => {
    if (!can(action, target) || isBusy()) return;
    const version = ++dialogVersion.current;
    setDraft({ ...emptyDraft(), action, target: ['create'].includes(action) || action === 'plugin' && !target ? '' : target?.name || '', expected: target?.fingerprint || '',
      name: action === 'clone' ? (target?.name || '') + '_CLONE' : action === 'plugin' ? target?.name || '' : '', pathMode: snapshot?.context.omf ? 'omf' : 'convert' });
    setReview(null); setDetail(null); setError(''); setErrorCode(''); setStage('not_started'); setDialog(true);
    if (target && ['clone', 'password'].includes(action)) {
      beginLoading();
      try {
        const response = await ipcRenderer.invoke('get-oracle-pdb-detail', target.name);
        if (!alive.current || !active.current || version !== dialogVersion.current) return;
        if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); setReady(false); return; }
        if (response.target.fingerprint !== target.fingerprint) { setError('pdb_conflict'); setReady(false); return; }
        setDetail(response);
      } catch { if (alive.current && active.current && version === dialogVersion.current) { setError('pdb_operation_failed'); setReady(false); } }
      finally { endLoading(); }
    }
  };
  const close = () => { if (writing.current || isBusy()) return; dialogVersion.current++; setDialog(false); setDraft(emptyDraft()); setReview(null); setDetail(null); };
  const update = (values: Partial<PdbDraft>) => { if (isBusy()) return; setDraft(previous => ({ ...previous, ...values, acknowledged: false })); setReview(null); };
  const prepare = async () => {
    if (!dialog || !ready || isBusy() || writing.current) return;
    const version = dialogVersion.current; beginLoading(); setError(''); setErrorCode(''); setReview(null);
    try {
      const request: PdbOperation = { action: draft.action, target: draft.target, name: draft.name, expected: draft.expected, user: draft.user, path: draft.path, mode: draft.mode, pathMode: draft.pathMode, conversions: draft.conversions };
      const response = await ipcRenderer.invoke('review-oracle-pdb-operation', request);
      if (!alive.current || !active.current || version !== dialogVersion.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setReview(response); setDraft(previous => ({ ...previous, acknowledged: false, confirmName: '' }));
    } catch { if (alive.current && active.current && version === dialogVersion.current) setError('pdb_operation_failed'); }
    finally { endLoading(); }
  };
  const confirmRequired = review?.request.action === 'drop' || review?.stages.includes('remove_catalog');
  const confirmTarget = review?.target?.name || review?.request.name || '';
  const canExecute = ready && dialog && !isLoading && Boolean(review?.canExecute) && draft.acknowledged && (!confirmRequired || draft.confirmName === confirmTarget)
    && (!['create', 'password'].includes(draft.action) || Boolean(draft.password));
  const execute = async () => {
    if (!canExecute || !review || isBusy() || writing.current) return;
    writing.current = true; beginLoading(); setError(''); setErrorCode('');
    const ticket = ++generation.current; const version = dialogVersion.current;
    setReady(false);
    try {
      const response = await ipcRenderer.invoke('execute-oracle-pdb-operation', { ...review.request, token: review.token, password: draft.password, confirmName: draft.confirmName });
      if (!alive.current || !active.current || generation.current !== ticket || dialogVersion.current !== version) return;
      setDraft(previous => ({ ...previous, password: '', acknowledged: false })); setReview(null);
      setStage(response.stage || 'not_started');
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response.snapshot); setReady(true); setDialog(false); setDraft(emptyDraft()); setDetail(null);
    } catch {
      if (alive.current && active.current && generation.current === ticket) { setError('pdb_outcome_unknown'); setStage('outcome_unknown'); setDraft(previous => ({ ...previous, password: '', acknowledged: false })); setReview(null); }
    } finally { writing.current = false; endLoading(); }
  };
  const reload = async () => { if (isBusy()) return; setReview(null); await load(); };
  return { snapshot, ready, error, errorCode, stage, rows, selected, selectedId, setSelectedId, search, setSearch, isLoading, can, open, dialog, draft, update, setDraft, close, review, detail, prepare, canExecute, confirmRequired, confirmTarget, execute, reload };
}
