// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { fetchErMetadata, selectErSchema } from './erMetadata';
import type { ColumnDefinition } from "@/shared/types/databaseTypes";
import type { SelectChangeEvent } from '@mui/material';
import type { ErRelation } from './erTypes';

import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { applyNodeChanges, type Node, type Edge, type NodeChange, getNodesBounds } from 'reactflow';
import { toPng } from 'html-to-image';
import { getPgSelectSchema, savePgSelectSchema } from "../postgresql/windows/common/schemaStorage";
import { ipcRenderer } from "@/shared/api/desktop";

import { formatDataTypeString } from './formatDataType';
export { formatDataTypeString } from './formatDataType';

export const MARKER_PREFIX = 'er-marker-';

export const injectGlobalMarkers = () => {
  if (document.getElementById('er-custom-global-markers')) return;
  const colorVariants = [
    { prefix: '', color: '#555' },
    { prefix: 'added-', color: '#4caf50' },
    { prefix: 'deleted-', color: '#f44336' },
    { prefix: 'modified-', color: '#ff9800' }
  ];
  let defs = '';
  colorVariants.forEach(v => {
    const p = MARKER_PREFIX + v.prefix;
    const c = v.color;
    defs += `
      <marker id="${p}1-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -5,-8 L -5,8 M -5,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}01-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M -6,-8 L -6,8 M -6,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}0N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="3" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M -10,-8 L -1,0 L -10,8 M -1,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}MANY-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>

      <marker id="${p}1-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 5,-8 L 5,8 M 5,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}01-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M 6,-8 L 6,8 M 6,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}0N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="-3" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M 10,-8 L 1,0 L 10,8 M 1,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      <marker id="${p}MANY-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
    `;
  });
  const markerSvg = `<svg style="position: absolute; width: 0; height: 0;" id="er-custom-global-markers"><defs>${defs}</defs></svg>`;
  document.body.insertAdjacentHTML('afterbegin', markerSvg);
};

// Fetch schemas in the background for the selected database type.
export const fetchErSchemas = async (isPg: boolean): Promise<string[]> => {
  const query = isPg
    ? `SELECT schema_name AS "USERNAME" FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name`
    : "SELECT USERNAME FROM ALL_USERS WHERE ORACLE_MAINTAINED = 'N' ORDER BY USERNAME";
  let res = await ipcRenderer.invoke<{ USERNAME: string }>('execute-sql-bg', query);
  if (!isPg && !res.success) {
    res = await ipcRenderer.invoke<{ USERNAME: string }>('execute-sql-bg', 'SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME');
  }
  if (!res.success) throw new Error(res.error);
  return (res.rows || []).map((row: { USERNAME: string }) => row.USERNAME);
};

