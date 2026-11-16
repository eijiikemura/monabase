// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useEffect,useRef,useState} from 'react';
import {Alert,Box,Button,Paper,Stack,TextField,Tooltip,Typography} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import {useTranslation} from 'react-i18next';
import {ipcRenderer} from '@/shared/api/desktop';
import type {TraceInfo} from '@/shared/api/desktopContract';
import type {AiContext} from '@/shared/types/aiTypes';
import type {AppSettings} from '@/shared/types/appTypes';
import type {MysqlProcedureInfo} from '@/shared/api/desktopContract';
import {useTraceSimulator} from '@/features/stored/useTraceSimulator';
import {TraceDebugArea} from '@/features/stored/TraceDebugArea';
import {useAiTraceDebug} from '@/features/ai/useAiTraceDebug';
import TraceFixtureEditor,{needsTraceFixtures,type TraceInputSpec} from '../TraceFixtureEditor';
import VerticalSplit from '../VerticalSplit';
import {canonicalTemporalInput} from '@/shared/utils/temporalValues';
export const escapeTraceLine=(line:string)=>line.replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]||value));
interface Props {details:MysqlProcedureInfo&{kind:'FUNCTION'|'PROCEDURE'};sourceText:string;args:Record<string,string>;setArg:(name:string,value:string)=>void;active:boolean;disabled:boolean;readonly:boolean;settings:AppSettings;aiEnabled:boolean;onOpenAi:(context:AiContext)=>void;setBusy:(value:boolean)=>void;}
export default function TracePanel(p:Props){
 const {t}=useTranslation(),sim=useTraceSimulator(),[info,setInfo]=useState<TraceInfo|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [inputsOpen,setInputsOpen]=useState(true);
 const fixturesEdited=useRef(false);
 const [fixtures,setFixtures]=useState('{}'),[fixtureSpec,setFixtureSpec]=useState<TraceInputSpec|null>(null);
 const needFixtures=needsTraceFixtures(p.details.source),fixtureReady=!needFixtures||fixtureSpec?.fingerprint===p.details.fingerprint;
 const alive=useRef(false),generation=useRef(0),running=useRef(false),target={schema:p.details.schema,objectName:p.details.name,objectType:p.details.kind};
 const loadSimulation=sim.loadSimulation,clearSimulation=sim.clearSimulation;
 const ai=useAiTraceDebug({...target,objectType:p.details.kind,dbType:'mysql',sourceText:p.sourceText,isAiEnabled:p.aiEnabled,onOpenAiSidebar:context=>{if(context)p.onOpenAi(context);}});
 useEffect(()=>{alive.current=true;setInfo(null);setError('');clearSimulation();const request=++generation.current;void ipcRenderer.invoke('get-trace-data',{schema:p.details.schema,objectName:p.details.name,objectType:p.details.kind}).then(result=>{if(!alive.current||request!==generation.current)return;if(!result.success){setError(result.error||'mysql_trace_read_failed');return;}setInfo(result.info);if(!fixturesEdited.current)setFixtures(JSON.stringify(result.info?.table_fixtures||{},null,2));loadSimulation(result.steps);}).catch(()=>{if(alive.current&&request===generation.current)setError('mysql_trace_read_failed');});return()=>{alive.current=false;};},[p.details.schema,p.details.name,p.details.kind,loadSimulation,clearSimulation]);
 const run=async()=>{if(running.current||p.disabled||p.readonly||!fixtureReady)return;running.current=true;setLoading(true);setError('');p.setBusy(true);++generation.current;
  try{const args:Record<string,string|null>={...p.args};for(const parameter of p.details.parameters){const value=p.args[parameter.name];if(value&&parameter.direction!=='OUT'&&/^(date|datetime|timestamp)\b/i.test(parameter.type)){const normalized=canonicalTemporalInput(value,p.settings.inputDateFormat||'YYYY-MM-DD HH:mm:ss');if(!normalized)throw new Error(t('mysql_procedure_date_input',{name:parameter.name}));args[parameter.name]=normalized;}}
   const result=await ipcRenderer.invoke('execute-trace',{...target,sourceText:p.sourceText,mysqlFingerprint:p.details.fingerprint,mysqlTraceFixtures:JSON.parse(fixtures),mysqlTraceTableFingerprints:fixtureSpec?Object.fromEntries(fixtureSpec.tables.map(t=>[t.name,t.fingerprint])):undefined,args,argTypes:{},argDirections:{},inputDateFormat:p.settings.inputDateFormat});if(!alive.current)return;if(!result.success)throw new Error(result.error||'mysql_trace_read_failed');setInfo(result.info||null);loadSimulation(result.steps||[]);setInputsOpen(false);}
  catch(reason){if(alive.current)setError(reason instanceof Error?reason.message:'mysql_trace_read_failed');}
  finally{running.current=false;p.setBusy(false);if(alive.current)setLoading(false);}
 };
 const blocked=p.disabled||loading,source=info?.executed_source||p.details.source;
 return <Box data-testid="mysql-trace-panel" sx={{display:'flex',flexDirection:'column',flex:1,minHeight:0,gap:1}}>
  <Stack direction="row" spacing={1} alignItems="center" sx={{flexWrap:'wrap',rowGap:1}}>
   <Tooltip title={t('mysql_trace_run_help')}><span><Button size="small" variant="contained" startIcon={<PlayArrowIcon/>} disabled={blocked||p.readonly||!fixtureReady||p.sourceText!==p.details.source} onClick={()=>void run()}>{t('mysql_trace_run')}</Button></span></Tooltip>
   <Button size="small" disabled={blocked||!sim.executionSteps.length} onClick={()=>sim.handleSimulateStep('stop')}>{t('mysql_trace_first')}</Button>
   <Button size="small" disabled={blocked||!sim.executionSteps.length} onClick={()=>sim.handleSimulateStep('step_into')}>{t('mysql_trace_next')}</Button>
   <Button size="small" disabled={blocked||!sim.executionSteps.length} onClick={()=>sim.handleSimulateStep('resume')}>{t('mysql_trace_continue')}</Button>
   <Button size="small" disabled={blocked||!info||!p.aiEnabled||ai.isPreparing} onClick={()=>void ai.requestDebug()}>{t('mysql_trace_ai')}</Button>
   <Typography variant="caption">{sim.currentStepIndex+1} / {sim.executionSteps.length}</Typography>
  </Stack>
  <details open={inputsOpen} onToggle={event=>setInputsOpen(event.currentTarget.open)} style={{flexShrink:0,maxHeight:'40%',overflow:'auto'}}><summary style={{cursor:'pointer'}}>{t('mysql_trace_inputs')}</summary>
  <Typography variant="caption">{t('mysql_trace_scope')}</Typography>
  {!!p.details.parameters.length&&<Stack direction="row" spacing={1} sx={{flexWrap:'wrap',rowGap:1}}>{p.details.parameters.filter(arg=>arg.direction!=='OUT').map(arg=><TextField key={arg.name} size="small" label={`${arg.name} (${arg.type})`} placeholder="NULL" disabled={blocked} value={p.args[arg.name]||''} onChange={e=>p.setArg(arg.name,e.target.value)}/>)}</Stack>}
  <TraceFixtureEditor schema={p.details.schema} name={p.details.name} kind={p.details.kind} fingerprint={p.details.fingerprint} text={fixtures} onText={text=>{fixturesEdited.current=true;setFixtures(text);}} onReady={setFixtureSpec} disabled={blocked}/>
  </details>
  {loading&&<Alert severity="info" role="status">{t('loading')}</Alert>}{error&&<Alert severity="error">{t(error)}</Alert>}
  {info&&<Typography variant="caption">{t('mysql_trace_recorded_at',{date:info.compile_date})}</Typography>}
  {info?.execution_status==='incomplete'&&<Alert severity="warning">{t('mysql_trace_incomplete')} {info.execution_error}</Alert>}
  <VerticalSplit name="trace" active={p.active} initialHeight={350} upper={<Paper sx={{display:'flex',flex:1,minHeight:0,overflow:'hidden'}}><TraceDebugArea sourceText={source} simulator={sim} isDarkTheme={p.settings.theme==='dark'} monaStyle={p.settings.theme==='mona'} isActiveTab={p.active} onContextMenu={event=>event.preventDefault()} highlightLine={escapeTraceLine}/></Paper>} lower={<Box sx={{overflow:'auto',p:1,flex:1}}><Typography variant="subtitle2">{t('mysql_trace_values')}</Typography>{Object.entries(sim.currentVariables).map(([name,value])=><Typography key={name} component="pre" sx={{m:0,fontSize:12,whiteSpace:'pre-wrap'}}>{name}: {value}</Typography>)}{info?.return_values?.map(value=><Typography key={value.name} variant="body2">{value.name}: {String(value.value)}</Typography>)}<Typography variant="caption">{sim.executionSteps[sim.currentStepIndex]?.loopPath} · {sim.executionSteps[sim.currentStepIndex]?.logText}</Typography></Box>}/>
 </Box>;
}
