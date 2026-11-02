// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Paper, Typography, IconButton, Tooltip, Button, Alert, TextField, MenuItem, Stack } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import CancelIcon from '@mui/icons-material/Cancel';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import { compareNumericValues } from '@/shared/utils/numberValues';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { useSessionTab } from './useSessionTab';
import { useSessionSplit } from './useSessionSplit';
export default function SessionTab({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation();
  const state = useSessionTab(isActive), split = useSessionSplit(isActive);
  const busy = state.loading || state.acting;
  const localeText = (i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText;
  const columns: GridColDef[] = [
    { field: 'SID', headerName: 'SID', width: 75 }, { field: 'SERIAL', headerName: 'SERIAL#', width: 90 },
    { field: 'USERNAME', headerName: t('username'), minWidth: 120, flex: 1 }, { field: 'STATUS', headerName: t('status'), width: 105 },
    { field: 'PROGRAM', headerName: t('program'), width: 160 }, { field: 'MACHINE', headerName: t('machine'), width: 150 },
    { field: 'STATE', headerName: t('session_wait_state'), width: 140 }, { field: 'EVENT', headerName: t('session_wait_event'), width: 210 }, { field: 'WAIT_CLASS', headerName: t('session_wait_class'), width: 110 },
    { field: 'WAIT_SECONDS', headerName: t('session_wait_seconds'), width: 130 },
    { field: 'BLOCKING_SID', headerName: t('session_blocker'), width: 120, renderCell: p => p.value ? `${p.row.BLOCKING_INSTANCE}:${p.value}` : '-' },
    { field: 'SQL_ID', headerName: 'SQL_ID', width: 140 }, { field: 'SQL_EXEC_START', headerName: t('session_sql_start'), width: 170 },
    { field: 'LOGON_TIME', headerName: t('logon_time'), width: 170 }, { field: 'INSTANCE_ID', headerName: 'INSTANCE_ID', width: 110 },
    { field: 'CON_ID', headerName: 'CON_ID', width: 85 }, { field: 'OSUSER', headerName: t('os_user'), width: 120 },
    { field: 'protected', headerName: t('session_protection'), width: 100, valueFormatter: p => p.value ? t('session_protected_label') : '' }
  ];
  const statsColumns: GridColDef[] = [{ field: 'NAME', headerName: t('stat_item'), flex: 2, minWidth: 220 }, { field: 'VALUE', headerName: t('value'), sortComparator: compareNumericValues, flex: 1, minWidth: 150 }];
  const detail = state.detail;
  return <Box data-testid="session-tab" aria-busy={busy} sx={{ flex: 1, height: '100%', minHeight: 0, minWidth: 0, display: isActive ? 'flex' : 'none', flexDirection: 'column', p: 1, gap: 0.5, overflow: 'hidden' }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle2">{t('session_management_v_session')}</Typography>
      <TextField size="small" label={t('session_search')} value={state.search} onChange={e => state.setSearch(e.target.value)} />
      <TextField select size="small" label={t('session_filter')} value={state.filter} onChange={e => state.setFilter(e.target.value === 'active' ? 'active' : e.target.value === 'waiting' ? 'waiting' : 'all')}>
        <MenuItem value="all">{t('session_all')}</MenuItem><MenuItem value="active">{t('session_active')}</MenuItem><MenuItem value="waiting">{t('session_waiting')}</MenuItem>
      </TextField>
      <TextField select size="small" label={t('session_auto_refresh')} value={state.refreshSeconds} onChange={e => state.setRefreshSeconds(Number(e.target.value))}>
        {[0, 5, 10, 30].map(value => <MenuItem key={value} value={value}>{value ? `${value}s` : t('session_auto_off')}</MenuItem>)}
      </TextField>
      <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} size="small" disabled={busy || state.detailLoading} onClick={() => { void state.reload(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <Tooltip title={t('session_export_help')}><span><ExportDialog columns={columns} rows={state.rows} defaultFileName="oracle_sessions" iconType="download" tableName={t('session_management_v_session')} /></span></Tooltip>
      <Tooltip title={t(state.snapshot?.context.cancelSupported ? 'session_cancel_help' : 'session_cancel_unsupported')}><span><Button size="small" color="warning" startIcon={<CancelIcon />} disabled={!state.canCancel} onClick={() => { void state.command('cancel'); }}>{t('cancel_sql')}</Button></span></Tooltip>
      <Tooltip title={t('session_kill_help')}><span><Button size="small" color="error" startIcon={<CloseIcon />} disabled={!state.canKill} onClick={() => { void state.command('kill'); }}>{t('kill_session')}</Button></span></Tooltip>
    </Stack><Typography variant="caption">{t('session_count', { count: state.rows.length })} / {t('session_observed_at')}: {state.snapshot?.fetchedAt || '-'} / {t('session_scope')}</Typography></Paper>
    {state.error && <Alert severity="error" action={<Button disabled={busy || state.detailLoading} onClick={() => { void state.reload(); }}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
    {state.notice && <Alert severity="info">{t(state.notice)}</Alert>}
    {state.snapshot && !state.snapshot.context.canManage && <Typography variant="caption">{t(state.snapshot.context.readonly ? 'session_readonly' : !state.snapshot.context.protectionReady ? 'session_protection_unavailable' : 'session_privilege_required')}</Typography>}
    <Box ref={split.container} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Paper sx={{ height: split.topHeight || '55%', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={state.rows} columns={columns} loading={busy} density="compact"
        rowSelectionModel={state.rows.some(row => row.id === state.selectedId) && state.selectedId ? [state.selectedId] : []} keepNonExistentRowsSelected onRowSelectionModelChange={values => { if (!busy) state.select(values.length ? String(values[0]) : null); }}
        paginationModel={state.pagination} onPaginationModelChange={state.setPagination} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.ready ? 'session_no_rows' : 'session_unconfirmed') }}
        initialState={{ columns: { columnVisibilityModel: { INSTANCE_ID: false, CON_ID: false, OSUSER: false } } }} /></GridViewport></Paper>
      <Box role="separator" aria-label={t('session_resize')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio * 100)} tabIndex={0}
        onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key}
        sx={{ height: 8, flexShrink: 0, touchAction: 'none', cursor: 'row-resize', bgcolor: split.dragging ? 'primary.main' : 'divider', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }} />
      <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, minHeight: 36, flexShrink: 0 }}><Typography variant="subtitle2">{state.selected ? t('session_selected', { sid: state.selected.SID, serial: state.selected.SERIAL, user: state.selected.USERNAME }) : t('select_a_session_from_the_list_above')}</Typography>
          {state.selected && <><Button size="small" disabled={!state.ready || busy || state.detailLoading} onClick={() => { void state.retryDetail(); }}>{t('session_refresh_detail')}</Button><ExportDialog columns={statsColumns} rows={detail?.statistics || []} defaultFileName={`session_stats_${state.selected.SID}_${state.selected.SERIAL}`} iconType="download" tableName={t('session_statistics')} /></>}
        </Stack>
        {state.selected?.protected && <Typography variant="caption" sx={{ px: 1 }}>{t('session_protected')}</Typography>}
        {state.detailError && <Alert severity="error" action={<Button disabled={busy || state.detailLoading || !state.ready} onClick={() => { void state.retryDetail(); }}>{t('retry')}</Button>}>{t(state.detailError)} {state.detailErrorCode}</Alert>}
        <Typography variant="caption" sx={{ px: 1 }}>{t('session_stats_help')} {t('session_wait_help')} {detail ? `${t('session_observed_at')}: ${detail.fetchedAt}` : ''}</Typography>
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
          <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={detail?.statistics || []} columns={statsColumns} loading={state.detailLoading} density="compact" disableRowSelectionOnClick
            initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.detailReady ? 'session_stats_empty' : 'session_stats_unconfirmed') }} /></GridViewport></Box>
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 1 }}>
            {(['sqlText', 'previousSqlText'] as const).map(field => <Box key={field}><Stack direction="row" alignItems="center"><Typography variant="subtitle2">{t(field === 'sqlText' ? 'session_current_sql' : 'session_previous_sql')}</Typography><Tooltip title={t('session_copy_sql')}><span><IconButton size="small" aria-label={t(field === 'sqlText' ? 'session_copy_current' : 'session_copy_previous')} disabled={!detail?.[field]} onClick={() => { void state.copy(detail?.[field] || ''); }}><ContentCopyIcon fontSize="small" /></IconButton></span></Tooltip></Stack><Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.75rem' }}>{detail?.[field] || t('session_sql_unavailable')}</Box></Box>)}
            <Typography variant="caption">{t('session_previous_help')}</Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  </Box>;
}
