// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { routineTabKey } from '@/features/postgresql/routineIdentity';
import { sidebarObjectKey } from '@/features/objects/sidebarNavigation';
import { triggerTabKey } from './triggerIdentity';
import { runGitOperation } from '@/features/git/gitOperation';
import { qualifiedObjectName, splitObjectName } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { createSidebarDataTransfer } from './sidebarDataTransfer';
import type { SidebarObject, ColumnDefinition } from "@/shared/types/databaseTypes";

import type { GridColDef } from '@mui/x-data-grid';

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

export interface ContextMenuState { 
  mouseX: number; mouseY: number; type: 'table' | 'column' | 'recyclebin'; value: string; 
  schema?: string; objType?: string; tableKey?: string; objectName?: string;
  status?: string; tableName?: string; signature?: string;
}

interface UseSidebarLogicProps {
  schemas: string[];
  expandedSchemas: string[];
  onAddTab: (type: 'sql' | 'table' | 'create-table' | 'view' | 'sequence' | 'create-sequence' | 'stored' | 'create-stored' | 'trigger' | 'create-trigger' | 'mview' | 'create-mview' | 'index' | 'create-index' | 'type', name?: string, initialSql?: string) => void;
  outputDateFormat: string;
}

const PAGE_SIZE = 100;

