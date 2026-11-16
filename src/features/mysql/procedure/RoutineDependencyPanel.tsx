// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useState} from 'react';
import {Alert,Box,Button,Chip,Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {RequestResult} from '@/shared/api/desktopContract';
type Data=Extract<RequestResult<'get-mysql-routine-dependencies'>,{success:true}>;
export default function RoutineDependencyPanel({schema,name,kind,fingerprint}:{schema:string;name:string;kind:'PROCEDURE'|'FUNCTION';fingerprint:string}){
 const {t}=useTranslation(),[data,setData]=useState<Data>(),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{let alive=true;setData(undefined);setError('');void ipcRenderer.invoke('get-mysql-routine-dependencies',{schema,name,kind,fingerprint}).then(r=>{if(!alive)return;if(!r.success)throw new Error(r.error);setData(r);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'execution_failed');});return()=>{alive=false;};},[schema,name,kind,fingerprint,revision]);
 return <Box data-testid="mysql-routine-dependencies" sx={{my:2}}><Typography variant="caption">{t('mysql_dependency_scope')}</Typography>{error&&<Alert severity="error" action={<Button onClick={()=>setRevision(v=>v+1)}>{t('retry')}</Button>}>{error}</Alert>}{!data&&!error&&<Typography role="status">{t('loading')}</Typography>}{data&&<>{(data.limited||data.unreadable>0)&&<Alert severity="warning">{t('mysql_dependency_partial',{count:data.unreadable})}</Alert>}{(['references','dependents'] as const).map(direction=><Box key={direction} sx={{mt:1}}><Typography variant="subtitle2">{t(direction==='references'?'view_references':'view_dependents')}</Typography>{!data[direction].length&&<Typography variant="caption">{t('mysql_dependency_none')}</Typography>}{data[direction].map(row=><Box key={JSON.stringify([row.schema,row.type,row.name])} sx={{display:'flex',gap:1,alignItems:'center'}}><Button size="small" onClick={()=>window.dispatchEvent(new CustomEvent('mysql-open-object',{detail:row}))}>{row.schema}.{row.name} ({row.type})</Button><Chip size="small" label={t(row.evidence==='catalog'?'mysql_dependency_catalog':'mysql_dependency_candidate')}/></Box>)}</Box>)}</>}</Box>;
}
