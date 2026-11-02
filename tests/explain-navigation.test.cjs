// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { parseObjectIdentity } = loadTypeScript('src/shared/utils/objectIdentity.ts');
const identity = loadTypeScript('src/features/sql/explainIdentity.ts');

const react = {
  useMemo: fn => fn(), useState: value => [value, () => {}], useCallback: fn => fn, memo: fn => fn,
  createElement: (type, props, ...children) => ({ type, props: props || {}, children })
};
const translation = { useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) };
const { useSqlWindowBottom } = loadTypeScript('src/features/sql/useSqlWindowBottom.ts', {
  react, 'react-i18next': translation, './explainIdentity': identity,
  '../data-grid/dataGridHelper': { buildTransposedColumns: () => [] },
  '@/shared/api/desktop': { ipcRenderer: { invoke() { throw new Error('Navigation must not query a database.'); } } }
});
const events = [];
const dependencies = {
  '@/shared/api/desktop': { ipcRenderer: { invoke() { throw new Error('Navigation must not query a database.'); } } },
  '@/features/data-grid/GridViewport': { GridViewport: 'GridViewport' },
  react, 'react-i18next': translation, './useSqlWindowBottom': {},
  '@mui/x-data-grid': {}, '@mui/material': { Box: 'Box', Typography: 'Typography', IconButton: 'IconButton', Collapse: 'Collapse' },
  '../ai/AiRequestButton': {}, '@/components/data/ExportDialog': {}
};
for (const icon of ['DeleteOutline', 'SwapHoriz', 'ExpandMore', 'ChevronRight']) dependencies[`@mui/icons-material/${icon}`] = {};
const { ExplainTreeNode } = loadTypeScript('src/features/sql/SqlWindowBottom.tsx', dependencies, {
  window: { dispatchEvent: event => events.push(event) },
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
});
function click(node, dbType) {
  const tree = ExplainTreeNode({ node, dbType });
  const find = current => {
    if (!current || typeof current !== 'object') return;
    if (current.type === 'Typography' && current.props.onClick) return current;
    for (const child of Array.isArray(current) ? current : current.children || []) { const result = find(child); if (result) return result; }
  };
  find(tree).props.onClick();
}
function parse(dbType, rows) {
  return useSqlWindowBottom({ dbType, rows, columns: [], isExplainResult: true, dateFormat: 'YYYY-MM-DD', selectedSchema: 'wrong_schema' }).parsedExplain.tree;
}

test('PostgreSQL plan clicks preserve real schemas and quoted table names instead of aliases', () => {
  for (const [schema, name] of [['archive', 'orders'], ['Archive.Mixed', 'Order.Items'], ['Owner\'s"Schema', '日本語"Items']]) {
    const plan = { 'Node Type': 'Seq Scan', Schema: schema, 'Relation Name': name, Alias: 'alias_only' };
    const [node] = parse('postgresql', [{ PLAN_TABLE_OUTPUT: JSON.stringify([{ Plan: plan }]) }]);
    events.length = 0; click(node, 'postgresql');
    assert.equal(events.length, 1); assert.equal(events[0].type, 'open-table-tab');
    assert.deepEqual({ ...parseObjectIdentity(events[0].detail.tableName) }, { schema, objectName: name });
    assert.equal(events[0].detail.targetTab, 'structure');
  }
});

test('Index-only, alias-only and unresolved PostgreSQL nodes cannot open tables', () => {
  for (const plan of [
    { 'Node Type': 'Bitmap Index Scan', 'Index Name': 'orders_idx', Schema: 'archive' },
    { 'Node Type': 'CTE Scan', Alias: 'orders' },
    { 'Node Type': 'Seq Scan', 'Relation Name': 'orders' }
  ]) {
    const [node] = parse('postgresql', [{ PLAN_TABLE_OUTPUT: JSON.stringify([{ Plan: plan }]) }]);
    assert.equal(node.table, undefined); events.length = 0; click(node, 'postgresql'); assert.equal(events.length, 0);
  }
});

test('Oracle plan navigation uses structured ownership and object type rather than display names', () => {
  for (const type of ['TABLE', 'table']) {
    const [node] = parse('oracle', [{ PLAN_TABLE_OUTPUT: '|* 1 | TABLE ACCESS FULL | display.alias | 1 | 1 | 1 | 1 |',
      PLAN_OBJECT_OWNER: 'Actual.Owner', PLAN_OBJECT_NAME: "Order's.Items", PLAN_OBJECT_TYPE: type }]);
    events.length = 0; click(node, 'oracle');
    assert.equal(events.length, 1);
    assert.deepEqual({ ...parseObjectIdentity(events[0].detail.tableName) }, { schema: 'Actual.Owner', objectName: "Order's.Items" });
  }
  for (const metadata of [{}, { PLAN_OBJECT_OWNER: 'TEST', PLAN_OBJECT_NAME: 'SYS_TEMP', PLAN_OBJECT_TYPE: 'TABLE (TEMP)' }, { PLAN_OBJECT_OWNER: 'TEST', PLAN_OBJECT_NAME: 'IDX', PLAN_OBJECT_TYPE: 'INDEX' },
    { PLAN_OBJECT_OWNER: '', PLAN_OBJECT_NAME: 'T', PLAN_OBJECT_TYPE: 'TABLE' }]) {
    const [node] = parse('oracle', [{ PLAN_TABLE_OUTPUT: '| 1 | INDEX RANGE SCAN | IDX | 1 | 1 | 1 | 1 |', ...metadata }]);
    events.length = 0; click(node, 'oracle'); assert.equal(events.length, 0);
  }
});
