// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useMemo,useRef,useState} from 'react';
import {ipcRenderer} from '@/shared/api/desktop';
import {useEventCallback} from '@/shared/hooks/useEventCallback';
import type {TransactionState} from '@/shared/api/desktopContract';
import type {MysqlAccountAction,MysqlAccountRequest,MysqlAccountSnapshot,MysqlAccountDetail,MysqlAccountReview} from '@/shared/types/mysqlUserRoleTypes';
export interface MysqlUserRoleProps {active:boolean;busy:boolean;readonly:boolean;setBusy:(value:boolean)=>void;onState:(state:TransactionState)=>void;}
export function useUserRoleTab(props:MysqlUserRoleProps){
 const [snapshot,setSnapshot]=useState<MysqlAccountSnapshot>(),[detail,setDetail]=useState<MysqlAccountDetail>(),[selected,setSelected]=useState('');
 const [search,setSearch]=useState(''),[includeProtected,setIncludeProtected]=useState(false),[rolesOnly,setRolesOnly]=useState(false);
 const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[detailError,setDetailError]=useState(''),[applied,setApplied]=useState(false);
 const [draft,setDraft]=useState<MysqlAccountRequest>(),[review,setReview]=useState<MysqlAccountReview>(),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[acknowledged,setAcknowledged]=useState(false);
 const [pagination,setPagination]=useState({page:0,pageSize:100});
 const mounted=useRef(true),generation=useRef(0),detailGeneration=useRef(0),running=useRef(false),attempted=useRef(false);
 const clear=useEventCallback(()=>{setPassword('');setDraft(undefined);setReview(undefined);setConfirm('');setAcknowledged(false);attempted.current=false;});
 useEffect(()=>{const requests=generation,details=detailGeneration;mounted.current=true;return()=>{mounted.current=false;requests.current++;details.current++;};},[]);
 useEffect(()=>{if(!props.active||props.readonly)clear();},[props.active,props.readonly,clear]);
 const readSnapshot=async(desiredId?:string)=>{
  const token=++generation.current;setLoading(true);setError('');
  try{const response=await ipcRenderer.invoke('list-mysql-accounts');if(!response.success)throw new Error(response.error);if(mounted.current&&token===generation.current){setSnapshot(response.snapshot);setSelected(old=>desiredId&&response.snapshot.accounts.some(row=>row.id===desiredId)?desiredId:response.snapshot.accounts.some(row=>row.id===old)?old:response.snapshot.accounts.find(row=>row.self)?.id||response.snapshot.accounts[0]?.id||'');setDetail(undefined);}}
  catch(failure){if(mounted.current&&token===generation.current){setSnapshot(undefined);setDetail(undefined);setError(failure instanceof Error?failure.message:'mysql_user_load_failed');}}
  finally{if(mounted.current&&token===generation.current){setLoading(false);setLoaded(true);}}
 };
 const reload=useEventCallback(async()=>{if(props.busy||running.current)return;clear();await readSnapshot();});
 useEffect(()=>{if(props.active&&!loaded&&!props.busy)void reload();},[props.active,props.busy,loaded,reload]);
 const loadDetail=useEventCallback(async()=>{
  const target=snapshot?.accounts.find(row=>row.id===selected),token=++detailGeneration.current;setDetail(undefined);setDetailError('');if(!target){setDetailLoading(false);return;}setDetailLoading(true);
  try{const response=await ipcRenderer.invoke('get-mysql-account',{user:target.user,host:target.host});if(!response.success)throw new Error(response.error);if(mounted.current&&token===detailGeneration.current)setDetail(response.detail);}
  catch(failure){if(mounted.current&&token===detailGeneration.current)setDetailError(failure instanceof Error?failure.message:'mysql_user_load_failed');}
  finally{if(mounted.current&&token===detailGeneration.current)setDetailLoading(false);}
 });
 useEffect(()=>{if(props.active&&!props.busy)void loadDetail();},[props.active,props.busy,snapshot,selected,loadDetail]);
 const select=(value:string)=>{if(props.busy||running.current)return;clear();setSelected(value);setDetail(undefined);};
 const can=(action:MysqlAccountAction)=>{
  if(props.busy||props.readonly||loading||!snapshot||snapshot.context.readonly)return false;
  if(action==='create')return snapshot.context.canCreate;
  if(detailLoading||!detail||detail.target.id!==selected||detail.target.protected)return false;
  if(action==='drop')return snapshot.context.canDrop&&detail.dependenciesComplete&&!detail.definers.length;
  if(action==='password')return snapshot.context.canCreate&&detail.target.plugin==='caching_sha2_password';
  if(action==='grant'||action==='revoke')return snapshot.context.canGrant;
  if(action.startsWith('role-')||action==='default-role')return snapshot.context.canRole;
  return snapshot.context.canCreate;
 };
 const open=(action:MysqlAccountAction)=>{
  if(!can(action))return;clear();setApplied(false);setError('');
  setDraft(action==='create'?{action,target:{user:'',host:'localhost'},kind:'USER',locked:false}:{action,target:{user:detail!.target.user,host:detail!.target.host},expected:detail!.fingerprint,...(action==='lock'?{locked:!detail!.target.locked}:{}),...(action==='limits'?{limits:{...detail!.target.limits}}:{}),...(['grant','revoke'].includes(action)?{scope:'database' as const,database:detail!.databases[0]||'',privilege:'SELECT'}:{}),...(action==='default-role'?{role:null}:{})});
 };
 const update=(next:Partial<MysqlAccountRequest>)=>{if(props.busy||running.current)return;setDraft(old=>old?{...old,...next}:old);setReview(undefined);setPassword('');setConfirm('');setAcknowledged(false);};
 const prepare=async()=>{
  if(!draft||!can(draft.action)||running.current)return;running.current=true;props.setBusy(true);setError('');
  try{const response=await ipcRenderer.invoke('review-mysql-account',draft);if(!response.success)throw new Error(response.error);if(mounted.current){setReview(response.review);attempted.current=false;setConfirm('');setAcknowledged(false);}}
  catch(failure){if(mounted.current){setPassword('');setReview(undefined);setError(failure instanceof Error?failure.message:'mysql_user_load_failed');}}
  finally{running.current=false;props.setBusy(false);}
 };
 const needsPassword=draft?.action==='password'||draft?.action==='create'&&draft.kind==='USER';
 const targetName=draft?`${draft.target.user}@${draft.target.host}`:'';
 const execute=async()=>{
  if(!draft||!review||!can(draft.action)||running.current||attempted.current||!acknowledged||confirm!==targetName||needsPassword&&!password)return;
  const token=review.token,secret=needsPassword?password:undefined;setPassword('');attempted.current=true;running.current=true;props.setBusy(true);setError('');
  try{
   let response;try{response=await ipcRenderer.invoke('execute-mysql-account',{token,...(secret!==undefined?{password:secret}:{}),confirm,acknowledged});}catch{props.onState({transactionStatus:'unknown'});throw new Error('mysql_user_unknown');}
   if(response.transactionStatus)props.onState(response);
   if(!response.success)throw new Error(response.error+(response.errorCode?' ('+response.errorCode+')':''));
   if(mounted.current){setApplied(true);if(draft.action==='create'){setSearch('');setRolesOnly(false);}clear();await readSnapshot(JSON.stringify([draft.target.user,draft.target.host]));}
  }catch(failure){if(mounted.current){setReview(undefined);setConfirm('');setAcknowledged(false);setError(failure instanceof Error?failure.message:'mysql_user_operation_failed');}}
  finally{running.current=false;props.setBusy(false);}
 };
 const rows=useMemo(()=>(snapshot?.accounts||[]).filter(row=>(includeProtected||!row.protected||row.self)&&(!rolesOnly||row.referencedRole)&&`${row.user}@${row.host}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())),[snapshot,includeProtected,rolesOnly,search]);
 useEffect(()=>{if(selected&&!rows.some(row=>row.id===selected)){setSelected('');setDetail(undefined);clear();}},[rows,selected,clear]);
 return {snapshot,detail,selected,select,rows,loading,detailLoading,error,detailError,applied,reload,loadDetail,search,setSearch,includeProtected,setIncludeProtected,rolesOnly,setRolesOnly,pagination,setPagination,can,open,draft,update,review,prepare,password,setPassword,needsPassword,targetName,confirm,setConfirm,acknowledged,setAcknowledged,execute,close:()=>{if(!props.busy&&!running.current)clear();},canExecute:Boolean(draft&&can(draft.action)&&review&&acknowledged&&confirm===targetName&&(!needsPassword||password)&&!attempted.current)};
}
