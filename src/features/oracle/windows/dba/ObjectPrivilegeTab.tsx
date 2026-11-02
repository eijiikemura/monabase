// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { DataGrid, type GridColDef, enUS, jaJP } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import { GridViewport } from '@/features/data-grid/GridViewport';
import type { ObjectCategory } from '@/shared/types/objectTypes';
import type { PrivilegePrincipal } from '@/shared/types/objectPrivilegeTypes';
import { useObjectPrivilegeTab } from './useObjectPrivilegeTab';
const categories: readonly ObjectCategory[] = ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'TYPE'];
export default function ObjectPrivilegeTab({ isActive, schemas }: { isActive: boolean; schemas: string[] }) {
  const { t, i18n } = useTranslation();
  const state = useObjectPrivilegeTab(isActive);
  const [picker, setPicker] = useState(false), [search, setSearch] = useState(''), [mode, setMode] = useState('granted'), [maintained, setMaintained] = useState(false);
  const [selected, setSelected] = useState('');
  const detail = state.detail;
  const descriptions: Record<string, string> = {
    ALTER: t('alter_priv'), DELETE: t('delete_priv'), INDEX: t('index_priv'), INSERT: t('insert_priv'),
    REFERENCES: t('references_priv'), SELECT: t('select_priv'), UPDATE: t('update_priv'),
    EXECUTE: t('execute_priv'), DEBUG: t('object_priv_debug_help')
  };
  const rows = useMemo(() => {
    const map = new Map<string, PrivilegePrincipal>((state.principals?.principals || []).map(row => [row.name, row]));
    for (const row of [...(detail?.grants || []), ...(detail?.columnGrants || [])]) {
      if (!map.has(row.grantee)) map.set(row.grantee, { name: row.grantee, kind: 'unknown', maintained: false });
    }
    if (detail && !map.has(detail.object.owner)) map.set(detail.object.owner, { name: detail.object.owner, kind: 'user', maintained: false });
    return [...map.values()].filter(row => {
      const granted = detail?.grants.some(g => g.grantee === row.name) || detail?.columnGrants.some(g => g.grantee === row.name);
      return (mode !== 'granted' || granted) && (maintained || !row.maintained || granted) && row.name.toLowerCase().includes(search.toLowerCase());
    }).sort((a, b) => a.name.localeCompare(b.name)).map(row => ({ ...row, id: row.name }));
  }, [state.principals, detail, mode, maintained, search]);
  const columns: GridColDef<PrivilegePrincipal>[] = [
    { field: 'name', headerName: t('object_priv_recipient'), minWidth: 200, flex: 1, renderCell: p => `${p.row.name}${p.row.name === detail?.object.owner ? ` (${t('owner')})` : ''}` },
    { field: 'kind', headerName: t('object_type'), width: 110, valueFormatter: p => t(p.value === 'user' ? 'object_priv_kind_user' : p.value === 'role' ? 'object_priv_kind_role' : p.value === 'public' ? 'object_priv_kind_public' : 'object_priv_kind_unknown') },
    ...(detail?.privileges || []).map(privilege => ({ field: privilege, headerName: privilege, renderHeader: () => <Tooltip title={descriptions[privilege] || privilege}><Typography variant="caption" fontWeight="bold">{privilege}</Typography></Tooltip>, width: 110, sortable: false, filterable: false,
      renderCell: ({ row }: { row: PrivilegePrincipal }) => {
        const checked = detail?.grants.some(g => g.grantee === row.name && g.privilege === privilege) || false;
        const columnOnly = detail?.columnGrants.some(g => g.grantee === row.name && g.privilege === privilege) || false;
        return <Tooltip title={t(row.name === detail?.object.owner ? 'object_priv_owner_help' : columnOnly ? 'object_priv_column_help' : 'object_priv_cell_help')}><span><Checkbox size="small" checked={checked} indeterminate={columnOnly} disabled={!state.editable(row.name, privilege)} inputProps={{ 'aria-label': `${row.name} ${privilege}` }} onClick={e => e.stopPropagation()} onChange={e => { void state.change(row.name, privilege, e.target.checked); }} /></span></Tooltip>;
      }
    }))
  ];
  return <Box data-testid="object-privilege-tab" aria-busy={state.isLoading} sx={{ display: isActive ? 'flex' : 'none', flexDirection: 'column', flex: 1, height: '100%', minHeight: 0, minWidth: 0, p: 1, gap: 1, overflow: 'hidden' }}>
    <Paper sx={{ p: 1 }}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
      <Button startIcon={<SearchIcon />} disabled={state.isLoading} onClick={() => setPicker(true)}>{t('target_object_2')}</Button>
      <Typography variant="body2">{state.target ? `${state.target.owner}.${state.target.name} (${state.target.type})` : t('please_select_a_target_object')}</Typography>
      <Tooltip title={t('refresh')}><span><IconButton aria-label={t('refresh')} disabled={state.isLoading} onClick={() => { void state.reload(); }}><RefreshIcon /></IconButton></span></Tooltip>
      <TextField size="small" label={t('object_priv_search')} value={search} onChange={e => setSearch(e.target.value)} />
      <TextField select size="small" label={t('target_to_display')} value={mode} onChange={e => setMode(e.target.value)}><MenuItem value="granted">{t('object_priv_granted_only')}</MenuItem><MenuItem value="all">{t('object_priv_all_recipients')}</MenuItem></TextField>
      <FormControlLabel control={<Checkbox checked={maintained} onChange={e => setMaintained(e.target.checked)} />} label={t('object_priv_include_maintained')} />
      <Typography variant="caption">{t('object_priv_count', { count: rows.length })}</Typography>
    </Stack></Paper>
    {state.error && <Alert severity="error" action={<Button disabled={state.isLoading} onClick={() => { void state.reload(); }}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
    {state.applied && <Alert severity={state.ready ? 'success' : 'warning'}>{t(state.ready ? 'object_priv_applied' : 'object_priv_applied_unconfirmed')}</Alert>}
    {(!state.principals?.rolesComplete || detail?.scope === 'visible') && <Alert severity="info">{t('object_priv_limited')}</Alert>}
    {detail?.context.readonly && <Alert severity="info">{t('object_priv_readonly')}</Alert>}
    <Typography variant="caption">{t('object_priv_direct_help')}</Typography>
    <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><GridViewport active={isActive}><DataGrid rows={detail ? rows : []} columns={columns} density="compact" loading={state.isLoading}
      rowSelectionModel={rows.some(row => row.name === selected) ? [selected] : []} onRowSelectionModelChange={values => setSelected(String(values[0] || ''))}
      initialState={{ pagination: { paginationModel: { pageSize: 100 } } }} pageSizeOptions={[25, 50, 100]}
      localeText={{ ...(i18n.language.startsWith('ja') ? jaJP : enUS).components.MuiDataGrid.defaultProps.localeText, noRowsLabel: t(state.ready ? 'object_priv_no_grants' : 'object_priv_unconfirmed') }} /></GridViewport></Paper>
    {detail && selected && rows.some(row => row.name === selected) && <Paper sx={{ p: 1, maxHeight: '30%', overflow: 'auto', flexShrink: 0 }}><Typography variant="subtitle2">{t('object_priv_details', { name: selected })}</Typography>
      {detail.grants.filter(row => row.grantee === selected).map((row, i) => <Typography key={i} variant="body2">{row.privilege} — {t('object_priv_grantor')}: {row.grantor} / {t('object_priv_grantable')}: {row.grantable ? t('yes') : t('no')}{row.hierarchy ? ' / HIERARCHY' : ''}{row.common ? ' / COMMON' : ''}{row.inherited ? ' / INHERITED' : ''}</Typography>)}
      {detail.columnGrants.filter(row => row.grantee === selected).map((row, i) => <Typography key={`column-${i}`} variant="body2">{row.privilege} ({row.column}) — {t('object_priv_grantor')}: {row.grantor} / {t('object_priv_grantable')}: {row.grantable ? t('yes') : t('no')}</Typography>)}
      {selected === detail.object.owner && <Typography variant="body2">{t('object_priv_owner_help')}</Typography>}
    </Paper>}
    <ObjectPickerDialog open={picker} title={t('target_object_2')} dbType="oracle" initialSchema={state.target?.owner || schemas[0] || ''} initialCategory={state.target?.type || 'TABLE'} categories={categories} multiple={false} disabled={state.isLoading} onClose={() => setPicker(false)} onConfirm={objects => {
      const object = objects[0]; if (object) { state.select({ owner: object.schema, name: object.name, type: object.category }); setSelected(''); } setPicker(false);
    }} />
  </Box>;
}
