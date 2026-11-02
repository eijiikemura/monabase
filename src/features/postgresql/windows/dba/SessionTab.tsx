// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { compareNumericValues } from '@/shared/utils/numberValues';
import { useDbaSplit } from '@/features/dba/hooks/useDbaSplit';
import { useSessionTab } from './useSessionTab';
export default function SessionTabPostgresql({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation();
  const state = useSessionTab(isActive), split = useDbaSplit(isActive);
  const busy = state.loading || state.acting;
  const numeric = (field: string, label: string): GridColDef => ({ field, headerName: label, width: 145, sortComparator: compareNumericValues, valueFormatter: p => p.value ?? '-' });
  const columns: GridColDef[] = [
    { field: 'pid', headerName: 'PID', width: 80 }, { field: 'database', headerName: t('pg_session_database'), width: 150 },
    { field: 'username', headerName: t('username'), width: 130 },
    { field: 'state', headerName: t('status'), width: 190, renderCell: p => <Typography variant="body2" color={p.value?.startsWith('idle in transaction') ? 'warning.main' : 'text.primary'} fontWeight={p.value?.startsWith('idle in transaction') ? 700 : 400}>{p.value ?? t('pg_session_unknown')}</Typography> },
    { field: 'waitType', headerName: t('pg_session_wait_type'), width: 125 }, { field: 'waitEvent', headerName: t('lock_wait_event'), width: 165 },
    { field: 'blockers', headerName: t('pg_session_blockers'), width: 125, valueFormatter: p => p.value?.join(', ') || '-' },
    numeric('querySeconds', t('pg_session_query_seconds')), numeric('transactionSeconds', t('pg_session_transaction_seconds')), numeric('stateSeconds', t('pg_session_state_seconds')),
    { field: 'program', headerName: t('application_name'), width: 180 }, { field: 'address', headerName: t('client_ip_etc'), width: 150 }, { field: 'port', headerName: t('pg_session_client_port'), width: 100 },
    { field: 'backendStart', headerName: t('pg_session_backend_start'), width: 230 }, { field: 'transactionStart', headerName: t('pg_session_transaction_start'), width: 230 },
    { field: 'queryStart', headerName: t('pg_session_query_start'), width: 230 }, { field: 'stateChangedAt', headerName: t('pg_session_state_changed'), width: 230 },
    { field: 'backendType', headerName: t('pg_session_backend_type'), width: 160 },
    { field: 'protected', headerName: t('pg_session_protection'), width: 110, valueFormatter: p => p.value ? t('pg_session_protected_label') : '' },
    { field: 'query', headerName: t('pg_session_query_text'), width: 300 }
  ];
  const localeText = (i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText;
  const selected = state.selected;
  const filters = { all: t('pg_session_all_states'), active: t('pg_session_active'), 'idle-transaction': t('pg_session_idle_transaction'), waiting: t('pg_session_waiting'), idle: t('pg_session_idle') };
  return <Box data-testid="pg-session-tab" aria-busy={busy} sx={{ display: isActive ? 'flex' : 'none', flex: 1, height: '100%', minHeight: 0, minWidth: 0, flexDirection: 'column', p: 1, gap: 0.5 }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Typography variant="subtitle2">{t('session_management_pg_stat_activity')}</Typography>
      <TextField size="small" label={t('pg_session_search')} value={state.search} onChange={e => state.setSearch(e.target.value)} />
      <TextField select size="small" label={t('pg_session_scope')} value={state.scope} onChange={e => state.setScope(e.target.value === 'all' ? 'all' : 'current')}><MenuItem value="current">{t('pg_session_current_database')}</MenuItem><MenuItem value="all">{t('pg_session_all_databases')}</MenuItem></TextField>
      <TextField select size="small" label={t('pg_session_filter')} value={state.filter} onChange={e => state.setFilter(e.target.value as keyof typeof filters)}>{Object.entries(filters).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField>
      <TextField select size="small" label={t('lock_auto_refresh')} value={state.refreshSeconds} onChange={e => state.setRefreshSeconds(Number(e.target.value))}>{[0, 5, 10, 30].map(seconds => <MenuItem key={seconds} value={seconds}>{seconds ? t('lock_refresh_seconds', { seconds }) : t('lock_refresh_off')}</MenuItem>)}</TextField>
      <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={busy} onClick={() => { void state.load(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <Tooltip title={t('pg_session_export_help')}><span><ExportDialog columns={columns} rows={state.rows} defaultFileName="postgres_sessions" iconType="download" tableName={t('session_list')} /></span></Tooltip>
      <Tooltip title={t('pg_lock_cancel_help')}><span><Button size="small" color="warning" disabled={!state.can('cancel')} onClick={() => { void state.command('cancel'); }}>{t('cancel_query')}</Button></span></Tooltip>
      <Tooltip title={t('pg_lock_terminate_help')}><span><Button size="small" color="error" disabled={!state.can('terminate')} onClick={() => { void state.command('terminate'); }}>{t('kill_connection')}</Button></span></Tooltip>
    </Stack><Typography variant="caption">{t('pg_session_scope_help')} {state.snapshot?.context.database} / {t('lock_row_count', { shown: state.rows.length, total: state.snapshot?.sessions.length || 0 })} / {t('lock_fetched_at')}: {state.snapshot?.fetchedAt || '-'}</Typography></Paper>
    {state.error && <Alert severity="error" action={<Button disabled={busy} onClick={() => { void state.load(); }}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
    {state.notice && <Alert severity="info">{t(state.notice)}</Alert>}
    {state.snapshot?.context.readonly && <Alert severity="info">{t('pg_session_readonly')}</Alert>}
    {state.snapshot && !state.snapshot.context.protectionReady && <Alert severity="warning">{t('pg_session_identity_unknown')}</Alert>}
    <Box ref={split.container} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Paper sx={{ height: split.topHeight || '55%', flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={state.rows} columns={columns} loading={busy} density="compact"
        rowSelectionModel={state.rows.some(row => row.id === state.selectedId) && state.selectedId ? [state.selectedId] : []} keepNonExistentRowsSelected onRowSelectionModelChange={ids => state.select(ids.length ? String(ids[0]) : null)}
        paginationModel={state.pagination} onPaginationModelChange={state.setPagination} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.ready ? 'pg_session_no_rows' : 'pg_session_unconfirmed') }}
        initialState={{ columns: { columnVisibilityModel: { port: false, backendStart: false, transactionStart: false, queryStart: false, stateChangedAt: false, query: false } } }} /></GridViewport></Paper>
      <Box role="separator" aria-label={t('pg_session_resize')} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split.ratio * 100)} tabIndex={0}
        onPointerDown={split.start} onPointerMove={split.move} onPointerUp={split.stop} onPointerCancel={split.stop} onLostPointerCapture={split.stop} onKeyDown={split.key}
        sx={{ height: 8, flexShrink: 0, cursor: 'row-resize', touchAction: 'none', bgcolor: split.dragging ? 'primary.main' : 'divider', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }} />
      <Paper sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}>
        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap><Typography variant="subtitle2">{selected ? t('pg_session_selected', { pid: selected.pid, user: selected.username || '-', database: selected.database || '-' }) : t('pg_session_select')}</Typography>
          {state.blockers.map(blocker => <Tooltip key={blocker.pid} title={t('lock_inspect_blocker_help')}><span><Button size="small" disabled={!state.ready || busy} onClick={() => state.inspectBlocker(blocker.pid)}>{t('pg_session_inspect', { pid: blocker.pid })}</Button></span></Tooltip>)}
          <Tooltip title={t('session_copy_sql')}><span><IconButton size="small" aria-label={t('session_copy_sql')} disabled={!selected?.query} onClick={() => { void state.copy(); }}><ContentCopyIcon /></IconButton></span></Tooltip>
        </Stack>
        {selected && !selected.canTerminate && <Typography variant="caption" display="block">{t('pg_session_protection_help')}</Typography>}
        {selected?.state?.startsWith('idle in transaction') && <Alert severity="warning">{t('pg_session_idle_warning')}</Alert>}
        <Typography variant="caption" display="block">{t('pg_session_timing_help')}</Typography>
        {selected && <Typography variant="caption" display="block">{t('pg_session_details', { start: selected.backendStart || '-', transaction: selected.transactionStart || '-', query: selected.queryStart || '-', state: selected.stateChangedAt || '-' })}</Typography>}
        <Typography variant="subtitle2" sx={{ mt: 1 }}>{t(selected?.state === 'active' ? 'pg_session_current_sql' : 'pg_session_last_sql')}</Typography>
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.8rem' }}>{selected?.query || t(selected?.queryVisibility === 'restricted' ? 'pg_session_query_restricted' : selected?.queryVisibility === 'disabled' ? 'pg_session_query_disabled' : 'pg_session_query_unavailable')}</Box>
      </Paper>
    </Box>
  </Box>;
}
