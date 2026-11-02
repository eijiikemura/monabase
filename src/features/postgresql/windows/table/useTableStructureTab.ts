// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { runGitOperation } from '@/features/git/gitOperation';
import { quoteIdentifier, escapeSqlString, qualifiedObjectName } from '@/shared/utils/objectIdentity';
import type { ObjectContextRow, IndexDefinition, ColumnDefinition, TableStructureCache, TriggerDefinition, ConstraintDefinition } from "@/shared/types/databaseTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

interface StructureIndexColumn {
  INDEX_NAME: string;
  IS_PRIMARY: boolean | string;
  UNIQUENESS: boolean | string;
  INDEX_TYPE: string;
  STATUS: string;
  COLUMN_NAME: string | null;
  COLUMN_DEFINITION: string;
  COLUMN_POSITION: number;
  IS_INCLUDED: boolean;
  IS_PARTIAL: boolean;
}

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

  // Component-local lock.
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
    isOpen: false, mode: 'modify' as 'add' | 'modify', oldColName: '', newColName: '', oldType: '', newType: 'VARCHAR', 
    oldLength: '', newLength: '50', oldScale: '', newScale: '', oldNullable: 'Y', newNullable: 'Y', 
    oldDefault: '', newDefault: '', newDefaultMode: 'manual' as 'manual' | 'now' | 'sequence', oldComment: '', newComment: ''
  });
  
  const [tableCommentDialog, setTableCommentDialog] = useState({ isOpen: false, comment: '' });

  const [menuState, setMenuState] = useState<{
    mouseX: number; mouseY: number; type: 'index' | 'trigger' | 'constraint'; 
    name: string; status: string; visibility?: string; isPrimary?: boolean;
  } | null>(null);

  const DATA_TYPES = [
    'VARCHAR', 'CHAR', 'TEXT', 
    'INTEGER', 'SMALLINT', 'BIGINT', 'SERIAL', 'BIGSERIAL',
    'NUMERIC', 'REAL', 'DOUBLE PRECISION', 
    'DATE', 'TIMESTAMP', 'TIME', 'BOOLEAN', 'BYTEA', 'JSONB', 'UUID'
  ];

  // Initialize once on mount.
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

      hasInitializedRef.current = true; // Lock immediately to prevent reentry.

      const runInit = async () => {
        setIsLoading(true);
        try {
          const safeSchema = schema;
          const safeTable = tableName;

          const sqlMain = `
            SELECT 
              a.attname AS "COLUMN_NAME",
              pg_catalog.format_type(a.atttypid, a.atttypmod) AS "DATA_TYPE",
              CASE WHEN a.attnotnull THEN 'N' ELSE 'Y' END AS "NULLABLE",
              pg_get_expr(d.adbin, d.adrelid) AS "DATA_DEFAULT",
              col_description(a.attrelid, a.attnum) AS "COMMENTS",
              (SELECT array_position(pk.conkey, a.attnum)
               FROM pg_catalog.pg_constraint pk WHERE pk.conrelid = a.attrelid AND pk.contype = 'p') AS "PK_POSITION",
              (SELECT cardinality(pk.conkey) FROM pg_catalog.pg_constraint pk WHERE pk.conrelid = a.attrelid AND pk.contype = 'p') AS "PK_COUNT",
              obj_description(a.attrelid, 'pg_class') AS "TABLE_COMMENT"
            FROM pg_catalog.pg_attribute a
            LEFT JOIN pg_catalog.pg_attrdef d ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE a.attrelid = '${escapeSqlString(qualifiedObjectName({ schema: safeSchema, objectName: safeTable }))}'::regclass
              AND a.attnum > 0 AND NOT a.attisdropped
            ORDER BY a.attnum;
          `;
          
          const sqlIdx = `
            SELECT 
              i.relname AS "INDEX_NAME", 
              ix.indisunique AS "UNIQUENESS", 
              ix.indisprimary AS "IS_PRIMARY",
              am.amname AS "INDEX_TYPE", 
              CASE WHEN ix.indisvalid THEN 'VALID' ELSE 'INVALID' END AS "STATUS",
              pg_get_indexdef(ix.indexrelid, pos.n, true) AS "COLUMN_DEFINITION",
              pos.n > ix.indnkeyatts AS "IS_INCLUDED",
              ix.indpred IS NOT NULL AS "IS_PARTIAL",
              att.attname AS "COLUMN_NAME",
              pos.n AS "COLUMN_POSITION"
            FROM pg_index ix
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_class t ON t.oid = ix.indrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_am am ON i.relam = am.oid
            CROSS JOIN LATERAL generate_series(1, ix.indnatts) AS pos(n)
            LEFT JOIN pg_attribute att ON att.attrelid = t.oid AND att.attnum = ix.indkey[pos.n - 1]
            WHERE n.nspname = '${escapeSqlString(safeSchema)}' AND t.relname = '${escapeSqlString(safeTable)}'
            ORDER BY "INDEX_NAME", "COLUMN_POSITION"
          `;
          
          const sqlTrg = `
            SELECT 
              trg.tgname AS "TRIGGER_NAME", 
              CASE 
                WHEN trg.tgtype::integer & 2 = 2 THEN 'BEFORE '
                WHEN trg.tgtype::integer & 64 = 64 THEN 'INSTEAD OF '
                ELSE 'AFTER '
              END || 
              CASE 
                WHEN trg.tgtype::integer & 4 = 4 THEN 'INSERT'
                WHEN trg.tgtype::integer & 8 = 8 THEN 'DELETE'
                WHEN trg.tgtype::integer & 16 = 16 THEN 'UPDATE'
                WHEN trg.tgtype::integer & 32 = 32 THEN 'TRUNCATE'
                ELSE 'UNKNOWN'
              END AS "TRIGGER_TYPE", 
              CASE WHEN trg.tgenabled = 'O' THEN 'VALID' ELSE 'DISABLED' END AS "STATUS"
            FROM pg_trigger trg
            JOIN pg_class t ON t.oid = trg.tgrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = '${escapeSqlString(safeSchema)}'
              AND t.relname = '${escapeSqlString(safeTable)}'
              AND trg.tgisinternal = false
            ORDER BY trg.tgname
          `;
          
          const sqlCons = `
            SELECT 
              conname AS "CONSTRAINT_NAME", 
              'C' AS "CONSTRAINT_TYPE", 
              pg_get_expr(conbin, conrelid) AS "SEARCH_CONDITION"
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE c.contype = 'c' AND n.nspname = '${escapeSqlString(safeSchema)}' AND t.relname = '${escapeSqlString(safeTable)}'
          `;

          // Use background handlers for all requests.
          const [colRes, idxRes, trgRes, consRes] = await Promise.all([ 
            ipcRenderer.invoke<ColumnDefinition & { PK_COUNT: number; TABLE_COMMENT: string | null }>('execute-sql-bg', sqlMain),
            ipcRenderer.invoke<StructureIndexColumn>('execute-sql-bg', sqlIdx),
            ipcRenderer.invoke<{ TRIGGER_NAME: string }>('execute-sql-bg', sqlTrg),
            ipcRenderer.invoke<{ CONSTRAINT_NAME: string }>('execute-sql-bg', sqlCons)
          ]);

          let newTableComment = '';
          let newStructureRows: ColumnDefinition[] = [];
          let newIndexRows: IndexDefinition[] = [];
          let newTriggerRows: TriggerDefinition[] = [];
          let newConstraintRows: ConstraintDefinition[] = [];

          if (colRes.success && colRes.rows) {
            if (colRes.rows.length > 0) newTableComment = colRes.rows[0].TABLE_COMMENT || '';

            const isPkComposite = colRes.rows.some((r: { PK_COUNT: number }) => r.PK_COUNT > 1);
            const ukCounts: Record<string, number> = {};
            const ukMap: Record<string, { pos: string, isComposite: boolean }[]> = {};

            if (idxRes.success && idxRes.rows) {
              idxRes.rows.forEach((r) => {
                if ((r.UNIQUENESS === true || r.UNIQUENESS === 't') && !r.IS_INCLUDED && !r.IS_PARTIAL && r.IS_PRIMARY !== true && r.IS_PRIMARY !== 't') {
                  ukCounts[r.INDEX_NAME] = (ukCounts[r.INDEX_NAME] || 0) + 1;
                }
              });
              idxRes.rows.forEach((r) => {
                if (!r.COLUMN_NAME) return;
                if ((r.UNIQUENESS === true || r.UNIQUENESS === 't') && !r.IS_INCLUDED && !r.IS_PARTIAL && r.IS_PRIMARY !== true && r.IS_PRIMARY !== 't') {
                  if (!ukMap[r.COLUMN_NAME]) ukMap[r.COLUMN_NAME] = [];
                  const isComp = ukCounts[r.INDEX_NAME] > 1;
                  const exists = ukMap[r.COLUMN_NAME].some(x => x.pos === String(r.COLUMN_POSITION) && x.isComposite === isComp);
                  if (!exists) ukMap[r.COLUMN_NAME].push({ pos: String(r.COLUMN_POSITION), isComposite: isComp });
                }
              });
            }

            newStructureRows = colRes.rows.map((col: ColumnDefinition, i: number) => {
              const idxs = (idxRes.success && idxRes.rows) ? idxRes.rows.filter(x => x.COLUMN_NAME === col.COLUMN_NAME) : [];
              const defVal = col.DATA_DEFAULT != null ? String(col.DATA_DEFAULT).trim() : '';
              const ukData = (!col.PK_POSITION && ukMap[col.COLUMN_NAME]) ? ukMap[col.COLUMN_NAME] : [];

              let dLen: string | undefined;
              let dScale: string | undefined;
              const match = col.DATA_TYPE.match(/\((\d+)(?:,\s*(\d+))?\)/);
              if (match) {
                dLen = match[1];
                dScale = match[2] || undefined;
              }

              return { 
                id: i, 
                rowNo: i + 1,
                COLUMN_NAME: col.COLUMN_NAME,
                DATA_TYPE: col.DATA_TYPE.split('(')[0].trim(),
                DATA_LENGTH: dLen,
                DATA_SCALE: dScale,
                NULLABLE: col.NULLABLE,
                COMMENTS: col.COMMENTS,
                DATA_DEFAULT: defVal, 
                PK_POSITION: col.PK_POSITION ?? '',
                IS_PK_COMPOSITE: isPkComposite,
                UK_DATA: ukData,
                INDEX_INFO: idxs.map((x: { INDEX_NAME: string; COLUMN_POSITION: number }) => `${x.INDEX_NAME}(${x.COLUMN_POSITION})`).join(', ')
              };
            });
          }
          
          if (idxRes.success && idxRes.rows) {
            const idxMap: Record<string, Omit<IndexDefinition, 'COLUMNS'> & { COLUMNS: string[] }> = {};
            idxRes.rows.forEach((r) => {
              if (!idxMap[r.INDEX_NAME]) { 
                const isPrimary = r.IS_PRIMARY === true || r.IS_PRIMARY === 't';
                const isUnique = r.UNIQUENESS === true || r.UNIQUENESS === 't';
                const uniquenessStr = isPrimary ? 'PRIMARY KEY' : (isUnique ? 'UNIQUE' : 'NONUNIQUE');
                
                idxMap[r.INDEX_NAME] = { 
                  id: r.INDEX_NAME, 
                  INDEX_NAME: r.INDEX_NAME, 
                  UNIQUENESS: uniquenessStr, 
                  IS_PRIMARY: isPrimary, 
                  INDEX_TYPE: r.INDEX_TYPE || 'UNKNOWN', 
                  STATUS: r.STATUS, 
                  TYPE_DISP: r.INDEX_TYPE || 'UNKNOWN',
                  COLUMNS: [] 
                }; 
              }
              idxMap[r.INDEX_NAME].COLUMNS.push(`${r.COLUMN_DEFINITION ?? r.COLUMN_NAME}(${r.COLUMN_POSITION})${r.IS_INCLUDED ? ' INCLUDE' : ''}`);
            });
            newIndexRows = Object.values(idxMap).map((idx) => ({ ...idx, COLUMNS: idx.COLUMNS.join(', ') }));
          }

          if (trgRes.success && trgRes.rows) {
            newTriggerRows = trgRes.rows.map((r: { TRIGGER_NAME: string }) => ({ id: r.TRIGGER_NAME, ...r }));
          }

          if (consRes.success && consRes.rows) {
            newConstraintRows = consRes.rows.map((r: { CONSTRAINT_NAME: string }) => ({ id: r.CONSTRAINT_NAME, ...r }));
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
  }, [isActive, tableName, refreshTrigger, cachedStructure, schema, setCachedStructure]);

  useEffect(() => {
    const fetchDependencies = async () => {
      const sqlSeq = `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = '${escapeSqlString(schema)}' ORDER BY sequence_name`;
      const sqlTypes = `
        SELECT t.typname 
        FROM pg_type t 
        JOIN pg_namespace n ON n.oid = t.typnamespace 
        LEFT JOIN pg_class c ON c.oid = t.typrelid
        WHERE n.nspname = '${escapeSqlString(schema)}'
          AND (t.typtype = 'e' OR (t.typtype = 'c' AND c.relkind = 'c'))
      `;
      try {
        const [seqRes, typeRes] = await Promise.all([
          ipcRenderer.invoke<{ sequence_name: string }>('execute-sql-bg', sqlSeq),
          ipcRenderer.invoke<{ typname: string }>('execute-sql-bg', sqlTypes)
        ]);

        if (seqRes.success && seqRes.rows) setSequences(seqRes.rows.map((r: { sequence_name: string }) => r.sequence_name));
        if (typeRes.success && typeRes.rows) setUserTypes(typeRes.rows.map((r: { typname: string }) => r.typname));
      } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    };
    
    if (isActive && sequences.length === 0 && userTypes.length === 0) {
      fetchDependencies();
    }
  }, [schema, isActive, sequences.length, userTypes.length]);

  useEffect(() => {
    const handleAutoRefresh = (e: WindowEventMap['refresh-table-structure']) => {
      const { schema: evtSchema, tableName: evtTableName } = e.detail;
      if (evtSchema === schema && evtTableName === tableName) {
        hasInitializedRef.current = false; // Unlock when refreshing.
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
    const sqlText = `COMMENT ON TABLE ${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)} IS '${comment.replace(/'/g, "''")}'`;
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
      isOpen: true, mode: 'add', oldColName: '', newColName: '', oldType: '', newType: 'VARCHAR', 
      oldLength: '', newLength: '50', oldScale: '', newScale: '', oldNullable: 'Y', newNullable: 'Y', 
      oldDefault: '', newDefault: '', newDefaultMode: 'manual', oldComment: '', newComment: ''
    });
  };

  const handleOpenAlterDialog = (row: ColumnDefinition) => {
    let baseType = (row.DATA_TYPE || '').split('(')[0].trim().toUpperCase();
    if (baseType === 'CHARACTER VARYING') baseType = 'VARCHAR';
    if (baseType === 'CHARACTER') baseType = 'CHAR';

    const currentType = (DATA_TYPES.includes(baseType) || userTypes.includes(baseType)) ? baseType : row.DATA_TYPE;
    const isNumber = baseType === 'NUMERIC' || baseType === 'DECIMAL';
    
    const len = isNumber ? (row.DATA_PRECISION != null ? String(row.DATA_PRECISION) : '') : (row.DATA_LENGTH != null ? String(row.DATA_LENGTH) : '');
    const scale = isNumber && row.DATA_SCALE != null ? String(row.DATA_SCALE) : '';

    let initialDefaultMode: 'manual' | 'now' | 'sequence' = 'manual';
    if (row.DATA_DEFAULT) {
      const defUpper = String(row.DATA_DEFAULT).trim().toUpperCase();
      if (defUpper === 'NOW()' || defUpper === 'CURRENT_TIMESTAMP') {
        initialDefaultMode = 'now';
      } else if (defUpper.includes('NEXTVAL')) {
        initialDefaultMode = 'sequence';
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

    let finalDefault = newDefault.trim().replace(/;+$/, '');
    if (finalDefault !== '') {
      const checkVal = finalDefault.toUpperCase();
      const isNumber = !isNaN(Number(checkVal));
      const hasParentheses = checkVal.includes('(') && checkVal.includes(')');
      const isKeyword = ['NOW()', 'USER', 'NULL', 'CURRENT_DATE', 'CURRENT_TIMESTAMP'].includes(checkVal);
      const isSequence = checkVal.includes('NEXTVAL');
      const isQuoted = finalDefault.startsWith("'") && finalDefault.endsWith("'");

      if (!isNumber && !hasParentheses && !isKeyword && !isSequence && !isQuoted) {
        finalDefault = `'${finalDefault}'`;
      }
    }

    const isUserType = userTypes.includes(newType);
    const isNoLengthType = isUserType || ['DATE', 'TIMESTAMP', 'TIME', 'TEXT', 'BYTEA', 'INTEGER', 'SMALLINT', 'BIGINT', 'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'JSONB', 'UUID', 'REAL', 'DOUBLE PRECISION'].some(t => newType.toUpperCase().includes(t));
    let typeDef = newType;
    if (!isNoLengthType && newLength) { 
      typeDef += (newType.toUpperCase() === 'NUMERIC' || newType.toUpperCase() === 'DECIMAL') && newScale ? `(${newLength}, ${newScale})` : `(${newLength})`; 
    }

    const targetTable = `${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(tableName)}`;
    setIsLoading(true);

    try {
      if (mode === 'add') {
        const nullClause = newNullable === 'N' ? ' NOT NULL' : '';
        const defaultClause = finalDefault !== '' ? ` DEFAULT ${finalDefault}` : '';
        const addSql = `ALTER TABLE ${targetTable} ADD COLUMN "${newColName}" ${typeDef}${defaultClause}${nullClause}`;
        const addRes = await ipcRenderer.invoke('execute-sql', addSql);
        
        if (!addRes.success) throw new Error(t("column_addition_error") + addRes.error);
        if (newComment) {
          const commRes = await ipcRenderer.invoke('execute-sql', `COMMENT ON COLUMN ${targetTable}."${newColName}" IS '${newComment.replace(/'/g, "''")}'`);
          if (!commRes.success) throw new Error(t("comment_addition_error") + commRes.error);
        }
        alert(t("column_added"));
      } else {
        if (oldColName !== newColName) {
          const renameRes = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} RENAME COLUMN "${oldColName}" TO "${newColName}"`);
          if (!renameRes.success) throw new Error(t("column_rename_error") + renameRes.error);
        }
        
        const isTypeChanged = (oldType !== newType) || (oldLength !== newLength) || (oldScale !== newScale);
        const isDefaultChanged = (oldDefault !== finalDefault);
        const isNullChanged = (oldNullable !== newNullable);

        if (isTypeChanged) {
          const typeRes = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} ALTER COLUMN "${newColName}" TYPE ${typeDef} USING "${newColName}"::${newType}`);
          if (!typeRes.success) throw new Error(t("type_change_error") + typeRes.error);
        }
        
        if (isDefaultChanged) {
          const defSql = finalDefault !== '' ? `SET DEFAULT ${finalDefault}` : 'DROP DEFAULT';
          const defRes = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} ALTER COLUMN "${newColName}" ${defSql}`);
          if (!defRes.success) throw new Error(t("default_value_change_error") + defRes.error);
        }
        
        if (isNullChanged) {
          const nullSql = newNullable === 'Y' ? 'DROP NOT NULL' : 'SET NOT NULL';
          const nullRes = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${targetTable} ALTER COLUMN "${newColName}" ${nullSql}`);
          if (!nullRes.success) throw new Error(t("null_constraint_modification_error") + nullRes.error);
        }

        if (oldComment !== newComment) {
          const commRes = await ipcRenderer.invoke('execute-sql', `COMMENT ON COLUMN ${targetTable}."${newColName}" IS '${newComment.replace(/'/g, "''")}'`);
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
        const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : `${quoteIdentifier(tableName)}`;
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
        const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : `${quoteIdentifier(tableName)}`;
        const res = await ipcRenderer.invoke('execute-sql', `DROP TABLE ${targetTable} CASCADE`);
        if (res.success) {
          try {
            await runGitOperation(t, 'git-delete-object', { dbType: 'POSTGRES', schema: schema, objectType: 'TABLE', objectName: tableName });
          } catch { /* Auxiliary failures must not affect the main operation's result. */  }

          alert(t("table_dropped"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TABLE' } }));
          window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: schema, objectName: tableName, objectType: 'TABLE' } }));
        } else {
          alert(t("delete_error_3") + res.error);
        }
      } catch (e: unknown) { alert(getErrorMessage(e)); } finally { setIsLoading(false); }
    }
  };

  const handleOpenIndexWindow = () => { window.dispatchEvent(new CustomEvent('open-create-index-tab', { detail: { schema, tableName } })); };
  const handleOpenTriggerWindow = () => { window.dispatchEvent(new CustomEvent('open-create-trigger-tab', { detail: { schema, tableName } })); };

  const handleContextMenu = (e: React.MouseEvent, type: 'index' | 'trigger' | 'constraint', row: ObjectContextRow) => {
    e.preventDefault();
    setMenuState({
      mouseX: e.clientX, mouseY: e.clientY, type,
      name: (type === 'index' ? row.INDEX_NAME : type === 'trigger' ? row.TRIGGER_NAME : row.CONSTRAINT_NAME) ?? '',
      status: row.STATUS ?? '', isPrimary: type === 'index' ? row.IS_PRIMARY : false 
    });
  };

  const handleToggleEnable = async () => {
    if (!menuState) return;
    setIsLoading(true);
    try {
      let sql = '';
      const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : `${quoteIdentifier(tableName)}`;
      const safeName = menuState.name.trim(); 

      if (menuState.type === 'trigger') {
        const isEnabled = menuState.status === 'VALID';
        sql = `ALTER TABLE ${targetTable} ${isEnabled ? 'DISABLE' : 'ENABLE'} TRIGGER ${quoteIdentifier(safeName)}`;
      } 
      
      if (sql) {
        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          hasInitializedRef.current = false;
          if (setCachedStructure) setCachedStructure(null);
          setRefreshTrigger(prev => prev + 1);
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TRIGGER' } }));
        } else {
          alert(t("status_change_error_2") + res.error);
        }
      }
    } catch(e: unknown) { alert(getErrorMessage(e)); } finally { setIsLoading(false); setMenuState(null); }
  };

  const handleDeleteObject = async () => {
    if (!menuState) return;
    if (!window.confirm(t("opening_quote") + menuState.name + t("this_operation_cannot_be_undone_2"))) {
      setMenuState(null); return;
    }
    setIsLoading(true);
    try {
      let sql = '';
      const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : `${quoteIdentifier(tableName)}`;
      const safeName = menuState.name.trim(); 

      if (menuState.type === 'index') {
        sql = menuState.isPrimary ? `ALTER TABLE ${targetTable} DROP CONSTRAINT ${quoteIdentifier(safeName)}` : `DROP INDEX ${schema ? `${quoteIdentifier(schema)}.` : ''}${quoteIdentifier(safeName)}`;
      } else if (menuState.type === 'trigger') {
        sql = `DROP TRIGGER ${quoteIdentifier(safeName)} ON ${targetTable}`;
      } else if (menuState.type === 'constraint') {
        sql = `ALTER TABLE ${targetTable} DROP CONSTRAINT ${quoteIdentifier(safeName)}`;
      }
      
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        const objTypeForSidebar = menuState.type === 'index' ? 'INDEX' : menuState.type === 'trigger' ? 'TRIGGER' : '';
        if (objTypeForSidebar) {
          try { await runGitOperation(t, 'git-delete-object', { dbType: 'POSTGRES', schema: schema, objectType: objTypeForSidebar, objectName: safeName }); } catch { /* Auxiliary failures must not affect the main operation's result. */ }
        }
        alert(t("deleted"));
        hasInitializedRef.current = false;
        if (setCachedStructure) setCachedStructure(null);
        setRefreshTrigger(prev => prev + 1); 
        if (objTypeForSidebar) window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: objTypeForSidebar } }));
      } else {
        alert(t("delete_error_3") + res.error);
      }
    } finally { setIsLoading(false); setMenuState(null); }
  };

  return {
    t, isLoading, tableComment, setTableComment, structureRows, indexRows, triggerRows, constraintRows,
    structureHeight, setStructureHeight, isResizingStructure, setIsResizingStructure,
    sequences, userTypes, setRefreshTrigger, alterDialog, setAlterDialog, tableCommentDialog, setTableCommentDialog,
    menuState, setMenuState, DATA_TYPES,
    submitTableComment, handleOpenAddColumnDialog, handleOpenAlterDialog, submitAlterColumn, handleDropColumn, handleDropTable,
    handleOpenIndexWindow, handleOpenTriggerWindow, handleContextMenu, handleToggleEnable, handleDeleteObject
  };
};