export const fetchErDiagramData = async (
  isPg: boolean,
  schema: string,
  targetTableName: string | null,
  showComments: boolean,
  showDataType: boolean,
  logicalMode: boolean,
  isCustomMode: boolean = false
): Promise<{ nodes: Node[], edges: Edge[] }> => {
  const startedAt = Date.now();
  const metadata = await fetchErMetadata(isPg, schema, targetTableName, isCustomMode);
  const dataLoadedAt = Date.now();
  // Preserve saved local IDs and keep generated external IDs safe for DOM selectors.
  const usedIds = new Set(metadata.columns.filter(row => !row.TABLE_SCHEMA || row.TABLE_SCHEMA === schema).map(row => row.TABLE_NAME));
  const externalIds = new Map<string, string>();
  const tableId = (owner: string | undefined, name: string): string => {
    if (!owner || owner === schema) return name;
    const key = JSON.stringify([owner, name]);
    const previous = externalIds.get(key);
    if (previous) return previous;
    let id = `er-external-${encodeURIComponent(key)}`;
    while (usedIds.has(id)) id += '-';
    usedIds.add(id);
    externalIds.set(key, id);
    return id;
  };
  const labels = new Map(metadata.columns.map(row => [tableId(row.TABLE_SCHEMA, row.TABLE_NAME), {
    schema: row.TABLE_SCHEMA || schema, name: row.TABLE_NAME
  }]));
  const mapTable = <T extends { TABLE_NAME: string; TABLE_SCHEMA?: string }>(row: T) =>
    ({ ...row, TABLE_NAME: tableId(row.TABLE_SCHEMA, row.TABLE_NAME) });
  const columnRows = metadata.columns.map(mapTable);
  const rowsPk = metadata.primaryKeys.map(mapTable);
  const rowsFk = metadata.foreignKeys.map(row => ({ ...row,
    PARENT_TABLE: tableId(row.PARENT_SCHEMA, row.PARENT_TABLE),
    CHILD_TABLE: tableId(row.CHILD_SCHEMA, row.CHILD_TABLE)
  }));
  const rowsTabComments = metadata.tableComments.map(mapTable);
  const rowsColComments = metadata.columnComments.map(mapTable);
  const columnKey = (table: string, column: string) => JSON.stringify([table, column]);
  const pkKeys = new Set(rowsPk.map(row => columnKey(row.TABLE_NAME, row.COLUMN_NAME)));
  const fkKeys = new Set(rowsFk.map(row => columnKey(row.CHILD_TABLE, row.CHILD_COLUMN)));
  const tableComments = new Map(rowsTabComments.map(row => [row.TABLE_NAME, row.COMMENTS]));
  const columnComments = new Map(rowsColComments.map(row => [columnKey(row.TABLE_NAME, row.COLUMN_NAME), row.COMMENTS]));

  const relations: ErRelation[] = [];
  const relationMap = new Map<string, ErRelation>();

  rowsFk.forEach((r) => {
      const key = JSON.stringify([r.PARENT_TABLE, r.CHILD_TABLE, r.CONSTRAINT_NAME || '']);
      const isId = pkKeys.has(columnKey(r.CHILD_TABLE, r.CHILD_COLUMN));
      if (!relationMap.has(key)) {
        relations.push({ parent: r.PARENT_TABLE, child: r.CHILD_TABLE, childColumn: r.CHILD_COLUMN, isIdentifying: isId });
        relationMap.set(key, relations[relations.length - 1]);
      }
      else {
        const existing = relationMap.get(key);
        if (existing && isId) existing.isIdentifying = true;
      }
  });

  const targetTableNames = new Set<string>();
  const parentTables = new Set<string>();
  const childTables = new Set<string>();
  let mainTable = '';

  if (targetTableName) {
    mainTable = targetTableName;
    targetTableNames.add(mainTable);
    if (!isCustomMode) {
      relations.forEach((rel) => {
        const relParent = String(rel.parent);
        const relChild = String(rel.child);
        const mainId = String(mainTable);
        if (relChild === mainId && relParent !== mainId) { targetTableNames.add(rel.parent); parentTables.add(relParent); }
        if (relParent === mainId && relChild !== mainId) { targetTableNames.add(rel.child); childTables.add(relChild); }
      });
    }
  } else {
    columnRows.forEach((r: { TABLE_NAME: string }) => targetTableNames.add(r.TABLE_NAME));
    if (!isCustomMode) {
      relations.forEach((rel) => { parentTables.add(String(rel.parent)); childTables.add(String(rel.child)); });
    }
  }

  if (targetTableNames.size === 0 && !isCustomMode) throw new Error('No tables found to display.');
  const sortedTableNames = Array.from(targetTableNames).sort((a, b) => String(a).toLowerCase().localeCompare(String(b).toLowerCase()));

  const tableNamesByKey = new Map(sortedTableNames.map(name => [name, name]));
  const tablesMap = new Map<string, (ColumnDefinition & { TABLE_NAME: string })[]>();
  columnRows.forEach((r: ColumnDefinition & { TABLE_NAME: string }) => {
    const tNameMatch = tableNamesByKey.get(r.TABLE_NAME);
    if (tNameMatch) {
      if (!tablesMap.has(tNameMatch)) tablesMap.set(tNameMatch, []);
      tablesMap.get(tNameMatch)!.push(r);
    }
  });

  const hasParents = parentTables.size > 0;
  const getEstimatedHeight = (tName: string) => {
    const colCount = tablesMap.get(tName)?.length || 0;
    return 80 + (colCount * 28) + 60;
  };

  const allTablesLayoutMap = new Map<string, {x: number, y: number}>();
  if (!targetTableName) {
    const pureParents: string[] = [];
    const intermediates: string[] = [];
    const pureChildren: string[] = [];
    const isolated: string[] = [];

    Array.from(targetTableNames).forEach(t => {
      const tableIdForLayout = String(t);
      const isP = parentTables.has(tableIdForLayout);
      const isC = childTables.has(tableIdForLayout);
      if (isP && !isC) pureParents.push(String(t));
      else if (!isP && isC) pureChildren.push(String(t));
      else if (isP && isC) intermediates.push(String(t));
      else isolated.push(String(t));
    });

    const sortAlpha = (a: string, b: string) => String(a).toLowerCase().localeCompare(String(b).toLowerCase());
    pureParents.sort(sortAlpha); intermediates.sort(sortAlpha); pureChildren.sort(sortAlpha); isolated.sort(sortAlpha);

    let yP = 0, yI = 0, yC = 0;
    pureParents.forEach((t) => { allTablesLayoutMap.set(String(t), { x: 0, y: yP }); yP += getEstimatedHeight(t); });
    intermediates.forEach((t) => { allTablesLayoutMap.set(String(t), { x: 450, y: yI }); yI += getEstimatedHeight(t); });
    pureChildren.forEach((t) => { allTablesLayoutMap.set(String(t), { x: 900, y: yC }); yC += getEstimatedHeight(t); });

    const isolatedStartY = Math.max(yP, yI, yC, 0);
    const gridY = [isolatedStartY, isolatedStartY, isolatedStartY];

    isolated.forEach((t, i) => {
      const col = i % 3;
      allTablesLayoutMap.set(String(t), { x: col * 450, y: gridY[col] });
      gridY[col] += getEstimatedHeight(t);
    });
  }

  const nodes: Node[] = [];
  let targetYP = 0, targetYMain = 0, targetYC = 0;
  const customGridY = [0, 0, 0];
  let customCount = 0;

  sortedTableNames.forEach(tName => {
    const cols = tablesMap.get(tName);
    if (cols) {
      const tableComment = tableComments.get(tName);
      const columnsData = cols.map((c: ColumnDefinition) => {
        const isPk = pkKeys.has(columnKey(tName, c.COLUMN_NAME));
        const isFk = fkKeys.has(columnKey(tName, c.COLUMN_NAME));
        const columnComment = columnComments.get(columnKey(tName, c.COLUMN_NAME));
        const len = c.DATA_PRECISION != null ? c.DATA_PRECISION : c.DATA_LENGTH;
        const formattedType = formatDataTypeString(c.DATA_TYPE, len, c.DATA_SCALE);
        return { name: c.COLUMN_NAME, type: formattedType, isPk, isFk, comment: columnComment || '' };
      });

      const nodeHeight = getEstimatedHeight(tName);
      let x = 0, y = 0;

      if (targetTableName && !isCustomMode) {
        const tableIdForLayout = String(tName);
        const mainIdForLayout = String(mainTable);
        if (tableIdForLayout === mainIdForLayout) { x = hasParents ? 350 : 0; y = targetYMain + 2; targetYMain += nodeHeight; }
        else if (parentTables.has(tableIdForLayout)) { x = 0; y = targetYP + 1; targetYP += nodeHeight; }
        else if (childTables.has(tableIdForLayout)) { x = hasParents ? 700 : 350; y = targetYC + 3; targetYC += nodeHeight; }
      } else if (!targetTableName) {
        const layout = allTablesLayoutMap.get(String(tName));
        if (layout) { x = layout.x; y = layout.y; }
      } else {
        const col = customCount % 3; x = col * 450; y = customGridY[col]; customGridY[col] += nodeHeight; customCount++;
      }

      nodes.push({
        id: tName, type: 'tableNode', position: { x, y },
        data: { tableName: labels.get(tName)?.schema === schema ? tName : `${labels.get(tName)?.schema}.${labels.get(tName)?.name}`, schema: labels.get(tName)?.schema, originalName: labels.get(tName)?.name, tableComment: tableComment || '', columns: columnsData, showComments, showDataType, logicalMode }
      });
    }
  });

  const edges: Edge[] = [];
  relations.forEach((rel, i: number) => {
    const parentMatch = tableNamesByKey.get(rel.parent);
    const childMatch = tableNamesByKey.get(rel.child);
    if (parentMatch && childMatch) {
      edges.push({
        id: `edge-${parentMatch}-${childMatch}-${i}`, source: parentMatch, target: childMatch, targetHandle: rel.childColumn,
        type: 'smoothstep', animated: false, data: { isIdentifying: rel.isIdentifying },
        style: { strokeWidth: 1.5, stroke: '#555', strokeDasharray: 'none' },
        markerStart: `${MARKER_PREFIX}1-start`, markerEnd: `${MARKER_PREFIX}N-end`
      });
    }
  });

  if (import.meta.env.DEV) {
    console.debug('[ER diagram] Processing time', {
      DB: isPg ? 'PostgreSQL' : 'Oracle',
      dataRetrievalMs: dataLoadedAt - startedAt,
      diagramAssemblyMs: Date.now() - dataLoadedAt,
      tableCount: nodes.length,
      columnCount: columnRows.length
    });
  }
  return { nodes, edges };
};

