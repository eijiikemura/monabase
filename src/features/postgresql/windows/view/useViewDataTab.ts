// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { clearConditionInputs } from '@/shared/utils/queryConditions';
import { postgresColumnKind } from '@/features/postgresql/columnTypes';
import { temporalValueSql } from '@/shared/utils/temporalValues';
import { buildTableConditions, sqlString, getSearchErrorMessage } from '@/features/table/searchConditions';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { withRowIdentity } from '@/features/data-grid/rowIdentity';
import { createExportSnapshotFetcher } from '@/features/table/exportSnapshot';
import { escapeSqlString, qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { DatabaseRow, ColumnDefinition } from "@/shared/types/databaseTypes";
import type { GridColumnHeaderParams, GridColDef } from '@mui/x-data-grid';
import type { Condition } from '@/shared/types/queryConditions';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDbDate, getPostgresFormatForValue, DEFAULT_DATETIME_FORMAT, DEFAULT_DATE_FORMAT } from "@/shared/utils/dateFormatter";
import { buildGridColumns, buildTransposedColumns } from  "@/features/data-grid/dataGridHelper";

import { ipcRenderer } from '@/shared/api/desktop';

export interface LogEntry { 
  time: string; 
  sql: string; 
  resultMsg: string; 
  errorLines?: string[]; 
}

export interface ViewDataTabProps { 
  revision?: number;
  schema: string; 
  viewName: string; 
  isActive: boolean; 
  dateFormat?: string; 
  inputDateFormat?: string; 
}

