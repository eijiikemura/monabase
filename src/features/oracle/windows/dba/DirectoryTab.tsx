// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Paper, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Checkbox, FormControlLabel, Alert, Tabs, Tab, Tooltip } from '@mui/material';
import { DataGrid, type GridColDef, type GridPaginationModel, jaJP, enUS } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { WindowLoadingIndicator } from '@/components/feedback/WindowLoadingIndicator';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { useDirectoryTab } from './useDirectoryTab';

const pageSizes = [25, 50, 100];
const directoryId = (row: { name: string }) => row.name;
const grantId = (row: { grantee: string; grantor: string; privilege: string; grantable: boolean }) => JSON.stringify([row.grantee, row.grantor, row.privilege, row.grantable]);
export default function DirectoryTab({ isActive }: { isActive: boolean }) {
  const { t, i18n } = useTranslation(), state = useDirectoryTab(isActive);
  const [tab, setTab] = useState(0), [leftWidth, setLeftWidth] = useState(440), [resizing, setResizing] = useState(false);
  const start = useRef({ x: 0, width: 440 });
  const [directoryPage, setDirectoryPage] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [principalPage, setPrincipalPage] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const [grantPage, setGrantPage] = useState<GridPaginationModel>({ page: 0, pageSize: 50 });
  const locale = (i18n.resolvedLanguage || i18n.language).startsWith('ja') ? jaJP.components.MuiDataGrid.defaultProps.localeText : enUS.components.MuiDataGrid.defaultProps.localeText;
  useEffect(() => {
    if (!resizing) return;
    const previous = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    const move = (event: MouseEvent) => setLeftWidth(Math.max(200, Math.min(window.innerWidth * 0.6, start.current.width + event.clientX - start.current.x)));
    const up = () => setResizing(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = previous; };
  }, [resizing]);
  const columns = useMemo<GridColDef[]>(() => [
    { field: 'name', headerName: t('directory_name'), flex: 1, minWidth: 140 },
    { field: 'path', headerName: t('os_path'), flex: 2, minWidth: 160 }
  ], [t]);
  const kindLabels = { user: t('directory_kind_user'), role: t('directory_kind_role'), public: t('directory_kind_public'), unknown: t('directory_kind_unknown') };
  const principalColumns: GridColDef<(typeof state.principals)[number]>[] = [
    { field: 'name', headerName: t('directory_grantee'), flex: 1.5, minWidth: 130 },
    { field: 'kind', headerName: t('directory_principal_kind'), width: 110, valueFormatter: params => kindLabels[params.value as keyof typeof kindLabels] },
    ...(['READ', 'WRITE'] as const).map(privilege => ({ field: privilege, headerName: privilege, width: 85, sortable: false, filterable: false,
      renderCell: (params: { row: (typeof state.principals)[number] }) => <Tooltip title={t('directory_direct_grant_help')}><span><Checkbox
        inputProps={{ 'aria-label': `${privilege}: ${params.row.name}` }} size="small" indeterminate={!state.detailReady} checked={params.row[privilege].checked}
        disabled={state.isLoading || !state.ready || !params.row[privilege].editable}
        onChange={event => state.changePrivilege(params.row.name, privilege, event.target.checked)} /></span></Tooltip> })),
    { field: 'grantors', headerName: t('directory_grantor'), minWidth: 130, flex: 1 }
  ];
  const grantColumns: GridColDef[] = [
    { field: 'grantee', headerName: t('directory_grantee'), flex: 1, minWidth: 120 },
    { field: 'privilege', headerName: t('directory_privilege'), width: 100 },
    { field: 'grantor', headerName: t('directory_grantor'), flex: 1, minWidth: 120 },
    { field: 'grantable', headerName: t('directory_grantable'), width: 130, type: 'boolean' },
    { field: 'canRevoke', headerName: t('directory_can_revoke'), width: 130, type: 'boolean' }
  ];
  const selection = useMemo(() => state.selected ? [state.selected] : [], [state.selected]);
  const error = state.writeError || state.listError || state.detailError;
  return <Box component="fieldset" disabled={state.isLoading} aria-busy={state.isLoading} data-testid="directory-tab" sx={{ border: 0, m: 0, p: 1, minWidth: 0, minHeight: 0, height: '100%', display: isActive ? 'flex' : 'none', flexDirection: 'column', gap: 1, overflow: 'hidden' }}>
    {state.isLoading && <WindowLoadingIndicator />}
    {error && <Alert severity="error" action={<Button disabled={state.isLoading} onClick={state.reload}>{t('retry')}</Button>}>{t(error)} {state.errorCode}</Alert>}
    {state.applied && <Alert severity="warning">{t('directory_applied_reload_failed')}</Alert>}
    <Alert severity="info">{t('directory_server_help')}</Alert>
    <Box sx={{ display: 'flex', minHeight: 0, minWidth: 0, flex: 1 }}>
      <Paper sx={{ width: leftWidth, maxWidth: '60%', minWidth: 0, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle2">{t('directory_directory')} ({state.directories.length}/{state.list?.directories.length || 0})</Typography>
          <Tooltip title={t('directory_reload_help')}><span><Button disabled={state.isLoading} onClick={state.reload}>{t('reload')}</Button></span></Tooltip>
          <Button disabled={!state.canCreate} startIcon={<AddIcon />} onClick={state.openCreate}>{t('create_new')}</Button>
          <TextField size="small" fullWidth label={t('directory_search')} value={state.search} onChange={event => { state.setSearch(event.target.value); setDirectoryPage(current => ({ ...current, page: 0 })); }} />
        </Box>
        {state.list?.scope === 'visible' && <Alert severity="info">{t('directory_visible_scope')}</Alert>}
        <GridViewport active={isActive}>
          <DataGrid rows={state.directories} getRowId={directoryId} columns={columns} density="compact" localeText={locale}
            rowSelectionModel={selection} keepNonExistentRowsSelected
            onRowSelectionModelChange={value => state.select(typeof value[0] === 'string' ? value[0] : null)}
            paginationModel={directoryPage} onPaginationModelChange={setDirectoryPage} pageSizeOptions={pageSizes} sx={{ border: 0 }} />
        </GridViewport>
      </Paper>
      <Box onMouseDown={event => { if (state.isLoading) return; start.current = { x: event.clientX, width: leftWidth }; setResizing(true); }} sx={{ width: 6, flexShrink: 0, mx: 0.5, cursor: 'col-resize', bgcolor: resizing ? 'primary.main' : 'divider' }} />
      <Paper sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ p: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography sx={{ flex: 1, overflowWrap: 'anywhere' }}>{state.selected || t('please_select_a_directory')}</Typography>
          <Tooltip title={t('directory_replace_help')}><span><Button disabled={!state.canReplace} startIcon={<EditIcon />} onClick={state.openReplace}>{t('directory_change_path')}</Button></span></Tooltip>
          <Tooltip title={t('directory_drop_help')}><span><Button disabled={!state.canDrop} color="error" startIcon={<DeleteOutlineIcon />} onClick={state.drop}>{t('drop_definition')}</Button></span></Tooltip>
        </Box>
        {state.selected && <>
          <Tabs value={tab} onChange={(_, value: number) => setTab(value)} variant="scrollable">
            <Tab label={t('directory_recipients')} /><Tab label={t('directory_grants')} /><Tab label={t('view_information')} />
          </Tabs>
          {state.detailError && !state.detailReady && <Alert severity="warning">{t('directory_privileges_failed')}</Alert>}
          {state.detail?.scope === 'visible' && <Alert severity="info">{t('directory_grants_visible')}</Alert>}
          {state.detail && !state.detail.directory.objectId && <Alert severity="warning">{t('directory_identity_unconfirmed')}</Alert>}
          <Box sx={{ display: tab === 0 ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <Typography variant="caption" sx={{ p: 1 }}>{t('directory_direct_grant_help')}</Typography>
            <Box sx={{ p: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <TextField size="small" label={t('directory_search_grantees')} value={state.principalSearch} onChange={event => { state.setPrincipalSearch(event.target.value); setPrincipalPage(current => ({ ...current, page: 0 })); }} />
              <FormControlLabel control={<Checkbox checked={state.includeMaintained} onChange={event => state.setIncludeMaintained(event.target.checked)} />} label={t('directory_include_maintained')} />
              <Typography variant="caption">{t('directory_recipient_count', { count: state.principals.length })}</Typography>
            </Box>
            {state.list && !state.list.rolesComplete && <Alert severity="info">{t('directory_roles_visible')}</Alert>}
            <GridViewport active={isActive && tab === 0}>
              <DataGrid rows={state.principals} columns={principalColumns} density="compact" localeText={locale} disableRowSelectionOnClick
                paginationModel={principalPage} onPaginationModelChange={setPrincipalPage} pageSizeOptions={pageSizes} sx={{ border: 0 }} />
            </GridViewport>
          </Box>
          <Box sx={{ display: tab === 1 ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
            <GridViewport active={isActive && tab === 1}>
              <DataGrid rows={state.detail?.grants || []} getRowId={grantId} columns={grantColumns} density="compact" localeText={locale} disableRowSelectionOnClick
                paginationModel={grantPage} onPaginationModelChange={setGrantPage} pageSizeOptions={pageSizes} sx={{ border: 0 }} />
            </GridViewport>
          </Box>
          {tab === 2 && <Box sx={{ p: 2, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography>{t('directory_name')}: {state.detail?.directory.name}</Typography>
            <Typography sx={{ overflowWrap: 'anywhere' }}>{t('os_path')}: {state.detail?.directory.path}</Typography>
            <Typography>{t('directory_catalog_owner')}: {state.detail?.directory.owner}</Typography>
            <Alert severity="info">{t('directory_global_help')}</Alert>
            <Typography>{t('directory_session_grants')}</Typography>
            {state.detail?.sessionGrants.map(grant => <Typography key={grantId(grant)}>{grant.privilege}: {grant.grantee} ({grant.grantor})</Typography>)}
            <Typography variant="caption">{t('directory_session_grants_help')}</Typography>
            <Alert severity="warning">{t('directory_ddl_commit')}</Alert>
          </Box>}
        </>}
      </Paper>
    </Box>
    <Dialog open={state.dialog.open} onClose={() => { if (!state.isLoading) state.setDialog(current => ({ ...current, open: false })); }} maxWidth="sm" fullWidth>
      <DialogTitle>{state.dialog.create ? t('create_new_directory') : t('directory_change_path')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <Alert severity="info">{t('directory_server_help')}</Alert>
        <Alert severity="warning">{t('directory_ddl_commit')}</Alert>
        {error && <Alert severity="error" action={<Button disabled={state.isLoading} onClick={state.reload}>{t('retry')}</Button>}>{t(error)} {state.errorCode}</Alert>}
        <TextField required disabled={state.isLoading || !state.dialog.create} label={t('directory_name')} value={state.dialog.name} onChange={event => state.setDialog(current => ({ ...current, name: event.target.value }))} helperText={t('directory_name_help')} />
        {!state.dialog.create && <Typography sx={{ overflowWrap: 'anywhere' }}>{t('directory_previous_path')}: {state.detail?.directory.path}</Typography>}
        <TextField required disabled={state.isLoading} label={t('physical_os_path')} value={state.dialog.path} onChange={event => state.setDialog(current => ({ ...current, path: event.target.value }))} />
        {state.candidate.error && <Alert severity="warning">{t(state.candidate.error)}</Alert>}
        <Typography component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.candidate.sql}</Typography>
      </DialogContent>
      <DialogActions><Button disabled={state.isLoading} onClick={() => state.setDialog(current => ({ ...current, open: false }))}>{t('cancel')}</Button>
        <Button disabled={!state.canSubmit} onClick={state.submit} variant="contained">{state.dialog.create ? t('create') : t('execute')}</Button></DialogActions>
    </Dialog>
  </Box>;
}
