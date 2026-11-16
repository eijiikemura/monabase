// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { ipcRenderer } from '@/shared/api/desktop';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { MysqlDatabase, MysqlDatabaseDetail, MysqlDatabaseSnapshot } from '@/shared/types/mysqlDatabaseTypes';
export function useDatabaseTab(active: boolean, busy: boolean) {
  const [snapshot,setSnapshot]=useState<MysqlDatabaseSnapshot|null>(null),[detail,setDetail]=useState<MysqlDatabaseDetail|null>(null);
  const [revision,setRevision]=useState(0);
  const [selectedId,setSelectedId]=useState(''),[search,setSearch]=useState('');
  const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState('');
  const alive=useRef(false),epoch=useRef(0),detailEpoch=useRef(0),reading=useRef(false),detailing=useRef(false),selected=useRef(''),loaded=useRef(false);
  const loadDetail=useEventCallback(async(row:MysqlDatabase)=>{
    const generation=++detailEpoch.current;detailing.current=true;setDetail(null);setDetailError('');setDetailLoading(true);
    try{const result=await ipcRenderer.invoke('get-mysql-database-detail',{name:row.name});if(!alive.current||generation!==detailEpoch.current)return;if(!result.success)throw new Error(result.error||'mysql_database_read_failed');setDetail(result.detail);}
    catch(reason){if(alive.current&&generation===detailEpoch.current)setDetailError(reason instanceof Error?reason.message:'mysql_database_read_failed');}
    finally{if(alive.current&&generation===detailEpoch.current){detailing.current=false;setDetailLoading(false);}}
  });
  const reload=useEventCallback(async()=>{
    if(!active||busy||reading.current)return;reading.current=true;const generation=++epoch.current;++detailEpoch.current;detailing.current=false;
    setLoading(true);setError('');setDetail(null);setDetailError('');setDetailLoading(false);
    try{const result=await ipcRenderer.invoke('list-mysql-databases');if(!alive.current||generation!==epoch.current)return;if(!result.success)throw new Error(result.error||'mysql_database_read_failed');setSnapshot(result.snapshot);loaded.current=true;const row=result.snapshot.databases.find(row=>row.id===selected.current);if(row)void loadDetail(row);else{selected.current='';setSelectedId('');}}
    catch(reason){if(alive.current&&generation===epoch.current){setSnapshot(null);selected.current='';setSelectedId('');setError(reason instanceof Error?reason.message:'mysql_database_read_failed');}}
    finally{if(alive.current&&generation===epoch.current){reading.current=false;setLoading(false);}}
  });
  const dispose=useEventCallback(()=>{alive.current=false;++epoch.current;++detailEpoch.current;reading.current=false;detailing.current=false;});
  useEffect(()=>{alive.current=true;return dispose;},[dispose]);
  useEffect(()=>{const changed=()=>{++epoch.current;++detailEpoch.current;reading.current=false;detailing.current=false;loaded.current=false;setError('');setDetail(null);setLoading(false);setDetailLoading(false);setRevision(v=>v+1);};window.addEventListener('mysql-databases-changed',changed);return()=>window.removeEventListener('mysql-databases-changed',changed);},[]);
  useEffect(()=>{if(active&&!busy&&!loaded.current&&!error)void reload();},[active,busy,error,reload,revision]);
  const rows=(snapshot?.databases||[]).filter(row=>[row.name,row.charset,row.collation].some(value=>value?.toLowerCase().includes(search.toLowerCase())));
  const select=(id:string)=>{if(busy||loading)return;selected.current=id;setSelectedId(id);const row=snapshot?.databases.find(row=>row.id===id);if(row)void loadDetail(row);else{++detailEpoch.current;detailing.current=false;setDetail(null);setDetailError('');setDetailLoading(false);}};
  return {snapshot,detail,rows,selectedId,search,setSearch,loading,detailLoading,error,detailError,reload,select,retryDetail:()=>{const row=snapshot?.databases.find(row=>row.id===selected.current);if(row&&!detailing.current&&!busy&&!loading)void loadDetail(row);}};
}