export interface ErDiagramWindowProps {
  tabId?: number;
  isActive?: boolean;
  schemas?: string[];
  initialSchema?: string;
  dbType?: string;
  dbName?: string;
  userName?: string;
  tableName?: string;
}

export function useErDiagramWindow({ isActive = true, schemas, initialSchema, dbType = 'oracle', dbName = '', userName = '', tableName }: ErDiagramWindowProps) {
  const { t } = useTranslation();
  const isPg = dbType.toLowerCase().startsWith('postgres');
  const isEmbedded = !!tableName;

  useEffect(() => { injectGlobalMarkers(); }, []);

  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(true);
  const initializationStarted = useRef(false);

  const [schemaList, setSchemaList] = useState<string[]>(schemas || []);
  const [schema, setSchema] = useState('');
  const [objects, setObjects] = useState<string[]>([]);
  const [selectedObject, setSelectedObject] = useState('');

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const [showComments, setShowComments] = useState<boolean>(() => localStorage.getItem('er-show-comments') !== 'false');
  const [showDataType, setShowDataType] = useState<boolean>(() => localStorage.getItem('er-show-datatype') !== 'false');
  const [logicalMode, setLogicalMode] = useState<boolean>(() => localStorage.getItem('er-logical-mode') === 'true');

  const reactFlowWrapper = useRef<HTMLDivElement | null>(null);

  const fetchObjects = useCallback(async (targetSchema: string) => {
    if (!targetSchema) return;
    beginLoading();
    try {
      const query = isPg
        ? `SELECT table_name AS "OBJECT_NAME" FROM information_schema.tables WHERE table_schema = :owner AND table_type = 'BASE TABLE' ORDER BY table_name`
        : "SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :owner AND OBJECT_TYPE = 'TABLE' ORDER BY OBJECT_NAME";
      const res = await ipcRenderer.invoke<{ OBJECT_NAME: string }>('execute-sql-bg', query, { owner: targetSchema });
      if (res.success && res.rows) {
        let tableList: string[] = res.rows.map((row: { OBJECT_NAME: string }) => row.OBJECT_NAME);
        tableList = tableList.filter((objName: string) => !objName.startsWith('MLOG$_') && !objName.startsWith('RUPD$_'));
        setObjects(tableList);
      } else {
        throw new Error(res.error);
      }
    } catch (error: unknown) { alert(t('failed_to_retrieve_information_2') + getErrorMessage(error)); } finally { endLoading(); }
  }, [isPg, beginLoading, endLoading, t]);

  const handleChangeSchema = useCallback((e: SelectChangeEvent<string>) => {
    if (isBusy()) return;
    const newSchema = e.target.value;
    setSchema(newSchema); setSelectedObject(''); setNodes([]); setEdges([]); fetchObjects(newSchema);
    if (isPg && userName && newSchema) savePgSelectSchema(dbName, userName, newSchema);
  }, [isBusy, fetchObjects, isPg, dbName, userName]);

  const handleChangeObject = useCallback((e: SelectChangeEvent<string>) => {
    if (isBusy()) return;
    setSelectedObject(e.target.value); setNodes([]); setEdges([]);
  }, [isBusy]);

  const handleToggleShowComments = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setShowComments(checked); localStorage.setItem('er-show-comments', String(checked));
    setNodes(prev => prev.map(node => ({ ...node, data: { ...node.data, showComments: checked } })));
  }, []);

  const handleToggleShowDataType = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setShowDataType(checked); localStorage.setItem('er-show-datatype', String(checked));
    setNodes(prev => prev.map(node => ({ ...node, data: { ...node.data, showDataType: checked } })));
  }, []);

  const handleToggleLogicalMode = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setLogicalMode(checked); localStorage.setItem('er-logical-mode', String(checked));
    setNodes(prev => prev.map(node => ({ ...node, data: { ...node.data, logicalMode: checked } })));
  }, []);

  const generateAutoEr = useCallback(async () => {
    const targetSchema = isEmbedded ? initialSchema : schema;
    const targetTable = isEmbedded ? tableName : (selectedObject || null);
    if (!targetSchema) { if (!isEmbedded) alert(t("please_select_a_schema_2")); return; }
    beginLoading();
    try {
      const data = await fetchErDiagramData(isPg, targetSchema, targetTable || null, showComments, showDataType, logicalMode);
      setNodes(data.nodes); setEdges(data.edges);
    } catch (e: unknown) { alert(t("an_error_occurred_2", { error: getErrorMessage(e) })); } finally { endLoading(); }
  }, [
    isEmbedded, initialSchema, schema, tableName, selectedObject,
    isPg, showComments, showDataType, logicalMode,
    beginLoading, endLoading, t
  ]);

  const handleGenerateAutoEr = useCallback(async () => {
    if (isBusy()) return;
    await generateAutoEr();
  }, [isBusy, generateAutoEr]);

  useEffect(() => {
    if (!isEmbedded) return;
    const handleReloadSource = (e: WindowEventMap['reload-source']) => {
      const targetTable = e.detail;
      if (targetTable?.schema === initialSchema && targetTable.tableName === tableName) handleGenerateAutoEr();
    };
    window.addEventListener('reload-source', handleReloadSource);
    return () => window.removeEventListener('reload-source', handleReloadSource);
  }, [isEmbedded, initialSchema, tableName, handleGenerateAutoEr]);

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), []);

  const handleExportImage = useCallback(async () => {
    if (isBusy()) return;
    if (nodes.length === 0) { alert(t("no_nodes_to_export")); return; }
    const viewportElement = reactFlowWrapper.current?.querySelector<HTMLElement>('.react-flow__viewport');
    if (!viewportElement) return;

    const tempMarkerId = `temp-er-markers-${Date.now()}`;
    const colorVariants = [{ prefix: '', color: '#555' }];
    let defs = '';
    colorVariants.forEach(v => {
      const p = MARKER_PREFIX + v.prefix;
      const c = v.color;
      defs += `
        <marker id="${p}1-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -5,-8 L -5,8 M -5,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}01-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M -6,-8 L -6,8 M -6,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}0N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="3" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M -10,-8 L -1,0 L -10,8 M -1,0 L -10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}MANY-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}1-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 5,-8 L 5,8 M 5,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}01-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M 6,-8 L 6,8 M 6,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}0N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="-3" cy="0" r="3.5" fill="#f4f4f4" stroke="${c}" strokeWidth="1.5" /><path d="M 10,-8 L 1,0 L 10,8 M 1,0 L 10,0" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
        <marker id="${p}MANY-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="${c}" strokeWidth="1.5" /></marker>
      `;
    });
    const markerSvg = `<svg style="position: absolute; width: 0; height: 0;" id="${tempMarkerId}"><defs>${defs}</defs></svg>`;
    viewportElement.insertAdjacentHTML('afterbegin', markerSvg);

    beginLoading();
    try {
      const bounds = getNodesBounds(nodes);
      const padding = 60;
      const imageWidth = bounds.width + padding * 2;
      const imageHeight = bounds.height + padding * 2;
      const transform = `translate(${-bounds.x + padding}px, ${-bounds.y + padding}px) scale(1)`;

      const dataUrl = await toPng(viewportElement, { backgroundColor: '#f4f4f4', width: imageWidth, height: imageHeight, style: { width: `${imageWidth}px`, height: `${imageHeight}px`, transform: transform, transformOrigin: 'top left' } });
      const link = document.createElement('a'); link.download = `ER_Diagram_${Date.now()}.png`; link.href = dataUrl; link.click();
    } catch (e: unknown) { alert(t("failed_to_export_image") + getErrorMessage(e)); } finally {
      const tempElement = document.getElementById(tempMarkerId);
      if (tempElement) tempElement.remove();
      endLoading();
    }
  }, [t, nodes, beginLoading, endLoading, isBusy]);

  useEffect(() => {
    if (!isActive || initializationStarted.current) return;
    initializationStarted.current = true;
    const initData = async () => {
      try {
        if (isEmbedded) {
          await generateAutoEr();
          return;
        }
        const fetchedSchemas = await fetchErSchemas(isPg).catch((error: unknown) => {
          alert(t("failed_to_retrieve_information_2") + getErrorMessage(error));
          return schemas || [];
        });
        setSchemaList(fetchedSchemas);

        const savedSchema = isPg ? getPgSelectSchema(dbName, userName) : '';
        const finalSchema = selectErSchema(fetchedSchemas, savedSchema) || selectErSchema(fetchedSchemas, initialSchema);

        setSchema(finalSchema);
        if (finalSchema) await fetchObjects(finalSchema);
      } catch { /* Auxiliary failures must not affect the main operation's result. */
      } finally {
        endLoading();
      }
    };
    void initData();
  }, [isActive, initialSchema, schemas, isPg, dbName, userName, isEmbedded, beginLoading, endLoading, t, fetchObjects, generateAutoEr]);

  return {
    t, isLoading, schemaList, schema, objects, selectedObject,
    nodes, edges, showComments, handleToggleShowComments,
    showDataType, handleToggleShowDataType, logicalMode, handleToggleLogicalMode,
    handleChangeSchema, handleChangeObject, handleGenerateAutoEr,
    handleExportImage, onNodesChange, reactFlowWrapper
  };
}
