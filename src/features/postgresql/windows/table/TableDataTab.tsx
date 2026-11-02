// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCellValueInspector, cellMenuTrigger } from '@/components/data/CellValueInspector';
import { useTranslation } from 'react-i18next';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { postgresColumnKind, postgresIsDateTime, postgresIsLob } from '@/features/postgresql/columnTypes';
import { GridFooterContent, StableGridFooter } from '@/features/data-grid/StableGridFooter';
import { getRowIdentity } from '@/features/data-grid/rowIdentity';
import { isBinaryFileValue } from "@/shared/types/databaseTypes";

import React from 'react';
import {
  Box, Paper, Typography, Button, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider, Menu, MenuItem, ListItemIcon,
  TextField, Tabs, Tab, FormControl, InputLabel, Select
} from '@mui/material';
import { DataGrid, jaJP, enUS, GridPagination } from '@mui/x-data-grid';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';

import ExportDialog from "@/components/data/ExportDialog";
import ImportDialog from "@/components/data/ImportDialog";
import ConditionPanel from "@/components/data/ConditionPanel";
import { formatDateString } from "@/shared/utils/dateFormatter";

import { useTableDataTab, type TableDataTabProps } from './useTableDataTab';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1, position: 'relative' as const, minHeight: 0 }),
  conditionPaper: (height: number) => ({ height, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper', position: 'relative' as const }),
  hResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  hResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomContainer: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', p: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', minHeight: 0 },
  bottomPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', position: 'relative' as const, minHeight: 0, bgcolor: 'background.paper' },
  tabsWrapper: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' },
  tabs: { minHeight: 36 },
  tabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  resultBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0 }),
  resultHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerActions: { display: 'flex', gap: 1, alignItems: 'center' },
  dataGridRoot: {
    border: 0,
    '& .even-row': { bgcolor: 'action.hover' },
    '& .even-row:hover': { bgcolor: 'action.selected' },
    '& .custom-selected': { bgcolor: 'rgba(25, 118, 210, 0.08) !important' },
    '& .custom-selected:hover': { bgcolor: 'rgba(25, 118, 210, 0.12) !important' },
    '& .MuiDataGrid-cell:focus': { outline: 'none' },
    '& .MuiDataGrid-cell:focus-within': { outline: 'none' },
    '& .MuiDataGrid-row:hover': { cursor: 'pointer', bgcolor: 'action.hover' }
  },
  logsBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0, bgcolor: 'action.hover' }),
  logsToolbar: { display: 'flex', justifyContent: 'flex-end', p: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' },
  logsArea: { flexGrow: 1, overflowY: 'auto' as const, p: 1 },
  logItemBox: { mb: 1, pb: 1, borderBottom: '1px solid', borderColor: 'divider' },
  logItemHeader: { fontWeight: 'bold', color: 'text.secondary' },
  logItemSql: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.primary', mt: 0.5, bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  logErrorBox: { mt: 1, p: 1, bgcolor: 'error.light', borderRadius: 1, border: '1px solid', borderColor: 'error.main' },
  logErrorText: (isClickable: boolean) => ({ whiteSpace: 'pre-wrap', marginBottom: '2px', color: '#fff', cursor: isClickable ? 'pointer' : 'text', fontFamily: 'monospace', fontSize: '0.85rem', '&:hover': isClickable ? { textDecoration: 'underline' } : {} }),
  logEmpty: { p: 2, textAlign: 'center' as const },
  menuItemText: { fontSize: '0.85rem' },
  dialogTitle: { fontWeight: 'bold' },
  dialogContent: { pt: 1, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  dateInputWrapper: { display: 'flex', gap: 1, alignItems: 'center' },
  hiddenInput: { position: 'absolute' as const, width: 0, height: 0, opacity: 0, padding: 0, border: 0 },
  clobWrapper: { display: 'flex', flexDirection: 'column' as const, gap: 0.5 },
  clobLengthInfo: { mt: -1.5, mb: 1, pr: 1, bgcolor: 'background.paper', position: 'relative' as const, zIndex: 1, width: 'max-content', alignSelf: 'flex-end' },
  blobWrapper: { display: 'flex', flexDirection: 'column' as const, gap: 1 },
  blobControls: { display: 'flex', gap: 1, alignItems: 'center' },
  blobFileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }
};

