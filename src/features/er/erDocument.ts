// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Edge, Node } from 'reactflow';

export interface ErDocument {
  schema: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
}

// Selection, measured dimensions and display preferences are not document edits.
export function erDocumentKey(document: ErDocument): string {
  return JSON.stringify({ schema: document.schema, name: document.name,
    nodes: document.nodes.map(node => {
      const { showComments, showDataType, logicalMode, diffStatus, ...data } = node.data;
      void showComments; void showDataType; void logicalMode; void diffStatus;
      return { id: node.id, type: node.type, position: node.position, data };
    }),
    edges: document.edges.map(edge => {
      const { selected, ...content } = edge;
      void selected;
      return content;
    })
  });
}

export function erEdgeChanged(a: Edge, b: Edge): boolean {
  return JSON.stringify([a.source, a.target, a.sourceHandle, a.targetHandle, a.markerStart, a.markerEnd, a.type, a.data]) !==
    JSON.stringify([b.source, b.target, b.sourceHandle, b.targetHandle, b.markerStart, b.markerEnd, b.type, b.data]);
}

export interface ErSyncChange {
  table: string;
  column?: string;
  status: 'added' | 'modified' | 'deleted';
}
export interface ErSyncPreview {
  before: string;
  nodes: Node[];
  edges: Edge[];
  changes: ErSyncChange[];
}

// Only synchronize tables already chosen for this diagram; virtual relations survive.
export function buildErSyncPreview(document: ErDocument, latest: Node[]): ErSyncPreview {
  const changes: ErSyncChange[] = [];
  const byId = new Map(latest.map(node => [node.id, node]));
  const nodes = document.nodes.flatMap(node => {
    const fresh = byId.get(node.id);
    if (!fresh) { changes.push({ table: node.id, status: 'deleted' }); return []; }
    const oldColumns = new Map<string, unknown>(node.data.columns.map((column: { name: string }) => [column.name, column]));
    const newColumns = new Map<string, unknown>(fresh.data.columns.map((column: { name: string }) => [column.name, column]));
    if (node.data.tableComment !== fresh.data.tableComment) changes.push({ table: node.id, status: 'modified' });
    for (const [name, column] of newColumns) {
      if (!oldColumns.has(name)) changes.push({ table: node.id, column: name, status: 'added' });
      else if (JSON.stringify(oldColumns.get(name)) !== JSON.stringify(column)) changes.push({ table: node.id, column: name, status: 'modified' });
    }
    for (const name of oldColumns.keys()) if (!newColumns.has(name)) changes.push({ table: node.id, column: name, status: 'deleted' });
    const modified = changes.some(change => change.table === node.id);
    return [{ ...node, data: { ...node.data, columns: fresh.data.columns, tableComment: fresh.data.tableComment,
      diffStatus: modified ? 'modified' : undefined } }];
  });
  const ids = new Set(nodes.map(node => node.id));
  const edges = document.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  return { before: erDocumentKey(document), nodes, edges, changes };
}
