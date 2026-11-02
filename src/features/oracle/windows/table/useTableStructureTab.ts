// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { runGitOperation } from '@/features/git/gitOperation';
import { quoteIdentifier, escapeSqlString, qualifiedObjectName } from '@/shared/utils/objectIdentity';
import type { ObjectContextRow, IndexDefinition, ColumnDefinition, TableStructureCache, TriggerDefinition, ConstraintDefinition } from "@/shared/types/databaseTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

export interface TableStructureTabProps { 
  schema: string; 
  tableName: string; 
  isActive: boolean; 
  cachedStructure?: TableStructureCache | null;
  setCachedStructure?: (data: TableStructureCache | null) => void;
}

export const useTableStructureTab = (props: TableStructureTabProps) => {
  const { schema, tableName, isActive, cachedStructure, setCachedStructure } = props;
  const { t } = useTranslation();

  // Local lock reset automatically when the component unmounts.
  const hasInitializedRef = useRef<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [tableComment, setTableComment] = useState<string>('');
  const [structureRows, setStructureRows] = useState<ColumnDefinition[]>([]);
  
  const [indexRows, setIndexRows] = useState<IndexDefinition[]>([]);
  const [triggerRows, setTriggerRows] = useState<TriggerDefinition[]>([]);
  const [constraintRows, setConstraintRows] = useState<ConstraintDefinition[]>([]);

  const [structureHeight, setStructureHeight] = useState<number>(300);
  const [isResizingStructure, setIsResizingStructure] = useState<boolean>(false);
  
  const [sequences, setSequences] = useState<string[]>([]);
  const [userTypes, setUserTypes] = useState<string[]>([]); 
  
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [, setIsLoaded] = useState<boolean>(false);

  const [alterDialog, setAlterDialog] = useState({ 
    isOpen: false, mode: 'modify' as 'add' | 'modify', oldColName: '', newColName: '', oldType: '', newType: '', 
    oldLength: '', newLength: '', oldScale: '', newScale: '', oldNullable: 'Y', newNullable: 'Y', 
    oldDefault: '', newDefault: '', newDefaultMode: 'manual' as 'manual' | 'select', oldComment: '', newComment: ''
  });
  
  const [tableCommentDialog, setTableCommentDialog] = useState({ isOpen: false, comment: '' });

  const [menuState, setMenuState] = useState<{
    mouseX: number; mouseY: number; type: 'index' | 'trigger' | 'constraint'; 
    name: string; owner: string; status: string; visibility?: string;
  } | null>(null);

  const DATA_TYPES = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB'];

  useEffect(() => {
    const fetchDependencies = async () => {
      const sqlSeq = schema 
        ? `SELECT SEQUENCE_NAME FROM ALL_SEQUENCES WHERE SEQUENCE_OWNER = '${escapeSqlString(schema)}' ORDER BY SEQUENCE_NAME`
        : `SELECT SEQUENCE_NAME FROM USER_SEQUENCES ORDER BY SEQUENCE_NAME`;
        
      const sqlType = schema
        ? `SELECT TYPE_NAME FROM ALL_TYPES WHERE OWNER = '${escapeSqlString(schema)}' ORDER BY TYPE_NAME`
        : `SELECT TYPE_NAME FROM USER_TYPES ORDER BY TYPE_NAME`;

      try {
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
      } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    };
    if (isActive) fetchDependencies();
  }, [schema, isActive]);

  useEffect(() => {
    if (isActive && tableName && !hasInitializedRef.current) {
      if (cachedStructure && refreshTrigger === 0) {
        setTableComment(cachedStructure.tableComment);
        setStructureRows(cachedStructure.structureRows);
        setIndexRows(cachedStructure.indexRows);
        setTriggerRows(cachedStructure.triggerRows);
        setConstraintRows(cachedStructure.constraintRows);
        setIsLoaded(true);
        hasInitializedRef.current = true;
        return;
      }

      hasInitializedRef.current = true;

      const runInit = async () => {
        setIsLoading(true);
        try {
          const sqlTableComm = `SELECT COMMENTS FROM ALL_TAB_COMMENTS WHERE TABLE_NAME = '${escapeSqlString(tableName)}' ${schema ? `AND OWNER = '${escapeSqlString(schema)}'` : ''}`;
          const sqlCols = `SELECT c.COLUMN_NAME, c.DATA_TYPE, c.DATA_LENGTH, c.DATA_PRECISION, c.DATA_SCALE, c.NULLABLE, c.DATA_DEFAULT, comm.COMMENTS FROM ALL_TAB_COLUMNS c LEFT JOIN ALL_COL_COMMENTS comm ON c.OWNER = comm.OWNER AND c.TABLE_NAME = comm.TABLE_NAME AND c.COLUMN_NAME = comm.COLUMN_NAME ${schema ? `AND comm.OWNER = '${escapeSqlString(schema)}'` : ''} WHERE c.TABLE_NAME = '${escapeSqlString(tableName)}' ${schema ? `AND c.OWNER = '${escapeSqlString(schema)}'` : ''} ORDER BY c.COLUMN_ID`;
          const sqlPk = `SELECT cc.CONSTRAINT_NAME, cc.COLUMN_NAME, cc.POSITION FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER WHERE c.TABLE_NAME = '${escapeSqlString(tableName)}' AND c.CONSTRAINT_TYPE = 'P' ${schema ? `AND c.OWNER = '${escapeSqlString(schema)}'` : ''}`;
          
          const sqlUk = `
            SELECT i.OWNER, i.INDEX_NAME, ic.COLUMN_NAME, ic.COLUMN_POSITION
            FROM ALL_INDEXES i 
            JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER 
            WHERE i.TABLE_NAME = '${escapeSqlString(tableName)}' AND i.UNIQUENESS = 'UNIQUE'
            ${schema ? `AND i.TABLE_OWNER = '${escapeSqlString(schema)}'` : ''}
          `;
          
          const sqlIdx = `
            SELECT i.OWNER, i.INDEX_NAME, i.UNIQUENESS, i.INDEX_TYPE, i.STATUS, i.VISIBILITY, ic.COLUMN_NAME, ic.COLUMN_POSITION
            FROM ALL_INDEXES i 
            JOIN ALL_IND_COLUMNS ic ON i.INDEX_NAME = ic.INDEX_NAME AND i.OWNER = ic.INDEX_OWNER 
            WHERE i.TABLE_NAME = '${escapeSqlString(tableName)}' ${schema ? `AND i.TABLE_OWNER = '${escapeSqlString(schema)}'` : ''}
            ORDER BY i.INDEX_NAME, ic.COLUMN_POSITION
          `;
          
          const sqlTrg = `SELECT OWNER, TRIGGER_NAME, TRIGGER_TYPE, TRIGGERING_EVENT, STATUS FROM ALL_TRIGGERS WHERE TABLE_NAME = '${escapeSqlString(tableName)}' ${schema ? `AND TABLE_OWNER = '${escapeSqlString(schema)}'` : ''} ORDER BY OWNER, TRIGGER_NAME`;
          const sqlCons = `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE, STATUS, SEARCH_CONDITION, GENERATED FROM ALL_CONSTRAINTS WHERE TABLE_NAME = '${escapeSqlString(tableName)}' AND CONSTRAINT_TYPE = 'C' AND SEARCH_CONDITION IS NOT NULL ${schema ? `AND OWNER = '${escapeSqlString(schema)}'` : ''} ORDER BY CONSTRAINT_NAME`;

          const [tblCommRes, colRes, pkRes, ukRes, idxRes, trgRes, consRes] = await Promise.all([ 
            ipcRenderer.invoke<{ COMMENTS: string | null }>('execute-sql-bg', sqlTableComm),
            ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', sqlCols),
            ipcRenderer.invoke<{ COLUMN_NAME: string; POSITION: number }>('execute-sql-bg', sqlPk),
            ipcRenderer.invoke<({ OWNER: string; INDEX_NAME: string }) & ({ OWNER: string; COLUMN_NAME: string; INDEX_NAME: string; COLUMN_POSITION: number })>('execute-sql-bg', sqlUk),
            ipcRenderer.invoke<({ COLUMN_NAME: string }) & ({ OWNER: string; INDEX_NAME: string; INDEX_TYPE: string; UNIQUENESS: string; IS_PRIMARY: boolean | string; STATUS: string; VISIBILITY: string; COLUMN_NAME: string; COLUMN_POSITION: number })>('execute-sql-bg', sqlIdx),
            ipcRenderer.invoke<{ OWNER: string; TRIGGER_NAME: string; TRIGGER_TYPE: string; TRIGGERING_EVENT: string; STATUS: string }>('execute-sql-bg', sqlTrg),
            ipcRenderer.invoke<ConstraintDefinition>('execute-sql-bg', sqlCons)
          ]);

          let newTableComment = '';
          let newStructureRows: ColumnDefinition[] = [];
          let newIndexRows: IndexDefinition[] = [];
          let newTriggerRows: TriggerDefinition[] = [];
          let newConstraintRows: ConstraintDefinition[] = [];

          if (tblCommRes.success && tblCommRes.rows && tblCommRes.rows.length > 0) {
            newTableComment = tblCommRes.rows[0].COMMENTS || '';
          }

          if (colRes.success && colRes.rows) {
            const pkRows = (pkRes.success && pkRes.rows) ? pkRes.rows : [];
            const isPkComposite = pkRows.length > 1;

            const ukCounts: Record<string, number> = {};
            if (ukRes.success && ukRes.rows) {
              ukRes.rows.forEach((r: { OWNER: string; INDEX_NAME: string }) => {
                ukCounts[JSON.stringify([r.OWNER ?? schema, r.INDEX_NAME])] = (ukCounts[JSON.stringify([r.OWNER ?? schema, r.INDEX_NAME])] || 0) + 1;
              });
            }

            const ukMap: Record<string, { pos: string, isComposite: boolean }[]> = {};
            if (ukRes.success && ukRes.rows) {
              ukRes.rows.forEach((r: { OWNER: string; COLUMN_NAME: string; INDEX_NAME: string; COLUMN_POSITION: number }) => {
                if (!ukMap[r.COLUMN_NAME]) ukMap[r.COLUMN_NAME] = [];
                const isComp = ukCounts[JSON.stringify([r.OWNER ?? schema, r.INDEX_NAME])] > 1;
                
                const exists = ukMap[r.COLUMN_NAME].some(x => x.pos === String(r.COLUMN_POSITION) && x.isComposite === isComp);
                if (!exists) {
                  ukMap[r.COLUMN_NAME].push({ pos: String(r.COLUMN_POSITION), isComposite: isComp });
                }
              });
            }

            newStructureRows = colRes.rows.map((col, i: number) => {
              const pk = pkRows.find((p: { COLUMN_NAME: string }) => p.COLUMN_NAME === col.COLUMN_NAME);
              const idxs = (idxRes.success && idxRes.rows) ? idxRes.rows.filter((x: { COLUMN_NAME: string }) => x.COLUMN_NAME === col.COLUMN_NAME) : [];
              
              let defVal = col.DATA_DEFAULT != null ? String(col.DATA_DEFAULT).trim() : '';
              if (defVal.toUpperCase() === 'NULL') defVal = '';
              
              const ukData = (!pk && ukMap[col.COLUMN_NAME]) ? ukMap[col.COLUMN_NAME] : [];

              return { 
                id: i, 
                rowNo: i + 1,
                ...col, 
                DATA_DEFAULT: defVal, 
                PK_POSITION: pk ? pk.POSITION : '', 
                IS_PK_COMPOSITE: isPkComposite,
                UK_DATA: ukData,
                INDEX_INFO: idxs.map((x: { OWNER: string; INDEX_NAME: string; COLUMN_POSITION: number }) => `${x.INDEX_NAME}(${x.COLUMN_POSITION})`).join(', ')
              };
            });
          }
          
          if (idxRes.success && idxRes.rows) {
            const idxMap: Record<string, Omit<IndexDefinition, 'COLUMNS'> & { COLUMNS: string[] }> = {};
            idxRes.rows.forEach((r: { OWNER: string; INDEX_NAME: string; INDEX_TYPE: string; UNIQUENESS: string; IS_PRIMARY: boolean | string; STATUS: string; VISIBILITY: string; COLUMN_NAME: string; COLUMN_POSITION: number }) => {
              const key = JSON.stringify([r.OWNER ?? schema, r.INDEX_NAME]);
              if (!idxMap[key]) {
                const isFunc = r.INDEX_TYPE?.includes('FUNCTION');
                idxMap[key] = {
                  id: key, OWNER: r.OWNER ?? schema, INDEX_NAME: r.INDEX_NAME, UNIQUENESS: r.UNIQUENESS,
                  IS_PRIMARY: r.IS_PRIMARY === 'TRUE', INDEX_TYPE: r.INDEX_TYPE, STATUS: r.STATUS, VISIBILITY: r.VISIBILITY, 
                  TYPE_DISP: isFunc ? t("function_2") : t("standard_b_tree"),
                  COLUMNS: [] 
                }; 
              }
              idxMap[key].COLUMNS.push(`${r.COLUMN_NAME}(${r.COLUMN_POSITION})`);
            });
            newIndexRows = Object.values(idxMap).map((idx) => ({ ...idx, COLUMNS: idx.COLUMNS.join(', ') }));
          }

          if (trgRes.success && trgRes.rows) {
            newTriggerRows = trgRes.rows.map((r: { OWNER: string; TRIGGER_NAME: string; TRIGGER_TYPE: string; TRIGGERING_EVENT: string; STATUS: string }) => ({
              id: JSON.stringify([r.OWNER ?? schema, r.TRIGGER_NAME]), OWNER: r.OWNER ?? schema, TRIGGER_NAME: r.TRIGGER_NAME,
              TRIGGER_TYPE: `${r.TRIGGER_TYPE} ${r.TRIGGERING_EVENT}`, STATUS: r.STATUS 
            }));
          }

          if (consRes.success && consRes.rows) {
            const pureCheckConstraints = consRes.rows.filter((r) => r.GENERATED === 'USER NAME');
            newConstraintRows = pureCheckConstraints.map((r) => ({ id: r.CONSTRAINT_NAME, ...r }));
          }

          setTableComment(newTableComment);
          setStructureRows(newStructureRows);
          setIndexRows(newIndexRows);
          setTriggerRows(newTriggerRows);
          setConstraintRows(newConstraintRows);

          if (setCachedStructure) {
            setCachedStructure({
              tableComment: newTableComment,
              structureRows: newStructureRows,
              indexRows: newIndexRows,
              triggerRows: newTriggerRows,
              constraintRows: newConstraintRows
            });
          }
          
          setIsLoaded(true);
          if (refreshTrigger > 0) setRefreshTrigger(0); 
        } finally {
          setIsLoading(false);
        }
      };

      runInit();
    }
  }, [isActive, tableName, refreshTrigger, cachedStructure, schema, setCachedStructure, t]);

  useEffect(() => {
    const handleAutoRefresh = (e: WindowEventMap['refresh-table-structure']) => {
      const { schema: evtSchema, tableName: evtTableName } = e.detail;
      if (evtSchema === schema && evtTableName === tableName) {
        hasInitializedRef.current = false;
        if (setCachedStructure) setCachedStructure(null); 
        setRefreshTrigger(prev => prev + 1);
      }
    };
    window.addEventListener('refresh-table-structure', handleAutoRefresh);
    return () => window.removeEventListener('refresh-table-structure', handleAutoRefresh);
  }, [schema, tableName, setCachedStructure]);

  useEffect(() => {
    if (refreshTrigger > 0) {
      window.dispatchEvent(new CustomEvent('reload-source', { detail: { schema, tableName } }));
    }
  }, [refreshTrigger, schema, tableName]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingStructure) return;
      let newHeight = e.clientY - 140; 
      if (newHeight < 100) newHeight = 100;
      if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
      setStructureHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizingStructure(false);
    if (isResizingStructure) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('mouseup', handleMouseUp); }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isResizingStructure]);

  const submitTableComment = async () => {
    const { comment } = tableCommentDialog;
    const sqlText = `COMMENT ON TABLE ${qualifiedObjectName({ schema, objectName: tableName })} IS '${comment.replace(/'/g, "''")}'`;
    setIsLoading(true);
    try {
      const res = await ipcRenderer.invoke('execute-sql', sqlText);
      if (res.success) { 
        alert(t("table_comment_changed"));
        hasInitializedRef.current = false;
        if (setCachedStructure) setCachedStructure(null);
        setTableCommentDialog({ ...tableCommentDialog, isOpen: false }); 
        setRefreshTrigger(prev => prev + 1); 
      } else { alert(t("comment_modification_error") + res.error); }
    } finally { setIsLoading(false); }
  };

  const handleOpenAddColumnDialog = () => {
    setAlterDialog({
      isOpen: true, mode: 'add', oldColName: '', newColName: '', oldType: '', newType: 'VARCHAR2', 
      oldLength: '', newLength: '50', oldScale: '', newScale: '', oldNullable: 'Y', newNullable: 'Y', 
      oldDefault: '', newDefault: '', newDefaultMode: 'manual', oldComment: '', newComment: ''
    });
  };

  const handleOpenAlterDialog = (row: ColumnDefinition) => {
    const baseType = (row.DATA_TYPE || '').split('(')[0]; 
    const currentType = (DATA_TYPES.includes(baseType) || userTypes.includes(baseType)) ? baseType : row.DATA_TYPE;
    const isNumber = baseType === 'NUMBER';
    
    const len = isNumber ? (row.DATA_PRECISION != null ? String(row.DATA_PRECISION) : '') : (row.DATA_LENGTH != null ? String(row.DATA_LENGTH) : '');
    const scale = isNumber && row.DATA_SCALE != null ? String(row.DATA_SCALE) : '';

    let initialDefaultMode: 'manual' | 'select' = 'manual';
    if (row.DATA_DEFAULT) {
      const defUpper = String(row.DATA_DEFAULT).trim().toUpperCase();
      if (defUpper === 'SYSDATE' || defUpper === 'CURRENT_TIMESTAMP' || defUpper.includes('.NEXTVAL')) {
        initialDefaultMode = 'select';
      }
    }

    setAlterDialog({ 
      isOpen: true, mode: 'modify', oldColName: row.COLUMN_NAME, newColName: row.COLUMN_NAME, 
      oldType: currentType, newType: currentType, oldLength: len, newLength: len, 
      oldScale: scale, newScale: scale, oldNullable: row.NULLABLE ?? 'Y', newNullable: row.NULLABLE ?? 'Y', 
      oldDefault: row.DATA_DEFAULT || '', newDefault: row.DATA_DEFAULT || '', newDefaultMode: initialDefaultMode,
      oldComment: row.COMMENTS || '', newComment: row.COMMENTS || '' 
    });
  };

  const submitAlterColumn = async () => {
    const { mode, oldColName, newColName, oldType, newType, oldLength, newLength, oldScale, newScale, oldNullable, newNullable, oldDefault, newDefault, oldComment, newComment } = alterDialog;
    if (!newColName.trim()) { alert(t("please_enter_a_column_name")); return; }
    if (newType === 'NUMBER' && newLength) {
      const len = parseInt(newLength, 10);
      if (len < 1 || len > 38) { alert(t("number_scale_precision_must_be_between_1_and_38")); return; }
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

    const isUserType = userTypes.includes(newType);
    const isNoLengthType = isUserType || ['DATE', 'TIMESTAMP', 'CLOB', 'BLOB'].some(t => newType.includes(t));
    let typeDef = newType;
    if (!isNoLengthType && newLength) { typeDef += (newType === 'NUMBER' && newScale) ? `(${newLength}, ${newScale})` : `(${newLength})`; }

    const targetTable = qualifiedObjectName({ schema, objectName: tableName });
    setIsLoading(true);

    try {
      if (mode === 'add') {
        const nullClause = newNullable === 'N' ? ' NOT NULL' : '';
        const defaultClause = finalDefault !== '' ? ` DEFAULT ${finalDefault}` : '';
        const addSql = `ALTER TABLE ${targetTable} ADD (${newColName} ${typeDef}${defaultClause}${nullClause})`;
        const addRes = await ipcRenderer.invoke('execute-sql', addSql);
        
        if (!addRes.success) {
          if (addRes.error.includes('ORA-01758')) throw new Error(t("column_not_null_requires_default"));
          throw new Error(t("column_addition_error") + addRes.error);
        }
        if (newComment) {
          const commRes = await ipcRenderer.invoke('execute-sql', `COMMENT ON COLUMN ${targetTable}.${newColName} IS '${newComment.replace(/'/g, "''")}'`);
          if (!commRes.success) throw new Error(t("comment_addition_error") + commRes.error);
        }
        alert(t("column_added"));
      } else {

        if (oldColName !== newColName) {
          const renameRes = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} RENAME COLUMN ${oldColName} TO ${newColName}`);
          if (!renameRes.success) throw new Error(t("column_rename_error") + renameRes.error);
        }
        
        const isTypeChanged = (oldType !== newType) || (oldLength !== newLength) || (oldScale !== newScale);
        const isDefaultChanged = (oldDefault !== finalDefault);
        const isNullChanged = (oldNullable !== newNullable);

        if (isTypeChanged || isDefaultChanged || isNullChanged) {
          const modifyParts = [];
          if (isTypeChanged) modifyParts.push(typeDef);
          if (isDefaultChanged) modifyParts.push(finalDefault !== '' ? `DEFAULT ${finalDefault}` : 'DEFAULT NULL');
          if (isNullChanged) modifyParts.push(newNullable === 'Y' ? 'NULL' : 'NOT NULL');

          const modifyRes = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} MODIFY ${newColName} ${modifyParts.join(' ')}`);
          if (!modifyRes.success) {
            if (modifyRes.error.includes('ORA-02296')) throw new Error(t("column_not_null_existing_nulls_error"));
            throw new Error(t("definition_change_error") + modifyRes.error);
          }
        }
        if (oldComment !== newComment) {
          const commRes = await ipcRenderer.invoke('execute-sql', `COMMENT ON COLUMN ${targetTable}.${newColName} IS '${newComment.replace(/'/g, "''")}'`);
          if (!commRes.success) throw new Error(t("comment_modification_error") + commRes.error);
        }
        alert(t("column_definition_changed"));
      }
      setAlterDialog({ ...alterDialog, isOpen: false }); 
      hasInitializedRef.current = false;
      if (setCachedStructure) setCachedStructure(null);
      setRefreshTrigger(prev => prev + 1); 
    } catch (e: unknown) { alert(getErrorMessage(e)); } finally { setIsLoading(false); }
  };

  const handleDropColumn = async (colName: string) => {
    if (window.confirm(t("column_3") + colName + t("this_operation_cannot_be_undone_and_data_will_be_lost"))) {
      setIsLoading(true);
      try {
        const targetTable = `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
        const res = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} DROP COLUMN "${colName}"`);
        if (res.success) { 
          alert(t("column_dropped"));
          hasInitializedRef.current = false;
          if (setCachedStructure) setCachedStructure(null);
          setRefreshTrigger(prev => prev + 1); 
        } else { 
          alert(t("delete_error_3") + res.error);
        }
      } finally { setIsLoading(false); }
    }
  };

  const handleDropTable = async () => {
    if (window.confirm(t("table_3") + tableName + t("this_operation_cannot_be_undone_and_all_data_will_be_lost"))) {
      setIsLoading(true);
      try {
        const targetTable = `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}`;
        const res = await ipcRenderer.invoke('execute-sql', `DROP TABLE ${targetTable} CASCADE CONSTRAINTS`);
        if (res.success) {
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'ORACLE',
              schema: schema,
              objectType: 'TABLE',
              objectName: tableName
            });
          } catch { /* Auxiliary failures must not affect the main operation's result. */  }

          alert(t("table_dropped"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TABLE' } }));
          window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: schema, objectName: tableName, objectType: 'TABLE' } }));
        } else {
          alert(t("delete_error_3") + res.error);
        }
      } catch (e: unknown) {
        alert(t("delete_error_3") + getErrorMessage(e));
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleOpenIndexWindow = () => { window.dispatchEvent(new CustomEvent('open-create-index-tab', { detail: { schema, tableName } })); };
  const handleOpenTriggerWindow = () => { window.dispatchEvent(new CustomEvent('open-create-trigger-tab', { detail: { schema, tableName } })); };

  const handleContextMenu = (e: React.MouseEvent, type: 'index' | 'trigger' | 'constraint', row: ObjectContextRow) => {
    e.preventDefault();
    setMenuState({
      mouseX: e.clientX,
      mouseY: e.clientY,
      type,
      name: (type === 'index' ? row.INDEX_NAME : type === 'trigger' ? row.TRIGGER_NAME : row.CONSTRAINT_NAME) ?? '',
      owner: row.OWNER ?? schema,
      status: row.STATUS ?? '',
      visibility: type === 'index' ? row.VISIBILITY : undefined
    });
  };

  const handleToggleEnable = async () => {
    if (!menuState) return;
    setIsLoading(true);
    try {
      let sql = '';
      const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : `${quoteIdentifier(tableName)}`;
      const safeName = menuState.name;
      const objectSchema = menuState.owner;

      if (menuState.type === 'index') {
        const isVisible = menuState.visibility === 'VISIBLE';
        sql = `ALTER INDEX ${objectSchema ? `${quoteIdentifier(objectSchema)}.` : ''}${quoteIdentifier(safeName)} ${isVisible ? 'INVISIBLE' : 'VISIBLE'}`;
      } else if (menuState.type === 'trigger') {
        const isEnabled = menuState.status === 'ENABLED';
        sql = `ALTER TRIGGER ${objectSchema ? `${quoteIdentifier(objectSchema)}.` : ''}${quoteIdentifier(safeName)} ${isEnabled ? 'DISABLE' : 'ENABLE'}`;
      } else if (menuState.type === 'constraint') {
        const isEnabled = menuState.status === 'ENABLED';
        sql = `ALTER TABLE ${targetTable} ${isEnabled ? 'DISABLE' : 'ENABLE'} CONSTRAINT ${quoteIdentifier(safeName)}`;
      }
      
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        hasInitializedRef.current = false;
        if (setCachedStructure) setCachedStructure(null);
        setRefreshTrigger(prev => prev + 1);
        
        let objTypeForSidebar = '';
        if (menuState.type === 'index') objTypeForSidebar = 'INDEX';
        else if (menuState.type === 'trigger') objTypeForSidebar = 'TRIGGER';
        
        if (objTypeForSidebar) {
           window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: objectSchema, objType: objTypeForSidebar } }));
        }

      } else {
        alert(t("status_change_error_2") + res.error);
      }
    } finally {
      setIsLoading(false);
      setMenuState(null);
    }
  };

  const handleDeleteObject = async () => {
    if (!menuState) return;
    if (!window.confirm(t("opening_quote") + menuState.name + t("this_operation_cannot_be_undone_2"))) {
      setMenuState(null);
      return;
    }
    setIsLoading(true);
    try {
      let sql = '';
      const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : `${quoteIdentifier(tableName)}`;
      const safeName = menuState.name;
      const objectSchema = menuState.owner;

      if (menuState.type === 'index') {
        sql = `DROP INDEX ${objectSchema ? `${quoteIdentifier(objectSchema)}.` : ''}${quoteIdentifier(safeName)}`;
      } else if (menuState.type === 'trigger') {
        sql = `DROP TRIGGER ${objectSchema ? `${quoteIdentifier(objectSchema)}.` : ''}${quoteIdentifier(safeName)}`;
      } else if (menuState.type === 'constraint') {
        sql = `ALTER TABLE ${targetTable} DROP CONSTRAINT ${quoteIdentifier(safeName)}`;
      }
      
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        let objTypeForSidebar = '';
        if (menuState.type === 'index') objTypeForSidebar = 'INDEX';
        else if (menuState.type === 'trigger') objTypeForSidebar = 'TRIGGER';

        if (objTypeForSidebar) {
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'ORACLE',
              schema: objectSchema,
              objectType: objTypeForSidebar,
              objectName: safeName
            });
          } catch { /* Auxiliary failures must not affect the main operation's result. */ }
        }

        alert(t("deleted"));
        hasInitializedRef.current = false;
        if (setCachedStructure) setCachedStructure(null);
        setRefreshTrigger(prev => prev + 1); 

        if (objTypeForSidebar) {
           window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: objectSchema, objType: objTypeForSidebar } }));
           window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: objectSchema, objectName: safeName, objectType: objTypeForSidebar } }));
        }

      } else {
        alert(t("delete_error_3") + res.error);
      }
    } finally {
      setIsLoading(false);
      setMenuState(null);
    }
  };

  return {
    t, isLoading, tableComment, setTableComment, structureRows, indexRows, triggerRows, constraintRows,
    structureHeight, setStructureHeight, isResizingStructure, setIsResizingStructure,
    sequences, userTypes, setRefreshTrigger, alterDialog, setAlterDialog, tableCommentDialog, setTableCommentDialog,
    menuState, setMenuState, DATA_TYPES,
    handleCopyStructure: () => {}, 
    submitTableComment, handleOpenAddColumnDialog, handleOpenAlterDialog, submitAlterColumn, handleDropColumn, handleDropTable,
    handleOpenIndexWindow, handleOpenTriggerWindow, handleContextMenu, handleToggleEnable, handleDeleteObject
  };
};
