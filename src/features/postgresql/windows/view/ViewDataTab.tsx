// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { GridViewport } from '@/features/data-grid/GridViewport';
import { getRowIdentity } from '@/features/data-grid/rowIdentity';
import { createContext, memo, useContext, useMemo } from 'react';
import { 
  Box, Paper, Typography, IconButton, Tooltip, Tabs, Tab
} from '@mui/material';
import { DataGrid, jaJP, enUS, GridFooterContainer, GridPagination } from '@mui/x-data-grid';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useTranslation } from 'react-i18next';

import ExportDialog from "@/components/data/ExportDialog";
import ConditionPanel from "@/components/data/ConditionPanel";
import { DEFAULT_DATE_FORMAT } from "@/shared/utils/dateFormatter";

import { useViewDataTab, type ViewDataTabProps } from './useViewDataTab';

type FooterState = Pick<
  ReturnType<typeof useViewDataTab>,
  'isTransposed' | 'setIsTransposed' | 'displayColumns' |
  'displayRows' | 'rowCount' | 'fetchDataForExport' | 'conditionsText'
> & { viewName: string };

const FooterContext = createContext<FooterState | null>(null);
const MemoExportDialog = memo(ExportDialog);

// Keep the footer component stable and share only required data.
const CustomFooter = memo(function CustomFooter() {
  const { t } = useTranslation();
  const state = useContext(FooterContext);
  if (!state) return null;

  return (
    <GridFooterContainer>
      <Box sx={{ display: 'flex', gap: 1, pl: 2, alignItems: 'center' }}>
        <Tooltip title={state.isTransposed
          ? t("reset_view")
          : t("transpose_swap_rows_and_columns")}>
          <IconButton
            color={state.isTransposed ? 'secondary' : 'primary'}
            onClick={() => state.setIsTransposed(prev => !prev)}
            size="small"
          >
            <SwapHorizIcon />
          </IconButton>
        </Tooltip>
        <MemoExportDialog
          columns={state.displayColumns}
          rows={state.displayRows}
          defaultFileName={`${state.viewName}_data`}
          iconType="download"
          totalCount={!state.isTransposed ? state.rowCount : undefined}
          fetchDataChunk={!state.isTransposed ? state.fetchDataForExport : undefined}
          tableName={state.viewName}
          conditionsText={state.conditionsText}
        />
      </Box>
      {!state.isTransposed && <GridPagination />}
    </GridFooterContainer>
  );
});

const GRID_COMPONENTS = { Footer: CustomFooter };
const PAGE_SIZE_OPTIONS = [50, 100, 500];

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1, position: 'relative' as const, minHeight: 0 }),
  conditionPaper: (height: number) => ({ height, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' }),
  hResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }),
  hResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomContainer: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', p: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', minHeight: 0 },
  bottomPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', position: 'relative' as const, minHeight: 0, bgcolor: 'background.paper' },
  tabsWrapper: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' },
  tabs: { minHeight: 36 },
  tabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  resultBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0 }),
  resultHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerActions: { display: 'flex', gap: 1, alignItems: 'center' },
  dataGridRoot: { border: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, '& .even-row': { bgcolor: 'action.hover' }, '& .even-row:hover': { bgcolor: 'action.selected' } },
  logsBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0, bgcolor: 'action.hover' }),
  logsToolbar: { display: 'flex', justifyContent: 'flex-end', p: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' },
  logsArea: { flexGrow: 1, overflowY: 'auto' as const, p: 1 },
  logItemBox: { mb: 1, pb: 1, borderBottom: '1px solid', borderColor: 'divider' },
  logItemHeader: { fontWeight: 'bold', color: 'text.secondary' },
  logItemSql: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.primary', mt: 0.5, bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  logErrorBox: { mt: 1, p: 1, bgcolor: 'error.light', borderRadius: 1, border: '1px solid', borderColor: 'error.main' },
  logErrorText: { whiteSpace: 'pre-wrap', color: '#fff', fontFamily: 'monospace' },
  logEmpty: { p: 2, textAlign: 'center' as const }
};

function ViewDataTabPostgresql(props: ViewDataTabProps) {
  const { t, i18n } = useTranslation();
  const dataGridLocaleText = (i18n.resolvedLanguage ?? i18n.language).startsWith('ja')
    ? jaJP.components.MuiDataGrid.defaultProps.localeText
    : enUS.components.MuiDataGrid.defaultProps.localeText;
  
  const {
    columns, conditions, isLoading, handleConditionChange, handleClearConditions, handleExecuteSearchClick,
    conditionHeight, isResizingCondition, setIsResizingCondition,
    bottomTab, setBottomTab, isTransposed, setIsTransposed,
    displayColumns, displayRows, paginationModel, setPaginationModel, rowCount,
    handleColumnHeaderClick, fetchDataForExport, conditionsText, logs, setLogs
  } = useViewDataTab(props);

  const footerState = useMemo<FooterState>(() => ({
    isTransposed, setIsTransposed, displayColumns, displayRows,
    rowCount, fetchDataForExport, conditionsText, viewName: props.viewName
  }), [
    isTransposed, setIsTransposed, displayColumns, displayRows,
    rowCount, fetchDataForExport, conditionsText, props.viewName
  ]);

  return (
    <Box sx={styles.rootBox(props.isActive)}>
      <Paper elevation={1} sx={styles.conditionPaper(conditionHeight)}>
        <ConditionPanel
          allowTime
          columns={columns}
          conditions={conditions}
          onConditionChange={handleConditionChange}
          onClearConditions={handleClearConditions}
          disabled={isLoading}
          onExecute={handleExecuteSearchClick}
          inputDateFormat={props.inputDateFormat || DEFAULT_DATE_FORMAT} 
        />
      </Paper>

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
              <Typography variant="subtitle2" fontWeight="bold">{t("result_read_only")}</Typography>
            </Box>
            <GridViewport active={props.isActive && bottomTab === 0}>
              <FooterContext.Provider value={footerState}>
                <DataGrid
                  getRowId={getRowIdentity}
                  rows={displayRows}
                  columns={displayColumns}
                  density="compact"
                  localeText={dataGridLocaleText}
                  disableRowSelectionOnClick
                  disableColumnFilter
                  disableColumnMenu
                  paginationMode="server"
                  paginationModel={paginationModel}
                  onPaginationModelChange={setPaginationModel}
                  rowCount={rowCount}
                  pageSizeOptions={PAGE_SIZE_OPTIONS}
                  onColumnHeaderClick={handleColumnHeaderClick}
                  getRowClassName={(params) => params.indexRelativeToCurrentPage % 2 === 0 ? 'even-row' : ''}
                  components={GRID_COMPONENTS}
                  sx={styles.dataGridRoot}
                />
              </FooterContext.Provider>
            </GridViewport>
          </Box>

          <Box sx={styles.logsBox(bottomTab === 1)}>
            <Box sx={styles.logsToolbar}>
              <Tooltip title={t("clear_log")}>
                <IconButton color="error" onClick={() => setLogs([])} size="small">
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={styles.logsArea}>
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
          </Box>

        </Paper>
      </Box>
    </Box>
  );
}

export default memo(ViewDataTabPostgresql);