const formatBytes = (bytes: number) => {
  if (bytes === 0 || isNaN(bytes)) return '0 Byte';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default function TableDataTabPostgresql(props: TableDataTabProps) {
  const cellInspector = useCellValueInspector();
  const { i18n } = useTranslation();
  const dataGridLocaleText = (i18n.resolvedLanguage ?? i18n.language).startsWith('ja')
    ? jaJP.components.MuiDataGrid.defaultProps.localeText
    : enUS.components.MuiDataGrid.defaultProps.localeText;

  const {
    t, containerRef, importColumns, isLoading, isSavingRecord, columns, structureDefs, conditions, handleConditionChange, handleClearConditions, handleExecuteSearchClick,
    conditionHeight, isResizingCondition, setIsResizingCondition, bottomTab, setBottomTab, logs, setLogs,
    recordDialog, setRecordDialog, dataContextMenu, setDataContextMenu, isTransposed, setIsTransposed,
    appliedConditions, conditionsPending,
    displayColumns, displayRows, paginationModel, rowCount, selectedRowIds,
    handleColumnHeaderClick, handleRowClick, handleCellDoubleClick, handleEditSelected, handleDuplicateSelected,
    handleDeleteSelected, handleOpenInsert, handleOpenUpdate, handleOpenDuplicate, handleCloseDialog,
    submitRecord, handleProcessRowUpdate, processBulkInsertData, fetchDataForExport, conditionsText, executeSearch,
    hasPrimaryKey
  } = useTableDataTab(props);

  const footer = (
    <>
      <Box sx={{ display: 'flex', gap: 1, pl: 2, alignItems: 'center' }}>
        <Tooltip title={isTransposed ? t("reset_view") : t("transpose_swap_rows_and_columns")}>
          <span>
            <IconButton
              color={isTransposed ? "secondary" : "primary"}
              onClick={() => setIsTransposed(!isTransposed)}
              size="small"
              disabled={isLoading}
            >
              <SwapHorizIcon />
            </IconButton>
          </span>
        </Tooltip>

        <Box sx={{ pointerEvents: isLoading ? 'none' : 'auto', opacity: isLoading ? 0.5 : 1 }}>
          <ImportDialog targetKey={JSON.stringify([props.schema, props.tableName])} columns={importColumns}
            onImport={processBulkInsertData}
            tableName={props.tableName}
            disabled={isLoading}
          />
        </Box>

        <Box sx={{ pointerEvents: isLoading ? 'none' : 'auto', opacity: isLoading ? 0.5 : 1 }}>
          <ExportDialog
            columns={displayColumns}
            rows={displayRows}
            defaultFileName={`${props.tableName}_data`}
            iconType="download"
            totalCount={!isTransposed ? rowCount : undefined}
            fetchDataChunk={!isTransposed ? fetchDataForExport : undefined}
            tableName={props.tableName}
            conditionsText={conditionsText}
            disabled={isLoading}
          />
        </Box>
      </Box>

      {!isTransposed && (
        <GridPagination
          disabled={isLoading}
          SelectProps={{
            disabled: isLoading
          }}
        />
      )}
    </>
  );

  return (
    <Box data-testid="table-data" ref={containerRef} sx={styles.rootBox(props.isActive)}>
      <Paper elevation={1} sx={styles.conditionPaper(conditionHeight)}>
        <ConditionPanel
          allowTime
          columns={columns}
          conditions={conditions}
          onConditionChange={handleConditionChange}
          onClearConditions={handleClearConditions}
          onExecute={handleExecuteSearchClick}
          inputDateFormat={props.inputDateFormat}
          disabled={isLoading}
        />
      </Paper>

      {conditionsPending && <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>{t('table_conditions_pending')}</Typography>}

      <Box
        onMouseDown={() => setIsResizingCondition(true)}
        sx={styles.hResizer(isResizingCondition)}
      >
        <Box sx={styles.hResizerInner(isResizingCondition)} />
      </Box>

      <Box sx={styles.bottomContainer}>
        <Paper elevation={1} sx={styles.bottomPaper}>

          <Box sx={styles.tabsWrapper}>
            <Tabs value={bottomTab} onChange={(_e, val) => setBottomTab(val)} sx={styles.tabs}>
              <Tab label={t("result")} sx={styles.tabItem} />
              <Tab label={t("execution_log")} sx={styles.tabItem} />
            </Tabs>
          </Box>

          <Box sx={styles.resultBox(bottomTab === 0)}>
            <Box sx={styles.resultHeader}>
              <Typography variant="subtitle2" fontWeight="bold">{t("result")}</Typography>

              <Box sx={styles.headerActions}>
                <Tooltip title={t("add_new_record_ctrl_i")}>
                  <span>
                    <IconButton
                      color="primary"
                      onClick={handleOpenInsert}
                      size="small"
                      disabled={isLoading}
                    >
                      <AddIcon />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title={hasPrimaryKey ? t("edit_selected_row_enter_ctrl_e") : t("tables_without_a_primary_key_cannot_be_edited_deleted_or_duplicated")}>
                  <span><IconButton color="primary" onClick={handleEditSelected} size="small" disabled={!hasPrimaryKey || selectedRowIds.length !== 1 || isTransposed || isLoading}><EditIcon /></IconButton></span>
                </Tooltip>
                <Tooltip title={hasPrimaryKey ? t("duplicate_selected_row_ctrl_d") : t("tables_without_a_primary_key_cannot_be_edited_deleted_or_duplicated")}>
                  <span><IconButton color="primary" onClick={handleDuplicateSelected} size="small" disabled={!hasPrimaryKey || selectedRowIds.length !== 1 || isTransposed || isLoading}><ContentCopyIcon /></IconButton></span>
                </Tooltip>

                <Tooltip title={hasPrimaryKey ? t("delete_selected_row_del_backspace") : t("tables_without_a_primary_key_cannot_be_edited_deleted_or_duplicated")}>
                  <span><IconButton color="error" onClick={handleDeleteSelected} size="small" disabled={!hasPrimaryKey || selectedRowIds.length === 0 || isTransposed || isLoading}><DeleteOutlineIcon /></IconButton></span>
                </Tooltip>
                <Divider orientation="vertical" flexItem />
              </Box>
            </Box>
            <GridViewport active={props.isActive && bottomTab === 0}>
              <GridFooterContent.Provider value={footer}>
                <DataGrid
                  rows={displayRows}
                  columns={displayColumns}
                  getRowId={getRowIdentity}
                  density="compact"
                  loading={false}
                  localeText={dataGridLocaleText}
                  disableColumnFilter disableColumnMenu
                  paginationMode="server"
                  paginationModel={paginationModel}
                  onPaginationModelChange={(model) => {
                    if (model.page === paginationModel.page && model.pageSize === paginationModel.pageSize) {
                      return;
                    }
                    executeSearch(appliedConditions, model.page, model.pageSize);
                  }}
                  rowCount={rowCount}
                  pageSizeOptions={[50, 100, 500]}
                  disableRowSelectionOnClick
                  onRowClick={handleRowClick}
                  onColumnHeaderClick={handleColumnHeaderClick}
                  onCellDoubleClick={handleCellDoubleClick}
                  onCellKeyDown={(params, event) => {
                    if (isLoading) return;
                    const anchor = cellMenuTrigger(event);
                    if (!anchor) return;
                    event.defaultMuiPrevented = true;
                    cellInspector.rememberCell(anchor.cell);
                    setDataContextMenu({ mouseX: anchor.x, mouseY: anchor.y, row: params.row, field: params.field });
                  }}
                  processRowUpdate={handleProcessRowUpdate}
                  onProcessRowUpdateError={(error) => console.error(error)}
                  components={{
                    Footer: StableGridFooter
                  }}
                  componentsProps={{
                    row: {
                      onContextMenu: (e: React.MouseEvent) => {
                        if (isLoading) return;
                        const anchor = cellMenuTrigger(e);
                        if (!anchor) return;
                        cellInspector.rememberCell(anchor.cell);
                        const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
                        if (id) {
                          const row = displayRows.find(r => String(getRowIdentity(r)) === String(id));
                          if (row) setDataContextMenu({ mouseX: anchor.x, mouseY: anchor.y, row, field: (e.target as HTMLElement).closest('[data-field]')?.getAttribute('data-field') || undefined });
                        }
                      }
                    }
                  }}
                  getRowClassName={(params) => {
                    const classes = [];
                    if (selectedRowIds.includes(params.id)) classes.push('custom-selected');
                    if (params.indexRelativeToCurrentPage % 2 === 0) classes.push('even-row');
                    return classes.join(' ');
                  }}
                  sx={styles.dataGridRoot}
                />
              </GridFooterContent.Provider>
            </GridViewport>
          </Box>

          <Box sx={styles.logsBox(bottomTab === 1)}>
            <Box sx={styles.logsToolbar}>
              <Tooltip title={t("clear_log")}><IconButton color="error" onClick={() => setLogs([])} size="small"><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
            </Box>
            <Box sx={styles.logsArea}>
              {logs.map((log, i) => (
                <Box key={i} sx={styles.logItemBox}>
                  <Typography variant="caption" sx={styles.logItemHeader}>[{log.time}] {t("result_2")} {log.resultMsg}</Typography>
                  <Typography variant="body2" sx={styles.logItemSql}>{log.sql}</Typography>
                  {log.errorLines && log.errorLines.length > 0 && (
                    <Box sx={styles.logErrorBox}>
                      {log.errorLines.map((eLine, eIdx) => {
                        const isClickable = eLine.match(/^\[ERROR\] Line (\d+):/);
                        return (
                          <Box
                            key={eIdx}
                            sx={styles.logErrorText(!!isClickable)}
                          >
                            {eLine}
                          </Box>
                        );
                      })}
                    </Box>
                  )}
                </Box>
              ))}
              {logs.length === 0 && <Typography variant="body2" color="text.secondary" sx={styles.logEmpty}>{t("no_execution_logs")}</Typography>}
            </Box>
          </Box>
        </Paper>
      </Box>

      <Menu disableRestoreFocus open={dataContextMenu !== null} onClose={() => { setDataContextMenu(null); cellInspector.restoreCellFocus(); }} anchorReference="anchorPosition" anchorPosition={dataContextMenu !== null ? { top: dataContextMenu.mouseY, left: dataContextMenu.mouseX } : undefined}>
        {cellInspector.menuItems(dataContextMenu?.field ? {
          label: displayColumns.find(column => column.field === dataContextMenu.field)?.headerName || dataContextMenu.field,
          value: dataContextMenu.row[dataContextMenu.field],
          binary: /BLOB|BFILE|RAW|BYTEA/i.test(structureDefs.find(column => column.COLUMN_NAME === (isTransposed ? dataContextMenu.row.colName : dataContextMenu.field))?.DATA_TYPE || '')
        } : null, () => setDataContextMenu(null))}
        <MenuItem disabled={isTransposed || !hasPrimaryKey || isLoading} onClick={() => dataContextMenu && handleOpenUpdate(dataContextMenu.row)} sx={styles.menuItemText}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon>{t("edit_this_data_enter_ctrl_e")}
        </MenuItem>
        <MenuItem disabled={isTransposed || !hasPrimaryKey || isLoading} onClick={() => dataContextMenu && handleOpenDuplicate(dataContextMenu.row)} sx={styles.menuItemText}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>{t("duplicate_this_data_ctrl_d")}
        </MenuItem>
      </Menu>

      {cellInspector.dialog}
      <Dialog open={recordDialog.isOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle sx={styles.dialogTitle}>{recordDialog.mode === 'update' ? t("edit_record") : t("add_new_record")}</DialogTitle>
        <DialogContent dividers sx={styles.dialogContent}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("record_null_help")}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("record_temporal_help")}</Typography>
          {structureDefs.map(col => {
             const isPk = !!col.PK_POSITION;
             const isUpdate = recordDialog.mode === 'update';
             const disabled = isSavingRecord || (isPk && isUpdate);
             const inputValue = recordDialog.recordData[col.COLUMN_NAME];
             const binaryValue = isBinaryFileValue(inputValue) ? inputValue : undefined;


             const kind = postgresColumnKind(col);
             const isDateTime = postgresIsDateTime(col);
             const isBlob = kind === 'binary';
             const isClob = postgresIsLob(col);
             const isBoolean = kind === 'boolean';
             const isStandardType = kind !== 'other';
             const isUserType = !isStandardType;

             return (
              <Box key={col.COLUMN_NAME}>
                {kind === 'time' ? (
                  <TextField
                    label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${isPk ? t('primary_key_separator') : ''}${col.NULLABLE === 'N' ? t('required') : ''})`}
                    size="small" fullWidth variant="outlined" type="text" disabled={disabled}
                    placeholder={t('time_value_example')} helperText={t('time_value_help')}
                    value={String(inputValue ?? '')}
                    onChange={event => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: event.target.value } })}
                  />
                ) : isDateTime ? (
                  <Box sx={styles.dateInputWrapper}>
                    <TextField
                      label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${isPk ? t("primary_key_separator") : ''}${col.NULLABLE === 'N' ? t("required") : ''})`}
                      size="small" fullWidth variant="outlined" type="text"
                      disabled={disabled}
                      placeholder={t("e_g") + (kind === 'date' ? props.inputDateFormat.split(' ')[0] : props.inputDateFormat)}
                      value={recordDialog.recordData[col.COLUMN_NAME] || ''}
                      onChange={(e) => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: e.target.value }})}
                    />
                    {!disabled && (
                      <Box sx={{ position: 'relative', display: 'flex' }}>
                        <Tooltip title={t("select_from_calendar")}>
                          <IconButton
                            color="primary"
                            onClick={(e) => {
                              const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                              if (input && typeof input.showPicker === 'function') input.showPicker();
                              else if (input) input.focus();
                            }}
                          >
                            <CalendarTodayIcon />
                          </IconButton>
                        </Tooltip>
                        <input
                          type={(kind === 'date' || !props.inputDateFormat.match(/H|h|m|s/)) ? "date" : "datetime-local"}
                          step="1"
                          style={styles.hiddenInput}
                          onChange={(e) => {
                            if (e.target.value) {
                              const dateObj = new Date(e.target.value);
                              let targetFormat = props.inputDateFormat;
                              if (kind === 'date' && targetFormat.match(/H|h|m|s/i)) {
                                  targetFormat = targetFormat.split(' ')[0];
                              }
                              const formatted = formatDateString(dateObj, targetFormat);
                              setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: formatted }});
                              e.target.value = '';
                            }
                          }}
                        />
                      </Box>
                    )}
                  </Box>
                ) : isClob ? (
                  <Box sx={styles.clobWrapper}>
                    <TextField
                      label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${isPk ? t("primary_key_separator") : ''}${col.NULLABLE === 'N' ? t("required") : ''})`}
                      size="small" fullWidth variant="outlined" multiline minRows={3} maxRows={8}
                      disabled={disabled}
                      placeholder={t("enter_text")}
                      value={recordDialog.recordData[col.COLUMN_NAME] || ''}
                      onChange={(e) => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: e.target.value }})}
                    />
                    <Typography variant="caption" color="text.secondary" align="right" sx={styles.clobLengthInfo}>
                      {t("chars")} {String(recordDialog.recordData[col.COLUMN_NAME] || '').length}
                    </Typography>
                  </Box>
                ) : isBlob ? (
                  <Box sx={styles.blobWrapper}>
                    <Typography variant="caption" color="text.secondary">
                      {col.COLUMN_NAME} ({col.DATA_TYPE}{isPk ? t("primary_key_separator") : ''}{col.NULLABLE === 'N' ? t("required") : ''})
                    </Typography>
                    <Box sx={styles.blobControls}>
                      <Button variant="outlined" component="label" disabled={disabled} size="small">
                        {t("select_file")}
                        <input type="file" disabled={disabled} hidden onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const buffer = ev.target?.result;
                              setRecordDialog({
                                ...recordDialog,
                                recordData: {
                                  ...recordDialog.recordData,
                                  [col.COLUMN_NAME]: {
                                    isBlob: true,
                                    fileName: file.name,
                                    data: buffer,
                                    hex: null,
                                    sizeStr: formatBytes(file.size)
                                  }
                                }
                              });
                            };
                            reader.readAsArrayBuffer(file);
                          }
                        }} />
                      </Button>
                      <Typography variant="body2" sx={styles.blobFileName}>
                        {binaryValue?.fileName || t("no_file_selected")}
                        {binaryValue?.sizeStr ? ` (${binaryValue.sizeStr})` : ''}
                      </Typography>
                      {Boolean(recordDialog.recordData[col.COLUMN_NAME]) && !disabled && (
                        <Button size="small" color="error" onClick={() => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: '' }})}>
                          {t("clear")}
                        </Button>
                      )}
                    </Box>
                  </Box>
                ) : isBoolean ? (
                  <FormControl size="small" fullWidth disabled={disabled}>
                    <InputLabel>{`${col.COLUMN_NAME} (${col.DATA_TYPE}${isPk ? t("primary_key_separator") : ''}${col.NULLABLE === 'N' ? t("required") : ''})`}</InputLabel>
                    <Select
                      label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${isPk ? t("primary_key_separator") : ''}${col.NULLABLE === 'N' ? t("required") : ''})`}
                      value={String(recordDialog.recordData[col.COLUMN_NAME] ?? '')}
                      onChange={(e) => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: e.target.value }})}
                    >
                      <MenuItem value="">{t("not_selected")}</MenuItem>
                      <MenuItem value="true">true</MenuItem>
                      <MenuItem value="false">false</MenuItem>

                    </Select>
                  </FormControl>
                ) : isUserType ? (
                  <TextField
                    label={`${col.COLUMN_NAME} (` + t("user_defined_type_2") + `${col.DATA_TYPE}${isPk ? t("primary_key_separator") : ''}${col.NULLABLE === 'N' ? t("required") : ''})`}
                    size="small" fullWidth variant="outlined" type="text"
                    disabled={disabled}
                    placeholder={t("e_g_value1_value2")}
                    value={recordDialog.recordData[col.COLUMN_NAME] || ''}
                    onChange={(e) => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: e.target.value }})}
                  />
                ) : (
                  <TextField
                    label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${isPk ? t("primary_key_separator") : ''}${col.NULLABLE === 'N' ? t("required") : ''})`}
                    size="small" fullWidth variant="outlined" type="text"
                    disabled={disabled}
                    value={recordDialog.recordData[col.COLUMN_NAME] || ''}
                    onChange={(e) => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: e.target.value }})}
                  />
                )}
                {!disabled && col.NULLABLE !== 'N' && (
                  <Button size="small" onClick={() => setRecordDialog({ ...recordDialog, recordData: { ...recordDialog.recordData, [col.COLUMN_NAME]: null } })}>
                    {inputValue === null ? t('record_null_selected') : t('record_set_null')}
                  </Button>
                )}
              </Box>
             );
          })}
        </DialogContent>
        <DialogActions>
          <Button disabled={isSavingRecord} onClick={() => handleCloseDialog()} color="inherit">{t("close")}</Button>
          <Button disabled={isSavingRecord} onClick={submitRecord} variant="contained" color="primary">{recordDialog.mode === 'update' ? t("execute_update") : t("execute_add")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}