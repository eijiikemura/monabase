// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useMemo,useState} from 'react';
import {Alert,Box,Button,Checkbox,Dialog,DialogActions,DialogContent,DialogTitle,FormControlLabel,MenuItem,Paper,Stack,TextField,Tooltip,Typography} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import {DataGrid,enUS,jaJP,type GridColDef} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import {GridViewport} from '@/features/data-grid/GridViewport';
import type {MysqlAccount} from '@/shared/types/mysqlUserRoleTypes';
import type {MysqlUserRoleProps} from './useUserRoleTab';
import {useObjectPrivilegeTab} from './useObjectPrivilegeTab';
const categories=['TABLE','VIEW','PROCEDURE','FUNCTION'] as const;
const key=(account:MysqlAccount)=>JSON.stringify([account.user,account.host]);
interface PrincipalRow extends MysqlAccount {id:string;kind:'account'|'role'|'unknown';protected:boolean;self:boolean;}
export default function ObjectPrivilegeTab(props:MysqlUserRoleProps&{database:string}){
 const {t,i18n}=useTranslation(),s=useObjectPrivilegeTab(props),d=s.detail;
 const [picker,setPicker]=useState(false),[search,setSearch]=useState(''),[mode,setMode]=useState('granted'),[includeProtected,setIncludeProtected]=useState(false),[selected,setSelected]=useState('');
 const rows=useMemo(()=>{
  const map=new Map<string,PrincipalRow>((d?.principals||[]).map(p=>[key(p),{id:key(p),user:p.user,host:p.host,kind:p.referencedRole?'role':'account',protected:p.protected,self:p.self}]));
  for(const grant of [...d?.grants||[],...d?.columnGrants||[]])if(!map.has(key(grant.account)))map.set(key(grant.account),{...grant.account,id:key(grant.account),kind:'unknown',protected:true,self:false});
  return [...map.values()].filter(p=>{const granted=[...d?.grants||[],...d?.columnGrants||[]].some(g=>key(g.account)===p.id);return (mode==='all'||granted)&&(includeProtected||!p.protected||granted||p.self)&&`${p.user}@${p.host}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());}).sort((a,b)=>(a.user+'@'+a.host).localeCompare(b.user+'@'+b.host));
 },[d,mode,includeProtected,search]);
 const columns:GridColDef<PrincipalRow>[]=[{field:'user',headerName:t('object_priv_recipient'),minWidth:210,flex:1,renderCell:p=>p.row.user+'@'+p.row.host},{field:'kind',headerName:t('object_type'),width:130,valueFormatter:p=>t(p.value==='role'?'object_priv_kind_role':p.value==='unknown'?'object_priv_kind_unknown':'mysql_obj_account')},...(d?.privileges||[]).map(privilege=>({field:privilege,headerName:privilege,width:110,sortable:false,filterable:false,renderCell:({row}:{row:PrincipalRow})=>{
  const matching=d?.grants.filter(g=>key(g.account)===row.id&&g.privilege===privilege)||[],columnOnly=d?.columnGrants.some(g=>key(g.account)===row.id&&g.privilege===privilege)||false;
  return <Tooltip title={t(columnOnly?'mysql_obj_columns_help':matching.some(g=>g.grantable)?'mysql_obj_grant_option_help':row.protected?'mysql_user_protected_help':'mysql_obj_cell_help')}><span><Checkbox size="small" checked={matching.length>0} indeterminate={columnOnly} disabled={!s.editable(row,privilege)} inputProps={{'aria-label':`${row.user}@${row.host} ${privilege}`}} onClick={event=>event.stopPropagation()} onChange={event=>void s.change(row,privilege,event.target.checked)}/></span></Tooltip>;
 } }))];
 const error=(message:string)=><>{t(message.split(' (')[0])}{message.includes(' (')?' ('+message.split(' (')[1]:''}</>;
 return <Box data-testid="mysql-object-privilege-tab" sx={{flex:1,minWidth:0,minHeight:0,display:'flex',flexDirection:'column',p:1,gap:1,overflow:'hidden'}}>
  <Paper sx={{p:1}}><Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
   <Button startIcon={<SearchIcon/>} variant="outlined" disabled={props.busy||s.loading} onClick={()=>setPicker(true)}>{t('target_object_2')}</Button>
   <Typography variant="body2">{s.target?`${s.target.schema}.${s.target.name} (${s.target.type})`:t('please_select_a_target_object')}</Typography>
   <Tooltip title={t('refresh_to_latest_state')}><span><Button variant="outlined" size="small" startIcon={<RefreshIcon/>} disabled={props.busy||s.loading||!s.target} onClick={()=>void s.reload()}>{t('refresh')}</Button></span></Tooltip>
   <TextField size="small" label={t('object_priv_search')} value={search} onChange={event=>{setSearch(event.target.value);setSelected('');}}/>
   <TextField select size="small" label={t('target_to_display')} value={mode} onChange={event=>{setMode(event.target.value);setSelected('');}}><MenuItem value="granted">{t('object_priv_granted_only')}</MenuItem><MenuItem value="all">{t('object_priv_all_recipients')}</MenuItem></TextField>
   <FormControlLabel label={t('mysql_user_include_protected')} control={<Checkbox checked={includeProtected} onChange={event=>{setIncludeProtected(event.target.checked);setSelected('');}}/>}/>
   <Typography variant="caption">{t('object_priv_count',{count:rows.length})}</Typography>
  </Stack></Paper>
  {s.error&&<Alert severity="error" action={<Button disabled={props.busy||s.loading} onClick={()=>void s.reload()}>{t('retry')}</Button>}>{error(s.error)}</Alert>}
  {s.applied&&<Alert severity={s.error?'warning':'success'}>{t(s.error?'mysql_obj_applied_unconfirmed':'object_priv_applied')}</Alert>}
  {d?.scope==='visible'&&<Alert severity="info">{t('mysql_obj_limited')}</Alert>}
  {(props.readonly||d?.readonly)&&<Alert severity="info">{t('object_priv_readonly')}</Alert>}
  <Typography variant="caption">{t('mysql_obj_direct_help')}</Typography>
  <Paper sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><GridViewport active={props.active}><DataGrid rows={rows} columns={columns} density="compact" loading={s.loading} rowSelectionModel={rows.some(row=>row.id===selected)?[selected]:[]} onRowSelectionModelChange={ids=>setSelected(String(ids[0]||''))} initialState={{pagination:{paginationModel:{pageSize:100}}}} pageSizeOptions={[25,50,100]} localeText={{...(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText,noRowsLabel:t(d?.complete?'object_priv_no_grants':'object_priv_unconfirmed')}}/></GridViewport></Paper>
  {d&&selected&&rows.some(row=>row.id===selected)&&<Paper sx={{p:1,maxHeight:'30%',overflow:'auto',flexShrink:0}}><Typography variant="subtitle2">{rows.find(row=>row.id===selected)?.user}@{rows.find(row=>row.id===selected)?.host}</Typography>
   {d.grants.filter(g=>key(g.account)===selected).map((g,index)=><Typography key={index} variant="body2">{g.privilege} · GRANT OPTION: {t(g.grantable?'yes':'no')} · {t('object_priv_grantor')}: {g.grantor||'—'}</Typography>)}
   {d.columnGrants.filter(g=>key(g.account)===selected).map((g,index)=><Typography key={index} variant="body2">{g.privilege} ({g.column}) · GRANT OPTION: {t(g.grantable?'yes':'no')}</Typography>)}
   <Typography variant="caption">{t('mysql_obj_grantor_help')}</Typography>
  </Paper>}
  <ObjectPickerDialog open={picker} title={t('target_object_2')} dbType="mysql" initialSchema={s.target?.schema||props.database} initialCategory={s.target?.type||'TABLE'} categories={categories} multiple={false} disabled={props.busy||s.loading} onClose={()=>setPicker(false)} onConfirm={objects=>{const object=objects[0],type=categories.find(type=>type===object?.category);if(object&&type){s.select({schema:object.schema,name:object.name,type});setSelected('');}setPicker(false);}}/>
  {props.active&&s.review&&<Dialog open fullWidth maxWidth="md" onClose={s.close}><DialogTitle>{t('preview')}</DialogTitle><DialogContent><Stack spacing={2} sx={{pt:1}}>
   <Alert severity="warning">{t('mysql_obj_warning')}</Alert>
   <Typography component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{s.review.sql}</Typography>
   <TextField size="small" label={t('mysql_user_confirm',{name:s.review.request.grantee.user+'@'+s.review.request.grantee.host})} value={s.confirm} disabled={props.busy} onChange={event=>s.setConfirm(event.target.value)}/>
   <FormControlLabel label={t('mysql_user_acknowledge')} control={<Checkbox checked={s.acknowledged} disabled={props.busy} onChange={event=>s.setAcknowledged(event.target.checked)}/>}/>
   {s.attempted&&<Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
  </Stack></DialogContent><DialogActions><Button disabled={props.busy} onClick={s.close}>{t('cancel')}</Button><Button variant="contained" disabled={!s.canExecute} onClick={()=>void s.execute()}>{t('execute')}</Button></DialogActions></Dialog>}
 </Box>;
}
