// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { OraclePrincipalSnapshot, OraclePrincipalDetail, OraclePrincipalRequest, OraclePrincipalReview, OraclePrincipal } from '@/shared/types/oracleUserRoleTypes';
export function useUserRoleTab(isActive: boolean) {
  const [snapshot,setSnapshot]=useState<OraclePrincipalSnapshot | null>(null),[detail,setDetail]=useState<OraclePrincipalDetail | null>(null);
  const [selectedId,setSelectedId]=useState(''),[ready,setReady]=useState(false),[detailReady,setDetailReady]=useState(false);
  const [error,setError]=useState(''),[detailError,setDetailError]=useState(''),[errorCode,setErrorCode]=useState(''),[applied,setApplied]=useState(false);
  const [kind,setKind]=useState<'USER' | 'ROLE'>('USER');
  const [includeSystem,setIncludeSystem]=useState(false),[password,setPassword]=useState(''),[candidateSearch,setCandidateSearch]=useState(''),[candidatePage,setCandidatePage]=useState(0);
  const [search,setSearch]=useState(''),[pagination,setPagination]=useState({page:0,pageSize:25});
  const [draft,setDraft]=useState<OraclePrincipalRequest | null>(null),[review,setReview]=useState<OraclePrincipalReview | null>(null),[acknowledged,setAcknowledged]=useState(false),[confirmName,setConfirmName]=useState('');
  const {isLoading,beginLoading,endLoading,isBusy}=useLoadingCounter();
  const alive=useRef(false),active=useRef(isActive),activation=useRef(0),ticket=useRef(0),detailTicket=useRef(0),dialogTicket=useRef(0),writing=useRef(false),selectedRef=useRef('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const clearReview=()=>{setReview(null);setAcknowledged(false);setConfirmName('');};
  const loadDetail=useEventCallback(async(target:OraclePrincipal)=>{
    const version=++detailTicket.current;beginLoading();setDetailReady(false);setDetailError('');
    const valid=()=>alive.current && active.current && version===detailTicket.current && selectedRef.current===target.identity;
    try{const response=await ipcRenderer.invoke('get-oracle-user-role-detail',{identity:target.identity,name:target.name,kind:target.kind});if(!valid())return;
      if(!response.success){setDetailError(response.error);setErrorCode(response.errorCode || '');return;}
      setDetail(response.detail);setDetailReady(true);setDraft(previous=>previous?.target?.identity===target.identity?{...previous,target:{identity:target.identity,name:target.name,kind:target.kind},expected:response.detail.fingerprint}:previous);
    }catch{if(valid())setDetailError('ora_user_load_failed');}finally{endLoading();}
  });
  const load=useEventCallback(async()=>{
    if(writing.current)return;
    const version=++ticket.current;beginLoading();setReady(false);setDetailReady(false);setError('');setErrorCode('');
    try{const response=await ipcRenderer.invoke('list-oracle-user-roles');if(!alive.current || !active.current || version!==ticket.current)return;
      if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}
      setSnapshot(response);setReady(true);
      if(selectedRef.current && !response.principals.some(row=>row.identity===selectedRef.current)){selectedRef.current='';setSelectedId('');setDetail(null);}
    }catch{if(alive.current && active.current && version===ticket.current)setError('ora_user_load_failed');}finally{endLoading();}
  });
  useEffect(()=>{active.current=isActive;activation.current++;if(isActive)void load();else{ticket.current++;detailTicket.current++;dialogTicket.current++;setReady(false);setDetailReady(false);setDraft(null);setPassword('');clearReview();}},[isActive,load]);
  const rows=(snapshot?.principals || []).filter(row=>row.kind===kind && (includeSystem || !row.maintained) && row.name.toLowerCase().includes(search.toLowerCase()));
  const selected=snapshot?.principals.find(row=>row.identity===selectedId) || null;
  const selectedDetail=detail?.target.identity===selectedId?detail:null;
  useEffect(()=>{if(isActive && selected)void loadDetail(selected);},[isActive,selected,loadDetail]);
  useEffect(()=>{setPagination(previous=>({...previous,page:0}));},[search,includeSystem,kind]);
  const select=(id:string)=>{if(isBusy() || writing.current || id===selectedRef.current)return;selectedRef.current=id;detailTicket.current++;dialogTicket.current++;setSelectedId(id);setDetail(null);setDetailReady(false);setDetailError('');setDraft(null);setPassword('');clearReview();setApplied(false);};
  const can=(action:OraclePrincipalRequest['action'])=>Boolean(isActive && ready && !isLoading && !writing.current && !snapshot?.context.readonly && (action==='create'?(kind==='USER'?snapshot?.context.canCreateUser:snapshot?.context.canCreateRole):detailReady && selected && rows.some(row=>row.identity===selectedId) && (action==='password'?selected.canPassword:action==='lock'?selected.canLock:action==='drop'?selected.canDrop:action==='quota'?selected.canQuota && !selectedDetail?.quotaError:!selected.protected)));
  const open=(action:OraclePrincipalRequest['action'],values:Partial<OraclePrincipalRequest>={})=>{
    if(!can(action) || isBusy())return;dialogTicket.current++;clearReview();setApplied(false);setError('');setErrorCode('');setPassword('');setCandidateSearch('');setCandidatePage(0);
    const first=selectedDetail?.candidates[0],quota=selectedDetail?.quotas[0];
    setDraft({action,kind,...(action!=='create' && selected?{target:{identity:selected.identity,name:selected.name,kind:selected.kind},expected:selectedDetail?.fingerprint}:{}),newName:'',locked:!selected?.locked,cascade:false,privilegeKind:first?.kind,privilege:first?.name,admin:false,tablespace:quota?.tablespace,amount:quota?.maxBytes && quota.maxBytes!=='-1'?quota.maxBytes:'0',unit:'B',unlimited:quota?.maxBytes==='-1',...values});
  };
  const update=(values:Partial<OraclePrincipalRequest>)=>{if(isBusy())return;setDraft(previous=>previous?{...previous,...values}:previous);clearReview();};
  const close=()=>{if(isBusy())return;dialogTicket.current++;setDraft(null);setPassword('');clearReview();};
  const prepare=async()=>{if(!draft || !ready || isBusy() || draft.action!=='create' && !detailReady)return;const version=dialogTicket.current;beginLoading();clearReview();setError('');setErrorCode('');
    try{const response=await ipcRenderer.invoke('review-oracle-user-role-operation',draft);if(!alive.current || !active.current || version!==dialogTicket.current)return;if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}setReview(response);}
    catch{if(alive.current && active.current && version===dialogTicket.current)setError('ora_user_operation_failed');}finally{endLoading();}};
  const canExecute=Boolean(isActive && ready && !isLoading && review && (!(review.request.action==='password' || review.request.action==='create' && review.request.kind==='USER') || password.length>0) && acknowledged && (review.request.action!=='drop' || confirmName===review.request.target?.name));
  const execute=async()=>{if(!canExecute || isBusy() || writing.current || !review)return;writing.current=true;beginLoading();setReady(false);setDetailReady(false);setError('');setErrorCode('');setApplied(false);
    const version=activation.current,dialogVersion=dialogTicket.current;const valid=()=>alive.current && active.current && version===activation.current && dialogVersion===dialogTicket.current;
    try{const response=await ipcRenderer.invoke('execute-oracle-user-role-operation',{...review.request,token:review.token,confirmName,...(review.request.action==='password' || review.request.action==='create' && review.request.kind==='USER'?{password}:{})});setPassword('');if(!valid())return;clearReview();
      if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');setApplied(response.applied===true);return;}
      setSnapshot(response.snapshot);setReady(true);setDraft(null);setApplied(true);const next=response.snapshot.principals.find(row=>row.identity===response.selectedIdentity);selectedRef.current=next?.identity || '';setSelectedId(next?.identity || '');if(!next)setDetail(null);
    }catch{setPassword('');if(valid()){clearReview();setError('ora_user_outcome_unknown');}}finally{writing.current=false;endLoading();if(alive.current && active.current && version!==activation.current)void load();}};
  const reload=async()=>{if(isBusy())return;clearReview();setApplied(false);await load();};
  const retryDetail=async()=>{if(!isBusy() && ready && selected)await loadDetail(selected);};
  const changePassword=(value:string)=>{if(isBusy())return;setPassword(value);clearReview();};
  const candidates=(selectedDetail?.candidates || []).filter(row=>row.name.toLowerCase().includes(candidateSearch.toLowerCase()));
  const changeKind=(value:'USER' | 'ROLE')=>{if(isBusy())return;select('');setKind(value);};
  return{kind,setKind:changeKind,includeSystem,setIncludeSystem,password,changePassword,candidateSearch,setCandidateSearch,candidatePage,setCandidatePage,candidates,snapshot,rows,selected,selectedId,select,detail:selectedDetail,ready,detailReady,isLoading,error,detailError,errorCode,applied,search,setSearch,pagination,setPagination,can,open,draft,update,close,prepare,review,acknowledged,setAcknowledged,confirmName,setConfirmName,canExecute,execute,reload,retryDetail};
}
