// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,MenuItem,Stack,TextField,Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {RequestResult,TransactionState} from '@/shared/api/desktopContract';
import {runGitOperation} from '@/features/git/gitOperation';
type Plan=Extract<RequestResult<'review-mysql-definition-import'>,{success:true}>;
type Outcome=RequestResult<'execute-mysql-definition-import'>;
interface Props {database:string;schemas:string[];blocked:boolean;setBusy:(value:boolean)=>void;onState:(value:TransactionState)=>void;onClose:()=>void;}
export default function DefinitionImportDialog(p:Props){
 const {t}=useTranslation(),[schema,setSchema]=useState(p.database),[source,setSource]=useState(''),[plan,setPlan]=useState<Plan>(),[result,setResult]=useState<Outcome>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempted,setAttempted]=useState(false),[git,setGit]=useState(false),[restored,setRestored]=useState<string[]>([]);
 const alive=useRef(false),running=useRef(false),attempt=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const locked=p.blocked||loading||attempted;
 const open=async()=>{if(locked||running.current)return;running.current=true;setLoading(true);setError('');try{const file=await ipcRenderer.invoke('open-sql-file');if(!file.success)throw new Error(file.error);if(alive.current&&!file.canceled&&file.sql!==undefined){setSource(file.sql);setPlan(undefined);}}catch(e){if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}finally{running.current=false;if(alive.current)setLoading(false);}};
 const review=async()=>{if(locked||running.current)return;running.current=true;setLoading(true);setError('');setPlan(undefined);try{const next=await ipcRenderer.invoke('review-mysql-definition-import',{schema,source});if(!next.success)throw new Error(next.error);if(alive.current)setPlan(next);}catch(e){if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}finally{running.current=false;if(alive.current)setLoading(false);}};
 const execute=async()=>{if(locked||running.current||attempt.current||!plan)return;running.current=true;attempt.current=true;setAttempted(true);setLoading(true);setError('');p.setBusy(true);let received=false;
 try{const next=await ipcRenderer.invoke('execute-mysql-definition-import',{token:plan.token});received=true;p.onState(next);if(alive.current)setResult(next);
  for(const row of next.results||[]){if(row.applied)window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:row.schema,objType:row.kind}}));if(row.success&&row.native&&git){try{const saved=await runGitOperation(t,'git-commit',{dbType:'MYSQL',schema:row.schema,objectType:row.kind,objectName:row.name,sourceText:row.native,message:`Import ${row.kind.toLowerCase()} ${row.name}`});if(!saved.success&&alive.current)setError(t('mysql_view_git_failed'));}catch{if(alive.current)setError(t('mysql_view_git_failed'));}}}
  if(!next.success&&alive.current)setError(next.error);
 }catch(e){if(!received)p.onState({transactionStatus:'unknown'});if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}
 finally{running.current=false;p.setBusy(false);if(alive.current)setLoading(false);}
 };
 const restore=async(row:NonNullable<Outcome['results']>[number])=>{if(running.current||p.blocked||!row.recovery)return;running.current=true;setLoading(true);p.setBusy(true);try{const request={schema:row.schema,name:row.name,operation:'restore' as const,source:'',recoveryToken:row.recovery.token};const next=row.kind==='TRIGGER'?await ipcRenderer.invoke('mutate-mysql-trigger',request):row.kind==='FUNCTION'?await ipcRenderer.invoke('mutate-mysql-function',request):await ipcRenderer.invoke('mutate-mysql-procedure',request);p.onState(next);if(!next.success)throw new Error(next.error);if(alive.current)setRestored(old=>[...old,row.kind+':'+row.name]);window.dispatchEvent(new CustomEvent('refresh-sidebar',{detail:{schema:row.schema,objType:row.kind}}));}catch(e){if(alive.current)setError(e instanceof Error?e.message:'execution_failed');}finally{running.current=false;p.setBusy(false);if(alive.current)setLoading(false);}};
 return <Dialog open fullWidth maxWidth="lg" data-testid="mysql-definition-import" onClose={()=>{if(!loading)p.onClose();}}><DialogTitle>{t('mysql_definition_import')}</DialogTitle><DialogContent><Stack spacing={2} sx={{pt:1}}>
 <Alert severity="warning">{t('mysql_definition_import_help')}</Alert>
 <Stack direction="row" spacing={1}><TextField select size="small" label={t('database')} value={schema} disabled={locked} onChange={e=>{setSchema(e.target.value);setPlan(undefined);}} sx={{minWidth:220}}>{[...new Set([p.database,...p.schemas])].map(name=><MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField><Button variant="outlined" disabled={locked} onClick={()=>void open()}>{t('open')}</Button></Stack>
 <TextField multiline minRows={6} maxRows={14} label={t('source')} value={source} disabled={locked} onChange={e=>{setSource(e.target.value);setPlan(undefined);}} inputProps={{spellCheck:false}}/>
 <FormControlLabel label={t('mysql_definition_import_git')} control={<Checkbox checked={git} disabled={locked} onChange={e=>setGit(e.target.checked)}/>}/>
 {plan?.items.map((row,i)=><Box component="details" key={row.kind+':'+row.name}><Typography component="summary">{i+1}. {row.kind} · {row.schema}.{row.name} · {t(row.operation==='replace'?'mysql_definition_replace':'create_new')}</Typography><Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.sql}</Typography></Box>)}
 {result?.results?.map(row=><Alert key={row.kind+':'+row.name} severity={row.success?'success':'error'}>{row.kind} · {row.schema}.{row.name} · {row.success?t('success'):row.stage+' · '+row.error}{row.recovery&&<><Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.recovery.sql}</Typography><Button disabled={p.blocked||loading||restored.includes(row.kind+':'+row.name)} onClick={()=>void restore(row)}>{t('mysql_trigger_restore')}</Button>{restored.includes(row.kind+':'+row.name)&&<Typography>{t('mysql_definition_restored')}</Typography>}</>}</Alert>)}
 {result&&<Typography>{t('mysql_definition_import_count',{done:result.results?.length||0,total:result.total||plan?.items.length||0})}</Typography>}
 {error&&<Alert severity="error">{t(error)}</Alert>}{attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
 </Stack></DialogContent><DialogActions><Button disabled={loading} onClick={p.onClose}>{t('close')}</Button><Button disabled={locked||!source.trim()} onClick={()=>void review()}>{t('mysql_database_review')}</Button><Button variant="contained" disabled={locked||!plan} onClick={()=>void execute()}>{t('execute')}</Button></DialogActions></Dialog>;
}
