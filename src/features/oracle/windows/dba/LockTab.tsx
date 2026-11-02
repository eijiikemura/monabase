// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Paper, Typography, IconButton, Tooltip, Button, Alert, TextField, MenuItem, Stack, Divider } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockPersonIcon from '@mui/icons-material/LockPerson';
import { useTranslation } from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { useLockTab } from './useLockTab';

export default function LockTab({ isActive }: { isActive: boolean }) {
  const state = useLockTab(isActive);
  const { t, i18n } = useTranslation();
  const modes = [t('lock_mode_0'), t('lock_mode_1'), t('lock_mode_2'), t('lock_mode_3'), t('lock_mode_4'), t('lock_mode_5'), t('lock_mode_6')];
  const mode = (value: number) => modes[value] ?? String(value);
  const columns: GridColDef[] = [
    { field: 'SID', headerName: 'SID', width: 75 },
    { field: 'SERIAL', headerName: 'SERIAL#', width: 85 },
    { field: 'USERNAME', headerName: t('db_user'), width: 110 },
    { field: 'BLOCKING_SID', headerName: t('lock_waits_for'), width: 125, renderCell: p => p.value ? `${p.row.BLOCKING_INSTANCE}:${p.value}` : '-' },
    { field: 'WAITERS', headerName: t('lock_waiter_count'), width: 110 },
    { field: 'OBJECT_NAME', headerName: t('target_object_2'), minWidth: 180, flex: 1, renderCell: p => p.value ? `${p.row.OBJECT_OWNER}.${p.value}` : t('lock_object_unknown') },
    { field: 'TYPE', headerName: t('lock_type'), width: 80 },
    { field: 'HELD_MODE', headerName: t('keep_mode'), width: 125, valueFormatter: p => mode(Number(p.value)) },
    { field: 'REQUEST_MODE', headerName: t('requested_mode'), width: 125, valueFormatter: p => mode(Number(p.value)) },
    { field: 'HOLD_SECONDS', headerName: t('lock_hold_seconds'), width: 120 },
    { field: 'WAIT_SECONDS', headerName: t('lock_wait_seconds'), width: 120 },
    { field: 'EVENT', headerName: t('lock_wait_event'), width: 200 },
    { field: 'PROGRAM', headerName: t('program'), width: 180 },
    { field: 'OSUSER', headerName: t('os_user'), width: 140 },
    { field: 'MACHINE', headerName: 'MACHINE', width: 160 },
    { field: 'SQL_ID', headerName: 'SQL_ID', width: 140 },
    { field: 'SQL_TEXT', headerName: t('lock_current_sql'), width: 250 },
    { field: 'PREV_SQL_ID', headerName: 'PREV_SQL_ID', width: 140 },
    { field: 'PREV_SQL_TEXT', headerName: t('lock_previous_sql'), width: 250 }
  ];
  const selected = state.selected;
  const busy = state.loading || state.acting;
  return (
    <Box data-testid="lock-tab" aria-busy={busy} sx={{ flex: 1, height: '100%', minWidth: 0, minHeight: 0, display: isActive ? 'flex' : 'none', flexDirection: 'column', p: 1, gap: 1, overflow: 'hidden' }}>
      <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <LockPersonIcon color="action" /><Typography variant="subtitle2" fontWeight="bold">{t('lock_management')}</Typography>
          <TextField size="small" label={t('lock_search')} value={state.search} onChange={e => state.setSearch(e.target.value)} />
          <TextField select size="small" label={t('lock_filter')} value={state.filter} onChange={e => state.setFilter(e.target.value as 'all' | 'waiting' | 'blocking')} sx={{ minWidth: 130 }}>
            <MenuItem value="all">{t('lock_all')}</MenuItem><MenuItem value="waiting">{t('lock_waiting')}</MenuItem><MenuItem value="blocking">{t('lock_blocking')}</MenuItem>
          </TextField>
          <TextField select size="small" label={t('lock_auto_refresh')} value={state.refreshSeconds} onChange={e => state.setRefreshSeconds(Number(e.target.value))} sx={{ minWidth: 130 }}>
            {[0, 5, 10, 30].map(seconds => <MenuItem key={seconds} value={seconds}>{seconds ? t('lock_refresh_seconds', { seconds }) : t('lock_refresh_off')}</MenuItem>)}
          </TextField>
          <Box sx={{ flexGrow: 1 }} />
          <ExportDialog columns={columns} rows={state.rows} defaultFileName="lock_information" iconType="download" tableName={t('lock_management')} />
          <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={busy} onClick={() => { void state.load(); }}><RefreshIcon /></IconButton></span></Tooltip>
          <Tooltip title={t('lock_inspect_blocker_help')}><span><Button size="small" disabled={!state.ready || busy || !state.blocker} onClick={state.inspectBlocker}>{t('lock_inspect_blocker')}</Button></span></Tooltip>
          <Tooltip title={t('lock_kill_help')}><span><Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} disabled={!state.canKill} onClick={() => { void state.killSelected(); }}>{t('lock_kill_selected')}</Button></span></Tooltip>
        </Stack>
        <Typography variant="caption" sx={{ px: 1, pb: 1 }}>{t('lock_scope', { instance: state.snapshot?.context.instance ?? '-', container: state.snapshot?.context.container ?? '-' })} {t('lock_row_count', { shown: state.rows.length, total: state.snapshot?.locks.length ?? 0 })} {state.snapshot && `${t('lock_fetched_at')}: ${new Date(state.snapshot.fetchedAt).toLocaleTimeString(i18n.language)}`}</Typography>
        {state.error && <Alert severity="error" action={<Button disabled={busy} onClick={() => { void state.load(); }}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
        {state.notice && <Alert severity="info">{t(state.notice)}</Alert>}
        {state.snapshot && !state.snapshot.context.canKill && <Alert severity="info">{t(state.snapshot.context.readonly ? 'lock_readonly' : !state.snapshot.context.protectionReady ? 'lock_protection_unavailable' : 'lock_privilege_required')}</Alert>}
        {selected?.protected && <Alert severity="info">{t('lock_session_protected')}</Alert>}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}>
          <DataGrid rows={state.rows} columns={columns} loading={busy} density="compact" rowSelectionModel={state.selectedId ? [state.selectedId] : []} keepNonExistentRowsSelected
            initialState={{ columns: { columnVisibilityModel: { OSUSER: false, MACHINE: false, SQL_ID: false, SQL_TEXT: false, PREV_SQL_ID: false, PREV_SQL_TEXT: false } } }}
            onRowSelectionModelChange={selection => state.select(selection.length ? String(selection[0]) : null)}
            paginationModel={state.pagination} onPaginationModelChange={state.setPagination} pageSizeOptions={[25, 50, 100]}
            localeText={{ ...(i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText, noRowsLabel: t(state.ready ? 'lock_no_rows' : 'lock_unconfirmed') }}
            getRowClassName={p => p.row.REQUEST_MODE > 0 ? 'lock-waiting' : p.row.WAITERS > 0 ? 'lock-blocking' : ''}
            sx={{ border: 0, '& .lock-waiting': { bgcolor: 'action.hover' }, '& .lock-blocking': { fontWeight: 'bold' } }} />
        </GridViewport></Box>
      </Paper>
      {selected && <Paper sx={{ p: 1, maxHeight: '36%', overflow: 'auto', flexShrink: 0 }}>
        <Typography variant="subtitle2">{t('lock_session_detail', { sid: selected.SID, serial: selected.SERIAL })}</Typography>
        <Typography variant="body2">{selected.USERNAME} / {selected.OSUSER} / {selected.MACHINE} / {selected.PROGRAM} / {selected.STATUS}</Typography>
        <Typography variant="body2">{t('lock_resource', { type: selected.TYPE, id1: selected.ID1, id2: selected.ID2 })} — {selected.EVENT} {selected.BLOCKING_SID && `→ ${selected.BLOCKING_INSTANCE}:${selected.BLOCKING_SID}`}</Typography>
        <Typography variant="caption">{t('lock_time_help')} {t('lock_object_help')}</Typography><Divider sx={{ my: 1 }} />
        {(['SQL_TEXT', 'PREV_SQL_TEXT'] as const).map(field => <Box key={field}>
          <Stack direction="row" alignItems="center"><Typography variant="subtitle2">{t(field === 'SQL_TEXT' ? 'lock_current_sql' : 'lock_previous_sql')} ({(field === 'SQL_TEXT' ? selected.SQL_ID : selected.PREV_SQL_ID) || '-'})</Typography>
            <Tooltip title={t(field === 'SQL_TEXT' ? 'lock_copy_current' : 'lock_copy_previous')}><span><IconButton size="small" aria-label={t(field === 'SQL_TEXT' ? 'lock_copy_current' : 'lock_copy_previous')} disabled={!selected[field]} onClick={() => { void state.copySql(selected[field] || ''); }}><ContentCopyIcon fontSize="small" /></IconButton></span></Tooltip>
          </Stack><Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.75rem' }}>{selected[field] || t('lock_sql_unavailable')}</Box>
        </Box>)}
      </Paper>}
    </Box>
  );
}
