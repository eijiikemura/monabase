// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { ObjectPrivilegeDetail, PrivilegePrincipals, PrivilegeTarget } from '@/shared/types/objectPrivilegeTypes';
export function useObjectPrivilegeTab(isActive: boolean) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<PrivilegeTarget | null>(null);
  const [principals, setPrincipals] = useState<PrivilegePrincipals | null>(null);
  const [snapshot, setSnapshot] = useState<ObjectPrivilegeDetail | null>(null);
  const [ready, setReady] = useState(false), [principalsReady, setPrincipalsReady] = useState(false);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState(''), [applied, setApplied] = useState(false);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const alive = useRef(false), active = useRef(isActive), ticket = useRef(0), listTicket = useRef(0), writing = useRef(false), current = useRef(target);
  const detail = snapshot && JSON.stringify(snapshot.object) === JSON.stringify(target) ? snapshot : null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadPrincipals = useEventCallback(async () => {
    const id = ++listTicket.current; setPrincipalsReady(false); beginLoading();
    try {
      const response = await ipcRenderer.invoke('list-oracle-privilege-principals');
      if (!alive.current || !active.current || id !== listTicket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setPrincipals(response); setPrincipalsReady(true);
    } catch { if (alive.current && active.current && id === listTicket.current) setError('object_priv_load_failed'); }
    finally { endLoading(); }
  });
  const loadDetail = useEventCallback(async (object: PrivilegeTarget) => {
    const id = ++ticket.current; setReady(false); beginLoading();
    const valid = () => alive.current && active.current && id === ticket.current && JSON.stringify(current.current) === JSON.stringify(object);
    try {
      const response = await ipcRenderer.invoke('get-oracle-object-privileges', object);
      if (!valid()) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response.detail); setReady(true);
    } catch { if (valid()) setError('object_priv_load_failed'); }
    finally { endLoading(); }
  });
  useEffect(() => {
    active.current = isActive;
    if (isActive) { setError(''); setErrorCode(''); void loadPrincipals(); }
    else { ticket.current++; listTicket.current++; setReady(false); setPrincipalsReady(false); }
  }, [isActive, loadPrincipals]);
  useEffect(() => {
    if (isActive && target) void loadDetail(target);
    else { ticket.current++; setReady(false); }
  }, [isActive, target, loadDetail]);
  const select = (object: PrivilegeTarget) => {
    if (isBusy() || writing.current) return;
    ticket.current++; current.current = object; setTarget(object); setReady(false); setSnapshot(null); setError(''); setErrorCode(''); setApplied(false);
  };
  const reload = async () => {
    if (isBusy()) return;
    setError(''); setErrorCode(''); setApplied(false);
    await Promise.all([loadPrincipals(), ...(current.current ? [loadDetail(current.current)] : [])]);
  };
  const editable = (grantee: string, privilege: string) => {
    if (!ready || !principalsReady || !detail || isLoading || !isActive || grantee === detail.object.owner || detail.context.readonly) return false;
    if (privilege === 'REFERENCES' && principals?.principals.find(row => row.name === grantee)?.kind !== 'user') return false;
    if (detail.columnGrants.some(row => row.grantee === grantee && row.privilege === privilege)) return false;
    const matching = detail.grants.filter(row => row.grantee === grantee && row.privilege === privilege);
    return matching.length ? (detail.scope === 'all' || detail.context.user === detail.object.owner) && matching.every(row => row.canRevoke && !row.grantable && !row.hierarchy)
      : Boolean(detail.canGrant[privilege]) && Boolean(principals?.principals.some(row => row.name === grantee));
  };
  const change = async (grantee: string, privilege: string, grant: boolean) => {
    if (!editable(grantee, privilege) || !detail || isBusy() || writing.current) return;
    const exists = detail.grants.some(row => row.grantee === grantee && row.privilege === privilege);
    if (grant === exists) return;
    if (!window.confirm(t('object_priv_confirm', { action: t(grant ? 'grant' : 'revoke'), owner: detail.object.owner, name: detail.object.name, grantee, privilege }) + '\n' + t('object_priv_commit_warning') + (grantee === 'PUBLIC' ? '\n' + t('object_priv_public_warning') : ''))) return;
    writing.current = true; beginLoading(); setReady(false); setError(''); setErrorCode(''); setApplied(false);
    const id = ++ticket.current;
    try {
      const response = await ipcRenderer.invoke('mutate-oracle-object-privileges', { object: detail.object, grantee, privilege, action: grant ? 'grant' : 'revoke', expected: detail.fingerprint });
      if (!alive.current || !active.current || id !== ticket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); setApplied(response.applied === true); return; }
      setSnapshot(response.detail); setReady(true); setApplied(response.applied);
    } catch { if (alive.current && active.current && id === ticket.current) setError('object_priv_outcome_unknown'); }
    finally { writing.current = false; endLoading(); }
  };
  return { target, detail, principals, isLoading, ready, principalsReady, error, errorCode, applied, select, reload, editable, change };
}
