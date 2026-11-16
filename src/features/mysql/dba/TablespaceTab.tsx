// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { Alert, Box, Button, MenuItem, Paper, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, enUS, jaJP, type GridColDef } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import StorageIcon from '@mui/icons-material/Storage';
import { useTranslation } from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { useDbaSplit } from '@/features/dba/hooks/useDbaSplit';
import { useTablespaceTab } from './useTablespaceTab';

const numericSort=(a:string|null,b:string|null)=>a===b?0:a===null?-1:b===null?1:BigInt(a)<BigInt(b)?-1:1;
export default function TablespaceTab({active,busy}:{active:boolean;busy:boolean}) {
  const {t,i18n}=useTranslation(),s=useTablespaceTab(active,busy),split=useDbaSplit(active),[tab,setTab]=useState(0);
  const bytes=(field:string,label:string):GridColDef=>({field,headerName:t(label),width:180,sortComparator:numericSort,valueFormatter:p=>p.value==null?'—':new Intl.NumberFormat(i18n.language).format(BigInt(p.value))});
  const columns:GridColDef[]=[{field:'name',headerName:t('tablespace_name'),minWidth:230,flex:1},{field:'id',headerName:'SPACE ID',width:100,sortComparator:numericSort},{field:'type',headerName:t('type'),width:120,valueFormatter:p=>p.value||t('mysql_storage_unknown')},bytes('fileSize','mysql_storage_file_size'),bytes('allocatedSize','mysql_storage_allocated_size'),{field:'encryption',headerName:t('mysql_storage_encryption'),width:110},{field:'state',headerName:t('status'),width:120},bytes('pageSize','mysql_storage_page_size')];
  const fileColumns:GridColDef[]=[{field:'path',headerName:t('mysql_storage_file'),minWidth:300,flex:1},{field:'status',headerName:t('status'),width:150}];
  const tableColumns:GridColDef[]=[{field:'name',headerName:t('mysql_storage_engine_name'),minWidth:300,flex:1},{field:'id',headerName:'TABLE ID',width:150,sortComparator:numericSort},{field:'rowFormat',headerName:t('mysql_storage_row_format'),width:150}];
  const locale={...(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText};
  return <Box data-testid="mysql-tablespace-tab" aria-busy={s.loading||s.detailLoading} sx={{height:'100%',flex:1,minWidth:0,minHeight:0,display:active?'flex':'none',flexDirection:'column',p:1,gap:1}}>
    <Stack direction="row" alignItems="center" spacing={1} sx={{flexWrap:'wrap',rowGap:1}}>
      <StorageIcon color="action"/><Typography variant="subtitle2">{t('mysql_storage_title')}</Typography>
      <TextField size="small" label={t('mysql_storage_search')} value={s.search} onChange={e=>s.setSearch(e.target.value)}/>
      <TextField select size="small" label={t('type')} value={s.filter} onChange={e=>s.setFilter(e.target.value)} sx={{minWidth:130}}>{[...new Set(['all',s.filter,...(s.snapshot?.tablespaces.map(row=>row.type||'unknown')||[])])].map(value=><MenuItem key={value} value={value}>{value==='all'?t('all'):value==='unknown'?t('mysql_storage_unknown'):value}</MenuItem>)}</TextField>
      <Tooltip title={t('mysql_storage_help')}><InfoOutlinedIcon color="action" fontSize="small" tabIndex={0}/></Tooltip>
      <Box sx={{flexGrow:1}}/><ExportDialog columns={columns} rows={s.rows} defaultFileName="mysql_tablespaces" tableName={t('mysql_storage_title')} iconType="download"/>
      <Tooltip title={t('refresh_to_latest_state')}><span><Button size="small" variant="outlined" startIcon={<RefreshIcon/>} disabled={busy||s.loading||s.detailLoading} onClick={()=>void s.reload()}>{t('refresh')}</Button></span></Tooltip>
    </Stack>
    {s.error&&<Alert severity="error" action={<Button disabled={busy||s.loading} onClick={()=>void s.reload()}>{t('retry')}</Button>}>{t(s.error)}</Alert>}
    <Box ref={split.container} sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
      <Paper sx={{height:split.topHeight,flexShrink:0,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <GridViewport active={active}><DataGrid rows={s.rows} columns={columns} density="compact" loading={s.loading} localeText={locale} pageSizeOptions={[25,50,100]} initialState={{pagination:{paginationModel:{pageSize:25}}}} rowSelectionModel={s.rows.some(row=>row.id===s.selectedId)?[s.selectedId]:[]} onRowSelectionModelChange={ids=>s.select(String(ids[0]||''))} sx={{border:0}}/></GridViewport>
      </Paper>
      <Box role="separator" aria-label={t('mysql_storage_resize')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio*100)} tabIndex={0} onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key} sx={{height:8,flexShrink:0,cursor:'row-resize',bgcolor:split.dragging?'primary.main':'divider','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main'}}}/>
      <Paper sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <Stack direction="row" alignItems="center" sx={{px:1}}><Typography variant="subtitle2" sx={{flex:1}}>{s.detail?.tablespace.name||t('select_a_tablespace_from_the_list_above')}</Typography><Typography variant="caption">{s.detail?.fetchedAt||s.snapshot?.fetchedAt||''}</Typography></Stack>
        <Tabs value={tab} onChange={(_,value:number)=>setTab(value)} aria-label={t('mysql_storage_details')}><Tab label={t('mysql_storage_files')}/><Tab label={t('mysql_storage_tables')}/><Tab label={t('mysql_storage_information')}/></Tabs>
        {s.detailError&&<Alert severity="error" action={<Button disabled={busy||s.detailLoading} onClick={()=>void s.retryDetail()}>{t('retry')}</Button>}>{t(s.detailError)}</Alert>}
        {tab===0&&<Box sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><GridViewport active={active}><DataGrid rows={s.detail?.tablespace.files||[]} columns={fileColumns} density="compact" loading={s.detailLoading} localeText={locale} pageSizeOptions={[25,50,100]} initialState={{pagination:{paginationModel:{pageSize:25}}}} sx={{border:0}}/></GridViewport></Box>}
        {tab===1&&<Box sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}><Tooltip title={t('mysql_storage_engine_name_help')}><Typography variant="caption" sx={{px:1}}>{t('mysql_storage_engine_name')}</Typography></Tooltip><GridViewport active={active}><DataGrid rows={s.detail?.tables||[]} columns={tableColumns} density="compact" loading={s.detailLoading} localeText={locale} pageSizeOptions={[25,50,100]} initialState={{pagination:{paginationModel:{pageSize:25}}}} sx={{border:0}}/></GridViewport></Box>}
        {tab===2&&s.detail&&<Box sx={{p:1,overflow:'auto'}}>{[['SPACE ID',s.detail.tablespace.id],[t('mysql_storage_row_format'),s.detail.tablespace.rowFormat],[t('mysql_storage_block_size'),s.detail.tablespace.blockSize],[t('mysql_storage_encryption'),s.detail.tablespace.encryption],[t('status'),s.detail.tablespace.state]].map(([name,value])=><Typography key={name} variant="body2">{name}: {value??'—'}</Typography>)}</Box>}
      </Paper>
    </Box>
  </Box>;
}
