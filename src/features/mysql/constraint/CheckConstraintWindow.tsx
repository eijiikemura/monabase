// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useMemo,useState} from 'react';
import {Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,Divider,FormControlLabel,IconButton,Paper,Tab,Tabs,TextField,Tooltip,Typography} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeMirror from '@uiw/react-codemirror';
import {sql,MySQL} from '@codemirror/lang-sql';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import {checkStatement} from './checkModel';
import {useMysqlCheck,type MysqlCheckProps} from './useMysqlCheck';
export default function CheckConstraintWindow(props:MysqlCheckProps){
  const {t}=useTranslation(),c=useMysqlCheck(props);
  const [tab,setTab]=useState(0),[confirm,setConfirm]=useState('');
  useEffect(()=>setConfirm(''),[c.review]);
  const extensions=useMemo(()=>[sql({dialect:MySQL,schema:{[props.table]:c.columns},defaultTable:props.table})],[props.table,c.columns]);
  const source=useMemo(()=>{
    try{return checkStatement(props.schema,props.table,c.details?{name:props.constraintName||'',condition:c.details.condition,enforced:c.details.enforced}:c.form).sql+';';}catch{return '';}
  },[props.schema,props.table,props.constraintName,c.details,c.form]);
  let changeSql='';try{changeSql=checkStatement(props.schema,props.table,c.form,c.details,props.constraintName).sql+';';}catch{/* An incomplete or unchanged draft has no executable preview. */}
  const copy=async(text:string)=>{try{if(!await ipcRenderer.invoke('copy-to-clipboard',text))window.alert(t('cell_value_copy_failed'));}catch{window.alert(t('cell_value_copy_failed'));}};
  const editor=(value:string,readonly:boolean,onChange?:(value:string)=>void)=><CodeMirror value={value} height="100%" style={{height:'100%'}} extensions={extensions} readOnly={readonly} editable={!readonly} onChange={onChange} theme={props.theme==='dark'?'dark':'light'}/>;
  return <Box data-testid="mysql-check-window" sx={{flex:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
    <Box sx={{display:'flex',alignItems:'center',borderBottom:1,borderColor:'divider',bgcolor:'background.paper'}}>
      <Tabs value={tab} onChange={(_event,value:number)=>setTab(value)} sx={{flex:1}}>{['edit','source'].map(key=><Tab key={key} label={t(key)}/>)}</Tabs>
      <Tooltip title={t('refresh_to_latest_state')}><span><Button variant="outlined" size="small" startIcon={<RefreshIcon/>} sx={{mr:1}} disabled={props.busy||c.loading} onClick={()=>void c.load()}>{t('refresh')}</Button></span></Tooltip>
    </Box>
    {c.loading&&<Alert severity="info" role="status">{t('loading')}</Alert>}
    {c.error&&<Alert severity="error" action={<Button disabled={props.busy||c.loading} onClick={()=>void c.load()}>{t('retry')}</Button>}>{c.error}</Alert>}
    {tab===0?<Box sx={{flex:1,minHeight:0,overflow:'auto',p:3}}>
      <Paper sx={{p:3,maxWidth:900,mx:'auto',display:'flex',flexDirection:'column',gap:2}}>
        <Box sx={{display:'flex',gap:2,alignItems:'center',flexWrap:'wrap'}}><Typography variant="h6" sx={{flex:1}}>{props.constraintName?t('edit_check_constraint',{name:props.constraintName}):t('create_check_constraint_check')}</Typography>
          {props.constraintName&&<Tooltip title={t('delete')}><span><Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon/>} disabled={c.locked} onClick={()=>{setConfirm('');c.prepare(true);}}>{t('delete')}</Button></span></Tooltip>}
          <Tooltip title={t(props.constraintName?'change':'create')}><span><Button variant="contained" color="success" startIcon={<PlayArrowIcon/>} disabled={c.locked} onClick={()=>{setConfirm('');c.prepare();}}>{t(props.constraintName?'change':'create')}</Button></span></Tooltip>
        </Box><Divider/>
        {props.constraintName&&<Alert severity="info">{t('mysql_check_edit_help')}</Alert>}
        <Box sx={{display:'flex',gap:2,flexWrap:'wrap'}}><TextField label={t('schema')} size="small" value={props.schema} disabled/><TextField label={t('target_table')} size="small" value={props.table} disabled sx={{flex:1}}/></Box>
        <Box sx={{display:'flex',gap:2,flexWrap:'wrap',alignItems:'center'}}><TextField label={t('constraint_name_required')} required size="small" value={c.form.name} disabled={c.locked} onChange={event=>c.update({name:event.target.value})} sx={{flex:1}}/><FormControlLabel label={t('enable')} control={<Checkbox checked={c.form.enforced} disabled={c.locked} onChange={event=>c.update({enforced:event.target.checked})}/>}/></Box>
        <Typography variant="caption">{t('check_condition_e_g_salary_0_and_status_in_a_b_2')}</Typography>
        <Box data-testid="mysql-check-condition" sx={{height:250,border:1,borderColor:'divider',overflow:'hidden',borderRadius:1}}>{editor(c.form.condition,c.locked||Boolean(props.constraintName),value=>c.update({condition:value}))}</Box>
      </Paper>
      <Paper sx={{maxWidth:900,mx:'auto',mt:2,overflow:'hidden'}}><Box sx={{p:1,display:'flex',alignItems:'center',bgcolor:'action.hover'}}><Typography variant="subtitle2" sx={{flex:1}}>{t('alter_table_statement_ddl')}</Typography><Tooltip title={t('copy')}><span><IconButton aria-label={t('copy')} size="small" disabled={!changeSql} onClick={()=>void copy(changeSql)}><ContentCopyIcon fontSize="small"/></IconButton></span></Tooltip></Box><Box data-testid="mysql-check-change-sql" sx={{minHeight:70}}>{editor(changeSql,true)}</Box></Paper>
      {c.logs.length>0&&<Paper sx={{maxWidth:900,mx:'auto',mt:2,p:1}}>{c.logs.map((log,index)=><Box key={index}><Typography component="pre" variant="caption" sx={{whiteSpace:'pre-wrap'}}>{log.sql}</Typography><Typography variant="caption">{log.message}</Typography></Box>)}</Paper>}
    </Box>:<Paper square sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><Box sx={{display:'flex',alignItems:'center',p:1,bgcolor:'action.hover'}}><Typography sx={{flex:1}}>DDL</Typography><Tooltip title={t('copy')}><span><IconButton aria-label={t('copy')} size="small" disabled={!source} onClick={()=>void copy(source)}><ContentCopyIcon/></IconButton></span></Tooltip></Box><Box data-testid="mysql-check-source" sx={{flex:1,minHeight:0,overflow:'auto'}}>{editor(source,true)}</Box></Paper>}
    {c.review&&<Dialog open fullWidth maxWidth="md" onClose={()=>{if(!props.busy)c.closeReview();}}><DialogTitle>{t(c.review.drop?'delete':'preview')}</DialogTitle><DialogContent>
      <Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert>
      {c.error&&<Alert severity="error">{c.error}</Alert>}
      {!c.review.drop&&props.constraintName&&c.review.form.name!==props.constraintName&&<Alert severity="warning">{t('mysql_check_rename_help')}</Alert>}
      <Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.review.sql}</Typography>
      <TextField fullWidth size="small" label={t('mysql_check_confirm_name',{name:props.constraintName||c.review.form.name})} value={confirm} disabled={props.busy||c.attempted} onChange={event=>setConfirm(event.target.value)}/>
      {c.attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
    </DialogContent><DialogActions><Button disabled={props.busy} onClick={c.closeReview}>{t('cancel')}</Button><Button variant="contained" color={c.review.drop?'error':'primary'} disabled={c.locked||c.attempted||confirm!==(props.constraintName||c.review.form.name)} onClick={()=>void c.execute()}>{t('execute')}</Button></DialogActions></Dialog>}
  </Box>;
}
