// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { GridViewport } from '@/features/data-grid/GridViewport';

import { useState, useEffect } from 'react';
import { Box, Paper, Typography, Tabs, Tab, IconButton, Tooltip, Alert, Button } from '@mui/material';
import { DataGrid, jaJP, enUS } from '@mui/x-data-grid';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';

import TableDataTab from './TableDataTab';
import TableStructureTab from './TableStructureTab';
import TableRelationTab from './TableRelationTab';
import VersionControlTab from "@/features/git/VersionControlTab";
import AutoErDiagram from "@/features/er/AutoErDiagram";

import { useTableWindow, type TableWindowProps } from './useTableWindow';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', height: '100%', bgcolor: 'background.default', position: 'relative' as const }),
  tabsContainer: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2 },
  tabs: { minHeight: 40 },
  tabItem: { minHeight: 40, py: 0 },
  statsTabBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1, minHeight: 0 }),
  tableStatsPaper: (height: number) => ({ height, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' }),
  statsHeaderBox: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  gridWrapper: { flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const },
  dataGridRoot: { 
    border: 0,
    '& .even-row': { bgcolor: 'action.hover' }, 
    '& .even-row:hover': { bgcolor: 'action.hover' }, 
  },
  hResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  hResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  colStatsPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  versionControlBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1, minHeight: 0 }),
  erTabBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, p: 1 })
};

