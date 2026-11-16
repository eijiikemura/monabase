// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {Alert,Button,Dialog,DialogActions,DialogContent,DialogTitle,MenuItem,Stack,TextField,Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {TransactionState} from '@/shared/api/desktopContract';
import type {MysqlDatabaseDraft,MysqlDatabaseOption} from '@/shared/types/mysqlDatabaseTypes';
interface Props {initial:MysqlDatabaseDraft;blocked:boolean;setBusy:(value:boolean)=>void;onState:(value:TransactionState)=>void;onClose:()=>void;onDone:()=>void;}
export default function DatabaseEditorDialog(p:Props){
 const {t}=useTranslation(),[draft,setDraft]=useState(p.initial),[options,setOptions]=useState<MysqlDatabaseOption[]>([]),[review,setReview]=useState<{token:string;sql:string}>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[attempted,setAttempted]=useState(false);
 const alive=useRef(false),running=useRef(false),attempt=useRef(false);
 useEffect(()=>{alive.current=true;void ipcRenderer.invoke('get-mysql-database-options').then(r=>{if(!alive.current)return;if(!r.success)throw new Error(r.error);setOptions(r.options);}).catch(e=>{if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}).finally(()=>{if(alive.current)setLoading(false);});return()=>{alive.current=false;};},[]);
 const update=(values:Partial<MysqlDatabaseDraft>)=>{if(running.current||attempt.current)return;setDraft({...draft,...values});setReview(undefined);setError('');};
 const prepare=async()=>{if(p.blocked||running.current||attempt.current)return;running.current=true;setLoading(true);setError('');try{const result=await ipcRenderer.invoke('review-mysql-database',draft);if(!result.success)throw new Error(result.error);if(alive.current)setReview({token:result.token,sql:result.sql});}catch(e){if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}finally{running.current=false;if(alive.current)setLoading(false);}};
 const execute=async()=>{if(!review||p.blocked||running.current||attempt.current)return;running.current=true;attempt.current=true;setAttempted(true);setLoading(true);p.setBusy(true);setError('');let received=false;
 try{const result=await ipcRenderer.invoke('manage-mysql-database',{token:review.token});received=true;p.onState(result);if(!result.success)throw new Error(result.error);p.onDone();p.onClose();}
 catch(e){if(!received)p.onState({transactionStatus:'unknown'});if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}
 finally{running.current=false;p.setBusy(false);if(alive.current)setLoading(false);}
 };
 const locked=p.blocked||loading||attempted;
 return <Dialog open fullWidth maxWidth="md" onClose={()=>{if(!loading)p.onClose();}} data-testid="mysql-database-editor"><DialogTitle>{t(draft.action==='create'?'mysql_database_create':'mysql_database_alter')}</DialogTitle><DialogContent><Stack spacing={2} sx={{pt:1}}>
 <Alert severity="warning">{t('mysql_database_change_help')}</Alert>
 <TextField label={t('database')} size="small" value={draft.name} disabled={locked||draft.action==='alter'} onChange={e=>update({name:e.target.value})}/>
 <TextField select label={t('mysql_database_charset')} size="small" value={draft.charset} disabled={locked} onChange={e=>{const charset=e.target.value,choice=options.find(o=>o.charset===charset&&o.isDefault)||options.find(o=>o.charset===charset);update({charset,collation:choice?.collation||''});}}>{[...new Set(options.map(o=>o.charset))].map(v=><MenuItem key={v} value={v}>{v}</MenuItem>)}</TextField>
 <TextField select label={t('mysql_database_collation')} size="small" value={draft.collation} disabled={locked} onChange={e=>update({collation:e.target.value})}>{options.filter(o=>o.charset===draft.charset).map(o=><MenuItem key={o.collation} value={o.collation}>{o.collation}</MenuItem>)}</TextField>
 {review&&<Typography component="pre" sx={{whiteSpace:'pre-wrap'}}>{review.sql}</Typography>}{error&&<Alert severity="error">{t(error)}</Alert>}{attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
 </Stack></DialogContent><DialogActions><Button disabled={loading} onClick={p.onClose}>{t('close')}</Button><Button disabled={locked||!options.length||!draft.name} onClick={()=>void prepare()}>{t('mysql_database_review')}</Button><Button variant="contained" disabled={locked||!review} onClick={()=>void execute()}>{t('execute')}</Button></DialogActions></Dialog>;
}
