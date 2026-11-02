// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useWorkspacePanelWidth } from '@/shared/hooks/useWorkspacePanelWidth';
import { notify } from '@/shared/utils/notifications';
import type { PgSchemaChange } from '@/shared/types/postgresSchemaTypes';
import { getPgSelectSchema, savePgSelectSchema } from '@/features/postgresql/windows/common/schemaStorage';
import { useTableOpening } from '@/features/table/useTableOpening';
import { parseTriggerTab, triggerTabKey, type PgTriggerIdentity } from './triggerIdentity';
import { useWorkspaceTabs } from '@/shared/hooks/useWorkspaceTabs';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { qualifiedObjectName, parseObjectIdentity } from '@/shared/utils/objectIdentity';
import type { ObjectIdentity } from '@/shared/types/objectTypes';
import { parseRoutineTab, routineTabKey } from './routineIdentity';
import { deleteAiHistoryForObject } from "../ai/aiHistoryCleanup";
import type { StoredIdentity } from "../stored/storedCreation";
import type { ConnectionConfig, AppSettings } from '@/shared/types/appTypes';
import type { AiContext } from '@/shared/types/aiTypes';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useGlobalGit } from "../git/useGlobalGit";
import { useAiSettings } from "../ai/useAiSettings";
import { ipcRenderer, subscribeTransactionState, resetGlobalLoading } from '@/shared/api/desktop';

export interface TabInfo {
  id: number;
  type: 'sql' | 'table' | 'create-table' | 'view' | 'sequence' | 'create-sequence' | 'stored' | 'create-stored' | 'package' | 'trigger' | 'create-trigger' | 'dblink' | 'create-dblink' | 'synonym' | 'create-synonym' | 'mview' | 'create-mview' | 'mview-log' | 'create-mview-log' | 'index' | 'create-index' | 'constraint' | 'create-constraint' | 'type' | 'object-privilege' | 'user-role' | 'directory' | 'tablespace' | 'session' | 'lock' | 'builder' | 'data-generator' | 'pdb-manager' | 'bi' | 'schema-manager' | 'er-diagram';
  title: string;
  initialSql: string;
  objectIdentity?: ObjectIdentity;
  fullObjectName?: string;
  storedIdentity?: StoredIdentity;
  triggerIdentity?: PgTriggerIdentity;
}

