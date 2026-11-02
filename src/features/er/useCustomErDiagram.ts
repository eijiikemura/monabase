// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { erDocumentKey, erEdgeChanged, buildErSyncPreview, type ErDocument, type ErSyncPreview } from './erDocument';
import { selectErSchema } from './erMetadata';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { runGitOperation } from '@/features/git/gitOperation';
import type { GridRowParams } from '@mui/x-data-grid';
import type { SelectChangeEvent } from '@mui/material';
import type { GitRevision } from "@/shared/types/databaseTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { applyNodeChanges, applyEdgeChanges, type Node, type Edge, type NodeChange, type EdgeChange, getNodesBounds } from 'reactflow';
import { toPng } from 'html-to-image';
import { getPgSelectSchema, savePgSelectSchema } from "../postgresql/windows/common/schemaStorage";
import { fetchErDiagramData, fetchErSchemas, type ErDiagramWindowProps } from './useErDiagramWindow';
import { ipcRenderer } from "@/shared/api/desktop";

export const CUSTOM_MARKER_PREFIX = 'custom-er-marker-';

interface HistoryPreview {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  target: string;
  revision: GitRevision | null;
  nodes: Node[];
  edges: Edge[];
  schema?: string;
}
const emptyHistoryPreview = (): HistoryPreview => ({ status: 'idle', target: '', revision: null, nodes: [], edges: [] });
const EMPTY_NODES: Node[] = [];
const EMPTY_EDGES: Edge[] = [];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';
const isErNode = (value: unknown): value is Node =>
  isRecord(value) && typeof value.id === 'string' && isRecord(value.data) &&
  optionalString(value.data.tableName) && optionalString(value.data.tableComment) &&
  Array.isArray(value.data.columns) && value.data.columns.every(column =>
    isRecord(column) && typeof column.name === 'string' && optionalString(column.type) && optionalString(column.comment)) &&
  isRecord(value.position) && typeof value.position.x === 'number' && Number.isFinite(value.position.x) &&
  typeof value.position.y === 'number' && Number.isFinite(value.position.y);
const isErEdge = (value: unknown): value is Edge =>
  isRecord(value) && typeof value.id === 'string' && typeof value.source === 'string' && typeof value.target === 'string';

// Validate both file and history reads before publishing any canvas state.
function parseErDiagram(source: unknown, invalidMessage: string): { nodes: Node[]; edges: Edge[]; schema: string } {
  try {
    if (typeof source !== 'string') throw new Error();
    const data: unknown = JSON.parse(source);
    if (!isRecord(data) || !Array.isArray(data.nodes) || !Array.isArray(data.edges) ||
        !data.nodes.every(isErNode) || !data.edges.every(isErEdge) ||
        data.version !== 2 || typeof data.schema !== 'string' || !data.schema.trim()) throw new Error();
    return { nodes: data.nodes, edges: data.edges, schema: data.schema };
  } catch { throw new Error(invalidMessage); }
}


