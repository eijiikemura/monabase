// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { DataGrid, enUS, jaJP, type GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import { useTranslation } from 'react-i18next';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { mainTransferQuery } from './sidebarDataTransfer';
import { buildCreateMysqlTable, validateColumnType, type NewMysqlColumn } from './sidebarTableActions';
import type { MysqlStatement } from './table/tableModel';
import type { TransactionState } from '@/shared/api/desktopContract';

const blank = (id: number): NewMysqlColumn => ({ id, name: '', type: 'VARCHAR(100)', primary: false, nullable: true, autoIncrement: false, defaultMode: 'none', defaultValue: '', comment: '' });
export default function CreateTableWindow({ schema, active, busy, readonly, setBusy, onState, onCreated }: {
  schema: string; active: boolean; busy: boolean; readonly: boolean; setBusy: (busy: boolean) => void;
  onState: (state: TransactionState) => void; onCreated: (name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(''), [comment, setComment] = useState(''), [error, setError] = useState('');
  const [columns, setColumns] = useState<NewMysqlColumn[]>([]), [editing, setEditing] = useState<NewMysqlColumn | null>(null);
  const [preview, setPreview] = useState<MysqlStatement>(), [attempted, setAttempted] = useState(false);
  const nextId = useRef(1), running = useRef(false), attemptedRef = useRef(false);
  const locked = busy || readonly;
  const clearPreview = () => { setPreview(undefined); setAttempted(false); attemptedRef.current = false; setError(''); };
  const submit = async () => {
    if (running.current || attemptedRef.current || locked || !preview) return;
    running.current = true; attemptedRef.current = true; setBusy(true); setAttempted(true); setError('');
    let created = false;
    try {
      await mainTransferQuery(preview.sql, preview.binds, onState);
      created = true; onCreated(name);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
    finally { running.current = false; setBusy(false); if (!created) window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'TABLE' } })); }
  };
  const gridColumns: GridColDef[] = [
    { field: 'primary', headerName: 'PK', width: 60, renderCell: params => params.value ? 'PK' : '' },
    { field: 'name', headerName: t('column_name'), minWidth: 150, flex: 1 },
    { field: 'type', headerName: t('data_type'), minWidth: 150, flex: 1 },
    { field: 'nullable', headerName: t('allow_nulls'), width: 100 },
    { field: 'autoIncrement', headerName: 'AUTO_INCREMENT', width: 170 },
    { field: 'defaultMode', headerName: t('default_value'), width: 140, renderCell: params => params.row.defaultMode === 'literal' ? params.row.defaultValue : params.row.defaultMode },
    { field: 'comment', headerName: t('comment'), minWidth: 150, flex: 1 },
    { field: '__actions', headerName: t('action'), width: 170, sortable: false, renderCell: params => <Box sx={{ display: 'flex', gap: 1 }}><Button size="small" variant="outlined" disabled={locked} onClick={() => setEditing({ ...params.row })}>{t('edit')}</Button><Button size="small" variant="outlined" color="error" disabled={locked} onClick={() => { setColumns(previous => previous.filter(column => column.id !== params.row.id)); clearPreview(); }}>{t('delete')}</Button></Box> }
  ];
  return <Box data-testid="mysql-create-table" sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
    <Paper sx={{ display: 'flex', gap: 2, alignItems: 'center', p: 2, flexWrap: 'wrap' }}>
      <TextField label={t('table_name')} size="small" value={name} disabled={locked} onChange={event => { setName(event.target.value); clearPreview(); }} />
      <TextField label={t('table_comment_logical_name_etc')} size="small" value={comment} disabled={locked} onChange={event => { setComment(event.target.value); clearPreview(); }} sx={{ flex: 1, minWidth: 200 }} />
      <Button variant="contained" startIcon={<SaveIcon />} disabled={locked || !name || !columns.length} onClick={() => { try { setPreview(buildCreateMysqlTable(schema, name, comment, columns)); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); } }}>{t('create_table')}</Button>
    </Paper>
    {error && <Alert severity="error">{error}</Alert>}
    <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', p: 1, borderBottom: 1, borderColor: 'divider' }}><Typography variant="subtitle2">{t('column_definition_in_memory_edit')}</Typography><Button size="small" variant="outlined" startIcon={<AddIcon />} disabled={locked} onClick={() => setEditing(blank(nextId.current++))}>{t('add_column_2')}</Button></Box>
      <GridViewport active={active}><DataGrid rows={columns} columns={gridColumns} density="compact" disableRowSelectionOnClick pageSizeOptions={[100]} initialState={{ pagination: { paginationModel: { pageSize: 100 } } }} localeText={(i18n.resolvedLanguage || i18n.language).startsWith('ja') ? jaJP.components.MuiDataGrid.defaultProps.localeText : enUS.components.MuiDataGrid.defaultProps.localeText} /></GridViewport>
    </Paper>
    {editing && <Dialog open fullWidth maxWidth="sm" onClose={() => setEditing(null)}>
      <DialogTitle>{t('column_definition')}</DialogTitle><DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField size="small" label={t('column_name')} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} />
        <TextField size="small" label={t('data_type')} value={editing.type} onChange={event => setEditing({ ...editing, type: event.target.value })} helperText={t('mysql_table_add_column_help')} />
        <Box>{(['primary', 'nullable', 'autoIncrement'] as const).map(key => <FormControlLabel key={key} label={key === 'primary' ? 'PK' : key === 'nullable' ? t('allow_nulls') : 'AUTO_INCREMENT'} control={<Checkbox checked={editing[key]} onChange={event => setEditing({ ...editing, [key]: event.target.checked })} />} />)}</Box>
        <TextField select size="small" label={t('default_value')} value={editing.defaultMode} onChange={event => setEditing({ ...editing, defaultMode: event.target.value as NewMysqlColumn['defaultMode'] })}>
          <MenuItem value="none">{t('not_set_2')}</MenuItem><MenuItem value="null">NULL</MenuItem><MenuItem value="literal">{t('value')}</MenuItem><MenuItem value="current-timestamp">CURRENT_TIMESTAMP</MenuItem>
        </TextField>
        {editing.defaultMode === 'literal' && <TextField size="small" label={t('value')} value={editing.defaultValue} onChange={event => setEditing({ ...editing, defaultValue: event.target.value })} />}
        <TextField size="small" label={t('comment')} value={editing.comment} onChange={event => setEditing({ ...editing, comment: event.target.value })} />
      </DialogContent><DialogActions><Button onClick={() => setEditing(null)}>{t('cancel')}</Button><Button variant="contained" onClick={() => {
        try { validateColumnType(editing.type); if (!editing.name) throw new Error(t('enter_column_name')); setColumns(previous => previous.some(column => column.id === editing.id) ? previous.map(column => column.id === editing.id ? editing : column) : [...previous, editing]); setEditing(null); clearPreview(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
      }}>{t('save')}</Button></DialogActions>
    </Dialog>}
    <Dialog open={Boolean(preview)} fullWidth maxWidth="md" onClose={() => { if (!busy) setPreview(undefined); }}><DialogTitle>{t('create_table')}</DialogTitle><DialogContent>
      <Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert><Typography component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{preview?.sql}</Typography><Typography component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview?.binds, null, 2)}</Typography>{error && <Alert severity="error">{error}</Alert>}{attempted && <Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
    </DialogContent><DialogActions><Button disabled={busy} onClick={() => setPreview(undefined)}>{t('close')}</Button><Button variant="contained" disabled={locked || attempted} onClick={() => void submit()}>{t('execute')}</Button></DialogActions></Dialog>
  </Box>;
}
