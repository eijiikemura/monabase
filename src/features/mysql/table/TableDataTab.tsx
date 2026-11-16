// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Paper, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { DataGrid, enUS, jaJP } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useTranslation } from 'react-i18next';
import VerticalSplit from '../VerticalSplit';
import ConditionPanel from '@/components/data/ConditionPanel';
import ExportDialog from '@/components/data/ExportDialog';
import ImportDialog from '@/components/data/ImportDialog';
import { useCellValueInspector, cellMenuTrigger } from '@/components/data/CellValueInspector';
import { decorateTableResultColumns } from '@/features/data-grid/tableResultHeaders';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { buildGridColumns, buildTransposedColumns, getFormattedValue } from '@/features/data-grid/dataGridHelper';
import { getRowIdentity } from '@/features/data-grid/rowIdentity';
import type { ExportDataFetcher } from '@/features/table/exportSnapshot';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import { clearConditionInputs } from '@/shared/utils/queryConditions';
import { canEditTable, isGenerated, isSupportedColumn, isBinary, type RecordField } from './tableModel';
import type { MysqlTableProps } from './useMysqlTable';
import type { useMysqlTable } from './useMysqlTable';

type Controller = ReturnType<typeof useMysqlTable>;
interface RecordDialogState { original?: DatabaseRow; fields: Record<string, RecordField>; }
export default function TableDataTab({ controller: c, props, view = false, fetchDataChunk }: { controller: Controller; props: MysqlTableProps; view?: boolean; fetchDataChunk?: ExportDataFetcher }) {
  const { t, i18n } = useTranslation();
  const [bottom, setBottom] = useState(0), [transpose, setTranspose] = useState(false);
  const [dialog, setDialog] = useState<RecordDialogState | null>(null);
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number; row: DatabaseRow; field: string } | null>(null);
  const [deleting, setDeleting] = useState<DatabaseRow[] | null>(null);
  const inspector = useCellValueInspector();
  const metadata = c.metadata;
  const editable = Boolean(metadata && canEditTable(metadata) && metadata.columns.every(isSupportedColumn)) && !props.readonly && !props.disabled;
  const insertable = Boolean(metadata?.table.ENGINE?.toLowerCase() === 'innodb') && !props.readonly && !props.disabled;
  const locked = props.busy || props.disabled;
  const columns = useMemo(() => buildGridColumns((metadata?.columns || []).map(column => ({ name: column.COLUMN_NAME, dbTypeName: column.DATA_TYPE === 'datetime' ? 'TIMESTAMP' : column.DATA_TYPE.toUpperCase() })), props.settings.outputDateFormat, { sortable: false }, { preserveDetails: false }).map(column => ({
    ...column, editable: editable && !isGenerated(metadata!.columns.find(def => def.COLUMN_NAME === column.field)!) && !Number(metadata!.columns.find(def => def.COLUMN_NAME === column.field)!.PK_POSITION) && !isBinary(metadata!.columns.find(def => def.COLUMN_NAME === column.field)!)
  })), [metadata, props.settings.outputDateFormat, editable]);
  const displayColumns = useMemo(() => transpose ? buildTransposedColumns(c.rows, props.settings.outputDateFormat, { sortable: false }) : decorateTableResultColumns(columns, c.applied, t), [transpose, c.rows, columns, c.applied, props.settings.outputDateFormat, t]);
  const displayRows = useMemo(() => transpose ? columns.map((column, index) => ({ id: index, colName: column.field, ...Object.fromEntries(c.rows.map((row, rowIndex) => [`row_${rowIndex}`, row[column.field] === null ? null : getFormattedValue(row[column.field], { name: column.field, dbTypeName: metadata?.columns.find(def => def.COLUMN_NAME === column.field)?.DATA_TYPE.replace(/^datetime$/i, 'TIMESTAMP').toUpperCase() }, props.settings.outputDateFormat, { preserveDetails: false })])) })) : c.rows, [transpose, columns, c.rows, metadata, props.settings.outputDateFormat]);
  const selectedRows = c.rows.filter(row => c.selection.includes(getRowIdentity(row)));
  const openRecord = (row?: DatabaseRow, duplicate = false) => {
    if (!metadata || locked) return;
    setDialog({ original: duplicate ? undefined : row, fields: Object.fromEntries(metadata.columns.filter(column => !isGenerated(column)).map(column => {
      const value = row?.[column.COLUMN_NAME];
      const useDefault = !row || duplicate && /auto_increment/i.test(column.EXTRA) || !isSupportedColumn(column);
      return [column.COLUMN_NAME, { mode: useDefault ? 'default' : value === null ? 'null' : 'value', value: value == null ? '' : String(value) }];
    })) });
  };
  const action = (label: string, Icon: typeof AddIcon, enabled: boolean, run: () => void, color: 'primary' | 'error' = 'primary') => <Tooltip title={label}><span><IconButton aria-label={label} size="small" color={color} disabled={!enabled || locked} onClick={run} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}><Icon fontSize="small" /></IconButton></span></Tooltip>;
  return <Box data-testid="mysql-table-data" sx={{ p: 1, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
    <VerticalSplit name="data" active={props.active} initialHeight={250} upper={<Paper sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <ConditionPanel columns={metadata?.columns.map(column => column.COLUMN_NAME) || []} conditions={c.conditions} onConditionChange={(name, key, value) => c.setConditions(previous => ({ ...previous, [name]: { ...previous[name], [key]: value } }))} onExecute={() => void c.search()} onClearConditions={() => c.setConditions(clearConditionInputs(c.conditions))} inputDateFormat={props.settings.inputDateFormat} disabled={locked || !metadata} />
    </Paper>} lower={<>
    {JSON.stringify(c.conditions) !== JSON.stringify(c.applied) && <Typography variant="caption" color="text.secondary">{t('table_conditions_pending')}</Typography>}
    {metadata && !editable && !view && <Alert severity="info" sx={{ py: 0 }}>{props.readonly ? t('read_only_2') : t('mysql_table_edit_key_required')}</Alert>}
    <Paper sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Tabs value={bottom} onChange={(_event, value: number) => setBottom(value)} sx={{ minHeight: 36, borderBottom: 1, borderColor: 'divider' }}><Tab label={t('result')} sx={{ minHeight: 36, py: 0 }} /><Tab label={t('execution_log')} sx={{ minHeight: 36, py: 0 }} /></Tabs>
      {bottom === 0 ? <>
        <Box sx={{ p: 1, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" sx={{ mr: 'auto' }}>{t('result')} · {c.total} {t('mysql_rows')}</Typography>
          {action(t('refresh'), RefreshIcon, true, () => void c.refresh())}
          {!view && <>
          {action(t('add_new_record_ctrl_i'), AddIcon, insertable, () => openRecord())}
          {action(t('edit_selected_row_enter_ctrl_e'), EditIcon, editable && selectedRows.length === 1 && !transpose, () => openRecord(selectedRows[0]))}
          {action(t('duplicate_selected_row'), ContentCopyIcon, insertable && selectedRows.length === 1 && !transpose, () => openRecord(selectedRows[0], true))}
          {action(t('delete_selected_rows'), DeleteOutlineIcon, editable && selectedRows.length > 0 && !transpose, () => setDeleting(selectedRows), 'error')}
          </>}
          {action(t('transpose_swap_rows_and_columns'), SwapHorizIcon, c.rows.length > 0, () => setTranspose(previous => !previous))}
          {!view && <ImportDialog targetKey={JSON.stringify([props.schema, props.table])} columns={metadata?.columns.filter(column => !isGenerated(column)).map(column => column.COLUMN_NAME) || []} onImport={c.importRows} tableName={props.table} disabled={locked || !insertable} />}
          <Tooltip title={t(view ? 'mysql_view_export_help' : 'mysql_table_export_page_only')}><span><ExportDialog totalCount={view && !transpose ? c.total : undefined} fetchDataChunk={view && !transpose ? fetchDataChunk : undefined} rows={displayRows} columns={displayColumns} defaultFileName={props.table + '_data'} iconType="download" tableName={props.table} disabled={locked} /></span></Tooltip>
        </Box>
        <GridViewport active={props.active}><DataGrid rows={displayRows} columns={displayColumns} getRowId={transpose ? row => row.id! : getRowIdentity} density="compact" disableColumnFilter disableColumnMenu onColumnHeaderClick={params => { if (!transpose && !locked) c.sortByColumn(params.field); }} disableRowSelectionOnClick checkboxSelection={!view && !transpose} isRowSelectable={() => !locked && !transpose} rowSelectionModel={transpose ? [] : c.selection} onRowSelectionModelChange={value => { if (!locked) c.setSelection(value); }} paginationMode={transpose ? 'client' : 'server'} rowCount={transpose ? undefined : c.total} paginationModel={transpose ? undefined : c.pagination} onPaginationModelChange={transpose ? undefined : value => { void c.changePage(value); }} pageSizeOptions={[100]} isCellEditable={params => !locked && !transpose && Boolean(params.colDef.editable)} processRowUpdate={c.updateCell} onProcessRowUpdateError={failure => c.setError(failure instanceof Error ? failure.message : t('execution_failed'))} localeText={(i18n.resolvedLanguage || i18n.language).startsWith('ja') ? jaJP.components.MuiDataGrid.defaultProps.localeText : enUS.components.MuiDataGrid.defaultProps.localeText} onCellKeyDown={(params, event) => { const anchor = cellMenuTrigger(event); if (anchor) { event.defaultMuiPrevented = true; inspector.rememberCell(anchor.cell); setCellMenu({ x: anchor.x, y: anchor.y, row: params.row, field: params.field }); } }} slotProps={{ row: { onContextMenu: event => { const anchor = cellMenuTrigger(event); if (!anchor) return; const id = event.currentTarget.getAttribute('data-id'); const row = displayRows.find(row => String(transpose ? row.id : getRowIdentity(row)) === id); const field = anchor.cell.getAttribute('data-field'); if (row && field) { inspector.rememberCell(anchor.cell); setCellMenu({ x: anchor.x, y: anchor.y, row, field }); } } } }} /></GridViewport>
      </> : <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>{c.logs.map((log, index) => <Box key={index} sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}><Typography component="pre" variant="caption" sx={{ whiteSpace: 'pre-wrap' }}>{log.sql}</Typography>{log.error && <Alert severity="error">{log.error}</Alert>}</Box>)}</Box>}
    </Paper>
    </>} />
    <Menu disableRestoreFocus open={cellMenu !== null} anchorReference="anchorPosition" anchorPosition={cellMenu ? { left: cellMenu.x, top: cellMenu.y } : undefined} onClose={() => { setCellMenu(null); inspector.restoreCellFocus(); }}>{inspector.menuItems(cellMenu ? { label: cellMenu.field, value: cellMenu.row[cellMenu.field], binary: metadata?.columns.some(column => column.COLUMN_NAME === cellMenu.field && isBinary(column)) } : null, () => setCellMenu(null))}</Menu>
    {inspector.dialog}
    {dialog && <Dialog open onClose={() => { if (!props.busy) setDialog(null); }} maxWidth="sm" fullWidth>
      <DialogTitle>{dialog.original ? t('edit_record') : t('add_record')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        <Alert severity="info">{t('mysql_table_record_help')}</Alert>
        {metadata?.columns.filter(column => !isGenerated(column)).map(column => {
          const field = dialog.fields[column.COLUMN_NAME], immutable = Boolean(dialog.original && Number(column.PK_POSITION)) || !isSupportedColumn(column);
          const update = (next: Partial<RecordField>) => setDialog(previous => previous && ({ ...previous, fields: { ...previous.fields, [column.COLUMN_NAME]: { ...field, ...next } } }));
          return <Box key={column.COLUMN_NAME} sx={{ display: 'flex', gap: 1 }}>
            <TextField fullWidth size="small" label={`${column.COLUMN_NAME} (${column.COLUMN_TYPE})`} value={field.value} disabled={props.busy || immutable || field.mode !== 'value'} onChange={event => update({ value: event.target.value })} helperText={isBinary(column) ? t('mysql_table_hex_help') : column.COLUMN_COMMENT} multiline={/text|json/.test(column.DATA_TYPE)} maxRows={5} />
            <TextField select size="small" label={t('value')} value={field.mode} disabled={props.busy || immutable} onChange={event => update({ mode: event.target.value as RecordField['mode'] })} sx={{ minWidth: 115 }}>
              <MenuItem value="value">{t('value')}</MenuItem>{column.IS_NULLABLE === 'YES' && <MenuItem value="null">NULL</MenuItem>}{!dialog.original && <MenuItem value="default">DEFAULT</MenuItem>}
            </TextField>
          </Box>;
        })}
      </DialogContent>
      <DialogActions><Button disabled={props.busy} onClick={() => setDialog(null)}>{t('cancel')}</Button><Button variant="contained" disabled={locked} onClick={() => { void c.saveRecord(Object.fromEntries(Object.entries(dialog.fields).filter(([name]) => !dialog.original || !Number(metadata?.columns.find(column => column.COLUMN_NAME === name)?.PK_POSITION))), dialog.original).then(saved => { if (saved) setDialog(null); }); }}>{t('execute')}</Button></DialogActions>
    </Dialog>}
    <Dialog open={deleting !== null} onClose={() => { if (!props.busy) setDeleting(null); }}><DialogTitle>{t('delete_selected_rows')}</DialogTitle><DialogContent><Typography>{t('mysql_table_confirm_delete', { count: deleting?.length || 0 })}</Typography></DialogContent><DialogActions><Button disabled={props.busy} onClick={() => setDeleting(null)}>{t('cancel')}</Button><Button variant="contained" color="error" disabled={locked} onClick={() => { const selected = deleting; setDeleting(null); if (selected) void c.deleteRows(selected); }}>{t('delete')}</Button></DialogActions></Dialog>
  </Box>;
}
