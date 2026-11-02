// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { useDbaSplit } from '@/features/dba/hooks/useDbaSplit';
import { useTranslation } from 'react-i18next';
import { useTablespaceTab } from './useTablespaceTab';
export default function TablespaceTabPostgresql({isActive}:{isActive:boolean}) {
  const {t,i18n}=useTranslation(),s=useTablespaceTab(isActive),split=useDbaSplit(isActive);
  const label=(action:string)=>t(action==='create'?'create_new':action==='rename'?'rename':action==='owner'?'change_owner':'delete');
  const columns:GridColDef[]=[{field:'name',headerName:t('tablespace_name'),minWidth:170,flex:1},{field:'owner',headerName:t('owner_2'),minWidth:140,flex:1},
    {field:'location',headerName:t('location_os_path'),minWidth:260,flex:2,valueGetter:p=>p.row.locationKind==='default'?t('pg_ts_default_location'):p.row.locationKind==='global'?t('pg_ts_global_location'):p.value},
    {field:'protected',headerName:t('pg_ts_protection'),width:130,valueFormatter:p=>p.value?t('pg_ts_protected_label'):''}];
  const ownerCandidates=(s.snapshot?.principals || []).filter(role=>s.draft?.action==='create'?role.settable:s.detail?.ownerCandidates.includes(role.id));
  return <Box data-testid="pg-tablespace-tab" aria-busy={s.isLoading} sx={{display:isActive?'flex':'none',height:'100%',flex:1,minHeight:0,minWidth:0,p:1,gap:1,flexDirection:'column'}}>
    <Paper sx={{p:1}}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle2">{t('tablespaces_pg_tablespace')}</Typography>
      <TextField size="small" label={t('pg_ts_search')} value={s.search} onChange={e=>s.setSearch(e.target.value)} />
      <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={s.isLoading} onClick={()=>{void s.reload();}}><RefreshIcon /></IconButton></span></Tooltip>
      <ExportDialog columns={columns} rows={s.rows} defaultFileName="postgres_tablespaces" tableName={t('tablespace_name')} iconType="download" />
      {(['create','rename','owner','drop'] as const).map(action=><Tooltip key={action} title={t(s.can(action)?'pg_ts_action_help':'pg_ts_disabled_help')}><span><Button size="small" startIcon={action==='create'?<AddIcon />:undefined} color={action==='drop'?'error':'primary'} disabled={!s.can(action)} onClick={()=>s.open(action)}>{label(action)}</Button></span></Tooltip>)}
    </Stack><Typography variant="caption">{t('pg_ts_scope_help')} {s.snapshot?.context.database} / {s.snapshot?.fetchedAt || '-'}</Typography></Paper>
    {s.error && <Alert severity="error" action={<Button disabled={s.isLoading} onClick={()=>{void s.reload();}}>{t('retry')}</Button>}>{t(s.error)} {s.errorCode}</Alert>}
    {s.applied && <Alert severity={s.error?'warning':'success'}>{t(s.error?'pg_ts_applied_refresh_failed':'pg_ts_applied')}</Alert>}
    {s.snapshot?.context.readonly && <Alert severity="info">{t('pg_ts_readonly')}</Alert>}
    <Box ref={split.container} sx={{flex:1,minHeight:0,display:'flex',flexDirection:'column'}}>
      <Paper sx={{height:split.topHeight || '50%',flexShrink:0,minHeight:0,display:'flex',flexDirection:'column'}}><GridViewport active={isActive}><DataGrid density="compact" rows={s.rows} columns={columns} getRowId={row=>row.identity} loading={s.isLoading}
        paginationModel={s.pagination} onPaginationModelChange={s.setPagination} pageSizeOptions={[25,50,100]}
        rowSelectionModel={s.rows.some(row=>row.identity===s.selectedId)?[s.selectedId]:[]} keepNonExistentRowsSelected onRowSelectionModelChange={ids=>s.select(ids.length?String(ids[0]):'')}
        localeText={{...(i18n.language.startsWith('ja')?jaJP:enUS).components.MuiDataGrid.defaultProps.localeText,noRowsLabel:t(s.ready?'pg_ts_no_rows':'pg_ts_unconfirmed')}} /></GridViewport></Paper>
      <Box role="separator" tabIndex={0} aria-label={t('pg_ts_resize')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio*100)}
        onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key}
        sx={{height:8,flexShrink:0,cursor:'row-resize',touchAction:'none',bgcolor:split.dragging?'primary.main':'divider','&:focus-visible':{outline:'2px solid',outlineColor:'primary.main'}}} />
      <Paper sx={{p:1,flex:1,minHeight:0,overflow:'auto'}}>
        <Typography variant="subtitle2">{s.selected?.name || t('pg_ts_select')}</Typography>
        {s.detailError && <Alert severity="error" action={<Button disabled={s.isLoading} onClick={()=>{void s.retryDetail();}}>{t('retry')}</Button>}>{t(s.detailError)}</Alert>}
        {s.selected?.protected && <Alert severity="info">{t('pg_ts_protected_help')}</Alert>}
        {s.detail && <>
          <Typography>{t('pg_ts_bytes')}: {s.detail.bytes ?? t('pg_ts_unknown')} {s.detail.sizeError && t(s.detail.sizeError)}</Typography>
          <Typography variant="caption">{t('pg_ts_size_help')}</Typography>
          <Typography variant="body2">OID: {s.detail.tablespace.oid} / {t('owner_2')}: {s.detail.tablespace.owner}</Typography>
          <Typography variant="body2">{t('pg_ts_options')}: {s.detail.tablespace.options.join(', ') || '-'}</Typography>
          <Typography variant="subtitle2" sx={{mt:1}}>{t('pg_ts_databases')}</Typography>
          <Typography variant="caption">{t('pg_ts_databases_help')}</Typography>
          {s.detail.databasesError?<Alert severity="warning">{t(s.detail.databasesError)}</Alert>:<Box component="ul">{s.detail.databases.map(db=><li key={db.oid}>{db.name} — {db.default_space?t('pg_ts_database_default'):t('pg_ts_database_files')}</li>)}</Box>}
          <Typography variant="subtitle2">{t('pg_ts_objects',{count:s.detail.objectCount})}</Typography><Typography variant="caption">{t('pg_ts_objects_help')}</Typography>
          {s.detail.objectsTruncated && <Alert severity="warning">{t('pg_ts_truncated')}</Alert>}
          <Box component="ul">{s.detail.objects.map(object=><li key={object.oid}>{object.schema}.{object.name} ({object.kind})</li>)}</Box>
        </>}
      </Paper>
    </Box>
    <Dialog open={!!s.draft} onClose={s.close} maxWidth="md" fullWidth>
      <DialogTitle>{s.draft && label(s.draft.action)} — {s.draft?.target?.name || t('tablespace_name')}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{pt:1}}>
        {s.error && <Alert severity="error" action={<Button disabled={s.isLoading} onClick={()=>{void s.reload();}}>{t('retry')}</Button>}>{t(s.error)} {s.errorCode}</Alert>}
        {s.applied && s.error && <Alert severity="warning">{t('pg_ts_applied_refresh_failed')}</Alert>}
        {s.draft && ['create','rename'].includes(s.draft.action) && <TextField size="small" label={t('tablespace_name')} disabled={s.isLoading} value={s.draft.newName || ''} onChange={e=>s.update({newName:e.target.value})} />}
        {s.draft?.action==='create' && <TextField size="small" label={t('physical_path_location')} helperText={t('pg_ts_path_help')} disabled={s.isLoading} value={s.draft.location || ''} onChange={e=>s.update({location:e.target.value})} />}
        {s.draft && ['create','owner'].includes(s.draft.action) && <TextField select size="small" label={t('owner_2')} disabled={s.isLoading} value={s.draft.ownerId || ''} onChange={e=>s.update({ownerId:e.target.value})}>{ownerCandidates.map(role=><MenuItem key={role.id} value={role.id}>{role.name}</MenuItem>)}</TextField>}
        {s.draft?.action==='drop' && <Alert severity="warning">{t('pg_ts_drop_help')}</Alert>}
        {s.review && <><Typography variant="subtitle2">{t('pg_ts_review')}</Typography><Box component="pre" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{s.review.sql}</Box>
          {s.review.detail && <Typography>{t('owner_2')}: {s.review.detail.tablespace.owner} / OID: {s.review.detail.tablespace.oid}</Typography>}
          {s.review.request.action==='owner' && <Typography>{t('pg_ts_new_owner')}: {s.snapshot?.principals.find(role=>role.id===s.review?.request.ownerId)?.name}</Typography>}
          {s.review.request.action==='drop' && <TextField size="small" disabled={s.isLoading} label={t('pg_ts_confirm_name')} value={s.confirmName} onChange={e=>s.setConfirmName(e.target.value)} />}
          <FormControlLabel control={<Checkbox disabled={s.isLoading} checked={s.acknowledged} onChange={e=>s.setAcknowledged(e.target.checked)} />} label={t('pg_ts_acknowledge')} />
        </>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={s.isLoading} onClick={s.close}>{t('cancel')}</Button><Button disabled={s.isLoading || !s.ready} onClick={()=>{void s.prepare();}}>{t('pg_ts_review')}</Button><Button variant="contained" disabled={!s.canExecute} onClick={()=>{void s.execute();}}>{t('execute')}</Button></DialogActions>
    </Dialog>
  </Box>;
}