export const useAppPostgresql = (config: ConnectionConfig, settings: AppSettings, initialSchemas: string[]) => {
  const { t } = useTranslation();
  const { tabs, setTabs, activeTabId, setActiveTabId, openTab } = useWorkspaceTabs<TabInfo>([{ id: 1, type: 'sql', title: 'SQL 1', initialSql: 'SELECT current_timestamp;' }], () => notify(t("maximum_tabs_reached", { max: settings.maxTabs }), { severity: 'info' }));

  const [localSchemas, setLocalSchemas] = useState<string[]>(initialSchemas);
  const [expandedSchemas, setExpandedSchemas] = useState<string[]>([]);
  const [hasUncommittedTx, setHasUncommittedTx] = useState<boolean>(false);

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [sidebarWidth, setSidebarWidth] = useWorkspacePanelWidth('postgresql', 'sidebar', 270);
  const [isSidebarResizing, setIsSidebarResizing] = useState<boolean>(false);

  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState<boolean>(false);
  const aiSidebarOpenRef = useRef(isAiSidebarOpen);
  aiSidebarOpenRef.current = isAiSidebarOpen;
  const [aiSidebarWidth, setAiSidebarWidth] = useWorkspacePanelWidth('postgresql', 'ai', 300);
  const [isAiSidebarResizing, setIsAiSidebarResizing] = useState<boolean>(false);

  const [aiContext, setAiContext] = useState<AiContext | null>(null);
  const aiContextRef = useRef(aiContext);
  aiContextRef.current = aiContext;

  const handleStoredCreated = useCallback((tabId: number, identity: StoredIdentity) => {
    setTabs(previous => previous.map(tab => tab.id === tabId ? {
      ...tab, type: 'stored' as const, storedIdentity: identity,
      fullObjectName: routineTabKey(identity),
      initialSql: `${identity.schema}.${identity.objectName}:${identity.objectType}`,
      title: `${identity.objectType === 'PROCEDURE' ? t("procedure") : t("function")} ${identity.objectName}`
    } : tab));
  }, [setTabs, t]);

  const handleOpenAiSidebar = useCallback((context: AiContext | null, targetTabId?: number) => {
    const ownerId = targetTabId ?? context?.targetTabId;
    // Do not replace the current conversation with a request from a window closed during preparation.
    if (ownerId !== undefined && !tabsRef.current.some(tab => tab.id === ownerId)) return false;
    const confirmation = (aiContextRef.current?.historyTarget || aiContextRef.current?.codingResponse)?.getHistoryIdentity?.()
      ? t("confirm_switch_ai_and_save")
      : t("confirm_switch_ai_and_reset");
    if (aiSidebarOpenRef.current && !window.confirm(confirmation)) return false;
    // Require confirmation even when another request arrives during the same render.
    aiSidebarOpenRef.current = true;
    setAiContext(context ? { ...context, targetTabId: ownerId, requestId: crypto.randomUUID() } : null);
    setIsAiSidebarOpen(true);
    return true;
  }, [t]);

  const openAiSidebarRef = useRef(handleOpenAiSidebar);
  openAiSidebarRef.current = handleOpenAiSidebar;
  const aiTabHandlersRef = useRef(new Map<number, (context: AiContext | null) => boolean>());
  const getOpenAiSidebarForTab = useCallback((tabId: number) => {
    let handler = aiTabHandlersRef.current.get(tabId);
    if (!handler) {
      handler = context => openAiSidebarRef.current(context, tabId);
      aiTabHandlersRef.current.set(tabId, handler);
    }
    return handler;
  }, []);


  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [dbaMenuAnchorEl, setDbaMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [settingsMenuAnchorEl, setSettingsMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [gitMenuAnchorEl, setGitMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [helpMenuAnchorEl, setHelpMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [aboutDialogOpen, setAboutDialogOpen] = useState<boolean>(false);

  const gitLogic = useGlobalGit({
    setIsGlobalLoading: (isLoading) => {
      window.dispatchEvent(new CustomEvent('toggle-global-loader', { detail: isLoading }));
    },
    onMenuClose: () => setGitMenuAnchorEl(null)
  });

  const aiLogic = useAiSettings();

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  useEffect(() => {
    const liveIds = new Set(tabs.map(tab => tab.id));
    for (const id of aiTabHandlersRef.current.keys()) {
      if (!liveIds.has(id)) aiTabHandlersRef.current.delete(id);
    }
    const ownerId = aiContext?.targetTabId;
    if (ownerId === undefined || liveIds.has(ownerId)) return;
    aiContext?.sqlResponse?.cancel();
    aiContext?.codingResponse?.cancel();
    aiSidebarOpenRef.current = false;
    setAiContext(null);
    setIsAiSidebarOpen(false);
  }, [tabs, aiContext]);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const [tabContextMenu, setTabContextMenu] = useState<{ mouseX: number; mouseY: number; tabId: number; tabIndex: number } | null>(null);
  const [dirtyTabs, setDirtyTabs] = useState<Record<number, boolean>>({});

  useEffect(() => {
    return subscribeTransactionState(setHasUncommittedTx);
  }, []);

  useEffect(() => {
    setLocalSchemas(initialSchemas);
  }, [initialSchemas]);

  const expandedSchemasRef = useRef<string[]>([]);
  useEffect(() => {
    expandedSchemasRef.current = expandedSchemas;
  }, [expandedSchemas]);

  useEffect(() => {
    if (!config.user) return;

    const dbName = config.database || 'default';
    const storageKey = `pg_expandedSchemas_${dbName}_${config.user}`;

    const saved = localStorage.getItem(storageKey);
    let initialExpanded: string[] = [];

    if (saved !== null) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          initialExpanded = parsed;
        }
      } catch (e) {
        console.error("Failed to parse expandedSchemas", e);
      }
    } else {
      initialExpanded = [config.user.toLowerCase()];
    }

    setExpandedSchemas(initialExpanded);
    expandedSchemasRef.current = initialExpanded;

    setTimeout(() => {
      const targetSchema = initialExpanded[initialExpanded.length - 1];
      if (targetSchema) {
        const element = document.getElementById(`schema-${targetSchema}`);
        if (element) element.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    }, 300);

    const handleSave = () => {
      localStorage.setItem(storageKey, JSON.stringify(expandedSchemasRef.current));
    };

    window.addEventListener('beforeunload', handleSave);

    return () => {
      window.removeEventListener('beforeunload', handleSave);
      handleSave();
    };
  }, [config.user, config.database]);

  useEffect(() => {
    let alive = true, generation = 0;
    const handleRefreshSchemas = async (event: Event) => {
      const version = ++generation;
      const change = (event as CustomEvent<Partial<PgSchemaChange>>).detail;
      try {
        const res = await ipcRenderer.invoke('get-schemas', false, false);
        if (!alive || version !== generation || !res.success || !res.schemas) return;
        const next = [...new Set(res.schemas)];
        setLocalSchemas(next);
        const renamed = change?.action === 'rename' && typeof change.oldName === 'string' && typeof change.newName === 'string' && !next.includes(change.oldName) && next.includes(change.newName);
        const expanded = [...new Set(expandedSchemasRef.current.map(name => renamed && name === change.oldName ? change.newName as string : name).filter(name => next.includes(name)))];
        expandedSchemasRef.current = expanded; setExpandedSchemas(expanded);
        const database = config.database || 'default';
        if (config.user) {
          localStorage.setItem(`pg_expandedSchemas_${database}_${config.user}`, JSON.stringify(expanded));
          const saved = getPgSelectSchema(database, config.user);
          if (saved && !next.includes(saved)) {
            const replacement = renamed && saved === change.oldName ? change.newName as string : next.includes(config.user) ? config.user : next[0];
            if (replacement) savePgSelectSchema(database, config.user, replacement);
            else localStorage.removeItem(`pg_select_schema_${database}_${config.user}`);
          }
        }
      } catch { console.error('Could not refresh schema navigation state.'); }
    };
    window.addEventListener('refresh-schemas', handleRefreshSchemas);
    return () => { alive = false; generation++; window.removeEventListener('refresh-schemas', handleRefreshSchemas); };
  }, [config.database, config.user]);

  const startSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarResizing(true);
  }, []);

  const startAiSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsAiSidebarResizing(true);
  }, []);

  useEffect(() => {
    const previousCursor = (isSidebarResizing || isAiSidebarResizing) ? document.body.style.cursor : '';
    const handleMouseMove = (e: MouseEvent) => {
      if (isSidebarResizing) {
        setSidebarWidth(e.clientX);
      } else if (isAiSidebarResizing) {
        setAiSidebarWidth(window.innerWidth - e.clientX);
      }
    };

    const handleMouseUp = () => {
      if (isSidebarResizing || isAiSidebarResizing) {
        setIsSidebarResizing(false);
        setIsAiSidebarResizing(false);
        document.body.style.cursor = previousCursor;
      }
    };

    if (isSidebarResizing || isAiSidebarResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      if (isSidebarResizing || isAiSidebarResizing) document.body.style.cursor = previousCursor;
    };
  }, [isSidebarResizing, isAiSidebarResizing, setSidebarWidth, setAiSidebarWidth]);

  const toggleSchema = (schema: string) => {
    setExpandedSchemas(prev => {
      const newSchemas = prev.includes(schema) ? prev.filter(s => s !== schema) : [...prev, schema];
      expandedSchemasRef.current = newSchemas;
      return newSchemas;
    });
  };

  const handleCommit = async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const res = await ipcRenderer.invoke('commit-db');
    if (res.success) {
      notify(t("transaction_committed_saved"), { severity: 'success' });
    } else {
      notify(t("commit_error") + res.error);
    }
  };

  const handleRollback = async () => {
    await new Promise(resolve => setTimeout(resolve, 300));
    const res = await ipcRenderer.invoke('rollback-db');
    if (res.success) {
      notify(t("transaction_rolled_back_canceled"), { severity: 'success' });
    } else {
      notify(t("rollback_error") + res.error);
    }
  };

  const handleCancelExecution = async () => {
    if (window.confirm(t("force_abort_currently_running_process_use_only_if_unresponsive"))) {
      window.dispatchEvent(new Event('cancel-sql-script'));
      const res = await ipcRenderer.invoke('cancel-execution');
      if (res.success) {
        notify(t("running_process_aborted"), { severity: 'success' });
        resetGlobalLoading();
      } else {
        notify(t("failed_to_abort_or_no_process_is_currently_running") + (res.error || ''));
      }
    }
  };

  const handleDirtyStateChange = useCallback((tabId: number, isDirty: boolean) => {
    setDirtyTabs(prev => {
      if (prev[tabId] === isDirty) return prev;
      const next = { ...prev };
      if (isDirty) next[tabId] = true;
      else delete next[tabId];
      return next;
    });
  }, []);

  const executeCloseTab = useCallback((idToClose: number) => {
    setTabs(previous => previous.filter(tab => tab.id !== idToClose));
    setDirtyTabs(prev => {
      const next = { ...prev };
      delete next[idToClose];
      return next;
    });
  }, [setTabs]);

  const requestCloseTab = useEventCallback((id: number) => {
    if (dirtyTabs[id] && !window.confirm(t("there_are_unsaved_changes_are_you_sure_you_want_to_close_the_tab"))) return;
    executeCloseTab(id);
  });
  const removeMatchingTabs = useEventCallback((matches: (tab: TabInfo) => boolean) => {
    const ids = tabs.filter(matches).map(tab => tab.id);
    setTabs(previous => previous.filter(tab => !matches(tab)));
    setDirtyTabs(previous => {
      const next = { ...previous };
      ids.forEach(id => delete next[id]);
      return next;
    });
  });

  const openTable = useTableOpening();
  const addTab = useCallback((type: TabInfo['type'], fullObjectName?: string, customInitialSql?: string) => {
    const triggerIdentity = type === 'trigger' ? parseTriggerTab(fullObjectName) : undefined;
    const routineIdentity = type === 'stored' ? parseRoutineTab(fullObjectName) : undefined;
    const objectIdentity = fullObjectName && !type.startsWith('create-') && ['table', 'view', 'sequence', 'stored', 'package', 'trigger', 'dblink', 'synonym', 'mview', 'mview-log', 'index', 'constraint', 'type'].includes(type)
      ? triggerIdentity ?? routineIdentity ?? parseObjectIdentity(fullObjectName) : undefined;
    if (objectIdentity && !routineIdentity && !triggerIdentity) fullObjectName = qualifiedObjectName(objectIdentity);
    openTab((prevTabs, nextId) => {
      if (['object-privilege', 'user-role', 'directory', 'tablespace', 'session', 'lock', 'builder', 'data-generator', 'pdb-manager', 'bi', 'schema-manager', 'er-diagram'].includes(type)) {
        const existingTab = prevTabs.find(t => t.type === type);
        if (existingTab) {
          return { existingId: existingTab.id };
        }
      } else if (type !== 'sql' && fullObjectName) {
        let existingTab;
        if (type === 'create-stored') {
           existingTab = prevTabs.find(tab => tab.type === type && tab.fullObjectName === fullObjectName && tab.initialSql.endsWith(':' + (customInitialSql || 'FUNCTION')));
        } else if (type === 'package') {
           existingTab = prevTabs.find(t => t.type === type && t.fullObjectName === fullObjectName && t.initialSql.includes(customInitialSql || ''));
        } else {
           existingTab = prevTabs.find(t => t.type === type && t.fullObjectName === fullObjectName);
        }

        if (existingTab) {
          return { existingId: existingTab.id };
        }
      }

      if (prevTabs.length >= settings.maxTabs) {
        return { limitReached: true };
      }


      let defaultSql = '';
      let title = `SQL ${nextId}`;

      const shortName = routineIdentity ? routineIdentity.objectName : objectIdentity ? objectIdentity.objectName : fullObjectName ? (fullObjectName.includes('.') ? fullObjectName.split('.')[1] : (fullObjectName.includes(':') ? (fullObjectName.split(':')[1] || fullObjectName.split(':')[0]) : fullObjectName)) : '';

      if (customInitialSql && type !== 'stored' && type !== 'create-stored' && type !== 'package' && type !== 'constraint') {
        defaultSql = customInitialSql;
      } else if (type === 'table' && fullObjectName) {
        defaultSql = `SELECT * FROM ${fullObjectName}`;
        title = `${t("table")} ${shortName}`;
      } else if (type === 'view' && fullObjectName) {
        defaultSql = `SELECT * FROM ${fullObjectName}`;
        title = `${t("view")} ${shortName}`;
      } else if (type === 'sequence' && fullObjectName) {
        defaultSql = ``;
        title = `${t("sequence_2")} ${shortName}`;
      } else if (type === 'create-sequence' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_sequence");
      } else if (type === 'create-stored' && fullObjectName) {
        defaultSql = `${fullObjectName}:${customInitialSql || 'FUNCTION'}`;
        title = customInitialSql === 'PROCEDURE' ? t("new_procedure") : t("new_function");
      } else if (type === 'stored' && fullObjectName) {
        defaultSql = `${fullObjectName}:${customInitialSql || 'FUNCTION'}`;
        const objTypeLabel = customInitialSql === 'PROCEDURE' ? t("procedure") : t("function");
        title = `${objTypeLabel}${shortName}`;
      } else if (type === 'package' && fullObjectName) {
        defaultSql = `${fullObjectName}:${customInitialSql || 'PACKAGE'}`;
        const isBody = customInitialSql === 'PACKAGE BODY';
        title = `${isBody ? t("package_body") : t("package_spec")} ${shortName}`;
      } else if (type === 'create-table' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_table");
      } else if (type === 'trigger' && fullObjectName) {
        defaultSql = ``;
        title = `${t("trigger")} ${shortName}`;
      } else if (type === 'create-trigger' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_trigger");
      } else if (type === 'dblink' && fullObjectName) {
        defaultSql = ``;
        title = `${t("db_link_2")} ${shortName}`;
      } else if (type === 'create-dblink' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_db_link");
      } else if (type === 'synonym' && fullObjectName) {
        defaultSql = ``;
        title = `${t("synonym")} ${shortName}`;
      } else if (type === 'create-synonym' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_synonym");
      } else if (type === 'mview' && fullObjectName) {
        defaultSql = ``;
        title = `${t("mview_2")} ${shortName}`;
      } else if (type === 'create-mview' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_mview");
      } else if (type === 'mview-log' && fullObjectName) {
        defaultSql = ``;
        title = `${t("mview_log")} ${shortName}`;
      } else if (type === 'create-mview-log' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_mview_log");
      } else if (type === 'index' && fullObjectName) {
        defaultSql = ``;
        title = `${t("index")} ${shortName}`;
      } else if (type === 'create-index' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_index");
      } else if (type === 'constraint' && fullObjectName) {
        defaultSql = customInitialSql || '';
        title = `${t("check_constraint")} ${shortName}`;
      } else if (type === 'create-constraint' && fullObjectName) {
        defaultSql = fullObjectName;
        title = t("new_check_constraint");
      } else if (type === 'type' && fullObjectName) {
        defaultSql = ``;
        title = `${t("type")} ${shortName}`;
      } else if (type === 'object-privilege') {
        defaultSql = ``;
        title = t("dba_object_privileges");
      } else if (type === 'user-role') {
        defaultSql = ``;
        title = t("dba_user_settings");
      } else if (type === 'tablespace') {
        defaultSql = ``;
        title = t("dba_tablespaces");
      } else if (type === 'session') {
        defaultSql = ``;
        title = t("dba_session_management");
      } else if (type === 'lock') {
        defaultSql = ``;
        title = t("dba_lock_management");
      } else if (type === 'builder') {
        defaultSql = ``;
        title = t("query_builder");
      } else if (type === 'data-generator') {
        defaultSql = ``;
        title = t("data_generator");
      } else if (type === 'bi') {
        defaultSql = ``;
        title = t("cross_tabulation");
      } else if (type === 'schema-manager') {
        defaultSql = ``;
        title = t("dba_schema_management");
      } else if (type === 'er-diagram') {
        defaultSql = ``;
        title = t("er_diagram_viewer");
      }

      if (triggerIdentity) title += ` (${triggerIdentity.tableName})`;
      const newTab: TabInfo = { id: nextId, type, title, initialSql: defaultSql, objectIdentity, fullObjectName, storedIdentity: routineIdentity, triggerIdentity };
      return { tab: newTab };
    });
  }, [openTab, settings.maxTabs, t]);
  const handleAddTab = useCallback((...args: Parameters<typeof addTab>) => {
    if (args[0] === 'table') void openTable(() => addTab(...args));
    else addTab(...args);
  }, [addTab, openTable]);


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.shiftKey || e.altKey || e.isComposing || (typeof document !== 'undefined' && document.querySelector('[role=dialog]'))) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); handleAddTab('sql'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'q') { e.preventDefault(); handleAddTab('builder'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); handleAddTab('bi'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); handleAddTab('data-generator'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') { e.preventDefault(); handleAddTab('er-diagram'); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAddTab]);

  useEffect(() => {
    const handleTableCreated = (e: WindowEventMap['table-created']) => {
      const { tabId, schema, tableName } = e.detail;
      executeCloseTab(tabId);
      handleAddTab('table', qualifiedObjectName({ schema: schema, objectName: tableName }));
    };
    const handleSequenceCreated = (e: WindowEventMap['sequence-created']) => {
      const { tabId, schema, sequenceName } = e.detail;
      if (sequenceName) {
        executeCloseTab(tabId);
        handleAddTab('sequence', qualifiedObjectName({ schema: schema, objectName: sequenceName }));
      }
    };
    const handleTriggerCreated = (e: WindowEventMap['trigger-created']) => {
      const { tabId, schema, triggerName, tableName } = e.detail;
      if (triggerName) {
        executeCloseTab(tabId);
        handleAddTab('trigger', tableName ? triggerTabKey({ schema, tableName, objectName: triggerName }) : qualifiedObjectName({ schema, objectName: triggerName }));
      }
    };
    const handleDbLinkCreated = (e: WindowEventMap['dblink-created']) => {
      const { tabId, schema, linkName } = e.detail;
      if (linkName) {
        executeCloseTab(tabId);
        handleAddTab('dblink', qualifiedObjectName({ schema: schema, objectName: linkName }));
      }
    };
    const handleSynonymCreated = (e: WindowEventMap['synonym-created']) => {
      const { tabId, schema, synonymName } = e.detail;
      if (synonymName) {
        executeCloseTab(tabId);
        handleAddTab('synonym', qualifiedObjectName({ schema: schema, objectName: synonymName }));
      }
    };
    const handleMViewCreated = (e: WindowEventMap['mview-created']) => {
      const { tabId, schema, mviewName } = e.detail;
      if (mviewName) {
        executeCloseTab(tabId);
        handleAddTab('mview', qualifiedObjectName({ schema: schema, objectName: mviewName }));
      }
    };
    const handleMViewLogCreated = (e: WindowEventMap['mview-log-created']) => {
      const { tabId, schema, tableName } = e.detail;
      if (tableName) {
        executeCloseTab(tabId);
        handleAddTab('mview-log', qualifiedObjectName({ schema: schema, objectName: tableName }));
      }
    };
    const handleIndexCreated = (e: WindowEventMap['index-created']) => {
      const { tabId, schema, indexName } = e.detail;
      if (indexName) {
        executeCloseTab(tabId);
        handleAddTab('index', qualifiedObjectName({ schema: schema, objectName: indexName }));
      }
    };
    const handleConstraintCreated = (e: WindowEventMap['constraint-created']) => {
      const { tabId, schema, tableName, constraintName } = e.detail;
      if (constraintName) {
        executeCloseTab(tabId);
        handleAddTab('constraint', qualifiedObjectName({ schema: schema, objectName: constraintName }), tableName);
      }
    };

    const handleCloseTabEvent = (e: WindowEventMap['close-tab']) => {
      if (e.detail.tabId) requestCloseTab(e.detail.tabId);
    };

    const handleObjectDeleted = (e: WindowEventMap['object-deleted']) => {
      const { schema, objectName, objectType } = e.detail;
      void deleteAiHistoryForObject('postgresql', schema, objectName, objectType, e.detail.reason, e.detail.signature, e.detail.tableName, config.aiHistoryScope).catch((error: unknown) => {
        notify(t("failed_to_delete_ai_conversation_history") + '\n' + (error instanceof Error ? error.message : String(error)));
      });
      const fullObjectName = qualifiedObjectName({ schema: schema, objectName: objectName });

      removeMatchingTabs((t: TabInfo) => {
          if (t.triggerIdentity && objectType === 'TRIGGER') return t.triggerIdentity.schema === schema && t.triggerIdentity.objectName === objectName && t.triggerIdentity.tableName === e.detail.tableName;
          if (t.storedIdentity && t.storedIdentity.schema === schema && t.storedIdentity.objectName === objectName && t.storedIdentity.objectType === objectType &&
              (e.detail.signature === undefined || t.storedIdentity.signature === e.detail.signature)) return true;
          if (t.fullObjectName === fullObjectName) {
            if (objectType === 'TABLE' && t.type === 'table') return true;
            if (objectType === 'VIEW' && t.type === 'view') return true;
            if (objectType === 'SEQUENCE' && t.type === 'sequence') return true;
            if (objectType === 'TRIGGER' && t.type === 'trigger') return true;
            if ((objectType === 'FUNCTION' || objectType === 'PROCEDURE') && t.type === 'stored') return true;
            if ((objectType === 'PACKAGE' || objectType === 'PACKAGE BODY') && t.type === 'package') return true;
            if (objectType === 'DATABASE LINK' && t.type === 'dblink') return true;
            if (objectType === 'SYNONYM' && t.type === 'synonym') return true;
            if (objectType === 'MATERIALIZED VIEW' && t.type === 'mview') return true;
            if (objectType === 'MATERIALIZED VIEW LOG' && t.type === 'mview-log') return true;
            if (objectType === 'INDEX' && t.type === 'index') return true;
            if (objectType === 'CONSTRAINT' && t.type === 'constraint') return true;
            if (objectType === 'TYPE' && t.type === 'type') return true;
          }
          return false;
      });
    };

    const handleOpenTableTab = (e: WindowEventMap['open-table-tab']) => {
      const { tableName, targetTab } = e.detail;
      if (tableName) {
        const defaultSchema = config.user === 'postgres' ? 'public' : config.user;
        const fullTableName = qualifiedObjectName(parseObjectIdentity(tableName, defaultSchema));
        handleAddTab('table', fullTableName);
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('force-change-table-tab', { detail: { fullTableName, targetTab } }));
        }, 300);
      }
    };
    const handleOpenCreateIndexTab = (e: WindowEventMap['open-create-index-tab']) => { handleAddTab('create-index', `${e.detail.schema}:${e.detail.tableName}`); };
    const handleOpenEditIndexTab = (e: WindowEventMap['open-edit-index-tab']) => { handleAddTab('index', qualifiedObjectName({ schema: e.detail.schema, objectName: e.detail.indexName })); };
    const handleOpenCreateTriggerTab = (e: WindowEventMap['open-create-trigger-tab']) => { handleAddTab('create-trigger', `${e.detail.schema}:${e.detail.tableName}`); };
    const handleOpenEditTriggerTab = (e: WindowEventMap['open-edit-trigger-tab']) => { handleAddTab('trigger', qualifiedObjectName({ schema: e.detail.schema, objectName: e.detail.triggerName })); };
    const handleOpenCreateConstraintTab = (e: WindowEventMap['open-create-constraint-tab']) => { handleAddTab('create-constraint', `${e.detail.schema}:${e.detail.tableName}`); };
    const handleOpenEditConstraintTab = (e: WindowEventMap['open-edit-constraint-tab']) => { handleAddTab('constraint', qualifiedObjectName({ schema: e.detail.schema, objectName: e.detail.constraintName }), e.detail.tableName); };
    const handleOpenSqlTab = (e: WindowEventMap['open-sql-tab']) => { handleAddTab('sql', undefined, e.detail.initialSql); };

    const handleOpenMviewTab = (e: WindowEventMap['open-mview-tab']) => {
      if (e.detail.schema && e.detail.mviewName) {
        handleAddTab('mview', qualifiedObjectName({ schema: e.detail.schema, objectName: e.detail.mviewName }));
      }
    };

    window.addEventListener('table-created', handleTableCreated);
    window.addEventListener('sequence-created', handleSequenceCreated);
    window.addEventListener('trigger-created', handleTriggerCreated);
    window.addEventListener('dblink-created', handleDbLinkCreated);
    window.addEventListener('synonym-created', handleSynonymCreated);
    window.addEventListener('mview-created', handleMViewCreated);
    window.addEventListener('mview-log-created', handleMViewLogCreated);
    window.addEventListener('index-created', handleIndexCreated);
    window.addEventListener('constraint-created', handleConstraintCreated);
    window.addEventListener('close-tab', handleCloseTabEvent);
    window.addEventListener('object-deleted', handleObjectDeleted);
    window.addEventListener('open-table-tab', handleOpenTableTab);
    window.addEventListener('open-create-index-tab', handleOpenCreateIndexTab);
    window.addEventListener('open-edit-index-tab', handleOpenEditIndexTab);
    window.addEventListener('open-create-trigger-tab', handleOpenCreateTriggerTab);
    window.addEventListener('open-edit-trigger-tab', handleOpenEditTriggerTab);
    window.addEventListener('open-create-constraint-tab', handleOpenCreateConstraintTab);
    window.addEventListener('open-edit-constraint-tab', handleOpenEditConstraintTab);
    window.addEventListener('open-sql-tab', handleOpenSqlTab);
    window.addEventListener('open-mview-tab', handleOpenMviewTab);

    return () => {
      window.removeEventListener('table-created', handleTableCreated);
      window.removeEventListener('sequence-created', handleSequenceCreated);
      window.removeEventListener('trigger-created', handleTriggerCreated);
      window.removeEventListener('dblink-created', handleDbLinkCreated);
      window.removeEventListener('synonym-created', handleSynonymCreated);
      window.removeEventListener('mview-created', handleMViewCreated);
      window.removeEventListener('mview-log-created', handleMViewLogCreated);
      window.removeEventListener('index-created', handleIndexCreated);
      window.removeEventListener('constraint-created', handleConstraintCreated);
      window.removeEventListener('close-tab', handleCloseTabEvent);
      window.removeEventListener('object-deleted', handleObjectDeleted);
      window.removeEventListener('open-table-tab', handleOpenTableTab);
      window.removeEventListener('open-create-index-tab', handleOpenCreateIndexTab);
      window.removeEventListener('open-edit-index-tab', handleOpenEditIndexTab);
      window.removeEventListener('open-create-trigger-tab', handleOpenCreateTriggerTab);
      window.removeEventListener('open-edit-trigger-tab', handleOpenEditTriggerTab);
      window.removeEventListener('open-create-constraint-tab', handleOpenCreateConstraintTab);
      window.removeEventListener('open-edit-constraint-tab', handleOpenEditConstraintTab);
      window.removeEventListener('open-sql-tab', handleOpenSqlTab);
      window.removeEventListener('open-mview-tab', handleOpenMviewTab);
    };
  }, [handleAddTab, config.user, config.aiHistoryScope, t, executeCloseTab, removeMatchingTabs, requestCloseTab]);

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragEnter = (index: number) => {
    if (draggedIndex === null || draggedIndex === index) return;
    setTabs(prevTabs => {
      const newTabs = [...prevTabs];
      const draggedTab = newTabs[draggedIndex];
      newTabs.splice(draggedIndex, 1);
      newTabs.splice(index, 0, draggedTab);
      return newTabs;
    });
    setDraggedIndex(index);
  };
  const handleDragEnd = () => setDraggedIndex(null);

  const handleCloseTab = (e: React.MouseEvent, idToClose: number) => {
    e.stopPropagation();
    if (dirtyTabs[idToClose]) {
      if (!window.confirm(t("there_are_unsaved_changes_are_you_sure_you_want_to_close_the_tab"))) return;
    }
    executeCloseTab(idToClose);
  };

  const handleTabContextMenu = (e: React.MouseEvent, tabId: number, tabIndex: number) => {
    e.preventDefault();
    setTabContextMenu({ mouseX: e.clientX, mouseY: e.clientY, tabId, tabIndex });
  };

  const handleCloseOtherTabs = () => {
    if (!tabContextMenu) return;
    const targetTab = tabs.find(t => t.id === tabContextMenu.tabId);
    if (targetTab) {
      const isAnyDirty = tabs.some(t => t.id !== targetTab.id && dirtyTabs[t.id]);
      if (isAnyDirty) {
        if (!window.confirm(t("there_are_tabs_with_unsaved_changes_are_you_sure_you_want_to_close_all"))) {
          setTabContextMenu(null);
          return;
        }
      }
      setTabs([targetTab]);
      setActiveTabId(targetTab.id);
      setDirtyTabs(prev => {
        const next: Record<number, boolean> = {};
        if (prev[targetTab.id]) next[targetTab.id] = true;
        return next;
      });
    }
    setTabContextMenu(null);
  };

  const handleCloseRightTabs = () => {
    if (!tabContextMenu) return;
    const { tabIndex } = tabContextMenu;
    const tabsToKeep = tabs.slice(0, tabIndex + 1);
    const tabsToClose = tabs.slice(tabIndex + 1);
    const isAnyDirty = tabsToClose.some(t => dirtyTabs[t.id]);

    if (isAnyDirty) {
      if (!window.confirm(t("there_are_tabs_with_unsaved_changes_are_you_sure_you_want_to_close_all"))) {
        setTabContextMenu(null);
        return;
      }
    }
    setTabs(tabsToKeep);
    if (!tabsToKeep.find(t => t.id === activeTabId)) {
      setActiveTabId(tabsToKeep[tabsToKeep.length - 1].id);
    }
    setDirtyTabs(prev => {
      const next = { ...prev };
      tabsToClose.forEach(t => delete next[t.id]);
      return next;
    });
    setTabContextMenu(null);
  };

  const handleCloseAllTabs = () => {
    const isAnyDirty = tabs.some(t => dirtyTabs[t.id]);

    if (isAnyDirty) {
      if (!window.confirm(t("there_are_tabs_with_unsaved_changes_are_you_sure_you_want_to_close_all"))) {
        setTabContextMenu(null);
        return;
      }
    }

    setTabs([]);
    setDirtyTabs({});
    setTabContextMenu(null);
  };

  return {
    t,
    localSchemas,
    expandedSchemas, toggleSchema,
    hasUncommittedTx, handleCommit, handleRollback, handleCancelExecution,

    isSidebarOpen, setIsSidebarOpen,
    sidebarWidth, setSidebarWidth,
    isSidebarResizing, startSidebarResize,

    isAiSidebarOpen, setIsAiSidebarOpen,
    aiSidebarWidth, setAiSidebarWidth,
    isAiSidebarResizing, startAiSidebarResize,

    aiContext, setAiContext,
    handleOpenAiSidebar,
    getOpenAiSidebarForTab,
    handleStoredCreated,

    menuAnchorEl, setMenuAnchorEl,
    dbaMenuAnchorEl, setDbaMenuAnchorEl,
    settingsMenuAnchorEl, setSettingsMenuAnchorEl,
    gitMenuAnchorEl, setGitMenuAnchorEl,
    helpMenuAnchorEl, setHelpMenuAnchorEl,
    aboutDialogOpen, setAboutDialogOpen,
    gitLogic,
    aiLogic,
    tabs, activeTabId, setActiveTabId,
    draggedIndex,
    tabContextMenu, setTabContextMenu,
    dirtyTabs, handleDirtyStateChange,
    handleAddTab,
    handleDragStart, handleDragEnter, handleDragEnd,
    handleCloseTab, closeTab: requestCloseTab, handleTabContextMenu,
    handleCloseOtherTabs, handleCloseRightTabs,
    handleCloseAllTabs
  };
};
