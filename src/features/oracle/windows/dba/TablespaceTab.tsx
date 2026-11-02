// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Box, Paper, Typography, LinearProgress, IconButton, Tooltip, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Checkbox, FormControlLabel, Alert, Stack, MenuItem } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import { GridViewport } from '@/features/data-grid/GridViewport';
import ExportDialog from '@/components/data/ExportDialog';
import { compareNumericValues } from '@/shared/utils/numberValues';
import { useDbaSplit } from '@/features/dba/hooks/useDbaSplit';
import { useTablespaceTab } from './useTablespaceTab';
export default function TablespaceTab({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation(), state = useTablespaceTab(isActive), split = useDbaSplit(isActive);
  const actionLabels = { create: t('ts_action_create'), add: t('ts_action_add'), resize: t('ts_action_resize'), autoextend: t('ts_action_autoextend'), drop: t('ts_action_drop') };
  const helpLabels = { create: t('ts_help_create'), add: t('ts_help_add'), resize: t('ts_help_resize'), drop: t('ts_help_drop') };
  const detailLabels: Record<string, string> = { files: t('ts_files'), users: t('ts_users'), quotas: t('ts_quotas'), segments: t('ts_segments') };
  const [detailTab, setDetailTab] = useState('files');
  const localeText = (i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText;
  const numberColumn = (field: string, label: string): GridColDef => ({ field, headerName: t(label), width: 135, sortComparator: compareNumericValues, valueFormatter: p => p.value ?? t('ts_unknown') });
  const columns: GridColDef[] = [
    { field: 'name', headerName: t('tablespace_name_2'), minWidth: 160, flex: 1 },
    { field: 'kind', headerName: t('ts_kind'), width: 120 }, { field: 'status', headerName: t('status'), width: 110 },
    { field: 'bigfile', headerName: 'BIGFILE', width: 90, type: 'boolean' },
    numberColumn('allocatedMb', 'ts_allocated'), numberColumn('usedMb', 'used_mb'), numberColumn('freeMb', 'free_size_mb'), numberColumn('maxMb', 'ts_configured_max'),
    { field: 'usedPercent', headerName: t('used'), width: 150, renderCell: p => p.value == null ? t('ts_unknown') : <Box sx={{ width: '100%' }}><Typography variant="caption">{p.value}%</Typography><LinearProgress variant="determinate" value={Math.max(0, Math.min(100, p.value))} color={p.value >= 90 ? 'error' : p.value >= 80 ? 'warning' : 'primary'} /></Box> },
    { field: 'dropProtected', headerName: t('ts_protection'), width: 130, valueFormatter: p => p.value ? t('ts_protected_label') : '' }
  ];
  const fileColumns: GridColDef[] = [{ field: 'path', headerName: t('file_path'), flex: 1, minWidth: 300 }, { field: 'kind', headerName: t('ts_kind'), width: 110 }, numberColumn('sizeMb', 'size_mb'), { field: 'autoExtend', headerName: t('auto_extend'), type: 'boolean', width: 110 }, numberColumn('nextMb', 'ts_next'), numberColumn('maxMb', 'max_size_mb')];
  const detail = state.detail;
  const relatedRows = detailTab === 'users' ? detail?.users.map(row => ({ ...row, id: row.USERNAME })) || [] : detailTab === 'quotas' ? detail?.quotas.map(row => ({ ...row, id: row.USERNAME })) || [] : detail?.segments.map(row => ({ ...row, id: JSON.stringify([row.OWNER, row.SEGMENT_NAME, row.SEGMENT_TYPE, row.PARTITION_NAME]) })) || [];
  const relatedColumns: GridColDef[] = (detailTab === 'users' ? ['USERNAME', 'DEFAULT_TABLESPACE', 'TEMPORARY_TABLESPACE'] : detailTab === 'quotas' ? ['USERNAME', 'MAX_BYTES'] : ['OWNER', 'SEGMENT_NAME', 'SEGMENT_TYPE', 'PARTITION_NAME']).map(field => ({ field, headerName: field, flex: 1, minWidth: 150, ...(field === 'MAX_BYTES' ? { sortComparator: compareNumericValues } : {}) }));
  const outcome = state.outcome && <Alert severity={state.error || state.outcome.attempted ? 'warning' : 'success'}>{t('ts_outcome', { completed: state.outcome.completed.map(step => actionLabels[step]).join(', ') || t('ts_none'), attempted: state.outcome.attempted ? actionLabels[state.outcome.attempted] : t('ts_none') })} {(state.error || state.outcome.attempted) && t('ts_recheck_help')}</Alert>;
  const error = state.error && <Alert severity="error">{t(state.error)} {state.errorCode}</Alert>;
  const operation = state.draft.action;
  return <Box data-testid="tablespace-tab" aria-busy={state.isLoading} sx={{ height: '100%', flex: 1, minHeight: 0, minWidth: 0, display: isActive ? 'flex' : 'none', flexDirection: 'column', p: 1, gap: 0.5 }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle2">{t('tablespace_dashboard')}</Typography>
      <TextField size="small" label={t('ts_search')} value={state.search} onChange={e => state.setSearch(e.target.value)} />
      <TextField select size="small" label={t('ts_kind')} value={state.kind} onChange={e => state.setKind(e.target.value)}>{['all', 'PERMANENT', 'TEMPORARY', 'UNDO'].map(kind => <MenuItem key={kind} value={kind}>{kind === 'all' ? t('ts_all') : kind}</MenuItem>)}</TextField>
      <Tooltip title={t('ts_reload')}><span><IconButton aria-label={t('ts_reload')} disabled={state.isLoading} onClick={() => { void state.reload(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <ExportDialog columns={columns} rows={state.rows} defaultFileName="oracle_tablespaces" iconType="download" tableName={t('tablespace_dashboard')} />
      {(['create', state.selected?.bigfile ? 'resize' : 'add', 'drop'] as const).map(action => <Tooltip key={action} title={helpLabels[action]}><span><Button size="small" color={action === 'drop' ? 'error' : 'primary'} disabled={!state.can(action)} onClick={() => state.open(action)}>{actionLabels[action]}</Button></span></Tooltip>)}
    </Stack><Typography variant="caption">{t('ts_capacity_help')} {state.snapshot?.context.containerName} / {state.snapshot?.fetchedAt || t('ts_unknown')}</Typography></Paper>
    {state.snapshot?.context.scope === 'visible' && <Alert severity="warning">{t('ts_visible_scope')}</Alert>}
    {state.snapshot?.context.readonly && <Alert severity="info">{t('ts_readonly')}</Alert>}
    {!state.dialog && <>{error}{outcome}</>}
    {!state.ready && !state.isLoading && <Button onClick={() => { void state.reload(); }}>{t('retry')}</Button>}
    <Box ref={split.container} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Paper sx={{ height: split.topHeight || '55%', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={state.rows} columns={columns} density="compact" loading={state.isLoading}
        rowSelectionModel={state.rows.some(row => row.id === state.selectedId) ? [state.selectedId] : []} keepNonExistentRowsSelected onRowSelectionModelChange={ids => state.select(ids.length ? String(ids[0]) : '')}
        initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.ready ? 'ts_no_rows' : 'ts_unconfirmed') }} /></GridViewport></Paper>
      <Box role="separator" aria-label={t('ts_resize_panels')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio * 100)} tabIndex={0}
        onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key}
        sx={{ height: 8, flexShrink: 0, cursor: 'row-resize', touchAction: 'none', bgcolor: split.dragging ? 'primary.main' : 'divider', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }} />
      <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1 }}><Typography>{state.selected?.name || t('select_a_tablespace_from_the_list_above')}</Typography>
          <TextField select size="small" label={t('ts_details')} value={detailTab} onChange={e => setDetailTab(e.target.value)}>{['files', 'users', 'quotas', 'segments'].map(tab => <MenuItem key={tab} value={tab}>{detailLabels[tab]}</MenuItem>)}</TextField>
          <Button disabled={state.isLoading || !state.selected || !state.ready} onClick={() => { void state.retryDetail(); }}>{t('retry')}</Button>
        </Stack>
        {state.selected?.dropProtected && <Typography variant="caption" sx={{ px: 1 }}>{t('ts_protection_help')}</Typography>}
        {state.detailError && <Alert severity="error">{t(state.detailError)} {state.errorCode}</Alert>}
        {detailTab === 'segments' && <Typography variant="caption" sx={{ px: 1 }}>{t('ts_segment_count', { count: detail?.segmentCount || 0 })}</Typography>}
        <GridViewport active={isActive}><DataGrid rows={detailTab === 'files' ? detail?.files || [] : relatedRows} columns={detailTab === 'files' ? fileColumns : relatedColumns} density="compact" disableRowSelectionOnClick loading={state.isLoading}
          initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.detailReady ? 'ts_no_rows' : 'ts_unconfirmed') }} /></GridViewport>
      </Paper>
    </Box>
    <Dialog open={state.dialog} onClose={state.close} maxWidth="md" fullWidth>
      <DialogTitle>{actionLabels[operation]} {operation !== 'create' ? state.draft.name : ''}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{error}{outcome}
        {operation === 'create' && <><TextField size="small" label={t('tablespace_name_2')} disabled={state.isLoading} value={state.draft.name} onChange={e => state.update({ name: e.target.value })} helperText={t('ts_name_help')} /><FormControlLabel label="BIGFILE" control={<Checkbox disabled={state.isLoading} checked={state.draft.bigfile === true} onChange={e => state.update({ bigfile: e.target.checked })} />} /></>}
        {operation !== 'drop' && <>
          {operation !== 'resize' && <><TextField select size="small" label={t('ts_file_mode')} disabled={state.isLoading} value={state.draft.pathMode} onChange={e => state.update({ pathMode: e.target.value === 'path' ? 'path' : 'omf' })}><MenuItem value="omf" disabled={!state.snapshot?.context.omf}>OMF</MenuItem><MenuItem value="path">{t('ts_server_path')}</MenuItem></TextField>{state.draft.pathMode === 'path' && <TextField size="small" label={t('full_path_of_data_file')} disabled={state.isLoading} value={state.draft.path} onChange={e => state.update({ path: e.target.value })} helperText={t('specify_a_physical_path_recognized_by_the_database_server')} />}</>}
          <TextField size="small" label={t('size_mb')} disabled={state.isLoading} value={state.draft.sizeMb} inputProps={{ inputMode: 'numeric' }} onChange={e => state.update({ sizeMb: e.target.value })} />
          <FormControlLabel label={t('auto_extend')} control={<Checkbox disabled={state.isLoading} checked={state.draft.autoExtend === true} onChange={e => state.update({ autoExtend: e.target.checked })} />} />
          {state.draft.autoExtend && <Stack direction="row" spacing={1}><TextField size="small" label={t('ts_next')} disabled={state.isLoading} value={state.draft.nextMb} onChange={e => state.update({ nextMb: e.target.value })} /><TextField size="small" label={t('max_size_mb')} disabled={state.isLoading} value={state.draft.maxMb} onChange={e => state.update({ maxMb: e.target.value })} /></Stack>}
        </>}
        {operation === 'drop' && <Alert severity="warning">{t('ts_drop_warning')}</Alert>}
        {state.review && <>
          {state.review.shrinking && <Alert severity="warning">{t('ts_shrink_warning')}</Alert>}
          {state.review.detail && <Box><Typography>{t('ts_review_refs', { files: state.review.detail.files.length, users: state.review.detail.users.length, quotas: state.review.detail.quotas.length, segments: state.review.detail.segmentCount })}</Typography><Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 120, overflow: 'auto' }}>{[...state.review.detail.files.map(file => `${file.kind}: ${file.path} (${file.sizeMb} MB)`), ...state.review.detail.users.map(user => `USER: ${user.USERNAME}`), ...state.review.detail.quotas.map(quota => `QUOTA: ${quota.USERNAME} (${quota.MAX_BYTES})`), ...state.review.detail.segments.map(segment => `${segment.SEGMENT_TYPE}: ${segment.OWNER}.${segment.SEGMENT_NAME}${segment.PARTITION_NAME ? ':' + segment.PARTITION_NAME : ''}`)].join('\n')}</Box></Box>}
          <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.review.steps.map(step => step.sql).join(';\n') || t('ts_no_changes')}</Box>
          <Alert severity="info">{t('ts_execution_help')}</Alert>
          {operation === 'drop' && <TextField size="small" label={t('ts_confirm_label', { name: state.review.request.name })} disabled={state.isLoading} value={state.confirmName} onChange={e => state.setConfirmName(e.target.value)} />}
          <FormControlLabel label={t('ts_acknowledge')} control={<Checkbox checked={state.acknowledged} disabled={state.isLoading || !state.review.canExecute} onChange={e => state.setAcknowledged(e.target.checked)} />} />
        </>}
      </Stack></DialogContent>
      <DialogActions><Button disabled={state.isLoading} onClick={state.close}>{t('cancel')}</Button>{!state.ready && <Button disabled={state.isLoading} onClick={() => { void state.reload(); }}>{t('ts_reload')}</Button>}<Button disabled={!state.ready || state.isLoading} onClick={() => { void state.prepare(); }}>{t('ts_review')}</Button><Button variant="contained" color={operation === 'drop' ? 'error' : 'primary'} disabled={!state.canExecute} onClick={() => { void state.execute(); }}>{t('execute')}</Button></DialogActions>
    </Dialog>
  </Box>;
}
