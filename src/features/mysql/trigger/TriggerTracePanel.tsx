// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Paper,Stack,TextField,Tooltip,Typography} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {TraceInfo} from '@/shared/api/desktopContract';
import type {AiContext} from '@/shared/types/aiTypes';
import {useTraceSimulator} from '@/features/stored/useTraceSimulator';
import {TraceDebugArea} from '@/features/stored/TraceDebugArea';
import {useAiTraceDebug} from '@/features/ai/useAiTraceDebug';
import TraceFixtureEditor,{needsTraceFixtures,type TraceInputSpec} from '../TraceFixtureEditor';
import VerticalSplit from '../VerticalSplit';
import {escapeTraceLine} from '../procedure/TracePanel';
interface Props {details:import('@/shared/api/desktopContract').MysqlTriggerInfo;sourceText:string;active:boolean;disabled:boolean;readonly:boolean;theme:string;aiEnabled:boolean;onOpenAi:(context:AiContext)=>void;setBusy:(value:boolean)=>void;}
type Inputs=Extract<Awaited<ReturnType<typeof readInputs>>,{success:true}>;
const readInputs=(schema:string,name:string)=>ipcRenderer.invoke('get-mysql-trigger-trace-inputs',{schema,name});
export default function TriggerTracePanel(p:Props){
 const {t}=useTranslation(),sim=useTraceSimulator(),[info,setInfo]=useState<TraceInfo|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[inputs,setInputs]=useState<Inputs|null>(null),[oldRow,setOldRow]=useState('{}'),[newRow,setNewRow]=useState('{}');
 const [inputsOpen,setInputsOpen]=useState(true);
 const fixturesEdited=useRef(false);
 const [fixtures,setFixtures]=useState('{}'),[fixtureSpec,setFixtureSpec]=useState<TraceInputSpec|null>(null);
 const needFixtures=needsTraceFixtures(p.details.body),fixtureReady=!needFixtures||fixtureSpec?.fingerprint===p.details.fingerprint;
 const alive=useRef(false),generation=useRef(0),running=useRef(false),target={schema:p.details.schema,objectName:p.details.name,objectType:'TRIGGER'};
 const loadSimulation=sim.loadSimulation,clearSimulation=sim.clearSimulation;
 const ai=useAiTraceDebug({...target,objectType:'TRIGGER',dbType:'mysql',sourceText:p.sourceText,isAiEnabled:p.aiEnabled,onOpenAiSidebar:context=>{if(context)p.onOpenAi(context);}});
 useEffect(()=>{alive.current=true;setInfo(null);setInputs(null);setError('');clearSimulation();const request=++generation.current;
 void Promise.all([readInputs(p.details.schema,p.details.name),ipcRenderer.invoke('get-trace-data',{schema:p.details.schema,objectName:p.details.name,objectType:'TRIGGER'})]).then(([spec,result])=>{if(!alive.current||request!==generation.current)return;if(!spec.success)throw new Error(spec.error);if(!result.success)throw new Error(result.error);setInputs(spec);setInfo(result.info);if(!fixturesEdited.current)setFixtures(JSON.stringify(result.info?.table_fixtures||{},null,2));loadSimulation(result.steps);}).catch(reason=>{if(alive.current&&request===generation.current)setError(reason instanceof Error?reason.message:'mysql_trace_read_failed');});return()=>{alive.current=false;};
 // Reload inputs when the saved definition changes, never overwrite user-entered rows.
 },[p.details,loadSimulation,clearSimulation]);
 const run=async()=>{if(running.current||p.disabled||p.readonly||!inputs||!fixtureReady)return;running.current=true;setLoading(true);setError('');p.setBusy(true);const request=++generation.current;
 try{const result=await ipcRenderer.invoke('execute-trace',{...target,sourceText:p.sourceText,mysqlFingerprint:inputs.trigger.fingerprint,mysqlTraceFixtures:JSON.parse(fixtures),mysqlTraceTableFingerprints:fixtureSpec?Object.fromEntries(fixtureSpec.tables.map(t=>[t.name,t.fingerprint])):undefined,mysqlTableFingerprint:inputs.tableFingerprint,triggerInput:{oldRow:JSON.parse(oldRow),newRow:JSON.parse(newRow)},args:{},argTypes:{},argDirections:{},inputDateFormat:'YYYY-MM-DD HH:mm:ss'});if(!alive.current||request!==generation.current)return;if(!result.success)throw new Error(result.error||'mysql_trace_read_failed');setInfo(result.info||null);loadSimulation(result.steps||[]);setInputsOpen(false);}
 catch(reason){if(alive.current&&request===generation.current)setError(reason instanceof Error?reason.message:'mysql_trace_read_failed');}
 finally{running.current=false;p.setBusy(false);if(alive.current)setLoading(false);}
 };
 const blocked=p.disabled||loading,source=info?.executed_source||p.details.body;
 return <Box data-testid="mysql-trigger-trace-panel" sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,gap:1}}>
  <Stack direction="row" spacing={1} alignItems="center" sx={{flexWrap:'wrap',rowGap:1}}>
   <Tooltip title={t('mysql_trace_run_help')}><span><Button size="small" variant="contained" startIcon={<PlayArrowIcon/>} disabled={blocked||p.readonly||!fixtureReady||!inputs||p.sourceText!==p.details.body} onClick={()=>void run()}>{t('mysql_trace_run')}</Button></span></Tooltip>
   <Button size="small" disabled={blocked||!sim.executionSteps.length} onClick={()=>sim.handleSimulateStep('stop')}>{t('mysql_trace_first')}</Button>
   <Button size="small" disabled={blocked||!sim.executionSteps.length} onClick={()=>sim.handleSimulateStep('step_into')}>{t('mysql_trace_next')}</Button>
   <Button size="small" disabled={blocked||!sim.executionSteps.length} onClick={()=>sim.handleSimulateStep('resume')}>{t('mysql_trace_continue')}</Button>
   <Button size="small" disabled={blocked||!info||!p.aiEnabled||ai.isPreparing} onClick={()=>void ai.requestDebug()}>{t('mysql_trace_ai')}</Button>
   <Typography variant="caption">{sim.currentStepIndex+1} / {sim.executionSteps.length}</Typography>
  </Stack>
  <details open={inputsOpen} onToggle={event=>setInputsOpen(event.currentTarget.open)} style={{flexShrink:0,maxHeight:'40%',overflow:'auto'}}><summary style={{cursor:'pointer'}}>{t('mysql_trace_inputs')}</summary>
  <Typography variant="caption">{t('mysql_trigger_trace_scope')}</Typography>
  <Typography variant="caption">{inputs?.columns.map(c=>`${c.name}: ${c.type}${c.generated?' (generated)':c.nullable?' (NULL)':''}`).join(' · ')}</Typography>
  <Stack direction="row" spacing={1}>
   {p.details.event!=='INSERT'&&<TextField fullWidth multiline minRows={2} size="small" label={t('mysql_trigger_trace_old')} helperText={t('mysql_trigger_trace_json')} disabled={blocked} value={oldRow} onChange={e=>setOldRow(e.target.value)}/>}
   {p.details.event!=='DELETE'&&<TextField fullWidth multiline minRows={2} size="small" label={t('mysql_trigger_trace_new')} helperText={t('mysql_trigger_trace_json')} disabled={blocked} value={newRow} onChange={e=>setNewRow(e.target.value)}/>}
  </Stack>
  <TraceFixtureEditor schema={p.details.schema} name={p.details.name} kind="TRIGGER" fingerprint={p.details.fingerprint} targetTable={p.details.table} text={fixtures} onText={text=>{fixturesEdited.current=true;setFixtures(text);}} onReady={setFixtureSpec} disabled={blocked}/>
  </details>
  {loading&&<Alert severity="info" role="status">{t('loading')}</Alert>}{error&&<Alert severity="error">{t(error)}</Alert>}
  {info&&<Typography variant="caption">{t('mysql_trace_recorded_at',{date:info.compile_date})}</Typography>}
  {info?.execution_status==='incomplete'&&<Alert severity="warning">{t('mysql_trace_incomplete')} {info.execution_error}</Alert>}
  <VerticalSplit name="trigger-trace" active={p.active} initialHeight={350} upper={<Paper sx={{display:'flex',flex:1,minHeight:0,overflow:'hidden'}}><TraceDebugArea sourceText={source} simulator={sim} isDarkTheme={p.theme==='dark'} monaStyle={p.theme==='mona'} isActiveTab={p.active} onContextMenu={event=>event.preventDefault()} highlightLine={escapeTraceLine}/></Paper>} lower={<Box sx={{overflow:'auto',p:1,flex:1}}><Typography variant="subtitle2">{t('mysql_trace_values')}</Typography>{Object.entries(sim.currentVariables).map(([name,value])=><Typography key={name} component="pre" sx={{m:0,fontSize:12,whiteSpace:'pre-wrap'}}>{name}: {value}</Typography>)}{info?.trigger_outcome&&<Typography component="pre" sx={{fontSize:12,whiteSpace:'pre-wrap'}}>{JSON.stringify(info.trigger_outcome,null,2)}</Typography>}{info?.return_values?.map(value=><Typography key={value.name} variant="body2">{value.name}: {String(value.value)}</Typography>)}<Typography variant="caption">{sim.executionSteps[sim.currentStepIndex]?.loopPath} · {sim.executionSteps[sim.currentStepIndex]?.logText}</Typography></Box>}/>
 </Box>;
}
