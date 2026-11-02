// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { PgPrivilegeTarget, PgPrivilegePrincipal, PgPrivilegeDetail, PgPrivilegeRequest, PgPrivilegeReview } from '@/shared/types/postgresPrivilegeTypes';
export function useObjectPrivilegeTab(isActive: boolean) {
  const [target, setTarget] = useState<PgPrivilegeTarget | null>(null), [principals, setPrincipals] = useState<PgPrivilegePrincipal[]>([]);
  const [snapshot, setSnapshot] = useState<PgPrivilegeDetail | null>(null), [ready, setReady] = useState(false), [peopleReady, setPeopleReady] = useState(false);
  const [error, setError] = useState(''), [errorCode, setErrorCode] = useState(''), [applied, setApplied] = useState(false);
  const [dialog, setDialog] = useState(false), [draft, setDraft] = useState<PgPrivilegeRequest | null>(null), [review, setReview] = useState<PgPrivilegeReview | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const alive = useRef(false), active = useRef(isActive), ticket = useRef(0), peopleTicket = useRef(0), dialogTicket = useRef(0), writing = useRef(false), current = useRef(target);
  const detail = snapshot?.object.identity === target?.identity ? snapshot : null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadPeople = useEventCallback(async () => {
    const version = ++peopleTicket.current; beginLoading(); setPeopleReady(false);
    try {
      const response = await ipcRenderer.invoke('list-postgres-privilege-principals');
      if (!alive.current || !active.current || version !== peopleTicket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setPrincipals(response.principals); setPeopleReady(true);
    } catch { if (alive.current && active.current && version === peopleTicket.current) setError('pg_priv_load_failed'); }
    finally { endLoading(); }
  });
  const loadDetail = useEventCallback(async (object: PgPrivilegeTarget) => {
    const version = ++ticket.current; beginLoading(); setReady(false);
    const valid = () => alive.current && active.current && version === ticket.current && current.current?.identity === object.identity;
    try {
      const response = await ipcRenderer.invoke('get-postgres-object-privileges', object);
      if (!valid()) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setSnapshot(response.detail); setPrincipals(response.detail.principals); setReady(true);
      setDraft(previous => previous?.object.identity === object.identity ? { ...previous, expected: response.detail.fingerprint } : previous);
    } catch { if (valid()) setError('pg_priv_load_failed'); }
    finally { endLoading(); }
  });
  useEffect(() => {
    active.current = isActive;
    if (isActive) { setError(''); setErrorCode(''); void loadPeople(); }
    else { ticket.current++; peopleTicket.current++; dialogTicket.current++; setReady(false); setPeopleReady(false); setDialog(false); setReview(null); }
  }, [isActive, loadPeople]);
  useEffect(() => { if (isActive && target) void loadDetail(target); }, [isActive, target, loadDetail]);
  const select = (object: PgPrivilegeTarget) => {
    if (isBusy() || writing.current) return;
    ticket.current++; dialogTicket.current++; current.current = object; setTarget(object); setSnapshot(null); setReady(false); setError(''); setErrorCode(''); setApplied(false); setReview(null); setDialog(false);
  };
  const reload = async () => {
    if (isBusy()) return;
    setError(''); setErrorCode(''); setApplied(false); setReview(null); setAcknowledged(false);
    await Promise.all([loadPeople(), ...(current.current ? [loadDetail(current.current)] : [])]);
  };
  const editable = (principalId: string, privilege: string, action: 'grant' | 'revoke') => {
    if (!isActive || !ready || !peopleReady || !detail || detail.context.readonly || isLoading || !detail.privileges.includes(privilege) || !detail.principals.some(role => role.id === principalId)) return false;
    return action === 'grant' ? Boolean(detail.grantors[privilege]?.length) : detail.grants.some(grant => grant.grantee_id === principalId && grant.privilege === privilege && grant.canRevoke);
  };
  const open = (principalId: string, privilege: string, action: 'grant' | 'revoke', grantorId?: string, grantOptionOnly = false) => {
    if (!detail || !editable(principalId, privilege, action) || isBusy()) return;
    const issuer = grantorId || (action === 'grant' ? detail.grantors[privilege]?.[0] : detail.grants.find(grant => grant.grantee_id === principalId && grant.privilege === privilege && grant.canRevoke)?.grantor_id);
    setDraft({ object: detail.object, principalId, privilege, action, grantorId: issuer, grantOption: false, grantOptionOnly, expected: detail.fingerprint });
    dialogTicket.current++; setDialog(true); setReview(null); setAcknowledged(false); setError(''); setErrorCode(''); setApplied(false);
  };
  const update = (values: Partial<PgPrivilegeRequest>) => { if (isBusy()) return; setDraft(previous => previous ? { ...previous, ...values } : previous); setReview(null); setAcknowledged(false); };
  const close = () => { if (isBusy()) return; dialogTicket.current++; setDialog(false); setReview(null); };
  const prepare = async () => {
    if (!dialog || !draft || !ready || !peopleReady || isBusy()) return;
    const version = dialogTicket.current; beginLoading(); setReview(null); setAcknowledged(false); setError(''); setErrorCode('');
    try {
      const response = await ipcRenderer.invoke('review-postgres-object-privilege', draft);
      if (!alive.current || !active.current || version !== dialogTicket.current) return;
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); return; }
      setReview(response);
    } catch { if (alive.current && active.current && version === dialogTicket.current) setError('pg_priv_operation_failed'); }
    finally { endLoading(); }
  };
  const canExecute = dialog && isActive && ready && peopleReady && !isLoading && acknowledged && Boolean(review);
  const execute = async () => {
    if (!canExecute || !review || isBusy() || writing.current) return;
    writing.current = true; beginLoading(); setReady(false); setError(''); setErrorCode(''); setApplied(false);
    const version = ++ticket.current, dialogVersion = dialogTicket.current;
    try {
      const response = await ipcRenderer.invoke('mutate-postgres-object-privilege', { ...review.request, token: review.token });
      if (!alive.current || !active.current || version !== ticket.current || dialogVersion !== dialogTicket.current) return;
      setReview(null); setAcknowledged(false);
      if (!response.success) { setError(response.error); setErrorCode(response.errorCode || ''); setApplied(response.applied === true); return; }
      setSnapshot(response.detail); setPrincipals(response.detail.principals); setReady(true); setApplied(true); setDialog(false);
    } catch { if (alive.current && active.current && version === ticket.current) { setError('pg_priv_outcome_unknown'); setReview(null); setAcknowledged(false); } }
    finally { writing.current = false; endLoading(); if (alive.current && active.current && version !== ticket.current && current.current) { void loadPeople(); void loadDetail(current.current); } }
  };
  return { target, detail, principals, ready, peopleReady, isLoading, error, errorCode, applied, select, reload, editable, open, dialog, draft, update, close, prepare, review, acknowledged, setAcknowledged, canExecute, execute };
}
