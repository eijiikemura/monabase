// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { clearConditionInputs, hasConditionInput } = loadTypeScript('src/shared/utils/queryConditions.ts');

test('Condition clearing preserves exact column names, types and exclusions without mutating existing conditions', () => {
  const values = Object.fromEntries(['__proto__', 'constructor', 'Order.Items', '日本語'].map((name, i) =>
    [name, Object.freeze({ type: i === 1 ? 'DISABLED' : i === 2 ? 'DATE' : 'STRING', value: 'kept', sort: '1 DESC', operator: 'LIKE' })]));
  Object.freeze(values);
  const cleared = clearConditionInputs(values);
  assert.deepEqual(Object.keys(cleared), Object.keys(values));
  for (const name of Object.keys(values)) {
    assert.equal(cleared[name].type, values[name].type);
    assert.equal(cleared[name].value, ''); assert.equal(cleared[name].sort, ''); assert.equal(cleared[name].operator, '=');
    assert.equal(values[name].value, 'kept'); assert.notEqual(cleared[name], values[name]);
  }
  assert.equal(hasConditionInput({ type: 'STRING', value: ' ', sort: '', operator: '=' }), true);
  assert.equal(hasConditionInput({ type: 'DISABLED', value: 'x', sort: '1', operator: '=' }), false);
  assert.equal(hasConditionInput({ type: 'STRING', value: '', sort: '1', operator: '=' }, false), false);
});

test('Column search and active-only display preserve hidden conditions; clearing is atomic and never executes a query', () => {
  const h = createHookHarness();
  const react = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const Panel = loadTypeScript('src/components/data/ConditionPanel.tsx', {
    react, '@mui/material': new Proxy({}, { get: (_, key) => key }), '@mui/icons-material/PlayArrow': 'Play',
    'react-i18next': { useTranslation: () => ({ t: (key, values) => values?.total ? key + ':' + values.total : key }) },
    './DateInput': 'DateInput'
  }, { React: react }).default;
  let executed = 0, cleared = 0;
  const props = { columns: ['Name', 'Created', 'Excluded'], conditions: {
    Name: { type: 'STRING', value: 'value', sort: '', operator: '=' }, Created: { type: 'DATE', value: '', sort: '1 DESC', operator: '=' },
    Excluded: { type: 'DISABLED', value: 'skip', sort: '', operator: '=' }
  }, inputDateFormat: 'YYYY-MM-DD', onConditionChange() {}, onExecute: () => executed++,
  onClearConditions: () => { cleared++; props.conditions = clearConditionInputs(props.conditions); } };
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children), ...walk(value.props?.control)];
  let tree;
  const render = () => { tree = h.render(() => Panel(props)); h.commit(); };
  const titles = () => walk(tree).filter(node => node.type === 'Typography' && node.props.title).map(node => node.props.title);
  render(); assert.deepEqual(titles(), ['Name', 'Created', 'Excluded']);
  walk(tree).find(node => node.type === 'Checkbox').props.onChange({ target: { checked: true } }); render();
  assert.deepEqual(titles(), ['Name', 'Created']);
  walk(tree).find(node => node.type === 'TextField' && node.props.label === 'condition_search_columns').props.onChange({ target: { value: 'name' } }); render();
  assert.deepEqual(titles(), ['Name']);
  assert.equal(props.conditions.Created.sort, '1 DESC');
  assert.ok(walk(tree).some(node => node.children.includes('condition_hidden_active:1')));
  assert.equal(executed, 0);
  walk(tree).find(node => node.type === 'Button' && node.children.includes('condition_clear_all')).props.onClick(); render();
  assert.equal(cleared, 1); assert.equal(executed, 0);
  assert.deepEqual(titles(), []); assert.equal(props.conditions.Excluded.type, 'DISABLED');
  walk(tree).find(node => node.type === 'Checkbox').props.onChange({ target: { checked: false } }); render();
  assert.deepEqual(titles(), ['Name']);
  assert.equal(props.conditions.Created.type, 'DATE');
  walk(tree).find(node => node.type === 'Button' && node.children.includes('execute')).props.onClick();
  assert.equal(executed, 1);
  props.disabled = true; render();
  assert.ok(walk(tree).filter(node => ['TextField', 'Checkbox', 'Button'].includes(node.type)).every(node => node.props.disabled));
  h.unmount();
});