export function useCustomErDiagram({ isActive = true, schemas, initialSchema, dbType = 'oracle', dbName = '', userName = '' }: ErDiagramWindowProps) {
  const { t } = useTranslation();
  const isPg = dbType.toLowerCase().startsWith('postgres');

  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(true);
  const initializationStarted = useRef(false);
  
  const [schemaList, setSchemaList] = useState<string[]>(schemas || []);
  const [showComments, setShowComments] = useState<boolean>(() => localStorage.getItem('er-show-comments') !== 'false');
  const [showDataType, setShowDataType] = useState<boolean>(() => localStorage.getItem('er-show-datatype') !== 'false');
  const [logicalMode, setLogicalMode] = useState<boolean>(() => localStorage.getItem('er-logical-mode') === 'true');

  const [customMode, setCustomMode] = useState<'init' | 'design'>('init');
  const [erDiagramName, setErDiagramNameState] = useState<string>('');
  const [customSchema, setCustomSchema] = useState('');
  const [customNodes, setCustomNodes] = useState<Node[]>([]);
  const [customEdges, setCustomEdges] = useState<Edge[]>([]);
  const [savedFiles, setSavedFiles] = useState<string[]>([]);
  const [syncPreview, setSyncPreview] = useState<ErSyncPreview | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [, refreshHistory] = useState(0);
  const edits = useRef<{ past: ErDocument[]; current: ErDocument | null; future: ErDocument[] }>({ past: [], current: null, future: [] });
  const resetEdits = useRef(true);
  const currentDocument = useMemo(() => ({ name: erDiagramName, schema: customSchema, nodes: customNodes, edges: customEdges }),
    [erDiagramName, customSchema, customNodes, customEdges]);
  const currentKey = erDocumentKey(currentDocument);
  const documentRef = useRef(currentDocument);
  documentRef.current = currentDocument;
  const isDirty = savedKey !== null && currentKey !== savedKey;
  useEffect(() => {
    if (customNodes.some(node => node.dragging)) return;
    const history = edits.current;
    if (resetEdits.current) {
      edits.current = { past: [], current: currentDocument, future: [] };
      resetEdits.current = false;
    } else if (history.current && erDocumentKey(history.current) !== currentKey) {
      edits.current = { past: [...history.past, history.current].slice(-100), current: currentDocument, future: [] };
    } else return;
    refreshHistory(value => value + 1);
  }, [currentDocument, currentKey, customNodes]);


  const [addTableDialogOpen, setAddTableDialogOpen] = useState(false);
  const addingObjects = useRef(false);

  const [addRelationDialogOpen, setAddRelationDialogOpen] = useState(false);
  const [relationEditMode, setRelationEditMode] = useState(false);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const [relationForm, setRelationForm] = useState({ sourceTable: '', sourceCard: '1', targetTable: '', targetCard: 'N' });

  const [edgeContextMenu, setEdgeContextMenu] = useState<{ mouseX: number; mouseY: number; edgeId: string } | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement | null>(null);

  const [commitDialogOpen, setCommitDialogOpen] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const [isLocalRepo, setIsLocalRepo] = useState<boolean>(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  
  const [isCompareMode, setIsCompareMode] = useState<boolean>(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyList, setHistoryList] = useState<GitRevision[]>([]);
  const [historyPreview, setHistoryPreviewState] = useState<HistoryPreview>(emptyHistoryPreview);
  const historyPreviewRef = useRef(historyPreview);
  const historyRequestRef = useRef(0);
  const historyListRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const historyTarget = JSON.stringify([isPg, erDiagramName]);
  const historyContextRef = useRef({ target: historyTarget, comparing: isCompareMode });
  historyContextRef.current = { target: historyTarget, comparing: isCompareMode };
  historyPreviewRef.current = historyPreview;
  const updateHistoryPreview = useCallback((preview: HistoryPreview) => {
    historyPreviewRef.current = preview;
    setHistoryPreviewState(preview);
  }, []);
  const clearHistoryPreview = useCallback(() => {
    historyRequestRef.current++;
    updateHistoryPreview(emptyHistoryPreview());
  }, [updateHistoryPreview]);
  const setErDiagramName = useCallback((name: string) => {
    clearHistoryPreview();
    historyContextRef.current.target = JSON.stringify([isPg, name]);
    setErDiagramNameState(name);
  }, [clearHistoryPreview, isPg]);
  useEffect(() => {
    mountedRef.current = true;
    const requests = historyRequestRef, lists = historyListRequestRef;
    return () => { mountedRef.current = false; requests.current++; lists.current++; };
  }, []);
  useEffect(() => {
    clearHistoryPreview();
    setHistoryList([]); setHistoryPage(0); setHistoryHasMore(false); setHistoryLoading(false);
  }, [historyTarget, clearHistoryPreview]);
  const selectedHistory = historyPreview.target === historyTarget ? historyPreview.revision : null;
  const pastNodes = historyPreview.status === 'ready' && historyPreview.target === historyTarget ? historyPreview.nodes : EMPTY_NODES;
  const pastEdges = historyPreview.status === 'ready' && historyPreview.target === historyTarget ? historyPreview.edges : EMPTY_EDGES;
  const isHistoryLoading = historyPreview.status === 'loading' && historyPreview.target === historyTarget;
  const canRestoreHistory = isCompareMode && historyPreview.status === 'ready' && historyPreview.target === historyTarget &&
    !!historyPreview.revision && !isLoading && !isProcessing;

  const [historyListHeight, setHistoryListHeight] = useState<number>(180);
  const [isResizingHistory, setIsResizingHistory] = useState<boolean>(false);

  const startYRef = useRef<number>(0);
  const startHeightRef = useRef<number>(180);

  const isSaved = useMemo(() => {
    if (!erDiagramName || erDiagramName.trim() === '') return false;
    const filename = erDiagramName.endsWith('.json') ? erDiagramName : erDiagramName + '.json';
    return savedFiles.includes(filename);
  }, [erDiagramName, savedFiles]);

  const startResizingHistory = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingHistory(true);
    startYRef.current = e.clientY;
    startHeightRef.current = historyListHeight;
  }, [historyListHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingHistory) return;
      const deltaY = e.clientY - startYRef.current;
      let newHeight = startHeightRef.current + deltaY; 
      if (newHeight < 100) newHeight = 100;
      if (newHeight > window.innerHeight - 300) newHeight = window.innerHeight - 300;
      setHistoryListHeight(newHeight);
    };
    const handleMouseUp = () => setIsResizingHistory(false);

    if (isResizingHistory) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
    };
  }, [isResizingHistory]);

  const checkGitStatus = useCallback(async () => {
    try {
      const res = await ipcRenderer.invoke('git-status-check');
      if (res && res.success) {
        setIsLocalRepo(res.isRepo);
        setRemoteUrl(res.remoteUrl);
      }
    } catch (e) {
      console.error(t("failed_to_check_git_environment"), e);
    }
  }, [t]);

  const loadErHistory = useCallback(async (page = 0) => {
    const request = ++historyListRequestRef.current;
    const target = historyTarget;
    const isCurrent = () => mountedRef.current && request === historyListRequestRef.current &&
      target === historyContextRef.current.target;
    if (!isLocalRepo || !isSaved) {
      setHistoryList([]);
      return;
    }
    
    setHistoryLoading(true);
    const filename = erDiagramName.endsWith('.json') ? erDiagramName : erDiagramName + '.json';

    try {
      const res = await ipcRenderer.invoke('git-get-history-er', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        objectName: filename, page
      });
      if (!isCurrent()) return;
      if (res && res.success) {
        setHistoryList(res.history);
        setHistoryPage(page); setHistoryHasMore(!!res.hasMore);
      } else {
        alert(res.error);
      }
    } catch (e) {
      if (!isCurrent()) return;
      console.error(t("history_fetch_error"), e);
      alert(getErrorMessage(e));
    } finally {
      if (isCurrent()) setHistoryLoading(false);
    }
  }, [isLocalRepo, isSaved, erDiagramName, isPg, t, historyTarget]);

  useEffect(() => {
    if (customMode === 'design') {
      checkGitStatus();
    }
  }, [customMode, checkGitStatus]);

  useEffect(() => {
    const handleGitStatusChanged = () => {
      checkGitStatus();
      if (customMode === 'design' && isLocalRepo && isSaved) {
        loadErHistory();
      }
    };
    window.addEventListener('git-status-changed', handleGitStatusChanged);
    return () => window.removeEventListener('git-status-changed', handleGitStatusChanged);
  }, [checkGitStatus, customMode, isLocalRepo, isSaved, loadErHistory]);

  useEffect(() => {
    if (customMode === 'design' && isLocalRepo && erDiagramName && erDiagramName.trim() !== '') {
      loadErHistory();
    } else {
      setHistoryList([]);
      clearHistoryPreview();
    }
  }, [customMode, isLocalRepo, erDiagramName, isSaved, loadErHistory, clearHistoryPreview]);

  const loadSavedFilesList = useCallback(async () => {
    try {
      const res = await ipcRenderer.invoke('get-er-diagrams', isPg ? 'POSTGRESQL' : 'ORACLE');
      if (res && res.success) {
        setSavedFiles(res.files);
      }
    } catch (e) {
      console.warn('Failed to load saved ER diagrams', e);
    }
  }, [isPg]);

  useEffect(() => {
    if (!isActive || initializationStarted.current) return;
    initializationStarted.current = true;
    const initData = async () => {
      try {
        const fetchedSchemas = await fetchErSchemas(isPg).catch((error: unknown) => {
          alert(t("failed_to_retrieve_information_2") + getErrorMessage(error));
          return schemas || [];
        });
        setSchemaList(fetchedSchemas);

        const savedSchema = isPg ? getPgSelectSchema(dbName, userName) : '';
        const finalSchema = selectErSchema(fetchedSchemas, savedSchema) || selectErSchema(fetchedSchemas, initialSchema);

        setCustomSchema(finalSchema);
        await loadSavedFilesList();
      } catch { /* Auxiliary failures must not affect the main operation's result. */
      } finally {
        endLoading();
      }
    };
    void initData();
  }, [isActive, initialSchema, schemas, isPg, dbName, userName, loadSavedFilesList, endLoading, t]);

  const handleChangeCustomSchema = useCallback((e: SelectChangeEvent<string>) => {
    if (isBusy()) return;
    const newSchema = e.target.value;
    if (customNodes.length > 0 && newSchema !== customSchema) { alert(t('er_schema_locked')); return; }
    setCustomSchema(newSchema);
    if (isPg && userName && newSchema) savePgSelectSchema(dbName, userName, newSchema);
  }, [isBusy, isPg, dbName, userName, customNodes.length, customSchema, t]);

  const handleToggleShowComments = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setShowComments(checked);
    localStorage.setItem('er-show-comments', String(checked));
    setCustomNodes(prev => prev.map(node => ({ ...node, data: { ...node.data, showComments: checked } })));
  }, []);

  const handleToggleShowDataType = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setShowDataType(checked);
    localStorage.setItem('er-show-datatype', String(checked));
    setCustomNodes(prev => prev.map(node => ({ ...node, data: { ...node.data, showDataType: checked } })));
  }, []);

  const handleToggleLogicalMode = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setLogicalMode(checked);
    localStorage.setItem('er-logical-mode', String(checked));
    setCustomNodes(prev => prev.map(node => ({ ...node, data: { ...node.data, logicalMode: checked } })));
  }, []);

  const onCustomNodesChange = useCallback((changes: NodeChange[]) => {
    const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));
    setCustomNodes(nds => applyNodeChanges(changes, nds));
    if (removed.size) setCustomEdges(edges => edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
  }, []);
  const onCustomEdgesChange = useCallback((changes: EdgeChange[]) => setCustomEdges((eds) => applyEdgeChanges(changes, eds)), []);

  const restoreEdit = (document: ErDocument) => {
    setErDiagramName(document.name);
    setCustomSchema(document.schema);
    setCustomNodes(document.nodes.map(node => ({ ...node, selected: false, dragging: false,
      data: { ...node.data, showComments, showDataType, logicalMode } })));
    setCustomEdges(document.edges.map(edge => ({ ...edge, selected: false })));
    setSyncPreview(null);
  };
  const handleUndo = () => {
    if (isBusy() || isProcessing || isCompareMode) return;
    const history = edits.current;
    const previous = history.past.at(-1);
    if (!previous || !history.current) return;
    edits.current = { past: history.past.slice(0, -1), current: previous, future: [history.current, ...history.future] };
    restoreEdit(previous);
    refreshHistory(value => value + 1);
  };
  const handleRedo = () => {
    if (isBusy() || isProcessing || isCompareMode) return;
    const history = edits.current, next = history.future[0];
    if (!next || !history.current) return;
    edits.current = { past: [...history.past, history.current], current: next, future: history.future.slice(1) };
    restoreEdit(next);
    refreshHistory(value => value + 1);
  };

  const handleCreateNewCustomEr = () => {
    if (isBusy()) return;
    resetEdits.current = true;
    setSavedKey(erDocumentKey({ name: '', schema: customSchema, nodes: [], edges: [] }));
    setSyncPreview(null);
    setErDiagramName(''); 
    setCustomNodes([]);
    setCustomEdges([]);
    setCustomMode('design');
    setIsCompareMode(false);
    setHistoryList([]);
    clearHistoryPreview();
  };

  const handleCloseCustomEr = () => {
    if (isBusy()) return;
    if (!isDirty || window.confirm(t("close_current_custom_er_diagram_unsaved_changes_will_be_lost"))) {
      resetEdits.current = true;
      setSavedKey(null);
      setSyncPreview(null);
      setCustomMode('init');
      setCustomNodes([]);
      setCustomEdges([]);
      setErDiagramName(''); 
      setIsCompareMode(false);
      setHistoryList([]);
      clearHistoryPreview();
      loadSavedFilesList(); 
    }
  };

  const handleOpenCustomEr = async (filename: string) => {
    if (isBusy()) return;
    beginLoading();
    try {
      const res = await ipcRenderer.invoke('load-er-diagram', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        objectName: filename
      });
      if (!res || !res.success) throw new Error(res?.error || t('invalid_er_diagram_structure'));

      const data = parseErDiagram(res.data, t('invalid_er_diagram_structure'));
      
      const loadedSchema = data.schema;
      let loadedNodes = data.nodes;

      let sqlTabComments, sqlColComments;
      if (isPg) {
        sqlTabComments = `SELECT c.relname AS "TABLE_NAME", obj_description(c.oid) AS "COMMENTS" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :owner AND c.relkind IN ('r', 'v', 'p')`;
        sqlColComments = `SELECT c.relname AS "TABLE_NAME", a.attname AS "COLUMN_NAME", col_description(c.oid, a.attnum) AS "COMMENTS" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid WHERE n.nspname = :owner AND c.relkind IN ('r', 'v', 'p') AND a.attnum > 0 AND NOT a.attisdropped`;
      } else {
        sqlTabComments = `SELECT TABLE_NAME, COMMENTS FROM ALL_TAB_COMMENTS WHERE OWNER = :owner`;
        sqlColComments = `SELECT TABLE_NAME, COLUMN_NAME, COMMENTS FROM ALL_COL_COMMENTS WHERE OWNER = :owner`;
      }

      // Run on the background connection (execute-sql-bg).
      const [resTabComments, resColComments] = await Promise.all([
        ipcRenderer.invoke<{ TABLE_NAME: string; COMMENTS: string | null }>('execute-sql-bg', sqlTabComments, { owner: loadedSchema }),
        ipcRenderer.invoke<{ TABLE_NAME: string; COLUMN_NAME: string; COMMENTS: string | null }>('execute-sql-bg', sqlColComments, { owner: loadedSchema })
      ]);
      if (!resTabComments.success) throw new Error(resTabComments.error);
      if (!resColComments.success) throw new Error(resColComments.error);
      const rowsTabComments = resTabComments.rows || [];
      const rowsColComments = resColComments.rows || [];

      loadedNodes = loadedNodes.map((node: Node) => {
        const tName = node.id;
        const tabCommentRow = rowsTabComments.find((rt: { TABLE_NAME: string }) => rt.TABLE_NAME === tName);
        const tableComment = tabCommentRow?.COMMENTS || node.data.tableComment || '';
        
        const updatedColumns = (node.data.columns || []).map((col: { name: string; comment: string }) => {
          const colCommentRow = rowsColComments.find((rc: { TABLE_NAME: string; COLUMN_NAME: string }) => rc.TABLE_NAME === tName && rc.COLUMN_NAME === col.name);
          return { ...col, comment: colCommentRow?.COMMENTS || col.comment || '' };
        });

        return {
          ...node,
          data: { ...node.data, tableComment, columns: updatedColumns, showComments, showDataType, logicalMode }
        };
      });
      
      const name = filename.replace(/\.json$/, '');
      resetEdits.current = true;
      setSavedKey(erDocumentKey({ name, schema: loadedSchema, nodes: loadedNodes, edges: data.edges }));
      setCustomSchema(loadedSchema);
      setSyncPreview(null);
      setErDiagramName(name);
      setCustomNodes(loadedNodes);
      setCustomEdges(data.edges);
      setCustomMode('design');
    } catch (e: unknown) {
      alert(t("file_load_error") + getErrorMessage(e));
    } finally {
      endLoading();
    }
  };

  const handleCommit = async () => {
    if (isBusy() || isProcessing) return;
    if (!customSchema) { alert(t('no_schema_selected')); return; }
    if (!erDiagramName.trim()) { alert(t("please_enter_an_er_diagram_name")); return; }
    
    beginLoading();
    setIsProcessing(true);
    try {
      const savingKey = currentKey;
      const data = JSON.stringify({ version: 2, schema: customSchema, ...JSON.parse(erDocumentKey(currentDocument)), name: undefined }, null, 2);
      
      if (isLocalRepo) {
        const res = await runGitOperation(t, 'git-commit-er', {
          dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
          objectName: erDiagramName + '.json',
          sourceText: data,
          message: commitMessage || t("save_er_diagram", { name: erDiagramName })
        });
        
        if (res && res.success) {
          alert(t("er_diagram_saved_and_git_commit_executed"));
          await checkGitStatus();
          await loadSavedFilesList();
          await loadErHistory(); 
        } else {
          return;
        }
      } else {
        const res = await ipcRenderer.invoke('save-er-diagram', {
          dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
          objectName: erDiagramName + '.json',
          sourceText: data
        });
        if (res && res.success) {
          alert(t("saved") + res.filePath);
        } else {
          alert(t("save_error") + res.error);
          return;
        }
      }
      
      setSavedKey(savingKey);
      setCommitDialogOpen(false);
      setCommitMessage('');
      loadSavedFilesList();
    } catch (e: unknown) {
      alert(t("save_error") + getErrorMessage(e));
    } finally {
      setIsProcessing(false);
      endLoading();
    }
  };

  const handleDeleteCustomEr = async (filename: string, e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (window.confirm(t("are_you_sure_you_want_to_delete", { filename }))) {
      try {
        const res = await runGitOperation(t, 'delete-er-diagram', {
          dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
          objectName: filename
        });
        if (res && res.success) {
          loadSavedFilesList(); 
        }
      } catch (err: unknown) {
        alert(t("failed_to_delete_file") + getErrorMessage(err));
      }
    }
  };

  const handleOpenAddCustomTableDialog = useCallback(() => {
    if (!customSchema) { alert(t("please_select_a_schema_2")); return; }
    setAddTableDialogOpen(true);
  }, [customSchema, t]);
  const isObjectAdded = (object: DatabaseObject) => object.schema === customSchema && customNodes.some(node => node.id === object.name);
  const handleAddObjectsToCustomCanvas = async (objects: DatabaseObject[]) => {
    if (addingObjects.current) throw new Error(t('objects_are_being_added'));
    const expectedDb = isPg ? 'postgresql' : 'oracle';
    if (!customSchema || objects.some(object => object.dbType !== expectedDb || object.schema !== customSchema || !['TABLE', 'VIEW'].includes(object.category))) {
      throw new Error(t('er_select_table_view_in_schema'));
    }
    const selected = [...new Map(objects.filter(object => !isObjectAdded(object)).map(object => [object.name, object])).values()];
    if (!selected.length) return;
    const before = erDocumentKey(documentRef.current);
    addingObjects.current = true; beginLoading();
    try {
      const nodes: Node[] = [];
      for (const object of selected) {
        const data = await fetchErDiagramData(isPg, customSchema, object.name, showComments, showDataType, logicalMode, true);
        const node = data.nodes.find(candidate => candidate.id === object.name);
        if (!node) throw new Error(t('failed_to_fetch_columns') + ` ${object.name}`);
        nodes.push(node);
      }
      if (!mountedRef.current || erDocumentKey(documentRef.current) !== before) throw new Error(t('er_sync_stale'));
      setCustomNodes(previous => {
        const last = previous.at(-1)?.position || { x: 70, y: 70 };
        return [...previous, ...nodes.filter(node => !previous.some(current => current.id === node.id)).map((node, index) => ({
          ...node, position: { x: last.x + (index + 1) * 30, y: last.y + (index + 1) * 30 }
        }))];
      });
    } finally { addingObjects.current = false; endLoading(); }
  };

  const defaultRelationSourceTable = customNodes[0]?.id || '';
  const defaultRelationTargetTable = customNodes[1]?.id || '';

  const handleOpenAddRelationDialog = useCallback(() => {
    setRelationForm({
      sourceTable: defaultRelationSourceTable,
      sourceCard: '1',
      targetTable: defaultRelationTargetTable,
      targetCard: 'N'
    });
    setRelationEditMode(false);
    setEditingEdgeId(null);
    setAddRelationDialogOpen(true);
  }, [defaultRelationSourceTable, defaultRelationTargetTable]);

  const handleSaveRelation = () => {
    if (!relationForm.sourceTable || !relationForm.targetTable) { alert(t("please_select_a_table")); return; }
    if (relationForm.sourceTable === relationForm.targetTable) { alert(t("please_select_different_tables")); return; }

    const newEdge: Edge = {
      id: editingEdgeId || `edge-${Date.now()}`,
      source: relationForm.sourceTable,
      target: relationForm.targetTable,
      type: 'smoothstep', 
      style: { strokeWidth: 2, stroke: '#555' },
      markerStart: `${CUSTOM_MARKER_PREFIX}${relationForm.sourceCard}-start`,
      markerEnd: `${CUSTOM_MARKER_PREFIX}${relationForm.targetCard}-end`,
    };

    if (relationEditMode && editingEdgeId) {
      setCustomEdges(prev => prev.map(e => e.id === editingEdgeId ? newEdge : e));
    } else {
      setCustomEdges(prev => [...prev, newEdge]);
    }
    setAddRelationDialogOpen(false);
  };

  const handleEdgeContextMenu = useCallback((e: React.MouseEvent, edge: Edge) => {
    e.preventDefault();
    setEdgeContextMenu({ mouseX: e.clientX, mouseY: e.clientY, edgeId: edge.id });
  }, []);

  const handleEditRelation = () => {
    if (!edgeContextMenu) return;
    const edge = customEdges.find(e => e.id === edgeContextMenu.edgeId);
    if (edge) {
      const sourceCard = edge.markerStart?.toString().replace(CUSTOM_MARKER_PREFIX, '').replace('-start', '') || '1';
      const targetCard = edge.markerEnd?.toString().replace(CUSTOM_MARKER_PREFIX, '').replace('-end', '') || 'N';
      setRelationForm({ sourceTable: edge.source, sourceCard, targetTable: edge.target, targetCard });
      setRelationEditMode(true);
      setEditingEdgeId(edge.id);
      setAddRelationDialogOpen(true);
    }
    setEdgeContextMenu(null);
  };

  const handleDeleteRelation = () => {
    if (!edgeContextMenu) return;
    setCustomEdges(prev => prev.filter(e => e.id !== edgeContextMenu.edgeId));
    setEdgeContextMenu(null);
  };

  const handleOpenCompareMode = async () => {
    if (isBusy() || isProcessing) return;
    if (!erDiagramName || erDiagramName === 'Untitled_ER' || erDiagramName.trim() === '') {
      alert(t("no_er_diagram_saved_for_comparison"));
      return;
    }
    clearHistoryPreview();
    const request = historyRequestRef.current, target = historyContextRef.current.target;
    beginLoading();
    try {
      await checkGitStatus();
      await loadErHistory();
      if (!mountedRef.current || request !== historyRequestRef.current || target !== historyContextRef.current.target) return;
      historyContextRef.current.comparing = true;
      setIsCompareMode(true);
    } finally { endLoading(); }
  };

  const handleCloseCompareMode = () => {
    historyContextRef.current.comparing = false;
    setIsCompareMode(false);
    clearHistoryPreview();
  };

  const handleSyncWithDatabase = async () => {
    if (isBusy() || isProcessing) return;
    if (customNodes.length === 0) {
      alert(t("no_tables_on_the_canvas"));
      return;
    }
    if (!customSchema) {
      alert(t("no_schema_selected"));
      return;
    }
    beginLoading();
    try {
      const data = await fetchErDiagramData(isPg, customSchema, null, showComments, showDataType, logicalMode, true);
      if (!mountedRef.current) return;
      const preview = buildErSyncPreview(currentDocument, data.nodes);
      if (preview.before !== erDocumentKey(documentRef.current)) { alert(t('er_sync_stale')); return; }
      if (!preview.changes.length) { alert(t('er_sync_no_changes')); return; }
      setSyncPreview(preview);
    } catch (e: unknown) {
      alert(t("sync_failed") + getErrorMessage(e));
    } finally {
      endLoading();
    }
  };

  const handleApplySync = () => {
    if (!syncPreview || isBusy() || isProcessing) return;
    if (syncPreview.before !== erDocumentKey(documentRef.current)) { setSyncPreview(null); alert(t('er_sync_stale')); return; }
    setCustomNodes(syncPreview.nodes);
    setCustomEdges(syncPreview.edges);
    setSyncPreview(null);
  };

  const handleExportImage = useCallback(async () => {
    if (isBusy()) return;
    if (customNodes.length === 0) {
      alert(t("no_nodes_to_export"));
      return;
    }
    const viewportElement = reactFlowWrapper.current?.querySelector<HTMLElement>('.react-flow__viewport');

    if (!viewportElement) return;

    const tempMarkerId = `temp-er-markers-${Date.now()}`;
    const colorVariants = [
      { prefix: '', color: '#555' },
      { prefix: 'added-', color: '#4caf50' },
      { prefix: 'deleted-', color: '#f44336' },
      { prefix: 'modified-', color: '#ff9800' }
    ];

    let defs = '';
    colorVariants.forEach(v => {
      const p = CUSTOM_MARKER_PREFIX + v.prefix;
      const c = v.color;
      defs += `
        <marker id="${p}1-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -5,-8 L -5,8 M -5,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}01-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M -6,-8 L -6,8 M -6,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}0N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="3" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M -10,-8 L -1,0 L -10,8 M -1,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}MANY-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        
        <marker id="${p}1-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 5,-8 L 5,8 M 5,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}01-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M 6,-8 L 6,8 M 6,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}0N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="-3" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M 10,-8 L 1,0 L 10,8 M 1,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}MANY-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      `;
    });

    const markerSvg = `
      <svg style="position: absolute; width: 0; height: 0;" id="${tempMarkerId}">
        <defs>${defs}</defs>
      </svg>
    `;
    viewportElement.insertAdjacentHTML('afterbegin', markerSvg);

    beginLoading();
    try {
      const bounds = getNodesBounds(customNodes);
      const padding = 60;
      const imageWidth = bounds.width + padding * 2;
      const imageHeight = bounds.height + padding * 2;
      const transform = `translate(${-bounds.x + padding}px, ${-bounds.y + padding}px) scale(1)`;

      const dataUrl = await toPng(viewportElement, {
        backgroundColor: '#f4f4f4',
        width: imageWidth,
        height: imageHeight,
        style: { width: `${imageWidth}px`, height: `${imageHeight}px`, transform: transform, transformOrigin: 'top left' }
      });
      
      const link = document.createElement('a');
      link.download = `ER_Diagram_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (e: unknown) {
      alert(t("failed_to_export_image") + getErrorMessage(e));
    } finally { 
      const tempElement = document.getElementById(tempMarkerId);
      if (tempElement) tempElement.remove();
      endLoading();
    }
  }, [customNodes, beginLoading, t, endLoading, isBusy]);

  const handleHistoryRowClick = async (params: GridRowParams<GitRevision>) => {
    if (!mountedRef.current || !historyContextRef.current.comparing ||
        historyTarget !== historyContextRef.current.target) return;
    const request = ++historyRequestRef.current;
    const target = historyTarget;
    const revision = params.row;
    const isCurrent = () => mountedRef.current && request === historyRequestRef.current &&
      target === historyContextRef.current.target && historyContextRef.current.comparing;
    updateHistoryPreview({ status: 'loading', target, revision, nodes: [], edges: [] });
    try {
      const res = await ipcRenderer.invoke('git-get-file-content-er', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        objectName: erDiagramName.endsWith('.json') ? erDiagramName : erDiagramName + '.json',
        commitId: revision.fullId
      });
      if (!isCurrent()) return;
      if (!res?.success || typeof res.content !== 'string') throw new Error(t("failed_to_load_data_for_this_version"));
      const data = parseErDiagram(res.content, t('failed_to_load_data_for_this_version'));
      updateHistoryPreview({ status: 'ready', target, revision, nodes: data.nodes, edges: data.edges, schema: data.schema });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      updateHistoryPreview({ status: 'failed', target, revision, nodes: [], edges: [] });
      alert(t("connection_error_5", { error: getErrorMessage(error) }));
    }
  };

  const handleRestorePastVersion = () => {
    const preview = historyPreviewRef.current;
    if (!mountedRef.current || isBusy() || isProcessing || preview.status !== 'ready' || !preview.revision || !preview.schema ||
        preview.target !== historyContextRef.current.target || !historyContextRef.current.comparing) return;
    if (window.confirm(t("er_confirm_restore_canvas")) && preview === historyPreviewRef.current &&
        preview.target === historyContextRef.current.target && historyContextRef.current.comparing) {
      setCustomSchema(preview.schema);
      setCustomNodes(preview.nodes);
      setCustomEdges(preview.edges);
      handleCloseCompareMode();
    }
  };

  const annotatedPastNodes = useMemo(() => {
    const currMap = new Map(customNodes.map(n => [n.id, n]));
    return pastNodes.map(n => {
      const curr = currMap.get(n.id);
      if (!curr) return { ...n, data: { ...n.data, diffStatus: 'deleted' } };
      
      const isStructureChanged = JSON.stringify(n.data.columns) !== JSON.stringify(curr.data.columns) || n.data.tableComment !== curr.data.tableComment;
      const isPositionChanged = Math.floor(n.position.x) !== Math.floor(curr.position.x) || Math.floor(n.position.y) !== Math.floor(curr.position.y);

      if (isStructureChanged || isPositionChanged) {
        return { ...n, data: { ...n.data, diffStatus: 'modified' } };
      }
      return { ...n, data: { ...n.data, diffStatus: 'none' } };
    });
  }, [pastNodes, customNodes]);

  const annotatedCurrentNodes = useMemo(() => {
    const pastMap = new Map(pastNodes.map(n => [n.id, n]));
    return customNodes.map(n => {
      const past = pastMap.get(n.id);
      if (!past) return { ...n, data: { ...n.data, diffStatus: 'added' } };
      
      const isStructureChanged = JSON.stringify(n.data.columns) !== JSON.stringify(past.data.columns) || n.data.tableComment !== past.data.tableComment;
      const isPositionChanged = Math.floor(n.position.x) !== Math.floor(past.position.x) || Math.floor(n.position.y) !== Math.floor(past.position.y);

      if (isStructureChanged || isPositionChanged) {
        return { ...n, data: { ...n.data, diffStatus: 'modified' } };
      }
      return { ...n, data: { ...n.data, diffStatus: 'none' } };
    });
  }, [pastNodes, customNodes]);

  const annotatedPastEdges = useMemo(() => {
    const currEdgeMap = new Map(customEdges.map(e => [e.id, e]));
    return pastEdges.map(e => {
      const key = e.id;
      const curr = currEdgeMap.get(key);
      if (!curr) {
        return { 
          ...e, 
          style: { ...e.style, stroke: '#f44336', strokeWidth: 3 },
          markerStart: e.markerStart?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}deleted-`),
          markerEnd: e.markerEnd?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}deleted-`)
        }; 
      }
      if (erEdgeChanged(e, curr)) {
        return { 
          ...e, 
          style: { ...e.style, stroke: '#ff9800', strokeWidth: 3 },
          markerStart: e.markerStart?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}modified-`),
          markerEnd: e.markerEnd?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}modified-`)
        }; 
      }
      return e;
    });
  }, [pastEdges, customEdges]);

  const annotatedCurrentEdges = useMemo(() => {
    const pastEdgeMap = new Map(pastEdges.map(e => [e.id, e]));
    return customEdges.map(e => {
      const key = e.id;
      const past = pastEdgeMap.get(key);
      if (!past) {
        return { 
          ...e, 
          style: { ...e.style, stroke: '#4caf50', strokeWidth: 3 },
          markerStart: e.markerStart?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}added-`),
          markerEnd: e.markerEnd?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}added-`)
        }; 
      }
      if (erEdgeChanged(e, past)) {
        return { 
          ...e, 
          style: { ...e.style, stroke: '#ff9800', strokeWidth: 3 },
          markerStart: e.markerStart?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}modified-`),
          markerEnd: e.markerEnd?.toString().replace(CUSTOM_MARKER_PREFIX, `${CUSTOM_MARKER_PREFIX}modified-`)
        }; 
      }
      return e;
    });
  }, [pastEdges, customEdges]);

  return {
    t, isPg, isLoading, schemaList, customSchema,
    isDirty, syncPreview, setSyncPreview, handleApplySync,
    handleUndo, handleRedo, canUndo: edits.current.past.length > 0, canRedo: edits.current.future.length > 0,
    customMode, setCustomMode, erDiagramName, setErDiagramName,
    customNodes, customEdges, savedFiles, isSaved,
    showComments, handleToggleShowComments, 
    showDataType, handleToggleShowDataType, 
    logicalMode, handleToggleLogicalMode,
    onCustomNodesChange, onCustomEdgesChange, handleChangeCustomSchema, 
    handleCreateNewCustomEr, handleOpenCustomEr, handleDeleteCustomEr,
    handleCloseCustomEr, handleExportImage,
    addTableDialogOpen, setAddTableDialogOpen,
    handleOpenAddCustomTableDialog, handleAddObjectsToCustomCanvas, isObjectAdded,
    addRelationDialogOpen, setAddRelationDialogOpen, relationForm, setRelationForm, relationEditMode,
    handleOpenAddRelationDialog, handleSaveRelation,
    edgeContextMenu, setEdgeContextMenu, handleEdgeContextMenu, handleEditRelation, handleDeleteRelation,
    reactFlowWrapper,

    commitDialogOpen, setCommitDialogOpen, commitMessage, setCommitMessage,
    isProcessing, isLocalRepo, remoteUrl,
    handleCommit,

    isCompareMode, handleOpenCompareMode, handleCloseCompareMode,
    historyPage, historyHasMore, historyLoading, loadErHistory,
    historyList, selectedHistory, isHistoryLoading, canRestoreHistory, handleHistoryRowClick, handleRestorePastVersion,
    annotatedPastNodes, annotatedCurrentNodes, annotatedPastEdges, annotatedCurrentEdges,
    
    historyListHeight, startResizingHistory, isResizingHistory,
    handleSyncWithDatabase
  };
}
