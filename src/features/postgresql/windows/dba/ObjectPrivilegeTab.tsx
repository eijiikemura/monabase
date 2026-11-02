// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState, useEffect } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { useTranslation } from 'react-i18next';
import ExportDialog from '@/components/data/ExportDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import type { PgPrivilegePrincipal } from '@/shared/types/postgresPrivilegeTypes';
import { useObjectPrivilegeTab } from './useObjectPrivilegeTab';
import { PrivilegeObjectPicker } from './PrivilegeObjectPicker';
type PrincipalRow = PgPrivilegePrincipal & Record<string, unknown>;
export default function ObjectPrivilegeTabPostgresql({ isActive, schemas, dbName = '', userName = '' }: { isActive: boolean; schemas: string[]; dbName?: string; userName?: string }) {
  const { t, i18n } = useTranslation(), state = useObjectPrivilegeTab(isActive);
  const [picker, setPicker] = useState(false), [search, setSearch] = useState(''), [mode, setMode] = useState('all'), [principalId, setPrincipalId] = useState(''), [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  useEffect(() => { setPagination(previous => ({ ...previous, page: 0 })); }, [search, mode, state.target?.identity]);
  useEffect(() => { if (!isActive) setPicker(false); }, [isActive]);
  const detail = state.detail;
  const roleName = (id: string) => (detail?.principals || state.principals).find(role => role.id === id)?.name || id;
  const access = (id: string, privilege: string) => {
    const direct = detail?.grants.some(grant => grant.grantee_id === id && grant.privilege === privilege) || false;
    const effective = detail?.effective.find(row => row.principal_id === id && row.privilege === privilege);
    const column = detail?.columnGrants.some(grant => grant.grantee_id === id && grant.privilege === privilege) || effective?.column_effective && !effective.effective || false;
    return { direct, effective: effective?.effective || direct, column, sources: effective?.sources || [], schemaUsage: effective?.schema_usage };
  };
  const rows = useMemo<PrincipalRow[]>(() => {
    const roles = detail?.principals || state.principals;
    return roles.filter(role => role.name.toLowerCase().includes(search.toLowerCase())).map(role => {
      const values: Record<string, string> = {};
      for (const privilege of detail?.privileges || []) {
        const direct = detail?.grants.some(grant => grant.grantee_id === role.id && grant.privilege === privilege), effective = detail?.effective.find(row => row.principal_id === role.id && row.privilege === privilege);
        values[privilege] = direct ? t('pg_priv_direct') : effective?.effective ? t('pg_priv_effective') : detail?.columnGrants.some(grant => grant.grantee_id === role.id && grant.privilege === privilege) || effective?.column_effective ? t('pg_priv_column') : t('pg_priv_none');
      }
      return { ...role, ...values };
    }).filter(role => mode === 'all' || (mode === 'direct' ? detail?.grants.some(grant => grant.grantee_id === role.id) || detail?.columnGrants.some(grant => grant.grantee_id === role.id) : detail?.effective.some(row => row.principal_id === role.id && (row.effective || row.column_effective)) || detail?.grants.some(grant => grant.grantee_id === role.id)));
  }, [detail, state.principals, search, mode, t]);
  const selected = rows.find(row => row.id === principalId);
  const columns: GridColDef<PrincipalRow>[] = [
    { field: 'name', headerName: t('role_user_name'), minWidth: 210, flex: 1, renderCell: p => `${p.row.name}${p.row.id === detail?.ownerId ? ` (${t('owner')})` : ''}` },
    { field: 'kind', headerName: t('object_type'), width: 110, valueFormatter: p => t(p.value === 'public' ? 'pg_priv_public' : p.value === 'user' ? 'pg_priv_user' : 'pg_priv_role') },
    ...(detail?.privileges || []).map(privilege => ({ field: privilege, headerName: privilege, width: 115, sortable: false,
      renderCell: ({ row }: { row: PrincipalRow }) => {
        const value = access(row.id, privilege), action = value.direct ? 'revoke' : 'grant';
        return <Tooltip title={t('pg_priv_cell_help', { direct: value.direct ? t('yes') : t('no'), effective: value.effective ? t('yes') : t('no'), column: value.column ? t('yes') : t('no') })}><span><Checkbox size="small" checked={value.direct} indeterminate={!value.direct && (value.effective || value.column)} disabled={!state.editable(row.id, privilege, action)} inputProps={{ 'aria-label': `${row.name} ${privilege}` }} onClick={e => e.stopPropagation()} onChange={() => { setPrincipalId(row.id); state.open(row.id, privilege, action); }} /></span></Tooltip>;
      }
    }))
  ];
  const localeText = (i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText;
  const error = state.error && <Alert severity="error">{t(state.error)} {state.errorCode}</Alert>;
  const draft = state.draft;
  const availableIssuers = draft ? draft.action === 'grant' ? detail?.grantors[draft.privilege] || [] : [...new Set(detail?.grants.filter(grant => grant.grantee_id === draft.principalId && grant.privilege === draft.privilege && grant.canRevoke).map(grant => grant.grantor_id) || [])] : [];
  return <Box data-testid="pg-object-privilege-tab" aria-busy={state.isLoading} sx={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', flex: 1, height: '100%', minHeight: 0, minWidth: 0, p: 1, gap: 0.5 }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Tooltip title={t('pg_priv_pick_help')}><span><Button startIcon={<SearchIcon />} disabled={state.isLoading} onClick={() => setPicker(true)}>{t('target_object_2')}</Button></span></Tooltip>
      <Typography variant="body2">{state.target?.label || t('please_select_a_target_object')}</Typography>
      <TextField size="small" label={t('pg_priv_role_search')} value={search} onChange={e => setSearch(e.target.value)} />
      <TextField select size="small" label={t('target_to_display')} value={mode} onChange={e => setMode(e.target.value)}><MenuItem value="all">{t('all_roles')}</MenuItem><MenuItem value="direct">{t('pg_priv_direct_only')}</MenuItem><MenuItem value="effective">{t('pg_priv_effective_only')}</MenuItem></TextField>
      <Tooltip title={t('refresh_to_latest_state')}><span><IconButton aria-label={t('refresh_to_latest_state')} disabled={state.isLoading} onClick={() => { void state.reload(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <ExportDialog columns={columns} rows={rows} defaultFileName="postgres_object_privileges" iconType="download" tableName={t('object_privileges')} />
    </Stack><Typography variant="caption">{t('pg_priv_matrix_help')} {detail ? `${t('owner')}: ${detail.owner} / ${detail.fetchedAt}` : ''}</Typography></Paper>
    {!state.dialog && error}
    {state.error && !state.dialog && <Button disabled={state.isLoading} onClick={() => { void state.reload(); }}>{t('retry')}</Button>}
    {state.applied && <Alert severity="success">{t('pg_priv_applied')}</Alert>}
    {detail?.context.readonly && <Alert severity="info">{t('pg_priv_readonly')}</Alert>}
    <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={detail ? rows : []} columns={columns} density="compact" loading={state.isLoading}
      rowSelectionModel={selected ? [selected.id] : []} keepNonExistentRowsSelected onRowSelectionModelChange={ids => { if (!state.isLoading) setPrincipalId(ids.length ? String(ids[0]) : ''); }}
      paginationModel={pagination} onPaginationModelChange={setPagination} pageSizeOptions={[25, 50, 100]} localeText={{ ...localeText, noRowsLabel: t(state.ready ? 'pg_priv_empty' : 'pg_priv_unconfirmed') }} /></GridViewport></Paper>
    {selected && detail && <Paper sx={{ p: 1, maxHeight: '34%', overflow: 'auto' }}><Typography variant="subtitle2">{t('pg_priv_details', { name: selected.name })}</Typography>
      <Typography variant="caption">{t('pg_priv_effective_help')}</Typography>
      {detail.privileges.map(privilege => { const value = access(selected.id, privilege); return value.effective || value.column ? <Typography key={privilege} variant="body2">{privilege}: {value.sources.map(roleName).join(', ') || (selected.superuser ? t('pg_priv_superuser') : t('pg_priv_effective'))} / {t('pg_priv_schema_usage')}: {value.schemaUsage == null ? '-' : value.schemaUsage ? t('yes') : t('no')}</Typography> : null; })}
      {detail.grants.filter(grant => grant.grantee_id === selected.id).map(grant => <Stack key={`${grant.grantor_id}:${grant.privilege}`} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="body2">{grant.privilege} / {t('pg_priv_grantor')}: {roleName(grant.grantor_id)} / {t('pg_priv_grant_option')}: {grant.grantable ? t('yes') : t('no')} / {t(grant.source === 'default' ? 'pg_priv_default' : 'pg_priv_direct')}</Typography>
        <Button size="small" disabled={!grant.canRevoke || !state.editable(selected.id, grant.privilege, 'revoke')} onClick={() => state.open(selected.id, grant.privilege, 'revoke', grant.grantor_id)}>{t('revoke')}</Button>
        {grant.grantable && <Button size="small" disabled={!grant.canRevoke || !state.editable(selected.id, grant.privilege, 'revoke')} onClick={() => state.open(selected.id, grant.privilege, 'revoke', grant.grantor_id, true)}>{t('pg_priv_revoke_option')}</Button>}
      </Stack>)}
      {detail.columnGrants.filter(grant => grant.grantee_id === selected.id).map(grant => <Typography key={`${grant.column}:${grant.grantor_id}:${grant.privilege}`} variant="body2">{t('pg_priv_column')}: {grant.column} / {grant.privilege} / {t('pg_priv_grantor')}: {roleName(grant.grantor_id)} / {t('pg_priv_grant_option')}: {grant.grantable ? t('yes') : t('no')}</Typography>)}
    </Paper>}
    <PrivilegeObjectPicker open={picker} schemas={schemas} dbName={dbName} userName={userName} disabled={state.isLoading} onClose={() => setPicker(false)} onSelect={object => { state.select(object); setPicker(false); setPrincipalId(''); }} />
    <Dialog open={state.dialog} onClose={state.close} maxWidth="md" fullWidth><DialogTitle>{t('pg_priv_review_title')}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{error}
      {draft && <><Typography>{draft.object.label} / {roleName(draft.principalId)} / {draft.privilege} / {t(draft.action === 'grant' ? 'grant' : 'revoke')}</Typography>
        <TextField select size="small" label={t('pg_priv_grantor')} value={availableIssuers.includes(draft.grantorId || '') ? draft.grantorId : ''} disabled={state.isLoading} onChange={e => state.update({ grantorId: e.target.value })}>{availableIssuers.map(id => <MenuItem key={id} value={id}>{roleName(id)}</MenuItem>)}</TextField>
        {draft.action === 'grant' ? <FormControlLabel label={t('pg_priv_grant_option')} control={<Checkbox checked={draft.grantOption === true} disabled={state.isLoading || draft.principalId === '0'} onChange={e => state.update({ grantOption: e.target.checked })} />} /> : <FormControlLabel label={t('pg_priv_revoke_option')} control={<Checkbox checked={draft.grantOptionOnly === true} disabled={state.isLoading} onChange={e => state.update({ grantOptionOnly: e.target.checked })} />} />}
        {draft.principalId === '0' && <Alert severity="warning">{t('pg_priv_public_warning')}</Alert>}
      </>}
      <Alert severity="info">{t('pg_priv_transaction_help')} {t('pg_priv_restrict_help')}</Alert>
      {state.review && <>{state.review.affectedColumns.length > 0 && <Alert severity="warning">{t('pg_priv_columns_affected', { columns: state.review.affectedColumns.join(', ') })}</Alert>}<Typography>{t('pg_priv_execute_as', { name: state.review.issuer?.name || state.review.grantor.name })}</Typography><Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.review.sql}</Box><FormControlLabel label={t('pg_priv_acknowledge')} control={<Checkbox disabled={state.isLoading} checked={state.acknowledged} onChange={e => state.setAcknowledged(e.target.checked)} />} /></>}
    </Stack></DialogContent><DialogActions><Button disabled={state.isLoading} onClick={state.close}>{t('cancel')}</Button>{!state.ready && <Button disabled={state.isLoading} onClick={() => { void state.reload(); }}>{t('retry')}</Button>}<Button disabled={!state.ready || !state.peopleReady || state.isLoading} onClick={() => { void state.prepare(); }}>{t('pg_priv_review')}</Button><Button variant="contained" disabled={!state.canExecute} onClick={() => { void state.execute(); }}>{t('execute')}</Button></DialogActions></Dialog>
  </Box>;
}
