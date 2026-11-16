// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useState} from 'react';
import {Alert,Box,Button,TextField,Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {RequestResult} from '@/shared/api/desktopContract';
import {tokenizeSql} from '@/features/sql/sqlScript';
export type TraceInputSpec=Extract<RequestResult<'get-mysql-trace-inputs'>,{success:true}>;
export function needsTraceFixtures(source:string){try{return tokenizeSql(source,'mysql').some(t=>t.kind==='word'&&['FROM','UPDATE','INSERT'].includes(t.text.toUpperCase()));}catch{return true;}}
export default function TraceFixtureEditor({schema,name,kind,fingerprint,targetTable,text,onText,onReady,disabled}:{schema:string;name:string;kind:'FUNCTION'|'PROCEDURE'|'TRIGGER';fingerprint:string;targetTable?:string;text:string;onText:(text:string)=>void;onReady:(value:TraceInputSpec|null)=>void;disabled:boolean}){
 const {t}=useTranslation(),[data,setData]=useState<TraceInputSpec>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let alive=true;onReady(null);setData(undefined);setError('');void ipcRenderer.invoke('get-mysql-trace-inputs',{schema,name,kind,fingerprint}).then(r=>{if(!alive)return;if(!r.success)throw new Error(r.error);setData(r);onReady(r);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'execution_failed');});return()=>{alive=false;};},[schema,name,kind,fingerprint,onReady,revision]);
 return <Box data-testid="mysql-trace-fixtures">{error&&<Alert severity="error" action={<Button disabled={disabled} onClick={()=>setRevision(v=>v+1)}>{t('retry')}</Button>}>{error}</Alert>}{!data&&!error&&<Typography role="status">{t('loading')}</Typography>}{data&&data.tables.length>0&&<><Button size="small" variant="outlined" disabled={disabled} onClick={()=>setRevision(v=>v+1)}>{t('mysql_trace_refresh_inputs')}</Button><Alert severity="info">{t('mysql_trace_fixture_scope')}</Alert><Box sx={{maxHeight:140,overflow:'auto'}}>{data.tables.map(table=><Box component="details" key={table.name}><Typography component="summary" variant="caption">{table.name} ({table.columns.length})</Typography><Typography variant="caption">{table.columns.map(c=>c.name+' '+c.type+(c.required?' ('+t('mysql_trace_fixture_required')+')':'')+(c.generated?' ('+t('mysql_trace_fixture_generated')+')':'')+(!c.supported?' ('+t('mysql_trace_fixture_unsupported')+')':'')).join(' · ')}</Typography></Box>)}</Box>{data.tables.some(table=>table.name!==targetTable)&&<TextField fullWidth multiline minRows={2} maxRows={8} size="small" label={t('mysql_trace_fixture_json')} helperText={t('mysql_trace_fixture_help')} value={text} disabled={disabled} onChange={e=>onText(e.target.value)}/>}</>}</Box>;
}
