// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {MysqlProcedureInfo,MysqlProcedureMutation,StoredData,TransactionState} from '@/shared/api/desktopContract';
import type {DatabaseObject} from '@/shared/types/objectTypes';
import {canonicalTemporalInput} from '@/shared/utils/temporalValues';
import {useEventCallback} from '@/shared/hooks/useEventCallback';
import {runGitOperation} from '@/features/git/gitOperation';
import {mysqlTableName} from '../table/tableModel';
export interface MysqlProcedureProps {
  kind?:'PROCEDURE'|'FUNCTION';tabId:number;schema:string;inputDateFormat?:string;object?:DatabaseObject;request?:string;active:boolean;busy:boolean;readonly:boolean;disabled:boolean;
  setBusy:(value:boolean)=>void;setDdlBusy:(value:boolean)=>void;onState:(state:TransactionState)=>void;onChanged:(object:DatabaseObject)=>void;onDropped:()=>void;
}
export function useMysqlProcedure(props:MysqlProcedureProps){
  const {t}=useTranslation();
  const kind=props.kind||'PROCEDURE',isFunction=kind==='FUNCTION',newName=isFunction?'new_function':'new_procedure';
  const routineText=(key:string,values?:Record<string,string>)=>t(isFunction?key.replace('mysql_procedure_','mysql_function_'):key,values);
  const [name,setName]=useState(props.object?.name||''),[text,setSource]=useState('CREATE '+kind+' '+mysqlTableName(props.schema,props.object?.name||newName)+(isFunction?'(p_value INT)\nRETURNS INT\nDETERMINISTIC\nNO SQL\nBEGIN\n  RETURN p_value;\nEND':'(IN p_value INT)\nBEGIN\n  SELECT p_value AS value;\nEND'));
  const [details,setDetails]=useState<MysqlProcedureInfo>(),[loading,setLoading]=useState(false),[error,setError]=useState(''),[args,setArgs]=useState<Record<string,string>>({});
  const [review,setReview]=useState<{request:MysqlProcedureMutation;sql:string}>(),[recovery,setRecovery]=useState<{token:string;sql:string}>(),[attempted,setAttempted]=useState(false);
  const [output,setOutput]=useState<StoredData>(),[logs,setLogs]=useState<string[]>([]);
  const mounted=useRef(true),version=useRef(0),baseline=useRef(''),running=useRef(false),tried=useRef(false);
  useEffect(()=>{const counter=version;mounted.current=true;return()=>{mounted.current=false;counter.current++;};},[]);
  const load=useEventCallback(async()=>{
    if(!props.object)return;const token=++version.current,before=baseline.current;setLoading(true);setError('');setReview(undefined);
    try{const request={schema:props.object.schema,name:props.object.name};const result=isFunction?await ipcRenderer.invoke('get-mysql-function',request).then(({routine,...rest})=>({...rest,procedure:routine})):await ipcRenderer.invoke('get-mysql-procedure',request);if(!result.success)throw new Error(result.error);const next=result.procedure;if(!next)throw new Error('The routine definition is unavailable.');if(!mounted.current||token!==version.current)return;
      setDetails(next);setSource(previous=>!before||previous===before?next.source:previous);baseline.current=next.source;
      // Only retain inputs whose name, direction and SQL type still match the server metadata.
      setArgs(previous=>Object.fromEntries(next.parameters.filter(p=>p.direction!=='OUT'&&details?.parameters.some(old=>old.name===p.name&&old.type===p.type&&old.direction===p.direction)).map(p=>[p.name,previous[p.name]||''])));
    }catch(failure){if(mounted.current&&token===version.current){setDetails(undefined);setError(failure instanceof Error?failure.message:t('execution_failed'));}}
    finally{if(mounted.current&&token===version.current)setLoading(false);}
  });
  useEffect(()=>{void load();},[props.object?.key,load]);
  const locked=props.busy||props.readonly||props.disabled||loading;
  const setText=(source:string)=>{if(locked||running.current)throw new Error('The procedure editor is unavailable.');setSource(source);setReview(undefined);};
  const updateName=(value:string)=>{if(locked||props.object)return;setSource(previous=>previous.replace(mysqlTableName(props.schema,name||newName),mysqlTableName(props.schema,value||newName)));setName(value);setReview(undefined);};
  const prepare=useEventCallback((operation:'save'|'drop'|'restore'='save')=>{
    if(locked||running.current)return;
    if(!name||operation!=='restore'&&props.object&&!details){setError(routineText('mysql_procedure_load_first'));return;}
    const request:MysqlProcedureMutation={schema:props.schema,name,source:text,operation:operation==='save'?(props.object?'replace':'create'):operation,fingerprint:details?.fingerprint,recoveryToken:recovery?.token};
    if(operation==='restore'&&!recovery)return;
    const drop='DROP '+kind+' '+mysqlTableName(props.schema,name);
    setReview({request,sql:operation==='restore'?recovery!.sql:operation==='drop'?drop:props.object?drop+';\n\n'+text:text});setAttempted(false);tried.current=false;setError('');
  });
  const handled=useRef('');useEffect(()=>{if(props.request&&handled.current!==props.request&&!locked&&details){handled.current=props.request;prepare('drop');}},[props.request,locked,details,prepare]);
  const finish=()=>{window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:props.schema,objType:kind}}));window.dispatchEvent(new Event('mysql-transaction-finished'));};
  const execute=async()=>{
    if(locked||!review||running.current||tried.current)return;
    running.current=true;tried.current=true;setAttempted(true);props.setDdlBusy(true);setError('');let message='';
    try{
      let result;try{result=isFunction?await ipcRenderer.invoke('mutate-mysql-function',review.request).then(({routine,...rest})=>({...rest,procedure:routine})):await ipcRenderer.invoke('mutate-mysql-procedure',review.request);}catch(failure){props.onState({transactionStatus:'unknown'});throw failure;}
      props.onState(result);setRecovery(previous=>result.recovery||(!result.success?previous:undefined));
      if(!result.success){
        if(result.applied){setDetails(undefined);if(result.stage==='applied'&&!props.object)props.onChanged({key:JSON.stringify(['mysql',props.schema,kind,name]),dbType:'mysql',schema:props.schema,category:kind,name,displayName:name});}
        throw new Error((result.stage==='dropped'?routineText('mysql_procedure_recovery_help')+' ':result.applied?t('mysql_view_applied_refresh_failed')+' ':'')+result.error);
      }
      setReview(undefined);setOutput(undefined);
      if(review.request.operation==='drop'){
        const git=await runGitOperation(t,'git-delete-object',{dbType:'MYSQL',schema:props.schema,objectType:kind,objectName:name});if(!git.success)window.alert(t('mysql_view_git_failed'));props.onDropped();
      }else{
        const next=result.procedure;if(!next)throw new Error(routineText('mysql_procedure_load_first'));
        setDetails(next);setSource(next.source);baseline.current=next.source;setArgs({});
        props.onChanged({key:JSON.stringify(['mysql',next.schema,kind,next.name]),dbType:'mysql',schema:next.schema,category:kind,name:next.name,displayName:next.name});
        const git=await runGitOperation(t,'git-commit',{dbType:'MYSQL',schema:next.schema,objectType:kind,objectName:next.name,sourceText:next.native,message:`Update ${kind.toLowerCase()} ${next.name}`});if(!git.success)setError(t('mysql_view_git_failed'));
      }
      message=t('success');
    }catch(failure){message=failure instanceof Error?failure.message:t('execution_failed');if(mounted.current)setError(message);}
    finally{if(mounted.current)setLogs(previous=>[...previous.slice(-99),message]);running.current=false;props.setDdlBusy(false);finish();}
  };
  const call=async()=>{
    if(locked||running.current||!details||review)return;
    running.current=true;props.setBusy(true);setError('');setOutput(undefined);
    try{
      const inputs:Record<string,string|null>={...args};
      for(const parameter of details.parameters){
        const value=args[parameter.name];
        if(parameter.direction!=='OUT'&&value&&/^(date|datetime|timestamp)\b/i.test(parameter.type)){
          const normalized=canonicalTemporalInput(value,props.inputDateFormat||'YYYY-MM-DD HH:mm:ss');
          if(!normalized)throw new Error(routineText('mysql_procedure_date_input',{name:parameter.name}));inputs[parameter.name]=normalized;
        }
      }
      let result;try{result=await ipcRenderer.invoke('execute-stored',{schema:props.schema,objectName:name,objectType:kind,args:inputs,argTypes:{},argDirections:{},inputDateFormat:props.inputDateFormat||'',mysqlFingerprint:details.fingerprint});}catch(failure){props.onState({transactionStatus:'unknown'});throw failure;}
      props.onState(result);if(!result.success)throw new Error(result.error);if(mounted.current){setOutput(result);setLogs(previous=>[...previous.slice(-99),t('success')]);}
    }catch(failure){if(mounted.current){const message=failure instanceof Error?failure.message:t('execution_failed');setError(message);setLogs(previous=>[...previous.slice(-99),message]);}}
    finally{running.current=false;props.setBusy(false);finish();}
  };
  return {name,text,details,loading,error,locked,args,setArgs,review,recovery,attempted,output,logs,load,setText,updateName,prepare,execute,call,clearLogs:()=>setLogs([]),closeReview:()=>{if(!running.current)setReview(undefined);}};
}
