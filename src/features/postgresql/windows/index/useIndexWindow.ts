// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { loadIndexDetails, indexDropPlan, type IndexDetails } from '@/features/index/indexMetadata';
import { splitSqlScript } from '@/features/sql/sqlScript';
import { runGitOperation } from '@/features/git/gitOperation';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import type { PgIndexStatistics } from "@/shared/types/databaseTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { GridColDef } from '@mui/x-data-grid';
import { ipcRenderer } from '@/shared/api/desktop';

export interface IndexWindowProps {
  tabId: number;
  schema: string;
  indexName: string;
  initialTable?: string;
  isNew: boolean;
  isActive: boolean;
  allSchemas: string[];
}

export interface LogEntry {
  time: string;
  sql: string;
  resultMsg: string;
  errorLines?: string[];
}

export const useIndexWindow = (props: IndexWindowProps) => {
  const { tabId, schema, indexName, initialTable, isNew, isActive, allSchemas } = props;
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<number>(0);
  const [bottomTab, setBottomTab] = useState<number>(0); 
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);
  const [consoleWidth, setConsoleWidth] = useState<number>(350);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  // Disable actions from the initial render until parallel fetches complete.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(true);
  const initialLoadingReleased = useRef(false);
  const isFetchedRef = useRef<boolean>(false);

  const [details, setDetails] = useState<IndexDetails | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const columnsKey = useRef('');
  const [columnsIdentity, setColumnsIdentity] = useState('');
  const retryLoad = useCallback(() => { isFetchedRef.current = false; setRetryVersion(value => value + 1); }, []);
  
  const [formData, setFormData] = useState({
    targetSchema: schema || allSchemas[0] || 'public',
    targetTable: initialTable || '',
    indexName: indexName || '',
    indexType: 'NORMAL', 
    functionExpression: '', 
    isUnique: false
  });

  const updateFormField = useEventCallback(<K extends keyof typeof formData>(field: K, value: (typeof formData)[K]) => {
    if (isBusy() || formData[field] === value) return;
    if (field === 'targetSchema' || field === 'targetTable') {
      columnsKey.current = ''; setColumnsIdentity('');
      setAvailableColumns([]); setSelectedColumns([]); setTableColumns([]); setLeftSelected([]); setRightSelected([]);
    }
    setFormData(prev => {
      if (prev[field as keyof typeof prev] === value) return prev;
      const next = { ...prev, [field]: value };
      if (field === 'targetSchema') next.targetTable = '';
      if (field === 'indexType' && value === 'PRIMARY KEY') {
        next.isUnique = true;
      }
      return next;
    });
  });

  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  
  const [leftSelected, setLeftSelected] = useState<string[]>([]);
  const [lastLeftClicked, setLastLeftClicked] = useState<string | null>(null);
  const [rightSelected, setRightSelected] = useState<string[]>([]);
  const [lastRightClicked, setLastRightClicked] = useState<string | null>(null);

  const [leftDragState, setLeftDragState] = useState<{ isDragging: boolean, mode: 'select' | 'deselect' | null }>({ isDragging: false, mode: null });
  const [rightDragState, setRightDragState] = useState<{ isDragging: boolean, mode: 'select' | 'deselect' | null }>({ isDragging: false, mode: null });

  const [indexStats, setIndexStats] = useState<PgIndexStatistics | null>(null);

  useEffect(() => {
    if (isNew) setActiveTab(0);
  }, [isNew]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      let newWidth = window.innerWidth - e.clientX; 
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 800) newWidth = 800;
      setConsoleWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [isResizing]);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setLeftDragState({ isDragging: false, mode: null });
      setRightDragState({ isDragging: false, mode: null });
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  useEffect(() => {
    if (!isNew || !formData.targetSchema || !formData.targetTable) return;
    let cancelled = false;
    const key = JSON.stringify([formData.targetSchema, formData.targetTable]);
    columnsKey.current = ''; setColumnsIdentity(''); setLoadError(false);
    beginLoading();
    void (async () => {
      try {
        const result = await ipcRenderer.invoke('get-columns', formData.targetSchema, formData.targetTable, { skipGlobalLoader: true });
        if (cancelled) return;
        if (!result.success || !Array.isArray(result.columns) || !result.columns.length) throw new Error('Index columns are unavailable.');
        setAvailableColumns(result.columns); setTableColumns(result.columns); setSelectedColumns([]);
        setLeftSelected([]); setRightSelected([]); columnsKey.current = key; setColumnsIdentity(key);
      } catch { if (!cancelled) setLoadError(true); }
      finally { endLoading(); }
    })();
    return () => { cancelled = true; };
  }, [formData.targetSchema, formData.targetTable, isNew, retryVersion, beginLoading, endLoading]);

  useEffect(() => {
    if (isNew || !isActive) return;
    const identity = JSON.stringify([schema, indexName]);
    if (isFetchedRef.current && loadedIdentity === identity) return;
    let cancelled = false;
    beginLoading(); setLoadError(false);
    void (async () => {
      try {
        const next = await loadIndexDetails('postgresql', schema, indexName);
        if (cancelled) return;
        setFormData({ targetSchema: schema, targetTable: next.table, indexName,
          indexType: next.primary ? 'PRIMARY KEY' : next.expression ? 'FUNCTION' : 'NORMAL',
          functionExpression: next.expression, isUnique: next.unique,  });
        setSelectedColumns(next.keys); setTableColumns(next.keys); setAvailableColumns([]);
        setIndexStats(next.statistics); setDetails(next); setLoadedIdentity(identity);
        
        isFetchedRef.current = true;
      } catch { if (!cancelled) setLoadError(true); }
      finally { endLoading(); }
    })();
    return () => { cancelled = true; };
  }, [isNew, isActive, schema, indexName, retryVersion, loadedIdentity, beginLoading, endLoading]);

  // Release the initial loading guard after starting the requests above.
  useEffect(() => {
    if (!isActive || initialLoadingReleased.current) return;
    initialLoadingReleased.current = true;
    endLoading();
  }, [isActive, endLoading]);

  const handleLeftMouseDown = useCallback((e: React.MouseEvent, col: string) => {
    if (!isNew) return;
    setLeftSelected(prev => {
      if (e.ctrlKey || e.metaKey) {
        setLeftDragState({ isDragging: e.detail !== 0, mode: prev.includes(col) ? 'deselect' : 'select' });
        return prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      } else if (e.shiftKey && lastLeftClicked) {
        const startIdx = availableColumns.indexOf(lastLeftClicked);
        const endIdx = availableColumns.indexOf(col);
        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        const range = availableColumns.slice(minIdx, maxIdx + 1);
        setLeftDragState({ isDragging: e.detail !== 0, mode: 'select' });
        return Array.from(new Set([...prev, ...range]));
      } else {
        setLeftDragState({ isDragging: e.detail !== 0, mode: 'select' });
        return [col];
      }
    });
    setLastLeftClicked(col);
  }, [isNew, lastLeftClicked, availableColumns]);

  const handleLeftMouseEnter = useCallback((_e: React.MouseEvent, col: string) => {
    if (!isNew || !leftDragState.isDragging) return;
    setLeftSelected(prev => {
      if (leftDragState.mode === 'select' && !prev.includes(col)) {
        return [...prev, col];
      } else if (leftDragState.mode === 'deselect' && prev.includes(col)) {
        return prev.filter(c => c !== col);
      }
      return prev;
    });
    setLastLeftClicked(col);
  }, [isNew, leftDragState]);

  const handleRightMouseDown = useCallback((e: React.MouseEvent, col: string) => {
    if (!isNew) return;
    setRightSelected(prev => {
      if (e.ctrlKey || e.metaKey) {
        setRightDragState({ isDragging: e.detail !== 0, mode: prev.includes(col) ? 'deselect' : 'select' });
        return prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      } else if (e.shiftKey && lastRightClicked) {
        const startIdx = selectedColumns.indexOf(lastRightClicked);
        const endIdx = selectedColumns.indexOf(col);
        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        const range = selectedColumns.slice(minIdx, maxIdx + 1);
        setRightDragState({ isDragging: e.detail !== 0, mode: 'select' });
        return Array.from(new Set([...rightSelected, ...range]));
      } else {
        setRightDragState({ isDragging: e.detail !== 0, mode: 'select' });
        return [col];
      }
    });
    setLastRightClicked(col);
  }, [isNew, lastRightClicked, selectedColumns, rightSelected]);

  const handleRightMouseEnter = useCallback((_e: React.MouseEvent, col: string) => {
    if (!isNew || !rightDragState.isDragging) return;
    setRightSelected(prev => {
      if (rightDragState.mode === 'select' && !prev.includes(col)) {
        return [...prev, col];
      } else if (rightDragState.mode === 'deselect' && prev.includes(col)) {
        return prev.filter(c => c !== col);
      }
      return prev;
    });
    setLastRightClicked(col);
  }, [isNew, rightDragState]);

  const handleMoveRight = useCallback(() => {
    if (!isNew || isBusy() || leftSelected.length === 0) return;
    setAvailableColumns(prev => prev.filter(c => !leftSelected.includes(c)));
    setSelectedColumns(prev => [...prev, ...leftSelected]);
    setLeftSelected([]);
    setLastLeftClicked(null);
  }, [leftSelected, isNew, isBusy]);

  const handleMoveLeft = useCallback(() => {
    if (!isNew || isBusy() || rightSelected.length === 0) return;
    setSelectedColumns(prev => prev.filter(c => !rightSelected.includes(c)));
    setAvailableColumns(prev => [...prev, ...rightSelected]);
    setRightSelected([]);
    setLastRightClicked(null);
  }, [rightSelected, isNew, isBusy]);

  const handleLeftDoubleClick = useCallback((col: string) => {
    if (!isNew || isBusy() || !availableColumns.includes(col)) return;
    setAvailableColumns(prev => prev.filter(value => value !== col));
    setSelectedColumns(prev => prev.includes(col) ? prev : [...prev, col]);
    setLeftSelected(prev => prev.filter(value => value !== col));
  }, [isNew, isBusy, availableColumns]);
  const handleRightDoubleClick = useCallback((col: string) => {
    if (!isNew || isBusy() || !selectedColumns.includes(col)) return;
    setSelectedColumns(prev => prev.filter(value => value !== col));
    setAvailableColumns(prev => prev.includes(col) ? prev : [...prev, col]);
    setRightSelected(prev => prev.filter(value => value !== col));
  }, [isNew, isBusy, selectedColumns]);
  const moveColumn = (direction: -1 | 1) => {
    if (!isNew || isBusy() || rightSelected.length !== 1) return;
    const index = selectedColumns.indexOf(rightSelected[0]), target = index + direction;
    if (index < 0 || target < 0 || target >= selectedColumns.length) return;
    setSelectedColumns(prev => { const next = [...prev]; [next[index], next[target]] = [next[target], next[index]]; return next; });
  };
  const canExecute = !loadError && (isNew ? columnsIdentity === JSON.stringify([formData.targetSchema, formData.targetTable]) && !!columnsIdentity
    : !!details && loadedIdentity === JSON.stringify([schema, indexName]));

  const handleDelete = async () => {
    if (isBusy() || !canExecute || isNew) return;
    beginLoading();
    try {
      const fresh = await loadIndexDetails('postgresql', schema, indexName);
      if (fresh.ddl !== details?.ddl || fresh.table !== details.table || fresh.tableSchema !== details.tableSchema) {
        setLoadError(true); alert(t('index_changed_reload')); return;
      }
      const plan = indexDropPlan('postgresql', schema, indexName, fresh);
      if (plan.blocked) { alert(t(plan.blocked)); return; }
      const message = plan.constraint ? t('index_delete_constraint_confirm', { name: indexName, constraint: plan.constraint.name, table: `${plan.constraint.schema}.${plan.constraint.table}` })
        : t('index_delete_confirm', { schema, name: indexName });
      if (!window.confirm(message)) return;
      const result = await ipcRenderer.invoke('execute-sql', plan.sql);
      if (!result.success) throw new Error(result.error);
      try {
        await runGitOperation(t, 'git-delete-object', { dbType: 'POSTGRES', schema, objectType: 'INDEX', objectName: indexName });
      } catch (error) { console.error('Failed to delete the object from Git.', error); }
      alert(t('deleted'));
      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema, objType: 'INDEX' } }));
      window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
    } catch { setLoadError(true); alert(t('index_delete_failed')); }
    finally { endLoading(); }
  };

  const createSql = useMemo(() => {
    const safeSchema = formData.targetSchema || 'SCHEMA';
    const safeName = formData.indexName || 'NEW_INDEX';
    const safeTable = formData.targetTable || 'TABLE_NAME';
    
    let cols = '';
    if (formData.indexType === 'FUNCTION') {
      cols = formData.functionExpression || 'expression';
    } else {
      cols = selectedColumns.length > 0 ? selectedColumns.map(quoteIdentifier).join(',\n  ') : 'column_name';
    }
    
    if (formData.indexType === 'PRIMARY KEY') {
      return `ALTER TABLE ${quoteIdentifier(safeSchema)}.${quoteIdentifier(safeTable)}\n  ADD CONSTRAINT ${quoteIdentifier(safeName)} PRIMARY KEY (\n  ${cols}\n);`;
    }

    let sqlText = `CREATE`;
    if (formData.isUnique) sqlText += ` UNIQUE`;
    
    sqlText += ` INDEX ${quoteIdentifier(safeName)}\nON ${quoteIdentifier(safeSchema)}.${quoteIdentifier(safeTable)} (\n  ${cols}\n)`;
    
    return sqlText + ';';
  }, [formData, selectedColumns]);

  const alterSql = useMemo(() => {
    const safeSchema = formData.targetSchema || 'SCHEMA';
    const oldName = indexName || 'OLD_INDEX';
    const newName = formData.indexName || 'NEW_INDEX';
    
    const statements = [];

    if (newName !== oldName) {
      statements.push(`ALTER INDEX ${quoteIdentifier(safeSchema)}.${quoteIdentifier(oldName)} RENAME TO ${quoteIdentifier(newName)}`);
    }

    if (statements.length > 0) {
      return statements.join(';\n\n') + ';';
    }

    return t("postgres_index_unchanged_hint");
  }, [formData, indexName, t]);

  const handleExecute = async () => {
    if (isBusy() || !canExecute || (isNew && columnsKey.current !== JSON.stringify([formData.targetSchema, formData.targetTable]))) return;
    if (!formData.indexName) { alert(t("please_enter_an_index_name")); return; }
    if (isNew && !formData.targetTable) { alert(t("please_select_a_target_table")); return; }
    
    if (isNew && (formData.indexType === 'NORMAL' || formData.indexType === 'PRIMARY KEY') && selectedColumns.length === 0) { 
      alert(t("please_select_at_least_one_column_for_the_index"));
      return; 
    }
    if (isNew && formData.indexType === 'FUNCTION') {
      const expr = formData.functionExpression.trim();
      if (!expr) { 
        alert(t("please_enter_a_function_expression"));
        return; 
      }
      const openCount = (expr.match(/\(/g) || []).length;
      const closeCount = (expr.match(/\)/g) || []).length;
      if (openCount !== closeCount) {
        alert(t("mismatched_parentheses_and_in_the_function_expression_please_check"));
        return;
      }
    }

    beginLoading();
    const timestamp = new Date().toLocaleString('ja-JP');
    const executionSql = isNew ? createSql : alterSql;

    if (!isNew && alterSql.includes(t("no_changes"))) {
      alert(t("no_changes_found"));
      endLoading();
      return;
    }

    try {
      const statements = splitSqlScript(executionSql, 'postgresql').map(statement => statement.text);
      if (!statements.length) { alert(t('no_changes_found')); return; }
      let hasError = false;

      for (const stmt of statements) {
        const res = await ipcRenderer.invoke('execute-sql', stmt);
        if (res.success) {
          setLogs(prev => [{ time: timestamp, sql: stmt, resultMsg: t("success") }, ...prev]);
        } else {
          setLogs(prev => [{ time: timestamp, sql: stmt, resultMsg: t("error_occurred"), errorLines: [res.error] }, ...prev]);
          alert(t("an_error_occurred_please_check_the_right_console"));
          setIsConsoleOpen(true);
          hasError = true;
          break; 
        }
      }

      if (!hasError) {
        if (!isNew && formData.indexName === indexName) retryLoad();
        if (!isNew && formData.indexName !== indexName) {
          try {
            await runGitOperation(t, 'git-rename-object', {
              dbType: 'POSTGRES',
              schema: formData.targetSchema,
              objectType: 'INDEX',
              oldName: indexName,
              newName: formData.indexName
            });
          } catch (e) {
            console.error("Failed to rename the object in Git.", e);
          }
        }

        window.dispatchEvent(new CustomEvent('refresh-sidebar', { 
          detail: { schema: formData.targetSchema, objType: 'INDEX' } 
        }));

        if (isNew || formData.indexName !== indexName) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('index-created', {
              detail: { tabId: tabId, schema: formData.targetSchema, indexName: formData.indexName }
            }));
          }, 50);
          setTimeout(() => alert(t("index_3") + formData.indexName + t("separator") + (isNew ? t("create") : t("change")) + t("completed_2")), 150);
        } else {
          setTimeout(() => alert(t("index_3") + formData.indexName + t("updated")), 150);
        }
      }

    } catch (e: unknown) {
      setLogs(prev => [{ time: timestamp, sql: executionSql, resultMsg: t("connection_error_4"), errorLines: [getErrorMessage(e)] }, ...prev]);
      alert(t("connection_error_occurred_check_the_console"));
      setIsConsoleOpen(true);
    } finally {
      endLoading();
    }
  };

  const statColumns: GridColDef[] = useMemo(() => [
    { field: 'property', headerName: t("item_name"), width: 350 },
    { field: 'value', headerName: t("value"), flex: 1 }
  ], [t]);

  const statRows = useMemo(() => {
    if (!indexStats) return [];
    
    const formatDate = (val: unknown) => {
      if (!val) return t("unfetched");
      if (val instanceof Date) return val.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return String(val);
    };

    return [
      { id: 1, property: t("index_size"), value: indexStats.index_size ?? t("unfetched") },
      { id: 2, property: t("index_scans_idx_scan"), value: indexStats.idx_scan ?? t("unfetched") },
      { id: 3, property: t("rows_read_via_index_idx_tup_read"), value: indexStats.idx_tup_read ?? t("unfetched") },
      { id: 4, property: t("rows_fetched_via_index_idx_tup_fetch"), value: indexStats.idx_tup_fetch ?? t("unfetched") },
      { id: 5, property: t("blocks_read_from_disk_idx_blks_read"), value: indexStats.idx_blks_read ?? t("unfetched") },
      { id: 6, property: t("buffer_block_hits_idx_blks_hit"), value: indexStats.idx_blks_hit ?? t("unfetched") },
      { id: 7, property: t("last_analyze_time_last_analyze"), value: formatDate(indexStats.last_analyze) },
      { id: 8, property: t("last_auto_analyze_time_last_autoanalyze"), value: formatDate(indexStats.last_autoanalyze) },
      { id: 9, property: t("last_vacuum_time_last_vacuum"), value: formatDate(indexStats.last_vacuum) },
      { id: 10, property: t("last_auto_vacuum_time_last_autovacuum"), value: formatDate(indexStats.last_autovacuum) },
    ];
  }, [indexStats, t]);

  return {
    activeTab, setActiveTab, bottomTab, setBottomTab,
    logs, setLogs, isConsoleOpen, setIsConsoleOpen,
    consoleWidth, isResizing, setIsResizing,
    isLoading, formData, updateFormField, loadError, retryLoad, canExecute, moveColumn, details,
    sourceSql: isNew ? createSql : loadedIdentity === JSON.stringify([schema, indexName]) ? details?.ddl || '' : '',
    availableColumns, selectedColumns, tableColumns,
    leftSelected, rightSelected, indexStats,
    handleLeftMouseDown, handleLeftMouseEnter,
    handleRightMouseDown, handleRightMouseEnter,
    handleMoveRight, handleMoveLeft,
    handleLeftDoubleClick, handleRightDoubleClick,
    handleDelete, handleExecute,
    createSql, alterSql,
    statColumns, statRows
  };
};
