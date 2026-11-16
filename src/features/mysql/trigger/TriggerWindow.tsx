// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestoreIcon from '@mui/icons-material/Restore';
import CodeMirror from '@uiw/react-codemirror';
import {useMysqlEditorExtensions} from '../useMysqlEditorExtensions';
import { useTranslation } from 'react-i18next';
import type { AiContext } from '@/shared/types/aiTypes';
import VersionControlTab from '@/features/git/VersionControlTab';
import AiRequestButton from '@/features/ai/AiRequestButton';
import { TriggerTargetPicker } from '@/features/trigger/TriggerTargetPicker';
import TriggerTracePanel from './TriggerTracePanel';
import VerticalSplit from '../VerticalSplit';
import { useMysqlEditorAi } from '../useMysqlEditorAi';
import { useMysqlTrigger, type MysqlTriggerProps } from './useMysqlTrigger';

export default function TriggerWindow(props:MysqlTriggerProps & {theme:string;aiEnabled:boolean;onOpenAi:(context:AiContext)=>void}){
  const {t}=useTranslation(),c=useMysqlTrigger(props);const [tab,setTab]=useState(0),[confirm,setConfirm]=useState('');
  const ai=useMysqlEditorAi({text:c.text,setText:c.setText,active:props.active&&tab===0&&!c.locked&&!c.review,schema:props.schema,tabId:props.tabId,object:props.object,onOpenAi:props.onOpenAi});
  const locked=c.locked||ai.isGenerating;
  const extensions=useMysqlEditorExtensions(null,true);
  useEffect(()=>{if(props.request){setTab(0);setConfirm('');}},[props.request]);
  const prepare=(kind:'save'|'drop'|'restore')=>{setConfirm('');c.prepare(kind);};
  return <Box data-testid="mysql-trigger-window" sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,minWidth:0,overflow:'hidden'}}>
    <Tabs value={tab} onChange={(_event,value:number)=>setTab(value)} sx={{minHeight:40,px:2,borderBottom:1,borderColor:'divider',bgcolor:'background.paper'}}>
      <Tab label={t(props.object?'edit':'new')} /><Tab label={t('source')} />{props.object&&<Tab label={t('version_control')} />}{props.object&&<Tab label={t('mysql_trace_tab')} />}
    </Tabs>
    {c.loading&&<Alert severity="info" role="status">{t('loading')}</Alert>}
    {c.error&&<Alert severity="error" action={<Button disabled={locked} onClick={()=>void c.load()}>{t('retry')}</Button>}>{c.error}</Alert>}
    {c.recovery&&<Alert severity="error" action={<Button variant="outlined" startIcon={<RestoreIcon/>} disabled={locked} onClick={()=>prepare('restore')}>{t('mysql_trigger_restore')}</Button>}>{t('mysql_trigger_missing_recover')}</Alert>}
    {c.details&&<Paper square sx={{px:2,py:1}}><Typography variant="caption">{c.details.schema}.{c.details.table} · {c.details.timing} {c.details.event} · FOR EACH ROW · {t('mysql_trigger_order')}: {c.details.order} · DEFINER: {c.details.definer}</Typography><Typography variant="caption" display="block">SQL_MODE: {c.details.mode} · {c.details.charset} / {c.details.collation}</Typography></Paper>}
    {tab===0&&<Box sx={{display:'flex',flexDirection:'column',p:1,gap:1,flex:1,minHeight:0}}>
      <VerticalSplit name="trigger" active={props.active} initialHeight={240} upper={<Paper sx={{p:2,display:'flex',flexDirection:'column',gap:2,overflow:'auto',flex:1}}>
        <Box sx={{display:'flex',gap:1,alignItems:'center',flexWrap:'wrap'}}><Typography variant="subtitle1" fontWeight="bold" sx={{mr:'auto'}}>{t(props.object?'edit':'new')} · {t('trigger_2')}</Typography>
          {props.object&&<Tooltip title={t('refresh')}><span><Button variant="outlined" size="small" startIcon={<RefreshIcon/>} disabled={locked} onClick={()=>void c.load()}>{t('refresh')}</Button></span></Tooltip>}
          {props.object&&<Tooltip title={t('delete')}><span><Button variant="outlined" size="small" color="error" startIcon={<DeleteOutlineIcon/>} disabled={locked||!c.details} onClick={()=>prepare('drop')}>{t('delete')}</Button></span></Tooltip>}
          <Tooltip title={t('compile_save')}><span><Button variant="contained" size="small" color="success" startIcon={<PlayArrowIcon/>} disabled={locked||!c.text||Boolean(props.object&&!c.details)} onClick={()=>prepare('save')}>{t('compile_save')}</Button></span></Tooltip>
          {props.aiEnabled&&<Tooltip title={t('ask_ai_to_create_or_modify_sql')}><span><AiRequestButton disabled={locked||!c.text||Boolean(props.object&&!c.details)} onClick={ai.open}/></span></Tooltip>}
        </Box>
        <Box sx={{display:'flex',gap:2,flexWrap:'wrap'}}><TextField size="small" label={t('schema')} value={c.form.schema} disabled/><TextField size="small" label={t('trigger_name')} value={c.form.name} disabled={locked||Boolean(props.object)} onChange={event=>c.update({name:event.target.value})}/><TriggerTargetPicker database="mysql" schema={c.form.schema} table={c.form.table} type="TABLE" disabled={locked||Boolean(props.object)} onChange={table=>c.update({table})}/></Box>
        <Box sx={{display:'flex',gap:2,flexWrap:'wrap'}}><TextField select size="small" label={t('timing')} value={c.form.timing} disabled={locked||Boolean(props.object&&!c.details)} onChange={event=>c.update({timing:event.target.value as typeof c.form.timing})}>{['BEFORE','AFTER'].map(value=><MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField><TextField select size="small" label={t('event')} value={c.form.event} disabled={locked||Boolean(props.object&&!c.details)} onChange={event=>c.update({event:event.target.value as typeof c.form.event})}>{['INSERT','UPDATE','DELETE'].map(value=><MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField><Typography variant="body2" sx={{alignSelf:'center'}}>FOR EACH ROW</Typography></Box>
        <Typography variant="caption" color="text.secondary">{t('mysql_trigger_native_help')}</Typography>
      </Paper>} lower={<Paper sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,overflow:'hidden'}}><Typography variant="caption" sx={{p:1,bgcolor:'action.hover'}}>{t('mysql_trigger_body')}</Typography><Box sx={{position:'relative',flex:1,minHeight:0}}><CodeMirror value={ai.isGenerating?ai.displaySql:c.form.body} onChange={body=>c.update({body})} readOnly={locked} editable={!locked} extensions={extensions} height="100%" style={{position:'absolute',inset:0}} theme={props.theme==='dark'?'dark':'light'}/></Box></Paper>}/>
      {Boolean(c.logs.length)&&<Box sx={{maxHeight:160,overflow:'auto',border:1,borderColor:'divider',p:1}}><Box sx={{display:'flex',justifyContent:'space-between'}}><Typography variant="subtitle2">{t('console')}</Typography><Button size="small" onClick={c.clearLogs}>{t('clear_log')}</Button></Box>{c.logs.map((log,i)=><Box key={i}><Typography variant="caption">{log.message}</Typography><Typography component="pre" sx={{fontSize:12,whiteSpace:'pre-wrap'}}>{log.sql}</Typography></Box>)}</Box>}
    </Box>}
    {tab===1&&<Box sx={{position:'relative',flex:1,minHeight:0}}><CodeMirror value={c.recovery?.sql||c.details?.native||c.text} readOnly extensions={extensions} height="100%" style={{position:'absolute',inset:0}} theme={props.theme==='dark'?'dark':'light'}/></Box>}
    {tab===2&&props.object&&<VersionControlTab isActive={props.active} dbType="MYSQL" schema={props.schema} objectType="TRIGGER" objectName={props.object.name} currentSource={c.details?.native||''} isSourceLoading={c.loading||!c.details} onRefresh={()=>void c.load()}/>}
    {tab===3&&c.details&&<TriggerTracePanel details={c.details} sourceText={c.form.body} active={props.active} disabled={locked||c.form.timing!==c.details.timing||c.form.event!==c.details.event||c.form.table!==c.details.table} readonly={props.readonly} theme={props.theme} aiEnabled={props.aiEnabled} onOpenAi={props.onOpenAi} setBusy={props.setBusy}/>}
    <Dialog open={Boolean(c.review)} fullWidth maxWidth="md" onClose={c.closeReview}><DialogTitle>{t(c.review?.request.operation==='restore'?'mysql_trigger_restore':c.review?.request.operation==='drop'?'delete':'compile_save')}</DialogTitle><DialogContent><Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert>{c.review?.request.operation==='replace'&&<Alert severity="warning">{t('mysql_trigger_replace_warning')}</Alert>}<Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',my:2}}>{c.review?.sql}</Typography>{['replace','drop'].includes(c.review?.request.operation||'')&&<TextField fullWidth size="small" label={t('trigger_name')} helperText={t('mysql_trigger_confirm_name')} value={confirm} disabled={props.busy||c.attempted} onChange={event=>setConfirm(event.target.value)}/>} {c.error&&<Alert severity="error">{c.error}</Alert>}{c.attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}</DialogContent><DialogActions><Button disabled={props.busy} onClick={c.closeReview}>{t('close')}</Button><Button variant="contained" disabled={locked||c.attempted||Boolean(['replace','drop'].includes(c.review?.request.operation||'')&&confirm!==c.form.name)} onClick={()=>void c.execute()}>{t('execute')}</Button></DialogActions></Dialog>
  </Box>;
}
