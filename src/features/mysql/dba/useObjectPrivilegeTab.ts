// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {ipcRenderer} from '@/shared/api/desktop';
import {useEventCallback} from '@/shared/hooks/useEventCallback';
import type {MysqlAccount} from '@/shared/types/mysqlUserRoleTypes';
import type {MysqlPrivilegeTarget,MysqlObjectPrivilegeDetail,MysqlObjectPrivilegeReview} from '@/shared/types/mysqlObjectPrivilegeTypes';
import type {MysqlUserRoleProps} from './useUserRoleTab';
const key=(account:MysqlAccount)=>JSON.stringify([account.user,account.host]);
export function useObjectPrivilegeTab(props:MysqlUserRoleProps){
 const [target,setTarget]=useState<MysqlPrivilegeTarget>(),[detail,setDetail]=useState<MysqlObjectPrivilegeDetail>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[applied,setApplied]=useState(false);
 const [review,setReview]=useState<MysqlObjectPrivilegeReview>(),[confirm,setConfirm]=useState(''),[acknowledged,setAcknowledged]=useState(false),[attempted,setAttempted]=useState(false);
 const alive=useRef(true),version=useRef(0),running=useRef(false),sent=useRef(false);
 useEffect(()=>{const requests=version;alive.current=true;return()=>{alive.current=false;requests.current++;};},[]);
 const clear=()=>{setReview(undefined);setConfirm('');setAcknowledged(false);setAttempted(false);sent.current=false;};
 const reload=useEventCallback(async()=>{
  if(!target||props.busy||running.current)return;const token=++version.current;setLoading(true);setError('');setDetail(undefined);clear();
  try{const result=await ipcRenderer.invoke('get-mysql-object-privileges',target);if(!result.success)throw new Error(result.error);if(alive.current&&token===version.current)setDetail(result.detail);}
  catch(failure){if(alive.current&&token===version.current)setError(failure instanceof Error?failure.message:'mysql_obj_load_failed');}
  finally{if(alive.current&&token===version.current)setLoading(false);}
 });
 useEffect(()=>{if(props.active&&target)void reload();else{version.current++;setDetail(undefined);setLoading(false);clear();}},[props.active,target,reload]);
 const select=(next:MysqlPrivilegeTarget)=>{if(props.busy||running.current)return;version.current++;setDetail(undefined);setApplied(false);setError('');clear();setTarget(next);};
 const editable=(account:MysqlAccount,privilege:string)=>{
  if(!props.active||props.busy||props.readonly||loading||!detail?.mutable||detail.readonly)return false;
  const row=detail.principals.find(row=>key(row)===key(account));return Boolean(row&&!row.protected&&detail.privileges.includes(privilege)&&!detail.columnGrants.some(g=>key(g.account)===key(account)&&g.privilege===privilege)&&!detail.grants.some(g=>key(g.account)===key(account)&&g.privilege===privilege&&g.grantable));
 };
 const change=async(account:MysqlAccount,privilege:string,grant:boolean)=>{
  if(!detail||!editable(account,privilege)||running.current||detail.grants.some(g=>key(g.account)===key(account)&&g.privilege===privilege)===grant)return;
  running.current=true;props.setBusy(true);setError('');clear();const token=version.current;
  try{const result=await ipcRenderer.invoke('review-mysql-object-privileges',{target:detail.target,grantee:{user:account.user,host:account.host},privilege,action:grant?'grant':'revoke',expected:detail.fingerprint});if(!result.success)throw new Error(result.error);if(alive.current&&token===version.current)setReview(result.review);}
  catch(failure){if(alive.current&&token===version.current)setError(failure instanceof Error?failure.message:'mysql_obj_load_failed');}
  finally{running.current=false;props.setBusy(false);}
 };
 const execute=async()=>{
  if(!review||!detail||props.busy||props.readonly||running.current||sent.current||!acknowledged||confirm!==review.request.grantee.user+'@'+review.request.grantee.host||!editable(review.request.grantee,review.request.privilege))return;
  sent.current=true;setAttempted(true);running.current=true;props.setBusy(true);setError('');
  try{
   let result;try{result=await ipcRenderer.invoke('execute-mysql-object-privileges',{token:review.token,confirm,acknowledged});}catch{props.onState({transactionStatus:'unknown'});throw new Error('mysql_obj_unknown');}
   if(result.transactionStatus)props.onState(result);
   if(!result.success)throw new Error(result.error+(result.errorCode?' ('+result.errorCode+')':''));
   if(alive.current){setApplied(result.applied);setReview(undefined);setDetail(result.detail);if(result.refreshError)setError(result.refreshError);}
  }catch(failure){if(alive.current){setDetail(undefined);setReview(undefined);setError(failure instanceof Error?failure.message:'mysql_obj_failed');}}
  finally{running.current=false;props.setBusy(false);}
 };
 return {target,detail,select,reload,loading,error,applied,editable,change,review,confirm,setConfirm,acknowledged,setAcknowledged,attempted,execute,close:()=>{if(!props.busy&&!running.current)clear();},canExecute:Boolean(review&&acknowledged&&confirm===review.request.grantee.user+'@'+review.request.grantee.host&&!attempted&&editable(review.request.grantee,review.request.privilege))};
}
