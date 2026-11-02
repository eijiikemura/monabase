// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import type { PgSchemaSnapshot, PgSchemaDetail, PgSchemaRequest, PgSchemaReview, PgManagedSchema } from '@/shared/types/postgresSchemaTypes';
import type { PgPrivilegeRequest, PgPrivilegeReview } from '@/shared/types/postgresPrivilegeTypes';
export function useSchemaManagerTab(isActive: boolean) {
  const [snapshot,setSnapshot] = useState<PgSchemaSnapshot | null>(null), [storedDetail,setDetail] = useState<PgSchemaDetail | null>(null);
  const [selectedId,setSelectedId] = useState(''),[ready,setReady] = useState(false),[detailReady,setDetailReady] = useState(false);
  const [error,setError] = useState(''),[detailError,setDetailError] = useState(''),[errorCode,setErrorCode] = useState(''),[applied,setApplied] = useState(false);
  const [search,setSearch] = useState(''),[showSystem,setShowSystem] = useState(false);
  const [dialog,setDialog] = useState<'schema' | 'privilege' | null>(null),[schemaDraft,setSchemaDraft] = useState<PgSchemaRequest | null>(null),[privilegeDraft,setPrivilegeDraft] = useState<PgPrivilegeRequest | null>(null);
  const [schemaReview,setSchemaReview] = useState<PgSchemaReview | null>(null),[privilegeReview,setPrivilegeReview] = useState<PgPrivilegeReview | null>(null),[acknowledged,setAcknowledged] = useState(false),[confirmName,setConfirmName] = useState('');
  const { isLoading,beginLoading,endLoading,isBusy } = useLoadingCounter();
  const alive=useRef(false),active=useRef(isActive),activation=useRef(0),ticket=useRef(0),detailTicket=useRef(0),dialogTicket=useRef(0),writing=useRef(false),selectedRef=useRef('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const rows=(snapshot?.schemas || []).filter(row=>(showSystem || !row.system) && `${row.name} ${row.owner}`.toLowerCase().includes(search.toLowerCase()));
  const selected=snapshot?.schemas.find(row=>row.identity===selectedId) || null;
  const detail=storedDetail?.schema.identity===selectedId ? storedDetail : null;
  const clearReview=()=>{setSchemaReview(null);setPrivilegeReview(null);setAcknowledged(false);setConfirmName('');};
  const loadDetail=useEventCallback(async(target:PgManagedSchema)=>{
    const version=++detailTicket.current;beginLoading();setDetailReady(false);setDetailError('');
    const valid=()=>alive.current && active.current && version===detailTicket.current && selectedRef.current===target.identity;
    try {
      const response=await ipcRenderer.invoke('get-postgres-schema-detail',{oid:target.oid,identity:target.identity,name:target.name});
      if(!valid())return;
      if(!response.success){setDetailError(response.error);setErrorCode(response.errorCode || '');return;}
      setDetail(response.detail);setDetailReady(true);
      setSchemaDraft(previous=>previous?.target?.identity===target.identity ? {...previous,target:{oid:target.oid,identity:target.identity,name:target.name},expected:response.detail.fingerprint}:previous);
      setPrivilegeDraft(previous=>previous?.object.oid===target.oid ? {...previous,object:response.detail.privileges.object,expected:response.detail.privileges.fingerprint}:previous);
    }catch{if(valid())setDetailError('pg_schema_load_failed');}finally{endLoading();}
  });
  const load=useEventCallback(async()=>{
    if(writing.current)return;
    const version=++ticket.current;beginLoading();setReady(false);setDetailReady(false);setError('');setErrorCode('');
    try {
      const response=await ipcRenderer.invoke('list-postgres-schemas');
      if(!alive.current || !active.current || version!==ticket.current)return;
      if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}
      setSnapshot(response);setReady(true);
      window.dispatchEvent(new CustomEvent('refresh-schemas'));
      if(selectedRef.current && !response.schemas.some(row=>row.identity===selectedRef.current)){selectedRef.current='';setSelectedId('');setDetail(null);}
    }catch{if(alive.current && active.current && version===ticket.current)setError('pg_schema_load_failed');}finally{endLoading();}
  });
  useEffect(()=>{active.current=isActive;activation.current++;if(isActive)void load();else{ticket.current++;detailTicket.current++;dialogTicket.current++;setReady(false);setDetailReady(false);setDialog(null);clearReview();}},[isActive,load]);
  useEffect(()=>{if(isActive && selected)void loadDetail(selected);},[isActive,selected,loadDetail]);
  const select=(id:string)=>{if(isBusy() || writing.current || id===selectedRef.current)return;selectedRef.current=id;detailTicket.current++;dialogTicket.current++;setSelectedId(id);setDetail(null);setDetailReady(false);setDetailError('');setDialog(null);clearReview();setApplied(false);};
  const can=(action:PgSchemaRequest['action'])=>isActive && ready && !isLoading && !snapshot?.context.readonly && (action==='create' ? snapshot?.context.canCreate : detailReady && selected && rows.some(row=>row.identity===selected.identity) && (action==='drop' ? selected.canDrop : action==='rename' ? selected.canRename : selected.canChangeOwner));
  const open=(action:PgSchemaRequest['action'])=>{
    if(!can(action) || isBusy())return;
    dialogTicket.current++;clearReview();setApplied(false);setError('');setErrorCode('');setDialog('schema');setPrivilegeDraft(null);
    setSchemaDraft({action,...(selected ? {target:{oid:selected.oid,identity:selected.identity,name:selected.name},expected:detail?.fingerprint}:{}),newName:action==='rename'?selected?.name:'',ownerId:action==='create'?snapshot?.context.userId:selected?.ownerId,cascade:false});
  };
  const acl=detail?.privileges;
  const editable=(principalId:string,privilege:string,action:'grant'|'revoke')=>Boolean(isActive && ready && detailReady && acl && !acl.context.readonly && !isLoading && rows.some(row=>row.identity===selectedId) && acl.privileges.includes(privilege) && (action==='grant' ? acl.grantors[privilege]?.length : acl.grants.some(grant=>grant.grantee_id===principalId && grant.privilege===privilege && grant.canRevoke)));
  const openPrivilege=(principalId:string,privilege:string,action:'grant'|'revoke',grantorId?:string,grantOptionOnly=false)=>{
    if(!acl || !editable(principalId,privilege,action) || isBusy())return;
    dialogTicket.current++;clearReview();setApplied(false);setError('');setErrorCode('');setDialog('privilege');setSchemaDraft(null);
    setPrivilegeDraft({object:acl.object,principalId,privilege,action,expected:acl.fingerprint,grantorId:grantorId || (action==='grant'?acl.grantors[privilege]?.[0]:acl.grants.find(grant=>grant.grantee_id===principalId && grant.privilege===privilege && grant.canRevoke)?.grantor_id),grantOption:false,grantOptionOnly});
  };
  const updateSchema=(values:Partial<PgSchemaRequest>)=>{if(isBusy())return;setSchemaDraft(previous=>previous?{...previous,...values}:previous);clearReview();};
  const updatePrivilege=(values:Partial<PgPrivilegeRequest>)=>{if(isBusy())return;setPrivilegeDraft(previous=>previous?{...previous,...values}:previous);clearReview();};
  const close=()=>{if(isBusy())return;dialogTicket.current++;setDialog(null);clearReview();};
  const prepare=async()=>{
    if(!dialog || !ready || isBusy() || (dialog==='privilege' || schemaDraft?.action!=='create') && !detailReady)return;
    const version=dialogTicket.current;beginLoading();clearReview();setError('');setErrorCode('');
    try{
      if(dialog==='schema' && schemaDraft){const response=await ipcRenderer.invoke('review-postgres-schema-operation',schemaDraft);if(!alive.current || !active.current || version!==dialogTicket.current)return;if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}setSchemaReview(response);}
      if(dialog==='privilege' && privilegeDraft){const response=await ipcRenderer.invoke('review-postgres-object-privilege',privilegeDraft);if(!alive.current || !active.current || version!==dialogTicket.current)return;if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}setPrivilegeReview(response);}
    }catch{if(alive.current && active.current && version===dialogTicket.current)setError('pg_schema_operation_failed');}finally{endLoading();}
  };
  const canExecute=Boolean(isActive && ready && !isLoading && acknowledged && (schemaReview || privilegeReview) && (schemaReview?.request.action!=='drop' || confirmName===schemaReview.request.target?.name));
  const execute=async()=>{
    if(!canExecute || isBusy() || writing.current)return;
    writing.current=true;beginLoading();setReady(false);setDetailReady(false);setError('');setErrorCode('');setApplied(false);
    const version=activation.current,dialogVersion=dialogTicket.current;
    const valid=()=>alive.current && active.current && version===activation.current && dialogVersion===dialogTicket.current;
    try{
      if(schemaReview){
        const response=await ipcRenderer.invoke('execute-postgres-schema-operation',{...schemaReview.request,token:schemaReview.token,confirmName});
        if(!valid())return;clearReview();
        if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}
        setSnapshot(response.snapshot);setReady(true);setDialog(null);setApplied(true);
        const next=response.snapshot.schemas.find(row=>row.oid===response.selectedOid);selectedRef.current=next?.identity || '';setSelectedId(next?.identity || '');if(!next)setDetail(null);
        window.dispatchEvent(new CustomEvent('refresh-schemas',{detail:response.change}));
      }else if(privilegeReview){
        const response=await ipcRenderer.invoke('mutate-postgres-object-privilege',{...privilegeReview.request,token:privilegeReview.token});
        if(!valid())return;clearReview();
        if(!response.success){setError(response.error);setErrorCode(response.errorCode || '');return;}
        setDialog(null);setApplied(true);writing.current=false;await load();
      }
    }catch{if(valid()){setError('pg_schema_outcome_unknown');clearReview();}}finally{writing.current=false;endLoading();if(alive.current && active.current && version!==activation.current)void load();}
  };
  const reload=async()=>{if(isBusy())return;clearReview();setApplied(false);await load();};
  const retryDetail=async()=>{if(!isBusy() && ready && selected)await loadDetail(selected);};
  return {snapshot,rows,selected,selectedId,select,detail,ready,detailReady,isLoading,error,detailError,errorCode,applied,search,setSearch,showSystem,setShowSystem,can,open,editable,openPrivilege,dialog,schemaDraft,privilegeDraft,updateSchema,updatePrivilege,close,prepare,schemaReview,privilegeReview,acknowledged,setAcknowledged,confirmName,setConfirmName,canExecute,execute,reload,retryDetail};
}
