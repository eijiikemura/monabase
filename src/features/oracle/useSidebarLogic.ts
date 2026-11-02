// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { sidebarObjectKey } from '@/features/objects/sidebarNavigation';
import { runGitOperation } from '@/features/git/gitOperation';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { createSidebarDataTransfer } from './sidebarDataTransfer';
import { useSidebarObjects } from './useSidebarObjects';
import type { CompileError } from "../stored/storedCommon";
import type { ColumnDefinition } from "@/shared/types/databaseTypes";
import type { GridColDef } from '@mui/x-data-grid';
import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

export interface ContextMenuState { 
  mouseX: number; mouseY: number; type: 'table' | 'column' | 'recyclebin' | 'schema' | 'recyclebin_category'; value: string; 
  schema?: string; objType?: string; tableKey?: string; objectName?: string;
  status?: string; tableName?: string; 
}

interface UseSidebarLogicProps {
  schemas: string[];
  expandedSchemas: string[];
  onAddTab: (type: 'sql' | 'table' | 'create-table' | 'view' | 'sequence' | 'create-sequence' | 'stored' | 'create-stored' | 'package' | 'create-package' | 'trigger' | 'create-trigger' | 'dblink' | 'create-dblink' | 'synonym' | 'create-synonym' | 'mview' | 'create-mview' | 'mview-log' | 'create-mview-log' | 'index' | 'create-index' | 'constraint' | 'create-constraint' | 'type', name?: string, initialSql?: string) => void;
  outputDateFormat: string;
}

