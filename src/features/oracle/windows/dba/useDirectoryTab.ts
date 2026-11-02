// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { directoryCandidate, directoryPrincipals } from '@/features/oracle/directoryDefinition';
import type { DirectoryList, DirectoryDetail, DirectoryMutation } from '@/shared/types/directoryTypes';
export function useDirectoryTab(isActive: boolean) {
  const { t } = useTranslation();
  const [list, setList] = useState<DirectoryList | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<{ name: string; data: DirectoryDetail } | null>(null);
  const [listReady, setListReady] = useState(false), [detailReady, setDetailReady] = useState(false);
  const [listError, setListError] = useState(''), [detailError, setDetailError] = useState(''), [writeError, setWriteError] = useState('');
  const [errorCode, setErrorCode] = useState(''), [applied, setApplied] = useState(false);
  const [search, setSearch] = useState(''), [principalSearch, setPrincipalSearch] = useState(''), [includeMaintained, setIncludeMaintained] = useState(false);
  const [dialog, setDialog] = useState({ open: false, create: true, name: '', path: '' });
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter();
  const alive = useRef(false), active = useRef(isActive), selectedRef = useRef(selected), listTicket = useRef(0), detailTicket = useRef(0), writing = useRef(false);
  const detail = detailState?.name === selected ? detailState.data : null;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const loadList = useEventCallback(async () => {
    const ticket = ++listTicket.current;
    setListReady(false); setListError(''); beginLoading();
    try {
      const response = await ipcRenderer.invoke('list-oracle-directories');
      if (!alive.current || !active.current || ticket !== listTicket.current) return false;
      if (!response.success) { setListError(response.error); setErrorCode(response.errorCode || ''); return false; }
      setList(response); setListReady(true);
      if (selectedRef.current && !response.directories.some(directory => directory.name === selectedRef.current)) {
        selectedRef.current = null; setSelected(null); setDetailReady(false); setDetailState(null); detailTicket.current++;
      }
      return true;
    } catch { if (alive.current && active.current && ticket === listTicket.current) setListError('directory_load_failed'); return false; }
    finally { endLoading(); }
  });
  const loadDetail = useEventCallback(async (name: string) => {
    const ticket = ++detailTicket.current;
    setDetailReady(false); setDetailError(''); beginLoading();
    const valid = () => alive.current && active.current && ticket === detailTicket.current && selectedRef.current === name;
    try {
      const response = await ipcRenderer.invoke('get-oracle-directory', name);
      if (!valid()) return false;
      if (!response.success) { setDetailError(response.error); setErrorCode(response.errorCode || ''); return false; }
      setDetailState({ name, data: response.detail }); setDetailReady(true); return true;
    } catch { if (valid()) setDetailError('directory_privileges_failed'); return false; }
    finally { endLoading(); }
  });
  useEffect(() => {
    active.current = isActive;
    if (!isActive) { listTicket.current++; detailTicket.current++; return; }
    void loadList();
  }, [isActive, loadList]);
  useEffect(() => {
    if (isActive && selected) void loadDetail(selected);
    else { setDetailReady(false); detailTicket.current++; }
  }, [isActive, selected, loadDetail]);
  const select = (name: string | null) => {
    if (!listReady || writing.current || name && !list?.directories.some(directory => directory.name === name)) return;
    if (name === selectedRef.current) return;
    selectedRef.current = name; setSelected(name); setDetailReady(false); setDetailError(''); detailTicket.current++;
  };
  const reload = async () => {
    if (isBusy()) return;
    setWriteError(''); setErrorCode('');
    const ok = await loadList();
    if (ok && selectedRef.current) { if (await loadDetail(selectedRef.current)) setApplied(false); }
    else if (ok) setApplied(false);
  };
  const candidate = useMemo(() => directoryCandidate(dialog.name, dialog.path, dialog.create), [dialog]);
  const ready = listReady && detailReady && Boolean(detail?.directory.objectId);
  const canCreate = listReady && !isLoading && Boolean(list?.context.canCreate);
  const canReplace = ready && !isLoading && Boolean(detail?.context.canCreate);
  const canDrop = ready && !isLoading && Boolean(detail?.context.canDrop);
  const canSubmit = !isLoading && listReady && !candidate.error && (dialog.create ? Boolean(list?.context.canCreate) : ready && Boolean(detail?.context.canCreate) && candidate.path !== detail?.directory.path);
  const openCreate = () => { if (canCreate) setDialog({ open: true, create: true, name: '', path: '' }); };
  const openReplace = () => { if (canReplace && detail) setDialog({ open: true, create: false, name: detail.directory.name, path: detail.directory.path }); };
  const perform = async (request: DirectoryMutation) => {
    if (isBusy() || writing.current || !listReady) return;
    writing.current = true; beginLoading(); setWriteError(''); setErrorCode(''); setApplied(false);
    const name = request.name;
    try {
      const response = await ipcRenderer.invoke('mutate-oracle-directory', request);
      if (!alive.current || !active.current) return;
      if (!response.success) {
        setWriteError(response.error); setErrorCode(response.errorCode || ''); setApplied(response.applied === true);
        setListReady(false); setDetailReady(false);
        if (response.applied) setDialog(current => ({ ...current, open: false }));
        return;
      }
      setDialog(current => ({ ...current, open: false }));
      if (request.action === 'drop') { selectedRef.current = null; setSelected(null); setDetailState(null); setDetailReady(false); }
      else if (response.detail) { selectedRef.current = name; setSelected(name); setDetailState({ name, data: response.detail }); setDetailReady(true); }
      const ok = await loadList();
      if (!ok) setApplied(response.applied);
    } catch { if (alive.current && active.current) { setWriteError('directory_operation_failed'); setListReady(false); setDetailReady(false); } }
    finally { writing.current = false; endLoading(); }
  };
  const submit = async () => {
    if (!canSubmit || isBusy()) return;
    if (!dialog.create && !window.confirm(t('directory_replace_confirm', { name: candidate.name, before: detail?.directory.path, after: candidate.path }))) return;
    await perform({ action: dialog.create ? 'create' : 'replace', name: candidate.name, path: candidate.path, expected: dialog.create ? undefined : detail?.fingerprint });
  };
  const drop = async () => {
    if (!canDrop || isBusy() || !detail) return;
    if (!window.confirm(t('directory_drop_confirm', { name: detail.directory.name, path: detail.directory.path }))) return;
    await perform({ action: 'drop', name: detail.directory.name, expected: detail.fingerprint });
  };
  const changePrivilege = async (grantee: string, privilege: 'READ' | 'WRITE', grant: boolean) => {
    if (!ready || isBusy() || !detail) return;
    const rows = detail.grants.filter(row => row.grantee === grantee && row.privilege === privilege);
    if (grant && rows.length || !grant && !rows.length) return;
    if (grant ? !detail.canGrant[privilege] : rows.some(row => !row.canRevoke)) return;
    if ((!grant || grantee === 'PUBLIC') && !window.confirm(t(grant ? 'directory_public_grant_confirm' : 'directory_revoke_confirm', { name: detail.directory.name, grantee, privilege }))) return;
    await perform({ action: grant ? 'grant' : 'revoke', name: detail.directory.name, grantee, privilege, expected: detail.fingerprint });
  };
  const directories = useMemo(() => (list?.directories || []).filter(directory => `${directory.name}\n${directory.path}`.toLowerCase().includes(search.toLowerCase())), [list, search]);
  const principals = useMemo(() => directoryPrincipals(list, detail, includeMaintained, principalSearch), [list, detail, includeMaintained, principalSearch]);
  return { list, detail, selected, select, listReady, detailReady, ready, isLoading, listError, detailError, writeError, errorCode, applied,
    search, setSearch, principalSearch, setPrincipalSearch, includeMaintained, setIncludeMaintained,
    directories, principals, reload, canCreate, canReplace, canDrop, canSubmit, openCreate, openReplace, submit, drop, changePrivilege,
    dialog, setDialog, candidate };
}
