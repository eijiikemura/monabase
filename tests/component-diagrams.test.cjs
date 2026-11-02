// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

test('ER table node keeps physical identifiers separate from logical names and optional types', () => {
  const data = { tableName: 'ORDERS', tableComment: 'Orders label', showComments: true, logicalMode: false, showDataType: true, columns: [{ name: 'ID', comment: 'Identifier', type: 'NUMBER', isPk: true, isFk: true }] };
  const f = render('src/features/er/ErDiagramWindow.tsx', { data }, { name: 'TableNode', dependencies: {
    reactflow: { Handle: 'Handle', Position: { Left: 'left', Right: 'right' } }, './useErDiagramWindow': {}, './useCustomErDiagram': {}, './AutoErDiagram': 'Auto', './CustomErDiagram': 'Custom'
  } });
  assert.ok(f.text().includes('ORDERS')); assert.ok(f.text().includes('Orders label')); assert.ok(f.text().includes('NUMBER'));
  data.logicalMode = true; data.showDataType = false; f.render(); assert.ok(!f.text().includes('ORDERS')); assert.ok(f.text().includes('Orders label')); assert.ok(!f.text().includes('NUMBER'));
  assert.ok(f.nodes().some(node => node.type === 'Handle' && node.props.id === 'ID'));
  data.showComments = false; f.render(); assert.ok(f.text().includes('ORDERS')); assert.ok(!f.text().includes('Orders label')); f.unmount();
});

test('Automatic ER view protects loading/empty exports and embeds an existing controller without another load', async () => {
  let generated = 0, exported = 0;
  const logic = { t: key => key, isLoading: true, schema: 'test', schemaList: ['test'], objects: [], selectedObject: '', showComments: false, logicalMode: false, showDataType: true, nodes: [], edges: [], handleGenerateAutoEr: () => { generated++; }, handleExportImage: () => { exported++; } };
  const f = render('src/features/er/AutoErDiagram.tsx', { logic }, { dependencies: { './useErDiagramWindow': { useErDiagramWindow() { throw new Error('Existing controller must be reused'); } }, './ErDiagramWindow': { TableNode: 'TableNode' }, reactflow: { default: 'Flow', __esModule: true, Background: 'Background', Controls: 'Controls' }, 'reactflow/dist/style.css': {} } });
  // The wrapper chooses its view; run that real view with the same hook renderer.
  const view = f.tree.type, props = f.tree.props;
  const draw = () => f.hooks.render(() => view(props));
  let tree = draw(); assert.equal(tree.props['aria-busy'], true);
  const find = (node, predicate) => { if (Array.isArray(node)) return node.flatMap(child => find(child, predicate)); if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...find(node.children, predicate), ...find(node.props?.control, predicate)]; };
  let buttons = find(tree, node => node.type === 'IconButton'); assert.equal(buttons[0].props.disabled, true);
  logic.isLoading = false; tree = draw(); const generate = find(tree, node => node.type === 'Button')[0]; assert.equal(generate.props.disabled, false); generate.props.onClick(); assert.equal(generated, 1);
  logic.nodes = [{ id: 'orders' }]; tree = draw(); buttons = find(tree, node => node.type === 'IconButton'); assert.equal(buttons[0].props.disabled, false); buttons[0].props.onClick(); assert.equal(exported, 1);
  props.tableName = 'ORDERS'; tree = draw(); assert.equal(find(tree, node => node.type === 'Select').length, 0); f.unmount();
});

test('Result headers decorate applied filters/sorts without mutating columns or marking disabled conditions', () => {
  const React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  const { decorateTableResultColumns } = loadTypeScript('src/features/data-grid/tableResultHeaders.tsx', {
    '@mui/material': { Box: 'Box', Tooltip: 'Tooltip' }, '@mui/icons-material/FilterAlt': 'Filter', '@mui/icons-material/ArrowUpward': 'Up', '@mui/icons-material/ArrowDownward': 'Down'
  }, { React });
  const columns = [{ field: 'amount' }, { field: 'hidden' }, { field: 'unchanged' }];
  const decorated = decorateTableResultColumns(columns, { amount: { type: 'NUMBER', value: '0', operator: '>=', sort: '1 DESC' }, hidden: { type: 'DISABLED', value: 'ignored', sort: 'ASC' } }, key => key);
  assert.equal(columns[0].renderHeader, undefined); assert.equal(decorated[1], columns[1]); assert.equal(decorated[2], columns[2]);
  const header = decorated[0].renderHeader(); assert.ok(header.props.title.children[0].includes('filter>= 0')); assert.ok(header.props.title.children[0].includes('sort1 DESC'));
  assert.equal(header.children[0].children[1].props['aria-label'], 'filter_applied'); assert.equal(header.children[0].children[2].children[0].props['aria-label'], 'desc');
});
