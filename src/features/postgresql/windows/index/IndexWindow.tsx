// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { IndexTablePicker } from '@/features/index/IndexTablePicker';
import { IndexColumnOrder } from '@/features/index/IndexColumnOrder';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";

import React, { memo, useMemo, useCallback } from 'react';
import { 
  Box, Paper, Typography, Button, Checkbox, FormControlLabel,
  FormControl, InputLabel, Select, MenuItem, Tabs, Tab,
  Divider, IconButton, Tooltip, Alert, List, ListItem, ListItemText, TextField, ListItemButton
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { DataGrid, jaJP, enUS } from '@mui/x-data-grid';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { CompletionContext } from '@codemirror/autocomplete';
import { useTranslation } from 'react-i18next';

import { pgDialect, pgBuiltinCompletions, pgFunctionHighlighting } from '../common/pgDialect';
import { useDbCompletions } from "@/features/sql/hooks/useDbCompletions";
import { useIndexWindow, type IndexWindowProps, type LogEntry } from './useIndexWindow';

// Extend the source editor to the bottom of its available area.
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  rootBox: { minHeight: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, height: '100%', bgcolor: 'background.default', overflow: 'hidden', position: 'relative' as const, border: 0, m: 0, p: 0, minWidth: 0 },
  tabContainer: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2 },
  tabs: { minHeight: 40 },
  tabItem: { minHeight: 40, py: 0 },
  mainContainer: { minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'row' as const, overflow: 'hidden' },
  leftPane: { minHeight: 0, minWidth: 0, flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  editorPane: { flexGrow: 1, p: 3, overflowY: 'auto' as const, alignItems: 'center', flexDirection: 'column' as const, gap: 3 },
  cardPaper: { p: 3, maxWidth: 800, width: '100%', display: 'flex', flexDirection: 'column' as const, gap: 3, bgcolor: 'background.paper' },
  headerBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerActions: { display: 'flex', alignItems: 'center' },
  deleteBtn: { mr: 2 },
  alertInfo: { py: 0 },
  flexGap2: { display: 'flex', gap: 2 },
  formControl200: { width: 200 },
  flex1: { flexGrow: 1 },
  checkboxGroup: { display: 'flex', gap: 2, alignItems: 'center', bgcolor: 'action.hover', p: 2, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  checkboxLabel: { fontWeight: 'bold', width: 60, color: 'text.secondary' },
  ml1: { ml: 1 },
  alignCenterGap2: { display: 'flex', gap: 2, alignItems: 'center' },
  codeBoxWrapper: { mt: 1 },
  codeBoxLabel: { mb: 0.5, display: 'block' },
  codeBox: { border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', height: 250 },
  colSelectorContainer: { display: 'flex', gap: 2, height: 250 },
  colPane: { flex: 1, display: 'flex', flexDirection: 'column' as const, userSelect: 'none' as const },
  colLabel: { mb: 0.5 },
  listPaper: (isNew: boolean) => ({ flexGrow: 1, overflowY: 'auto' as const, bgcolor: !isNew ? 'action.hover' : 'background.paper' }),
  listItemBtn: { py: 0.2 },
  listItemText: { '& .MuiListItemText-primary': { fontSize: '0.85rem' } },
  arrowButtonsContainer: { display: 'flex', flexDirection: 'column' as const, justifyContent: 'center', gap: 1 },
  arrowBtn: { border: '1px solid', borderColor: 'primary.main', borderRadius: 1 },
  ddlPaper: { maxWidth: 800, width: '100%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  ddlHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  ddlEditorBox: { flexGrow: 1, overflow: 'auto' as const, '& .cm-editor': { minHeight: '60px', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  ddlEditorBoxFull: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  statsPane: { minHeight: 0, minWidth: 0, flexGrow: 1, flexDirection: 'column' as const, p: 1 },
  statsPaper: { minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  statsHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' },
  statsContent: { flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const },
  dataGridRoot: { border: 0, '& .even-row': { bgcolor: 'action.hover' }, '& .even-row:hover': { bgcolor: 'action.selected' } },
  statsEmpty: { p: 3 },
  consoleResizer: { width: 4, cursor: 'col-resize', transition: 'background-color 0.2s' },
  consolePaper: { flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRadius: 0, bgcolor: 'background.paper' },
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

const basicSetupConfig = { lineNumbers: true, autocompletion: true };
const basicSetupSimple = { lineNumbers: true };

// Memoize individual list rows.
interface ColumnListItemProps {
  col: string;
  isSelected: boolean;
  disabled: boolean;
  onMouseDown: (e: React.MouseEvent, col: string) => void;
  onMouseEnter: (e: React.MouseEvent, col: string) => void;
  onDoubleClick: (col: string) => void;
}

const ColumnListItem = memo(({
  col,
  isSelected,
  disabled,
  onMouseDown,
  onMouseEnter,
  onDoubleClick
}: ColumnListItemProps) => {
  return (
    <ListItem disablePadding>
      <ListItemButton 
        selected={isSelected} 
        onMouseDown={(e) => onMouseDown(e, col)}
        onClick={e => { if (e.detail === 0) onMouseDown(e, col); }}
        aria-pressed={isSelected}
        onMouseEnter={(e) => onMouseEnter(e, col)}
        onDoubleClick={() => onDoubleClick(col)}
        disabled={disabled}
        sx={styles.listItemBtn}
        disableRipple
      >
        <ListItemText primary={col} sx={styles.listItemText} />
      </ListItemButton>
    </ListItem>
  );
});
ColumnListItem.displayName = 'ColumnListItem';

// Single-column list container.
const ColumnListPane = memo(({
  title,
  columns,
  selectedList,
  isNew,
  onMouseDown,
  onMouseEnter,
  onDoubleClick
}: {
  title: string;
  columns: string[];
  selectedList: string[];
  isNew: boolean;
  onMouseDown: (e: React.MouseEvent, col: string) => void;
  onMouseEnter: (e: React.MouseEvent, col: string) => void;
  onDoubleClick: (col: string) => void;
}) => {
  return (
    <Box sx={styles.colPane}>
      <Typography variant="caption" fontWeight="bold" sx={styles.colLabel}>{title}</Typography>
      <Paper variant="outlined" sx={styles.listPaper(isNew)}>
        <List dense disablePadding>
          {columns.map((col) => (
            <ColumnListItem
              key={col}
              col={col}
              isSelected={selectedList.includes(col)}
              disabled={!isNew}
              onMouseDown={onMouseDown}
              onMouseEnter={onMouseEnter}
              onDoubleClick={onDoubleClick}
            />
          ))}
        </List>
      </Paper>
    </Box>
  );
});
ColumnListPane.displayName = 'ColumnListPane';

// Standalone expression editor component.
const FunctionExpressionEditor = memo(({ 
  value, 
  onChange, 
  readOnly, 
  isDark, 
  tableColumns 
}: { 
  value: string; 
  onChange: (val: string) => void; 
  readOnly: boolean; 
  isDark: boolean; 
  tableColumns: string[]; 
}) => {
  const { dbCompletions, dbSchema } = useDbCompletions();

  const editorExtensions = useMemo(() => {
    const colCompletions = tableColumns.map(col => ({
      label: col,
      type: 'property'
    }));

    return [
      sql({ dialect: pgDialect, upperCaseKeywords: true, schema: dbSchema }),
      pgFunctionHighlighting, 
      pgDialect.language.data.of({
        autocomplete: (context: CompletionContext) => {
          const word = context.matchBefore(/\w*/);
          const dotBefore = context.matchBefore(/\.\w*/);
          if (dotBefore) return null;
          if (!word || (word.from === word.to && !context.explicit)) return null;
          return {
            from: word.from,
            options: [...dbCompletions, ...pgBuiltinCompletions, ...colCompletions]
          };
        }
      })
    ];
  }, [dbSchema, tableColumns, dbCompletions]);

  return (
    <Box sx={styles.codeBox}>
      <CodeMirror 
        value={value} 
        onChange={onChange} 
        extensions={editorExtensions} 
        basicSetup={basicSetupConfig} 
        readOnly={readOnly}
        height="100%"
        theme={isDark ? 'dark' : 'light'} 
      />
    </Box>
  );
});
FunctionExpressionEditor.displayName = 'FunctionExpressionEditor';

// Entire column selection pane.
const ColumnSelectorPane = memo(({
  isNew,
  availableColumns,
  selectedColumns,
  leftSelected,
  rightSelected,
  handleLeftMouseDown,
  handleLeftMouseEnter,
  handleLeftDoubleClick,
  handleRightMouseDown,
  handleRightMouseEnter,
  handleRightDoubleClick,
  handleMoveRight,
  handleMoveLeft
}: Pick<ReturnType<typeof useIndexWindow>, 'availableColumns' | 'selectedColumns' | 'leftSelected' | 'rightSelected' | 'handleLeftMouseDown' | 'handleLeftMouseEnter' | 'handleLeftDoubleClick' | 'handleRightMouseDown' | 'handleRightMouseEnter' | 'handleRightDoubleClick' | 'handleMoveRight' | 'handleMoveLeft'> & { isNew: boolean }) => {
  const { t } = useTranslation();
  return (
    <Box sx={styles.colSelectorContainer}>
      <ColumnListPane
        title={t("table_columns")}
        columns={availableColumns}
        selectedList={leftSelected}
        isNew={isNew}
        onMouseDown={handleLeftMouseDown}
        onMouseEnter={handleLeftMouseEnter}
        onDoubleClick={handleLeftDoubleClick}
      />

      <Box sx={styles.arrowButtonsContainer}>
        <IconButton size="small" color="primary" onClick={handleMoveRight} disabled={!isNew || leftSelected.length === 0} sx={styles.arrowBtn} disableRipple>
          <KeyboardArrowRightIcon />
        </IconButton>
        <IconButton size="small" color="primary" onClick={handleMoveLeft} disabled={!isNew || rightSelected.length === 0} sx={styles.arrowBtn} disableRipple>
          <KeyboardArrowLeftIcon />
        </IconButton>
      </Box>

      <ColumnListPane
        title={t("index_target_columns")}
        columns={selectedColumns}
        selectedList={rightSelected}
        isNew={isNew}
        onMouseDown={handleRightMouseDown}
        onMouseEnter={handleRightMouseEnter}
        onDoubleClick={handleRightDoubleClick}
      />
    </Box>
  );
});
ColumnSelectorPane.displayName = 'ColumnSelectorPane';

// ALTER INDEX statement card.
const IndexAlterDdlCard = memo(({ alterSql, isDark }: { alterSql: string; isDark: boolean }) => {
  const { t } = useTranslation();
  const alterExtensions = useMemo(() => [sql({ dialect: pgDialect })], []);

  return (
    <Paper elevation={1} sx={styles.ddlPaper}>
      <Box sx={styles.ddlHeader}>
        <Typography variant="subtitle2" fontWeight="bold">{t("alter_index_statement_ddl")}</Typography>
        <Tooltip title={t("copy")}>
          <IconButton size="small" onClick={() => navigator.clipboard.writeText(alterSql)} disableRipple>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={styles.ddlEditorBox}>
        <CodeMirror 
          value={alterSql} 
          extensions={alterExtensions} 
          readOnly={true} 
          basicSetup={basicSetupSimple} 
          theme={isDark ? 'dark' : 'light'} 
        />
      </Box>
    </Paper>
  );
});
IndexAlterDdlCard.displayName = 'IndexAlterDdlCard';

// Statistics tab pane.
const IndexStatsPane = memo(({ indexStats, statRows, statColumns, active }: Pick<ReturnType<typeof useIndexWindow>, 'indexStats' | 'statRows' | 'statColumns'> & { active: boolean }) => {
  const { t, i18n } = useTranslation();
  const localeText = (i18n.resolvedLanguage ?? i18n.language).startsWith('ja') ? jaJP.components.MuiDataGrid.defaultProps.localeText : enUS.components.MuiDataGrid.defaultProps.localeText;
  return (
    <Paper elevation={1} sx={styles.statsPaper}>
      <Box sx={styles.statsHeader}>
        <Typography variant="subtitle2" fontWeight="bold">{t("index_statistics")}</Typography>
      </Box>
      <Box sx={styles.statsContent}>
        {indexStats ? (
          <GridViewport active={active}><DataGrid
            rows={statRows} 
            columns={statColumns} 
            density="compact" 
            localeText={localeText}
            hideFooter
            disableRowSelectionOnClick
            getRowClassName={(params) => params.indexRelativeToCurrentPage % 2 === 0 ? 'even-row' : ''}
            sx={styles.dataGridRoot} 
          /></GridViewport>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={styles.statsEmpty}>{t("no_statistics_available_please_execute_analyze")}</Typography>
        )}
      </Box>
    </Paper>
  );
});
IndexStatsPane.displayName = 'IndexStatsPane';

// Source tab pane.
const IndexSourcePane = memo(({ createSql, isDark }: { createSql: string; isDark: boolean }) => {
  const { t } = useTranslation();
  const simpleExtensions = useMemo(() => [sql({ dialect: pgDialect })], []);

  return (
    <Paper elevation={1} sx={styles.statsPaper}>
      <Box sx={styles.ddlHeader}>
        <Typography variant="subtitle2" fontWeight="bold">{t("create_index_statement_ddl")}</Typography>
        <Tooltip title={t("copy")}>
          <IconButton size="small" onClick={() => navigator.clipboard.writeText(createSql)} disableRipple>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={styles.ddlEditorBoxFull}>
        <CodeMirror 
          value={createSql} 
          height="100%" 
          style={SOURCE_HOST_STYLE}
          extensions={simpleExtensions} 
          readOnly={true} 
          basicSetup={basicSetupSimple} 
          theme={isDark ? 'dark' : 'light'} 
        />
      </Box>
    </Paper>
  );
});
IndexSourcePane.displayName = 'IndexSourcePane';

// Console log pane.
const ConsoleLogPane = memo(({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) => {
  const { t } = useTranslation();
  return (
    <>
      <Box sx={styles.consoleToolbar}>
        <Tooltip title={t("clear_log")}>
          <IconButton color="error" onClick={onClear} size="small" disableRipple>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={styles.consoleLogsArea}>
        {logs.map((log, i) => (
          <Box key={i} sx={styles.logItemBox}>
            <Typography variant="caption" sx={styles.logItemHeader}>[{log.time}] {t("result_3")} {log.resultMsg}</Typography>
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
    </>
  );
});
ConsoleLogPane.displayName = 'ConsoleLogPane';

function IndexWindowPostgresqlComponent(props: IndexWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  
  const {
    activeTab, setActiveTab, bottomTab, setBottomTab,
    logs, setLogs, isConsoleOpen, setIsConsoleOpen,
    consoleWidth, isResizing, setIsResizing,
    isLoading, formData, updateFormField, canExecute, loadError, retryLoad, moveColumn, details, sourceSql,
    availableColumns, selectedColumns, tableColumns,
    leftSelected, rightSelected, indexStats,
    handleLeftMouseDown, handleLeftMouseEnter,
    handleRightMouseDown, handleRightMouseEnter,
    handleMoveRight, handleMoveLeft,
    handleLeftDoubleClick, handleRightDoubleClick,
    handleDelete, handleExecute,
    alterSql,
    statColumns, statRows
  } = useIndexWindow(props);

  const handleActiveTabChange = useCallback((_e: React.SyntheticEvent, val: number) => setActiveTab(val), [setActiveTab]);
  const handleBottomTabChange = useCallback((_e: React.SyntheticEvent, val: number) => setBottomTab(val), [setBottomTab]);
  const handleClearLogs = useCallback(() => setLogs([]), [setLogs]);

  const handleFunctionExpressionChange = useCallback(
    (val: string) => updateFormField('functionExpression', val),
    [updateFormField]
  );

  if (!props.isActive) return null;

  return (
    <Box data-testid="index-window" onKeyDown={event => {
      if (!event.defaultPrevented && event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); moveColumn(event.key === 'ArrowUp' ? -1 : 1);
      }
    }} component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox}>
      {isLoading && <WindowLoadingIndicator />}
      {loadError && <Alert severity="warning" action={<Button disabled={isLoading} onClick={retryLoad}>{t('retry')}</Button>}>{t('index_load_failed')}</Alert>}
      {!!details?.constraints.length && <Alert severity="info">{details.constraints.map(constraint => t('index_constraint_info', { name: constraint.name, kind: constraint.kind, table: `${constraint.schema}.${constraint.table}`, references: constraint.references })).join(' / ')}</Alert>}
      {!props.isNew && (
        <Box sx={styles.tabContainer}>
          <Tabs value={activeTab} onChange={handleActiveTabChange} sx={styles.tabs}>
            <Tab disabled={isLoading} label={t("edit")} sx={styles.tabItem} disableRipple />
            <Tab disabled={isLoading} label={t("statistics")} sx={styles.tabItem} disableRipple />
            <Tab disabled={isLoading} label={t("source")} sx={styles.tabItem} disableRipple />
          </Tabs>
        </Box>
      )}

      <Box sx={styles.mainContainer}>
        <Box sx={styles.leftPane}>
          
          <Box sx={styles.editorPane} display={(props.isNew || activeTab === 0) ? 'flex' : 'none'}>
            <Paper elevation={1} sx={styles.cardPaper}>
              {/* Card header. */}
              <Box sx={styles.headerBox}>
                <Typography variant="h6" fontWeight="bold">
                  {props.isNew ? t("create_index_index") : t("edit_index") + props.indexName}
                </Typography>
                <Box sx={styles.headerActions}>
                  {!props.isNew && (
                    <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} disabled={isLoading || !canExecute} sx={styles.deleteBtn} disableElevation disableRipple>
                      {t("delete")}
                    </Button>
                  )}
                  <Button variant="contained" color="success" startIcon={<PlayArrowIcon />} onClick={handleExecute} disabled={isLoading || !canExecute} disableElevation disableRipple>
                    {props.isNew ? t("create") : t("change")}
                  </Button>
                </Box>
              </Box>
              <Divider />
              
              {!props.isNew && (
                <Alert severity="info" sx={styles.alertInfo}>
                  {t("postgres_index_edit_limitations")}
                </Alert>
              )}

              {/* Schema and name input. */}
              <Box sx={styles.flexGap2}>
                <FormControl size="small" sx={styles.formControl200}>
                  <InputLabel>{t("schema")}</InputLabel>
                  <Select 
                    value={formData.targetSchema} 
                    label={t("schema")}
                    onChange={(e) => updateFormField('targetSchema', e.target.value)} 
                    disabled={!props.isNew}
                  >
                    {props.allSchemas.map((s: string) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                  </Select>
                </FormControl>
                
                <TextField 
                  label={t("name")}
                  size="small" 
                  sx={styles.flex1} 
                  required 
                  value={formData.indexName} 
                  onChange={(e) => updateFormField('indexName', e.target.value)} 
                />
              </Box>

              {/* Type and UNIQUE settings. */}
              <Box sx={styles.checkboxGroup}>
                <Typography variant="body2" sx={styles.checkboxLabel}>{t("type_2")}</Typography>
                <FormControl size="small" sx={styles.formControl200}>
                  <Select 
                    value={formData.indexType} 
                    onChange={(e) => updateFormField('indexType', e.target.value)} 
                    disabled={!props.isNew}
                  >
                    <MenuItem value="NORMAL">{t("table_index")}</MenuItem>
                    <MenuItem value="PRIMARY KEY">{t("primary_key_2")}</MenuItem>
                    <MenuItem value="FUNCTION">{t("expression_index")}</MenuItem>
                  </Select>
                </FormControl>

                <FormControlLabel 
                  control={
                    <Checkbox 
                      checked={formData.isUnique} 
                      onChange={(e) => updateFormField('isUnique', e.target.checked)} 
                      disabled={!props.isNew || formData.indexType === 'PRIMARY KEY'} 
                      size="small" 
                      disableRipple
                    />
                  } 
                  label={t("no_duplicates_unique")} sx={styles.ml1}
                />
              </Box>

              {/* Table selection. */}
              <Box sx={styles.alignCenterGap2}>
                <Typography variant="body2" sx={styles.checkboxLabel}>{t("table_2")}</Typography>
                <IndexTablePicker database="postgresql" schema={formData.targetSchema} table={formData.targetTable} disabled={!props.isNew || isLoading} onChange={name => updateFormField('targetTable', name)} />
              </Box>

              {/* Expression editor or column selector. */}
              {formData.indexType === 'FUNCTION' ? (
                <Box sx={styles.codeBoxWrapper}>
                  <Typography variant="caption" fontWeight="bold" sx={styles.codeBoxLabel}>
                    {t("function_expr_e_g_lower_column_name")}
                  </Typography>
                  <FunctionExpressionEditor 
                    value={formData.functionExpression}
                    onChange={handleFunctionExpressionChange}
                    readOnly={!props.isNew}
                    isDark={isDark}
                    tableColumns={tableColumns}
                  />
                </Box>
              ) : (
                <ColumnSelectorPane
                  isNew={props.isNew}
                  availableColumns={availableColumns}
                  selectedColumns={selectedColumns}
                  leftSelected={leftSelected}
                  rightSelected={rightSelected}
                  handleLeftMouseDown={handleLeftMouseDown}
                  handleLeftMouseEnter={handleLeftMouseEnter}
                  handleLeftDoubleClick={handleLeftDoubleClick}
                  handleRightMouseDown={handleRightMouseDown}
                  handleRightMouseEnter={handleRightMouseEnter}
                  handleRightDoubleClick={handleRightDoubleClick}
                  handleMoveRight={handleMoveRight}
                  handleMoveLeft={handleMoveLeft}
                />
              )}
              {formData.indexType !== 'FUNCTION' && <IndexColumnOrder columns={selectedColumns} selected={rightSelected} disabled={!props.isNew || isLoading || !canExecute} onMove={moveColumn} />}
            </Paper>

            {!props.isNew && (
              <IndexAlterDdlCard alterSql={alterSql} isDark={isDark} />
            )}
          </Box>

          {!props.isNew && (
            <Box sx={styles.statsPane} display={activeTab === 1 ? 'flex' : 'none'}>
              <IndexStatsPane active={props.isActive && activeTab === 1} indexStats={indexStats} statRows={statRows} statColumns={statColumns} />
            </Box>
          )}

          {!props.isNew && (
            <Box sx={styles.statsPane} display={activeTab === 2 ? 'flex' : 'none'}>
              <IndexSourcePane createSql={sourceSql} isDark={isDark} />
            </Box>
          )}

        </Box>

        {isConsoleOpen && (
          <>
            <Box 
              onMouseDown={() => setIsResizing(true)} 
              sx={{ ...styles.consoleResizer, bgcolor: isResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' } }} 
            />
            
            <Paper elevation={1} sx={{ ...styles.consolePaper, width: consoleWidth }}>
              <Box sx={styles.consoleHeader}>
                <Tabs value={bottomTab} onChange={handleBottomTabChange} sx={styles.consoleTabs}>
                  <Tab disabled={isLoading} label={t("console")} sx={styles.consoleTabItem} disableRipple />
                </Tabs>
                <IconButton size="small" onClick={() => setIsConsoleOpen(false)} disableRipple>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={styles.consoleContent}>
                <ConsoleLogPane logs={logs} onClear={handleClearLogs} />
              </Box>
            </Paper>
          </>
        )}
      </Box>
    </Box>
  );
}

export default memo(IndexWindowPostgresqlComponent);
