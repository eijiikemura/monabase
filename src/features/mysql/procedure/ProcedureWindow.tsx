// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useMemo,useRef,useState} from 'react';
import {Alert,Box,Button,Dialog,DialogActions,DialogContent,DialogTitle,IconButton,MenuItem,Paper,Tab,Tabs,TextField,Tooltip,Typography} from '@mui/material';
import {DataGrid,enUS,jaJP} from '@mui/x-data-grid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CodeMirror from '@uiw/react-codemirror';
import {useMysqlEditorExtensions} from '../useMysqlEditorExtensions';
import {useTranslation} from 'react-i18next';
import type {AiContext} from '@/shared/types/aiTypes';
import type {AppSettings} from '@/shared/types/appTypes';
import VersionControlTab from '@/features/git/VersionControlTab';
import AiRequestButton from '@/features/ai/AiRequestButton';
import {GridViewport} from '@/features/data-grid/GridViewport';
import {getRowIdentity,withRowIdentity} from '@/features/data-grid/rowIdentity';
import {getFormattedValue,buildGridColumns} from '@/features/data-grid/dataGridHelper';
import WorkspaceDivider from '@/components/navigation/WorkspaceDivider';
import VerticalSplit from '../VerticalSplit';
import RoutineDependencyPanel from './RoutineDependencyPanel';
import TracePanel from './TracePanel';
import {useMysqlEditorAi} from '../useMysqlEditorAi';
import {useMysqlProcedure,type MysqlProcedureProps} from './useMysqlProcedure';

