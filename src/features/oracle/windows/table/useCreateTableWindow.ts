// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { escapeSqlString, qualifiedObjectName } from '@/shared/utils/objectIdentity';
import type { ColumnDefinition } from "@/shared/types/databaseTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

export interface CreateTableWindowProps { 
  tabId: number; 
  schema: string; 
  isActive: boolean; 
}

export const useCreateTableWindow = (props: CreateTableWindowProps) => {
  const { tabId, schema, isActive } = props;
  const { t } = useTranslation();

  // Local lock to prevent duplicate initialization during the component's lifetime.
  const hasInitializedRef = useRef<boolean>(false);

  const [tableName, setTableName] = useState('');
  const [tableComment, setTableComment] = useState('');
  const [columns, setColumns] = useState<(ColumnDefinition & { id: number; DATA_LENGTH: string; DATA_SCALE: string })[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [sequences, setSequences] = useState<string[]>([]);
  const [userTypes, setUserTypes] = useState<string[]>([]);

  const [alterDialog, setAlterDialog] = useState({ 
    isOpen: false, mode: 'add' as 'add' | 'modify', editingId: null as number | null, 
    newColName: '', newType: 'VARCHAR2', newLength: '50', newScale: '', 
    newNullable: 'Y', newDefault: '', newDefaultMode: 'manual' as 'manual' | 'select', newComment: '', isPk: false 
  });

  useEffect(() => {
    if (isActive && !hasInitializedRef.current) {
      hasInitializedRef.current = true;

      const fetchDependencies = async () => {
        const sqlSeq = schema 
          ? `SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = '${escapeSqlString(schema)}' ORDER BY SEQUENCE_NAME`
          : `SELECT SEQUENCE_NAME FROM USER_SEQUENCES ORDER BY SEQUENCE_NAME`;
          
        const sqlType = schema
          ? `SELECT TYPE_NAME FROM ALL_TYPES WHERE OWNER = '${escapeSqlString(schema)}' ORDER BY TYPE_NAME`
          : `SELECT TYPE_NAME FROM USER_TYPES ORDER BY TYPE_NAME`;

        try {
          // Fetch with execute-sql-bg to avoid unnecessary global loading indicator flicker.
          const [seqRes, typeRes] = await Promise.all([
            ipcRenderer.invoke<{ SEQUENCE_NAME: string }>('execute-sql-bg', sqlSeq),
            ipcRenderer.invoke<{ TYPE_NAME: string }>('execute-sql-bg', sqlType)
          ]);

          if (seqRes.success && seqRes.rows) {
            setSequences(seqRes.rows.map((r: { SEQUENCE_NAME: string }) => r.SEQUENCE_NAME));
          }
          if (typeRes.success && typeRes.rows) {
            setUserTypes(typeRes.rows.map((r: { TYPE_NAME: string }) => r.TYPE_NAME));
          }
        } catch(e) {
          console.error('Failed to load dependencies:', e);
        }
      };

      fetchDependencies();
    }
  }, [schema, isActive]);

  const toHalfWidth = (str: string) => {
    return str.replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
  };

  const handleOpenAddColumnDialog = () => {
    setAlterDialog({
      isOpen: true, mode: 'add', editingId: null,
      newColName: '', newType: 'VARCHAR2', newLength: '50', newScale: '',
      newNullable: 'Y', newDefault: '', newDefaultMode: 'manual', newComment: '', isPk: false
    });
  };

  const handleOpenEditDialog = (row: ColumnDefinition & { id: number; DATA_LENGTH: string; DATA_SCALE: string }) => {
    let initialDefaultMode: 'manual' | 'select' = 'manual';
    if (row.DATA_DEFAULT) {
      const defUpper = String(row.DATA_DEFAULT).trim().toUpperCase();
      if (defUpper === 'SYSDATE' || defUpper === 'CURRENT_TIMESTAMP' || defUpper.includes('.NEXTVAL')) {
        initialDefaultMode = 'select';
      }
    }

    setAlterDialog({ 
      isOpen: true, mode: 'modify', editingId: row.id,
      newColName: row.COLUMN_NAME, newType: row.DATA_TYPE, 
      newLength: row.DATA_LENGTH || '', newScale: row.DATA_SCALE || '',
      newNullable: row.NULLABLE ?? 'Y', newDefault: row.DATA_DEFAULT || '', 
      newDefaultMode: initialDefaultMode,
      newComment: row.COMMENTS || '', isPk: row.PK_POSITION === '1' 
    });
  };

  const submitAlterColumn = () => {
    const { mode, editingId, newColName, newType, newLength, newScale, newNullable, newDefault, newComment, isPk } = alterDialog;
    
    const cleanColName = newColName.replace(/[() ]/g, '').toUpperCase().trim();
    if (!cleanColName) { alert(t("please_enter_a_column_name")); return; }

    const cleanLength = toHalfWidth(String(newLength)).replace(/[()]/g, '').trim();
    const cleanScale = toHalfWidth(String(newScale)).replace(/[()]/g, '').trim();

    if (['VARCHAR2', 'NVARCHAR2', 'CHAR'].includes(newType) && !cleanLength) {
      alert(`${newType} ` + t("size_precision_is_required_for_this_type"));
      return;
    }

    if (newType === 'NUMBER' && cleanLength) {
      const len = parseInt(cleanLength, 10);
      if (isNaN(len) || len < 1 || len > 38) { alert(t("number_scale_precision_must_be_a_half_width_number_between_1_and_38")); return; }
    }

    let finalDefault = newDefault.trim().replace(/;+$/, '');
    if (finalDefault !== '') {
      const checkVal = finalDefault.toUpperCase();
      const isNumber = !isNaN(Number(checkVal));
      const hasParentheses = checkVal.includes('(') && checkVal.includes(')');
      const isKeyword = ['SYSDATE', 'USER', 'NULL', 'CURRENT_DATE', 'CURRENT_TIMESTAMP'].includes(checkVal);
      const isSequence = checkVal.includes('.NEXTVAL');
      const isQuoted = finalDefault.startsWith("'") && finalDefault.endsWith("'"); 

      if (!isNumber && !hasParentheses && !isKeyword && !isSequence && !isQuoted) {
        finalDefault = `'${finalDefault}'`;
      }
    }

    const columnId = mode === 'add' ? Date.now() : editingId;
    if (columnId === null) return;

    const newCol = {
      id: columnId,
      COLUMN_NAME: cleanColName,
      DATA_TYPE: newType,
      DATA_LENGTH: cleanLength,
      DATA_SCALE: cleanScale,
      NULLABLE: newNullable,
      DATA_DEFAULT: finalDefault, 
      COMMENTS: newComment,
      PK_POSITION: isPk ? '1' : ''
    };

    if (mode === 'add') {
      setColumns([...columns, newCol]);
    } else {
      setColumns(columns.map(c => c.id === editingId ? newCol : c));
    }
    setAlterDialog({ ...alterDialog, isOpen: false });
  };

  const handleDropColumn = (id: number) => {
    setColumns(columns.filter(c => c.id !== id));
  };

  const submitCreateTable = async () => {
    const cleanTableName = tableName.replace(/[() ;]/g, '').toUpperCase().trim();
    if (!cleanTableName) { alert(t("please_enter_table_name")); return; }
    if (columns.length === 0) { alert(t("please_add_at_least_one_column")); return; }

    const colDefs: string[] = [];
    const pkCols: string[] = [];

    columns.forEach(col => {
      const isUserType = userTypes.includes(col.DATA_TYPE);
      const isNoLengthType = isUserType || ['DATE', 'TIMESTAMP', 'CLOB', 'BLOB'].some(t => col.DATA_TYPE.includes(t));
      
      let typeDef = col.DATA_TYPE;
      
      if (!isNoLengthType && col.DATA_LENGTH) {
        typeDef += (col.DATA_TYPE === 'NUMBER' && col.DATA_SCALE) ? `(${col.DATA_LENGTH}, ${col.DATA_SCALE})` : `(${col.DATA_LENGTH})`;
      } else if (['VARCHAR2', 'NVARCHAR2', 'CHAR'].includes(col.DATA_TYPE)) {
        typeDef += `(50)`; 
      }

      const nullClause = col.NULLABLE === 'N' ? ' NOT NULL' : '';
      const defaultClause = col.DATA_DEFAULT !== '' ? ` DEFAULT ${col.DATA_DEFAULT}` : '';

      colDefs.push(`${col.COLUMN_NAME} ${typeDef}${defaultClause}${nullClause}`);
      if (col.PK_POSITION) pkCols.push(col.COLUMN_NAME);
    });

    const targetTable = qualifiedObjectName({ schema, objectName: cleanTableName });
    const createSql = `CREATE TABLE ${targetTable} (\n  ${colDefs.join(',\n  ')}\n)`;

    setIsLoading(true);
    try {
      // Create the table on the main connection with the global loading indicator.
      const res = await ipcRenderer.invoke('execute-sql', createSql);
      if (!res.success) {
        if (res.error.includes('ORA-00907')) {
          throw new Error(t("column_default_parenthesis_error") + res.error);
        }
        throw new Error(t("table_creation_error") + res.error);
      }

      if (pkCols.length > 0) {
        const pkSql = `ALTER TABLE ${targetTable} ADD PRIMARY KEY (${pkCols.join(', ')})`;
        const pkRes = await ipcRenderer.invoke('execute-sql', pkSql);
        if (!pkRes.success) throw new Error(t("primary_key_creation_error") + pkRes.error);
      }

      if (tableComment.trim()) {
        await ipcRenderer.invoke('execute-sql', `COMMENT ON TABLE ${targetTable} IS '${tableComment.replace(/'/g, "''")}'`);
      }

      for (const col of columns) {
        if (col.COMMENTS && col.COMMENTS.trim()) {
          await ipcRenderer.invoke('execute-sql', `COMMENT ON COLUMN ${targetTable}.${col.COLUMN_NAME} IS '${col.COMMENTS.replace(/'/g, "''")}'`);
        }
      }

      alert(t("table_created"));
      window.dispatchEvent(new CustomEvent('table-created', { detail: { tabId, schema, tableName: cleanTableName } }));
    } catch (e: unknown) {
      alert(getErrorMessage(e));
    } finally {
      setIsLoading(false);
    }
  };

  return {
    t, tableName, setTableName, tableComment, setTableComment, columns, isLoading,
    sequences, userTypes, alterDialog, setAlterDialog,
    handleOpenAddColumnDialog, handleOpenEditDialog, submitAlterColumn, handleDropColumn, submitCreateTable
  };
};
