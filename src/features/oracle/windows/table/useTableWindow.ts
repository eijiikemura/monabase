// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { splitObjectName, escapeSqlString } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { TableRelationCache, TableStructureCache, DatabaseRow } from "@/shared/types/databaseTypes";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type GridColDef } from '@mui/x-data-grid';
import { getOracleDateFormat } from "@/shared/utils/dateFormatter";
import { getFullTableDDL } from '../common/ddlHelper'; // Import the DDL helper.
import { ipcRenderer } from '@/shared/api/desktop';

export interface TableWindowProps { 
  tabId: number; 
  fullTableName: string; 
  isActive: boolean; 
  outputDateFormat: string; 
  inputDateFormat: string; 
}

export const useTableWindow = (props: TableWindowProps) => {
  const { fullTableName, isActive, outputDateFormat } = props;
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<number>(0);
  const [isLoading] = useState<boolean>(false);
  const [isStatsLoading, setIsStatsLoading] = useState<boolean>(false);
  const [isSourceLoading, setIsSourceLoading] = useState<boolean>(false);
  
  const safeTableName = fullTableName || '';
  const [schema, tableName] = splitObjectName(safeTableName, '');

  const [cachedStructure, setCachedStructure] = useState<TableStructureCache | null>(null);
  const [cachedRelations, setCachedRelations] = useState<TableRelationCache | null>(null);

  const [statisticsRows, setStatisticsRows] = useState<DatabaseRow[]>([]);
  const [columnStatisticsRows, setColumnStatisticsRows] = useState<DatabaseRow[]>([]);
  
  const [sourceText, setSourceText] = useState('');
  const [statsAttempted, setStatsAttempted] = useState(false), [sourceAttempted, setSourceAttempted] = useState(false);
  const [statisticsError, setStatisticsError] = useState(false), [sourceError, setSourceError] = useState(false);
  const statsVersion = useRef(0), sourceVersion = useRef(0);
  useEffect(() => {
    const stats = statsVersion, source = sourceVersion;
    stats.current++; source.current++;
    setStatsAttempted(false); setSourceAttempted(false);
    setStatisticsRows([]); setColumnStatisticsRows([]); setSourceText('');
    setStatisticsError(false); setSourceError(false);
    setCachedStructure(null); setCachedRelations(null);
    return () => { stats.current++; source.current++; };
  }, [schema, tableName]);
  const reloadSource = () => { sourceVersion.current++; setSourceAttempted(false); };

  const [tableStatsHeight, setTableStatsHeight] = useState<number>(200);
  const [isResizingStats, setIsResizingStats] = useState<boolean>(false);

  const loadStatistics = useEventCallback(async () => {
    const version = ++statsVersion.current;
    setStatsAttempted(true); setStatisticsError(false); setIsStatsLoading(true);
    try {
      const oracleFormat = getOracleDateFormat(outputDateFormat);

      const sqlTable = `SELECT NUM_ROWS, BLOCKS, EMPTY_BLOCKS, AVG_SPACE, CHAIN_CNT, AVG_ROW_LEN, TO_CHAR(LAST_ANALYZED, '${oracleFormat}') AS LAST_ANALYZED FROM ALL_TABLES WHERE TABLE_NAME = '${escapeSqlString(tableName)}' ${schema ? `AND OWNER = '${escapeSqlString(schema)}'` : ''}`;
      const sqlCols = `SELECT COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY, NUM_BUCKETS, SAMPLE_SIZE, TO_CHAR(LAST_ANALYZED, '${oracleFormat}') AS LAST_ANALYZED FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = '${escapeSqlString(tableName)}' ${schema ? `AND OWNER = '${escapeSqlString(schema)}'` : ''} ORDER BY COLUMN_ID`;
      // Fetch independent statistics concurrently and wait for both requests.
      const [tableResult, columnsResult] = await Promise.allSettled([
        ipcRenderer.invoke('execute-sql-bg', sqlTable),
        ipcRenderer.invoke('execute-sql-bg', sqlCols)
      ]);
      const resTable = tableResult.status === 'fulfilled' ? tableResult.value : { success: false as const, error: 'Statistics query failed.' };
      const resCols = columnsResult.status === 'fulfilled' ? columnsResult.value : { success: false as const, error: 'Statistics query failed.' };
      if (version !== statsVersion.current) return;
      if (!resTable.success || !Array.isArray(resTable.rows) || !resCols.success || !Array.isArray(resCols.rows)) throw new Error('Statistics unavailable.');
      if (resTable.success && resTable.rows && resTable.rows.length > 0) {
        const rowData = resTable.rows[0];
        setStatisticsRows(Object.keys(rowData).map((key, i) => {
          const val = rowData[key];
          return { id: i, property: key, value: val };
        }));
      } else {
        setStatisticsRows([]);
      }

      if (resCols.success && resCols.rows) {
        setColumnStatisticsRows(resCols.rows.map((r: DatabaseRow, i: number) => ({ ...r, id: i })));
      } else {
        setColumnStatisticsRows([]);
      }
    } catch {
      if (version === statsVersion.current) setStatisticsError(true);
    } finally {
      if (version === statsVersion.current) setIsStatsLoading(false);
    }
  });

  const loadSource = useEventCallback(async () => {
    const version = ++sourceVersion.current;
    setSourceAttempted(true); setSourceError(false); setIsSourceLoading(true);
    try {
      const fullSource = await getFullTableDDL(ipcRenderer, schema, tableName, t, false);
      if (!fullSource) throw new Error('Table source unavailable.');
      if (version === sourceVersion.current) setSourceText(fullSource);
    } catch {
      if (version === sourceVersion.current) setSourceError(true);
    } finally {
      if (version === sourceVersion.current) setIsSourceLoading(false);
    }
  });

  useEffect(() => {
    if (isActive && tableName) {
      if (activeTab === 4 && !statsAttempted) void loadStatistics();
      if (activeTab === 5 && !sourceAttempted) void loadSource();
    }
  }, [isActive, tableName, activeTab, statsAttempted, sourceAttempted, loadStatistics, loadSource]);

  useEffect(() => {
    const handleReloadSource = (e: WindowEventMap['reload-source']) => {
      const targetTable = e.detail;
      if (targetTable?.schema === schema && targetTable.tableName === tableName) {
        sourceVersion.current++; setSourceAttempted(false);
        setCachedStructure(null);
        setCachedRelations(null);
      }
    };
    window.addEventListener('reload-source', handleReloadSource);
    return () => window.removeEventListener('reload-source', handleReloadSource);
  }, [schema, tableName]);

  useEffect(() => {
    const handleReloadStats = (e: WindowEventMap['reload-statistics']) => {
      const targetTable = e.detail;
      if (targetTable?.schema === schema && targetTable.tableName === tableName) loadStatistics();
    };
    window.addEventListener('reload-statistics', handleReloadStats);
    return () => { window.removeEventListener('reload-statistics', handleReloadStats); };
  }, [loadStatistics, schema, tableName]);

  useEffect(() => {
    const handleForceChangeTab = (e: WindowEventMap['force-change-table-tab']) => {
      const { fullTableName: targetName, targetTab } = e.detail;
      if (targetName === fullTableName && targetTab === 'structure') {
        setActiveTab(1); 
      }
    };
    window.addEventListener('force-change-table-tab', handleForceChangeTab);
    return () => window.removeEventListener('force-change-table-tab', handleForceChangeTab);
  }, [fullTableName]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingStats) return;
      let newHeight = e.clientY - 140; 
      if (newHeight < 100) newHeight = 100;
      if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
      setTableStatsHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizingStats(false);
    
    if (isResizingStats) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [isResizingStats]);

  const statsColumns: GridColDef[] = useMemo(() => [
    { field: 'property', headerName: t("item_name"), flex: 1 },
    { field: 'value', headerName: t("value"), flex: 2 }
  ], [t]);

  const colStatsColumns: GridColDef[] = useMemo(() => [
    { field: 'COLUMN_NAME', headerName: t("column_name"), flex: 1.5 },
    { field: 'NUM_DISTINCT', headerName: t("distinct_values"), flex: 1 },
    { field: 'NUM_NULLS', headerName: t("null_count"), flex: 1 },
    { field: 'DENSITY', headerName: t("density"), flex: 1 },
    { field: 'NUM_BUCKETS', headerName: t("buckets"), flex: 1 },
    { field: 'SAMPLE_SIZE', headerName: t("sample_size"), flex: 1 },
    { field: 'LAST_ANALYZED', headerName: t("last_analyzed"), flex: 1.5 },
  ], [t]);

  const handleCopyTableStats = () => {
    if (statisticsRows.length === 0) return;
    const header = statsColumns.map(c => c.headerName).join('\t');
    const rows = statisticsRows.map(r => statsColumns.map(c => r[c.field] || '').join('\t')).join('\n');
    navigator.clipboard.writeText(`${header}\n${rows}`);
    alert(t("table_statistics_copied_to_clipboard"));
  };

  const handleCopyColumnStats = () => {
    if (columnStatisticsRows.length === 0) return;
    const header = colStatsColumns.map(c => c.headerName).join('\t');
    const rows = columnStatisticsRows.map(r => colStatsColumns.map(c => r[c.field] || '').join('\t')).join('\n');
    navigator.clipboard.writeText(`${header}\n${rows}`);
    alert(t("column_statistics_copied_to_clipboard"));
  };

  return {
    t, activeTab, setActiveTab, isLoading, isStatsLoading, isSourceLoading, schema, tableName, 
    statisticsRows, columnStatisticsRows, sourceText, reloadSource, statisticsError, sourceError, loadStatistics, loadSource,
    tableStatsHeight, isResizingStats, setIsResizingStats,
    statsColumns, colStatsColumns,
    handleCopyTableStats, handleCopyColumnStats,
    cachedStructure, setCachedStructure,
    cachedRelations, setCachedRelations
  };
};
