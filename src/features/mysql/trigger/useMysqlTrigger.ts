// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import type { MysqlTriggerDefinition, MysqlTriggerInfo, MysqlTriggerMutation, TransactionState } from '@/shared/api/desktopContract';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { runGitOperation } from '@/features/git/gitOperation';
import { emptyTrigger, parseTriggerAnswer, triggerSource } from './triggerModel';
export interface MysqlTriggerProps {
  tabId: number; schema: string; initialTable?: string; object?: DatabaseObject; request?: string; active: boolean; busy: boolean; readonly: boolean; disabled: boolean;
  setBusy: (value: boolean) => void; onState: (state: TransactionState) => void; onChanged: (object: DatabaseObject) => void; onDropped: () => void;
}
export function useMysqlTrigger(props: MysqlTriggerProps) {
  const {t}=useTranslation();const [form,setForm]=useState(()=>emptyTrigger(props.schema,props.initialTable));
  const [details,setDetails]=useState<MysqlTriggerInfo>(),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [recovery,setRecovery]=useState<{token:string;sql:string}>(),[review,setReview]=useState<{request:MysqlTriggerMutation;sql:string}>();
  const [attempted,setAttempted]=useState(false),[logs,setLogs]=useState<{sql:string;message:string}[]>([]);
  const mounted=useRef(true),version=useRef(0),running=useRef(false),attemptedRef=useRef(false),baseline=useRef('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=useEventCallback(async()=>{
    if(!props.object)return;
    const token=++version.current;setLoading(true);setError('');setReview(undefined);
    try{const result=await ipcRenderer.invoke('get-mysql-trigger',{schema:props.object.schema,name:props.object.name});if(!result.success)throw new Error(result.error);
      if(!mounted.current||token!==version.current)return;const next=result.trigger;
      const before=baseline.current;setDetails(next);setForm(previous=>!before||JSON.stringify(previous)===before?{schema:next.schema,name:next.name,table:next.table,timing:next.timing,event:next.event,body:next.body}:previous);
      baseline.current=JSON.stringify({schema:next.schema,name:next.name,table:next.table,timing:next.timing,event:next.event,body:next.body});
    }catch(failure){if(mounted.current&&token===version.current){setDetails(undefined);setError(failure instanceof Error?failure.message:t('execution_failed'));}}
    finally{if(mounted.current&&token===version.current)setLoading(false);}
  });
  useEffect(()=>{void load();},[props.object?.key,load]);
  const locked=props.busy||props.readonly||props.disabled||loading;
  const update=(next:Partial<MysqlTriggerDefinition>)=>{if(locked)return;if(props.object&&(next.name!==undefined||next.schema!==undefined||next.table!==undefined))return;setForm(previous=>({...previous,...next}));setReview(undefined);setError('');};
  let text='';try{text=triggerSource(form,details);}catch{/* A new trigger has no valid identity until the form is filled. */}
  const setText=(source:string)=>{if(locked)throw new Error('The trigger editor is currently unavailable.');try{const next=parseTriggerAnswer(source,form,details);update({timing:next.timing,event:next.event,body:next.body});}catch(failure){setError(failure instanceof Error?failure.message:t('execution_failed'));throw failure;}};
  const prepare=useEventCallback((operation:'save'|'drop'|'restore'='save')=>{
    if(locked||running.current)return;
    try{
      let request:MysqlTriggerMutation,sql:string;
      if(operation==='restore'){if(!recovery)throw new Error('No trigger recovery is available.');request={schema:form.schema,name:form.name,operation:'restore',recoveryToken:recovery.token};sql=recovery.sql;}
      else {if(props.object&&!details)throw new Error(t('trigger_load_failed'));if(!form.body.trim()||!form.name||!form.table)throw new Error(t('mysql_trigger_complete_form'));
        request={...form,operation:operation==='drop'?'drop':props.object?'replace':'create',fingerprint:details?.fingerprint};
        const create=triggerSource(form,details);sql=operation==='drop'?`DROP TRIGGER ${'`'+form.schema.replaceAll('`','``')+'`'}.${'`'+form.name.replaceAll('`','``')+'`'}`:props.object?`DROP TRIGGER \`${form.schema.replaceAll('`','``')}\`.\`${form.name.replaceAll('`','``')}\`;\n\n${create}`:create;
      }
      setReview({request,sql});setAttempted(false);attemptedRef.current=false;setError('');
    }catch(failure){setError(failure instanceof Error?failure.message:t('execution_failed'));}
  });
  const handled=useRef('');useEffect(()=>{if(props.request&&handled.current!==props.request&&!locked&&details){handled.current=props.request;prepare('drop');}},[props.request,locked,details,prepare]);
  const execute=async()=>{
    if(locked||!review||running.current||attemptedRef.current)return;
    running.current=true;attemptedRef.current=true;setAttempted(true);props.setBusy(true);setError('');let message='';
    try{
      let result;try{result=await ipcRenderer.invoke('mutate-mysql-trigger',review.request);}catch(failure){props.onState({transactionStatus:'unknown'});throw failure;}
      props.onState(result);setRecovery(previous=>result.recovery||(!result.success?previous:undefined));
      if(!result.success){if(result.applied)setDetails(undefined);throw new Error((result.stage==='dropped'?t('mysql_trigger_missing_recover')+' ':result.applied?t('mysql_view_applied_refresh_failed')+' ':'')+result.error);}
      setReview(undefined);
      if(review.request.operation==='drop'){
        const git=await runGitOperation(t,'git-delete-object',{dbType:'MYSQL',schema:form.schema,objectType:'TRIGGER',objectName:form.name});if(!git.success)window.alert(t('mysql_view_git_failed'));props.onDropped();
      }else{
        const next=result.trigger;if(!next)throw new Error('The trigger was applied but its definition is unavailable. Reload before continuing.');
        const saved={schema:next.schema,name:next.name,table:next.table,timing:next.timing,event:next.event,body:next.body};setForm(saved);setDetails(next);baseline.current=JSON.stringify(saved);
        props.onChanged({key:JSON.stringify(['mysql',next.schema,'TRIGGER',next.name]),dbType:'mysql',schema:next.schema,category:'TRIGGER',name:next.name,parentName:next.table,displayName:next.name});
        const git=await runGitOperation(t,'git-commit',{dbType:'MYSQL',schema:next.schema,objectType:'TRIGGER',objectName:next.name,sourceText:next.native,message:`Update trigger ${next.name}`});if(!git.success)setError(t('mysql_view_git_failed'));
      }message=t('success');
    }catch(failure){message=failure instanceof Error?failure.message:t('execution_failed');if(mounted.current)setError(message);}
    finally{if(mounted.current)setLogs(previous=>[...previous.slice(-99),{sql:review.sql,message}]);running.current=false;props.setBusy(false);window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:form.schema,objType:'TRIGGER'}}));window.dispatchEvent(new CustomEvent('reload-statistics',{detail:{schema:form.schema,tableName:form.table}}));window.dispatchEvent(new CustomEvent('reload-source',{detail:{schema:form.schema,tableName:form.table}}));window.dispatchEvent(new Event('mysql-transaction-finished'));}
  };
  return {form,details,loading,error,locked,recovery,review,attempted,logs,text,load,update,setText,prepare,execute,closeReview:()=>{if(!running.current)setReview(undefined);},clearLogs:()=>setLogs([])};
}
