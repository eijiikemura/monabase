// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useMemo,useRef,useState} from 'react';
import {ipcRenderer} from '@/shared/api/desktop';
import {useEventCallback} from '@/shared/hooks/useEventCallback';
import type {MysqlSession,MysqlSessionSnapshot,MysqlSessionDetail,MysqlSessionReview} from '@/shared/types/mysqlSessionTypes';
import type {MysqlUserRoleProps} from './useUserRoleTab';
export function useSessionTab(props:MysqlUserRoleProps){
 const [snapshot,setSnapshot]=useState<MysqlSessionSnapshot>(),[detail,setDetail]=useState<MysqlSessionDetail>(),[selectedId,setSelectedId]=useState('');
 const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[ready,setReady]=useState(false),[acting,setActing]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[notice,setNotice]=useState('');
 const [search,setSearch]=useState(''),[filter,setFilter]=useState<'all'|'active'|'waiting'>('all'),[refreshSeconds,setRefreshSeconds]=useState(0),[pagination,setPagination]=useState({page:0,pageSize:25});
 const [review,setReview]=useState<MysqlSessionReview>(),[confirm,setConfirm]=useState(''),[acknowledged,setAcknowledged]=useState(false);
 const alive=useRef(false),active=useRef(props.active),version=useRef(0),detailVersion=useRef(0),reading=useRef(false),detailing=useRef(false),writing=useRef(false),selection=useRef(''),sent=useRef(false),reviewing=useRef(false);
 useEffect(()=>{const requests=version,details=detailVersion,reads=reading,detailReads=detailing;alive.current=true;return()=>{alive.current=false;requests.current++;details.current++;reads.current=false;detailReads.current=false;};},[]);
 const clearReview=()=>{setReview(undefined);reviewing.current=false;setConfirm('');setAcknowledged(false);sent.current=false;};
 const select=(id:string)=>{if(writing.current||reviewing.current||props.busy||selection.current===id)return;selection.current=id;setSelectedId(id);detailVersion.current++;detailing.current=false;setDetailLoading(false);setDetail(undefined);setDetailError('');};
 const loadDetail=useEventCallback(async(row:MysqlSession)=>{
  if(!active.current||props.busy||writing.current||reviewing.current)return;const token=++detailVersion.current;detailing.current=true;setDetailLoading(true);setDetail(undefined);setDetailError('');
  const valid=()=>alive.current&&active.current&&detailVersion.current===token&&selection.current===row.id;
  try{const result=await ipcRenderer.invoke('get-mysql-session-detail',{id:row.id,fingerprint:row.fingerprint});if(!valid())return;if(!result.success)throw new Error(result.error);if(result.detail.sessionId!==row.id||result.detail.fingerprint!==row.fingerprint||result.detail.execution!==row.execution)throw new Error('mysql_session_sql_changed');setDetail(result.detail);}
  catch(failure){if(valid())setDetailError(failure instanceof Error?failure.message:'mysql_session_read_failed');}
  finally{if(alive.current&&detailVersion.current===token){detailing.current=false;setDetailLoading(false);}}
 });
 const reload=useEventCallback(async(afterOperation=false)=>{
  if(!alive.current||!active.current||props.busy&&!afterOperation||reading.current||detailing.current||writing.current||reviewing.current)return;const token=++version.current;reading.current=true;setLoading(true);setReady(false);setDetail(undefined);setError('');
  try{const result=await ipcRenderer.invoke('list-mysql-sessions');if(!alive.current||!active.current||token!==version.current)return;if(!result.success)throw new Error(result.error);setSnapshot(result.snapshot);setReady(true);if(selection.current&&!result.snapshot.sessions.some(row=>row.id===selection.current))select('');}
  catch(failure){if(alive.current&&active.current&&version.current===token)setError(failure instanceof Error?failure.message:'mysql_session_read_failed');}
  finally{if(alive.current&&version.current===token){reading.current=false;setLoading(false);}}
 });
 useEffect(()=>{active.current=props.active;if(props.active)void reload();else{version.current++;detailVersion.current++;reading.current=false;detailing.current=false;setReady(false);setDetail(undefined);setLoading(false);setDetailLoading(false);clearReview();}},[props.active,reload]);
 const selected=snapshot?.sessions.find(row=>row.id===selectedId);
 useEffect(()=>{if(props.active&&selected&&ready)void loadDetail(selected);},[props.active,selected,ready,loadDetail]);
 useEffect(()=>{if(!props.active||!refreshSeconds)return;const timer=setInterval(()=>{void reload();},refreshSeconds*1000);return()=>clearInterval(timer);},[props.active,refreshSeconds,reload]);
 useEffect(()=>{setPagination(previous=>({...previous,page:0}));},[search,filter]);
 const rows=useMemo(()=>(snapshot?.sessions||[]).filter(row=>(filter!=='active'||row.command==='Query')&&(filter!=='waiting'||/wait|lock/i.test(row.state||''))&&[row.connectionId,row.threadId,row.user,row.host,row.database,row.command,row.state,row.sqlText].join(' ').toLowerCase().includes(search.trim().toLowerCase())),[snapshot,search,filter]);
 const currentDetail=detail&&detail.sessionId===selected?.id&&detail.fingerprint===selected.fingerprint&&detail.execution===selected.execution?detail:undefined;
 const allowed=Boolean(props.active&&ready&&!props.busy&&!props.readonly&&!loading&&!detailLoading&&!acting&&selected&&!selected.protected&&rows.some(row=>row.id===selected.id));
 const canKill=allowed&&Boolean(selected?.canKill),canCancel=allowed&&Boolean(selected?.canCancel&&currentDetail);
 const command=async(action:'cancel'|'kill')=>{
  if(!(action==='cancel'?canCancel:canKill)||!selected||writing.current||reading.current||detailing.current||reviewing.current)return;
  writing.current=true;props.setBusy(true);setActing(true);setError('');setNotice('');clearReview();const token=version.current;
  try{const result=await ipcRenderer.invoke('review-mysql-session',{id:selected.id,fingerprint:selected.fingerprint,action,...(action==='cancel'&&selected.execution?{execution:selected.execution}:{})});if(!result.success)throw new Error(result.error);if(alive.current&&active.current&&token===version.current){setReview(result.review);reviewing.current=true;}}
  catch(failure){if(alive.current){setError(failure instanceof Error?failure.message:'mysql_session_read_failed');setReady(false);}}
  finally{writing.current=false;props.setBusy(false);if(alive.current)setActing(false);}
 };
 const execute=async()=>{
  if(!review||props.busy||props.readonly||!props.active||writing.current||sent.current||!acknowledged||confirm!==review.target.connectionId)return;
  sent.current=true;writing.current=true;setActing(true);props.setBusy(true);setError('');setReady(false);setDetail(undefined);
  let applied=false;
  try{const result=await ipcRenderer.invoke('manage-mysql-session',{token:review.token,confirm,acknowledged});if(!result.success)throw new Error(result.error);applied=true;if(alive.current)setNotice(result.status==='observed'?'mysql_session_observed':'mysql_session_requested');}
  catch(failure){if(alive.current)setError(failure instanceof Error&&failure.message.startsWith('mysql_session_')?failure.message:'mysql_session_unknown');}
  finally{writing.current=false;props.setBusy(false);if(alive.current){clearReview();setActing(false);}}
  if(applied)await reload(true);
 };
 const copy=async(value:string)=>{try{if(!await ipcRenderer.invoke('copy-to-clipboard',value))throw new Error();}catch{setDetailError('session_copy_failed');}};
 return {snapshot,detail:currentDetail,selected,selectedId,select,rows,search,setSearch,filter,setFilter,refreshSeconds,setRefreshSeconds,pagination,setPagination,loading,detailLoading,ready,acting,error,detailError,notice,reload,retryDetail:()=>{if(selected&&ready&&!detailing.current)void loadDetail(selected);},copy,canKill,canCancel,command,review,confirm,setConfirm,acknowledged,setAcknowledged,execute,canExecute:Boolean(review&&!props.busy&&!props.readonly&&props.active&&!sent.current&&acknowledged&&confirm===review.target.connectionId),close:()=>{if(!writing.current)clearReview();}};
}
