// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { generateQuerySql, type QueryTable, type QueryField, type QueryJoin } from '@/features/query-builder/queryBuilderModel';
import { useQueryBuilderDocument } from '@/features/query-builder/useQueryBuilderDocument';
import { withRowIdentity } from '@/features/data-grid/rowIdentity';
import { invokeSqlHistory } from '@/features/sql/sqlHistory';
import type { LogEntry, SqlHistoryEntry } from '@/shared/types/sqlTypes';
import type { DatabaseRow, NamedObject, ColumnMetadata } from "@/shared/types/databaseTypes";
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { type GridColDef } from '@mui/x-data-grid';

import { formatDbDate } from "@/shared/utils/dateFormatter";
import type { AiContext } from '@/shared/types/aiTypes';
import { useQueryBuilderAi, type AiTableColumn } from "@/features/ai/useQueryBuilderAi";
import { getFullTableDDL } from '../common/ddlHelper';
// Import shared helpers.
import { savePgSelectSchema, getPgSelectSchema } from '../common/schemaStorage';
import { parseObjectName, objectFullName, mapObjects } from '@/features/objects/objectRepository';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { ipcRenderer } from '@/shared/api/desktop';

export interface QueryBuilderProps {
  tabId: number; title: string; isActive: boolean; dateFormat: string; dbInfo?: string;
  initialSchema?: string; 
  dbName?: string;
  userName?: string;
  isAiEnabled?: boolean;
  onOpenAiSidebar?: (context: AiContext | null) => void;
}
export type { QueryTable, QueryField, QueryJoin } from '@/features/query-builder/queryBuilderModel';
interface ObjectColumn extends AiTableColumn {
  objectType: 'TABLE' | 'VIEW';
  tableComment: string | null;
}

