// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { postgresColumnKind, postgresIsDateTime, postgresColumnMetadataSql } from '@/features/postgresql/columnTypes';
import { createTableQueryBuilder } from '@/features/postgresql/windows/table/tableQueryBuilder';
import { createExportSnapshotFetcher } from '@/features/table/exportSnapshot';
import { confirmImportBatch, resolveImportColumns } from '@/features/table/importData';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { ContextMenuState } from './useSidebarLogic';
import type { SidebarTransferContext } from '@/features/table/sidebarDataTransferTypes';
import type { ColumnDefinition, DatabaseRow } from '@/shared/types/databaseTypes';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { ipcRenderer } from '@/shared/api/desktop';
import { formatDbDate } from '@/shared/utils/dateFormatter';

export function createSidebarDataTransfer(context: SidebarTransferContext<ContextMenuState, import('@/features/table/sidebarDataTransferTypes').SidebarExportTarget & { structureDefs: ColumnDefinition[] }>) {
  const {
    sidebarContextMenu, setSidebarContextMenu, exportTarget, setExportTarget,
    importTarget, setImportTarget, exportContainerRef, importContainerRef,
    setIsLoading, outputDateFormat, t,
  } = context;
  const handleExportClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value: targetName, objType } = sidebarContextMenu;
    if (!schema) return;
    setSidebarContextMenu(null);

    if (objType !== 'TABLE') return;

    setIsLoading(true);
    try {
      const colsRes = await ipcRenderer.invoke('get-columns', schema, targetName);
      if (!colsRes.success || !colsRes.columns) throw new Error(t("failed_to_fetch_column_information"));

      const columns = colsRes.columns.map((c: string) => ({ field: c, headerName: c }));

      const sqlCols = postgresColumnMetadataSql;
      const colDefRes = await ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols, { schema, tableName: targetName });
      if (!colDefRes.success) throw new Error(colDefRes.error);
      const structureDefs = colDefRes.rows;

      const hasUnsupported = structureDefs.some((col: ColumnDefinition) => {
        return postgresColumnKind(col) === 'binary';
      });
      
      if (hasUnsupported) {
        alert(t("exporting_tables_containing_binary_data_bytea_is_not_supported"));
        setIsLoading(false);
        return;
      }

      const countSql = `SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(schema)}.${quoteIdentifier(targetName)}`;
      const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
      if (!countRes.success) throw new Error(countRes.error);
      let totalCount = 0;
      if (countRes.success && countRes.rows && countRes.rows.length > 0) {
        totalCount = Number(countRes.rows[0].cnt);
      }

      setExportTarget({ schema: schema!, tableName: targetName, columns, totalCount, structureDefs });

      setTimeout(() => {
        const btn = exportContainerRef.current?.querySelector('button');
        if (btn) btn.click();
      }, 100);

    } catch (e: unknown) {
      alert(t("error_during_export_preparation", { error: getErrorMessage(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  const fetchExportDataChunk = createExportSnapshotFetcher(() => {
    if (!exportTarget) throw new Error('No table was selected for export.');
    const { schema, tableName } = exportTarget;
    return `SELECT * FROM ${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
  }, rows => {
    return rows.map((r: DatabaseRow) => {
      const rowData: DatabaseRow = { ...r };
      (exportTarget?.structureDefs || []).forEach(col => {
        if (postgresIsDateTime(col)) {
          rowData[col.COLUMN_NAME] = formatDbDate(rowData[col.COLUMN_NAME], outputDateFormat);
        }
      });
      return rowData;
    });
  });

  const handleImportClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value: targetName, objType } = sidebarContextMenu;
    if (!schema) return;
    setSidebarContextMenu(null);

    if (objType !== 'TABLE') return;

    setIsLoading(true);
    try {
      const sqlCols = postgresColumnMetadataSql;
      const colDefRes = await ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols, { schema, tableName: targetName });
      if (!colDefRes.success) throw new Error(colDefRes.error);
      if (colDefRes.success && colDefRes.rows) {
        
        const hasUnsupported = colDefRes.rows.some((col: ColumnDefinition) => {
          return postgresColumnKind(col) === 'binary';
        });

        if (hasUnsupported) {
          alert(t("importing_tables_containing_binary_data_bytea_is_not_supported"));
          setIsLoading(false);
          return;
        }

        setImportTarget({ schema: schema!, tableName: targetName, structureDefs: colDefRes.rows });
        setTimeout(() => {
          const btn = importContainerRef.current?.querySelector('button');
          if (btn) btn.click();
        }, 100);
      } else {
         throw new Error(t("failed_to_fetch_table_structure"));
      }
    } catch(e: unknown) {
       alert(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  const processSidebarBulkInsertData = async (parsedRecords: string[][], onProgress: (progress: number, text: string) => void, isHeader: boolean) => {
    if (!importTarget) return;
    const { schema, tableName, structureDefs } = importTarget;

    if (parsedRecords.length === 0) { throw new Error(t("no_data_to_add")); }

    const dbColumns = structureDefs.map(c => String(c.COLUMN_NAME));
    const dataStartIndex = isHeader ? 1 : 0;
    const recordsToInsert = parsedRecords.slice(dataStartIndex);

    if (recordsToInsert.length === 0) { throw new Error(t("no_data_to_add")); }

    let targetColumns: string[] = [];
    if (isHeader) {
      targetColumns = resolveImportColumns(parsedRecords[0], dbColumns, t);

      if (targetColumns.every(c => c === '')) {
         throw new Error(t("import_column_mismatch"));
      }
    } else {
      targetColumns = dbColumns.slice(0, parsedRecords[0].length);
    }

    setIsLoading(true);
    const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;
    const chunkSize = 1000;
    let insertedCount = 0;
    const totalRecords = recordsToInsert.length;

    const { formatSqlValue } = createTableQueryBuilder({ schema, inputDateFormat: outputDateFormat, outputDateFormat, structureDefs });

    try {
      for (let i = 0; i < totalRecords; i += chunkSize) {
        onProgress(Math.floor((i / totalRecords) * 100), t("inserting_into_database") + insertedCount + t("slash_separator") + totalRecords + t("rows"));

        const chunk = recordsToInsert.slice(i, i + chunkSize);
        const valueSets: string[] = [];
        let usedCols: string[] | null = null;

        for (let j = 0; j < chunk.length; j++) {
          const recordCols = chunk[j];
          const rowNum = dataStartIndex + i + j + 1;

          const cols: string[] = [];
          const vals: string[] = [];

          for (let k = 0; k < targetColumns.length; k++) {
            const colName = targetColumns[k];
            if (!colName) continue;

            const val = recordCols[k];
            const colDef = structureDefs.find(s => s.COLUMN_NAME === colName);
            if (!colDef) continue;

            const isNullOrEmpty = val === null || val === undefined || val === '' || String(val).toUpperCase() === 'NULL';

            if (colDef.NULLABLE === 'N' && isNullOrEmpty && !colDef.DATA_DEFAULT && !/^(smallserial|serial|bigserial)$/i.test(colDef.DATA_TYPE)) {
              throw new Error(t("opening_bracket") + rowNum + t("row_column") + colName + t("is_required"));
            }

            if (!isNullOrEmpty) {
              if (postgresColumnKind(colDef) === 'number' && isNaN(Number(val))) {
                throw new Error(t("opening_bracket") + rowNum + t("row_column") + colName + t("must_be_a_number_current_value") + val + ')');
              }
              if (['varchar', 'char'].includes(colDef.DATA_TYPE) && colDef.DATA_LENGTH) {
                if (String(val).length > Number(colDef.DATA_LENGTH)) {
                  throw new Error(t("opening_bracket") + rowNum + t("row_column") + colName + t("input_length_is_too_long_max") + colDef.DATA_LENGTH + t("characters"));
                }
              }
            }

            // Preserve column positions and use database defaults for omitted fields.
            cols.push(quoteIdentifier(colDef.COLUMN_NAME));
            vals.push(isNullOrEmpty ? 'DEFAULT' : String(formatSqlValue(colDef, val)));
          }

          if (cols.length > 0) {
            if (!usedCols) usedCols = cols;
            valueSets.push(`(${vals.join(', ')})`);
          }
        }

        if (valueSets.length > 0 && usedCols) {
          const sqlText = `INSERT INTO ${targetTable} (${usedCols.join(', ')}) VALUES \n${valueSets.join(',\n')}`;
          const res = await ipcRenderer.invoke('execute-sql', sqlText);
          if (!res.success) {
            if (res.error.includes('duplicate key value')) throw new Error(t("error_unique_constraint_violation_occurred") + res.error);
            throw new Error(t("insertion_error_2") + res.error);
          }
          const outcome = confirmImportBatch(res.rowsAffected, valueSets.length);
          insertedCount += outcome.confirmed;
          if (outcome.error) {
            const message = t(outcome.error, { expected: valueSets.length, actual: res.rowsAffected });
            throw new Error(message);
          }
        }
      }

      onProgress(100, t("insertion_complete"));
      alert(insertedCount + t("rows_inserted"));
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TABLE' } }));
    } catch (e: unknown) {
      throw new Error(t('import_stopped_review_transaction', { confirmed: insertedCount, error: getErrorMessage(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  return { handleExportClick, fetchExportDataChunk, handleImportClick, processSidebarBulkInsertData };
}