export function useSidebarLogic({ schemas, expandedSchemas, onAddTab, outputDateFormat }: UseSidebarLogicProps) {
  const { t } = useTranslation();

  const OBJECT_TYPES = [
    'TABLE',
    'INDEX',
    'TRIGGER',
    'VIEW',
    'PROCEDURE',
    'FUNCTION',
    'PACKAGE',
    'TYPE',
    'SEQUENCE',
    'SYNONYM',
    'MATERIALIZED VIEW',
    'MATERIALIZED VIEW LOG',
    'DATABASE LINK'
  ];

  const [expandedRecycleBins, setExpandedRecycleBins] = useState<string[]>([]);
  const [loadedRecycleBins, setLoadedRecycleBins] = useState<{ [key: string]: { originalName: string, objectName: string }[] }>({});

  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const selectObject = (schema: string, type: string, name: string, signature = '', tableName = '') => {
    setSelectedObject(sidebarObjectKey(schema, type, name, signature, tableName));
    setSelectedTable(name);
  };
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<ContextMenuState | null>(null);

  const [dialogState, setDialogState] = useState<{ 
    isOpen: boolean; mode: 'rename' | 'copy' | 'analyze'; targetName: string; newName: string; schema: string; objType: string 
  }>({ isOpen: false, mode: 'rename', targetName: '', newName: '', schema: '', objType: '' });

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [exportTarget, setExportTarget] = useState<{ schema: string, tableName: string, columns: GridColDef[], totalCount: number, structureDefs?: ColumnDefinition[] } | null>(null);
  const exportContainerRef = useRef<HTMLDivElement>(null);

  const [importTarget, setImportTarget] = useState<{ schema: string, tableName: string, structureDefs: ColumnDefinition[] } | null>(null);
  const importContainerRef = useRef<HTMLDivElement>(null);

  const {
    categoryErrors, retryCategory, expandedTypes, setExpandedTypes, loadedObjects, packageBodies, invalidObjects, objectFilters, loadingCategories, setLoadingCategories, disabledTriggers, indexStatuses, mviewRefreshDates, fetchMViewRefreshDates, toggleType, refreshObjects, handleRefreshObjects, handleFilterChange, loadMore, hasMore
  } = useSidebarObjects(outputDateFormat);

  const toggleRecycleBin = async (schema: string) => {
    if (expandedRecycleBins.includes(schema)) {
      setExpandedRecycleBins(prev => prev.filter(s => s !== schema));
      return;
    }
    setExpandedRecycleBins(prev => [...prev, schema]);

    if (!loadedRecycleBins[schema]) {
      setLoadingCategories(prev => [...prev, `${schema}.RECYCLEBIN`]);
      try {
        let sql = `SELECT OBJECT_NAME, ORIGINAL_NAME FROM DBA_RECYCLEBIN WHERE OWNER = UPPER('${schema}') AND TYPE = 'TABLE' ORDER BY DROPTIME DESC`;
        let res = await ipcRenderer.invoke<{ OBJECT_NAME: string; ORIGINAL_NAME: string }>('execute-sql-bg', sql);
        if (!res.success) {
           sql = `SELECT OBJECT_NAME, ORIGINAL_NAME FROM USER_RECYCLEBIN WHERE TYPE = 'TABLE' ORDER BY DROPTIME DESC`;
           res = await ipcRenderer.invoke<{ OBJECT_NAME: string; ORIGINAL_NAME: string }>('execute-sql-bg', sql);
        }
        if (res.success && res.rows) {
          setLoadedRecycleBins(prev => ({ 
            ...prev, 
            [schema]: res.rows.map((r: { OBJECT_NAME: string; ORIGINAL_NAME: string }) => ({ objectName: r.OBJECT_NAME, originalName: r.ORIGINAL_NAME }))
          }));
        } else {
          setLoadedRecycleBins(prev => ({ ...prev, [schema]: [] }));
        }
      } finally {
        setLoadingCategories(prev => prev.filter(k => k !== `${schema}.RECYCLEBIN`));
      }
    }
  };

  const refreshRecycleBin = async (schema: string) => {
    setLoadingCategories(prev => [...prev, `${schema}.RECYCLEBIN`]);
    try {
      let sql = `SELECT OBJECT_NAME, ORIGINAL_NAME FROM DBA_RECYCLEBIN WHERE OWNER = UPPER('${schema}') AND TYPE = 'TABLE' ORDER BY DROPTIME DESC`;
      let res = await ipcRenderer.invoke<{ OBJECT_NAME: string; ORIGINAL_NAME: string }>('execute-sql-bg', sql);
      if (!res.success) {
         sql = `SELECT OBJECT_NAME, ORIGINAL_NAME FROM USER_RECYCLEBIN WHERE TYPE = 'TABLE' ORDER BY DROPTIME DESC`;
         res = await ipcRenderer.invoke<{ OBJECT_NAME: string; ORIGINAL_NAME: string }>('execute-sql-bg', sql);
      }
      if (res.success && res.rows) {
        setLoadedRecycleBins(prev => ({ 
          ...prev, 
          [schema]: res.rows.map((r: { OBJECT_NAME: string; ORIGINAL_NAME: string }) => ({ objectName: r.OBJECT_NAME, originalName: r.ORIGINAL_NAME }))
        }));
      } else {
        setLoadedRecycleBins(prev => ({ ...prev, [schema]: [] }));
      }
    } finally {
      setLoadingCategories(prev => prev.filter(k => k !== `${schema}.RECYCLEBIN`));
    }
  };

  const handleSidebarContextMenu = (e: React.MouseEvent, type: 'table' | 'column' | 'recyclebin' | 'schema' | 'recyclebin_category', value: string, schema?: string, objType?: string, tableKey?: string, objectName?: string, status?: string, tableName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (type === 'table') {
      selectObject(schema || '', objType || '', value, '', tableName || '');
    }
    setSidebarContextMenu({ mouseX: e.clientX, mouseY: e.clientY, type, value, schema, objType, tableKey, objectName, status, tableName });
  };

  const closeSidebarContextMenu = () => {
    setSidebarContextMenu(null);
  };

  const handleEmptyRecycleBinClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema } = sidebarContextMenu;
    setSidebarContextMenu(null);
    
    if (window.confirm(t("purge_all_objects_in_the_recycle_bin_for_this_operation_cannot_be_undone", { schema }))) {
      setIsLoading(true);
      try {
        let sql = `SELECT OBJECT_NAME, ORIGINAL_NAME FROM DBA_RECYCLEBIN WHERE OWNER = UPPER('${schema}') AND TYPE = 'TABLE' ORDER BY DROPTIME DESC`;
        let res = await ipcRenderer.invoke('execute-sql', sql);
        if (!res.success) {
           sql = `SELECT OBJECT_NAME, ORIGINAL_NAME FROM USER_RECYCLEBIN WHERE TYPE = 'TABLE' ORDER BY DROPTIME DESC`;
           res = await ipcRenderer.invoke('execute-sql', sql);
        }

        const binItems = (res.success && res.rows) ? res.rows : [];
        if (binItems.length === 0) {
           alert(t("recycle_bin_is_empty"));
           setIsLoading(false);
           return;
        }

        let errorCount = 0;
        let lastError = '';

        for (const item of binItems) {
            const purgeSql = `PURGE TABLE "${schema}"."${item.OBJECT_NAME}"`;
            const purgeRes = await ipcRenderer.invoke('execute-sql', purgeSql);
            if (!purgeRes.success) {
                errorCount++;
                lastError = purgeRes.error;
            }
        }

        if (errorCount > 0) {
            alert(t("failed_to_drop_some_objects", { errorCount: errorCount, error: lastError }));
        } else {
            alert(t("recycle_bin_emptied"));
        }
        await refreshRecycleBin(schema!);
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleRestoreClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value, objectName } = sidebarContextMenu;
    setSidebarContextMenu(null);
    
    if (window.confirm(t("restore_table_from_recycle_bin", { name: value }))) {
      setIsLoading(true);
      try {
        const sql = `FLASHBACK TABLE "${schema}"."${objectName}" TO BEFORE DROP`;
        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          alert(t("restored", { name: value }));
          await refreshRecycleBin(schema!);
          await refreshObjects(schema!, 'TABLE'); 
        } else {
          alert(t("restore_error", { error: res.error }));
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handlePurgeClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value, objectName } = sidebarContextMenu;
    setSidebarContextMenu(null);
    
    if (window.confirm(t("purge_table_this_operation_cannot_be_undone", { name: value }))) {
      setIsLoading(true);
      try {
        const sql = `PURGE TABLE "${schema}"."${objectName}"`;
        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          alert(t("purged_completely_2"));
          await refreshRecycleBin(schema!);
        } else {
          alert(t("delete_error_4", { error: res.error }));
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleToggleTriggerEnable = async (enable: boolean) => {
    if (!sidebarContextMenu) return;
    const { schema, value } = sidebarContextMenu;
    setSidebarContextMenu(null);
    
    setIsLoading(true);
    try {
      const sql = enable ? `ALTER TRIGGER ${schema}.${value} ENABLE` : `ALTER TRIGGER ${schema}.${value} DISABLE`;
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        alert(enable ? t("trigger_enabled") : t("trigger_disabled"));
        await refreshObjects(schema!, 'TRIGGER');
      } else {
        alert(t("error_2", { error: res.error }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleIndexVisibilityClick = async (visible: boolean) => {
    if (!sidebarContextMenu) return;
    const { schema, value } = sidebarContextMenu;
    setSidebarContextMenu(null);

    setIsLoading(true);
    try {
      const sql = visible ? `ALTER INDEX "${schema}"."${value}" VISIBLE` : `ALTER INDEX "${schema}"."${value}" INVISIBLE`;
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        alert(visible ? t("index_made_visible_enabled") : t("index_made_invisible_disabled"));
        await refreshObjects(schema!, 'INDEX');
      } else {
        alert(t("error_2", { error: res.error }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRebuildIndexClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value } = sidebarContextMenu;
    setSidebarContextMenu(null);

    setIsLoading(true);
    try {
      const sql = `ALTER INDEX "${schema}"."${value}" REBUILD`;
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        alert(t("index_rebuilt", { name: value }));
        await refreshObjects(schema!, 'INDEX');
      } else {
        alert(t("rebuild_error", { error: res.error }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefreshMViewClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value } = sidebarContextMenu;
    setSidebarContextMenu(null);

    setIsLoading(true);
    try {
      const sql = `BEGIN DBMS_MVIEW.REFRESH('"${schema}"."${value}"'); END;`;
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        alert(t("materialized_view_updated"));
        await fetchMViewRefreshDates(schema!);
      } else {
        alert(t("update_error_3", { error: res.error }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const openObjectTab = (schema: string, value: string, objType: string) => {
    if (objType === 'TABLE' || objType === 'VIEW' || objType === 'SEQUENCE') {
      const tabType = objType === 'VIEW' ? 'view' : objType === 'SEQUENCE' ? 'sequence' : 'table';
      onAddTab(tabType as Parameters<typeof onAddTab>[0], qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'FUNCTION' || objType === 'PROCEDURE') {
      onAddTab('stored', qualifiedObjectName({ schema: schema ?? '', objectName: value }), objType);
    } else if (objType === 'PACKAGE' || objType === 'PACKAGE BODY') {
      onAddTab('package', qualifiedObjectName({ schema: schema ?? '', objectName: value }), objType);
    } else if (objType === 'TRIGGER') {
      onAddTab('trigger', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'DATABASE LINK') {
      onAddTab('dblink', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'SYNONYM') {
      onAddTab('synonym', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'MATERIALIZED VIEW') {
      onAddTab('mview', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'MATERIALIZED VIEW LOG') {
      onAddTab('mview-log', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'INDEX') {
      onAddTab('index', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    } else if (objType === 'TYPE') {
      onAddTab('type', qualifiedObjectName({ schema: schema ?? '', objectName: value }));
    }
  };

  const handleCompileClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value, objType } = sidebarContextMenu;
    setSidebarContextMenu(null);

    setIsLoading(true);
    try {
      let sql = '';
      if (objType === 'PACKAGE BODY') {
        sql = `ALTER PACKAGE "${schema}"."${value}" COMPILE BODY`;
      } else {
        sql = `ALTER ${objType} "${schema}"."${value}" COMPILE`;
      }

      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        const statusSql = `SELECT STATUS FROM ALL_OBJECTS WHERE OWNER = UPPER('${schema}') AND OBJECT_NAME = UPPER('${value}') AND OBJECT_TYPE = '${objType}'`;
        const statusRes = await ipcRenderer.invoke('execute-sql-bg', statusSql);
        
        let isStillInvalid = false;
        if (statusRes.success && statusRes.rows && statusRes.rows.length > 0) {
          if (statusRes.rows[0].STATUS === 'INVALID') {
            isStillInvalid = true;
          }
        }

        if (isStillInvalid) {
          const errSql = `SELECT LINE, POSITION, TEXT FROM ALL_ERRORS WHERE OWNER = UPPER('${schema}') AND NAME = UPPER('${value}') AND TYPE = '${objType}' ORDER BY SEQUENCE`;
          const errRes = await ipcRenderer.invoke<({ LINE: number; POSITION: number; TEXT: string }) & ({ LINE: number; TEXT: string })>('execute-sql-bg', errSql);
          
          let parsedErrors: CompileError[] = [];
          let errorLogs: string[] = [];
          
          if (errRes.success && errRes.rows && errRes.rows.length > 0) {
            parsedErrors = errRes.rows.map((r: { LINE: number; POSITION: number; TEXT: string }) => ({ line: r.LINE, col: r.POSITION || 1, text: r.TEXT }));
            errorLogs = [t("compilation_error"), ...errRes.rows.map((r: { LINE: number; TEXT: string }) => `[ERROR] Line ${r.LINE}: ${r.TEXT}`)];
          } else {
            errorLogs = [t("compilation_error"), t("an_unknown_error_occurred")];
          }

          alert(t("compiled_program_remains_invalid", { name: value }));
          
          openObjectTab(schema!, value, objType!);

          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('sidebar-compile-error', {
              detail: { schema, objectName: value, objectType: objType, errors: parsedErrors, logs: errorLogs }
            }));
          }, 800);

        } else {
          alert(t("compiled_successfully", { name: value }));
        }
        
        await refreshObjects(schema!, objType === 'PACKAGE BODY' ? 'PACKAGE' : objType!);
      } else {
        alert(t("compilation_error_2", { error: res.error }));
      }
    } catch (e: unknown) {
      alert(t("compilation_error_2", { error: getErrorMessage(e) }));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenTableWindow = () => {
    if (!sidebarContextMenu) return;
    const { schema, value, objType } = sidebarContextMenu;
    openObjectTab(schema!, value, objType!);
    setSidebarContextMenu(null);
  };

  const handleOpenSqlWindow = () => {
    if (!sidebarContextMenu) return;
    const { schema, value, objType } = sidebarContextMenu;
    const fullName = qualifiedObjectName({ schema: schema ?? '', objectName: value });
    let initialSql = `SELECT * FROM ${fullName};`;
    if (objType === 'SEQUENCE') {
      initialSql = `SELECT ${fullName}.NEXTVAL FROM DUAL;`;
    }
    onAddTab('sql', undefined, initialSql);
    setSidebarContextMenu(null);
  };

  const handleCopyToClipboard = () => {
    if (!sidebarContextMenu) return;
    
    let textToCopy = '';
    if (sidebarContextMenu.type === 'table') {
      textToCopy = sidebarContextMenu.value;
    }

    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
    }
    setSidebarContextMenu(null);
  };

  const handleRenameClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'rename', targetName: sidebarContextMenu.value, newName: sidebarContextMenu.value, schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const handleCopyClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'copy', targetName: sidebarContextMenu.value, newName: `${sidebarContextMenu.value}_COPY`, schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const handleAnalyzeClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'analyze', targetName: sidebarContextMenu.value, newName: '10', schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const { handleExportClick, fetchExportDataChunk, handleImportClick, processSidebarBulkInsertData } = createSidebarDataTransfer({ sidebarContextMenu, setSidebarContextMenu, exportTarget, setExportTarget, importTarget, setImportTarget, exportContainerRef, importContainerRef, setIsLoading, outputDateFormat, t });

  const handleDeleteClick = async () => {
    if (!sidebarContextMenu) return;
    const { value: target, schema, objType } = sidebarContextMenu;
    setSidebarContextMenu(null);

    let objNameJp = t("object");
    if (objType === 'TABLE') objNameJp = t("table_2");
    if (objType === 'VIEW') objNameJp = t("view_2");
    if (objType === 'SEQUENCE') objNameJp = t("sequence_3");
    if (objType === 'FUNCTION') objNameJp = t("function_2");
    if (objType === 'PROCEDURE') objNameJp = t("procedure_2");
    if (objType === 'PACKAGE' || objType === 'PACKAGE BODY') objNameJp = t("package");
    if (objType === 'TRIGGER') objNameJp = t("trigger_2");
    if (objType === 'DATABASE LINK') objNameJp = t("database_link");
    if (objType === 'SYNONYM') objNameJp = t("synonym_2");
    if (objType === 'MATERIALIZED VIEW') objNameJp = t("materialized_view_2");
    if (objType === 'MATERIALIZED VIEW LOG') objNameJp = t("mview_log_2");
    if (objType === 'INDEX') objNameJp = t("index_2");
    if (objType === 'TYPE') objNameJp = t("type_2");

    if (window.confirm(t("delete_this_operation_cannot_be_undone", { type: objNameJp, name: target }))) {
      setIsLoading(true);
      try {
        let sql = '';
        if (objType === 'TABLE') sql = `DROP TABLE "${schema}"."${target}"`;
        else if (objType === 'PACKAGE BODY') sql = `DROP PACKAGE BODY "${schema}"."${target}"`;
        else if (objType === 'DATABASE LINK') {
          const publicKeyword = schema?.toUpperCase() === 'PUBLIC' ? 'PUBLIC ' : '';
          sql = `DROP ${publicKeyword}DATABASE LINK "${target}"`;
        }
        else if (objType === 'SYNONYM') {
          const publicKeyword = schema?.toUpperCase() === 'PUBLIC' ? 'PUBLIC ' : '';
          sql = `DROP ${publicKeyword}SYNONYM "${target}"`;
        }
        else if (objType === 'MATERIALIZED VIEW') {
          sql = `DROP MATERIALIZED VIEW "${schema}"."${target}"`;
        }
        else if (objType === 'MATERIALIZED VIEW LOG') {
          sql = `DROP MATERIALIZED VIEW LOG ON "${schema}"."${target}"`;
        }
        else if (objType === 'INDEX') {
          sql = `DROP INDEX "${schema}"."${target}"`;
        }
        else if (objType === 'TYPE') {
          sql = `DROP TYPE "${schema}"."${target}"`;
        }
        else sql = `DROP ${objType} "${schema}"."${target}"`;

        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'ORACLE',
              schema: schema || '',
              objectType: objType || '',
              objectName: target
            });
          } catch (e) {
            console.error("Failed to delete the object from Git.", e);
          }

          alert(t("deleted"));
          await refreshObjects(schema!, objType === 'PACKAGE BODY' ? 'PACKAGE' : objType!); 
          
          if (objType === 'TABLE' && expandedRecycleBins.includes(schema!)) {
            refreshRecycleBin(schema!);
          }

          window.dispatchEvent(new CustomEvent('object-deleted', { 
            detail: { schema: schema!, objectName: target, objectType: objType! } 
          }));
        } else {
          alert(t("delete_error_4", { error: res.error }));
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleTruncateClick = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value: targetName, objType } = sidebarContextMenu;
    setSidebarContextMenu(null);

    if (objType !== 'TABLE') return;

    if (window.confirm(t("confirm_truncate_table_data", { name: targetName }))) {
      setIsLoading(true);
      try {
        const sql = `TRUNCATE TABLE "${schema}"."${targetName}"`;
        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          alert(t("table_truncated", { name: targetName }));
          window.dispatchEvent(new CustomEvent('reload-statistics', { detail: { schema, tableName: targetName } }));
        } else {
          alert(t("initialization_error", { error: res.error }));
        }
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleDialogSubmit = async () => {
    const { mode, targetName, newName, schema, objType } = dialogState;

    if (mode === 'analyze') {
      const percent = parseInt(newName, 10);
      if (isNaN(percent) || percent <= 0 || percent > 100) { alert(t("please_enter_a_half_width_number_from_1_to_100")); return; }
      
      setIsLoading(true);
      try {
        const sql = `ANALYZE TABLE ${schema}.${targetName} ESTIMATE STATISTICS SAMPLE ${percent} PERCENT`;
        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          alert(t("statistics_gathered"));
          setDialogState({ ...dialogState, isOpen: false });
          window.dispatchEvent(new CustomEvent('reload-statistics', { detail: { schema, tableName: targetName } }));
        } else {
          alert(t("an_error_occurred_2", { error: res.error }));
        }
      } finally {
        setIsLoading(false);
      }
      return;
    }

    if (!newName) { alert(mode === 'rename' ? t("please_enter_a_new_table_name") : t("please_enter_target_table_name")); return; }

    setIsLoading(true);
    try {
      const sql = mode === 'rename' 
        ? `ALTER TABLE "${schema}"."${targetName}" RENAME TO "${newName}"`
        : `CREATE TABLE "${schema}"."${newName}" AS SELECT * FROM "${schema}"."${targetName}"`;

      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        if (mode === 'rename') {
          try {
            await runGitOperation(t, 'git-rename-object', {
              dbType: 'ORACLE',
              schema: schema || '',
              objectType: objType || '',
              oldName: targetName,
              newName: newName
            });
          } catch (e) {
            console.error("Failed to rename the object in Git.", e);
          }
        }

        alert(mode === 'rename' ? t("renamed") : t("copy_created"));
        setDialogState({ ...dialogState, isOpen: false }); 
        await refreshObjects(schema, objType); 
        
        if (mode === 'rename') {
          window.dispatchEvent(new CustomEvent('object-deleted', { 
            detail: { schema: schema, objectName: targetName, objectType: objType, reason: 'rename' }
          }));
        }
      } else {
        alert(t("an_error_occurred_2", { error: res.error }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleTableCreatedSidebar = (e: WindowEventMap['table-created']) => {
      const { schema } = e.detail;
      if (schema) {
        refreshObjects(schema, 'TABLE');
        setExpandedTypes(prev => prev.includes(`${schema}.TABLE`) ? prev : [...prev, `${schema}.TABLE`]);
      }
    };
    const handleSequenceCreatedSidebar = (e: WindowEventMap['sequence-created']) => {
      const { schema } = e.detail;
      if (schema) {
        refreshObjects(schema, 'SEQUENCE');
        setExpandedTypes(prev => prev.includes(`${schema}.SEQUENCE`) ? prev : [...prev, `${schema}.SEQUENCE`]);
      }
    };
    
    const handleRefreshSidebar = (e: WindowEventMap['refresh-sidebar']) => {
      const { schema, objType } = e.detail;
      if (objType) {
        const targetType = objType === 'PACKAGE BODY' ? 'PACKAGE' : objType;
        if (schema) {
          refreshObjects(schema, targetType);
          setExpandedTypes(prev => prev.includes(qualifiedObjectName({ schema: schema, objectName: targetType })) ? prev : [...prev, qualifiedObjectName({ schema: schema, objectName: targetType })]);
        } else {
          expandedSchemas.forEach(s => {
            refreshObjects(s, targetType);
            setExpandedTypes(prev => prev.includes(qualifiedObjectName({ schema: s, objectName: targetType })) ? prev : [...prev, qualifiedObjectName({ schema: s, objectName: targetType })]);
          });
        }
      }
    };
    
    window.addEventListener('table-created', handleTableCreatedSidebar);
    window.addEventListener('sequence-created', handleSequenceCreatedSidebar);
    window.addEventListener('refresh-sidebar', handleRefreshSidebar);
    
    return () => {
      window.removeEventListener('table-created', handleTableCreatedSidebar);
      window.removeEventListener('sequence-created', handleSequenceCreatedSidebar);
      window.removeEventListener('refresh-sidebar', handleRefreshSidebar);
    };
  }, [expandedSchemas, refreshObjects, schemas, setExpandedTypes]);

  const getFunctionTemplate = (schema: string): string => {
    return t("oracle_greeting_function_template", { schema });
  };

  const getProcedureTemplate = (schema: string): string => {
    return t("oracle_procedure_template", { schema });
  };

  const getPackageTemplate = (schema: string): string => {
    return t("oracle_package_template", { schema });
  };

  const getTypeTemplate = (schema: string): string => {
    return t("oracle_object_type_template", { schema });
  };

  return {
    t,
    OBJECT_TYPES,
    expandedTypes,
    loadedObjects,
    packageBodies,
    invalidObjects,
    disabledTriggers, 
    indexStatuses, 
    objectFilters,
    loadingCategories,
    expandedRecycleBins, 
    loadedRecycleBins,   
    mviewRefreshDates,
    selectedTable, selectedObject, selectObject, categoryErrors, retryCategory,
    sidebarContextMenu,
    dialogState,
    setDialogState,
    isLoading,
    exportTarget,
    exportContainerRef,
    importTarget,
    importContainerRef,
    toggleType,
    handleRefreshObjects,
    toggleRecycleBin,    
    handleFilterChange,
    loadMore,
    hasMore,

    handleSidebarContextMenu,
    closeSidebarContextMenu, 
    handleRestoreClick,  
    handlePurgeClick,
    handleEmptyRecycleBinClick, 
    handleToggleTriggerEnable, 
    handleRefreshMViewClick,
    handleToggleIndexVisibilityClick, 
    handleRebuildIndexClick,          
    handleCompileClick, 
    handleOpenTableWindow,
    handleOpenSqlWindow,
    handleCopyToClipboard,
    handleRenameClick,
    handleCopyClick,
    handleAnalyzeClick,
    handleExportClick,
    fetchExportDataChunk,
    handleImportClick,
    processSidebarBulkInsertData,
    handleDeleteClick,
    handleTruncateClick, 
    handleDialogSubmit,
    getFunctionTemplate,
    getProcedureTemplate,
    getPackageTemplate,
    getTypeTemplate
  };
}
