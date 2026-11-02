// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { PgRoleSnapshot, PgRoleDetail, PgRoleRequest, PgRoleReview, PgRole } from '@/shared/types/postgresRoleTypes';
export function useUserRoleTab(isActive: boolean) {
  const [snapshot,setSnapshot]=useState<PgRoleSnapshot | null>(null),[detail,setDetail]=useState<PgRoleDetail | null>(null);
  const [selectedId,setSelectedId]=useState(''),[ready,setReady]=useState(false),[detailReady,setDetailReady]=useState(false);
  const [error,setError]=useState(''),[detailError,setDetailError]=useState(''),[errorCode,setErrorCode]=useState(''),[applied,setApplied]=useState(false);
  const [includeSystem,setIncludeSystem]=useState(false),[password,setPassword]=useState(''),[candidateSearch,setCandidateSearch]=useState(''),[candidatePage,setCandidatePage]=useState(0);
  const [search,setSearch]=useState(''),[pagination,setPagination]=useState({page:0,pageSize:25});
  const [draft,setDraft]=useState<PgRoleRequest | null>(null),[review,setReview]=useState<PgRoleReview | null>(null),[acknowledged,setAcknowledged]=useState(false),[confirmName,setConfirmName]=useState('');
  const {isLoading,beginLoading,endLoading,isBusy}=useLoadingCounter();
  const alive=useRef(false),active=useRef(isActive),activation=useRef(0),ticket=useRef(0),detailTicket=useRef(0),dialogTicket=useRef(0),writing=useRef(false),selectedRef=useRef('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const clearReview=()=>{setReview(null);setAcknowledged(false);setConfirmName('');};
  const loadDetail=useEventCallback(async(target:PgRole)=>{
    const version=++detailTicket.current;beginLoading();setDetailReady(false);setDetailError('');
    const valid=()=>alive.current && active.current && version===detailTicket.current && selectedRef.current===target.identity;
    try{const response=await ipcRenderer.invoke('get-postgres-role-detail',{oid:target.oid,identity:target.identity,name:target.name});if(!valid())return;
      if(!response.success){setDetailError(response.error);setErrorCode(response.errorCode || '');return;}
      setDetail(response.detail);setDetailReady(true);setDraft(previous=>previous?.target?.identity===target.identity?{...previous,target:{oid:target.oid,identity:target.identity,name:target.name},expected:response.detail.fingerprint}:previous);
    }catch{if(valid())setDetailError('pg_role_load_failed');}finally{endLoading();}
  });
  const load=useEventCallback(async()=>{
    if(writing.current)return;
    const version=++ticket.current;beginLoading();setReady(false);setDetailReady(false);setError('');setErrorCode('');
    try{const response=await ipcRenderer.invoke('list-postgres-roles');if(!alive.current || !active.current || version!==ticket.current)return;
      if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}
      setSnapshot(response);setReady(true);
      if(selectedRef.current && !response.roles.some(row=>row.identity===selectedRef.current)){selectedRef.current='';setSelectedId('');setDetail(null);}
    }catch{if(alive.current && active.current && version===ticket.current)setError('pg_role_load_failed');}finally{endLoading();}
  });
  useEffect(()=>{active.current=isActive;activation.current++;if(isActive)void load();else{ticket.current++;detailTicket.current++;dialogTicket.current++;setReady(false);setDetailReady(false);setDraft(null);setPassword('');clearReview();}},[isActive,load]);
  const rows=(snapshot?.roles || []).filter(row=>(includeSystem || !row.system) && row.name.toLowerCase().includes(search.toLowerCase()));
  const selected=snapshot?.roles.find(row=>row.identity===selectedId) || null;
  const selectedDetail=detail?.role.identity===selectedId?detail:null;
  useEffect(()=>{if(isActive && selected)void loadDetail(selected);},[isActive,selected,loadDetail]);
  useEffect(()=>{setPagination(previous=>({...previous,page:0}));},[search,includeSystem]);
  const select=(id:string)=>{if(isBusy() || writing.current || id===selectedRef.current)return;selectedRef.current=id;detailTicket.current++;dialogTicket.current++;setSelectedId(id);setDetail(null);setDetailReady(false);setDetailError('');setDraft(null);setPassword('');clearReview();setApplied(false);};
  const can=(action:PgRoleRequest['action'])=>Boolean(isActive && ready && !isLoading && !writing.current && !snapshot?.context.readonly && (action==='create'?snapshot?.context.canCreate:detailReady && selected && rows.some(row=>row.identity===selectedId) && (action==='password'?selected.canPassword:action==='login'?selected.canLogin:action==='superuser'?selected.canSuperuser:action==='drop'?selected.canDrop:!selected.protected)));
  const open=(action:PgRoleRequest['action'],membership?:{roleId:string;grantorId:string})=>{
    if(!can(action) || isBusy())return;dialogTicket.current++;clearReview();setApplied(false);setError('');setErrorCode('');setPassword('');setCandidateSearch('');setCandidatePage(0);
    const first=selectedDetail?.candidates[0];
    setDraft({action,...(action!=='create' && selected?{target:{oid:selected.oid,identity:selected.identity,name:selected.name},expected:selectedDetail?.fingerprint}:{}),newName:'',login:false,passwordMode:action==='create'?'none':'set',enabled:action==='login'?!selected?.login:!selected?.superuser,
      ...(action==='grant'?{roleId:first?.oid,grantorId:first?.grantorIds[0],admin:false,...(snapshot && snapshot.context.version>=160000?{inherit:selected?.inherit ?? true,set:true}:{})}:{}),...(membership?{...membership,revokeOption:'membership' as const}:{})});
  };
  const update=(values:Partial<PgRoleRequest>)=>{if(isBusy())return;setDraft(previous=>previous?{...previous,...values}:previous);clearReview();};
  const close=()=>{if(isBusy())return;dialogTicket.current++;setDraft(null);setPassword('');clearReview();};
  const prepare=async()=>{if(!draft || !ready || isBusy() || draft.action!=='create' && !detailReady)return;const version=dialogTicket.current;beginLoading();clearReview();setError('');setErrorCode('');
    try{const response=await ipcRenderer.invoke('review-postgres-role-operation',draft);if(!alive.current || !active.current || version!==dialogTicket.current)return;if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}setReview(response);}
    catch{if(alive.current && active.current && version===dialogTicket.current)setError('pg_role_operation_failed');}finally{endLoading();}};
  const canExecute=Boolean(isActive && ready && !isLoading && review && (review.request.passwordMode!=='set' || password.length>0) && acknowledged && (review.request.action!=='drop' || confirmName===review.request.target?.name));
  const execute=async()=>{if(!canExecute || isBusy() || writing.current || !review)return;writing.current=true;beginLoading();setReady(false);setDetailReady(false);setError('');setErrorCode('');setApplied(false);
    const version=activation.current,dialogVersion=dialogTicket.current;const valid=()=>alive.current && active.current && version===activation.current && dialogVersion===dialogTicket.current;
    try{const response=await ipcRenderer.invoke('execute-postgres-role-operation',{...review.request,token:review.token,confirmName,...(review.request.passwordMode==='set'?{password}:{})});setPassword('');if(!valid())return;clearReview();
      if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}
      setSnapshot(response.snapshot);setReady(true);setDraft(null);setApplied(true);const next=response.snapshot.roles.find(row=>row.oid===response.selectedOid);selectedRef.current=next?.identity || '';setSelectedId(next?.identity || '');if(!next)setDetail(null);
    }catch{setPassword('');if(valid()){clearReview();setError('pg_role_outcome_unknown');}}finally{writing.current=false;endLoading();if(alive.current && active.current && version!==activation.current)void load();}};
  const reload=async()=>{if(isBusy())return;clearReview();await load();};
  const retryDetail=async()=>{if(!isBusy() && ready && selected)await loadDetail(selected);};
  const changePassword=(value:string)=>{if(isBusy())return;setPassword(value);clearReview();};
  const candidates=(selectedDetail?.candidates || []).filter(row=>row.name.toLowerCase().includes(candidateSearch.toLowerCase()));
  return{includeSystem,setIncludeSystem,password,changePassword,candidateSearch,setCandidateSearch,candidatePage,setCandidatePage,candidates,snapshot,rows,selected,selectedId,select,detail:selectedDetail,ready,detailReady,isLoading,error,detailError,errorCode,applied,search,setSearch,pagination,setPagination,can,open,draft,update,close,prepare,review,acknowledged,setAcknowledged,confirmName,setConfirmName,canExecute,execute,reload,retryDetail};
}
