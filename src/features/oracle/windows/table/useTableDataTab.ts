// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { clearConditionInputs } from '@/shared/utils/queryConditions';
import { stableTableOrder, tableConditionKey } from '@/features/table/searchConditions';
import { requireTableColumns, requireTableCount } from '@/features/table/tableQueryResults';
import { oracleColumnProjection } from '@/shared/utils/temporalValues';
import { getSearchErrorMessage } from '@/features/table/searchConditions';
import { deleteRecordBatches } from '@/features/table/recordDeletion';
import { getRowIdentity, withRowIdentity, getOracleRowId, oracleRowIdAlias, identifyOracleRow } from '@/features/data-grid/rowIdentity';
import { escapeSqlString, qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { formatDbDate } from '@/shared/utils/dateFormatter';
import { createTableRecordEditor } from './tableRecordEditor';
import { createTableQueryBuilder } from './tableQueryBuilder';
import { createTableDataTransfer } from './tableDataTransfer';
import type { TableDataLogEntry as LogEntry } from '@/shared/types/tableDataTypes';
export type { TableDataLogEntry as LogEntry } from '@/shared/types/tableDataTypes';
import { decorateTableResultColumns } from "@/features/data-grid/tableResultHeaders";
import { type RecordInputData, type DatabaseRow, type ColumnDefinition, type ColumnMetadata } from "@/shared/types/databaseTypes";
import type { GridColumnHeaderParams, GridRowParams, GridCellParams, GridRowId, GridColDef } from '@mui/x-data-grid';
import type { Condition } from '@/shared/types/queryConditions';

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { buildGridColumns, buildTransposedColumns } from "@/features/data-grid/dataGridHelper";

import { ipcRenderer, beginGlobalLoading } from '@/shared/api/desktop';
import { waitForTablePaint } from '@/features/table/useTableOpening';

export interface TableDataTabProps { schema: string; tableName: string; isActive: boolean; outputDateFormat: string; inputDateFormat: string; }

export const useTableDataTab = (props: TableDataTabProps) => {
  const { schema, tableName, isActive, outputDateFormat, inputDateFormat } = props;
  const { t } = useTranslation();

  const containerRef = useRef<HTMLDivElement>(null);

  // Local lock reset automatically when the component unmounts.
  const hasInitializedRef = useRef<boolean>(false);
  const searchVersion = useRef(0);
  useEffect(() => () => { searchVersion.current++; }, []);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const recordSaving = useRef(false);
  const [isSavingRecord, setIsSavingRecord] = useState(false);
  const [columns, setColumns] = useState<string[]>([]);
  const [structureDefs, setStructureDefs] = useState<ColumnDefinition[]>([]);
  const [conditions, setConditions] = useState<{ [key: string]: Condition }>({});
  const [appliedConditions, setAppliedConditions] = useState<Record<string, Condition>>({});
  const [resultColumns, setResultColumns] = useState<GridColDef[]>([]);
  const [resultRows, setResultRows] = useState<DatabaseRow[]>([]);
  const [conditionHeight, setConditionHeight] = useState<number>(250);
  const [isResizingCondition, setIsResizingCondition] = useState<boolean>(false);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowId[]>([]);

  const [paginationModel, setPaginationModel] = useState({ page: 0, pageSize: 50 });
  const [rowCount, setRowCount] = useState<number>(0);

  const [refreshVersion, setRefreshVersion] = useState(0);

  const [lastClickedRowIndex, setLastClickedRowIndex] = useState<number | null>(null);

  const [bottomTab, setBottomTab] = useState<number>(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const [recordDialog, setRecordDialog] = useState<{
    isOpen: boolean; mode: 'insert' | 'update' | 'duplicate'; recordData: RecordInputData; initialRecordData: RecordInputData; targetRowId: GridRowId;
  }>({ isOpen: false, mode: 'insert', recordData: {}, initialRecordData: {}, targetRowId: '' });

  const [dataContextMenu, setDataContextMenu] = useState<{ mouseX: number; mouseY: number; row: DatabaseRow; field?: string } | null>(null);

  const [isTransposed, setIsTransposed] = useState<boolean>(false);

  const hasLobColumns = useMemo(() => {
    return structureDefs.some(col => {
      const typeUpper = (col.DATA_TYPE || '').toUpperCase();
      return typeUpper.includes('CLOB') || typeUpper.includes('BLOB') || typeUpper.includes('RAW') || typeUpper.includes('LONG');
    });
  }, [structureDefs]);

  const { formatSqlValue, buildQueryStrings } = createTableQueryBuilder({ schema, inputDateFormat, outputDateFormat, structureDefs });

  useEffect(() => {
    if (isActive && tableName && !hasInitializedRef.current) {
      hasInitializedRef.current = true;

      let active = true;
      let completed = false;
      const finishLoading = beginGlobalLoading();
      const runInit = async () => {
        const version = ++searchVersion.current;
        setIsLoading(true);
        let attemptedSql = '';
        try {
          await waitForTablePaint();
          if (!active || version !== searchVersion.current) return;
          const targetTable = qualifiedObjectName({ schema, objectName: tableName });

          // Prepare the count query.
          const countSql = `SELECT COUNT(*) AS CNT FROM ${targetTable} t`;

          // Validate column metadata before reading count and data.
          const sqlCols = `
            SELECT
                c.COLUMN_NAME, c.DATA_TYPE, c.NULLABLE, c.DATA_DEFAULT,
                (SELECT cc.POSITION FROM ALL_CONS_COLUMNS cc JOIN ALL_CONSTRAINTS pc ON cc.OWNER = pc.OWNER AND cc.TABLE_NAME = pc.TABLE_NAME AND cc.CONSTRAINT_NAME = pc.CONSTRAINT_NAME AND pc.CONSTRAINT_TYPE = 'P' WHERE cc.TABLE_NAME = c.TABLE_NAME AND cc.OWNER = c.OWNER AND cc.COLUMN_NAME = c.COLUMN_NAME) AS PK_POSITION
            FROM ALL_TAB_COLUMNS c
            WHERE c.OWNER = '${escapeSqlString(schema)}' AND c.TABLE_NAME = '${escapeSqlString(tableName)}'
            ORDER BY c.COLUMN_ID
          `;

          attemptedSql = sqlCols;
          const colDefRes = await ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols);
          if (!active || version !== searchVersion.current) return;
          if (!colDefRes.success) throw new Error(colDefRes.error);
          requireTableColumns(colDefRes.rows, t('failed_to_fetch_table_structure'));
          const rowIdAlias = oracleRowIdAlias(colDefRes.rows.map(column => column.COLUMN_NAME));
          const sqlText = `SELECT t.ROWID AS ${quoteIdentifier(rowIdAlias)}, ${colDefRes.rows.map(column => oracleColumnProjection(column)).join(', ')} FROM ${targetTable} t ${stableTableOrder('', {}, colDefRes.rows, 'oracle')} OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY`;
          attemptedSql = countSql;
          const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
          if (!active || version !== searchVersion.current) return;
          const total = requireTableCount(countRes, t('table_row_count_unavailable'));
          attemptedSql = sqlText;
          const res = await ipcRenderer.invoke<DatabaseRow>('execute-sql', sqlText);
          if (!active || version !== searchVersion.current) return;
          if (!res.success) throw new Error(res.error);

          const initCond: Record<string, Condition> = {};
          let localDefs: ColumnDefinition[] = [];
          const searchableColumns: string[] = [];

          if (colDefRes.success && colDefRes.rows) {
            localDefs = colDefRes.rows.map((r: ColumnDefinition) => {
              const col = r.COLUMN_NAME;
              const typeUpper = r.DATA_TYPE.toUpperCase();
              let cType = 'STRING';
              let isDisabled = false;

              const isStandardType = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB', 'RAW', 'LONG'].some(st => typeUpper.includes(st));

              if (!isStandardType || ['BLOB', 'CLOB', 'NCLOB', 'BFILE', 'LONG', 'LONG RAW', 'RAW'].some(st => typeUpper.includes(st))) {
                isDisabled = true;
              } else if (typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP')) {
                cType = 'DATE';
              } else if (typeUpper.includes('NUMBER') || typeUpper.includes('FLOAT') || typeUpper.includes('BINARY')) {
                cType = 'NUMBER';
              }

              searchableColumns.push(col);
              initCond[col] = { operator: '=', value: '', sort: '', type: isDisabled ? 'DISABLED' : cType };

              return {
                COLUMN_NAME: col,
                DATA_TYPE: r.DATA_TYPE,
                NULLABLE: r.NULLABLE,
                DATA_DEFAULT: r.DATA_DEFAULT,
                PK_POSITION: r.PK_POSITION || ''
              };
            });

          }

          if (res.success) {
            const timestamp = new Date().toLocaleString('ja-JP');

            const filteredMeta = (res.metaData || []).filter((m: ColumnMetadata) => m.name !== rowIdAlias);

            const enrichedMetaData = filteredMeta.map((m: ColumnMetadata) => {
              const def = localDefs.find((s: ColumnDefinition) => s.COLUMN_NAME === m.name);
              let fetchType = 2001;
              let dbTypeName = 'VARCHAR2';
              if (def) {
                const tUp = def.DATA_TYPE.toUpperCase();
                dbTypeName = tUp;
                if (tUp.includes('NUMBER') || tUp.includes('FLOAT') || tUp.includes('BINARY')) fetchType = 2002;
                else if (tUp.includes('DATE')) fetchType = 2003;
                else if (tUp.includes('TIMESTAMP')) fetchType = 2010;
                else if (tUp.includes('BLOB') || tUp.includes('BFILE') || tUp.includes('RAW')) fetchType = 2008;
              }
              return { ...m, fetchType, dbTypeName };
            });

            const baseColumns = buildGridColumns(enrichedMetaData, outputDateFormat, { sortable: false, editable: true });

            const adjustedColumns = baseColumns.map(col => {
              const colDef = localDefs.find((s: ColumnDefinition) => s.COLUMN_NAME === col.field);
              if (colDef) {
                const typeUpper = colDef.DATA_TYPE.toUpperCase();
                const isStandardType = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB', 'RAW', 'LONG'].some(t => typeUpper.includes(t));

                const newCol = { ...col };

                if (colDef.PK_POSITION || ['BLOB', 'CLOB', 'RAW', 'LONG'].some(t => typeUpper.includes(t)) || !isStandardType) {
                  newCol.editable = false;
                } else {
                  newCol.editable = true;
                }

                if (!typeUpper.includes('DATE') && !typeUpper.includes('TIMESTAMP')) {
                  newCol.valueFormatter = undefined;
                  newCol.type = (typeUpper.includes('NUMBER') || typeUpper.includes('FLOAT')) ? 'number' : 'string';
                }
                return newCol;
              }
              return col;
            });


            const formattedRows = res.rows.map((r: DatabaseRow, i: number) => {
              const rowData: DatabaseRow = identifyOracleRow(r, rowIdAlias, i + 1);
              localDefs.forEach((col: ColumnDefinition) => {
                const tUp = col.DATA_TYPE.toUpperCase();
                const colName = col.COLUMN_NAME;
                if (tUp.includes('DATE') || tUp.includes('TIMESTAMP')) {
                  rowData[colName] = formatDbDate(rowData[colName], outputDateFormat);
                }
                if (tUp.includes('BLOB') || tUp.includes('RAW')) {
                  if (rowData[colName] != null) rowData[colName] = '[BLOB' + t("data_2");
                }
                if (tUp.includes('CLOB') || tUp.includes('LONG')) {
                  if (rowData[colName] != null) rowData[colName] = '[CLOB' + t("data_2");
                }
              });
              return rowData;
            });

            setColumns(searchableColumns);
            setConditions(initCond);
            setAppliedConditions(Object.fromEntries(Object.entries(initCond).map(([field, condition]) => [field, { ...condition }])));
            setStructureDefs(localDefs);
            setResultColumns(adjustedColumns);
            setRowCount(total);
            setPaginationModel({ page: 0, pageSize: 50 });
            setSelectedRowIds([]);
            setLastClickedRowIndex(null);
            setResultRows(formattedRows);
            setIsTransposed(false);
            setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t('search_success') + res.rows.length + t('rows_fetched_2') }, ...prev]);
            setBottomTab(0);
          }
          completed = true;
        } catch (error: unknown) {
          if (!active || version !== searchVersion.current) return;
          hasInitializedRef.current = false;
          const message = getErrorMessage(error);
          setLogs(previous => [{ time: new Date().toLocaleString(), sql: attemptedSql, resultMsg: t('search_error'), errorLines: [message] }, ...previous]);
          setBottomTab(1);
          alert(t('search_error_2') + message);
        } finally {
          finishLoading();
          if (active && version === searchVersion.current) setIsLoading(false);
        }
      };

      void runInit();
      return () => {
        active = false;
        finishLoading();
        if (!completed) hasInitializedRef.current = false;
      };
    }
  }, [isActive, outputDateFormat, refreshVersion, schema, t, tableName]);

  useEffect(() => {
    const handleReloadSource = (e: WindowEventMap['reload-source']) => {
      const targetTable = e.detail;
      if (targetTable?.schema === schema && targetTable.tableName === tableName) {
        hasInitializedRef.current = false;
        setRefreshVersion(previous => previous + 1);
      }
    };
    window.addEventListener('reload-source', handleReloadSource);
    return () => window.removeEventListener('reload-source', handleReloadSource);
  }, [schema, tableName]);


  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingCondition) return;
      let newHeight = e.clientY - 140;
      if (newHeight < 100) newHeight = 100;
      if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
      setConditionHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizingCondition(false);
    if (isResizingCondition) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isResizingCondition]);

  const handleClearConditions = () => setConditions(clearConditionInputs);

  const handleConditionChange = (col: string, key: string, val: string) => {
    setConditions(prev => ({ ...prev, [col]: { ...prev[col], [key]: val } }));
  };

  const conditionsText = useMemo(() => {
    const texts: string[] = [];
    Object.keys(appliedConditions).forEach(col => {
      const cond = appliedConditions[col];
      if (cond && cond.type === 'DISABLED') return;

      const parts: string[] = [];
      if (cond && cond.value.trim() !== '') {
        parts.push(t("filter") + `${cond.operator} ${cond.value}`);
      }
      if (cond && cond.sort.trim() !== '') {
        parts.push(t("sort") + cond.sort);
      }
      if (parts.length > 0) {
        texts.push(`${col} (${parts.join(', ')})`);
      }
    });
    return texts.length > 0 ? texts.join('\n') : '';
  }, [appliedConditions, t]);

  const executeSearch = useEventCallback(async (conds: { [key: string]: Condition }, page: number, pageSize: number, isInitialLoad = false) => {
    conds = Object.fromEntries(Object.entries(conds).map(([field, condition]) => [field, { ...condition }]));
    const version = ++searchVersion.current;
    if (!isInitialLoad) setIsLoading(true);
    let attemptedSql = '';
    try {
      if (!hasInitializedRef.current || !structureDefs.length) throw new Error(t('failed_to_fetch_table_structure'));
      const { whereStr, orderStr } = buildQueryStrings(conds);
      const targetTable = qualifiedObjectName({ schema, objectName: tableName });

      const countSql = `SELECT COUNT(*) AS CNT FROM ${targetTable} t ${whereStr}`;

      const selectCols = structureDefs.map(col => {
        const typeUpper = col.DATA_TYPE.toUpperCase();
        if (typeUpper.includes('BLOB') || typeUpper.includes('RAW')) {
          return `CASE WHEN t.${quoteIdentifier(col.COLUMN_NAME)} IS NULL THEN NULL ELSE CAST('[BLOB` + t("data_2") + `' AS VARCHAR2(20)) END AS ${quoteIdentifier(col.COLUMN_NAME)}`;
        }
        if (typeUpper.includes('CLOB') || typeUpper.includes('LONG')) {
          return `CASE WHEN t.${quoteIdentifier(col.COLUMN_NAME)} IS NULL THEN NULL ELSE CAST('[CLOB` + t("data_2") + `' AS VARCHAR2(20)) END AS ${quoteIdentifier(col.COLUMN_NAME)}`;
        }
        return oracleColumnProjection(col);
      });
      const selectStr = selectCols.length > 0 ? selectCols.join(', ') : 't.*';

      const offset = page * pageSize;
      const rowIdAlias = oracleRowIdAlias(structureDefs.map(column => column.COLUMN_NAME));
      const sqlText = `SELECT t.ROWID AS ${quoteIdentifier(rowIdAlias)}, ${selectStr} FROM ${targetTable} t ${whereStr} ${orderStr} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
      const timestamp = new Date().toLocaleString('ja-JP');

      attemptedSql = countSql;
      const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
      if (version !== searchVersion.current) return;
      const total = requireTableCount(countRes, t('table_row_count_unavailable'));
      attemptedSql = sqlText;
      const res = await ipcRenderer.invoke<DatabaseRow>('execute-sql', sqlText);
      if (version !== searchVersion.current) return;

      if (res.success) {

        const filteredMeta = (res.metaData || []).filter((m: ColumnMetadata) => m.name !== rowIdAlias);

        const enrichedMetaData = filteredMeta.map((m: ColumnMetadata) => {
          const def = structureDefs.find(s => s.COLUMN_NAME === m.name);
          let fetchType = 2001;
          let dbTypeName = 'VARCHAR2';
          if (def) {
            const tUp = def.DATA_TYPE.toUpperCase();
            dbTypeName = tUp;
            if (tUp.includes('NUMBER') || tUp.includes('FLOAT') || tUp.includes('BINARY')) fetchType = 2002;
            else if (tUp.includes('DATE')) fetchType = 2003;
            else if (tUp.includes('TIMESTAMP')) fetchType = 2010;
            else if (tUp.includes('BLOB') || tUp.includes('BFILE') || tUp.includes('RAW')) fetchType = 2008;
          }
          return { ...m, fetchType, dbTypeName };
        });

        const baseColumns = buildGridColumns(enrichedMetaData, outputDateFormat, { sortable: false, editable: true });

        const adjustedColumns = baseColumns.map(col => {
          const colDef = structureDefs.find(s => s.COLUMN_NAME === col.field);
          if (colDef) {
            const typeUpper = colDef.DATA_TYPE.toUpperCase();
            const isStandardType = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB', 'RAW', 'LONG'].some(t => typeUpper.includes(t));

            const newCol = { ...col };

            if (colDef.PK_POSITION || ['BLOB', 'CLOB', 'RAW', 'LONG'].some(t => typeUpper.includes(t)) || !isStandardType) {
              newCol.editable = false;
            } else {
              newCol.editable = true;
            }

            if (!typeUpper.includes('DATE') && !typeUpper.includes('TIMESTAMP')) {
              newCol.valueFormatter = undefined;
              newCol.type = (typeUpper.includes('NUMBER') || typeUpper.includes('FLOAT')) ? 'number' : 'string';
            }
            return newCol;
          }
          return col;
        });


        const formattedRows = res.rows.map((r: DatabaseRow, i: number) => {
          const rowData: DatabaseRow = identifyOracleRow(r, rowIdAlias, offset + i + 1);
          structureDefs.forEach(col => {
            if (col.DATA_TYPE.includes('DATE') || col.DATA_TYPE.includes('TIMESTAMP')) {
              rowData[col.COLUMN_NAME] = formatDbDate(rowData[col.COLUMN_NAME], outputDateFormat);
            }
          });
          return rowData;
        });

        setAppliedConditions(Object.fromEntries(Object.entries(conds).map(([field, condition]) => [field, { ...condition }])));
        setRowCount(total);
        setPaginationModel(previous => previous.page === page && previous.pageSize === pageSize ? previous : { page, pageSize });
        setSelectedRowIds([]);
        setLastClickedRowIndex(null);
        setResultColumns(adjustedColumns);
        setResultRows(formattedRows);
        setIsTransposed(false);
        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t('search_success') + res.rows.length + t('rows_fetched_2') }, ...prev]);
        setBottomTab(0);
      } else {
        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("search_error"), errorLines: [res.error] }, ...prev]);
        setBottomTab(1);
        alert(t("search_error_2") + res.error);
      }
    } catch (error: unknown) {
      if (version !== searchVersion.current) return;
      const message = getSearchErrorMessage(error, t);
      setLogs(previous => [{ time: new Date().toLocaleString(), sql: attemptedSql, resultMsg: t('search_error'), errorLines: [message] }, ...previous]);
      setBottomTab(1);
      alert(t('search_error_2') + message);
    } finally {
      if (!isInitialLoad && version === searchVersion.current) setIsLoading(false);
    }
  });

  const handleExecuteSearchClick = () => {
    if (!hasInitializedRef.current || !structureDefs.length) {
      hasInitializedRef.current = false;
      setRefreshVersion(previous => previous + 1);
      return;
    }
    void executeSearch(conditions, 0, paginationModel.pageSize);
  };

  const handleColumnHeaderClick = (params: GridColumnHeaderParams) => {
    if (isTransposed) return;
    const clickedCol = params.field;
    if (!conditions[clickedCol]) return;
    if (conditions[clickedCol].type === 'DISABLED') return;

    const newConditions: Record<string, Condition> = {};
    const currentSort = conditions[clickedCol].sort.trim().toUpperCase();
    const nextSort = currentSort === '1' || currentSort === '1 ASC' ? '1 DESC' : '1';
    Object.entries(conditions).forEach(([key, condition]) => {
      newConditions[key] = { ...condition, sort: key === clickedCol ? nextSort : '' };
    });

    setConditions(newConditions);
    void executeSearch(newConditions, 0, paginationModel.pageSize);
  };

  const handleRowClick = (params: GridRowParams<DatabaseRow>, event: React.MouseEvent) => {
    if (isTransposed) return;

    if (event.shiftKey) {
      window.getSelection()?.removeAllRanges();
    }

    const clickedId = params.id;
    const clickedIndex = resultRows.findIndex(r => getRowIdentity(r) === clickedId);
    if (clickedIndex === -1) return;

    const isMultiSelect = event.ctrlKey || event.metaKey;
    const isRangeSelect = event.shiftKey;

    if (isRangeSelect && lastClickedRowIndex !== null) {
      const start = Math.min(lastClickedRowIndex, clickedIndex);
      const end = Math.max(lastClickedRowIndex, clickedIndex);
      const rangeIds = resultRows.slice(start, end + 1).map(getRowIdentity).filter((id): id is GridRowId => id !== undefined);

      if (isMultiSelect) {
        const newSet = new Set([...selectedRowIds, ...rangeIds]);
        setSelectedRowIds(Array.from(newSet));
      } else {
        setSelectedRowIds(rangeIds);
      }
    } else if (isMultiSelect) {
      if (selectedRowIds.includes(clickedId)) {
        setSelectedRowIds(selectedRowIds.filter(id => id !== clickedId));
      } else {
        setSelectedRowIds([...selectedRowIds, clickedId]);
      }
      setLastClickedRowIndex(clickedIndex);
    } else {
      setSelectedRowIds([clickedId]);
      setLastClickedRowIndex(clickedIndex);
    }
  };

  const handleCellDoubleClick = (params: GridCellParams<DatabaseRow>) => {
    if (isTransposed) return;
    const colDef = structureDefs.find(s => s.COLUMN_NAME === params.field);
    if (colDef) {
      if (colDef.PK_POSITION !== null && colDef.PK_POSITION !== undefined && colDef.PK_POSITION !== '') {
        alert(t("primary_key_values_cannot_be_changed_to_change_delete_the_record_and_create_a_new_one"));
        return;
      }

      const typeUpper = colDef.DATA_TYPE.toUpperCase();
      const isBlob = typeUpper.includes('BLOB') || typeUpper.includes('RAW');
      const isClob = typeUpper.includes('CLOB') || typeUpper.includes('LONG');
      const isStandardType = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB', 'RAW', 'LONG'].some(t => typeUpper.includes(t));

      if (isBlob || isClob || !isStandardType) {
        alert(colDef.DATA_TYPE + t("cell_type_requires_dialog"));
      }
    }
  };

  const handleEditSelected = () => {
    if (selectedRowIds.length !== 1) return;
    const row = resultRows.find(r => getRowIdentity(r) === selectedRowIds[0]);
    if (row) handleOpenUpdate(row);
  };

  const handleDuplicateSelected = () => {
    if (selectedRowIds.length !== 1) return;
    const row = resultRows.find(r => getRowIdentity(r) === selectedRowIds[0]);
    if (row) handleOpenDuplicate(row);
  };

  const handleDeleteSelected = async () => {
    if (selectedRowIds.length === 0) return;
    if (!window.confirm(t("selected") + selectedRowIds.length + t("row_s_to_be_deleted_are_you_sure_this_operation_is_not_finalized_until_committed"))) return;

    setIsLoading(true);
    try {
      const targetTable = qualifiedObjectName({ schema, objectName: tableName });
      const batches = [];
      for (let i = 0; i < selectedRowIds.length; i += 900) {
        const chunk = selectedRowIds.slice(i, i + 900);
        const inList = chunk.map(id => {
          const row = resultRows.find(candidate => getRowIdentity(candidate) === id);
          if (!row) throw new Error('The selected database row is no longer available.');
          return `'${getOracleRowId(row).replace(/'/g, "''")}'`;
        }).join(', ');
        batches.push({ sql: `DELETE FROM ${targetTable} WHERE ROWID IN (${inList})`, expected: chunk.length });
      }
      const outcome = await deleteRecordBatches(batches, sql => ipcRenderer.invoke('execute-sql', sql));
      for (const step of outcome.steps) {
        setLogs(previous => [{ time: new Date().toLocaleString(), sql: step.sql,
          resultMsg: step.error ? t('record_delete_failed') : step.affected === undefined ? t('record_delete_unconfirmed') : t('record_delete_count', { count: step.affected, expected: step.expected }),
          ...(step.error ? { errorLines: [step.error] } : {}) }, ...previous]);
      }
      if (outcome.status !== 'complete') {
        setBottomTab(1);
        const detail = outcome.steps.at(-1)?.error;
        const message = outcome.status === 'failed' ? t('record_delete_failed') : outcome.status === 'mismatch' ? t('record_delete_mismatch') : t('record_delete_unconfirmed');
        alert(message + (detail ? `\n${detail}` : '') + '\n' + t('record_delete_pending', { count: outcome.confirmedCount }));
        return;
      }
      alert(t('record_delete_success', { count: outcome.confirmedCount }));
      setSelectedRowIds([]);
      setLastClickedRowIndex(null);
      await executeSearch(appliedConditions, paginationModel.page, paginationModel.pageSize);
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const { handleOpenInsert, handleOpenDuplicate, handleOpenUpdate, handleCloseDialog, submitRecord, handleProcessRowUpdate } = createTableRecordEditor({ recordSaving, setIsSavingRecord, schema, tableName, structureDefs, inputDateFormat, hasLobColumns, isTransposed, recordDialog, conditions: appliedConditions, paginationModel, t, formatSqlValue, executeSearch, setRecordDialog, setDataContextMenu, setIsLoading, setLogs, setBottomTab, setResultRows });

  const { fetchDataForExport, processBulkInsertData } = createTableDataTransfer({ schema, tableName, structureDefs, resultColumns, outputDateFormat, conditions: appliedConditions, paginationModel, t, formatSqlValue, buildQueryStrings, executeSearch, setIsLoading, setLogs, setBottomTab });

  const displayColumns = useMemo(() => {
    if (!isTransposed) return decorateTableResultColumns(resultColumns, appliedConditions, t);
    return buildTransposedColumns(resultRows, outputDateFormat, { sortable: false, editable: false });
  }, [isTransposed, resultColumns, resultRows, outputDateFormat, appliedConditions, t]);

  const displayRows = useMemo(() => {
    if (!isTransposed) return resultRows;
    return resultColumns.map((col, idx) => {
      const tRow: DatabaseRow = { colName: col.headerName };
      resultRows.forEach((r, rIdx) => { tRow[`row_${rIdx}`] = r[col.field]; });
      return withRowIdentity(tRow, `transposed_${idx}`);
    });
  }, [isTransposed, resultColumns, resultRows]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive || recordDialog.isOpen || isTransposed) return;
      if (containerRef.current && !containerRef.current.contains(document.activeElement)) return;

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') { e.preventDefault(); handleOpenInsert(); return; }

      if (selectedRowIds.length > 0) {
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); handleDeleteSelected(); return; }
      }

      if (selectedRowIds.length === 1) {
        if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e')) { e.preventDefault(); handleEditSelected(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); handleDuplicateSelected(); return; }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const setRecordDraft: typeof setRecordDialog = value => {
    if (!recordSaving.current) setRecordDialog(value);
  };

  return {
    importColumns: resultColumns.length > 0 ? resultColumns.map(column => String(column.field)) : structureDefs.map(column => column.COLUMN_NAME),
    isSavingRecord,
    t, containerRef, isLoading, columns, structureDefs, conditions, handleClearConditions, handleConditionChange, handleExecuteSearchClick,
    conditionHeight, isResizingCondition, setIsResizingCondition, bottomTab, setBottomTab, logs, setLogs,
    recordDialog, setRecordDialog: setRecordDraft, dataContextMenu, setDataContextMenu, isTransposed, setIsTransposed,
    appliedConditions, conditionsPending: tableConditionKey(conditions) !== tableConditionKey(appliedConditions),
    displayColumns, displayRows, paginationModel, setPaginationModel, rowCount, selectedRowIds, setSelectedRowIds,
    handleColumnHeaderClick, handleRowClick, handleCellDoubleClick, handleEditSelected, handleDuplicateSelected,
    handleDeleteSelected, handleOpenInsert, handleOpenUpdate, handleOpenDuplicate, handleCloseDialog,
    submitRecord, handleProcessRowUpdate, processBulkInsertData, fetchDataForExport, conditionsText, executeSearch
  };
};
