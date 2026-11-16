// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import {useEventCallback} from '@/shared/hooks/useEventCallback';
import type {TransactionState} from '@/shared/api/desktopContract';
import {loadTableMetadata} from '../table/tableRepository';
import {assertCheckTable,checkStatement,type MysqlCheckDetails,type MysqlCheckForm} from './checkModel';
import {loadMysqlCheck} from './checkRepository';
export interface MysqlCheckProps {
  schema:string;table:string;constraintName?:string;request?:string;active:boolean;busy:boolean;readonly:boolean;theme:string;
  setBusy:(busy:boolean)=>void;onState:(state:TransactionState)=>void;onChanged:(name:string)=>void;onDropped:()=>void;
}
export function useMysqlCheck(props:MysqlCheckProps){
  const {t}=useTranslation();
  const [form,setForm]=useState<MysqlCheckForm>({name:props.constraintName||'',condition:'',enforced:true});
  const [details,setDetails]=useState<MysqlCheckDetails>(),[columns,setColumns]=useState<string[]>([]);
  const [loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState(''),[attempted,setAttempted]=useState(false);
  const [review,setReview]=useState<{sql:string;drop:boolean;form:MysqlCheckForm;fingerprint?:string}>();
  const [logs,setLogs]=useState<{sql:string;message:string}[]>([]);
  const mounted=useRef(true),version=useRef(0),running=useRef(false),sent=useRef(false),request=useRef('');
  useEffect(()=>{const lifecycle=version;mounted.current=true;return()=>{mounted.current=false;lifecycle.current++;};},[]);
  const locked=props.busy||props.readonly||loading||!loaded||!columns.length||Boolean(props.constraintName&&!details);
  const load=useEventCallback(async()=>{
    if(running.current||props.busy)return;const token=++version.current;setLoading(true);setError('');setReview(undefined);setDetails(undefined);setColumns([]);
    try{
      const metadata=await loadTableMetadata(props.schema,props.table);assertCheckTable(metadata);
      const info=props.constraintName?await loadMysqlCheck(props.schema,props.table,props.constraintName):undefined;
      if(!mounted.current||token!==version.current)return;
      setColumns(metadata.columns.map(c=>c.COLUMN_NAME));setDetails(info);
      if(info)setForm({name:props.constraintName||'',condition:info.condition,enforced:info.enforced});
      sent.current=false;setAttempted(false);
    }catch(failure){if(mounted.current&&token===version.current)setError(failure instanceof Error?failure.message:t('execution_failed'));}
    finally{if(mounted.current&&token===version.current){setLoading(false);setLoaded(true);}}
  });
  useEffect(()=>{if(props.active&&!loaded&&!props.busy)void load();},[props.active,loaded,props.busy,load]);
  const update=(next:Partial<MysqlCheckForm>)=>{
    if(locked)return;setForm(old=>({...old,...next,condition:props.constraintName?old.condition:next.condition??old.condition}));setReview(undefined);setError('');sent.current=false;setAttempted(false);
  };
  const prepare=useEventCallback((drop:boolean=false)=>{
    if(locked||running.current)return;
    try{const statement=checkStatement(props.schema,props.table,form,details,props.constraintName,drop);setReview({sql:statement.sql,drop,form:{...form},fingerprint:details?.fingerprint});setError('');sent.current=false;setAttempted(false);}
    catch(failure){setError(failure instanceof Error?failure.message:t('execution_failed'));}
  });
  useEffect(()=>{if(props.active&&props.request&&request.current!==props.request&&!locked&&details){request.current=props.request;prepare(true);}},[props.active,props.request,locked,details,prepare]);
  const execute=async()=>{
    if(locked||!review||sent.current||running.current)return;
    running.current=true;sent.current=true;setAttempted(true);props.setBusy(true);setError('');let applied=false;
    try{
      const metadata=await loadTableMetadata(props.schema,props.table);assertCheckTable(metadata);
      const current=props.constraintName?await loadMysqlCheck(props.schema,props.table,props.constraintName):undefined;
      if(current?.fingerprint!==review.fingerprint)throw new Error(t('mysql_check_changed'));
      if(!current&&metadata.checks.some(row=>String(row.CONSTRAINT_NAME).toLowerCase()===review.form.name.toLowerCase()))throw new Error(t('mysql_check_changed'));
      const statement=checkStatement(props.schema,props.table,review.form,current,props.constraintName,review.drop);
      if(statement.sql!==review.sql)throw new Error(t('mysql_check_changed'));
      let result;
      try{result=await ipcRenderer.invoke('execute-sql',statement.sql,statement.binds);}catch(failure){props.onState({transactionStatus:'unknown'});throw failure;}
      props.onState(result);if(!result.success)throw new Error(result.error);applied=true;
      if(mounted.current)setReview(undefined);
      if(review.drop)props.onDropped();
      else{
        props.onChanged(review.form.name);
        if(props.constraintName===review.form.name){
          try{const next=await loadMysqlCheck(props.schema,props.table,review.form.name);if(mounted.current){setDetails(next);setForm(review.form);}}
          catch{if(mounted.current){setDetails(undefined);setError(t('mysql_check_applied_refresh_failed'));}}
        }
      }
    }catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:t('execution_failed'));}
    finally{
      if(mounted.current)setLogs(old=>[...old.slice(-99),{sql:review.sql,message:applied?t('success'):t('execution_failed')}]);
      running.current=false;props.setBusy(false);
      window.dispatchEvent(new CustomEvent('reload-statistics',{detail:{schema:props.schema,tableName:props.table}}));
      window.dispatchEvent(new CustomEvent('reload-source',{detail:{schema:props.schema,tableName:props.table}}));
      window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:props.schema,objType:'TABLE'}}));
      window.dispatchEvent(new Event('mysql-transaction-finished'));
    }
  };
  return {form,update,details,columns,locked,loading,error,load,review,prepare,attempted,execute,closeReview:()=>{if(!running.current)setReview(undefined);},logs};
}