export function useSidebarLogic({ schemas, expandedSchemas, onAddTab, outputDateFormat }: UseSidebarLogicProps) {
  const { t } = useTranslation();

  const OBJECT_TYPES = [
    'TABLE',
    'INDEX',
    'TRIGGER',
    'VIEW',
    'PROCEDURE',
    'FUNCTION',
    'TYPE',
    'SEQUENCE',
    'MATERIALIZED VIEW'
  ];

  const [expandedTypes, setExpandedTypes] = useState<string[]>([]); 
  const [loadedObjects, setLoadedObjects] = useState<{ [key: string]: SidebarObject[] }>({});
  const [objectFilters, setObjectFilters] = useState<{ [key: string]: string }>({});
  const [hasMoreMap, setHasMoreMap] = useState<{ [key: string]: boolean }>({});
  const [loadingCategories, setLoadingCategories] = useState<string[]>([]);

  const [selectedObject, setSelectedObject] = useState<string | null>(null);
  const selectObject = (schema: string, type: string, name: string, signature = '', tableName = '') => {
    setSelectedObject(sidebarObjectKey(schema, type, name, signature, tableName));
    setSelectedTable(name);
  };
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [sidebarContextMenu, setSidebarContextMenu] = useState<ContextMenuState | null>(null);

  const [dialogState, setDialogState] = useState<{ 
    isOpen: boolean; mode: 'rename' | 'copy' | 'analyze' | 'vacuum'; targetName: string; newName: string; schema: string; objType: string 
  }>({ isOpen: false, mode: 'rename', targetName: '', newName: '', schema: '', objType: '' });

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [exportTarget, setExportTarget] = useState<{ schema: string, tableName: string, columns: GridColDef[], totalCount: number, structureDefs: ColumnDefinition[] } | null>(null);
  const exportContainerRef = useRef<HTMLDivElement>(null);

  const [importTarget, setImportTarget] = useState<{ schema: string, tableName: string, structureDefs: ColumnDefinition[] } | null>(null);
  const importContainerRef = useRef<HTMLDivElement>(null);

  const [categoryErrors, setCategoryErrors] = useState<Record<string, string>>({});
  const appliedFilters = useRef<Record<string, string>>({});
  const activeRequests = useRef<Record<string, number>>({});
  const desiredFilters = useRef<Record<string, string>>({});
  const failedRequests = useRef<Record<string, { schema: string; type: string; filter: string; offset: number; append: boolean }>>({});
  const requestVersions = useRef<Record<string, number>>({});
  useEffect(() => () => {
    for (const key of Object.keys(requestVersions.current)) requestVersions.current[key]++;
  }, []);
  const filterDebounceTimerRef = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({});

  const buildCategoryQuery = (schema: string, type: string, filterText: string, offset: number, limit: number) => {
    const filterClause = filterText ? `AND name ILIKE :filter ESCAPE '!'` : '';
    const binds: Record<string, string> = { schema };
    if (filterText) binds.filter = '%' + filterText.replace(/[!%_]/g, '!$&') + '%';

    let baseSql = '';
    switch (type) {
      case 'TABLE':
        baseSql = `
          SELECT c.relname AS name, 'VALID' AS status, NULL AS "tableName"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schema AND c.relkind = 'r'
        `;
        break;
      case 'VIEW':
        baseSql = `
          SELECT c.relname AS name, 'VALID' AS status, NULL AS "tableName"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schema AND c.relkind = 'v'
        `;
        break;
      case 'MATERIALIZED VIEW':
        baseSql = `
          SELECT c.relname AS name, 'VALID' AS status, NULL AS "tableName"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schema AND c.relkind = 'm'
        `;
        break;
      case 'SEQUENCE':
        baseSql = `
          SELECT c.relname AS name, 'VALID' AS status, NULL AS "tableName"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schema AND c.relkind = 'S'
        `;
        break;
      case 'INDEX':
        baseSql = `
          SELECT c.relname AS name, 'VALID' AS status, NULL AS "tableName"
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schema AND c.relkind = 'i'
        `;
        break;
      case 'FUNCTION':
        baseSql = `
          SELECT p.proname AS name, oidvectortypes(p.proargtypes) AS signature, 'VALID' AS status, NULL AS "tableName"
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = :schema AND p.prokind = 'f'
        `;
        break;
      case 'PROCEDURE':
        baseSql = `
          SELECT p.proname AS name, oidvectortypes(p.proargtypes) AS signature, 'VALID' AS status, NULL AS "tableName"
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = :schema AND p.prokind = 'p'
        `;
        break;
      case 'TRIGGER':
        baseSql = `
          SELECT trg.tgname AS name, 
                 CASE WHEN trg.tgenabled = 'D' THEN 'DISABLED' ELSE 'VALID' END AS status,
                 tbl.relname AS "tableName"
          FROM pg_trigger trg
          JOIN pg_class tbl ON trg.tgrelid = tbl.oid
          JOIN pg_namespace n ON tbl.relnamespace = n.oid
          WHERE n.nspname = :schema AND NOT trg.tgisinternal
        `;
        break;
      case 'TYPE':
        baseSql = `
          SELECT t.typname AS name, 'VALID' AS status, NULL AS "tableName"
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
          LEFT JOIN pg_class c ON c.oid = t.typrelid
          WHERE n.nspname = :schema AND (t.typtype = 'e' OR (t.typtype = 'c' AND c.relkind = 'c'))
        `;
        break;
      default:
        baseSql = `SELECT '' AS name, 'VALID' AS status, NULL AS "tableName" WHERE 1=0`;
    }

    const sql = `
      WITH list AS (${baseSql})
      SELECT * FROM list
      WHERE 1=1 ${filterClause}
      ORDER BY name ASC, "tableName" ASC${['FUNCTION', 'PROCEDURE'].includes(type) ? ', signature ASC' : ''}
      OFFSET ${offset} LIMIT ${limit}
    `;
    return { sql, binds };
  };

  const fetchObjectsFromDb = async (schema: string, type: string, filterText: string, offset: number, append: boolean = false) => {
    const key = qualifiedObjectName({ schema: schema, objectName: type });
    if (append && (filterDebounceTimerRef.current[key] || activeRequests.current[key] || appliedFilters.current[key] !== filterText || desiredFilters.current[key] !== filterText)) return;
    if (filterDebounceTimerRef.current[key]) {
      clearTimeout(filterDebounceTimerRef.current[key]); delete filterDebounceTimerRef.current[key];
    }
    desiredFilters.current[key] = filterText;
    const version = (requestVersions.current[key] ?? 0) + 1;
    requestVersions.current[key] = version;
    activeRequests.current[key] = version;
    const isCurrent = () => requestVersions.current[key] === version;
    setCategoryErrors(prev => ({ ...prev, [key]: '' }));
    setLoadingCategories(prev => [...new Set([...prev, key])]);
    try {
      const { sql, binds } = buildCategoryQuery(schema, type, filterText, offset, PAGE_SIZE);
      
      // Use execute-sql-bg, which is excluded from the global loader.
      const res = await ipcRenderer.invoke<SidebarObject>('execute-sql-bg', sql, binds);

      if (!isCurrent()) return;

      if (res.success && Array.isArray(res.rows)) {
        appliedFilters.current[key] = filterText;
        delete failedRequests.current[key];
        const newObjs = res.rows;
        setLoadedObjects(prev => ({
          ...prev,
          [key]: append ? [...(prev[key] || []), ...newObjs] : newObjs
        }));
        setHasMoreMap(prev => ({
          ...prev,
          [key]: newObjs.length >= PAGE_SIZE
        }));
      } else {
        throw new Error(res.error || t('sidebar_list_unavailable'));
      }
    } catch {
      if (!isCurrent()) return;
      failedRequests.current[key] = { schema, type, filter: filterText, offset, append };
      setCategoryErrors(prev => ({ ...prev, [key]: t('sidebar_list_unavailable') }));
    } finally {
      if (activeRequests.current[key] === version) delete activeRequests.current[key];
      if (isCurrent()) setLoadingCategories(prev => prev.filter(k => k !== key));
    }
  };

  const retryCategory = (key: string) => {
    const failed = failedRequests.current[key];
    if (failed && !activeRequests.current[key]) return fetchObjectsFromDb(failed.schema, failed.type, failed.filter, failed.offset, failed.append);
  };

  const toggleType = async (schema: string, type: string) => {
    const key = qualifiedObjectName({ schema: schema, objectName: type });
    if (expandedTypes.includes(key)) {
      setExpandedTypes(prev => prev.filter(k => k !== key));
      return;
    }

    setExpandedTypes(prev => [...prev, key]);

    if (!loadedObjects[key]) {
      const currentFilter = objectFilters[key] || '';
      fetchObjectsFromDb(schema, type, currentFilter, 0, false);
    }
  };

  const refreshObjects = useEventCallback(async (schema: string, type: string) => {
    const key = qualifiedObjectName({ schema: schema, objectName: type });
    const currentFilter = objectFilters[key] || '';
    await fetchObjectsFromDb(schema, type, currentFilter.trim(), 0, false);
  });

  const handleRefreshObjects = (e: React.MouseEvent, schema: string, type: string) => {
    e.stopPropagation();
    refreshObjects(schema, type);
  };

  const handleFilterChange = (key: string, value: string) => {
    requestVersions.current[key] = (requestVersions.current[key] ?? 0) + 1;
    setObjectFilters(prev => ({ ...prev, [key]: value }));
    desiredFilters.current[key] = value.trim();
    delete failedRequests.current[key];
    setCategoryErrors(prev => ({ ...prev, [key]: '' }));
    setLoadingCategories(prev => [...new Set([...prev, key])]);

    const [schema, type] = splitObjectName(key);
    if (!schema || !type) return;

    if (filterDebounceTimerRef.current[key]) {
      clearTimeout(filterDebounceTimerRef.current[key]);
    }

    filterDebounceTimerRef.current[key] = setTimeout(() => {
      delete filterDebounceTimerRef.current[key];
      fetchObjectsFromDb(schema, type, value.trim(), 0, false);
    }, 250);
  };

  const loadMore = (key: string) => {
    const [schema, type] = splitObjectName(key);
    if (!schema || !type) return;

    const currentList = loadedObjects[key] || [];
    const currentFilter = objectFilters[key] || '';
    fetchObjectsFromDb(schema, type, currentFilter.trim(), currentList.length, true);
  };

  const hasMore = (key: string) => !!hasMoreMap[key] && appliedFilters.current[key] === (objectFilters[key] || '').trim() && !categoryErrors[key];

  const handleSidebarContextMenu = (e: React.MouseEvent, type: 'table' | 'column' | 'recyclebin', value: string, schema?: string, objType?: string, tableKey?: string, objectName?: string, status?: string, tableName?: string, signature?: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (type === 'table') {
      selectObject(schema || '', objType || '', value, signature || '', tableName || '');
    }
    setSidebarContextMenu({ mouseX: e.clientX, mouseY: e.clientY, type, value, schema, objType, tableKey, objectName, status, tableName, signature });
  };

  const closeSidebarContextMenu = () => {
    setSidebarContextMenu(null);
  };

  const openObjectTab = (schema: string, value: string, objType: string, tableName?: string, signature = '') => {
    if (objType === 'TABLE' || objType === 'VIEW' || objType === 'SEQUENCE' || objType === 'MATERIALIZED VIEW' || objType === 'TYPE') {
      const tabType = objType === 'VIEW' ? 'view' : objType === 'SEQUENCE' ? 'sequence' : objType === 'MATERIALIZED VIEW' ? 'mview' : objType === 'TYPE' ? 'type' : 'table';
      onAddTab(tabType as Parameters<typeof onAddTab>[0], qualifiedObjectName({ schema: schema, objectName: value }));
    } else if (objType === 'FUNCTION' || objType === 'PROCEDURE') {
      onAddTab('stored', routineTabKey({ schema, objectName: value, objectType: objType, signature }), objType);
    } else if (objType === 'TRIGGER') {
      onAddTab('trigger', tableName ? triggerTabKey({ schema, objectName: value, tableName }) : qualifiedObjectName({ schema, objectName: value }));
    } else if (objType === 'INDEX') {
      onAddTab('index', qualifiedObjectName({ schema: schema, objectName: value }));
    }
  };

  const handleOpenTableWindow = () => {
    if (!sidebarContextMenu) return;
    const { schema, value, objType, tableName, signature } = sidebarContextMenu;
    openObjectTab(schema!, value, objType!, tableName, signature);
    setSidebarContextMenu(null);
  };

  const handleOpenSqlWindow = () => {
    if (!sidebarContextMenu) return;
    const { schema, value } = sidebarContextMenu;
    const fullName = `"${schema}"."${value}"`;
    const initialSql = `SELECT * FROM ${fullName};`;
    onAddTab('sql', undefined, initialSql);
    setSidebarContextMenu(null);
  };

  const handleCopyToClipboard = () => {
    if (!sidebarContextMenu) return;
    let textToCopy = '';
    if (sidebarContextMenu.type === 'table') {
      textToCopy = sidebarContextMenu.value;
    }
    if (textToCopy) navigator.clipboard.writeText(textToCopy);
    setSidebarContextMenu(null);
  };

  const handleRenameClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'rename', targetName: sidebarContextMenu.value, newName: sidebarContextMenu.value, schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const handleCopyClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'copy', targetName: sidebarContextMenu.value, newName: `${sidebarContextMenu.value}_copy`, schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const handleAnalyzeClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'analyze', targetName: sidebarContextMenu.value, newName: '', schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const handleVacuumClick = () => {
    if (!sidebarContextMenu) return;
    setDialogState({ isOpen: true, mode: 'vacuum', targetName: sidebarContextMenu.value, newName: '', schema: sidebarContextMenu.schema!, objType: sidebarContextMenu.objType! });
    setSidebarContextMenu(null); 
  };

  const handleToggleEnableTrigger = async () => {
    if (!sidebarContextMenu) return;
    const { schema, value: targetName, objType, status, tableName } = sidebarContextMenu;
    setSidebarContextMenu(null);

    if (objType !== 'TRIGGER') return;
    
    setIsLoading(true);
    try {
      const isEnabled = status === 'VALID';
      const sql = `ALTER TABLE "${schema}"."${tableName}" ${isEnabled ? 'DISABLE' : 'ENABLE'} TRIGGER "${targetName}"`;
      const res = await ipcRenderer.invoke('execute-sql', sql);
      
      if (res.success) {
        alert(t("trigger_set_to", { status: isEnabled ? t("disabled") : t("enabled") }));
        refreshObjects(schema!, objType!);
      } else {
        alert(t("status_change_error_3", { error: res.error }));
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
      const sql = `REFRESH MATERIALIZED VIEW "${schema}"."${value}";`;
      const res = await ipcRenderer.invoke('execute-sql', sql);
      if (res.success) {
        alert(t("materialized_view_updated"));
      } else {
        alert(t("update_error_3", { error: res.error }));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const { handleExportClick, fetchExportDataChunk, handleImportClick, processSidebarBulkInsertData } = createSidebarDataTransfer({ sidebarContextMenu, setSidebarContextMenu, exportTarget, setExportTarget, importTarget, setImportTarget, exportContainerRef, importContainerRef, setIsLoading, outputDateFormat, t });

  const handleDeleteClick = async () => {
    if (!sidebarContextMenu) return;
    const { value: target, schema, objType, tableName } = sidebarContextMenu;
    setSidebarContextMenu(null);

    let objNameJp = t("object");
    if (objType === 'TABLE') objNameJp = t("table_2");
    if (objType === 'VIEW') objNameJp = t("view_2");
    if (objType === 'SEQUENCE') objNameJp = t("sequence_3");
    if (objType === 'FUNCTION') objNameJp = t("function_2");
    if (objType === 'PROCEDURE') objNameJp = t("procedure_2");
    if (objType === 'TRIGGER') objNameJp = t("trigger_2");
    if (objType === 'MATERIALIZED VIEW') objNameJp = t("materialized_view_2");
    if (objType === 'INDEX') objNameJp = t("index_2");
    if (objType === 'TYPE') objNameJp = t("type_2");

    if (window.confirm(t("delete_this_operation_cannot_be_undone", { type: objNameJp, name: target }))) {
      setIsLoading(true);
      try {
        let sql = `DROP ${objType} "${schema}"."${target}" CASCADE`;
        if (objType === 'TRIGGER') {
           sql = `DROP TRIGGER "${target}" ON "${schema}"."${tableName}" CASCADE`;
        }

        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'POSTGRES',
              schema: schema || '',
              objectType: objType || '',
              objectName: target, ...(objType === 'TRIGGER' ? { tableName } : {})
            });
          } catch (e) {
            console.error("Failed to delete the object from Git.", e);
          }

          alert(t("deleted"));
          await refreshObjects(schema!, objType!); 
          window.dispatchEvent(new CustomEvent('object-deleted', { 
            detail: { schema: schema!, objectName: target, objectType: objType!, ...(objType === 'TRIGGER' ? { tableName } : {}) }
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
        const sql = `TRUNCATE TABLE "${schema}"."${targetName}" RESTART IDENTITY CASCADE`;
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
      setIsLoading(true);
      try {
        const sql = `ANALYZE "${schema}"."${targetName}"`;
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

    if (mode === 'vacuum') {
      setIsLoading(true);
      try {
        const sql = `VACUUM "${schema}"."${targetName}"`;
        const res = await ipcRenderer.invoke('execute-sql', sql);
        if (res.success) {
          alert(t("vacuum_completed"));
          setDialogState({ ...dialogState, isOpen: false });
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
              dbType: 'POSTGRES',
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
    
    const handleRefreshSidebar = (e: WindowEventMap['refresh-sidebar']) => {
      const { schema, objType } = e.detail;
      if (objType) {
        if (schema) {
          refreshObjects(schema, objType);
          setExpandedTypes(prev => prev.includes(qualifiedObjectName({ schema: schema, objectName: objType })) ? prev : [...prev, qualifiedObjectName({ schema: schema, objectName: objType })]);
        }
      }
    };
    
    window.addEventListener('table-created', handleTableCreatedSidebar);
    window.addEventListener('refresh-sidebar', handleRefreshSidebar);
    
    return () => {
      window.removeEventListener('table-created', handleTableCreatedSidebar);
      window.removeEventListener('refresh-sidebar', handleRefreshSidebar);
    };
  }, [expandedSchemas, refreshObjects, schemas]);

  const getFunctionTemplate = (schema: string): string => {
    return `-- Function template\nCREATE OR REPLACE FUNCTION "${schema}".new_function(p_param text)\nRETURNS text AS $$\nBEGIN\n  RETURN 'Hello ' || p_param;\nEND;\n$$ LANGUAGE plpgsql;\n`;
  };

  const getProcedureTemplate = (schema: string): string => {
    return `-- Procedure template\nCREATE OR REPLACE PROCEDURE "${schema}".new_procedure(p_param text)\nLANGUAGE plpgsql AS $$\nBEGIN\n  RAISE NOTICE 'Executed with: %', p_param;\nEND;\n$$;\n`;
  };

  const getTypeTemplate = (schema: string): string => {
    return `-- Composite type creation template\nCREATE TYPE "${schema}".new_type AS (\n  id integer,\n  name text\n);\n`;
  };

  return {
    categoryErrors, retryCategory,
    t,
    OBJECT_TYPES,
    expandedTypes,
    loadedObjects,
    objectFilters,
    loadingCategories,
    selectedTable, selectedObject, selectObject,
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
    handleFilterChange,
    loadMore,
    hasMore,
    handleSidebarContextMenu,
    closeSidebarContextMenu, 
    handleOpenTableWindow,
    handleOpenSqlWindow,
    handleCopyToClipboard,
    handleRenameClick,
    handleCopyClick,
    handleAnalyzeClick,
    handleVacuumClick,
    handleExportClick,
    fetchExportDataChunk,
    handleRefreshMViewClick, 
    handleImportClick,
    processSidebarBulkInsertData,
    handleDeleteClick,
    handleTruncateClick, 
    handleDialogSubmit,
    handleToggleEnableTrigger,
    getFunctionTemplate,
    getProcedureTemplate,
    getTypeTemplate 
  };
}
