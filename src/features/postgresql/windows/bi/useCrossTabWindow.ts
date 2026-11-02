// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { clearConditionInputs } from '@/shared/utils/queryConditions';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { DatabaseRow, NamedObject } from "@/shared/types/databaseTypes";
import type { SelectChangeEvent } from '@mui/material';

import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { type GridColDef } from '@mui/x-data-grid';
import { toPng } from 'html-to-image';
import type { Condition } from '@/shared/types/queryConditions';

import { getPostgresDateFormat, getPostgresFormatForValue, DEFAULT_DATETIME_FORMAT, DEFAULT_COMPACT_DATE_FORMAT } from "@/shared/utils/dateFormatter";
// Import shared helpers.
import { savePgSelectSchema, getPgSelectSchema } from '../common/schemaStorage';
import { ipcRenderer } from '@/shared/api/desktop';

export interface CrossTabWindowProps {
  tabId: number;
  isActive: boolean;
  schemas: string[];
  initialSchema: string;
  inputDateFormat: string;
  dbName?: string;
  userName?: string;
}

export interface LogEntry { 
  time: string; 
  sql: string; 
  execTime: string | number; 
  resultMsg: string; 
  errorLines?: string[]; 
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export type CastType = 'STRING' | 'NUMBER' | 'DATE' | 'NONE';

export const GRAPH_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a4de6c', '#d0ed57'];

export function useCrossTabWindow({ isActive, schemas, initialSchema, inputDateFormat = DEFAULT_DATETIME_FORMAT, dbName = '', userName = '' }: CrossTabWindowProps) {
  const { t } = useTranslation(); 
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const [schema, setSchema] = useState(''); 
  const [objectType, setObjectType] = useState('TABLE');
  const [objects, setObjects] = useState<string[]>([]);
  const [selectedObject, setSelectedObject] = useState('');

  const [columns, setColumns] = useState<ColumnInfo[]>([]);

  const [configTab, setConfigTab] = useState(0);
  const [conditions, setConditions] = useState<{ [key: string]: Condition }>({});

  const [rowField, setRowField] = useState('');
  const [rowCastType, setRowCastType] = useState<CastType>('NONE');
  const [rowDateFormat, setRowDateFormat] = useState(DEFAULT_COMPACT_DATE_FORMAT);
  const [rowDateGroup, setRowDateGroup] = useState('NONE');
  const [rowNumGroup, setRowNumGroup] = useState({ enable: false, start: 15, end: 48, step: 10 });
  
  const [colField, setColField] = useState('');
  const [colCastType, setColCastType] = useState<CastType>('NONE');
  const [colDateFormat, setColDateFormat] = useState(DEFAULT_COMPACT_DATE_FORMAT);
  const [colDateGroup, setColDateGroup] = useState('NONE');
  const [colNumGroup, setColNumGroup] = useState({ enable: false, start: 15, end: 48, step: 10 });
  
  const [valField, setValField] = useState('');
  const [aggType, setAggType] = useState<'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN'>('SUM');

  const [graphType, setGraphType] = useState<'bar' | 'line' | 'area'>('bar');

  const [bottomTab, setBottomTab] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pivotColumns, setPivotColumns] = useState<GridColDef[]>([]);
  const [pivotRows, setPivotRows] = useState<DatabaseRow[]>([]);

  const [topHeight, setTopHeight] = useState<number>(370);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [numberFormat, setNumberFormat] = useState<string>('comma');

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      let newHeight = e.clientY - 120; 
      if (newHeight < 250) newHeight = 250;
      if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
      setTopHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizing(false);
    
