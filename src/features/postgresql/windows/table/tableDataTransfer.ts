// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { postgresColumnKind } from '@/features/postgresql/columnTypes';
import { createExportSnapshotFetcher } from '@/features/table/exportSnapshot';
import { confirmImportBatch, resolveImportColumns } from '@/features/table/importData';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { TableDataTransferContext } from '@/features/table/tableDataTransferTypes';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import { formatDbDate } from '@/shared/utils/dateFormatter';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { ipcRenderer } from '@/shared/api/desktop';

export function createTableDataTransfer({ schema, tableName, structureDefs, resultColumns, outputDateFormat, conditions, paginationModel, t, formatSqlValue, buildQueryStrings, executeSearch, setIsLoading, setLogs }: TableDataTransferContext) {
  const fetchDataForExport = createExportSnapshotFetcher(() => {
    const hasBytea = structureDefs.some(col => postgresColumnKind(col) === 'binary');
    if (hasBytea) {
      throw new Error(t("exporting_tables_containing_binary_data_bytea_is_not_supported"));
    }

    const { whereStr, orderStr } = buildQueryStrings(conditions);
    const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;

    const selectCols = structureDefs.map(col => {
      const kind = postgresColumnKind(col);
      if (kind === 'binary') return `CASE WHEN t.${quoteIdentifier(col.COLUMN_NAME)} IS NULL THEN NULL ELSE CAST('[BYTEA` + t("data_2") + `' AS VARCHAR(20)) END AS ${quoteIdentifier(col.COLUMN_NAME)}`;
      return `t.${quoteIdentifier(col.COLUMN_NAME)}`;
    });
    const selectStr = selectCols.length > 0 ? selectCols.join(', ') : 't.*';

    const sqlText = `SELECT ${selectStr} FROM ${targetTable} t ${whereStr} ${orderStr}`;
    return sqlText;
  }, rows => {
    return rows.map((r: DatabaseRow) => {
      const rowData: DatabaseRow = { ...r };
      structureDefs.forEach(col => {
        const kind = postgresColumnKind(col);
        if (kind === 'date' || kind === 'timestamp') {
          let currentFormat = outputDateFormat;
          if (kind === 'date' && currentFormat.match(/H|h|m|s/i)) {
              currentFormat = currentFormat.split(' ')[0];
          }
          rowData[col.COLUMN_NAME] = formatDbDate(rowData[col.COLUMN_NAME], currentFormat);
        }
      });
      return rowData;
    });
  });

  const processBulkInsertData = async (parsedRecords: string[][], onProgress: (progress: number, text: string) => void, isHeader: boolean) => {
    const hasBytea = structureDefs.some(col => postgresColumnKind(col) === 'binary');
    if (hasBytea) {
      throw new Error(t("importing_tables_containing_binary_data_bytea_is_not_supported"));
    }

    if (parsedRecords.length === 0) { throw new Error(t("no_data_to_add")); }

    const dbColumns = resultColumns.length > 0 ? resultColumns.map(c => String(c.field)) : structureDefs.map(c => String(c.COLUMN_NAME));
    
    const dataStartIndex = isHeader ? 1 : 0;
    const recordsToInsert = parsedRecords.slice(dataStartIndex);
    
    if (recordsToInsert.length === 0) { throw new Error(t("no_data_to_add")); }

    let targetColumns: string[] = [];
    if (isHeader) {
      targetColumns = resolveImportColumns(parsedRecords[0], dbColumns, t);

      if (targetColumns.every(c => c === '')) {
         throw new Error(t("import_delimited_column_mismatch"));
      }
    } else {
      targetColumns = dbColumns.slice(0, parsedRecords[0].length);
    }

    setIsLoading(true);
    const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;
    const chunkSize = 1000;
    let insertedCount = 0;
    const totalRecords = recordsToInsert.length;

    try {
      for (let i = 0; i < totalRecords; i += chunkSize) {
        onProgress(Math.floor((i / totalRecords) * 100), t("inserting_into_database") + insertedCount + t("slash_separator") + totalRecords + t("rows"));

        const chunk = recordsToInsert.slice(i, i + chunkSize);
        const valueSets: string[] = [];
        let usedCols: string[] = [];

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

            // Keep the same columns for every row; DEFAULT preserves omitted-value behavior.
            cols.push(quoteIdentifier(colDef.COLUMN_NAME));
            vals.push(isNullOrEmpty ? 'DEFAULT' : String(formatSqlValue(colDef, val, true)));
          }

          if (cols.length === 0) throw new Error(t("import_delimited_column_mismatch"));
          usedCols = cols;
          valueSets.push(`(${vals.join(', ')})`);
        }

        if (valueSets.length > 0) {
          const sqlText = `INSERT INTO ${targetTable} (${usedCols.join(', ')}) VALUES \n${valueSets.join(',\n')}`;
          
          const timestamp = new Date().toLocaleString('ja-JP');
          const res = await ipcRenderer.invoke('execute-sql', sqlText);
          if (!res.success) {
            setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("import_error"), errorLines: [res.error] }, ...prev]);
            if (res.error.includes('duplicate key value')) throw new Error(t("error_unique_constraint_violation_occurred") + res.error);
            throw new Error(t("insertion_error_2") + res.error);
          }
          const outcome = confirmImportBatch(res.rowsAffected, valueSets.length);
          insertedCount += outcome.confirmed;
          if (outcome.error) {
            const message = t(outcome.error, { expected: valueSets.length, actual: res.rowsAffected });
            setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t('import_error'), errorLines: [message] }, ...prev]);
            throw new Error(message);
          }
          setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("import_success") + valueSets.length + t("rows_2") }, ...prev]);
        }
      }
      
      onProgress(100, t("insertion_complete"));
      alert(insertedCount + t("rows_inserted_please_commit_from_the_top_menu_to_apply_changes_2"));
      await executeSearch(conditions, paginationModel.page, paginationModel.pageSize);
    } catch (e: unknown) {
      throw new Error(t('import_stopped_review_transaction', { confirmed: insertedCount, error: getErrorMessage(e) }));
    } finally { 
      setIsLoading(false); 
    }
  };

  return { fetchDataForExport, processBulkInsertData };
}
