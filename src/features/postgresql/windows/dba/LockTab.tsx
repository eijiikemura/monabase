// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Paper, Typography, IconButton, Tooltip, Button, Alert, TextField, MenuItem, Stack } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { compareNumericValues } from '@/shared/utils/numberValues';
import { useDbaSplit } from '@/features/dba/hooks/useDbaSplit';
import { useLockTab } from './useLockTab';
export default function LockTabPostgresql({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation(), state = useLockTab(isActive), split = useDbaSplit(isActive);
  const busy = state.loading || state.acting;
  const columns: GridColDef[] = [
    { field: 'pid', headerName: 'PID', width: 80 }, { field: 'database', headerName: t('pg_lock_database'), width: 150 },
    { field: 'username', headerName: t('db_user'), width: 130 }, { field: 'program', headerName: t('program'), width: 160 },
    { field: 'object', headerName: t('target_object_2'), minWidth: 160, flex: 1, valueGetter: p => p.row.object ? `${p.row.schema}.${p.row.object}` : p.row.relationId || '-' },
    { field: 'kind', headerName: t('lock_type'), width: 120 }, { field: 'mode', headerName: t('lock_mode'), width: 180 },
    { field: 'granted', headerName: t('granted_status'), width: 125, valueFormatter: p => t(p.value ? 'pg_lock_granted' : 'pg_lock_waiting') },
    { field: 'blockers', headerName: t('pg_lock_blockers'), width: 130, valueFormatter: p => p.value?.join(', ') || '-' },
    { field: 'waiters', headerName: t('lock_waiter_count'), width: 100, type: 'number' },
    { field: 'waitType', headerName: t('pg_lock_wait_type'), width: 125 }, { field: 'waitEvent', headerName: t('lock_wait_event'), width: 160 },
    { field: 'querySeconds', headerName: t('pg_lock_query_seconds'), width: 150, sortComparator: compareNumericValues },
    { field: 'state', headerName: t('status'), width: 145 }, { field: 'backendStart', headerName: t('pg_lock_backend_start'), width: 220 },
    { field: 'transactionStart', headerName: t('pg_lock_transaction_start'), width: 220 }, { field: 'address', headerName: t('pg_lock_address'), width: 140 },
    { field: 'transactionId', headerName: t('pg_lock_transaction_id'), width: 130 }, { field: 'query', headerName: t('lock_current_sql'), width: 250 }
  ];
  const localeText = (i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText;
  return <Box data-testid="pg-lock-tab" aria-busy={busy} sx={{ flex: 1, height: '100%', minHeight: 0, minWidth: 0, display: isActive ? 'flex' : 'none', flexDirection: 'column', p: 1, gap: 0.5 }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle2">{t('lock_management_pg_locks')}</Typography>
      <TextField size="small" label={t('lock_search')} value={state.search} onChange={e => state.setSearch(e.target.value)} />
      <TextField select size="small" label={t('lock_filter')} value={state.filter} onChange={e => state.setFilter(e.target.value as 'all' | 'waiting' | 'blocking')}>
        <MenuItem value="all">{t('lock_all')}</MenuItem><MenuItem value="waiting">{t('lock_waiting')}</MenuItem><MenuItem value="blocking">{t('lock_blocking')}</MenuItem>
      </TextField>
      <TextField select size="small" label={t('lock_auto_refresh')} value={state.refreshSeconds} onChange={e => state.setRefreshSeconds(Number(e.target.value))}>{[0, 5, 10, 30].map(seconds => <MenuItem key={seconds} value={seconds}>{seconds ? t('lock_refresh_seconds', { seconds }) : t('lock_refresh_off')}</MenuItem>)}</TextField>
      <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={busy} onClick={() => { void state.load(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <Tooltip title={t('pg_lock_export_help')}><span><ExportDialog columns={columns} rows={state.rows} defaultFileName="postgres_locks" iconType="download" tableName={t('lock_info_pg_locks')} /></span></Tooltip>
      <Tooltip title={t('pg_lock_cancel_help')}><span><Button size="small" color="warning" disabled={!state.can('cancel')} onClick={() => { void state.command('cancel'); }}>{t('cancel_sql')}</Button></span></Tooltip>
      <Tooltip title={t('pg_lock_terminate_help')}><span><Button size="small" color="error" disabled={!state.can('terminate')} onClick={() => { void state.command('terminate'); }}>{t('pg_lock_terminate')}</Button></span></Tooltip>
    </Stack><Typography variant="caption">{t('pg_lock_scope')} {t('lock_row_count', { shown: state.rows.length, total: state.snapshot?.locks.length || 0 })} / {t('lock_fetched_at')}: {state.snapshot?.fetchedAt || '-'}</Typography></Paper>
    {state.error && <Alert severity="error" action={<Button disabled={busy} onClick={() => { void state.load(); }}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
    {state.notice && <Alert severity="info">{t(state.notice)}</Alert>}
    {state.snapshot?.context.readonly && <Alert severity="info">{t('pg_lock_readonly')}</Alert>}
    {state.snapshot && !state.snapshot.context.protectionReady && <Alert severity="warning">{t('pg_lock_identity_unknown')}</Alert>}
    <Box ref={split.container} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Paper sx={{ height: split.topHeight || '55%', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={state.rows} columns={columns} loading={busy} density="compact"
        rowSelectionModel={state.rows.some(row => row.id === state.selectedId) && state.selectedId ? [state.selectedId] : []} keepNonExistentRowsSelected onRowSelectionModelChange={ids => state.select(ids.length ? String(ids[0]) : null)}
        paginationModel={state.pagination} onPaginationModelChange={state.setPagination} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.ready ? 'pg_lock_no_rows' : 'pg_lock_unconfirmed') }}
        initialState={{ columns: { columnVisibilityModel: { address: false, transactionId: false, query: false, transactionStart: false } } }} /></GridViewport></Paper>
      <Box role="separator" aria-label={t('pg_lock_resize')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio * 100)} tabIndex={0}
        onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key}
        sx={{ height: 8, flexShrink: 0, cursor: 'row-resize', touchAction: 'none', bgcolor: split.dragging ? 'primary.main' : 'divider', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }} />
      <Paper sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap><Typography>{state.selected ? t('pg_lock_selected', { pid: state.selected.pid ?? '-', user: state.selected.username ?? '-', database: state.selected.database ?? '-' }) : t('pg_lock_select')}</Typography>
          {state.blockers.map(blocker => <Tooltip key={blocker.pid} title={t('lock_inspect_blocker_help')}><span><Button size="small" disabled={!state.ready || busy} onClick={() => { if (blocker.pid != null) state.inspectBlocker(blocker.pid); }}>{t('pg_lock_inspect', { pid: blocker.pid })}</Button></span></Tooltip>)}
          <Tooltip title={t('session_copy_sql')}><span><IconButton size="small" aria-label={t('session_copy_sql')} disabled={!state.selected?.query} onClick={() => { void state.copy(); }}><ContentCopyIcon /></IconButton></span></Tooltip>
        </Stack>
        {state.selected && !state.selected.canTerminate && <Typography variant="caption">{t('pg_lock_protected_help')}</Typography>}
        <Typography variant="caption" display="block">{t('pg_lock_detail_help')}</Typography>
        {state.selected && <Typography variant="caption" display="block">{t('pg_lock_details', { start: state.selected.backendStart || '-', transaction: state.selected.transactionStart || '-', event: state.selected.waitEvent || '-', blockers: state.selected.blockers.map(pid => pid === 0 ? t('pg_lock_prepared') : String(pid)).join(', ') || '-' })}</Typography>}
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.8rem' }}>{state.selected?.query || t('pg_lock_sql_unavailable')}</Box>
      </Paper>
    </Box>
  </Box>;
}
