// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SettingsIcon from '@mui/icons-material/Settings';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyIcon from '@mui/icons-material/Key';
import { useTranslation } from 'react-i18next';
import { GridViewport } from '@/features/data-grid/GridViewport';
import type { ManagedPdb, PdbAction } from '@/shared/types/pdbTypes';
import { usePdbManagerTab } from './usePdbManagerTab';
export default function PdbManagerTab({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation();
  const state = usePdbManagerTab(isActive);
  const actions = [
    { action: 'create' as const, label: t('create_new'), description: t('pdb_create_help'), icon: <AddIcon /> },
    { action: 'plugin' as const, label: t('plug_in'), description: t('pdb_plugin_help'), icon: <FileUploadIcon /> },
    { action: 'open' as const, label: t('open_startup'), description: t('pdb_open_help'), icon: <PlayArrowIcon /> },
    { action: 'close' as const, label: t('close_shutdown'), description: t('pdb_close_help'), icon: <StopIcon /> },
    { action: 'mode' as const, label: t('change_mode'), description: t('pdb_mode_help'), icon: <SettingsIcon /> },
    { action: 'clone' as const, label: t('clone_pluggable_database'), description: t('pdb_clone_help'), icon: <ContentCopyIcon /> },
    { action: 'password' as const, label: t('pdb_local_password'), description: t('pdb_password_help'), icon: <KeyIcon /> },
    { action: 'unplug' as const, label: t('unplug'), description: t('pdb_unplug_help'), icon: <FileDownloadIcon /> },
    { action: 'drop' as const, label: t('delete'), description: t('pdb_drop_help'), icon: <DeleteOutlineIcon /> }
  ];
  const label = (action: PdbAction) => actions.find(item => item.action === action)?.label || action;
  const columns: GridColDef<ManagedPdb>[] = [
    { field: 'conId', headerName: 'CON_ID', width: 85 }, { field: 'name', headerName: t('pdb_name'), minWidth: 180, flex: 1 },
    { field: 'status', headerName: t('status_2'), width: 130 }, { field: 'openMode', headerName: t('open_mode'), width: 140, valueFormatter: p => p.value || t('pdb_unknown') },
    { field: 'restricted', headerName: t('limits'), width: 100, valueFormatter: p => p.value || t('pdb_unknown') },
    { field: 'sizeMb', headerName: t('size_mb'), type: 'number', width: 130 },
    { field: 'protected', headerName: t('pdb_protection'), width: 120, valueFormatter: p => p.value ? t('pdb_protected_label') : '' },
    { field: 'id', headerName: 'GUID', width: 280 }, { field: 'dbid', headerName: 'DBID', width: 150 }
  ];
  const draft = state.draft, review = state.review;
  return <Box data-testid="pdb-manager-tab" aria-busy={state.isLoading} sx={{ display: isActive ? 'flex' : 'none', flex: 1, height: '100%', minHeight: 0, minWidth: 0, flexDirection: 'column', p: 1, gap: 1, overflow: 'hidden' }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
      <Typography variant="subtitle1">{t('pluggable_database_pdb_management')}</Typography>
      <Tooltip title={t('refresh_list')}><span><IconButton aria-label={t('refresh_list')} disabled={state.isLoading} onClick={() => { void state.reload(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <TextField size="small" label={t('pdb_search')} value={state.search} onChange={e => state.setSearch(e.target.value)} />
      <Typography variant="caption">{t('pdb_count', { count: state.rows.length })}</Typography>
      {actions.map(item => <Tooltip key={item.action} title={item.description}><span><Button size="small" startIcon={item.icon} color={item.action === 'drop' ? 'error' : 'primary'} disabled={!state.can(item.action, item.action === 'create' || item.action === 'plugin' && state.selected?.status !== 'UNPLUGGED' ? null : state.selected)} onClick={() => { void state.open(item.action, item.action === 'create' || item.action === 'plugin' && state.selected?.status !== 'UNPLUGGED' ? null : state.selected); }}>{item.label}</Button></span></Tooltip>)}
    </Stack></Paper>
    {state.error && <Alert severity="error" action={<Button disabled={state.isLoading} onClick={() => { void state.reload(); }}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
    {state.stage !== 'not_started' && <Alert severity={state.stage !== 'applied' || !state.ready ? 'warning' : 'success'}>{t(state.stage === 'outcome_unknown' ? 'pdb_outcome_unknown' : state.stage === 'catalog_removed' ? 'pdb_catalog_removed' : state.ready ? 'pdb_applied' : 'pdb_applied_unconfirmed')}</Alert>}
    <Typography variant="caption">{t('pdb_management_scope')}</Typography>
    {state.snapshot && <Typography variant="caption">{state.snapshot.context.database} / {state.snapshot.context.instance} / {state.snapshot.context.user} — {t('pdb_main_preserved')}</Typography>}
    {state.snapshot?.context.readonly && <Alert severity="info">{t('pdb_readonly')}</Alert>}
    {state.selected?.protected && <Alert severity="info">{t('pdb_protected')}</Alert>}
    <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={state.rows} columns={columns} density="compact" loading={state.isLoading}
      rowSelectionModel={state.rows.some(row => row.id === state.selectedId) ? [state.selectedId] : []} onRowSelectionModelChange={selection => { if (!state.isLoading) state.setSelectedId(String(selection[0] || '')); }}
      initialState={{ pagination: { paginationModel: { pageSize: 100 } }, columns: { columnVisibilityModel: { id: false, dbid: false } } }} pageSizeOptions={[25, 50, 100]}
      localeText={{ ...(i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText, noRowsLabel: t(state.ready ? 'pdb_no_rows' : 'pdb_unconfirmed') }} /></GridViewport></Paper>
    <Dialog open={state.dialog} onClose={() => state.close()} maxWidth="md" fullWidth><DialogTitle>{label(draft.action)}{draft.target ? ` — ${draft.target}` : ''}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {state.error && <Alert severity="error">{t(state.error)} {state.errorCode}</Alert>}
        {state.stage === 'catalog_removed' && <Alert severity="warning">{t('pdb_catalog_removed')}</Alert>}
        {!state.ready && <Button disabled={state.isLoading} onClick={() => { void state.reload(); }}>{t('retry')}</Button>}
        {['create', 'clone', 'plugin'].includes(draft.action) && <TextField size="small" label={t('pluggable_database_name')} disabled={state.isLoading} value={draft.name || ''} onChange={e => state.update({ name: e.target.value })} helperText={t('pdb_name_help')} />}
        {draft.action === 'create' && <TextField size="small" label={t('admin_username')} disabled={state.isLoading} value={draft.user || ''} onChange={e => state.update({ user: e.target.value })} />}
        {draft.action === 'password' && <TextField select size="small" label={t('username_target')} disabled={state.isLoading || !state.detail} value={draft.user || ''} onChange={e => state.update({ user: e.target.value })}>
          <MenuItem value="">{t('pdb_select_user')}</MenuItem>{state.detail?.users.map(user => <MenuItem key={user} value={user}>{user}</MenuItem>)}
        </TextField>}
        {['create', 'password'].includes(draft.action) && <TextField size="small" label={t('new_password')} type="password" autoComplete="new-password" disabled={state.isLoading} value={draft.password} onChange={e => state.setDraft(previous => ({ ...previous, password: e.target.value }))} helperText={t('pdb_password_rules')} />}
        {['create', 'clone'].includes(draft.action) && <>
          <TextField select size="small" label={t('pdb_storage_mode')} disabled={state.isLoading} value={draft.pathMode} onChange={e => state.update({ pathMode: e.target.value === 'convert' ? 'convert' : 'omf' })}><MenuItem value="omf" disabled={!state.snapshot?.context.omf}>{t('pdb_omf')}</MenuItem><MenuItem value="convert">{t('convert_data_file_paths')}</MenuItem></TextField>
          {draft.pathMode === 'convert' && <><Typography variant="caption">{t('pdb_paths_help')}</Typography>{(draft.conversions || []).map((pair, index) => <Stack key={index} direction="row" spacing={1}>
            <TextField size="small" label={t('pdb_source_prefix')} disabled={state.isLoading} fullWidth value={pair.source} onChange={e => state.update({ conversions: draft.conversions?.map((value, i) => i === index ? { ...value, source: e.target.value } : value) })} />
            <TextField size="small" label={t('pdb_destination_prefix')} disabled={state.isLoading} fullWidth value={pair.destination} onChange={e => state.update({ conversions: draft.conversions?.map((value, i) => i === index ? { ...value, destination: e.target.value } : value) })} />
            <Button disabled={state.isLoading} onClick={() => state.update({ conversions: draft.conversions?.filter((_, i) => i !== index) })}>{t('delete')}</Button>
          </Stack>)}<Button disabled={state.isLoading || (draft.conversions?.length || 0) >= 50} onClick={() => state.update({ conversions: [...(draft.conversions || []), { source: '', destination: '' }] })}>{t('pdb_add_conversion')}</Button></>}
        </>}
        {['plugin', 'unplug'].includes(draft.action) && <TextField size="small" label={t('metadata_xml_file_path')} disabled={state.isLoading} value={draft.path || ''} onChange={e => state.update({ path: e.target.value })} helperText={t('pdb_server_path')} />}
        {draft.action === 'mode' && <TextField select size="small" label={t('open_mode')} disabled={state.isLoading} value={draft.mode} onChange={e => state.update({ mode: e.target.value === 'READ ONLY' ? 'READ ONLY' : 'READ WRITE' })}><MenuItem value="READ WRITE">READ WRITE</MenuItem><MenuItem value="READ ONLY">READ ONLY</MenuItem></TextField>}
        {draft.action === 'create' && state.snapshot?.seedFiles.map(file => <Typography key={file} variant="caption" sx={{ overflowWrap: 'anywhere' }}>{file}</Typography>)}
        {state.detail?.files.length ? <Box><Typography variant="subtitle2">{t('pdb_datafiles')}</Typography>{state.detail.files.map(file => <Typography variant="caption" display="block" key={file} sx={{ overflowWrap: 'anywhere' }}>{file}</Typography>)}</Box> : null}
        {review && <Paper variant="outlined" sx={{ p: 1 }}><Typography variant="subtitle2">{t('pdb_review')}</Typography>
          <Typography variant="body2">{review.request.target || review.request.name} / {label(draft.action)}</Typography>
          {review.stages.map((item, i) => <Typography key={item} variant="body2">{i + 1}. {t(item === 'remove_catalog' ? 'pdb_step_remove' : item === 'attach' ? 'pdb_step_attach' : 'pdb_step_execute')}</Typography>)}
          {review.datafiles.map(file => <Typography key={file} variant="caption" display="block">{file}</Typography>)}
          {review.compatibility && <Alert severity={review.compatibility.compatible ? 'success' : 'error'}>{t(review.compatibility.compatible ? 'pdb_compatible' : 'pdb_incompatible')}</Alert>}
          {review.compatibility?.violations.map((row, i) => <Typography key={i} variant="body2">{row.type}: {row.message} — {row.action}</Typography>)}
          <Alert severity={['drop', 'close', 'plugin', 'unplug'].includes(draft.action) ? 'warning' : 'info'}>{t(draft.action === 'drop' ? review.target?.status === 'UNPLUGGED' ? 'pdb_keep_warning' : 'pdb_delete_warning' : draft.action === 'close' ? 'pdb_close_warning' : draft.action === 'plugin' ? 'pdb_attach_warning' : 'pdb_ddl_warning')}</Alert>
          {state.confirmRequired && <TextField size="small" fullWidth label={t('pdb_confirm_name', { name: state.confirmTarget })} disabled={state.isLoading} value={draft.confirmName} onChange={e => state.setDraft(previous => ({ ...previous, confirmName: e.target.value }))} sx={{ mt: 1 }} />}
          <FormControlLabel control={<Checkbox disabled={state.isLoading || !review.canExecute} checked={draft.acknowledged} onChange={e => state.setDraft(previous => ({ ...previous, acknowledged: e.target.checked }))} />} label={t('pdb_acknowledge')} />
        </Paper>}
      </DialogContent><DialogActions><Button disabled={state.isLoading} onClick={state.close}>{t('cancel')}</Button><Button disabled={state.isLoading || !state.ready} onClick={() => { void state.prepare(); }}>{t('pdb_review')}</Button><Button variant="contained" disabled={!state.canExecute} onClick={() => { void state.execute(); }}>{t('execute')}</Button></DialogActions>
    </Dialog>
  </Box>;
}
