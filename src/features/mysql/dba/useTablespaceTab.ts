// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { MysqlTablespace, MysqlTablespaceDetail, MysqlTablespaceSnapshot } from '@/shared/types/mysqlTablespaceTypes';
export function useTablespaceTab(active: boolean, busy: boolean) {
  const [snapshot,setSnapshot]=useState<MysqlTablespaceSnapshot|null>(null),[detail,setDetail]=useState<MysqlTablespaceDetail|null>(null);
  const [selectedId,setSelectedId]=useState(''),[search,setSearch]=useState(''),[filter,setFilter]=useState('all');
  const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState('');
  const alive=useRef(false),epoch=useRef(0),detailEpoch=useRef(0),reading=useRef(false),detailing=useRef(false),selected=useRef(''),loaded=useRef(false);
  const loadDetail=useEventCallback(async(row:MysqlTablespace)=>{
    const generation=++detailEpoch.current;detailing.current=true;setDetail(null);setDetailError('');setDetailLoading(true);
    try{const result=await ipcRenderer.invoke('get-mysql-tablespace-detail',{id:row.id,name:row.name});if(!alive.current||generation!==detailEpoch.current)return;if(!result.success)throw new Error(result.error||'mysql_storage_read_failed');setDetail(result.detail);}
    catch(reason){if(alive.current&&generation===detailEpoch.current)setDetailError(reason instanceof Error?reason.message:'mysql_storage_read_failed');}
    finally{if(alive.current&&generation===detailEpoch.current){detailing.current=false;setDetailLoading(false);}}
  });
  const reload=useEventCallback(async()=>{
    if(!active||busy||reading.current)return;reading.current=true;const generation=++epoch.current;++detailEpoch.current;detailing.current=false;
    setLoading(true);setError('');setDetail(null);setDetailError('');setDetailLoading(false);
    try{const result=await ipcRenderer.invoke('list-mysql-tablespaces');if(!alive.current||generation!==epoch.current)return;if(!result.success)throw new Error(result.error||'mysql_storage_read_failed');setSnapshot(result.snapshot);loaded.current=true;const row=result.snapshot.tablespaces.find(row=>row.id===selected.current);if(row)void loadDetail(row);else{selected.current='';setSelectedId('');}}
    catch(reason){if(alive.current&&generation===epoch.current){setSnapshot(null);selected.current='';setSelectedId('');setError(reason instanceof Error?reason.message:'mysql_storage_read_failed');}}
    finally{if(alive.current&&generation===epoch.current){reading.current=false;setLoading(false);}}
  });
  const dispose=useEventCallback(()=>{alive.current=false;++epoch.current;++detailEpoch.current;reading.current=false;detailing.current=false;});
  useEffect(()=>{alive.current=true;return dispose;},[dispose]);
  useEffect(()=>{if(active&&!busy&&!loaded.current&&!error)void reload();},[active,busy,error,reload]);
  const rows=(snapshot?.tablespaces||[]).filter(row=>(filter==='all'||(row.type||'unknown')===filter)&&[row.name,row.id,row.type,row.state].some(value=>value?.toLowerCase().includes(search.toLowerCase())));
  const select=(id:string)=>{if(busy||loading)return;selected.current=id;setSelectedId(id);const row=snapshot?.tablespaces.find(row=>row.id===id);if(row)void loadDetail(row);else{++detailEpoch.current;detailing.current=false;setDetail(null);setDetailError('');setDetailLoading(false);}};
  return {snapshot,detail,rows,selectedId,search,setSearch,filter,setFilter,loading,detailLoading,error,detailError,reload,select,retryDetail:()=>{const row=snapshot?.tablespaces.find(row=>row.id===selected.current);if(row&&!detailing.current&&!busy&&!loading)void loadDetail(row);}};
}