    if (isResizing) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [isResizing]);

  const fetchObjects = async (targetSchema: string, targetType: string) => {
    if (!targetSchema) return; 
    setIsLoading(true);
    try {
      const res = await ipcRenderer.invoke('get-objects', targetSchema, targetType);
      if (res.success && res.objects) {
        setObjects(res.objects.map((obj: NamedObject) => typeof obj === 'object' ? obj.name : obj));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initSettings = async () => {
      setIsLoading(true);
      try {
        const settings = await ipcRenderer.invoke('load-settings');
        if (settings && settings.numberFormat) {
          setNumberFormat(settings.numberFormat);
        }

        const resSchemas = await ipcRenderer.invoke('get-schemas', false, false);
        let fetchedSchemas: string[] = [];
        if (resSchemas.success && resSchemas.schemas) {
          fetchedSchemas = resSchemas.schemas.map((s: NamedObject) => typeof s === 'object' ? s.name || String(s) : String(s));
        } else {
          fetchedSchemas = schemas; 
        }

        let finalSchema = '';

        // Determine the initial schema with the shared helper.
        const savedSchema = getPgSelectSchema(dbName, userName);
        if (savedSchema && fetchedSchemas.find((s: string) => s.toLowerCase() === savedSchema.toLowerCase())) {
          finalSchema = fetchedSchemas.find((s: string) => s.toLowerCase() === savedSchema.toLowerCase()) || '';
        } else {
          const targetSchema = initialSchema || userName || '';
          const matchedSchema = fetchedSchemas.find((s: string) => s.toLowerCase() === targetSchema.toLowerCase());
          finalSchema = matchedSchema || '';
        }

        setSchema(finalSchema);
        if (finalSchema) {
          await fetchObjects(finalSchema, objectType);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setIsInitialized(true);
        setIsLoading(false);
      }
    };
    
    if (isActive && !isInitialized) {
      initSettings();
    }
  }, [isActive, isInitialized, initialSchema, schemas, objectType, dbName, userName]);

  const formatNumberValue = useCallback((val: unknown) => {
    if (val === null || val === undefined || val === '') return '';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    
    const intVal = Math.trunc(num);
    const strVal = intVal.toString();
    
    if (numberFormat === 'comma') {
      return strVal.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } else if (numberFormat === 'period') {
      return strVal.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    } else if (numberFormat === 'space') {
      return strVal.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }
    return strVal;
  }, [numberFormat]);

  const clearSettings = () => {
    setColumns([]); setPivotColumns([]); setPivotRows([]);
    setRowField(''); setRowCastType('NONE'); setRowDateFormat(DEFAULT_COMPACT_DATE_FORMAT); setRowDateGroup('NONE'); setRowNumGroup(prev => ({ ...prev, enable: false }));
    setColField(''); setColCastType('NONE'); setColDateFormat(DEFAULT_COMPACT_DATE_FORMAT); setColDateGroup('NONE'); setColNumGroup(prev => ({ ...prev, enable: false }));
    setValField(''); setConditions({}); setConfigTab(0);
  };

  const handleChangeSchema = (e: SelectChangeEvent<string>) => {
    const newSchema = e.target.value;
    setSchema(newSchema);
    setSelectedObject('');
    clearSettings();
    fetchObjects(newSchema, objectType);

    // Save with the shared helper.
    if (userName && newSchema) {
      savePgSelectSchema(dbName, userName, newSchema);
    }
  };

  const handleChangeObjectType = (e: SelectChangeEvent<string>) => {
    const newType = e.target.value;
    setObjectType(newType);
    setSelectedObject('');
    clearSettings();
    fetchObjects(schema, newType);
  };

  const handleChangeObject = (e: SelectChangeEvent<string>) => {
    setSelectedObject(e.target.value);
    clearSettings();
  };

  const getInitialCastType = (col: ColumnInfo | undefined): CastType => {
    if (!col) return 'STRING';
    const type = col.type.toUpperCase();
    if (type.includes('DATE') || type.includes('TIMESTAMP')) return 'NONE'; 
    if (type.includes('INT') || type.includes('NUMERIC') || type.includes('FLOAT') || type.includes('REAL') || type.includes('DOUBLE')) return 'NUMBER';
    return 'STRING';
  };

  // Fetch column names and types for tables, views, and materialized views.
  const fetchColumnInfo = async (
    targetSchema: string,
    targetObject: string
  ): Promise<ColumnInfo[]> => {
    const result = await ipcRenderer.invoke<{ COLUMN_NAME: string; DATA_TYPE: string }>('execute-sql-bg', `
      SELECT
        a.attname AS "COLUMN_NAME",
        pg_catalog.format_type(a.atttypid, a.atttypmod) AS "DATA_TYPE"
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = :owner
        AND c.relname = :objectName
        AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `, { owner: targetSchema, objectName: targetObject });

    if (!result.success) {
      throw new Error(result.error || t("failed_to_fetch_column_information_2"));
    }
    return (result.rows || []).map(
      (row: { COLUMN_NAME: string; DATA_TYPE: string }) => ({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE.toUpperCase()
      })
    );
  };

  const handleFetchColumns = async () => {
    if (!selectedObject) return;
    setIsLoading(true);
    try {
      const fetchedCols = await fetchColumnInfo(schema, selectedObject);

      if (fetchedCols.length > 0) {
        setColumns(fetchedCols);

        const initRowCol = fetchedCols[0];
        const initColCol = fetchedCols[1] || fetchedCols[0];
        const initValCol = fetchedCols[2] || fetchedCols[0];

        setRowField(initRowCol.name);
        setRowCastType(getInitialCastType(initRowCol));
        
        setColField(initColCol.name);
        setColCastType(getInitialCastType(initColCol));

        setValField(initValCol.name);

        setPivotColumns([]);
        setPivotRows([]);

        const initialConds: { [key: string]: Condition } = {};
        fetchedCols.forEach(c => {
          let type = 'STRING';
          if (c.type.includes('INT') || c.type.includes('NUMERIC') || c.type.includes('FLOAT')) type = 'NUMBER';
          else if (c.type.includes('DATE') || c.type.includes('TIMESTAMP')) type = 'DATE';
          initialConds[c.name] = { operator: '=', value: '', sort: '', type };
        });
        setConditions(initialConds);
      } else {
        alert(t("failed_to_fetch_column_information_2"));
      }
    } catch (e: unknown) {
      alert(t("an_error_occurred_2", { error: getErrorMessage(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRowFieldChange = (e: SelectChangeEvent<string>) => {
    const val = e.target.value;
    setRowField(val);
    const colInfo = columns.find(c => c.name === val);
    setRowCastType(getInitialCastType(colInfo));
    setRowDateGroup('NONE');
    setRowNumGroup(prev => ({ ...prev, enable: false }));
  };

  const handleColFieldChange = (e: SelectChangeEvent<string>) => {
    const val = e.target.value;
    setColField(val);
    const colInfo = columns.find(c => c.name === val);
    setColCastType(getInitialCastType(colInfo));
    setColDateGroup('NONE');
    setColNumGroup(prev => ({ ...prev, enable: false }));
  };

  const handleExportSettings = async () => {
    const currentSettings = {
      schema, objectType, selectedObject,
      rowField, rowCastType, rowDateFormat, rowDateGroup, rowNumGroup,
      colField, colCastType, colDateFormat, colDateGroup, colNumGroup,
      valField, aggType, conditions
    };
    
    const jsonStr = JSON.stringify(currentSettings, null, 2);
    
    try {
      const defaultName = `Crosstab_${schema}_${selectedObject || 'Settings'}.json`;
      const saveRes = await ipcRenderer.invoke('show-save-dialog', {
        title: t("save_cross_tab_settings"),
        defaultPath: defaultName,
        filters: [{ name: 'JSON Files', extensions: ['json'] }]
      });
      
      if (!saveRes.canceled && saveRes.filePath) {
        const writeRes = await ipcRenderer.invoke('save-file', saveRes.filePath, jsonStr, 'utf8');
        if (writeRes.success) alert(t("cross_tab_settings_saved"));
        else alert(t("save_error_4", { error: writeRes.error }));
      }
    } catch (e: unknown) {
      alert(t("error_occurred_while_saving", { error: getErrorMessage(e) }));
    }
  };

  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setIsLoading(true);
        const jsonStr = event.target?.result as string;
        const parsed = JSON.parse(jsonStr);

        const newSchema = parsed.schema || initialSchema?.toLowerCase() || '';
        const newType = parsed.objectType || 'TABLE';
        const newObj = parsed.selectedObject || '';

        const resObjs = await ipcRenderer.invoke('get-objects', newSchema, newType);
        if (resObjs.success && resObjs.objects) {
          setObjects(resObjs.objects.map((obj: NamedObject) => typeof obj === 'object' ? obj.name : obj));
        }

        let fetchedCols: ColumnInfo[] = [];
        if (newSchema && newObj) {
          fetchedCols = await fetchColumnInfo(newSchema, newObj);
        }

        if (fetchedCols.length === 0) {
          throw new Error(t("failed_to_fetch_table_columns_ensure_the_object_exists_in_the_database"));
        }

        setSchema(newSchema);
        setObjectType(newType);
        setSelectedObject(newObj);
        setColumns(fetchedCols);

        const importedRowField = parsed.rowField || '';
        const importedColField = parsed.colField || '';

        setRowField(importedRowField);
        setColField(importedColField);

        let defaultRowCast: CastType = 'NONE';
        let defaultColCast: CastType = 'NONE';
        const rCol = fetchedCols.find(c => c.name === importedRowField);
        const cCol = fetchedCols.find(c => c.name === importedColField);
        if (rCol) defaultRowCast = getInitialCastType(rCol);
        if (cCol) defaultColCast = getInitialCastType(cCol);

        setRowCastType(parsed.rowCastType || defaultRowCast);
        setRowDateFormat(parsed.rowDateFormat || DEFAULT_COMPACT_DATE_FORMAT);
        setRowDateGroup(parsed.rowDateGroup || 'NONE');
        setRowNumGroup(parsed.rowNumGroup || { enable: false, start: 15, end: 48, step: 10 });
        
        setColCastType(parsed.colCastType || defaultColCast);
        setColDateFormat(parsed.colDateFormat || DEFAULT_COMPACT_DATE_FORMAT);
        setColDateGroup(parsed.colDateGroup || 'NONE');
        setColNumGroup(parsed.colNumGroup || { enable: false, start: 15, end: 48, step: 10 });
        
        setValField(parsed.valField || '');
        setAggType(parsed.aggType || 'SUM');
        
        const initialConds: { [key: string]: Condition } = {};
        fetchedCols.forEach(c => {
          let type = 'STRING';
          if (c.type.includes('INT') || c.type.includes('NUMERIC') || c.type.includes('FLOAT')) type = 'NUMBER';
          else if (c.type.includes('DATE') || c.type.includes('TIMESTAMP')) type = 'DATE';
          initialConds[c.name] = { operator: '=', value: '', sort: '', type };
        });

        const savedConds = parsed.conditions || {};
        Object.keys(savedConds).forEach(k => {
          if (initialConds[k]) {
            initialConds[k] = { ...initialConds[k], ...savedConds[k] };
          }
        });
        setConditions(initialConds);

        setPivotColumns([]);
        setPivotRows([]);
        setConfigTab(0);
        
        setTimeout(() => {
          alert(t("settings_restored_click_execute_cross_tab_to_see_results"));
        }, 150);

      } catch (err: unknown) {
        alert(t("file_load_error") + getErrorMessage(err));
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleClearConditions = () => setConditions(clearConditionInputs);

  const handleConditionChange = useCallback((col: string, key: string, val: string) => {
    setConditions(prev => ({
      ...prev,
      [col]: { ...prev[col], [key]: val }
    }));
  }, []);

  const getGroupExprInfo = useCallback((colName: string, castType: CastType, dateFormat: string, dateGroup: string, numGroup: typeof rowNumGroup) => {
    const colDef = columns.find(c => c.name === colName);
    const nativeType = colDef ? colDef.type : '';
    const isNativeNum = nativeType.includes('INT') || nativeType.includes('NUMERIC') || nativeType.includes('FLOAT');

    let baseExpr = `"${colName}"`;
    if (castType === 'NUMBER' && !isNativeNum) {
      baseExpr = `CAST("${colName}" AS NUMERIC)`;
    } else if (castType === 'DATE') {
      const pgFmt = getPostgresDateFormat(dateFormat || DEFAULT_COMPACT_DATE_FORMAT);
      baseExpr = `TO_DATE("${colName}", '${pgFmt}')`;
    }

    if ((castType === 'NONE' || castType === 'DATE') && dateGroup !== 'NONE') {
      let fmt = 'YYYY-MM-DD';
      if (dateGroup === 'YEAR') fmt = 'YYYY';
      else if (dateGroup === 'QUARTER') fmt = 'YYYY-"Q"Q';
      else if (dateGroup === 'MONTH') fmt = 'YYYY-MM';
      return { 
        expr: `TO_CHAR(${baseExpr}, '${fmt}')`, 
        sortExpr: `TO_CHAR(${baseExpr}, '${fmt}')` 
      };
    }

    if (castType === 'NUMBER' && numGroup.enable && numGroup.step > 0) {
      const s = Number(numGroup.start);
      const e = Number(numGroup.end);
      const step = Number(numGroup.step);
      const labelExpr = `CAST(FLOOR((${baseExpr} - ${s}) / ${step}) * ${step} + ${s} AS TEXT) || '-' || CAST(FLOOR((${baseExpr} - ${s}) / ${step}) * ${step} + ${s} + ${step} - 1 AS TEXT)`;
      return {
        expr: `CASE WHEN ${baseExpr} < ${s} THEN '<${s}' WHEN ${baseExpr} > ${e} THEN '>${e}' ELSE ${labelExpr} END`,
        sortExpr: `CASE WHEN ${baseExpr} < ${s} THEN -999999999 WHEN ${baseExpr} > ${e} THEN 999999999 ELSE FLOOR((${baseExpr} - ${s}) / ${step}) END`
      };
    }
    
    return { expr: baseExpr, sortExpr: baseExpr };
  }, [columns]);

  const buildWhereClause = useCallback(() => {
    const clauses: string[] = [];
    Object.keys(conditions).forEach(col => {
      const cond = conditions[col];
      if (cond.type === 'DISABLED' || !cond.value.trim()) return;
      
      const val = cond.value.trim();
      if (cond.type === 'NUMBER') {
        if (!isNaN(Number(val))) clauses.push(`"${col}" ${cond.operator} ${val}`);
      } else if (cond.type === 'DATE') {
        const pgFormat = getPostgresFormatForValue(inputDateFormat, val);
        clauses.push(`"${col}" ${cond.operator} TO_DATE('${val}', '${pgFormat}')`);
      } else {
        clauses.push(`"${col}" ${cond.operator} '${val.replace(/'/g, "''")}'`);
      }
    });
    return clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  }, [conditions, inputDateFormat]);

  const handleGeneratePivot = useCallback(async () => {
    if (!rowField || !colField || !valField) return;
    setIsLoading(true);
    const timestamp = new Date().toLocaleString('ja-JP');

    try {
      const rowInfo = getGroupExprInfo(rowField, rowCastType, rowDateFormat, rowDateGroup, rowNumGroup);
      const colInfo = getGroupExprInfo(colField, colCastType, colDateFormat, colDateGroup, colNumGroup);
      
      let valExpr = `"${valField}"`;
      if (aggType !== 'COUNT') {
          valExpr = `CAST("${valField}" AS NUMERIC)`;
      }

      const whereClause = buildWhereClause();

      const distinctSql = `SELECT DISTINCT ${colInfo.expr} AS COL_VAL, ${colInfo.sortExpr} AS SORT_KEY FROM ${quoteIdentifier(schema)}."${selectedObject}" ${whereClause} ${whereClause ? 'AND' : 'WHERE'} ${colInfo.expr} IS NOT NULL ORDER BY SORT_KEY`;
      const distinctRes = await ipcRenderer.invoke<{ col_val: string; COL_VAL: string }>('execute-sql', distinctSql);
      
      if (!distinctRes.success) {
        throw new Error(t("failed_to_fetch_x_axis_data", { error: distinctRes.error }));
      }

      const colValues: string[] = distinctRes.rows.map((r: { col_val: string; COL_VAL: string }) => String(r.col_val || r.COL_VAL));
      if (colValues.length === 0) throw new Error(t("no_data_matches_the_specified_filter_condition"));
      if (colValues.length > 200) {
        throw new Error(t("cross_tab_category_limit", { count: colValues.length }));
      }

      const sumCases = colValues.map(v => {
        const safeVal = v.replace(/'/g, "''");
        let aggCall = '';
        if (aggType === 'COUNT') {
           aggCall = `COUNT(CASE WHEN CAST(${colInfo.expr} AS TEXT) = '${safeVal}' THEN 1 END)`;
        } else if (aggType === 'SUM') {
           aggCall = `SUM(CASE WHEN CAST(${colInfo.expr} AS TEXT) = '${safeVal}' THEN ${valExpr} ELSE 0 END)`;
        } else {
           aggCall = `${aggType}(CASE WHEN CAST(${colInfo.expr} AS TEXT) = '${safeVal}' THEN ${valExpr} END)`;
        }
        return `${aggCall} AS "${v}"`;
      }).join(',\n    ');

      const pivotSql = `SELECT 
    ${rowInfo.expr} AS "ROW_VALUE",
    ${sumCases}
FROM ${quoteIdentifier(schema)}."${selectedObject}"
${whereClause}
GROUP BY ${rowInfo.expr}, ${rowInfo.sortExpr}
ORDER BY ${rowInfo.sortExpr}`;

      const startTime = Date.now();
      const pivotRes = await ipcRenderer.invoke('execute-sql', pivotSql);
      const execTime = Date.now() - startTime;
      
      if (!pivotRes.success) {
        throw new Error(t("cross_tabulation_failed", { error: pivotRes.error }));
      }

      const newGridCols: GridColDef[] = [
        { field: 'ROW_VALUE', headerName: rowField, width: 220 }
      ];
      
      colValues.forEach(c => {
        newGridCols.push({ 
          field: c, 
          headerName: c, 
          width: 130, 
          type: 'number',
          valueFormatter: (params) => {
             const v = typeof params === 'object' && params !== null && 'value' in params ? params.value : params;
             return formatNumberValue(v);
          }
        });
      });

      const newGridRows = pivotRes.rows.map((r: DatabaseRow, idx: number) => {
          const mappedRow: DatabaseRow = { id: idx };
          mappedRow['ROW_VALUE'] = r['ROW_VALUE'] || r['row_value'];
          colValues.forEach(c => {
              mappedRow[c] = r[c] !== undefined ? r[c] : r[c.toLowerCase()];
          });
          return mappedRow;
      });

      setPivotColumns(newGridCols);
      setPivotRows(newGridRows);
      
      setLogs(prev => [{
        time: timestamp, sql: pivotSql, execTime: execTime, resultMsg: t("aggregated_rows", { count: newGridRows.length })
      }, ...prev]);
      setBottomTab(0); 
      
    } catch (e: unknown) {
      setLogs(prev => [{
        time: timestamp, sql: '', execTime: '-', resultMsg: t("error_occurred"), errorLines: [getErrorMessage(e)]
      }, ...prev]);
      alert(getErrorMessage(e));
      setBottomTab(2); 
    } finally {
      setIsLoading(false);
    }
  }, [
    rowField, rowCastType, rowDateFormat, rowDateGroup, rowNumGroup,
    colField, colCastType, colDateFormat, colDateGroup, colNumGroup,
    valField, aggType, schema, selectedObject,
    getGroupExprInfo, buildWhereClause, formatNumberValue, t
  ]);

  const handleCopyGraph = async () => {
    try {
      const chartElement = document.getElementById('bi-chart-container');
      if (!chartElement) {
        alert(t("no_chart_found_to_copy"));
        return;
      }

      setIsLoading(true);

      const dataUrl = await toPng(chartElement, { backgroundColor: '#ffffff', pixelRatio: 2 });
      
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const item = new ClipboardItem({ 'image/png': blob });
      
      await navigator.clipboard.write([item]);
      alert(t("chart_image_copied_to_clipboard"));
    } catch (error: unknown) {
      alert(t("copy_failed", { error: getErrorMessage(error) }));
    } finally {
      setIsLoading(false);
    }
  };

  return {
    t,
    isLoading,
    schema,
    objectType,
    objects,
    selectedObject,
    columns,
    configTab, setConfigTab,
    conditions,
    rowField,
    rowCastType, setRowCastType,
    rowDateFormat, setRowDateFormat,
    rowDateGroup, setRowDateGroup,
    rowNumGroup, setRowNumGroup,
    colField,
    colCastType, setColCastType,
    colDateFormat, setColDateFormat,
    colDateGroup, setColDateGroup,
    colNumGroup, setColNumGroup,
    valField, setValField,
    aggType, setAggType,
    graphType, setGraphType,
    bottomTab, setBottomTab,
    logs, setLogs,
    pivotColumns,
    pivotRows,
    topHeight,
    isResizing, setIsResizing,
    fileInputRef,
    
    getInitialCastType,
    handleChangeSchema,
    handleChangeObjectType,
    handleChangeObject,
    handleFetchColumns,
    handleRowFieldChange,
    handleColFieldChange,
    handleExportSettings,
    handleImportFileChange,
    handleClearConditions, handleConditionChange,
    handleGeneratePivot,
    handleCopyGraph,
    formatNumberValue 
  };
}