export const useViewDataTab = (props: ViewDataTabProps) => {
  const { schema, viewName, isActive, dateFormat = DEFAULT_DATETIME_FORMAT, inputDateFormat = DEFAULT_DATE_FORMAT } = props;
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [columnDefinitions, setColumnDefinitions] = useState<ColumnDefinition[]>([]);
  const searchSequence = useRef(0);
  const metadataSequence = useRef(0);
  const metadataAttempted = useRef(false);
  const [metadataReady, setMetadataReady] = useState(false);
  useEffect(() => () => { searchSequence.current++; metadataSequence.current++; }, []);
  const [conditions, setConditions] = useState<{ [key: string]: Condition }>({});
  const [resultColumns, setResultColumns] = useState<GridColDef[]>([]);
  const [resultRows, setResultRows] = useState<DatabaseRow[]>([]);
  
  const [conditionHeight, setConditionHeight] = useState<number>(250);
  const [isResizingCondition, setIsResizingCondition] = useState<boolean>(false);

  const [paginationModel, updatePaginationModel] = useState({ page: 0, pageSize: 50 });
  const [rowCount, setRowCount] = useState<number>(0);
  const [initialSearchDone, setInitialSearchDone] = useState<boolean>(false);

  const [isTransposed, setIsTransposed] = useState<boolean>(false);

  const [bottomTab, setBottomTab] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const targetIdentity = JSON.stringify([schema, viewName]);
  const previousIdentity = useRef(targetIdentity);
  useEffect(() => {
    searchSequence.current++; metadataSequence.current++;
    metadataAttempted.current = false; setMetadataReady(false); setInitialSearchDone(false);
    setColumns([]); setColumnDefinitions([]); setResultColumns([]); setResultRows([]); setRowCount(0);
    updatePaginationModel(previous => ({ ...previous, page: 0 }));
    if (previousIdentity.current !== targetIdentity) setConditions({});
    previousIdentity.current = targetIdentity;
  }, [targetIdentity, props.revision]);

  const loadColumns = useEventCallback(async () => {
    const sequence = ++metadataSequence.current;
    metadataAttempted.current = true;
    setIsLoading(true);
    const safeSchema = schema;
    const safeView = viewName;
    
    // Use pg_attribute and pg_class because information_schema excludes materialized views.
    const sqlCols = `
      SELECT a.attname AS "COLUMN_NAME", pg_catalog.format_type(a.atttypid, a.atttypmod) AS "DATA_TYPE"
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = '${escapeSqlString(safeSchema)}' AND c.relname = '${escapeSqlString(safeView)}'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum
    `;
    try {
      const colDefRes = await ipcRenderer.invoke<(ColumnDefinition)>('execute-sql-bg', sqlCols);

      if (sequence !== metadataSequence.current) return;
      if (!colDefRes.success) throw new Error(colDefRes.error);
      if (!colDefRes.rows.length || colDefRes.rows.some(column => !column.COLUMN_NAME || !column.DATA_TYPE)) {
        throw new Error(t('view_column_metadata_missing'));
      }

      const typeMap: Record<string, string> = {};
      const searchableColumns: string[] = [];
      if (colDefRes.success && colDefRes.rows) {
        setColumnDefinitions(colDefRes.rows);
        colDefRes.rows.forEach((r: ColumnDefinition) => {
          typeMap[r.COLUMN_NAME] = r.DATA_TYPE;
          searchableColumns.push(r.COLUMN_NAME);
        });
      }

      if (searchableColumns.length > 0) {
        setColumns(searchableColumns);
        const initCond: Record<string, Condition> = {};
      
        searchableColumns.forEach((col: string) => {
          let cType = 'STRING';
        
          if (typeMap[col]) {
            const typeUpper = typeMap[col].toUpperCase();
            if (postgresColumnKind({ COLUMN_NAME: col, DATA_TYPE: typeMap[col] }) === 'time') {
              cType = 'TIME';
            } else if (typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP')) {
              cType = 'DATE';
            } else if (typeUpper.includes('INT') || typeUpper.includes('NUMERIC') || typeUpper.includes('FLOAT') || typeUpper.includes('REAL')) {
              cType = 'NUMBER';
            }
          }
        
          initCond[col] = { operator: '=', value: '', sort: '', type: cType };
        });
        setConditions(previous => Object.fromEntries(Object.entries(initCond).map(([name, initial]) => {
          const old = previous[name];
          return [name, old?.type === initial.type ? { ...old } : initial];
        })));
      }
      setMetadataReady(true);
    } catch (error: unknown) {
      if (sequence !== metadataSequence.current) return;
      const message = t('view_metadata_load_failed', { error: getErrorMessage(error) });
      setBottomTab(1);
      setLogs(previous => [{ time: new Date().toLocaleString('ja-JP'), sql: sqlCols, resultMsg: t('search_error'), errorLines: [message] }, ...previous]);
      alert(message);
    } finally {
      if (sequence === metadataSequence.current) setIsLoading(false);
    }
  });


  useEffect(() => {
    if (isActive && viewName && !metadataAttempted.current) void loadColumns();
  }, [isActive, loadColumns, viewName, targetIdentity, props.revision]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingCondition) return;
      let newHeight = e.clientY - 140; 
      if (newHeight < 100) newHeight = 100;
      if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
      setConditionHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizingCondition(false);
    if (isResizingCondition) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [isResizingCondition]);

  const handleClearConditions = () => setConditions(clearConditionInputs);

  const handleConditionChange = (col: string, key: string, val: string) => {
    setConditions({ ...conditions, [col]: { ...conditions[col], [key]: val } });
  };

  const buildQueryStrings = useCallback((conds: Record<string, Condition>) => buildTableConditions(conds, (column, value) => {
    const definition = columnDefinitions.find(item => item.COLUMN_NAME === column) ?? { COLUMN_NAME: column, DATA_TYPE: 'timestamp' };
    const temporal = temporalValueSql(definition, value, 'postgresql', inputDateFormat);
    if (temporal) return temporal;
    const format = getPostgresFormatForValue(inputDateFormat, value);
    return `TO_TIMESTAMP(${sqlString(value)}, ${sqlString(format)})`;
  }, 'TEXT'), [columnDefinitions, inputDateFormat]);

  const conditionsText = useMemo(() => {
    const texts: string[] = [];
    Object.keys(conditions).forEach(col => {
      const cond = conditions[col];
      const parts: string[] = [];
      if (cond && cond.value.trim() !== '') parts.push(t("filter") + `${cond.operator} ${cond.value}`);
      if (cond && cond.sort.trim() !== '') parts.push(t("sort") + cond.sort);
      if (parts.length > 0) texts.push(`${col} (${parts.join(', ')})`);
    });
    return texts.length > 0 ? texts.join('\n') : '';
  }, [conditions, t]);

  const formatRows = useCallback((rows: DatabaseRow[]) => rows.map(row => {
    const formatted = { ...row };
    for (const column of columnDefinitions) {
      if (/^(DATE|TIMESTAMP)\b/i.test(column.DATA_TYPE)) {
        formatted[column.COLUMN_NAME] = formatDbDate(row[column.COLUMN_NAME], dateFormat);
      }
    }
    return formatted;
  }), [columnDefinitions, dateFormat]);

  const executeSearch = useEventCallback(async (conds: { [key: string]: Condition }, page: number, pageSize: number) => {
    if (!metadataReady) return;
    const sequence = ++searchSequence.current;
    let attemptedSql = '';
    setIsLoading(true);
    try {
      const { whereStr, orderStr } = buildQueryStrings(conds);
      
      const targetView = qualifiedObjectName({ schema, objectName: viewName });

      const countSql = `SELECT COUNT(*) AS "CNT" FROM ${targetView} t ${whereStr}`;
      attemptedSql = countSql;
      const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
      if (sequence !== searchSequence.current) return;
      if (!countRes.success) throw new Error(countRes.error);
      const countValue = (countRes.rows[0]?.CNT ?? countRes.rows[0]?.cnt);
      const total = Number(countValue);
      if (countValue == null || String(countValue).trim() === '' || !Number.isSafeInteger(total) || total < 0) {
        throw new Error(t('view_row_count_unavailable'));
      }

      const offset = page * pageSize;
      const sqlText = `SELECT t.* FROM ${targetView} t ${whereStr} ${orderStr} OFFSET ${offset} LIMIT ${pageSize}`;
      const timestamp = new Date().toLocaleString('ja-JP');
      
      attemptedSql = sqlText;
      const res = await ipcRenderer.invoke('execute-sql', sqlText);
      if (sequence !== searchSequence.current) return;
      if (res.success) {
        const nextColumns = buildGridColumns(res.metaData || [], dateFormat, { sortable: false });
        const formattedRows = formatRows(res.rows).map((row, index) => withRowIdentity(row, offset + index + 1));

        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("search_success") + res.rows.length + t("rows_fetched_2") }, ...prev]);
        setBottomTab(0);
        setResultColumns(nextColumns);
        updatePaginationModel({ page, pageSize });
        setRowCount(total);
        setResultRows(formattedRows);
        setIsTransposed(false); 
      } else {
        throw new Error(res.error);
      }
    } catch (error: unknown) {
      if (sequence !== searchSequence.current) return;
      const message = getSearchErrorMessage(error, t);
      setLogs(previous => [{ time: new Date().toLocaleString('ja-JP'), sql: attemptedSql, resultMsg: t('search_error'), errorLines: [message] }, ...previous]);
      setBottomTab(1);
      alert(t('search_error_2') + message);
    } finally { 
      if (sequence === searchSequence.current) setIsLoading(false);
    }
  });

  const setPaginationModel = (next: { page: number; pageSize: number }) => {
    const page = next.pageSize !== paginationModel.pageSize ? 0 : next.page;
    if (page === paginationModel.page && next.pageSize === paginationModel.pageSize) return;
    void executeSearch(conditions, page, next.pageSize);
  };

  const handleExecuteSearchClick = async () => {
    if (!metadataReady) { await loadColumns(); return; }
    await executeSearch(conditions, 0, paginationModel.pageSize);
  };

  const fetchDataForExport = useMemo(() => createExportSnapshotFetcher(() => {
    if (!metadataReady) throw new Error(t('view_column_metadata_missing'));
    const { whereStr, orderStr } = buildQueryStrings(conditions);
    
    const targetView = qualifiedObjectName({ schema, objectName: viewName });
    
    const sqlText = `SELECT t.* FROM ${targetView} t ${whereStr} ${orderStr}`;
    return sqlText;
  }, formatRows), [buildQueryStrings, conditions, schema, viewName, formatRows, metadataReady, t]);

  const handleColumnHeaderClick = (params: GridColumnHeaderParams) => {
    if (isTransposed) return;
    const clickedCol = params.field;
    if (!conditions[clickedCol]) return;

    const newConditions: Record<string, Condition> = {};
    const currentSort = conditions[clickedCol].sort.trim().toUpperCase();
    const nextSort = currentSort === '1' || currentSort === '1 ASC' ? '1 DESC' : '1';
    Object.entries(conditions).forEach(([key, condition]) => {
      newConditions[key] = { ...condition, sort: key === clickedCol ? nextSort : '' };
    });

    setConditions(newConditions);
    void executeSearch(newConditions, 0, paginationModel.pageSize);
  };

  const displayColumns = useMemo(() => {
    if (!isTransposed) return resultColumns;
    return buildTransposedColumns(resultRows, dateFormat, { sortable: false });
  }, [isTransposed, resultColumns, resultRows, dateFormat]);

  const displayRows = useMemo(() => {
    if (!isTransposed) return resultRows;
    return resultColumns.map((col, idx) => {
      const tRow: DatabaseRow = withRowIdentity({ colName: col.headerName }, idx);
      resultRows.forEach((r, rIdx) => {
        tRow[`row_${rIdx}`] = r[col.field];
      });
      return tRow;
    });
  }, [isTransposed, resultColumns, resultRows]);

  useEffect(() => {
    if (isActive && metadataReady && !initialSearchDone) {
      executeSearch(conditions, 0, paginationModel.pageSize);
      setInitialSearchDone(true);
    }
  }, [isActive, metadataReady, conditions, initialSearchDone, paginationModel.pageSize, executeSearch]);

  return {
    isLoading, columns, conditions, handleClearConditions, handleConditionChange, handleExecuteSearchClick,
    conditionHeight, isResizingCondition, setIsResizingCondition,
    bottomTab, setBottomTab, isTransposed, setIsTransposed,
    displayColumns, displayRows, paginationModel, setPaginationModel, rowCount,
    handleColumnHeaderClick, fetchDataForExport, conditionsText, logs, setLogs,
    executeSearch
  };
};
