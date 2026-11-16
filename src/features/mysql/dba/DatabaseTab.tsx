// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import {useState} from 'react';
import {Alert,Box,Button,MenuItem,Paper,Stack,TextField,Tooltip,Typography} from '@mui/material';
import {DataGrid,enUS,jaJP,type GridColDef} from '@mui/x-data-grid';
import DatabaseEditorDialog from './DatabaseEditorDialog';
import type {MysqlDatabaseDraft} from '@/shared/types/mysqlDatabaseTypes';
import type {TransactionState} from '@/shared/api/desktopContract';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import StorageIcon from '@mui/icons-material/Storage';
import {useTranslation} from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import {GridViewport} from '@/features/data-grid/GridViewport';
import {useDbaSplit} from '@/features/dba/hooks/useDbaSplit';
import {useDatabaseTab} from './useDatabaseTab';
const compare=(a:string|null,b:string|null)=>a===b?0:a===null?-1:b===null?1:BigInt(a)<BigInt(b)?-1:1;
export default function DatabaseTab({active,busy,readonly=false,setBusy=()=>{},onState=()=>{}}:{active:boolean;busy:boolean;readonly?:boolean;setBusy?:(value:boolean)=>void;onState?:(value:TransactionState)=>void}){
 const {t,i18n}=useTranslation(),s=useDatabaseTab(active,busy),split=useDbaSplit(active),[objectSearch,setObjectSearch]=useState(''),[kind,setKind]=useState('all');
 const [draft,setDraft]=useState<MysqlDatabaseDraft>();
 const columns:GridColDef[]=[{field:'name',headerName:t('database'),minWidth:220,flex:1},{field:'charset',headerName:t('mysql_database_charset'),minWidth:160,flex:1},{field:'collation',headerName:t('mysql_database_collation'),minWidth:240,flex:1}];
 const number=(field:string,label:string):GridColDef=>({field,headerName:t(label),width:180,sortComparator:compare,valueFormatter:p=>p.value==null?'—':new Intl.NumberFormat(i18n.language).format(BigInt(p.value))});
 const objectColumns:GridColDef[]=[{field:'name',headerName:t('object_name'),minWidth:240,flex:1},{field:'type',headerName:t('type'),width:140},{field:'engine',headerName:'ENGINE',width:130},{field:'parent',headerName:t('table_name'),width:170},number('rows','mysql_database_estimated_rows'),number('dataBytes','mysql_database_data_bytes'),number('indexBytes','mysql_database_index_bytes')];
 const rows=(s.detail?.objects||[]).filter(row=>(kind==='all'||row.type===kind)&&row.name.toLowerCase().includes(objectSearch.toLowerCase()));
 const locale={...(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText};
 return <Box data-testid="mysql-database-tab" aria-busy={s.loading||s.detailLoading} sx={{height:'100%',flex:1,minWidth:0,minHeight:0,display:active?'flex':'none',flexDirection:'column',p:1,gap:1}}>
  <Stack direction="row" alignItems="center" spacing={1} sx={{flexWrap:'wrap',rowGap:1}}><StorageIcon color="action"/><Typography variant="subtitle2">{t('mysql_database_title')}</Typography>
   <TextField size="small" label={t('mysql_database_search')} value={s.search} onChange={e=>s.setSearch(e.target.value)}/>
   <Tooltip title={t('mysql_database_scope_help')}><InfoOutlinedIcon fontSize="small" color="action" tabIndex={0}/></Tooltip><Box sx={{flexGrow:1}}/>
   <Button size="small" variant="outlined" startIcon={<AddIcon/>} disabled={busy||readonly||s.loading} onClick={()=>setDraft({action:'create',name:'',charset:'utf8mb4',collation:'utf8mb4_0900_ai_ci'})}>{t('mysql_database_create')}</Button>
   <Button size="small" variant="outlined" startIcon={<EditIcon/>} disabled={busy||readonly||!s.detail||s.detailLoading||/^(mysql|sys|information_schema|performance_schema)$/i.test(s.detail?.database.name||'')} onClick={()=>{if(s.detail)setDraft({action:'alter',name:s.detail.database.name,charset:s.detail.database.charset,collation:s.detail.database.collation});}}>{t('mysql_database_alter')}</Button>
   <ExportDialog columns={columns} rows={s.rows} defaultFileName="mysql_databases" tableName={t('mysql_database_title')} iconType="download"/>
   <Tooltip title={t('refresh_to_latest_state')}><span><Button size="small" variant="outlined" startIcon={<RefreshIcon/>} disabled={busy||s.loading||s.detailLoading} onClick={()=>void s.reload()}>{t('refresh')}</Button></span></Tooltip>
  </Stack>
  <Typography variant="caption">{t('mysql_database_visible_scope')}</Typography>
  {s.error&&<Alert severity="error" action={<Button disabled={busy||s.loading} onClick={()=>void s.reload()}>{t('retry')}</Button>}>{t(s.error)}</Alert>}
  <Box ref={split.container} sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
   <Paper sx={{height:split.topHeight,flexShrink:0,minHeight:0,display:'flex',flexDirection:'column'}}><GridViewport active={active}><DataGrid rows={s.rows} columns={columns} density="compact" loading={s.loading} localeText={locale} pageSizeOptions={[25,50,100]} initialState={{pagination:{paginationModel:{pageSize:25}}}} rowSelectionModel={s.rows.some(row=>row.id===s.selectedId)?[s.selectedId]:[]} onRowSelectionModelChange={ids=>s.select(String(ids[0]||''))} sx={{border:0}}/></GridViewport></Paper>
   <Box role="separator" aria-label={t('mysql_database_resize')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio*100)} tabIndex={0} onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key} sx={{height:8,flexShrink:0,cursor:'row-resize',bgcolor:split.dragging?'primary.main':'divider','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main'}}}/>
   <Paper sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
    <Stack direction="row" alignItems="center" spacing={1} sx={{p:1,flexWrap:'wrap',rowGap:1}}><Typography variant="subtitle2">{s.detail?.database.name||t('mysql_database_select')}</Typography>
     <TextField size="small" label={t('mysql_database_object_search')} value={objectSearch} onChange={e=>setObjectSearch(e.target.value)}/>
     <TextField select size="small" label={t('type')} value={kind} onChange={e=>setKind(e.target.value)} sx={{minWidth:140}}>{['all','TABLE','VIEW','PROCEDURE','FUNCTION','TRIGGER'].map(value=><MenuItem key={value} value={value}>{value==='all'?t('all'):value}</MenuItem>)}</TextField>
     <Tooltip title={t('mysql_database_estimates_help')}><InfoOutlinedIcon fontSize="small" color="action" tabIndex={0}/></Tooltip><Box sx={{flexGrow:1}}/>
     <ExportDialog columns={objectColumns} rows={rows} defaultFileName="mysql_database_objects" tableName={s.detail?.database.name||t('mysql_database_title')} iconType="download"/>
    </Stack>
    {s.detailError&&<Alert severity="error" action={<Button disabled={busy||s.detailLoading} onClick={()=>void s.retryDetail()}>{t('retry')}</Button>}>{t(s.detailError)}</Alert>}
    <GridViewport active={active}><DataGrid rows={rows} columns={objectColumns} density="compact" loading={s.detailLoading} localeText={locale} pageSizeOptions={[25,50,100]} initialState={{pagination:{paginationModel:{pageSize:25}}}} sx={{border:0}}/></GridViewport>
   </Paper>
  </Box>
 {draft&&<DatabaseEditorDialog initial={draft} blocked={readonly||busy} setBusy={setBusy} onState={onState} onClose={()=>setDraft(undefined)} onDone={()=>{window.dispatchEvent(new Event('mysql-databases-changed'));}}/>}
 </Box>;
}