export default function TableWindowPostgresql(props: TableWindowProps) {
  const { t, i18n } = useTranslation();
  const isEnglish = i18n.language === 'en';
  const dataGridLocaleText = isEnglish ? enUS.components.MuiDataGrid.defaultProps.localeText : jaJP.components.MuiDataGrid.defaultProps.localeText;

  const {
    activeTab, setActiveTab, isStatsLoading, isSourceLoading, schema, tableName,
    statisticsRows, columnStatisticsRows, sourceText, reloadSource, statisticsError, sourceError, loadStatistics, loadSource,
    tableStatsHeight, isResizingStats, setIsResizingStats,
    statsColumns, colStatsColumns,
    handleCopyTableStats, handleCopyColStats,
    cachedStructure, setCachedStructure,
    cachedRelations, setCachedRelations
  } = useTableWindow(props);

  const [visitedTabs, setVisitedTabs] = useState<number[]>([0]);

  useEffect(() => {
    if (props.isActive && !visitedTabs.includes(activeTab)) {
      setVisitedTabs(prev => [...prev, activeTab]);
    }
  }, [activeTab, props.isActive, visitedTabs]);

  return (
    <Box sx={styles.rootBox(props.isActive)}>
      <Box sx={styles.tabsContainer}>
        <Tabs value={activeTab} onChange={(_e, val) => setActiveTab(val as number)} sx={styles.tabs} variant="scrollable" scrollButtons="auto">
          <Tab label={t("data")} sx={styles.tabItem} />
          <Tab label={t("structure")} sx={styles.tabItem} />
          <Tab label={t("relation")} sx={styles.tabItem} />
          <Tab label={t("er_diagram")} sx={styles.tabItem} />
          <Tab label={t("statistics")} sx={styles.tabItem} />
          <Tab label={t("source")} sx={styles.tabItem} />
        </Tabs>
      </Box>

      <Box sx={{ flexGrow: 1, display: activeTab === 0 ? 'flex' : 'none', overflow: 'hidden' }}>
        {visitedTabs.includes(0) && <TableDataTab schema={schema} tableName={tableName} isActive={props.isActive && activeTab === 0} outputDateFormat={props.outputDateFormat} inputDateFormat={props.inputDateFormat} />}
      </Box>

      <Box sx={{ flexGrow: 1, display: activeTab === 1 ? 'flex' : 'none', overflow: 'hidden' }}>
        {visitedTabs.includes(1) && (
          <TableStructureTab 
            schema={schema} 
            tableName={tableName} 
            isActive={props.isActive && activeTab === 1}
            cachedStructure={cachedStructure} 
            setCachedStructure={setCachedStructure} 
          />
        )}
      </Box>

      <Box sx={{ flexGrow: 1, display: activeTab === 2 ? 'flex' : 'none', overflow: 'hidden' }}>
        {visitedTabs.includes(2) && (
          <TableRelationTab 
            schema={schema} 
            tableName={tableName} 
            isActive={props.isActive && activeTab === 2}
            cachedRelations={cachedRelations} 
            setCachedRelations={setCachedRelations} 
          />
        )}
      </Box>

      <Box sx={styles.erTabBox(activeTab === 3)}>
        {visitedTabs.includes(3) && (
          <Paper elevation={1} sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <AutoErDiagram initialSchema={schema} tableName={tableName} dbType="postgres" />
          </Paper>
        )}
      </Box>

      <Box data-testid="table-statistics" sx={styles.statsTabBox(activeTab === 4)}>
        {statisticsError && <Alert severity="warning" action={<Button disabled={isStatsLoading} onClick={() => { void loadStatistics(); }}>{t('retry')}</Button>}>{t('table_statistics_failed')}</Alert>}
        {visitedTabs.includes(4) && (
          <>
            <Paper elevation={1} sx={styles.tableStatsPaper(tableStatsHeight)}>
              <Box sx={styles.statsHeaderBox}>
                <Typography variant="subtitle2" fontWeight="bold">{t("table_statistics")}</Typography>
                <Tooltip title={t("copy_to_clipboard_tsv_format_2")}>
                  <span>
                    <IconButton 
                      size="small" 
                      color="primary" 
                      disabled={isStatsLoading}
                      onClick={handleCopyTableStats}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              <Box sx={styles.gridWrapper}><GridViewport active={props.isActive && activeTab === 4}>
                <DataGrid 
                  rows={statisticsRows} 
                  columns={statsColumns} 
                  density="compact" 
                  hideFooter 
                  loading={isStatsLoading}
                  disableRowSelectionOnClick 
                  getRowClassName={(params) => params.indexRelativeToCurrentPage % 2 === 0 ? 'even-row' : ''} 
                  sx={styles.dataGridRoot} 
                />
              </GridViewport></Box>
            </Paper>

            <Box onMouseDown={() => setIsResizingStats(true)} sx={styles.hResizer(isResizingStats)}>
              <Box sx={styles.hResizerInner(isResizingStats)} />
            </Box>

            <Paper elevation={1} sx={styles.colStatsPaper}>
              <Box sx={styles.statsHeaderBox}>
                <Typography variant="subtitle2" fontWeight="bold">{t("column_statistics")}</Typography>
                <Tooltip title={t("copy_to_clipboard_tsv_format_2")}>
                  <span>
                    <IconButton 
                      size="small" 
                      color="primary" 
                      disabled={isStatsLoading}
                      onClick={handleCopyColStats}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
              <Box sx={styles.gridWrapper}><GridViewport active={props.isActive && activeTab === 4}>
                <DataGrid 
                  rows={columnStatisticsRows} 
                  columns={colStatsColumns} 
                  density="compact" 
                  hideFooter 
                  loading={isStatsLoading}
                  disableRowSelectionOnClick 
                  localeText={dataGridLocaleText} 
                  getRowClassName={(params) => params.indexRelativeToCurrentPage % 2 === 0 ? 'even-row' : ''} 
                  sx={styles.dataGridRoot} 
                />
              </GridViewport></Box>
            </Paper>
          </>
        )}
      </Box>

      <Box sx={styles.versionControlBox(activeTab === 5)}>
        {sourceError && <Alert severity="warning" action={<Button disabled={isSourceLoading} onClick={() => { void loadSource(); }}>{t('retry')}</Button>}>{t('table_source_failed')}</Alert>}
        {visitedTabs.includes(5) && (!sourceError || !!sourceText) && (
          /* Pass isSourceLoading. */
          <VersionControlTab 
            dbType="POSTGRESQL" 
            schema={schema} 
            objectType="TABLE" 
            objectName={tableName} 
            currentSource={sourceText} 
            isSourceLoading={isSourceLoading || !sourceText}
            onRefresh={reloadSource}
          />
        )}
      </Box>
    </Box>
  );
}