// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { canonicalTemporalInput, canonicalTemporalSql, isTemporalColumn, oracleColumnProjection } from '@/shared/utils/temporalValues';
import { createExportSnapshotFetcher } from '@/features/table/exportSnapshot';
import { confirmImportBatch, resolveImportColumns } from '@/features/table/importData';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { numericSqlLiteral } from '@/shared/utils/numberValues';
import type { ContextMenuState } from './useSidebarLogic';
import type { SidebarTransferContext } from '@/features/table/sidebarDataTransferTypes';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { ipcRenderer } from '@/shared/api/desktop';
import { formatDbDate, getOracleDateFormat } from '@/shared/utils/dateFormatter';

export function createSidebarDataTransfer(context: SidebarTransferContext<ContextMenuState>) {
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
      const colsRes = await ipcRenderer.invoke('get-columns', schema, targetName, { skipGlobalLoader: true });
      if (!colsRes.success) throw new Error(colsRes.error);
      if (!colsRes.columns?.length) throw new Error(t("failed_to_fetch_column_information"));

      const columns = colsRes.columns.map((c: string) => ({ field: c, headerName: c }));

      const sqlCols = `SELECT COLUMN_NAME, DATA_TYPE FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = :tableName AND OWNER = :schema`;
      const colDefRes = await ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols, { schema, tableName: targetName });
      if (!colDefRes.success) throw new Error(colDefRes.error);
      if (!colDefRes.rows?.length) throw new Error(t('failed_to_fetch_table_structure'));
      const structureDefs = colDefRes.rows;

      const hasBlob = structureDefs.some((col: { DATA_TYPE: string }) => col.DATA_TYPE.toUpperCase().includes('BLOB') || col.DATA_TYPE.toUpperCase().includes('RAW'));
      if (hasBlob) {
        alert(t("exporting_tables_containing_binary_data_blob_raw_is_not_supported"));
        setIsLoading(false);
        return;
      }

      const countSql = `SELECT COUNT(*) AS CNT FROM ${qualifiedObjectName({ schema, objectName: targetName })}`;
      const countRes = await ipcRenderer.invoke<{ CNT?: number | string; cnt?: number | string }>('execute-sql', countSql);
      if (!countRes.success) throw new Error(countRes.error);
      const count = countRes.rows?.[0]?.CNT;
      const totalCount = Number(count);
      if (countRes.rows?.length !== 1 || count == null || String(count).trim() === '' ||
          !Number.isSafeInteger(totalCount) || totalCount < 0) {
        throw new Error(t('failed_to_fetch_row_count'));
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
    if (!exportTarget.structureDefs?.length) throw new Error(t('failed_to_fetch_table_structure'));
    const { schema, tableName } = exportTarget;
    return `SELECT ${exportTarget.structureDefs.map(column => oracleColumnProjection(column)).join(', ')} FROM ${qualifiedObjectName({ schema, objectName: tableName })} t`;
  }, rows => rows.map(row => {
    const formatted = { ...row };
    for (const column of exportTarget?.structureDefs ?? []) {
      if (isTemporalColumn(column)) formatted[column.COLUMN_NAME] = formatDbDate(row[column.COLUMN_NAME], outputDateFormat);
    }
    return formatted;
  }));

  const handleImportClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value: targetName, objType } = sidebarContextMenu;
    if (!schema) return;
    setSidebarContextMenu(null);

    if (objType !== 'TABLE') return;

    setIsLoading(true);
    try {
      const sqlCols = `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.DATA_LENGTH, c.NULLABLE, c.DATA_DEFAULT FROM ALL_TAB_COLUMNS c WHERE c.TABLE_NAME = :tableName AND c.OWNER = :schema ORDER BY c.COLUMN_ID`;
      const sqlPk = `SELECT cc.COLUMN_NAME, cc.POSITION FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER WHERE c.TABLE_NAME = :tableName AND c.CONSTRAINT_TYPE = 'P' AND c.OWNER = :schema`;
      
      const [colDefRes, pkRes] = await Promise.all([
        ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols, { schema, tableName: targetName }),
        ipcRenderer.invoke<{ COLUMN_NAME: string; POSITION: number }>('execute-sql-bg', sqlPk, { schema, tableName: targetName })
      ]);

      if (!colDefRes.success) throw new Error(colDefRes.error);
      if (!pkRes.success) throw new Error(pkRes.error);
      if (!colDefRes.rows?.length) throw new Error(t('failed_to_fetch_table_structure'));
      const hasBlob = colDefRes.rows.some((col: { DATA_TYPE: string }) => col.DATA_TYPE.toUpperCase().includes('BLOB') || col.DATA_TYPE.toUpperCase().includes('RAW'));
      if (hasBlob) {
        alert(t("importing_tables_containing_binary_data_blob_raw_is_not_supported"));
        setIsLoading(false);
        return;
      }

      const defs = colDefRes.rows.map((col) => {
        const pk = (pkRes.rows || []).find((p: { COLUMN_NAME: string }) => p.COLUMN_NAME === col.COLUMN_NAME);
        return { ...col, PK_POSITION: pk ? pk.POSITION : '' };
      });

      setImportTarget({ schema: schema!, tableName: targetName, structureDefs: defs });

      setTimeout(() => {
        const btn = importContainerRef.current?.querySelector('button');
        if (btn) btn.click();
      }, 100);
    } catch (e: unknown) {
      alert(t("error_during_import_preparation", { error: getErrorMessage(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  const formatSqlValue = (col: ColumnDefinition, val: unknown) => {
    if (val === null || val === undefined || val === '') return 'NULL';
    const temporal = canonicalTemporalSql(col, canonicalTemporalInput(val, outputDateFormat), 'oracle');
    if (temporal) return temporal;
    if (/NUMBER|FLOAT/.test(col.DATA_TYPE.toUpperCase())) return numericSqlLiteral(val);
    
    if (col.DATA_TYPE.includes('DATE') || col.DATA_TYPE.includes('TIMESTAMP')) {
       const oracleFormat = getOracleDateFormat(outputDateFormat);
       return `TO_DATE('${String(val).replace(/'/g, "''")}', '${oracleFormat}')`; 
    }
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const processSidebarBulkInsertData = async (parsedRecords: string[][], onProgress: (progress: number, text: string) => void, isHeader: boolean) => {
    if (!importTarget) return;
    const { schema, tableName, structureDefs } = importTarget;

    if (parsedRecords.length === 0) { throw new Error(t("no_data_to_add")); }

    const dbColumns = structureDefs.map(c => c.COLUMN_NAME);
    const activeColumns = isHeader ? resolveImportColumns(parsedRecords[0], dbColumns, t) : dbColumns.slice(0, parsedRecords[0].length);
    if (activeColumns.every(column => column === '')) throw new Error(t('import_column_mismatch'));

    const dataStartIndex = isHeader ? 1 : 0;
    const recordsToInsert = parsedRecords.slice(dataStartIndex);
    
    if (recordsToInsert.length === 0) { throw new Error(t("no_data_to_add")); }

    setIsLoading(true);
    const targetTable = qualifiedObjectName({ schema, objectName: tableName });
    const chunkSize = 1000;
    let insertedCount = 0;
    const totalRecords = recordsToInsert.length;

    try {
      for (let i = 0; i < totalRecords; i += chunkSize) {
        onProgress(Math.floor((i / totalRecords) * 100), t("inserting_into_database_rows", { current: insertedCount, total: totalRecords }));

        const chunk = recordsToInsert.slice(i, i + chunkSize);
        
        let sqlText = `INSERT ALL\n`;
        let intoCount = 0;

        for (let j = 0; j < chunk.length; j++) {
          const recordCols = chunk[j];
          const rowNum = dataStartIndex + i + j + 1; 

          for (let k = 0; k < activeColumns.length; k++) {
            const colName = activeColumns[k];
            const val = recordCols[k];
            const colDef = structureDefs.find(s => s.COLUMN_NAME === colName);
            if (!colDef) continue;
      
            const isNullOrEmpty = val === null || val === undefined || val === '' || String(val).toUpperCase() === 'NULL';
      
            if (colDef.NULLABLE === 'N' && isNullOrEmpty && !colDef.DATA_DEFAULT) {
              throw new Error(t("row_column_is_required", { row: rowNum, col: colName }));
            }
      
            if (!isNullOrEmpty) {
              if (colDef.DATA_TYPE.includes('NUMBER') && isNaN(Number(val))) {
                throw new Error(t("row_column_must_be_a_number", { row: rowNum, col: colName }));
              }
              if (['VARCHAR2', 'NVARCHAR2', 'CHAR'].includes(colDef.DATA_TYPE) && colDef.DATA_LENGTH) {
                if (String(val).length > Number(colDef.DATA_LENGTH)) {
                  throw new Error(t("row_column_is_too_long_max_characters", { row: rowNum, col: colName, max: colDef.DATA_LENGTH }));
                }
              }
            }
          }

          const cols: string[] = [];
          const vals: string[] = [];
          
          activeColumns.forEach((colName, idx) => {
            const val = recordCols[idx];
            if (val !== undefined && val !== '' && String(val).toUpperCase() !== 'NULL') {
              const colDef = structureDefs.find(s => s.COLUMN_NAME === colName);
              if (colDef) { cols.push(quoteIdentifier(colDef.COLUMN_NAME)); vals.push(String(formatSqlValue(colDef, val))); }
            }
          });

          if (cols.length === 0) {
            const first = activeColumns.find(column => column !== '');
            if (first) { cols.push(quoteIdentifier(first)); vals.push('DEFAULT'); }
          }

          if (cols.length > 0) {
            sqlText += `  INTO ${targetTable} (${cols.join(', ')}) VALUES (${vals.join(', ')})\n`;
            intoCount++;
          }
        }
        sqlText += `SELECT 1 FROM DUAL`;
        
        if (intoCount > 0) {
          const res = await ipcRenderer.invoke('execute-sql', sqlText);
          if (!res.success) {
            if (res.error.includes('ORA-00001')) throw new Error(t("error_unique_constraint_violation_occurred_2", { error: res.error }));
            throw new Error(t("insertion_error_3", { error: res.error }));
          }
          const outcome = confirmImportBatch(res.rowsAffected, intoCount);
          insertedCount += outcome.confirmed;
          if (outcome.error) {
            const message = t(outcome.error, { expected: intoCount, actual: res.rowsAffected });
            throw new Error(message);
          }
        }
      }
      
      onProgress(100, t("insertion_complete"));
      alert(t("inserted_rows_commit_from_the_top_menu_to_apply_the_changes", { count: insertedCount }));
      setImportTarget(null);
    } catch (e: unknown) {
      throw new Error(t('import_stopped_review_transaction', { confirmed: insertedCount, error: getErrorMessage(e) }));
    } finally { 
      setIsLoading(false); 
    }
  };

  return { handleExportClick, fetchExportDataChunk, handleImportClick, processSidebarBulkInsertData };
}
