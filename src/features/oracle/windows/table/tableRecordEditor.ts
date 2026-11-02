// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { isTemporalColumn, oracleColumnProjection } from '@/shared/utils/temporalValues';
import { recordValuesEqual, recordUpdateError, recordInsertError } from '@/features/table/recordValues';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { getRowSourceValue, getRowIdentity, getOracleRowId, preserveRowIdentity } from '@/features/data-grid/rowIdentity';
import type { TableRecordEditorContext, OracleRecordDialogState } from '@/features/table/tableRecordEditorTypes';
import { ipcRenderer } from '@/shared/api/desktop';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { formatDbDate } from '@/shared/utils/dateFormatter';
import { isBinaryFileValue, type DatabaseRow, type RecordInputData } from '@/shared/types/databaseTypes';

const hexToUint8Array = (hexStr: string) => {
  if (!hexStr) return new Uint8Array();
  const arr = new Uint8Array(hexStr.length / 2);
  for (let i = 0; i < hexStr.length; i += 2) {
    arr[i/2] = parseInt(hexStr.substring(i, i + 2), 16);
  }
  return arr;
};

export function createTableRecordEditor(context: TableRecordEditorContext<OracleRecordDialogState>) {
  const {
    schema, tableName, structureDefs, inputDateFormat,
    hasLobColumns, isTransposed, recordDialog, recordSaving, setIsSavingRecord, conditions,
    paginationModel, t, formatSqlValue, executeSearch,
    setRecordDialog, setDataContextMenu, setIsLoading, setLogs,
    setBottomTab, setResultRows,
  } = context;
  const handleOpenInsert = () => {
    if (recordSaving.current) return;
    const initData: RecordInputData = {};
    structureDefs.forEach(col => { initData[col.COLUMN_NAME] = ''; });
    setRecordDialog({ isOpen: true, mode: 'insert', recordData: initData, initialRecordData: initData, targetRowId: '' });
  };

  const loadCompleteRow = async (row: DatabaseRow): Promise<DatabaseRow | null> => {
    setIsLoading(true);
    try {
      const targetTable = qualifiedObjectName({ schema, objectName: tableName });
      const query = `SELECT ${structureDefs.map(column => oracleColumnProjection(column)).join(', ')} FROM ${targetTable} t WHERE ROWID = '${getOracleRowId(row)}'`;
      const result = await ipcRenderer.invoke('execute-sql', query);
      if (!result.success) { alert(t('record_source_unavailable')); return null; }
      if (result.rows?.length !== 1) { alert(t('record_source_missing')); return null; }
      const complete = { ...result.rows[0] };
      if (!structureDefs.every(column => Object.hasOwn(complete, column.COLUMN_NAME))) {
        alert(t('record_source_incomplete')); return null;
      }
      for (const column of structureDefs) {
        if (!/BLOB|RAW/.test(column.DATA_TYPE.toUpperCase())) continue;
        let value = complete[column.COLUMN_NAME];
        if (value === null || value === undefined) continue;
        if (ArrayBuffer.isView(value)) {
          value = Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength), byte => byte.toString(16).padStart(2, '0')).join('');
        }
        if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})*$/i.test(value)) {
          alert(t('record_source_incomplete')); return null;
        }
        complete[column.COLUMN_NAME] = value;
      }
      return complete;
    } catch {
      alert(t('record_source_unavailable'));
      return null;
    } finally { setIsLoading(false); }
  };

  // Use the main connection for SELECT only when LOB columns are present.
  const handleOpenDuplicate = async (row: DatabaseRow) => {
    if (recordSaving.current) return;
    if (!row) return;

    const targetData = hasLobColumns ? await loadCompleteRow(row) : row;
    if (!targetData) return;

    const initData: RecordInputData = {};
    structureDefs.forEach(col => {
      let val = getRowSourceValue(targetData, col.COLUMN_NAME);
      if (val === null) { initData[col.COLUMN_NAME] = null; return; }
      if (val === undefined) val = '';
      
      const typeUpper = col.DATA_TYPE.toUpperCase();
      if (isTemporalColumn(col)) val = typeof val === 'string' ? val : formatDbDate(val, inputDateFormat);

      if (typeUpper.includes('BLOB') || typeUpper.includes('RAW')) {
        if (targetData[col.COLUMN_NAME] !== null && targetData[col.COLUMN_NAME] !== undefined) {
          initData[col.COLUMN_NAME] = { 
            isBlob: true, 
            fileName: t("existing_data"),
            hex: val, 
            data: null, 
            sizeStr: '' 
          };
        } else {
          initData[col.COLUMN_NAME] = ''; 
        }
      } else {
        initData[col.COLUMN_NAME] = val;
      }
    });

    setRecordDialog({ 
      isOpen: true, 
      mode: 'duplicate', 
      recordData: initData, 
      initialRecordData: initData, 
      targetRowId: '' 
    });
    setDataContextMenu(null);
  };

  // Use the main connection for SELECT only when LOB columns are present.
  const handleOpenUpdate = async (row: DatabaseRow) => {
    if (recordSaving.current) return;
    if (!row) return;

    const targetData = hasLobColumns ? await loadCompleteRow(row) : row;
    if (!targetData) return;

    const initData: RecordInputData = {};
    structureDefs.forEach(col => {
      let val = getRowSourceValue(targetData, col.COLUMN_NAME);
      if (val === null) { initData[col.COLUMN_NAME] = null; return; }
      if (val === undefined) val = '';
      
      const typeUpper = col.DATA_TYPE.toUpperCase();
      if (isTemporalColumn(col)) val = typeof val === 'string' ? val : formatDbDate(val, inputDateFormat);

      if (typeUpper.includes('BLOB') || typeUpper.includes('RAW')) {
        if (targetData[col.COLUMN_NAME] !== null && targetData[col.COLUMN_NAME] !== undefined) {
          initData[col.COLUMN_NAME] = { 
            isBlob: true, 
            fileName: t("existing_data"),
            hex: val, 
            data: null, 
            sizeStr: '' 
          };
        } else {
          initData[col.COLUMN_NAME] = ''; 
        }
      } else {
        initData[col.COLUMN_NAME] = val;
      }
    });

    setRecordDialog({ 
      isOpen: true, 
      mode: 'update', 
      recordData: initData, 
      initialRecordData: initData, 
      targetRowId: getOracleRowId(row)
    });
    setDataContextMenu(null);
  };

  const handleCloseDialog = (_e?: object, reason?: string) => {
    if (recordSaving.current) return;
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
    const isChanged = structureDefs.some(column => !recordValuesEqual(recordDialog.recordData[column.COLUMN_NAME], recordDialog.initialRecordData[column.COLUMN_NAME]));
    if (isChanged) {
      if (window.confirm(t("your_input_will_be_discarded_are_you_sure_you_want_to_close"))) {
        setRecordDialog({ ...recordDialog, isOpen: false });
      }
    } else {
      setRecordDialog({ ...recordDialog, isOpen: false });
    }
  };

  const validateRecord = () => {
    for (const col of structureDefs) {
      const val = recordDialog.recordData[col.COLUMN_NAME];
      const isNullOrEmpty = val === null || val === undefined || val === '';
      
      if (col.NULLABLE === 'N' && isNullOrEmpty && (recordDialog.mode === 'update' || val === null || !col.DATA_DEFAULT)) {
        if (val !== null && recordDialog.mode === 'insert' && col.DATA_DEFAULT) continue;
        alert(t("column_3") + col.COLUMN_NAME + t("is_required"));
        return false;
      }
      
      if (!isNullOrEmpty) {
         if (col.DATA_TYPE.includes('NUMBER') && isNaN(Number(val))) {
            alert(t("column_3") + col.COLUMN_NAME + t("must_be_a_number"));
            return false;
         }
         if (['VARCHAR2', 'NVARCHAR2', 'CHAR'].includes(col.DATA_TYPE) && col.DATA_LENGTH) {
            if (String(val).length > Number(col.DATA_LENGTH)) {
               alert(t("column_3") + col.COLUMN_NAME + t("input_length_is_too_long_max") + col.DATA_LENGTH + t("characters"));
               return false;
            }
         }
      }
    }
    return true;
  };

  const submitRecord = async () => {
    if (recordSaving.current || !validateRecord()) return;
    recordSaving.current = true;
    setIsSavingRecord?.(true);

    setIsLoading(true);
    try {
      const targetTable = qualifiedObjectName({ schema, objectName: tableName });
      let sqlText = '';
      const binds: Record<string, unknown> = {};

      if (recordDialog.mode === 'insert' || recordDialog.mode === 'duplicate') {
        const cols = [];
        const vals = [];
        for (const [index, col] of structureDefs.entries()) {
          const bindName = `value${index}`;
          const val = recordDialog.recordData[col.COLUMN_NAME];
          const isBlob = isBinaryFileValue(val);
          const isClob = col.DATA_TYPE.includes('CLOB') || col.DATA_TYPE.includes('LONG');

          if (isBlob) {
            cols.push(`${quoteIdentifier(col.COLUMN_NAME)}`);
            if (col.DATA_TYPE.toUpperCase().includes('BLOB') && (val.data ? val.data.byteLength === 0 : val.hex === '')) {
              vals.push('EMPTY_BLOB()');
              continue;
            }
            vals.push(`:${bindName}`);
            if (val.data) {
              binds[bindName] = val.data;
            } else if (typeof val.hex === 'string') {
              binds[bindName] = hexToUint8Array(val.hex);
            }
          } else if (isClob && val !== '' && val !== null && val !== undefined) {
            cols.push(`${quoteIdentifier(col.COLUMN_NAME)}`);
            vals.push(`:${bindName}`);
            binds[bindName] = val;
          } else if (val === null) {
            cols.push(quoteIdentifier(col.COLUMN_NAME));
            vals.push('NULL');
          } else if (val !== '' && val !== undefined) {
            cols.push(`${quoteIdentifier(col.COLUMN_NAME)}`);
            vals.push(formatSqlValue(col, val, false)); 
          }
        }

        if (cols.length === 0 && structureDefs.length > 0) {
          cols.push(`${quoteIdentifier(structureDefs[0].COLUMN_NAME)}`);
          vals.push('DEFAULT');
        }

        sqlText = `INSERT INTO ${targetTable} (${cols.join(', ')}) VALUES (${vals.join(', ')})`;
      } else if (recordDialog.mode === 'update') {
        const sets = [];
        for (const [index, col] of structureDefs.entries()) {
          const bindName = `value${index}`;
          if (col.PK_POSITION) continue;
          
          const val = recordDialog.recordData[col.COLUMN_NAME];
          const initialVal = recordDialog.initialRecordData[col.COLUMN_NAME];
          
          if (recordValuesEqual(val, initialVal)) continue;

          const isBlob = isBinaryFileValue(val);
          const isClob = col.DATA_TYPE.includes('CLOB') || col.DATA_TYPE.includes('LONG');

          if (isBlob) {
            if (col.DATA_TYPE.toUpperCase().includes('BLOB') && (val.data ? val.data.byteLength === 0 : val.hex === '')) {
              sets.push(`${quoteIdentifier(col.COLUMN_NAME)} = EMPTY_BLOB()`);
              continue;
            }
            sets.push(`${quoteIdentifier(col.COLUMN_NAME)} = :${bindName}`);
            if (val.data) {
              binds[bindName] = val.data;
            } else if (typeof val.hex === 'string') {
              binds[bindName] = hexToUint8Array(val.hex);
            }
          } else if (isClob && val !== '' && val !== null && val !== undefined) {
            sets.push(`${quoteIdentifier(col.COLUMN_NAME)} = :${bindName}`);
            binds[bindName] = val;
          } else {
            sets.push(`${quoteIdentifier(col.COLUMN_NAME)} = ${formatSqlValue(col, val, false)}`);
          }
        }
        
        if (sets.length === 0) {
          alert(t("no_data_modified"));
          setIsLoading(false);
          return;
        }

        sqlText = `UPDATE ${targetTable} SET ${sets.join(', ')} WHERE ROWID = '${recordDialog.targetRowId}'`;
      }

      const timestamp = new Date().toLocaleString('ja-JP');
      const res = await ipcRenderer.invoke('execute-sql', sqlText, binds);
      
      if (!res.success) {
        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("insertion_error"), errorLines: [res.error] }, ...prev]);
        setBottomTab(1);
        if (res.error.includes('ORA-00001')) throw new Error(t("table_unique_constraint_error"));
        throw new Error(t("data_insertion_error") + res.error);
      }

      const updateError = recordDialog.mode === 'update' ? recordUpdateError(res.rowsAffected) : recordInsertError(res.rowsAffected);
      if (updateError) {
        const message = t(updateError);
        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: recordDialog.mode === 'update' ? t('update_error_2') : t('insertion_error'), errorLines: [message] }, ...prev]);
        setBottomTab(1);
        throw new Error(message);
      }

      setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("success_2") + (recordDialog.mode === 'update' ? t("update_2") : t("insert")) + ')' }, ...prev]);
      alert(t("data_3") + (recordDialog.mode === 'update' ? t("update_2") : t("insert")) + t("please_commit_from_the_top_menu_to_apply_changes"));
      setRecordDialog({ ...recordDialog, isOpen: false });
      await executeSearch(conditions, paginationModel.page, paginationModel.pageSize);
    } catch (e: unknown) { alert(getErrorMessage(e)); } finally {
      recordSaving.current = false;
      setIsSavingRecord?.(false);
      setIsLoading(false);
    }
  };

  const handleProcessRowUpdate = async (newRow: DatabaseRow, oldRow: DatabaseRow) => {
    if (isTransposed) return oldRow;

    let isChanged = false;
    const sets: string[] = [];

    for (const col of structureDefs) {
      const colName = col.COLUMN_NAME;
      if (!recordValuesEqual(newRow[colName], oldRow[colName])) {
        isChanged = true;
        sets.push(`${quoteIdentifier(colName)} = ${formatSqlValue(col, newRow[colName], true)}`);
      }
    }

    if (!isChanged) return oldRow;

    let rowIdVal: string;
    try { rowIdVal = getOracleRowId(oldRow); } catch {
      alert(t("cell_level_updates_are_disabled_because_rowid_could_not_be_retrieved"));
      return oldRow;
    }

    const updatedRow = preserveRowIdentity(newRow, oldRow);

    try {
      const targetTable = qualifiedObjectName({ schema, objectName: tableName });
      const sqlText = `UPDATE ${targetTable} SET ${sets.join(', ')} WHERE ROWID = '${rowIdVal}'`;
      
      const timestamp = new Date().toLocaleString('ja-JP');
      const res = await ipcRenderer.invoke('execute-sql', sqlText);
      if (!res.success) {
        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("update_error_2"), errorLines: [res.error] }, ...prev]);
        setBottomTab(1);
        throw new Error(res.error);
      }
      
      const updateError = recordUpdateError(res.rowsAffected);
      if (updateError) {
        const message = t(updateError);
        setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t('update_error_2'), errorLines: [message] }, ...prev]);
        setBottomTab(1);
        throw new Error(message);
      }

      setLogs(prev => [{ time: timestamp, sql: sqlText, resultMsg: t("update_success") }, ...prev]);
      setResultRows(prev => prev.map(r => getRowIdentity(r) === getRowIdentity(oldRow) ? updatedRow : r));
      return updatedRow;
    } catch (e: unknown) {
      alert(t("cell_update_failed") + getErrorMessage(e));
      return oldRow; 
    }
  };



  return { handleOpenInsert, handleOpenDuplicate, handleOpenUpdate, handleCloseDialog, submitRecord, handleProcessRowUpdate };
}
