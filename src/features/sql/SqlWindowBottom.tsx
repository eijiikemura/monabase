// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCellValueInspector, cellMenuTrigger, type CellSnapshot } from '@/components/data/CellValueInspector';
import { GridViewport } from '@/features/data-grid/GridViewport';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { getRowIdentity } from '@/features/data-grid/rowIdentity';
import type { ExplainNode } from './explainTypes';
import { useSqlWindowBottom, type SqlWindowBottomProps } from './useSqlWindowBottom';
import type { SqlHistoryEntry } from '@/shared/types/sqlTypes';
import { type GridRowClassNameParams, type GridRowParams, DataGrid, jaJP, enUS } from '@mui/x-data-grid';

import React, { useState, useMemo, useCallback, memo } from 'react';
import { 
  Box, Paper, Typography, IconButton, Tabs, Tab, Collapse, Button, Tooltip, Menu, TextField, Checkbox, FormControlLabel
} from '@mui/material';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'; 
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'; 
import ChevronRightIcon from '@mui/icons-material/ChevronRight'; 
import AiRequestButton from '../ai/AiRequestButton';
import { useTranslation } from 'react-i18next';

import ExportDialog from "@/components/data/ExportDialog";

const styles = {
  treeNodeRow: (isEvenRow: boolean) => ({ display: 'flex', alignItems: 'center', py: 0.5, px: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: isEvenRow ? 'action.hover' : 'transparent', '&:hover': { bgcolor: 'action.selected' } }),
  treeNodeIndent: (depth: number) => ({ width: 24 + depth * 20, flexShrink: 0, display: 'flex', justifyContent: 'flex-end', pr: 0.5 }),
  treeNodeBtn: { p: 0 },
  treeNodeId: { width: 30, color: 'text.secondary', textAlign: 'right' as const, pr: 1, fontFamily: 'monospace', flexShrink: 0 },
  treeNodeOp: (depth: number, isAlertOp: boolean) => ({ fontWeight: 'bold', width: 250 - depth * 20, flexShrink: 0, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isAlertOp ? 'error.main' : 'inherit' }),
  treeNodeName: (isTable: boolean) => ({ width: 150, flexShrink: 0, color: isTable ? 'primary.main' : 'text.primary', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: isTable ? 'pointer' : 'default', textDecoration: isTable ? 'underline' : 'none', '&:hover': isTable ? { color: 'primary.dark', bgcolor: 'action.hover' } : {} }),
  treeNodeRows: { width: 80, textAlign: 'right' as const, pr: 2, color: 'text.secondary', fontFamily: 'monospace', flexShrink: 0 },
  treeNodeBytes: { width: 80, textAlign: 'right' as const, pr: 2, color: 'text.secondary', fontFamily: 'monospace', flexShrink: 0 },
  treeNodeCost: { width: 100, textAlign: 'right' as const, pr: 2, color: 'text.secondary', fontFamily: 'monospace', flexShrink: 0 },
  treeNodeTime: { width: 80, textAlign: 'right' as const, color: 'text.secondary', fontFamily: 'monospace', flexShrink: 0 },
  treeRoot: { display: 'flex', flexDirection: 'column' as const, height: '100%', bgcolor: 'background.paper', minHeight: 0 },
  treeHeaderBox: { p: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' },
  treeHeaderText: { fontWeight: 'bold' },
  treeScrollBox: { flexGrow: 1, overflowY: 'auto' as const, minHeight: 0 },
  treeContentBox: { minWidth: 800 },
  treeColHeaderBox: { display: 'flex', py: 1, px: 1, bgcolor: 'action.selected', borderBottom: '1px solid', borderColor: 'divider', fontWeight: 'bold' },
  treeCol1: { width: 24, flexShrink: 0 },
  treeCol2: { width: 30, textAlign: 'right' as const, pr: 1, flexShrink: 0 },
  treeCol3: { width: 250, flexShrink: 0 },
  treeCol4: { width: 150, flexShrink: 0 },
  treeCol5: { width: 80, textAlign: 'right' as const, pr: 2, flexShrink: 0 },
  treeCol6: { width: 80, textAlign: 'right' as const, pr: 2, flexShrink: 0 },
  treeCol7: { width: 100, textAlign: 'right' as const, pr: 2, flexShrink: 0 },
  treeCol8: { width: 80, textAlign: 'right' as const, flexShrink: 0 },
  treePredicatesBox: { mt: 2, p: 2, bgcolor: 'action.hover', borderTop: '1px solid', borderColor: 'divider' },
  treePredicatesText: { fontFamily: 'monospace', fontSize: '0.85rem', whiteSpace: 'pre-wrap', color: 'text.primary' },
  rootPaper: { flexGrow: 1, width: '100%', minHeight: 0, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  tabsBorder: { borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', minWidth: 0, flexShrink: 0 },
  tabs: { minHeight: 36 },
  tabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  tabContentBox: (isVisible: boolean, isLogOrHistory?: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0, height: '100%', position: 'relative' as const, bgcolor: isLogOrHistory ? 'background.default' : 'transparent', overflow: 'hidden' }),
  resultActions: { display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0, ml: 'auto', pr: 0.5 },
  aiBtn: { mr: 0.5 },
  gridContainer: { display: 'flex', flexDirection: 'column' as const, flexGrow: 1, width: '100%', height: '100%', minHeight: 0, overflow: 'hidden' },
  gridRoot: { border: 0, height: '100%', '& .even-row': { bgcolor: 'action.hover' }, '& .even-row:hover': { bgcolor: 'action.selected' } },
  logsToolbar: { display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, overflowX: 'auto' as const, p: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' },
  logsArea: { flexGrow: 1, overflowY: 'auto' as const, p: 1 },
  logItemBox: { mb: 1, pb: 1, borderBottom: '1px solid', borderColor: 'divider' },
  logItemHeader: { fontWeight: 'bold', color: 'text.secondary' },
  logItemSql: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.primary', mt: 0.5, bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  logErrorBox: { mt: 1, p: 1, bgcolor: 'background.paper', color: 'text.primary', borderRadius: 1, border: '1px solid', borderColor: 'error.main' },
  logErrorLine: (isClickable: boolean) => ({ whiteSpace: 'pre-wrap', marginBottom: '2px', color: 'inherit', cursor: isClickable ? 'pointer' : 'text', fontFamily: 'monospace', fontSize: '0.85rem', ...(isClickable ? { display: 'block', width: '100%', p: 0, border: 0, bgcolor: 'transparent', textAlign: 'left' as const, fontSize: 'inherit', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } } : {}), '&:hover': isClickable ? { textDecoration: 'underline' } : {} }),
  logEmpty: { p: 2, textAlign: 'center' as const },
  historyToolbar: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 0.5, flexShrink: 0, overflowX: 'auto' as const, p: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' },
  historyDesc: { color: 'text.secondary', flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', alignSelf: 'center', ml: 1 },
  historyGridRoot: { border: 0, flexGrow: 1, '& .even-row': { bgcolor: 'action.hover' }, '& .even-row:hover': { bgcolor: 'action.selected' }, '& .MuiDataGrid-row:hover': { cursor: 'pointer' } }
};

export const ExplainTreeNode = memo(({ node, depth = 0, dbType }: { node: ExplainNode, depth?: number, dbType?: 'oracle' | 'postgresql' }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isTable = Boolean(node.table);
  const opUpper = node.operation ? node.operation.toUpperCase() : '';
  
  // Select warning checks by database type.
  const isAlertOp = dbType === 'oracle' 
    ? (opUpper.includes('TABLE ACCESS FULL') || (opUpper.includes('INDEX FULL SCAN') && !opUpper.includes('INDEX FAST FULL SCAN')) || opUpper.includes('INDEX SKIP SCAN'))
    : opUpper.includes('SEQ SCAN');

  const isEvenRow = !isNaN(parseInt(node.id, 10)) && parseInt(node.id, 10) % 2 === 0;

  const handleTableClick = useCallback(() => {
    if (node.table) {
      window.dispatchEvent(new CustomEvent('open-table-tab', {
        detail: { tableName: qualifiedObjectName(node.table), targetTab: 'structure' }
      }));
    }
  }, [node.table]);

  const toggleExpand = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);
  
  return (
    <Box>
      <Box sx={styles.treeNodeRow(isEvenRow)}>
        <Box sx={styles.treeNodeIndent(depth)}>
          {hasChildren ? <IconButton size="small" onClick={toggleExpand} sx={styles.treeNodeBtn} disableRipple>{expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}</IconButton> : <span style={{ width: 20 }} />}
        </Box>
        <Typography variant="body2" sx={styles.treeNodeId}>{node.hasAsterisk ? '*' : ''}{node.id}</Typography>
        <Typography variant="body2" sx={styles.treeNodeOp(depth, isAlertOp)} title={node.operation}>{node.operation}</Typography>
        <Typography variant="body2" sx={styles.treeNodeName(isTable)} onClick={handleTableClick}>{node.name}</Typography>
        <Typography variant="body2" sx={styles.treeNodeRows}>{node.rowsVal}</Typography>
        <Typography variant="body2" sx={styles.treeNodeBytes}>{node.bytes}</Typography>
        <Typography variant="body2" sx={styles.treeNodeCost}>{node.cost}</Typography>
        <Typography variant="body2" sx={styles.treeNodeTime}>{node.time}</Typography>
      </Box>
      {hasChildren && (
        <Collapse in={expanded} unmountOnExit>
          <Box>{node.children.map((child, idx: number) => (
            <ExplainTreeNode key={`${child.id}-${idx}`} node={child} depth={depth + 1} dbType={dbType} />
          ))}</Box>
        </Collapse>
      )}
    </Box>
  );
});
ExplainTreeNode.displayName = 'ExplainTreeNode';

const initialPagination = { pagination: { paginationModel: { pageSize: 100 } } };
const pageSizeOptions = [50, 100, 500];
const staticSlotProps = { baseCheckbox: { disableRipple: true } };
const getRowClassNameStatic = (params: GridRowClassNameParams) => params.indexRelativeToCurrentPage % 2 === 0 ? 'even-row' : '';
const explainDummyColumns = [{field: 'PLAN_TABLE_OUTPUT', headerName: 'PLAN_TABLE_OUTPUT'}];

const fastGetRowId = getRowIdentity;

const SqlWindowBottomComponent = (props: SqlWindowBottomProps) => {
  const { t, i18n } = useTranslation();
  const isEnglish = i18n.language === 'en';
  
  const dataGridLocaleText = useMemo(() => {
    return isEnglish ? enUS.components.MuiDataGrid.defaultProps.localeText : jaJP.components.MuiDataGrid.defaultProps.localeText;
  }, [isEnglish]);
  
  const {
    includeBindValues, setIncludeBindValues,
    resolvedDbType,
    isTransposed, 
    setIsTransposed, 
    displayColumns, 
    displayRows, 
    historyColumns, 
    parsedExplain, 
    handleExportForAI
  } = useSqlWindowBottom(props);

  const handleTabChange = useCallback((_e: React.SyntheticEvent, newValue: number) => {
    props.setBottomTab(newValue);
  }, [props]);

  const handleToggleTranspose = useCallback(() => {
    setIsTransposed(prev => !prev);
  }, [setIsTransposed]);

  const cellInspector = useCellValueInspector();
  const [cellContext, setCellContext] = useState<{ x: number; y: number; cell: CellSnapshot } | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [logQuery, setLogQuery] = useState('');
  const [onlyLogIssues, setOnlyLogIssues] = useState(false);
  const filteredLogs = useMemo(() => {
    const query = logQuery.trim().toLocaleLowerCase();
    return props.logs.filter(log => (!onlyLogIssues || Boolean(log.errorLines?.length)) &&
      (!query || [log.sql, log.resultMsg, ...(log.errorLines || [])].some(text => text.toLocaleLowerCase().includes(query))));
  }, [logQuery, onlyLogIssues, props.logs]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyPage, setHistoryPage] = useState(0);
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLocaleLowerCase();
    return query ? props.historyLogs.filter(entry => entry.sql.toLocaleLowerCase().includes(query)) : props.historyLogs;
  }, [historyQuery, props.historyLogs]);
  const selectedHistory = filteredHistory.find(row => (row.id || row.executeTime) === selectedHistoryId);
  const openHistory = useCallback((entry: SqlHistoryEntry) => {
    window.dispatchEvent(new CustomEvent('open-sql-tab', { detail: { initialSql: entry.sql } }));
  }, []);
  const handleHistoryDoubleClick = useCallback((params: GridRowParams<SqlHistoryEntry>) => {
    openHistory(params.row);
  }, [openHistory]);
  const summary = props.resultSummary;
  const duration = summary?.durationMs == null ? '—' : summary.durationMs.toLocaleString(i18n.language, { maximumFractionDigits: 2 });
  const summaryText = summary ? summary.rowCount === null ? t('sql_plan_summary', { duration })
    : t('sql_result_summary', { count: summary.rowCount, total: summary.rowCount.toLocaleString(i18n.language), duration }) : '';

  const hidePagination = displayRows.length <= 100;

  return (
    <Paper elevation={1} sx={styles.rootPaper}>
      <Menu disableRestoreFocus open={cellContext !== null} onClose={() => { setCellContext(null); cellInspector.restoreCellFocus(); }} anchorReference="anchorPosition"
        anchorPosition={cellContext ? { left: cellContext.x, top: cellContext.y } : undefined}>
        {cellInspector.menuItems(cellContext?.cell || null, () => setCellContext(null))}
      </Menu>
      {cellInspector.dialog}
      <Box sx={styles.tabsBorder}>
        {props.layoutActions}
        <Tabs value={props.bottomTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto" sx={{ ...styles.tabs, minWidth: 0, flexShrink: 1 }}>
          <Tab label={t("result")} sx={styles.tabItem} disableRipple />
          <Tab label={t("execution_log")} sx={styles.tabItem} disableRipple />
          <Tab label={t("execution_history")} sx={styles.tabItem} disableRipple />
        </Tabs>
        {props.bottomTab === 0 && <Box data-testid="sql-result-toolbar" sx={styles.resultActions}>
          {summary && <Tooltip title={t('sql_result_completed_at', { time: summary.completedAt })}>
            <Typography role="status" aria-live="polite" aria-atomic="true" variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: { xs: 130, md: 220 }, mx: 0.5 }}>{summaryText}</Typography>
          </Tooltip>}
          {props.isExplainResult ? (
            <>
              <Tooltip title={t('ai_share_bind_values_help')}><FormControlLabel
                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: '0.75rem' } }}
                control={<Checkbox size="small" checked={includeBindValues} onChange={event => setIncludeBindValues(event.target.checked)} />}
                label={t('ai_share_bind_values')} /></Tooltip>
              <AiRequestButton onClick={handleExportForAI} sx={styles.aiBtn} title={t('ask_ai_for_sql_tuning')} />
              <ExportDialog columns={explainDummyColumns} rows={props.rows} defaultFileName="explain_plan" iconType="download" />
            </>
          ) : (
            <>
              <Tooltip title={isTransposed ? t('reset_view') : t('transpose_swap_rows_and_columns')}>
                <IconButton aria-label={isTransposed ? t('reset_view') : t('transpose_swap_rows_and_columns')}
                  color={isTransposed ? 'secondary' : 'default'} onClick={handleToggleTranspose} size="small" disableRipple>
                  <SwapHorizIcon />
                </IconButton>
              </Tooltip>
              <ExportDialog columns={displayColumns} rows={displayRows} defaultFileName="sql_export" iconType="download" />
            </>
          )}
        </Box>}
      </Box>

      <Box sx={styles.tabContentBox(props.bottomTab === 0)}>
        {props.bottomTab === 0 && (
          props.isExplainResult ? (
            <React.Fragment>
              <Box sx={styles.treeRoot}>
                <Box sx={styles.treeHeaderBox}><Typography variant="body2" sx={styles.treeHeaderText}>{parsedExplain.headerText.join('\n')}</Typography></Box>
                <Box sx={styles.treeScrollBox}>
                  <Box sx={styles.treeContentBox}>
                    <Box sx={styles.treeColHeaderBox}>
                      <Box sx={styles.treeCol1} />
                      <Typography variant="caption" sx={styles.treeCol2}>Id</Typography>
                      <Typography variant="caption" sx={styles.treeCol3}>Operation</Typography>
                      <Typography variant="caption" sx={styles.treeCol4}>Name</Typography>
                      <Typography variant="caption" sx={styles.treeCol5}>Rows</Typography>
                      <Typography variant="caption" sx={styles.treeCol6}>{resolvedDbType === 'oracle' ? 'Bytes' : 'Width'}</Typography>
                      <Typography variant="caption" sx={styles.treeCol7}>{resolvedDbType === 'oracle' ? 'Cost (%CPU)' : 'Cost (Start..Total)'}</Typography>
                      <Typography variant="caption" sx={styles.treeCol8}>Time</Typography>
                    </Box>
                    <Box sx={{ pb: 2 }}>
                      {parsedExplain.tree.map((node, idx: number) => (
                        <ExplainTreeNode 
                          key={`${node.id}-${idx}`} 
                          node={node} 
                          dbType={resolvedDbType}
                        />
                      ))}
                    </Box>
                  </Box>
                  {parsedExplain.predicates.length > 0 && (
                    <Box sx={styles.treePredicatesBox}>
                      <Box sx={styles.treePredicatesText}>{parsedExplain.predicates.join('\n')}</Box>
                    </Box>
                  )}
                </Box>
              </Box>

            </React.Fragment>
          ) : (
            <React.Fragment>
              <Box sx={styles.gridContainer}>
                <GridViewport active={props.isVisible !== false}><DataGrid
                  rows={displayRows} 
                  columns={displayColumns} 
                  getRowId={fastGetRowId}
                  density="compact" 
                  rowHeight={32}
                  columnHeaderHeight={34}
                  rowBuffer={10}
                  columnBuffer={2}
                  pagination 
                  hideFooter={hidePagination}
                  localeText={dataGridLocaleText} 
                  initialState={initialPagination} 
                  pageSizeOptions={pageSizeOptions} 
                  hideFooterSelectedRowCount={true} 
                  disableRowSelectionOnClick={true} 
                  disableColumnMenu={true} 
                  disableColumnFilter={true} 
                  disableColumnSelector={true} 
                  rowSelection={false} 
                  onCellKeyDown={(params, event) => {
                    const anchor = cellMenuTrigger(event);
                    if (!anchor) return;
                    event.defaultMuiPrevented = true;
                    cellInspector.rememberCell(anchor.cell);
                    setCellContext({ x: anchor.x, y: anchor.y, cell: {
                      label: displayColumns.find(column => column.field === params.field)?.headerName || params.field,
                      value: params.row[params.field]
                    } });
                  }}
                  slotProps={{ ...staticSlotProps, row: { onContextMenu: (event: React.MouseEvent) => {
                    const anchor = cellMenuTrigger(event);
                    if (!anchor) return;
                    const field = anchor.cell.getAttribute('data-field');
                    const id = event.currentTarget.getAttribute('data-id');
                    const row = displayRows.find(value => String(getRowIdentity(value)) === id);
                    if (!field || !row) return;
                    cellInspector.rememberCell(anchor.cell);
                    setCellContext({ x: anchor.x, y: anchor.y, cell: {
                      label: displayColumns.find(column => column.field === field)?.headerName || field, value: row[field]
                    } });
                  } } }}
                  getRowClassName={getRowClassNameStatic} 
                  sx={styles.gridRoot} 
                /></GridViewport>
              </Box>

            </React.Fragment>
          )
        )}
      </Box>

      <Box sx={styles.tabContentBox(props.bottomTab === 1, true)}>
        <Box data-testid="sql-log-toolbar" sx={styles.logsToolbar}>
          <TextField size="small" type="search" label={t('sql_log_search')} value={logQuery}
            onChange={event => setLogQuery(event.target.value)} sx={{ width: 220, minWidth: 130, flexShrink: 1 }} />
          <FormControlLabel sx={{ m: 0, whiteSpace: 'nowrap', flexShrink: 0 }} control={
            <Checkbox size="small" checked={onlyLogIssues} onChange={event => setOnlyLogIssues(event.target.checked)} />
          } label={t('sql_log_issues_only')} />
          <Typography role="status" aria-live="polite" variant="caption" sx={{ whiteSpace: 'nowrap' }}>{t('sql_log_filter_count', { shown: filteredLogs.length, total: props.logs.length })}</Typography>
          <IconButton 
            color="error" 
            onClick={props.handleClearLogs} 
            size="small" 
            title={t("clear_log")}
            aria-label={t("clear_log")}
            sx={{ ml: 'auto', flexShrink: 0 }}
            disableRipple
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={styles.logsArea}>
          {filteredLogs.map((log, i) => (
            <Box key={i} sx={styles.logItemBox}>
              <Typography variant="caption" sx={styles.logItemHeader}>[{log.time}] {t("execution_time_2")} {log.execTime}{log.execTime !== '-' ? 'ms' : ''} / {t("result_2")} {log.resultMsg}</Typography>
              <Typography variant="body2" sx={styles.logItemSql}>{log.sql}</Typography>
              {log.errorLines && log.errorLines.length > 0 && (
                <Box data-testid="sql-log-error" sx={styles.logErrorBox}>
                  {log.errorLines.map((eLine, eIdx) => {
                    const lineMatch = /^\[ERROR\]\s+(?:Line|行)\s+(\d+):/i.exec(eLine);
                    const lineNumber = lineMatch ? Number(lineMatch[1]) : 0;
                    const isClickable = Number.isSafeInteger(lineNumber) && lineNumber > 0;
                    return <Box component={isClickable ? 'button' : 'div'} type={isClickable ? 'button' : undefined}
                      data-testid="sql-log-error-line" key={eIdx}
                      aria-label={isClickable ? `${t('sql_log_jump_line', { line: lineNumber })}: ${eLine}` : undefined}
                      title={isClickable ? t('sql_log_jump_line', { line: lineNumber }) : undefined}
                      onClick={isClickable ? () => props.handleConsoleClick(eLine) : undefined}
                      sx={styles.logErrorLine(isClickable)}>{eLine}</Box>;

                  })}
                </Box>
              )}
            </Box>
          ))}
          {props.logs.length > 0 && filteredLogs.length === 0 && <Typography role="status" variant="body2" color="text.secondary" sx={styles.logEmpty}>{t('sql_log_no_matches')}</Typography>}
          {props.logs.length === 0 && <Typography variant="body2" color="text.secondary" sx={styles.logEmpty}>{t("no_execution_logs")}</Typography>}
        </Box>
      </Box>

      <Box sx={styles.tabContentBox(props.bottomTab === 2, true)}>
        <Box data-testid="sql-history-toolbar" sx={styles.historyToolbar}>
          <TextField size="small" type="search" label={t('sql_history_search')} value={historyQuery}
            onChange={event => { setHistoryQuery(event.target.value); setHistoryPage(0); setSelectedHistoryId(null); }}
            sx={{ width: 220, minWidth: 130, flexShrink: 1 }} />
          <Typography role="status" aria-live="polite" variant="caption" sx={{ whiteSpace: 'nowrap' }}>{t('sql_history_filter_count', { shown: filteredHistory.length, total: props.historyLogs.length })}</Typography>
          <Typography variant="caption" sx={styles.historyDesc}>{t("last")} {props.historyLimit} {t('sql_history_new_tab_hint')}</Typography>
          <Tooltip title={t('sql_history_open_new_tab')}><span><Button size="small" disabled={!selectedHistory} onClick={() => { if (selectedHistory) openHistory(selectedHistory); }}>{t('sql_history_open_new_tab')}</Button></span></Tooltip>
          <Tooltip title={t('sql_history_replace_help')}><span><Button size="small" disabled={!selectedHistory} onClick={() => { if (selectedHistory) props.setSqlText(selectedHistory.sql); }}>{t('sql_history_replace_editor')}</Button></span></Tooltip>
          <IconButton
            color="error"
            onClick={props.handleClearHistory} 
            size="small" 
            title={t("clear_history")}
            disableRipple
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
        {props.bottomTab === 2 && (
          <Box sx={styles.gridContainer}>
            <GridViewport active={props.isVisible !== false}><DataGrid
              rows={filteredHistory}
              columns={historyColumns} 
              getRowId={(row) => row.id || row.executeTime} 
              density="compact" 
              rowHeight={32}
              columnHeaderHeight={34}
              localeText={dataGridLocaleText} 
              initialState={initialPagination} 
              pageSizeOptions={[100]}
              paginationModel={{ page: Math.min(historyPage, Math.max(0, Math.ceil(filteredHistory.length / 100) - 1)), pageSize: 100 }}
              onPaginationModelChange={model => setHistoryPage(model.page)}
              hideFooterSelectedRowCount={true} 
              disableRowSelectionOnClick={false}
              disableColumnMenu={true} 
              disableColumnFilter={true} 
              disableColumnSelector={true} 
              rowSelection
              rowSelectionModel={selectedHistory ? [selectedHistory.id || selectedHistory.executeTime] : []}
              onRowSelectionModelChange={ids => setSelectedHistoryId(ids.length ? String(ids[0]) : null)}
              slotProps={staticSlotProps}
              onRowDoubleClick={handleHistoryDoubleClick} 
              getRowClassName={getRowClassNameStatic} 
              sx={styles.historyGridRoot} 
            /></GridViewport>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

// Reflect changes to all props, including AI settings and sidebar handlers.
export default memo(SqlWindowBottomComponent);
