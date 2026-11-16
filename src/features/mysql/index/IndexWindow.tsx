// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, List, ListItemButton, ListItemText, MenuItem, Paper, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, enUS, jaJP, type GridColDef } from '@mui/x-data-grid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import CodeMirror from '@uiw/react-codemirror';
import { sql, MySQL } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { IndexTablePicker } from '@/features/index/IndexTablePicker';
import { IndexColumnOrder } from '@/features/index/IndexColumnOrder';
import WorkspaceDivider from '@/components/navigation/WorkspaceDivider';
import { createIndexStatement } from './indexModel';
import { useMysqlIndex, type MysqlIndexProps } from './useMysqlIndex';

const extensions = [sql({ dialect: MySQL })];
export default function IndexWindow(props: MysqlIndexProps) {
  const { t, i18n } = useTranslation();
  const c = useMysqlIndex(props), { form, details } = c;
  const [tab, setTab] = useState(0), [selected, setSelected] = useState<string[]>([]), [expression, setExpression] = useState(''), [confirmName, setConfirmName] = useState('');
  const [consoleOpen, setConsoleOpen] = useState(true), [consoleWidth, setConsoleWidth] = useState(320);
  const [resizing, setResizing] = useState(false), [availableSelection, setAvailableSelection] = useState<string[]>([]);
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (props.request) { setTab(0); setConfirmName(''); } }, [props.request]);
  useEffect(() => { if (props.request?.kind === 'rename' && !c.loading) { nameInput.current?.focus(); nameInput.current?.select(); } }, [props.request, c.loading]);
  const newIndex = !props.object, locked = props.busy || props.readonly || c.loading;
  const keyName = (part: typeof form.parts[number]) => part.column || part.expression;
  const selectedColumns = form.parts.map(keyName);
  const move = (direction: -1 | 1) => {
    const index = selected.length === 1 ? selectedColumns.indexOf(selected[0]) : -1;
    if (!newIndex || locked || index < 0 || index + direction < 0 || index + direction >= form.parts.length) return;
    const parts = [...form.parts]; [parts[index], parts[index + direction]] = [parts[index + direction], parts[index]]; c.update({ parts });
  };
  const select = (event: React.MouseEvent, name: string) => setSelected(previous => {
    if (event.shiftKey && previous.length) {
      const a = selectedColumns.indexOf(previous[0]), b = selectedColumns.indexOf(name);
      return selectedColumns.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    return event.ctrlKey || event.metaKey ? previous.includes(name) ? previous.filter(value => value !== name) : [...previous, name] : [name];
  });
  const available = c.columns.filter(column => !form.parts.some(part => part.column === column.COLUMN_NAME));
  const selectAvailable = (event: React.MouseEvent, name: string) => setAvailableSelection(previous => {
    if (event.shiftKey && previous.length) {
      const a = available.findIndex(column => column.COLUMN_NAME === previous[0]), b = available.findIndex(column => column.COLUMN_NAME === name);
      return available.slice(Math.min(a, b), Math.max(a, b) + 1).map(column => column.COLUMN_NAME);
    }
    return event.ctrlKey || event.metaKey ? previous.includes(name) ? previous.filter(value => value !== name) : [...previous, name] : [name];
  });
  const addColumns = (names: string[]) => {
    const parts = available.filter(column => names.includes(column.COLUMN_NAME)).map(column => ({ column: column.COLUMN_NAME, expression: '', prefix: '', descending: false }));
    if (!newIndex || locked || !parts.length) return;
    c.update({ parts: [...form.parts, ...parts] }); setAvailableSelection([]);
  };
  const source = useMemo(() => {
    if (!newIndex) return details?.ddl || '';
    try { return createIndexStatement(form, c.columns).sql + ';'; } catch { return ''; }
  }, [newIndex, details, form, c.columns]);
  const columns: GridColDef[] = [
    { field: 'SEQ_IN_INDEX', headerName: '#', width: 60 },
    { field: 'COLUMN_NAME', headerName: t('column_name'), minWidth: 150, flex: 1 },
    { field: 'EXPRESSION', headerName: t('mysql_index_expression'), minWidth: 180, flex: 1 },
    { field: 'CARDINALITY', headerName: t('mysql_index_cardinality'), width: 180 },
    { field: 'SUB_PART', headerName: t('prefix'), width: 100 },
    { field: 'COLLATION', headerName: t('mysql_index_sort_order'), width: 100 },
    { field: 'INDEX_TYPE', headerName: t('type_2'), width: 110 },
    { field: 'IS_VISIBLE', headerName: t('visible'), width: 100 }
  ];
  const copy = async (value: string) => { try { if (!await ipcRenderer.invoke('copy-to-clipboard', value)) window.alert(t('cell_value_copy_failed')); } catch { window.alert(t('cell_value_copy_failed')); } };
  return <Box data-testid="mysql-index-window" sx={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
    <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_event, value: number) => setTab(value)} sx={{ flex: 1 }}>{['edit', 'statistics', 'source'].map(key => <Tab key={key} label={t(key)} />)}</Tabs>
        <Tooltip title={t('refresh_to_latest_state')}><span><Button size="small" variant="outlined" startIcon={<RefreshIcon />} disabled={props.busy || c.loading || !form.table} onClick={() => void c.load()}>{t('refresh')}</Button></span></Tooltip>
        <Button size="small" sx={{ mx: 1 }} onClick={() => setConsoleOpen(value => !value)}>{t('console')}</Button>
      </Box>
      {c.loading && <Alert severity="info" role="status">{t('loading')}</Alert>}
      {c.error && <Alert severity="error" action={<Button disabled={props.busy || c.loading} onClick={() => void c.load()}>{t('retry')}</Button>}>{c.error}</Alert>}
      {tab === 0 && <Box sx={{ flex: 1, overflow: 'auto', p: 3 }}>
        <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}><Typography variant="h6">{t(newIndex ? 'create_index_index' : 'edit_index')}</Typography><Box sx={{ display: 'flex', gap: 1 }}>
            {!newIndex && <Tooltip title={t('delete')}><span><Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} disabled={c.blocked || details?.primary || Boolean(details?.references.length)} onClick={() => { setConfirmName(''); c.prepare(true); }}>{t('delete')}</Button></span></Tooltip>}
            <Tooltip title={t(newIndex ? 'create' : 'change')}><span><Button variant="contained" color="success" startIcon={<PlayArrowIcon />} disabled={c.blocked || !form.name || !form.parts.length || details?.primary} onClick={() => c.prepare()}>{t(newIndex ? 'create' : 'change')}</Button></span></Tooltip>
          </Box></Box><Divider />
          {!newIndex && <Alert severity="info">{t('mysql_index_edit_help')}</Alert>}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}><TextField size="small" label={t('schema')} value={form.schema} disabled /><TextField size="small" label={t('index_name')} inputRef={nameInput} value={form.name} disabled={locked || details?.primary || Boolean(details && form.visible !== details.visible)} onChange={event => c.update({ name: event.target.value })} sx={{ flex: 1, minWidth: 160 }} /></Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}><Typography>{t('table_2')}</Typography><IndexTablePicker database="mysql" schema={form.schema} table={form.table} disabled={!newIndex || locked} onChange={table => { setSelected([]); setAvailableSelection([]); c.update({ table }); }} />
            <TextField select label={t('type_2')} size="small" value={form.type} disabled={!newIndex || locked} onChange={event => c.update({ type: event.target.value as typeof form.type, unique: false, visible: true })}>{(form.type === 'HASH' ? ['BTREE', 'FULLTEXT', 'SPATIAL', 'HASH'] : ['BTREE', 'FULLTEXT', 'SPATIAL']).map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}</TextField>
            <FormControlLabel label={t('unique')} control={<Checkbox checked={form.unique} disabled={!newIndex || locked || form.type !== 'BTREE'} onChange={event => c.update({ unique: event.target.checked })} />} />
            <FormControlLabel label={t('visible')} control={<Checkbox checked={form.visible} disabled={locked || details?.primary || Boolean(props.object && form.name !== props.object.name) || form.type !== 'BTREE' || Boolean(details?.references.length)} onChange={event => c.update({ visible: event.target.checked })} />} />
          </Box>
          {details?.primary && <Alert severity="info">{t('mysql_index_primary_help')}</Alert>}
          {Boolean(details?.references.length) && <Alert severity="warning">{t('mysql_index_foreign_keys', { names: details?.references.join(', ') })}</Alert>}
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Paper variant="outlined" sx={{ flex: 1, minWidth: 200 }}><Typography sx={{ p: 1, bgcolor: 'action.hover' }}>{t('mysql_index_available_columns')}</Typography><List dense sx={{ maxHeight: 260, overflow: 'auto' }}>{available.map(column => <ListItemButton key={column.COLUMN_NAME} selected={availableSelection.includes(column.COLUMN_NAME)} disabled={!newIndex || locked} onClick={event => selectAvailable(event, column.COLUMN_NAME)} onDoubleClick={() => addColumns([column.COLUMN_NAME])}><ListItemText primary={column.COLUMN_NAME} secondary={column.COLUMN_TYPE} /><Tooltip title={t('add')}><IconButton aria-label={t('add') + ' ' + column.COLUMN_NAME} size="small" disabled={!newIndex || locked} onClick={event => { event.stopPropagation(); addColumns([column.COLUMN_NAME]); }}><AddIcon fontSize="small" /></IconButton></Tooltip></ListItemButton>)}</List></Paper>
            {newIndex && <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
              <Tooltip title={t('mysql_index_add_selected')}><span><IconButton aria-label={t('mysql_index_add_selected')} disabled={locked || !availableSelection.some(name => available.some(column => column.COLUMN_NAME === name))} onClick={() => addColumns(availableSelection)}><ChevronRightIcon /></IconButton></span></Tooltip>
              <Tooltip title={t('mysql_index_remove_selected')}><span><IconButton aria-label={t('mysql_index_remove_selected')} disabled={locked || !selected.some(name => selectedColumns.includes(name))} onClick={() => { c.update({ parts: form.parts.filter(part => !selected.includes(keyName(part))) }); setSelected([]); }}><ChevronLeftIcon /></IconButton></span></Tooltip>
            </Box>}
            <Paper variant="outlined" sx={{ flex: 1, minWidth: 240 }}><Typography sx={{ p: 1, bgcolor: 'action.hover' }}>{t('index_target_columns')}</Typography><IndexColumnOrder columns={selectedColumns} selected={selected} disabled={!newIndex || locked} onMove={move} /><List dense sx={{ maxHeight: 260, overflow: 'auto' }}>{form.parts.map((part, i) => <ListItemButton key={keyName(part)} selected={selected.includes(keyName(part))} onClick={event => select(event, keyName(part))} sx={{ gap: 1 }}><ListItemText primary={keyName(part)} />
              <TextField size="small" label={t('prefix')} value={part.prefix} sx={{ width: 85 }} disabled={!newIndex || locked || Boolean(part.expression) || form.type !== 'BTREE'} onClick={event => event.stopPropagation()} onChange={event => c.update({ parts: form.parts.map((value, index) => index === i ? { ...value, prefix: event.target.value } : value) })} />
              <FormControlLabel label="DESC" control={<Checkbox size="small" checked={part.descending} disabled={!newIndex || locked || form.type !== 'BTREE'} onClick={event => event.stopPropagation()} onChange={event => c.update({ parts: form.parts.map((value, index) => index === i ? { ...value, descending: event.target.checked } : value) })} />} />
              {newIndex && <Tooltip title={t('delete')}><IconButton size="small" aria-label={t('delete') + ' ' + keyName(part)} disabled={locked} onClick={event => { event.stopPropagation(); c.update({ parts: form.parts.filter((_value, index) => index !== i) }); }}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>}
            </ListItemButton>)}</List></Paper>
          </Box>
          {newIndex && <Box sx={{ display: 'flex', gap: 1 }}><TextField size="small" label={t('mysql_index_expression')} placeholder="LOWER(`email`)" value={expression} disabled={locked || !c.columns.length || form.type !== 'BTREE'} onChange={event => setExpression(event.target.value)} sx={{ flex: 1 }} /><Button variant="outlined" startIcon={<AddIcon />} disabled={locked || !c.columns.length || !expression.trim() || form.type !== 'BTREE' || selectedColumns.includes(expression.trim())} onClick={() => { c.update({ parts: [...form.parts, { column: '', expression: expression.trim(), prefix: '', descending: false }] }); setExpression(''); }}>{t('add')}</Button></Box>}
          <Typography variant="caption" color="text.secondary">{t('mysql_index_native_help')}</Typography>
        </Paper>
      </Box>}
      {tab === 1 && <Box sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}><Alert severity="info">{t('mysql_index_statistics_help')}</Alert><GridViewport active={props.active}><DataGrid rows={(details?.keys || []).map((row, id) => ({ ...row, id }))} columns={columns} density="compact" hideFooter disableRowSelectionOnClick localeText={(i18n.resolvedLanguage || i18n.language).startsWith('ja') ? jaJP.components.MuiDataGrid.defaultProps.localeText : enUS.components.MuiDataGrid.defaultProps.localeText} /></GridViewport></Box>}
      {tab === 2 && <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}><Typography variant="subtitle2">{t('create_index_statement_ddl')}</Typography><Tooltip title={t('copy')}><IconButton aria-label={t('copy')} size="small" disabled={!source} onClick={() => void copy(source)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip></Box><Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}><CodeMirror value={source} height="100%" style={{ height: '100%' }} extensions={extensions} readOnly theme={props.theme === 'dark' ? 'dark' : 'light'} /></Box></Box>}
    </Box>
    {consoleOpen && <><WorkspaceDivider label={t('console')} value={consoleWidth} min={220} max={window.innerWidth / 2} reverse onChange={setConsoleWidth} onMouseDown={event => { event.preventDefault(); setResizing(true); }} /><Paper square sx={{ width: consoleWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}><Box sx={{ p: 1, display: 'flex', justifyContent: 'space-between' }}><Typography>{t('console')}</Typography><Tooltip title={t('clear_log')}><IconButton size="small" aria-label={t('clear_log')} onClick={c.clearLogs}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip></Box><Divider /><Box sx={{ overflow: 'auto', p: 1 }}>{c.logs.length ? c.logs.map((log, i) => <Box key={i} sx={{ mb: 2 }}><Typography variant="caption">[{log.time}] {log.message}</Typography><Typography component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{log.sql}</Typography></Box>) : <Typography variant="body2" color="text.secondary">{t('no_execution_logs')}</Typography>}</Box></Paper></>}
    {resizing && <Box onMouseMove={event => setConsoleWidth(Math.max(220, Math.min(window.innerWidth / 2, window.innerWidth - event.clientX)))} onMouseUp={() => setResizing(false)} onMouseLeave={() => setResizing(false)} sx={{ position: 'fixed', inset: 0, zIndex: 1500, cursor: 'col-resize' }} />}
    <Dialog open={Boolean(c.review)} maxWidth="md" fullWidth onClose={c.closeReview}><DialogTitle>{t(c.review?.drop ? 'delete' : newIndex ? 'create_index_index' : 'edit_index')}</DialogTitle><DialogContent><Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert>{details?.unique && c.review?.drop && <Alert severity="warning">{t('mysql_index_unique_drop')}</Alert>}<Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', my: 2 }}>{c.review?.statement.sql}</Typography>{c.review?.drop && <TextField fullWidth size="small" label={t('index_name')} helperText={t('mysql_index_confirm_name')} value={confirmName} onChange={event => setConfirmName(event.target.value)} disabled={props.busy || c.attempted} />}{c.error && <Alert severity="error">{c.error}</Alert>}{c.attempted && <Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}</DialogContent><DialogActions><Button disabled={props.busy} onClick={c.closeReview}>{t('close')}</Button><Button variant="contained" disabled={c.blocked || c.attempted || Boolean(c.review?.drop && confirmName !== props.object?.name)} onClick={() => void c.execute()}>{t('execute')}</Button></DialogActions></Dialog>
  </Box>;
}
