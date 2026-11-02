// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { clearConditionInputs } from '@/shared/utils/queryConditions';
import { stableTableOrder, tableConditionKey } from '@/features/table/searchConditions';
import { requireTableColumns, requireTableCount } from '@/features/table/tableQueryResults';
import { getSearchErrorMessage } from '@/features/table/searchConditions';
import { deleteRecordBatches } from '@/features/table/recordDeletion';
import { postgresColumnKind, postgresIsDateTime, postgresIsLob, postgresColumnMetadataSql } from '@/features/postgresql/columnTypes';
import { getRowSourceValue, getRowIdentity, withRowIdentity } from '@/features/data-grid/rowIdentity';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { createTableRecordEditor } from './tableRecordEditor';
import { formatTableResultRows } from './tableResultRows';
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
    isOpen: boolean; mode: 'insert' | 'update' | 'duplicate'; recordData: RecordInputData; initialRecordData: RecordInputData;
  }>({ isOpen: false, mode: 'insert', recordData: {}, initialRecordData: {} });

  const [dataContextMenu, setDataContextMenu] = useState<{ mouseX: number; mouseY: number; row: DatabaseRow; field?: string } | null>(null);

  const [isTransposed, setIsTransposed] = useState<boolean>(false);

  // Reliably detect primary keys.
  const hasPrimaryKey = useMemo(() => {
    return structureDefs.some(col => col.PK_POSITION !== null && col.PK_POSITION !== undefined && col.PK_POSITION !== '');
  }, [structureDefs]);

  // Detect large data types such as BYTEA and TEXT.
  const hasLobColumns = useMemo(() => {
    return structureDefs.some(col => {
      return postgresIsLob(col);
    });
  }, [structureDefs]);

  const getPkWhereClause = (row: DatabaseRow, isInitial: boolean = false) => {
    const pkCols = structureDefs.filter(c => c.PK_POSITION !== null && c.PK_POSITION !== undefined && c.PK_POSITION !== '').sort((a, b) => Number(a.PK_POSITION) - Number(b.PK_POSITION));
    return pkCols.map(col => {
      const val = isInitial ? recordDialog.initialRecordData[col.COLUMN_NAME] : getRowSourceValue(row, col.COLUMN_NAME);
      return `${quoteIdentifier(col.COLUMN_NAME)} = ${formatSqlValue(col, val, true)}`;
    }).join(' AND ');
  };

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
          const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;

          // Prepare the main-connection count query.
          const countSql = `SELECT COUNT(*) AS "CNT" FROM ${targetTable} t`;

          // Prepare the initial data query.


          // Validate background metadata before starting main-connection reads.
          const sqlCols = postgresColumnMetadataSql;

          attemptedSql = sqlCols;
          const colDefRes = await ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols, { schema, tableName });
          if (!active || version !== searchVersion.current) return;
          if (!colDefRes.success) throw new Error(colDefRes.error);
          requireTableColumns(colDefRes.rows, t('failed_to_fetch_table_structure'));
          const sqlText = `SELECT t.* FROM ${targetTable} t ${stableTableOrder('', {}, colDefRes.rows, 'postgresql')} OFFSET 0 LIMIT 50`;
          attemptedSql = countSql;
          const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
          if (!active || version !== searchVersion.current) return;
          const total = requireTableCount(countRes, t('table_row_count_unavailable'));
          attemptedSql = sqlText;
          const res = await ipcRenderer.invoke('execute-sql', sqlText);
          if (!active || version !== searchVersion.current) return;
          if (!res.success) throw new Error(res.error);

          const initCond: Record<string, Condition> = {};
          let localDefs: ColumnDefinition[] = [];
          const searchableColumns: string[] = [];

          if (colDefRes.success && colDefRes.rows) {
            localDefs = colDefRes.rows.map((r: ColumnDefinition) => {
              const col = r.COLUMN_NAME;
              const kind = postgresColumnKind(r);
              let cType = 'STRING';
              let isDisabled = false;

              const isStandardType = kind !== 'other';

              if (!isStandardType || kind === 'binary') {
                isDisabled = true;
              } else if (kind === 'time') {
                cType = 'TIME';
              } else if (postgresIsDateTime(r)) {
                cType = 'DATE';
              } else if (kind === 'number') {
                cType = 'NUMBER';
              }

              searchableColumns.push(col);
              initCond[col] = { operator: '=', value: '', sort: '', type: isDisabled ? 'DISABLED' : cType };

              return {
                ...r,
                COLUMN_NAME: col,
                DATA_TYPE: r.DATA_TYPE,
                NULLABLE: r.NULLABLE,
                DATA_DEFAULT: r.DATA_DEFAULT,
                PK_POSITION: r.PK_POSITION ?? ''
              };
            });

          }

          if (res.success) {
            const timestamp = new Date().toLocaleString('ja-JP');

            // Check whether at least one primary key exists.
            const isEditableGlobal = localDefs.some(c => c.PK_POSITION !== null && c.PK_POSITION !== undefined && c.PK_POSITION !== '');

            const enrichedMetaData = (res.metaData || []).map((m: ColumnMetadata) => {
              const def = localDefs.find(s => s.COLUMN_NAME === m.name);
              let fetchType = 2001;
              let dbTypeName = 'VARCHAR';
              if (def) {
                const kind = postgresColumnKind(def);
                dbTypeName = def.DATA_TYPE;
                if (kind === 'number') {
                  fetchType = 2002;
                } else if (postgresIsDateTime(def)) {
                  fetchType = 2003;
                } else if (kind === 'binary') {
                  fetchType = 2008;
                }
              }
              return { ...m, fetchType, dbTypeName };
            });

            const baseColumns = buildGridColumns(enrichedMetaData, outputDateFormat, { sortable: false, editable: isEditableGlobal });

            const adjustedColumns = baseColumns.map(col => {
              const colDef = localDefs.find(s => s.COLUMN_NAME === col.field);
              if (colDef) {
                const kind = postgresColumnKind(colDef);
                const isStandardType = kind !== 'other';

                const newCol = { ...col };

                // Disable inline editing for primary keys, BYTEA, TEXT, and nonstandard types.
                if ((colDef.PK_POSITION !== null && colDef.PK_POSITION !== undefined && colDef.PK_POSITION !== '') || kind === 'binary' || postgresIsLob(colDef) || !isStandardType) {
                  newCol.editable = false;
                } else {
                  // Allow inline editing of other standard columns when the table has a primary key.
                  newCol.editable = isEditableGlobal;
                }

                if (!postgresIsDateTime(colDef)) {
                  newCol.valueFormatter = undefined;
                  newCol.type = (kind === 'number') ? 'number' : 'string';
                } else if (kind === 'date') {
                  newCol.valueFormatter = (params) => {
                    const val = typeof params === 'object' && params !== null && 'value' in params ? params.value : params;
                    return val || '';
                  };
                }
                return newCol;
              }
              return col;
            });


            const formattedRows = formatTableResultRows(res.rows, localDefs, outputDateFormat, t);

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
      const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;

      const countSql = `SELECT COUNT(*) AS "CNT" FROM ${targetTable} t ${whereStr}`;

      const selectCols = structureDefs.map(col => {
        const kind = postgresColumnKind(col);
        if (kind === 'binary') {
          return `CASE WHEN t.${quoteIdentifier(col.COLUMN_NAME)} IS NULL THEN NULL ELSE CAST('[BYTEA` + t("data_2") + `' AS VARCHAR(20)) END AS ${quoteIdentifier(col.COLUMN_NAME)}`;
        }
        return `t.${quoteIdentifier(col.COLUMN_NAME)}`;
      });
      const selectStr = selectCols.length > 0 ? selectCols.join(', ') : 't.*';

      const offset = page * pageSize;
      const sqlText = `SELECT ${selectStr} FROM ${targetTable} t ${whereStr} ${orderStr} OFFSET ${offset} LIMIT ${pageSize}`;
      const timestamp = new Date().toLocaleString('ja-JP');

      attemptedSql = countSql;
      const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
      if (version !== searchVersion.current) return;
      const total = requireTableCount(countRes, t('table_row_count_unavailable'));
      attemptedSql = sqlText;
      const res = await ipcRenderer.invoke('execute-sql', sqlText);
      if (version !== searchVersion.current) return;

      if (res.success) {

        const isEditableGlobal = structureDefs.some(c => c.PK_POSITION !== null && c.PK_POSITION !== undefined && c.PK_POSITION !== '');

        const enrichedMetaData = (res.metaData || []).map((m: ColumnMetadata) => {
          const def = structureDefs.find(s => s.COLUMN_NAME === m.name);
          let fetchType = 2001;
          let dbTypeName = 'VARCHAR';
          if (def) {
            const kind = postgresColumnKind(def);
            dbTypeName = def.DATA_TYPE;
            if (kind === 'number') {
              fetchType = 2002;
            } else if (postgresIsDateTime(def)) {
              fetchType = 2003;
            } else if (kind === 'binary') {
              fetchType = 2008;
            }
          }
          return { ...m, fetchType, dbTypeName };
        });

        const baseColumns = buildGridColumns(enrichedMetaData, outputDateFormat, { sortable: false, editable: isEditableGlobal });

        const adjustedColumns = baseColumns.map(col => {
          const colDef = structureDefs.find(s => s.COLUMN_NAME === col.field);
          if (colDef) {
            const kind = postgresColumnKind(colDef);
            const isStandardType = kind !== 'other';

            const newCol = { ...col };

            if ((colDef.PK_POSITION !== null && colDef.PK_POSITION !== undefined && colDef.PK_POSITION !== '') || kind === 'binary' || postgresIsLob(colDef) || !isStandardType) {
              newCol.editable = false;
            } else {
              newCol.editable = isEditableGlobal;
            }

            if (!postgresIsDateTime(colDef)) {
              newCol.valueFormatter = undefined;
              newCol.type = (kind === 'number') ? 'number' : 'string';
            } else if (kind === 'date') {
              newCol.valueFormatter = (params) => {
                const val = typeof params === 'object' && params !== null && 'value' in params ? params.value : params;
                return val || '';
              };
            }

            return newCol;
          }
          return col;
        });


        const formattedRows = formatTableResultRows(res.rows, structureDefs, outputDateFormat, t, offset);

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
      const rangeIds = resultRows.slice(start, end + 1).map(r => getRowIdentity(r)).filter((id): id is GridRowId => id !== undefined);

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

  // Handle double-clicks for inline cell editing.
  const handleCellDoubleClick = (params: GridCellParams<DatabaseRow>) => {
    if (isTransposed) return;

    // Check for primary keys directly in structureDefs.
    const hasPk = structureDefs.some(c => c.PK_POSITION !== null && c.PK_POSITION !== undefined && c.PK_POSITION !== '');
    if (!hasPk) {
      alert(t("table_edit_requires_primary_key"));
      return;
    }

    const colDef = structureDefs.find(s => s.COLUMN_NAME === params.field);
    if (colDef) {
      if (colDef.PK_POSITION !== null && colDef.PK_POSITION !== undefined && colDef.PK_POSITION !== '') {
        alert(t("primary_key_values_cannot_be_changed_to_change_delete_the_record_and_create_a_new_one"));
        return;
      }

      const kind = postgresColumnKind(colDef);
      const isBlob = kind === 'binary';
      const isText = postgresIsLob(colDef);
      const isStandardType = kind !== 'other';

      if (isBlob || isText || !isStandardType) {
        alert(colDef.DATA_TYPE + t("cell_type_requires_dialog"));
      }
    }
  };

  const handleEditSelected = () => {
    if (!hasPrimaryKey) return;
    if (selectedRowIds.length !== 1) return;
    const row = resultRows.find(r => getRowIdentity(r) === selectedRowIds[0]);
    if (row) handleOpenUpdate(row);
  };

  const handleDuplicateSelected = () => {
    if (!hasPrimaryKey) return;
    if (selectedRowIds.length !== 1) return;
    const row = resultRows.find(r => getRowIdentity(r) === selectedRowIds[0]);
    if (row) handleOpenDuplicate(row);
  };

  const handleDeleteSelected = async () => {
    if (!hasPrimaryKey) return;
    if (selectedRowIds.length === 0) return;
    if (!window.confirm(t("selected") + selectedRowIds.length + t("row_s_to_be_deleted_are_you_sure_this_operation_is_not_finalized_until_committed"))) return;

    setIsLoading(true);
    try {
      const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;
      const pkCols = structureDefs.filter(c => c.PK_POSITION !== null && c.PK_POSITION !== undefined && c.PK_POSITION !== '').sort((a, b) => Number(a.PK_POSITION) - Number(b.PK_POSITION));
      const batches = selectedRowIds.map(rowId => {
        const row = resultRows.find(candidate => getRowIdentity(candidate) === rowId);
        if (!row) throw new Error('The selected database row is no longer available.');
        const pkWhere = pkCols.map(col => `${quoteIdentifier(col.COLUMN_NAME)} = ${formatSqlValue(col, getRowSourceValue(row, col.COLUMN_NAME), true)}`).join(' AND ');
        return { sql: `DELETE FROM ${targetTable} WHERE ${pkWhere}`, expected: 1 };
      });
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

  const { handleOpenInsert, handleOpenDuplicate, handleOpenUpdate, handleCloseDialog, submitRecord, handleProcessRowUpdate } = createTableRecordEditor({ recordSaving, setIsSavingRecord, schema, tableName, structureDefs, inputDateFormat, hasLobColumns, isTransposed, recordDialog, conditions: appliedConditions, paginationModel, t, formatSqlValue, executeSearch, setRecordDialog, setDataContextMenu, setIsLoading, setLogs, setBottomTab, setResultRows, getPkWhereClause });

  const { fetchDataForExport, processBulkInsertData } = createTableDataTransfer({ schema, tableName, structureDefs, resultColumns, outputDateFormat, conditions: appliedConditions, paginationModel, t, formatSqlValue, buildQueryStrings, executeSearch, setIsLoading, setLogs, setBottomTab });

  const displayColumns = useMemo(() => {
    if (!isTransposed) return decorateTableResultColumns(resultColumns, appliedConditions, t);
    return buildTransposedColumns(resultRows, outputDateFormat, { sortable: false, editable: false });
  }, [isTransposed, resultColumns, resultRows, outputDateFormat, appliedConditions, t]);

  const displayRows = useMemo(() => {
    if (!isTransposed) return resultRows;
    return resultColumns.map((col, idx) => {
      const tRow: DatabaseRow = { colName: col.headerName };
      resultRows.forEach((r, rIdx) => {
        tRow[`row_${rIdx}`] = r[col.field];
      });
      return withRowIdentity(tRow, `transposed_${idx}`);
    });
  }, [isTransposed, resultColumns, resultRows]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive || recordDialog.isOpen || isTransposed) return;

      if (containerRef.current && !containerRef.current.contains(document.activeElement)) {
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        handleOpenInsert();
        return;
      }

      if (selectedRowIds.length > 0) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleDeleteSelected();
          return;
        }
      }

      if (selectedRowIds.length === 1) {
        if (e.key === 'Enter' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e')) {
          e.preventDefault();
          handleEditSelected();
          return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          handleDuplicateSelected();
          return;
        }
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
    submitRecord, handleProcessRowUpdate, processBulkInsertData, fetchDataForExport, conditionsText, executeSearch,
    hasPrimaryKey
  };
};
