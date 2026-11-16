// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import DownloadIcon from '@mui/icons-material/Download';
import ReactFlow, { Background, Controls, MarkerType, useNodesState, type Edge, type Node } from 'reactflow';
import 'reactflow/dist/style.css';
import { toPng } from 'html-to-image';
import { useTranslation } from 'react-i18next';
import { TableNode } from '@/features/er/TableNode';
import type { ErTableData } from '@/features/er/erTypes';
import { backgroundRows } from './tableRepository';
import type { MysqlColumn, MysqlTableMetadata } from './tableModel';

const nodeTypes = { tableNode: TableNode };
export default function TableErTab({ schema, table, metadata, busy }: { schema: string; table: string; metadata: MysqlTableMetadata; busy: boolean }) {
  const { t } = useTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState<ErTableData>([]), [edges, setEdges] = useState<Edge[]>([]);
  const [comments, setComments] = useState(true), [types, setTypes] = useState(true), [logical, setLogical] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    const load = async () => {
      setLoading(true); setError('');
      try {
        const identities = new Map<string, { schema: string; table: string }>();
        const key = (schema: string, table: string) => JSON.stringify([schema, table]);
        identities.set(key(schema, table), { schema, table });
        for (const relation of metadata.relations) {
          identities.set(key(relation.TABLE_SCHEMA, relation.TABLE_NAME), { schema: relation.TABLE_SCHEMA, table: relation.TABLE_NAME });
          identities.set(key(relation.REFERENCED_TABLE_SCHEMA, relation.REFERENCED_TABLE_NAME), { schema: relation.REFERENCED_TABLE_SCHEMA, table: relation.REFERENCED_TABLE_NAME });
        }
        if (identities.size > 30) throw new Error(t('mysql_table_er_limit'));
        const built: Node<ErTableData>[] = [];
        let index = 0;
        for (const [id, identity] of identities) {
          const columns = id === key(schema, table) ? metadata.columns : await backgroundRows<MysqlColumn>(`SELECT c.COLUMN_NAME,c.COLUMN_TYPE,c.COLUMN_COMMENT,c.DATA_TYPE,c.ORDINAL_POSITION,COALESCE(k.ORDINAL_POSITION,0) AS PK_POSITION FROM information_schema.COLUMNS c LEFT JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_NAME='PRIMARY' AND CAST(k.TABLE_SCHEMA AS BINARY)=CAST(c.TABLE_SCHEMA AS BINARY) AND CAST(k.TABLE_NAME AS BINARY)=CAST(c.TABLE_NAME AS BINARY) AND CAST(k.COLUMN_NAME AS BINARY)=CAST(c.COLUMN_NAME AS BINARY) WHERE CAST(c.TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(c.TABLE_NAME AS BINARY)=CAST(:table AS BINARY) ORDER BY c.ORDINAL_POSITION`, identity);
          if (!current) return;
          if (!columns.length) throw new Error(t('mysql_table_er_metadata_missing', { name: identity.schema + '.' + identity.table }));
          built.push({ id, type: 'tableNode', position: { x: index % 3 * 400, y: Math.floor(index / 3) * 480 }, data: {
            tableName: identity.schema === schema ? identity.table : identity.schema + '.' + identity.table,
            tableComment: id === key(schema, table) ? metadata.table.TABLE_COMMENT : '',
            columns: columns.map(column => ({ name: column.COLUMN_NAME, type: column.COLUMN_TYPE, comment: column.COLUMN_COMMENT || '', isPk: Number(column.PK_POSITION) > 0, isFk: metadata.relations.some(relation => relation.TABLE_SCHEMA === identity.schema && relation.TABLE_NAME === identity.table && relation.COLUMN_NAME === column.COLUMN_NAME) }))
          } });
          index++;
        }
        if (!current) return;
        setNodes(built);
        setEdges(metadata.relations.map((relation, index) => ({ id: String(index), source: key(relation.REFERENCED_TABLE_SCHEMA, relation.REFERENCED_TABLE_NAME), target: key(relation.TABLE_SCHEMA, relation.TABLE_NAME), sourceHandle: relation.REFERENCED_COLUMN_NAME, targetHandle: relation.COLUMN_NAME, label: relation.CONSTRAINT_NAME, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } })));
      } catch (failure) { if (current) { setNodes([]); setEdges([]); setError(failure instanceof Error ? failure.message : t('execution_failed')); } }
      finally { if (current) setLoading(false); }
    };
    void load(); return () => { current = false; };
  }, [schema, table, metadata, revision, t, setNodes]);
  const displayed = useMemo(() => nodes.map(node => ({ ...node, data: { ...node.data, showComments: comments, showDataType: types, logicalMode: logical } })), [nodes, comments, types, logical]);
  const exportImage = async () => {
    const element = host.current;
    if (!element || loading || busy) return;
    setLoading(true); setError('');
    try {
      const url = await toPng(element, { backgroundColor: '#f4f4f4', filter: node => !(node instanceof HTMLElement) || !node.classList.contains('react-flow__controls') });
      const link = document.createElement('a'); link.download = table + '-er.png'; link.href = url; link.click();
    } catch { setError(t('failed_to_export_image')); }
    finally { setLoading(false); }
  };
  return <Box data-testid="mysql-table-er" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', p: 1, flexWrap: 'wrap' }}><Button variant="outlined" size="small" startIcon={<RefreshIcon />} disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>{t('refresh')}</Button><Button variant="outlined" size="small" startIcon={<DownloadIcon />} disabled={loading || busy || !nodes.length} onClick={() => void exportImage()}>{t('export_image')}</Button>{([[comments, setComments, 'show_comments'], [types, setTypes, 'show_data_types'], [logical, setLogical, 'mysql_table_logical_names']] as const).map(([value, setValue, label]) => <FormControlLabel key={label} label={t(label)} control={<Checkbox size="small" checked={value} onChange={event => setValue(event.target.checked)} />} />)}</Box>
    {error && <Alert severity="error">{error}</Alert>}
    {loading && <Alert severity="info">{t('processing')}</Alert>}
    <Box ref={host} sx={{ flex: 1, minHeight: 250, bgcolor: '#f4f4f4' }}><ReactFlow nodes={displayed} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} nodesConnectable={false} fitView><Background /><Controls /></ReactFlow></Box>
  </Box>;
}
