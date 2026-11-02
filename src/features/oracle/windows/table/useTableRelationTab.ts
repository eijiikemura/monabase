// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { TableRelationCache, RelationDefinition } from "@/shared/types/databaseTypes";

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { ipcRenderer } from '@/shared/api/desktop';

export interface TableRelationTabProps { 
  schema: string; 
  tableName: string; 
  isActive: boolean; 
  cachedRelations?: TableRelationCache | null;
  setCachedRelations?: (data: TableRelationCache | null) => void;
}

export const useTableRelationTab = (props: TableRelationTabProps) => {
  const { schema, tableName, isActive, cachedRelations, setCachedRelations } = props;
  const { t } = useTranslation();

  // Local lock reset automatically when the component unmounts.
  const hasInitializedRef = useRef<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isDialogLoading, setIsDialogLoading] = useState<boolean>(false);
  const [relationsRows, setRelationsRows] = useState<RelationDefinition[]>([]);
  
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  const [fkName, setFkName] = useState<string>('');
  const [sourceColumns, setSourceColumns] = useState<string[]>([]);
  const [targetTable, setTargetTable] = useState<string>('');
  const [targetColumns, setTargetColumns] = useState<string[]>([]);
  const [deleteRule, setDeleteRule] = useState<string>('NO ACTION');

  const [currentTableCols, setCurrentTableCols] = useState<string[]>([]);
  const [allTables, setAllTables] = useState<string[]>([]);
  const [targetTableCols, setTargetTableCols] = useState<string[]>([]);
  const targetRequest = useRef(0);
  useEffect(() => () => { targetRequest.current++; }, []);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  const fetchAllInitialData = useEventCallback(async () => {
    const startedAt = Date.now();
    const sqlFk = `
      SELECT
        c.CONSTRAINT_NAME,
        cc.COLUMN_NAME AS SOURCE_COLUMN,
        r.TABLE_NAME AS TARGET_TABLE,
        rc.COLUMN_NAME AS TARGET_COLUMN,
        c.DELETE_RULE
      FROM ALL_CONSTRAINTS c
      JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER
      JOIN ALL_CONSTRAINTS r ON c.R_CONSTRAINT_NAME = r.CONSTRAINT_NAME AND c.R_OWNER = r.OWNER
      JOIN ALL_CONS_COLUMNS rc ON r.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND r.OWNER = rc.OWNER AND cc.POSITION = rc.POSITION
      WHERE c.CONSTRAINT_TYPE = 'R'
        AND c.TABLE_NAME = :tableName
        ${schema ? `AND c.OWNER = :schema` : ''}
      ORDER BY c.CONSTRAINT_NAME, cc.POSITION
    `;

    const resFk = await ipcRenderer.invoke<{ CONSTRAINT_NAME: string; TARGET_TABLE: string; DELETE_RULE: string; SOURCE_COLUMN: string; TARGET_COLUMN: string }>('execute-sql-bg', sqlFk, { tableName, ...(schema ? { schema } : {}) });
    if (!resFk.success) throw new Error(resFk.error);
    if (import.meta.env.DEV) console.debug('[Relations] List retrieval time (ms):', Date.now() - startedAt);

    let formattedRelations: RelationDefinition[] = [];
    if (resFk.success && resFk.rows) {
      const fkMap = new Map<string, Omit<RelationDefinition, 'SOURCE_COLUMNS' | 'TARGET_COLUMNS'>>();
      resFk.rows.forEach((r: { CONSTRAINT_NAME: string; TARGET_TABLE: string; DELETE_RULE: string; SOURCE_COLUMN: string; TARGET_COLUMN: string }) => {
        if (!fkMap.has(r.CONSTRAINT_NAME)) {
          fkMap.set(r.CONSTRAINT_NAME, {
            id: r.CONSTRAINT_NAME,
            CONSTRAINT_NAME: r.CONSTRAINT_NAME,
            TARGET_TABLE: r.TARGET_TABLE,
            DELETE_RULE: r.DELETE_RULE || 'NO ACTION',
            SOURCE_COLS: [],
            TARGET_COLS: []
          });
        }
        const relation = fkMap.get(r.CONSTRAINT_NAME)!;
        relation.SOURCE_COLS.push(r.SOURCE_COLUMN);
        relation.TARGET_COLS.push(r.TARGET_COLUMN);
      });

      formattedRelations = Array.from(fkMap.values()).map((f) => ({
        ...f,
        SOURCE_COLUMNS: f.SOURCE_COLS.join(', '),
        TARGET_COLUMNS: f.TARGET_COLS.join(', ')
      }));
    }

    return {
      relations: formattedRelations,
      currentTableCols: [],
      allTables: []
    };
  });

  // Fetch additional dialog data when the dialog opens.
  const loadDialogData = async () => {
    const sqlCols = `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = :tableName ${schema ? `AND OWNER = :schema` : ''} ORDER BY COLUMN_ID`;
    const sqlTables = `SELECT TABLE_NAME FROM ALL_TABLES ${schema ? `WHERE OWNER = :schema` : ''} ORDER BY TABLE_NAME`;

    const [resCols, resTables] = await Promise.all([
      ipcRenderer.invoke<{ COLUMN_NAME: string }>('execute-sql-bg', sqlCols, { tableName, ...(schema ? { schema } : {}) }),
      ipcRenderer.invoke<{ TABLE_NAME: string }>('execute-sql-bg', sqlTables, schema ? { schema } : {})
    ]);
    if (!resCols.success || !resTables.success) {
      throw new Error(resCols.error || resTables.error);
    }
    setCurrentTableCols((resCols.rows || []).map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME));
    setAllTables((resTables.rows || []).map((row: { TABLE_NAME: string }) => row.TABLE_NAME));
  };

  const handleTargetTableChange = async (selectedTable: string) => {
    const request = ++targetRequest.current;
    setTargetTable(selectedTable);
    setTargetColumns([]);
    setTargetTableCols([]);
    if (!selectedTable) {
      setIsDialogLoading(false);
      return;
    }
    
    setIsDialogLoading(true);
    try {
      const sqlCols = `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE TABLE_NAME = :tableName ${schema ? `AND OWNER = :schema` : ''} ORDER BY COLUMN_ID`;
      const resCols = await ipcRenderer.invoke<{ COLUMN_NAME: string }>('execute-sql-bg', sqlCols, { tableName: selectedTable, ...(schema ? { schema } : {}) });
      if (request !== targetRequest.current) return;
      if (!resCols.success) throw new Error(resCols.error);
      setTargetTableCols(resCols.rows.map(row => row.COLUMN_NAME));
    } catch (error: unknown) {
      if (request === targetRequest.current) alert(t("failed_to_retrieve_information_for_adding_a_relationship") + '\n' + getErrorMessage(error));
    } finally {
      if (request === targetRequest.current) setIsDialogLoading(false);
    }
  };

  useEffect(() => {
    if (isActive && tableName && !hasInitializedRef.current) {
      if (cachedRelations) {
        setRelationsRows(cachedRelations.relations || []);
        setCurrentTableCols(cachedRelations.currentTableCols || []);
        setAllTables(cachedRelations.allTables || []);
        setIsLoaded(true);
        hasInitializedRef.current = true;
        return;
      }

      hasInitializedRef.current = true;

      const runInit = async () => {
        setIsLoading(true);
        try {
          const data = await fetchAllInitialData();
          setRelationsRows(data.relations);
          setCurrentTableCols(data.currentTableCols);
          setAllTables(data.allTables);
          if (setCachedRelations) setCachedRelations(data);
          setIsLoaded(true);
        } catch (error: unknown) {
          hasInitializedRef.current = false;
          alert(t("failed_to_retrieve_relationship_information") + '\n' + getErrorMessage(error));
        } finally {
          setIsLoading(false);
        }
      };

      runInit();
    }
  }, [isActive, tableName, isLoaded, cachedRelations, fetchAllInitialData, setCachedRelations, t]);

  useEffect(() => {
    const handleReloadSource = (e: WindowEventMap['reload-source']) => {
      const targetTable = e.detail;
      if (targetTable?.schema === schema && targetTable.tableName === tableName) {
        hasInitializedRef.current = false;
        if (setCachedRelations) setCachedRelations(null);
        setIsLoaded(false);
      }
    };
    window.addEventListener('reload-source', handleReloadSource);
    return () => window.removeEventListener('reload-source', handleReloadSource);
  }, [tableName, schema, setCachedRelations]);

  const handleOpenAddDialog = async () => {
    targetRequest.current++;
    setFkName('');
    setSourceColumns([]);
    setTargetTable('');
    setTargetColumns([]);
    setTargetTableCols([]);
    setDeleteRule('NO ACTION');
    setDialogOpen(true);
    setCurrentTableCols([]);
    setAllTables([]);
    setIsDialogLoading(true);
    try {
      await loadDialogData();
    } catch (error: unknown) {
      setDialogOpen(false);
      alert(t("failed_to_retrieve_information_for_adding_a_relationship") + '\n' + getErrorMessage(error));
    } finally {
      setIsDialogLoading(false);
    }
  };

  const submitRelation = async () => {
    if (isDialogLoading) return;
    if (sourceColumns.length === 0) { alert(t("please_select_your_table_columns")); return; }
    if (!targetTable) { alert(t("please_select_referenced_table")); return; }
    if (targetColumns.length === 0) { alert(t("please_select_referenced_columns")); return; }
    if (sourceColumns.length !== targetColumns.length) { alert(t("must_select_the_same_number_of_columns_for_both_own_and_referenced")); return; }

    setIsDialogLoading(true);
    try {
      const currentFullTable = qualifiedObjectName({ schema, objectName: tableName });
      const targetFullTable = qualifiedObjectName({ schema, objectName: targetTable });
      
      let sqlText = `ALTER TABLE ${currentFullTable} ADD `;
      if (fkName.trim()) sqlText += `CONSTRAINT ${quoteIdentifier(fkName.trim())} `;
      
      sqlText += `FOREIGN KEY (${sourceColumns.map(quoteIdentifier).join(', ')}) REFERENCES ${targetFullTable} (${targetColumns.map(quoteIdentifier).join(', ')})`;
      if (deleteRule !== 'NO ACTION') sqlText += ` ON DELETE ${deleteRule}`;

      const res = await ipcRenderer.invoke('execute-sql', sqlText);
      if (res.success) {
        alert(t("relation_foreign_key_added"));
        setDialogOpen(false);
        hasInitializedRef.current = false;
        if (setCachedRelations) setCachedRelations(null);
        setIsLoaded(false);
        window.dispatchEvent(new CustomEvent('reload-source', { detail: { schema, tableName } }));
      } else {
        alert(t("addition_error") + res.error);
      }
    } finally {
      setIsDialogLoading(false);
    }
  };

  const handleDropRelation = async (constraintName: string) => {
    if (window.confirm(t("foreign_key") + constraintName + t("this_operation_cannot_be_undone_2"))) {
      setIsLoading(true);
      try {
        const res = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${qualifiedObjectName({ schema, objectName: tableName })} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`);
        if (res.success) { 
          alert(t("foreign_key_dropped"));
          hasInitializedRef.current = false;
          if (setCachedRelations) setCachedRelations(null);
          setIsLoaded(false);
          window.dispatchEvent(new CustomEvent('reload-source', { detail: { schema, tableName } }));
        } else { 
          alert(t("delete_error_3") + res.error);
        }
      } finally { setIsLoading(false); }
    }
  };

  return {
    t, isLoading, isDialogLoading, relationsRows, dialogOpen, setDialogOpen,
    fkName, setFkName, sourceColumns, setSourceColumns,
    targetTable, setTargetTable, targetColumns, setTargetColumns,
    deleteRule, setDeleteRule, currentTableCols, allTables, targetTableCols,
    handleTargetTableChange, handleOpenAddDialog, submitRelation, handleDropRelation
  };
};
