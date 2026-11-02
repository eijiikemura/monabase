// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier, qualifiedObjectName } from '@/shared/utils/objectIdentity';
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

  // Component-local initial mount lock.
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

  // Internal data for dialog choices.
  const [currentTableCols, setCurrentTableCols] = useState<string[]>([]);
  const [allTables, setAllTables] = useState<string[]>([]);
  const [targetTableCols, setTargetTableCols] = useState<string[]>([]);
  const targetRequest = useRef(0);
  useEffect(() => () => { targetRequest.current++; }, []);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  // Fetch only foreign keys required for the list.
  const fetchAllInitialData = useEventCallback(async () => {
    const startedAt = Date.now();
    const sqlFk = `
      SELECT fk.conname AS "CONSTRAINT_NAME", child_col.attname AS "SOURCE_COLUMN",
        parent.relname AS "TARGET_TABLE", parent_col.attname AS "TARGET_COLUMN",
        CASE fk.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
          WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS "DELETE_RULE"
      FROM pg_catalog.pg_constraint fk
      JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid
      JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
      JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid
      CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) AS key_position(ordinal)
      JOIN pg_catalog.pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = fk.conkey[key_position.ordinal]
      JOIN pg_catalog.pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = fk.confkey[key_position.ordinal]
      WHERE fk.contype = 'f' AND child.relname = :tableName AND child_ns.nspname = :schema
      ORDER BY fk.oid, key_position.ordinal
    `;
    const resFk = await ipcRenderer.invoke<{ CONSTRAINT_NAME: string; TARGET_TABLE: string; DELETE_RULE: string; SOURCE_COLUMN: string; TARGET_COLUMN: string }>('execute-sql-bg', sqlFk, { schema, tableName });
    if (!resFk.success) throw new Error(resFk.error);
    if (import.meta.env.DEV) console.debug('[Relations] List retrieval time (ms):', Date.now() - startedAt);

    // 1. Normalize relationship metadata.
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
    const sqlCols = `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = :tableName
        AND table_schema = :schema
      ORDER BY ordinal_position
    `;

    const sqlTables = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = :schema
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    const [resCols, resTables] = await Promise.all([
      ipcRenderer.invoke<{ column_name: string }>('execute-sql-bg', sqlCols, { schema, tableName }),
      ipcRenderer.invoke<{ table_name: string }>('execute-sql-bg', sqlTables, { schema })
    ]);
    if (!resCols.success || !resTables.success) {
      throw new Error(resCols.error || resTables.error);
    }
    setCurrentTableCols((resCols.rows || []).map((row: { column_name: string }) => row.column_name));
    setAllTables((resTables.rows || []).map((row: { table_name: string }) => row.table_name));
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
      const sqlCols = `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = :tableName
          AND table_schema = :schema
        ORDER BY ordinal_position
      `;
      const resCols = await ipcRenderer.invoke<{ column_name: string }>('execute-sql-bg', sqlCols, { schema, tableName: selectedTable });
      if (request !== targetRequest.current) return;
      if (!resCols.success) throw new Error(resCols.error);
      setTargetTableCols(resCols.rows.map(row => row.column_name));
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

      setIsLoading(true);
      void fetchAllInitialData().then(data => {
        setRelationsRows(data.relations);
        if (setCachedRelations) setCachedRelations(data);
        setIsLoaded(true);
      }).catch((error: unknown) => {
        hasInitializedRef.current = false;
        alert(t("failed_to_retrieve_relationship_information") + '\n' + getErrorMessage(error));
      }).finally(() => setIsLoading(false));
    }
  }, [isActive, tableName, isLoaded, cachedRelations, fetchAllInitialData, setCachedRelations, t]);

  // Clear the cache only on table updates or reload notifications.
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

  // Fetch choices after the dialog opens.
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

  // Add the relationship.
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
        // Invalidate and reload the cache only after successful addition.
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

  // Delete the relationship.
  const handleDropRelation = async (constraintName: string) => {
    if (window.confirm(t("foreign_key") + constraintName + t("this_operation_cannot_be_undone_2"))) {
      setIsLoading(true);
      try {
        const res = await ipcRenderer.invoke('execute-sql', `ALTER TABLE ${qualifiedObjectName({ schema, objectName: tableName })} DROP CONSTRAINT ${quoteIdentifier(constraintName)}`);
        if (res.success) {
          alert(t("foreign_key_dropped"));
          // Invalidate and reload the cache only after successful deletion.
          hasInitializedRef.current = false;
          if (setCachedRelations) setCachedRelations(null);
          setIsLoaded(false);
          window.dispatchEvent(new CustomEvent('reload-source', { detail: { schema, tableName } }));
        } else {
          alert(t("delete_error_3") + res.error);
        }
      } finally {
        setIsLoading(false);
      }
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