export default function ProcedureWindow(props:MysqlProcedureProps&{settings:AppSettings;aiEnabled:boolean;onOpenAi:(context:AiContext)=>void}){
 const extensions=useMysqlEditorExtensions(null,true);
  const {t,i18n}=useTranslation(),c=useMysqlProcedure({...props,inputDateFormat:props.settings.inputDateFormat});
  const kind=props.kind||'PROCEDURE',isFunction=kind==='FUNCTION',newName=isFunction?'new_function':'new_procedure';
  const message=(key:string,values?:Record<string,string|number>)=>t(isFunction?key.replace('mysql_procedure_','mysql_function_'):key,values);
  const [tab,setTab]=useState(0),[bottom,setBottom]=useState(0),[resultIndex,setResultIndex]=useState(0),[confirm,setConfirm]=useState(''),[right,setRight]=useState(true),[width,setWidth]=useState(300),[drag,setDrag]=useState(false);
  const content=useRef<HTMLDivElement>(null);
  const target=useMemo(()=>props.object||{key:'mysql-new-procedure-'+props.tabId,dbType:'mysql' as const,schema:props.schema,name:c.name||newName,category:kind,displayName:c.name||newName},[props.object,props.tabId,props.schema,c.name,kind,newName]);
  const ai=useMysqlEditorAi({text:c.text,setText:c.setText,active:props.active&&tab===0&&!c.locked&&!c.review,schema:props.schema,tabId:props.tabId,object:target,isNew:!props.object,onOpenAi:props.onOpenAi});
  const locked=c.locked||ai.isGenerating;
  const refreshBlocked=props.busy||props.disabled||c.loading||ai.isGenerating;
  useEffect(()=>{if(props.request){setTab(0);setConfirm('');}},[props.request]);
  useEffect(()=>{if(!drag)return;const move=(event:MouseEvent)=>{const bounds=content.current?.getBoundingClientRect();if(bounds)setWidth(Math.max(200,Math.min(bounds.width*0.6,bounds.right-event.clientX)));};const up=()=>setDrag(false);window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);return()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};},[drag]);
  const result=c.output?.resultSets?.[resultIndex];
  const columns=useMemo(()=>buildGridColumns((result?.metaData||[]).map(field=>({...field,dbTypeName:({LONG:'INTEGER',INT24:'INTEGER',SHORT:'SMALLINT',TINY:'SMALLINT'} as Record<string,string>)[field.dbTypeName||'']||field.dbTypeName})),props.settings.outputDateFormat,{}, {preserveDetails:false}),[result,props.settings.outputDateFormat]);
  const rows=useMemo(()=>result?.rows.map((row,index)=>withRowIdentity(row,index))||[],[result]);
  const prepare=(kind:'save'|'drop'|'restore')=>{setConfirm('');c.prepare(kind);};
  const run=async()=>{setBottom(0);setResultIndex(0);await c.call();};
  return <Box data-testid={isFunction?'mysql-function-window':'mysql-procedure-window'} sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,minWidth:0,p:1,gap:1,overflow:'hidden'}}>
    <Tabs value={tab} onChange={(_event,value:number)=>setTab(value)} sx={{minHeight:36,borderBottom:1,borderColor:'divider',bgcolor:'background.paper'}}><Tab label={t('source')}/>{props.object&&<Tab label={t('version_control')}/>}<Tab value={2} label={t('routine_information')}/>{props.object&&<Tab value={3} label={t('mysql_trace_tab')}/>}</Tabs>
    {c.loading&&<Alert severity="info" role="status">{t('loading')}</Alert>}{c.error&&<Alert severity="error">{c.error}</Alert>}
    {c.recovery&&<Alert severity="error" action={<Button variant="outlined" disabled={locked} onClick={()=>prepare('restore')}>{message('mysql_procedure_restore')}</Button>}>{message('mysql_procedure_recovery_help')}</Alert>}
    {tab===0&&<VerticalSplit name={isFunction?'function':'procedure'} active={props.active} initialHeight={420} upper={<Box ref={content} sx={{display:'flex',flex:1,minHeight:0,minWidth:0}}>
      <Paper sx={{display:'flex',flexDirection:'column',flex:1,minWidth:0,overflow:'hidden'}}>
        <Box sx={{p:0.5,display:'flex',gap:1,alignItems:'center',flexWrap:'wrap',bgcolor:'action.hover'}}>
          {props.object&&<Tooltip title={t('execute_target')}><span><Button variant="contained" color="success" size="small" startIcon={<PlayArrowIcon/>} disabled={locked||!c.details||Boolean(c.review)} onClick={()=>void run()}>{t('execute')}</Button></span></Tooltip>}
          {!props.object&&<TextField size="small" label={t(isFunction?'function_name':'procedure_name')} value={c.name} disabled={locked} onChange={event=>c.updateName(event.target.value)}/>}
          <Box sx={{flex:1}}/>
          {props.object&&<Tooltip title={t('refresh')}><span><Button variant="outlined" size="small" startIcon={<RefreshIcon/>} disabled={refreshBlocked} onClick={()=>void c.load()}>{t('refresh')}</Button></span></Tooltip>}
          {props.object&&<Tooltip title={t('delete')}><span><Button variant="outlined" size="small" color="error" startIcon={<DeleteOutlineIcon/>} disabled={locked||!c.details} onClick={()=>prepare('drop')}>{t('delete')}</Button></span></Tooltip>}
          <Tooltip title={t('compile_source_code')}><span><Button variant="outlined" size="small" disabled={locked||!c.name||Boolean(props.object&&!c.details)} onClick={()=>prepare('save')}>{t('compile')}</Button></span></Tooltip>
          {props.aiEnabled&&<Tooltip title={t('ask_ai_to_create_or_modify_source_code')}><span><AiRequestButton disabled={locked||!c.name||Boolean(props.object&&!c.details)} onClick={ai.open}/></span></Tooltip>}
          {props.object&&!right&&<Tooltip title={t('open_right_panel')}><IconButton size="small" aria-label={t('open_right_panel')} onClick={()=>setRight(true)}><ChevronLeftIcon/></IconButton></Tooltip>}
        </Box>
        <Box sx={{position:'relative',flex:1,minHeight:0}}><CodeMirror value={ai.isGenerating?ai.displaySql:c.text} onChange={c.setText} readOnly={locked} editable={!locked} extensions={extensions} height="100%" style={{position:'absolute',inset:0}} theme={props.settings.theme==='dark'?'dark':'light'}/></Box>
      </Paper>
      {props.object&&right&&<><WorkspaceDivider label={t('resize_panels')} value={width} min={200} max={600} reverse onChange={setWidth} onMouseDown={event=>{event.preventDefault();setDrag(true);}}/><Paper sx={{width,maxWidth:'60%',flexShrink:0,overflow:'auto',p:1}}>
        <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><Typography variant="subtitle2">{t('arguments')}</Typography><IconButton size="small" aria-label={t('close')} onClick={()=>setRight(false)}><ChevronRightIcon/></IconButton></Box>
        <Typography variant="caption" color="text.secondary">{message('mysql_procedure_arguments_help')}</Typography>
        {c.details?.parameters.map(parameter=><TextField key={parameter.name} fullWidth size="small" sx={{my:1}} label={`${parameter.name} (${parameter.direction} ${parameter.type})`} inputProps={{'data-mysql-argument':parameter.name}} placeholder="NULL" value={parameter.direction==='OUT'?'':c.args[parameter.name]||''} disabled={locked||parameter.direction==='OUT'} onChange={event=>{const value=event.target.value;c.setArgs(previous=>({...previous,[parameter.name]:value}));}}/>)}
        {c.details?.parameters.length===0&&<Typography variant="body2">{t('no_arguments')}</Typography>}
      </Paper></>}
    </Box>} lower={<Paper sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,overflow:'hidden'}}>
      <Tabs value={bottom} onChange={(_event,value:number)=>setBottom(value)} sx={{minHeight:36}}><Tab label={message('mysql_procedure_results')}/><Tab label={t('console')}/></Tabs>
      {bottom===1?<Box sx={{p:1,overflow:'auto'}}><Button size="small" onClick={c.clearLogs}>{t('clear_log')}</Button>{c.logs.map((log,index)=><Typography key={index} component="pre" sx={{whiteSpace:'pre-wrap',fontSize:12}}>{log}</Typography>)}</Box>:<Box sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,p:1,gap:1}}>
        {c.output?.returnValues?.map(value=><Typography key={value.name} variant="body2" data-mysql-output={value.name}>{value.name}: {value.value===null?'NULL':getFormattedValue(value.value,{name:value.name,dbTypeName:(isFunction&&value.name==='RETURN_VALUE'?c.details?.returnType:c.details?.parameters.find(p=>p.name===value.name)?.type)?.replace(/^datetime/i,'TIMESTAMP')},props.settings.outputDateFormat,{preserveDetails:false})}</Typography>)}
        {Boolean(c.output?.resultSets?.length)&&<TextField select size="small" label={message('mysql_procedure_results')} value={resultIndex} onChange={event=>setResultIndex(Number(event.target.value))}>{c.output!.resultSets!.map((_item,index)=><MenuItem key={index} value={index}>{message('mysql_procedure_result_number',{number:index+1})}</MenuItem>)}</TextField>}
        {result?<GridViewport active={props.active}><DataGrid rows={rows} columns={columns} getRowId={getRowIdentity} density="compact" localeText={(i18n.resolvedLanguage||i18n.language).startsWith('ja')?jaJP.components.MuiDataGrid.defaultProps.localeText:enUS.components.MuiDataGrid.defaultProps.localeText} disableRowSelectionOnClick pageSizeOptions={[100]} initialState={{pagination:{paginationModel:{pageSize:100}}}}/></GridViewport>:<Typography variant="body2">{c.output?t('success'):message('mysql_procedure_execute_help')}</Typography>}
      </Box>}
    </Paper>}/>}
    {tab===1&&props.object&&<VersionControlTab isActive={props.active} dbType="MYSQL" schema={props.schema} objectType={kind} objectName={props.object.name} currentSource={c.details?.native||''} isSourceLoading={c.loading||!c.details} onRefresh={()=>void c.load()}/>}
    {tab===2&&<Paper sx={{p:2,overflow:'auto',flex:1}}><Button variant="outlined" size="small" startIcon={<RefreshIcon/>} disabled={refreshBlocked||!props.object} onClick={()=>void c.load()}>{t('refresh')}</Button>{c.details&&<><Box component="table" sx={{width:'100%','& td,& th':{textAlign:'left',p:1,borderBottom:1,borderColor:'divider'}}}><tbody>{Object.entries({Schema:c.details.schema,[isFunction?'Function':'Procedure']:c.details.name,...(isFunction?{RETURNS:c.details.returnType}:{}),Definer:c.details.definer,'SQL SECURITY':c.details.security,'SQL DATA ACCESS':c.details.dataAccess,Deterministic:String(c.details.deterministic),Comment:c.details.comment,Created:c.details.created,Altered:c.details.altered,SQL_MODE:c.details.mode,Charset:c.details.charset,Collation:c.details.collation}).map(([key,value])=><tr key={key}><th>{key}</th><td>{value}</td></tr>)}</tbody></Box><RoutineDependencyPanel schema={c.details.schema} name={c.details.name} kind={kind} fingerprint={c.details.fingerprint}/><Typography component="pre" sx={{whiteSpace:'pre-wrap'}}>{c.details.native}</Typography></>}</Paper>}
    {tab===3&&c.details&&<TracePanel details={{...c.details,kind}} sourceText={c.text} args={c.args} setArg={(name,value)=>c.setArgs(old=>({...old,[name]:value}))} active={props.active} disabled={props.busy||props.disabled||c.loading} readonly={props.readonly} settings={props.settings} aiEnabled={props.aiEnabled} onOpenAi={props.onOpenAi} setBusy={props.setBusy}/>}
    <Dialog open={Boolean(c.review)} fullWidth maxWidth="md" onClose={c.closeReview}><DialogTitle>{message(c.review?.request.operation==='drop'?'delete':c.review?.request.operation==='restore'?'mysql_procedure_restore':'compile')}</DialogTitle><DialogContent><Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert>{c.review?.request.operation==='replace'&&<Alert severity="warning">{message('mysql_procedure_replace_warning')}</Alert>}<Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',my:2}}>{c.review?.sql}</Typography>{['replace','drop'].includes(c.review?.request.operation||'')&&<TextField fullWidth size="small" label={t(isFunction?'function_name':'procedure_name')} helperText={message('mysql_procedure_confirm_name')} value={confirm} disabled={props.busy||c.attempted} onChange={event=>setConfirm(event.target.value)}/>} {c.error&&<Alert severity="error">{c.error}</Alert>}{c.attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}</DialogContent><DialogActions><Button disabled={props.busy} onClick={c.closeReview}>{t('close')}</Button><Button variant="contained" disabled={locked||c.attempted||Boolean(['replace','drop'].includes(c.review?.request.operation||'')&&confirm!==c.name)} onClick={()=>void c.execute()}>{t('execute')}</Button></DialogActions></Dialog>
  </Box>;
}