export function useQueryBuilderWindow({
  dateFormat, title, initialSchema, dbName = '', userName = '', isActive,
  isAiEnabled, onOpenAiSidebar
}: QueryBuilderProps) {
  const { t } = useTranslation();
  const editor = useQueryBuilderDocument('postgresql');
  const { finishDrag, initializeSchema } = editor;
  
  const [mainTab, setMainTab] = useState<number>(0);
  const [gridTab, setGridTab] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [schemas, setSchemas] = useState<string[]>([]);
  const selectedSchemaState = editor.document.selectedSchema;
  const setSelectedSchemaState = editor.setSelectedSchema;

  const [gridHeight, setGridHeight] = useState<number>(260);
  const [isGridResizing, setIsGridResizing] = useState<boolean>(false);
  const gridStartY = useRef<number>(0);
  const gridStartHeight = useRef<number>(0);

  const { queryTables, queryFields, queryJoins } = editor.document;
  const { setQueryTables, setQueryFields, setQueryJoins } = editor;
  const [sqlText, setSqlText] = useState('');
  const [sqlError, setSqlError] = useState('');

  const [addTableDialogOpen, setAddTableDialogOpen] = useState<boolean>(false);
  const [draggingTable, setDraggingTable] = useState<{ id: string, startX: number, startY: number, initialTx: number, initialTy: number } | null>(null);

  const [selectedCols, setSelectedCols] = useState<string[]>([]); 
  const [lastSelectedCol, setLastSelectedCol] = useState<{tableId: string, index: number} | null>(null);

  const [draggedGridFieldIndex, setDraggedGridFieldIndex] = useState<number | null>(null);

  const [columns, setColumns] = useState<GridColDef[]>([]);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [bottomTab, setBottomTab] = useState<number>(0); 
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [historyLogs, setHistoryLogs] = useState<SqlHistoryEntry[]>([]);
  const [historyLimit, setHistoryLimit] = useState<number>(100);

  const importFileRef = useRef<HTMLInputElement | null>(null);

  const loadAiTableInfo = async (fullTableName: string) => {
    const { schema: schemaName, name: tableName } = parseObjectName(fullTableName, selectedSchemaState);
    const result: { success: boolean; rows?: ObjectColumn[] } =
      await ipcRenderer.invoke('execute-sql-bg', `
        SELECT a.attname AS name,
               format_type(a.atttypid, a.atttypmod) AS "dataType",
               col_description(c.oid, a.attnum) AS comment,
               CASE WHEN c.relkind = 'v' THEN 'VIEW' ELSE 'TABLE' END AS "objectType",
               obj_description(c.oid, 'pg_class') AS "tableComment"
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = :schemaName
          AND c.relname = :tableName
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum
      `, { schemaName, tableName });
    if (!result.success || !result.rows?.length) {
      throw new Error(t("failed_to_load_table_and_view_information_for_the_ai_request"));
    }
    const objectType = result.rows[0].objectType;
    let ddl: string;
    if (objectType === 'VIEW') {
      const viewResult: { success: boolean; rows?: { definition: string }[] } =
        await ipcRenderer.invoke('execute-sql-bg', `
          SELECT pg_get_viewdef(c.oid, true) AS definition
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = :schemaName AND c.relname = :viewName AND c.relkind = 'v'
        `, { schemaName, viewName: tableName });
      if (!viewResult.success || !viewResult.rows?.[0]?.definition?.trim()) {
        throw new Error(t("failed_to_retrieve_view_definitions_for_the_ai_request"));
      }
      const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;
      ddl = `CREATE OR REPLACE VIEW ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} AS\n${viewResult.rows[0].definition.trim().replace(/;$/, '')};`;
    } else if (objectType === 'TABLE') {
      ddl = await getFullTableDDL(ipcRenderer, schemaName, tableName, t);
    } else {
      throw new Error(t("failed_to_load_table_and_view_information_for_the_ai_request"));
    }
    if (!ddl.trim()) throw new Error(t("failed_to_retrieve_definitions_for_the_ai_request"));
    return {
      ddl, objectType, comment: result.rows[0].tableComment,
      columns: result.rows.map(({ name, dataType, comment }) => ({ name, dataType, comment }))
    };
  };

  const ai = useQueryBuilderAi({
    dbType: 'postgresql', title, isAiEnabled, onOpenAiSidebar,
    queryTables, queryFields, queryJoins,
    loadTableInfo: loadAiTableInfo,
    isBusy: () => editor.busy.current || addingRef.current,
    applySettings: settings => {
      editor.replace({ ...editor.live.current, ...settings });
      setSelectedCols([]);
      setLastSelectedCol(null);
      setMainTab(0);
    }
  });

  useEffect(() => {
    const fetchData = async () => {
      const [settingsResult, historyResult] = await Promise.allSettled([
        ipcRenderer.invoke('load-settings'),
        invokeSqlHistory(t, 'get-sql-history')
      ]);
      if (settingsResult.status === 'fulfilled' &&
          settingsResult.value?.sqlHistoryLimit) {
        setHistoryLimit(settingsResult.value.sqlHistoryLimit);
      }
      if (historyResult.status === 'fulfilled' && historyResult.value) {
        setHistoryLogs(historyResult.value);
      }
    };
    fetchData();
  }, [t]);

  useEffect(() => {
    const fetchInitialData = async () => {
      setIsLoading(true);
      try {
        const resSchemas = await ipcRenderer.invoke('get-schemas', false, false);
        let fetchedSchemas: string[] = [];
        if (resSchemas.success && resSchemas.schemas) {
          fetchedSchemas = resSchemas.schemas.map((s: NamedObject) => typeof s === 'object' ? s.name || String(s) : String(s));
          setSchemas(fetchedSchemas);
        }

        let finalSchema = '';

        // Resolve the saved schema or default with the shared helper.
        const savedSchema = getPgSelectSchema(dbName, userName);
        if (savedSchema && fetchedSchemas.find((s: string) => s.toLowerCase() === savedSchema.toLowerCase())) {
          finalSchema = fetchedSchemas.find((s: string) => s.toLowerCase() === savedSchema.toLowerCase()) || '';
        } else {
          const targetSchema = initialSchema || userName || '';
          const matchedSchema = fetchedSchemas.find((s: string) => s.toLowerCase() === targetSchema.toLowerCase());
          finalSchema = matchedSchema || '';
        }
        
        initializeSchema(finalSchema);

      } finally {
        setIsLoading(false);
      }
    };
    
    if (schemas.length === 0) {
      fetchInitialData();
    }
  }, [schemas.length, initialSchema, dbName, userName, initializeSchema]);

  // Save selection changes through the shared helper.
  const setSelectedSchema = (newSchema: string) => {
    setSelectedSchemaState(newSchema);
    if (userName && newSchema) {
      savePgSelectSchema(dbName, userName, newSchema);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingTable) {
        const dx = e.clientX - draggingTable.startX;
        const dy = e.clientY - draggingTable.startY;
        setQueryTables(prev => prev.map(table => table.id === draggingTable.id ? { ...table, x: draggingTable.initialTx + dx, y: draggingTable.initialTy + dy } : table));
      }
    };
    const handleMouseUp = () => {
      finishDrag();
      setDraggingTable(null);
    };
    window.addEventListener('mousemove', handleMouseMove); 
    window.addEventListener('mouseup', handleMouseUp);
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [draggingTable, finishDrag, setQueryTables]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isGridResizing) return;
      const diff = gridStartY.current - e.clientY; 
      let newH = gridStartHeight.current + diff;
      if (newH < 150) newH = 150;
      if (newH > window.innerHeight - 200) newH = window.innerHeight - 200;
      setGridHeight(newH);
    };
    const handleMouseUp = () => {
      if (isGridResizing) {
        setIsGridResizing(false);
        document.body.style.cursor = 'default';
      }
    };
    if (isGridResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isGridResizing]);

  const handleGridMouseDown = (e: React.MouseEvent) => {
    setIsGridResizing(true);
    gridStartY.current = e.clientY;
    gridStartHeight.current = gridHeight;
    document.body.style.cursor = 'row-resize';
  };

  const handleTableMouseDown = (e: React.MouseEvent, tableId: string, x: number, y: number) => {
    if ((e.target as HTMLElement).closest('button')) return; 
    if (editor.busy.current) return;
    editor.dragging.current = true;
    setDraggingTable({ id: tableId, startX: e.clientX, startY: e.clientY, initialTx: x, initialTy: y });
  };

  useEffect(() => {
    try { setSqlText(generateQuerySql({ queryTables, queryFields, queryJoins })); setSqlError(''); }
    catch (error: unknown) { setSqlText(''); setSqlError(getErrorMessage(error)); }
  }, [queryTables, queryFields, queryJoins]);

  const builderRef = useRef({ queryTables, isActive });
  builderRef.current = { queryTables, isActive };
  const mountedRef = useRef(true);
  const addingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isObjectAdded = (object: DatabaseObject) => builderRef.current.queryTables.some(table => {
    try {
      const parsed = parseObjectName(table.name, selectedSchemaState);
      return parsed.schema === object.schema && parsed.name === object.name;
    } catch { return false; }
  });
  const handleOpenAddTableDialog = () => setAddTableDialogOpen(true);
  const handleAddObjectsToBuilder = async (objects: DatabaseObject[]) => {
    if (addingRef.current || editor.busy.current) throw new Error(t("objects_are_being_added"));
    if (objects.some(object => object.dbType !== 'postgresql' || !['TABLE', 'VIEW'].includes(object.category))) {
      throw new Error(t("select_a_table_or_view"));
    }
    const unique = new Map(objects.filter(object => !isObjectAdded(object))
      .map(object => [JSON.stringify([object.schema, object.name]), object]));
    if (!unique.size) return;
    const before = JSON.stringify(builderRef.current.queryTables);
    addingRef.current = true; setIsLoading(true);
    try {
      const added = await mapObjects([...unique.values()], async object => {
        const result: { success: boolean; rows?: { name: string }[]; error?: string } =
          await ipcRenderer.invoke('execute-sql-bg',
            `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = :schema AND table_name = :name ORDER BY ordinal_position`, { schema: object.schema, name: object.name });
        if (!result.success || !result.rows?.length) {
          throw new Error(t("failed_to_fetch_columns") + ` ${object.schema}.${object.name}` +
            (result.error ? `\n${result.error}` : ''));
        }
        return { id: `table_${crypto.randomUUID()}`, name: objectFullName(object),
          columns: result.rows.map(row => row.name), x: 0, y: 20 };
      });
      if (!mountedRef.current || !builderRef.current.isActive) throw new Error(t("the_originating_window_is_unavailable"));
      if (JSON.stringify(builderRef.current.queryTables) !== before) {
        throw new Error(t("query_settings_changed_during_retrieval_so_the_objects_could_not_be_added"));
      }
      setQueryTables(previous => [...previous, ...added.map((table, index) => ({
        ...table, x: 20 + ((previous.length + index) * 200)
      }))]);
    } finally {
      addingRef.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleRemoveTable = (tableId: string) => {
    setQueryTables(prev => prev.filter(table => table.id !== tableId));
    setQueryFields(prev => prev.filter(f => f.tableId !== tableId));
    setQueryJoins(prev => prev.filter(j => j.fromTableId !== tableId && j.toTableId !== tableId));
    setSelectedCols(prev => prev.filter(k => !k.startsWith(`${tableId}::`)));
  };

  const handleClearAll = () => {
    if (window.confirm(t("clear_all_table_and_field_placements"))) {
      setQueryTables([]); setQueryFields([]); setQueryJoins([]); setSqlText(''); setSelectedCols([]);
    }
  };

  const handleExportJson = editor.handleExportJson;
  const triggerImport = () => { if (!editor.busy.current) importFileRef.current?.click(); };
  const handleImportJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    editor.handleImportJson(event);
    setSelectedCols([]); setLastSelectedCol(null);
  };

  const handleColClick = (e: React.MouseEvent, tableId: string, colName: string, index: number) => {
    const colKey = `${tableId}::${colName}`;
    
    if (e.shiftKey && lastSelectedCol && lastSelectedCol.tableId === tableId) {
      const foundTable = queryTables.find(table => table.id === tableId);
      if (foundTable) {
        const start = Math.min(lastSelectedCol.index, index);
        const end = Math.max(lastSelectedCol.index, index);
        const newSelection = [...selectedCols];
        for (let i = start; i <= end; i++) {
          const k = `${tableId}::${foundTable.columns[i]}`;
          if (!newSelection.includes(k)) newSelection.push(k);
        }
        setSelectedCols(newSelection);
      }
    } else if (e.ctrlKey || e.metaKey) {
      if (selectedCols.includes(colKey)) {
        setSelectedCols(selectedCols.filter(k => k !== colKey));
      } else {
        setSelectedCols([...selectedCols, colKey]);
        setLastSelectedCol({ tableId, index });
      }
    } else {
      setSelectedCols([colKey]);
      setLastSelectedCol({ tableId, index });
    }
  };

  const handleFieldDoubleClick = (table: QueryTable, colName: string) => {
    setQueryFields(prev => {
      const isDuplicate = prev.some(f => f.tableId === table.id && f.columnName === colName);
      if (!isDuplicate) {
        return [...prev, {
          id: `field_${Date.now()}_${Math.random()}`, 
          tableId: table.id, 
          tableName: table.name, 
          columnName: colName, 
          sort: '', 
          criteria: '', 
          orCriteria: '', 
          show: true, 
          groupBy: ''
        }];
      }
      return prev;
    });
  };

  const handleColDragStart = (e: React.DragEvent, tableId: string, colName: string, index: number) => {
    const colKey = `${tableId}::${colName}`;
    let dragItems = selectedCols;
    
    if (!selectedCols.includes(colKey)) {
       dragItems = [colKey];
       setSelectedCols(dragItems);
       setLastSelectedCol({ tableId, index });
    }
    
    const data = dragItems.map(k => {
      const separator = k.indexOf('::');
      const tId = k.slice(0, separator), cName = k.slice(separator + 2);
      const foundTable = queryTables.find(table => table.id === tId);
      return { tableId: tId, tableName: foundTable?.name || '', colName: cName };
    });
    e.dataTransfer.setData('application/query-fields', JSON.stringify(data));
  };

  const handleFieldDropToGrid = (e: React.DragEvent) => {
    e.preventDefault();
    const dataStr = e.dataTransfer.getData('application/query-fields');
    if (dataStr) {
      const dataArr = JSON.parse(dataStr);
      setQueryFields(prev => {
        const newFields: QueryField[] = [];
        dataArr.forEach((data: { tableId: string; tableName: string; colName: string }) => {
          const isDuplicate = prev.some(f => f.tableId === data.tableId && f.columnName === data.colName) || 
                              newFields.some(f => f.tableId === data.tableId && f.columnName === data.colName);
          
          if (!isDuplicate) {
            newFields.push({
              id: `field_${Date.now()}_${Math.random()}`, 
              tableId: data.tableId, 
              tableName: data.tableName, 
              columnName: data.colName, 
              sort: '', 
              criteria: '', 
              orCriteria: '', 
              show: true, 
              groupBy: ''
            });
          }
        });
        return [...prev, ...newFields];
      });
    }
  };

  const handleFieldDropToField = (e: React.DragEvent, toTableId: string, toColName: string) => {
    e.preventDefault(); e.stopPropagation();
    const dataStr = e.dataTransfer.getData('application/query-fields');
    if (dataStr) {
      const dataArr = JSON.parse(dataStr);
      if (dataArr.length > 0) {
        const data = dataArr[0]; 
        if (data.tableId !== toTableId) {
          setQueryJoins(prev => [...prev, { id: `join_${Date.now()}`, fromTableId: data.tableId, fromCol: data.colName, toTableId, toCol: toColName, joinType: 'INNER' }]);
        }
      }
    }
  };

  const handleGridFieldDragStart = (e: React.DragEvent, index: number) => {
    editor.dragging.current = true;
    setDraggedGridFieldIndex(index);
    e.dataTransfer.setData('application/grid-field', index.toString());
  };

  const handleGridFieldDragEnter = (index: number) => {
    if (draggedGridFieldIndex === null || draggedGridFieldIndex === index) return;
    setQueryFields(prev => {
      const newFields = [...prev];
      const draggedField = newFields[draggedGridFieldIndex];
      newFields.splice(draggedGridFieldIndex, 1);
      newFields.splice(index, 0, draggedField);
      return newFields;
    });
    setDraggedGridFieldIndex(index);
  };

  const handleGridFieldDragEnd = () => {
    finishDrag();
    setDraggedGridFieldIndex(null);
  };

  const updateJoin = (id: string, field: keyof QueryJoin, value: string) => {
    setQueryJoins(prev => prev.map(j => j.id === id ? { ...j, [field]: value } : j));
  };

  const handleRemoveField = (fieldId: string) => {
    setQueryFields(prev => prev.filter(f => f.id !== fieldId));
  };

  const handleGroupByChange = (fieldId: string, val: string) => {
    setQueryFields(prev => {
      let newFields = prev.map(f => f.id === fieldId ? { ...f, groupBy: val } : f);
      const hasAgg = newFields.some(f => f.groupBy && f.groupBy !== 'GROUP BY');
      if (hasAgg) {
        newFields = newFields.map(f => (f.show && !f.groupBy) ? { ...f, groupBy: 'GROUP BY' } : f);
      }
      return newFields;
    });
  };

  const handleSortChange = (fieldId: string, val: string) => {
    setQueryFields(prev => prev.map(f => f.id === fieldId ? { ...f, sort: val } : f));
  };

  const handleShowChange = (fieldId: string, checked: boolean) => {
    setQueryFields(prev => prev.map(f => f.id === fieldId ? { ...f, show: checked } : f));
  };

  const handleCriteriaChange = (fieldId: string, val: string) => {
    setQueryFields(prev => prev.map(f => f.id === fieldId ? { ...f, criteria: val } : f));
  };

  const handleOrCriteriaChange = (fieldId: string, val: string) => {
    setQueryFields(prev => prev.map(f => f.id === fieldId ? { ...f, orCriteria: val } : f));
  };

  const handleExecuteSql = async () => {
    let targetSql = sqlText;
    try { if (editor.live.current.queryTables.length) targetSql = generateQuerySql(editor.live.current); }
    catch (error: unknown) { setSqlError(getErrorMessage(error)); return; }

    if (!targetSql.trim() || editor.busy.current || addingRef.current) return;
    editor.busy.current = true;
    setIsLoading(true); 
    
    try {
      const channelName = 'execute-sql';
      const response = await ipcRenderer.invoke(channelName, targetSql, {});
      if (!mountedRef.current) return;
      const timestamp = new Date().toLocaleString('ja-JP');
      
      if (response.success) {
        const dateCols = response.metaData 
          ? response.metaData.filter((m: ColumnMetadata) => !!m.dbTypeName && /^(DATE|TIMESTAMP)/.test(m.dbTypeName)).map((m: ColumnMetadata) => m.name)
          : [];

        const generatedColumns: GridColDef[] = (response.metaData || []).map((metadata: ColumnMetadata) => ({
          field: metadata.name, headerName: metadata.name, width: 150,
          ...(dateCols.includes(metadata.name) ? { valueFormatter: (params: { value: unknown }) => formatDbDate(params.value, dateFormat) } : {})
        }));
        const generatedRows = (response.rows || []).map((row: DatabaseRow, index: number) => withRowIdentity({ ...row }, index + 1));

        setColumns(generatedColumns); 
        setRows(generatedRows); 
        
        const resultMsg = t("rows_fetched", { num: generatedRows.length });
        const newLog = { time: timestamp, sql: targetSql, execTime: response.executionTime, resultMsg };
        setLogs(prev => [newLog, ...prev]);

        const newHistory = { executeTime: timestamp, sql: targetSql, duration: response.executionTime, rowCount: generatedRows.length };
        const updatedHistory = await invokeSqlHistory(t, 'add-sql-history', newHistory);
        if (!mountedRef.current) return;
        if (updatedHistory) setHistoryLogs(updatedHistory);
        
        setMainTab(1); 
        setBottomTab(0);
      } else { 
        const errorMsg = t("execution_error_occurred", { error: response.error });
        const errorLinesArray = (response.error || t('error_occurred')).split('\n');
        const consoleErrors: string[] = [];

        errorLinesArray.forEach((errLine: string) => {
          consoleErrors.push(`[ERROR] ${errLine}`);
        });

        const newLog = { time: timestamp, sql: targetSql, execTime: '-', resultMsg: t("error_occurred"), errorLines: consoleErrors };
        setLogs(prev => [newLog, ...prev]);
        setMainTab(1);
        setBottomTab(1); 
        alert(errorMsg);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      alert(t("connection_error_6", { error: getErrorMessage(err) }));
    } finally {
      editor.busy.current = false;
      if (mountedRef.current) setIsLoading(false);
    }
  };

  const handleClearLogs = () => {
    if (window.confirm(t("are_you_sure_you_want_to_clear"))) {
      setLogs([]);
    }
  };

  const handleClearHistory = async () => {
    if (window.confirm(t("are_you_sure_you_want_to_clear"))) {
      const h = await invokeSqlHistory(t, 'clear-sql-history');
      if (h) setHistoryLogs(h);
    }
  };

  return {
    t, ai, sqlError, editor,
    handleRequestAi: ai.handleRequestAi,
    mainTab, setMainTab,
    gridTab, setGridTab,
    isLoading: isLoading || editor.saving, setIsLoading,
    schemas, 
    selectedSchema: selectedSchemaState, // Normalize names for the UI.
    setSelectedSchema, 
    gridHeight,
    isGridResizing,
    queryTables,
    queryFields,
    queryJoins, setQueryJoins,
    sqlText, setSqlText,
    addTableDialogOpen, setAddTableDialogOpen,
    selectedCols,
    draggedGridFieldIndex,
    columns,
    rows,
    bottomTab, setBottomTab,
    logs, setLogs,
    historyLogs, setHistoryLogs,
    historyLimit,
    importFileRef, 
    
    handleGridMouseDown,
    handleTableMouseDown,
    handleOpenAddTableDialog,
    handleAddObjectsToBuilder,
    isObjectAdded,
    handleRemoveTable,
    handleClearAll,
    handleColClick,
    handleFieldDoubleClick,
    handleColDragStart,
    handleFieldDropToGrid,
    handleFieldDropToField,
    handleGridFieldDragStart,
    handleGridFieldDragEnter,
    handleGridFieldDragEnd,
    handleRemoveField,
    handleGroupByChange,
    handleSortChange,
    handleShowChange,
    handleCriteriaChange,
    handleOrCriteriaChange,
    updateJoin,
    handleExecuteSql,
    handleClearLogs,
    handleClearHistory,
    handleExportJson, 
    handleImportJson, 
    triggerImport     
  };
}
