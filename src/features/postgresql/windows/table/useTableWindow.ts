// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { splitObjectName, escapeSqlString } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { TableRelationCache, TableStructureCache, DatabaseRow } from "@/shared/types/databaseTypes";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type GridColDef } from '@mui/x-data-grid';
import { getFullTableDDL } from '../common/ddlHelper';
import { formatDbDate } from "@/shared/utils/dateFormatter"; 
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
  // Separate source loading state.
  const [isSourceLoading, setIsSourceLoading] = useState<boolean>(false);
  
  const safeTableName = fullTableName || '';
  const [schema, tableName] = splitObjectName(safeTableName, 'public');

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
      const sqlTable = `
        SELECT 
          seq_scan, seq_tup_read, idx_scan, idx_tup_fetch, 
          n_tup_ins, n_tup_upd, n_tup_del, n_live_tup, n_dead_tup,
          last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
        FROM pg_stat_all_tables 
        WHERE schemaname = '${escapeSqlString(schema)}' AND relname = '${escapeSqlString(tableName)}'
      `;
      const sqlCols = `
        SELECT attname AS "COLUMN_NAME", null_frac AS "NULL_FRAC", avg_width AS "AVG_WIDTH", n_distinct AS "N_DISTINCT"
        FROM pg_stats
        WHERE schemaname = '${escapeSqlString(schema)}' AND tablename = '${escapeSqlString(tableName)}'
      `;
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
        const dateFields = ['last_vacuum', 'last_autovacuum', 'last_analyze', 'last_autoanalyze'];
        setStatisticsRows(Object.keys(rowData).map((key, i) => {
          let val = rowData[key];
          if (val !== null && val !== undefined && (dateFields.includes(key) || val instanceof Date)) {
            val = formatDbDate(val, outputDateFormat);
          }
          return { id: i, property: key, value: val !== null && val !== undefined ? val : '' };
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
    { field: 'property', headerName: t("stat_item_pg_stat_all_tables"), flex: 1 },
    { field: 'value', headerName: t("value"), flex: 2 }
  ], [t]);

  const colStatsColumns: GridColDef[] = useMemo(() => [
    { field: 'COLUMN_NAME', headerName: t("column_name"), flex: 1.5 },
    { field: 'NULL_FRAC', headerName: t("null_ratio_0_1"), flex: 1 },
    { field: 'AVG_WIDTH', headerName: t("avg_bytes"), flex: 1 },
    { field: 'N_DISTINCT', headerName: t("distinct_values_negative_means_ratio"), flex: 1 },
  ], [t]);

  const handleCopyTableStats = () => {
    if (statisticsRows.length === 0) return;
    const header = statsColumns.map(c => c.headerName).join('\t');
    const body = statisticsRows.map(r => statsColumns.map(c => r[c.field] !== null && r[c.field] !== undefined ? String(r[c.field]) : '').join('\t')).join('\n');
    navigator.clipboard.writeText(`${header}\n${body}`);
    alert(t("table_statistics_copied_to_clipboard"));
  };

  const handleCopyColStats = () => {
    if (columnStatisticsRows.length === 0) return;
    const header = colStatsColumns.map(c => c.headerName).join('\t');
    const body = columnStatisticsRows.map(r => colStatsColumns.map(c => r[c.field] !== null && r[c.field] !== undefined ? String(r[c.field]) : '').join('\t')).join('\n');
    navigator.clipboard.writeText(`${header}\n${body}`);
    alert(t("column_statistics_copied_to_clipboard"));
  };

  return {
    t, activeTab, setActiveTab, isLoading, isStatsLoading, isSourceLoading, schema, tableName, 
    statisticsRows, columnStatisticsRows, sourceText, reloadSource, statisticsError, sourceError, loadStatistics, loadSource,
    tableStatsHeight, isResizingStats, setIsResizingStats,
    statsColumns, colStatsColumns,
    handleCopyTableStats, handleCopyColStats,
    cachedStructure, setCachedStructure,
    cachedRelations, setCachedRelations
  };
};
