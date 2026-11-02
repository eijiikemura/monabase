// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import React, { memo } from 'react';
import { 
  Box, Paper, Typography, Button, Checkbox, FormControlLabel,
  FormControl, InputLabel, Select, MenuItem, Tabs, Tab,
  Divider, IconButton, Tooltip, Alert
} from '@mui/material';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import type { ObjectCategory } from '@/shared/types/objectTypes';
import { useTheme } from '@mui/material/styles'; // Import theme access helpers.
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';

import { DEFAULT_DATETIME_FORMAT } from "@/shared/utils/dateFormatter"; 

// Reuse ViewDataTab for the log tab.
import ViewDataTab from '../view/ViewDataTab';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";

// Use type-only imports to avoid build errors.
import { useMaterializedViewLogWindow, type MaterializedViewLogWindowProps } from './useMaterializedViewLogWindow';

const MemoCodeMirror = memo(CodeMirror);
const MemoViewDataTab = memo(ViewDataTab);

// Extend the source editor to the bottom of its available area.
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  rootBox: { minHeight: 0, position: 'relative' as const, border: 0, m: 0, p: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, height: '100%', bgcolor: 'background.default', overflow: 'hidden' },
  tabContainer: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2 },
  tabs: { minHeight: 40 },
  tabItem: { minHeight: 40, py: 0 },
  mainContainer: { minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'row' as const, overflow: 'hidden' },
  leftPane: { minHeight: 0, minWidth: 0, flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  editorPane: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', p: 3, overflowY: 'auto' as const, alignItems: 'flex-start', flexDirection: 'column' as const }),
  cardPaper: { p: 3, maxWidth: 800, width: '100%', mx: 'auto', display: 'flex', flexDirection: 'column' as const, gap: 3, bgcolor: 'background.paper' },
  headerBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  actionsBox: { display: 'flex', gap: 1 },
  alertInfo: { py: 0 },
  flexGap2: { display: 'flex', gap: 2 },
  formControl250: { width: 250 },
  flex1: { flexGrow: 1 },
  sectionTitle: { fontWeight: 'bold', color: 'text.secondary', mb: 1 },
  checkboxGroup: { display: 'flex', gap: 2, flexWrap: 'wrap' as const, p: 2, bgcolor: 'action.hover', borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  dynamicColor: (isDisabled: boolean) => ({ color: isDisabled ? 'text.disabled' : 'inherit' }),
  menuItem: { py: 0, minHeight: 32 },
  listItemText: (isDisabled: boolean) => ({ '& .MuiListItemText-primary': { fontSize: '0.85rem', color: isDisabled ? 'text.disabled' : 'inherit' } }),
  alterSqlPaper: { mt: 3, maxWidth: 800, width: '100%', mx: 'auto', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  sqlHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  alterSqlEditorBox: { flexGrow: 1, overflow: 'auto' as const, '& .cm-editor': { minHeight: '80px', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  createSqlEditorBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  emptyLogBox: { p: 3, textAlign: 'center' as const, color: 'text.secondary' },
  consoleResizer: (isResizing: boolean) => ({ width: 4, cursor: 'col-resize', bgcolor: isResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s' }),
  consolePaper: (width: number) => ({ width, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRadius: 0, bgcolor: 'background.paper' }),
  consoleHeader: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 },
  consoleTabs: { minHeight: 36 },
  consoleTabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  consoleContent: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'action.hover' },
  consoleToolbar: { display: 'flex', justifyContent: 'flex-end', p: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' },
  consoleLogsArea: { flexGrow: 1, overflowY: 'auto' as const, p: 1 },
  logItemBox: { mb: 1, pb: 1, borderBottom: '1px solid', borderColor: 'divider' },
  logItemHeader: { fontWeight: 'bold', color: 'text.secondary' },
  logItemSql: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.primary', mt: 0.5, bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  logErrorBox: { mt: 1, p: 1, bgcolor: 'error.light', borderRadius: 1, border: '1px solid', borderColor: 'error.main' },
  logErrorText: { whiteSpace: 'pre-wrap', color: '#fff', fontFamily: 'monospace' },
  logEmpty: { p: 2, textAlign: 'center' as const }
};

const TABLE_CATEGORIES: readonly ObjectCategory[] = ['TABLE'];
const basicSetupConfig = { lineNumbers: true };

export default function MaterializedViewLogWindow(props: MaterializedViewLogWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme(); // Get the current theme.

  const {
    activeTab, setActiveTab, bottomTab, setBottomTab,
    logs, setLogs, isConsoleOpen, setIsConsoleOpen,
    consoleWidth, isResizing, setIsResizing,
    isLoading, ready, error, retry, validation, master, metadata, revision, logTableName,
    formData, setFormData, initialFormData,
    handleDelete, handleExecute, toggleColumn, handleCopy, canExecute, canDelete,
    pickerOpen, setPickerOpen, openPicker, selectTable, setSchema, loggedTables,
    createSql, alterSql, editorExtensions
  } = useMaterializedViewLogWindow(props);

  const detailLabels: Record<string, string> = {
    LOG_OWNER: t('mview_log_detail_log_owner'),
    MASTER: t('mview_log_detail_master'),
    LOG_TABLE: t('mview_log_detail_log_table'),
    PRIMARY_KEY: t('mview_log_detail_primary_key'),
    ROWIDS: t('mview_log_detail_rowids'),
    OBJECT_ID: t('mview_log_detail_object_id'),
    SEQUENCE: t('mview_log_detail_sequence'),
    COMMIT_SCN_BASED: t('mview_log_detail_commit_scn_based'),
    INCLUDE_NEW_VALUES: t('mview_log_detail_include_new_values'),
    PURGE_ASYNCHRONOUS: t('mview_log_detail_purge_asynchronous'),
    PURGE_DEFERRED: t('mview_log_detail_purge_deferred'),
    PURGE_START_TEXT: t('mview_log_detail_purge_start_text'),
    PURGE_INTERVAL: t('mview_log_detail_purge_interval'),
    LAST_PURGE_TEXT: t('mview_log_detail_last_purge_text'),
    LAST_PURGE_STATUS: t('mview_log_detail_last_purge_status'),
    NUM_ROWS_PURGED: t('mview_log_detail_num_rows_purged'),
  };

  if (!props.isActive) return null;

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} data-testid="mview-log-window" sx={styles.rootBox}>
      {isLoading && <WindowLoadingIndicator />}
      {error && <Alert severity="error" action={<Button disabled={isLoading} onClick={retry}>{t('retry')}</Button>}>{t(error)}</Alert>}
      {props.isNew && <ObjectPickerDialog open={pickerOpen} dbType="oracle" fixedSchema={formData.targetSchema}
        initialCategory="TABLE" categories={TABLE_CATEGORIES} multiple={false} disabled={isLoading}
        title={t('target_table')} isObjectAdded={object => loggedTables.includes(object.name)}
        onConfirm={selectTable} onClose={() => setPickerOpen(false)} />}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}><Button variant="outlined" startIcon={<RefreshIcon />} disabled={isLoading} onClick={retry}>{t('reload')}</Button></Box>
      {!props.isNew && (
        <Box sx={styles.tabContainer}>
          <Tabs value={activeTab} onChange={(_e, val) => setActiveTab(val)} sx={styles.tabs}>
            <Tab disabled={isLoading} label={t("edit")} sx={styles.tabItem} />
            <Tab disabled={isLoading} label={t("log")} sx={styles.tabItem} />
            <Tab disabled={isLoading} label={t("source")} sx={styles.tabItem} />
            <Tab disabled={isLoading} label={t("view_information")} sx={styles.tabItem} />
          </Tabs>
        </Box>
      )}

      <Box sx={styles.mainContainer}>
        
        <Box sx={styles.leftPane}>
          
          <Box sx={styles.editorPane(props.isNew || activeTab === 0)}>
            <Paper elevation={1} sx={styles.cardPaper}>
              <Box sx={styles.headerBox}>
                <Typography variant="h6" fontWeight="bold">
                  {props.isNew ? t("create_mview_log") : t("edit_mview_log")}
                </Typography>
                <Box sx={styles.actionsBox}>
                  {!props.isNew && (
                    <Button disabled={!canDelete} variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} disableElevation>
                      {t("delete")}
                    </Button>
                  )}
                  <Button disabled={!canExecute} variant="contained" color="success" startIcon={<PlayArrowIcon />} onClick={handleExecute} disableElevation>
                    {t("execute")}
                  </Button>
                </Box>
              </Box>
              <Divider />
              {formData.targetTable && !isLoading && validation && <Alert severity="warning">{t(validation)}</Alert>}

              
              {!props.isNew && (
                <Alert severity="info" sx={styles.alertInfo}>
                  {t("materialized_view_log_edit_limitations")}
                </Alert>
              )}

              <Box sx={styles.flexGap2}>
                <FormControl disabled={isLoading} size="small" sx={styles.formControl250}>
                  <InputLabel>{t("target_schema_2")}</InputLabel>
                  <Select value={formData.targetSchema} label={t("target_schema_2")} onChange={(e) => setSchema(e.target.value)} disabled={isLoading || !props.isNew}>
                    {props.allSchemas.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
                
                <Box sx={styles.flex1}>
                  <Typography variant="caption">{t('target_table')}</Typography>
                  <Typography>{formData.targetSchema}.{formData.targetTable || '—'}</Typography>
                  {props.isNew && <Button disabled={isLoading || !formData.targetSchema} onClick={openPicker}>{t('select_table')}</Button>}
                </Box>
              </Box>

              {props.isNew && <Alert severity="info">{t('mview_log_picker_hint')}</Alert>}
              <Box component="fieldset" disabled={isLoading || !ready} sx={{ border: 0, p: 0, m: 0 }}>
                <Typography variant="subtitle2" sx={styles.sectionTitle}>{t("key_recording_with")}</Typography>
                <Box sx={styles.checkboxGroup}>
                  <FormControlLabel control={<Checkbox checked={formData.withPrimaryKey} onChange={(e) => setFormData({...formData, withPrimaryKey: e.target.checked})} disabled={isLoading || (!props.isNew && initialFormData?.withPrimaryKey) || !master?.primaryKey} />} label={t("primary_key")} />
                  <FormControlLabel control={<Checkbox checked={formData.withRowid} onChange={(e) => setFormData({...formData, withRowid: e.target.checked})} disabled={isLoading || (!props.isNew && initialFormData?.withRowid)} />} label={t("rowid")} />
                  <FormControlLabel control={<Checkbox checked={formData.withSequence} onChange={(e) => setFormData({...formData, withSequence: e.target.checked})} disabled={isLoading || (!props.isNew && initialFormData?.withSequence)} />} label={t("sequence")} />
                  
                  <FormControlLabel 
                    control={<Checkbox checked={formData.withCommitScn} onChange={(e) => setFormData({...formData, withCommitScn: e.target.checked})} disabled={isLoading || !props.isNew || master?.hasLob} />}
                    label={!props.isNew ? t("commit_scn_creation_only") : t("commit_scn")}
                    sx={styles.dynamicColor(!props.isNew)}
                  />
                  
                  <FormControlLabel control={<Checkbox checked={formData.withObjectId} onChange={(e) => setFormData({...formData, withObjectId: e.target.checked})} disabled={isLoading || (!props.isNew && initialFormData?.withObjectId) || !master?.objectTable} />} label={t("object_id")} />
                </Box>
              </Box>

              <Box component="fieldset" disabled={isLoading || !ready} sx={{ border: 0, p: 0, m: 0 }}>
                <Typography variant="subtitle2" sx={styles.sectionTitle}>{t("record_columns_filter")}</Typography>
                <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
                  {master?.columns.map(column => <FormControlLabel key={column.name}
                    control={<Checkbox size="small" checked={formData.filterColumns.includes(column.name)}
                      disabled={!column.eligible || Boolean(initialFormData?.filterColumns.includes(column.name))}
                      onChange={event => toggleColumn(column.name, event.target.checked)} />}
                    label={`${column.name} (${column.type})`} />)}
                </Box>
                <Typography variant="caption">{t('mview_log_column_hint')}</Typography>
              </Box>

              <Box component="fieldset" disabled={isLoading || !ready} sx={{ border: 0, p: 0, m: 0 }}>
                <Typography variant="subtitle2" sx={styles.sectionTitle}>{t("save_new_value")}</Typography>
                <FormControlLabel 
                  control={<Checkbox checked={formData.includingNewValues} onChange={(e) => setFormData({...formData, includingNewValues: e.target.checked})} disabled={isLoading || !ready} />}
                  label={<Typography variant="body2" >{t("including_new_values_saves_new_values_to_the_log_on_dml_execution")}</Typography>}
                />
              </Box>

            </Paper>

            <Paper elevation={1} sx={styles.alterSqlPaper}>
                <Box sx={styles.sqlHeader}>
                  <Typography variant="subtitle2" fontWeight="bold">{t('mview_log_pending_sql')}</Typography>
                  <Tooltip title={t("copy")}>
                    <span>
                      <IconButton disabled={isLoading} size="small" onClick={() => handleCopy(props.isNew ? createSql : alterSql)}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <Box sx={styles.alterSqlEditorBox}>
                  {/* Apply the CodeMirror theme option. */}
                  <MemoCodeMirror
                    value={props.isNew ? createSql : alterSql || `-- ${t("no_changes_found")}`}
                    extensions={editorExtensions} 
                    readOnly={true} 
                    basicSetup={basicSetupConfig} 
                    theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                  />
                </Box>
              </Paper>

          </Box>

          {!props.isNew && (
            <Box sx={{ flexGrow: 1, display: activeTab === 1 ? 'flex' : 'none', flexDirection: 'column', overflow: 'hidden' }}>
              <Alert severity="info">{t('mview_log_data_hint')}</Alert>
              {ready && logTableName ? (
                <MemoViewDataTab key={revision} schema={formData.targetSchema} viewName={logTableName} isActive={props.isActive && !isLoading && activeTab === 1} dateFormat={DEFAULT_DATETIME_FORMAT} />
              ) : (
                <Box sx={styles.emptyLogBox}>{t("failed_to_get_log_table_name")}</Box>
              )}
            </Box>
          )}

          {!props.isNew && (
            <Box sx={{ minHeight: 0, minWidth: 0, flexGrow: 1, display: activeTab === 2 ? 'flex' : 'none', flexDirection: 'column', p: 1 }}>
              <Paper elevation={1} sx={{ minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <Box sx={styles.sqlHeader}>
                  <Typography variant="subtitle2" fontWeight="bold">{t("create_materialized_view_log_statement_ddl")}</Typography>
                  <Tooltip title={t("copy")}>
                    <span>
                      <IconButton disabled={isLoading || !ready} aria-label={t("synonym_copy_saved")} size="small" onClick={() => handleCopy(metadata?.source || "")}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <Box sx={styles.createSqlEditorBox}>
                  {/* Apply the CodeMirror theme option. */}
                  <MemoCodeMirror
                    value={metadata?.source || ""}
                    height="100%" 
                    style={SOURCE_HOST_STYLE}
                    extensions={editorExtensions} 
                    readOnly={true} 
                    basicSetup={basicSetupConfig} 
                    theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                  />
                </Box>
              </Paper>
            </Box>
          )}

          {!props.isNew && activeTab === 3 && <Box sx={{ p: 3, overflow: 'auto' }}>
            <Typography variant="h6">{t('view_information')}</Typography>
            {metadata && Object.entries(metadata.details).map(([key, value]) => <Box key={key} sx={{ display: 'flex', gap: 2, my: 1 }}>
              <Typography sx={{ minWidth: 220 }}>{detailLabels[key] || key}</Typography>
              <Typography sx={{ overflowWrap: 'anywhere' }}>{value || '—'}</Typography>
            </Box>)}
          </Box>}

        </Box>

        {isConsoleOpen && (
          <React.Fragment>
            <Box 
              onMouseDown={() => setIsResizing(true)} 
              sx={styles.consoleResizer(isResizing)} 
            />
            
            <Paper elevation={1} sx={styles.consolePaper(consoleWidth)}>
              <Box sx={styles.consoleHeader}>
                <Tabs value={bottomTab} onChange={(_e, val) => setBottomTab(val)} sx={styles.consoleTabs}>
                  <Tab disabled={isLoading} label={t("console")} sx={styles.consoleTabItem} />
                </Tabs>
                <IconButton disabled={isLoading} size="small" onClick={() => setIsConsoleOpen(false)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={styles.consoleContent}>
                <Box sx={styles.consoleToolbar}>
                  <Tooltip title={t("clear_log")}>
                    <span>
                      <IconButton disabled={isLoading} color="error" onClick={() => setLogs([])} size="small">
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
                <Box sx={styles.consoleLogsArea}>
                  {logs.map((log, i) => (
                    <Box key={i} sx={styles.logItemBox}>
                      <Typography variant="caption" sx={styles.logItemHeader}>[{log.time}] {t("result_2")} {log.resultMsg}</Typography>
                      <Typography variant="body2" sx={styles.logItemSql}>{log.sql}</Typography>
                      {log.errorLines && log.errorLines.length > 0 && (
                        <Box sx={styles.logErrorBox}>
                          {log.errorLines.map((eLine, eIdx) => (
                            <Typography key={eIdx} variant="body2" sx={styles.logErrorText}>
                              {eLine}
                            </Typography>
                          ))}
                        </Box>
                      )}
                    </Box>
                  ))}
                  {logs.length === 0 && <Typography variant="body2" color="text.secondary" sx={styles.logEmpty}>{t("no_execution_logs")}</Typography>}
                </Box>
              </Box>
            </Paper>
          </React.Fragment>
        )}

      </Box>
    </Box>
  );
}
