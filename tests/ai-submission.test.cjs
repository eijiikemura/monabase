// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const header = loadTypeScript('src/features/ai/packageHeaderRequirement.ts');
const { prepareAiSubmission } = loadTypeScript('src/features/ai/prepareAiSubmission.ts', {
  './packageHeaderRequirement': header
});
const readyObject = () => ({
  object: { dbType: 'oracle', schema: 'APP', category: 'TABLE', name: 'ITEMS' },
  status: 'ready', reference: { definition: 'CREATE TABLE ITEMS (ID NUMBER)' }
});
function options(overrides = {}) {
  return { text: '  query  ', isLoading: false, hasActiveRequest: false, isHistoryReady: true,
    context: null, allowEmptySelection: false, headerMessage: 'Header required', targetMessage: 'Objects required', ...overrides };
}

test('Empty, busy, and unhydrated submissions stop before validating the target', () => {
  for (const overrides of [{ text: ' \n' }, { isLoading: true }, { hasActiveRequest: true }, { isHistoryReady: false }]) {
    let validations = 0;
    const result = prepareAiSubmission(options({ context: { validateBeforeSend() { validations++; } }, ...overrides }));
    assert.equal(result.status, 'blocked');
    assert.equal(validations, 0);
  }
});

test('Submission reads objects synchronized by target validation rather than a stale snapshot', () => {
  let selected = [];
  const target = readyObject();
  const result = prepareAiSubmission(options({ context: {
    validateBeforeSend() { selected = [target]; },
    objectSelection: { isAvailable: () => true, getSnapshot: () => selected }
  } }));
  assert.equal(result.status, 'ready');
  assert.equal(result.text, 'query');
  assert.equal(result.targets[0], target);
});

test('Disposed, loading, failed, and empty object definitions prevent a submission', () => {
  for (const [available, objects] of [
    [false, [readyObject()]], [true, []], [true, [{ ...readyObject(), status: 'loading' }]],
    [true, [{ ...readyObject(), status: 'error' }]], [true, [{ ...readyObject(), reference: undefined }]],
    [true, [{ ...readyObject(), reference: { definition: '' } }]]
  ]) {
    const result = prepareAiSubmission(options({ context: {
      objectSelection: { isAvailable: () => available, getSnapshot: () => objects }
    } }));
    assert.equal(result.status, 'invalid');
    assert.equal(result.message, 'Objects required');
  }
});

test('Coding can omit object selections while a selected loading object still blocks it', () => {
  const selection = { isAvailable: () => true, getSnapshot: () => [] };
  const settings = options({ allowEmptySelection: true, context: { objectSelection: selection } });
  assert.equal(prepareAiSubmission(settings).status, 'ready');
  selection.getSnapshot = () => [{ ...readyObject(), status: 'loading' }];
  assert.equal(prepareAiSubmission(settings).status, 'invalid');
});

test('Collapsed AI references keep live preparation and error counts without discarding targets or disabling recovery', () => {
  const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const h = createHookHarness(), retried = [], removed = [];
  let targets = [{ object: { key: 'one', schema: 'test', displayName: 'one', category: 'TABLE' }, status: 'ready' }];
  let available = true;
  const react = { ...h.react, useId: () => 'references', useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const deps = { react, '@mui/material': new Proxy({}, { get: (_, key) => key }),
    './relatedObjects': { listRelatedObjects: async () => [] },
    'react-i18next': { useTranslation: () => ({ t: (key, args) => args?.total ? key + ':' + args.total : key }) },
    './aiObjectRepository': { getAiCategoryLabel: category => category }, './AiObjectPickerDialog': 'Picker' };
  for (const icon of ['Add', 'Close', 'Refresh', 'ExpandMore', 'ChevronRight']) deps['@mui/icons-material/' + icon] = icon;
  const Panel = loadTypeScript('src/features/ai/AiObjectSelectionPanel.tsx', deps, { React: react }).default;
  const selection = { id: 'source', subscribe: () => () => {}, getSnapshot: () => targets, isAvailable: () => available,
    retryObject: key => retried.push(key), removeObject: key => removed.push(key) };
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
  let tree;
  const render = () => { tree = h.render(() => Panel({ selection, disabled: false })); h.commit(); };
  const toggle = () => walk(tree).find(node => node.type === 'Button' && node.props['aria-controls']);
  render(); assert.equal(toggle().props['aria-expanded'], true);
  toggle().props.onClick(); render();
  assert.equal(walk(tree).find(node => node.type === 'Collapse').props.in, false);
  targets = [...targets, { object: { key: 'two', schema: 'test', displayName: 'two', category: 'VIEW' }, status: 'loading' },
    { object: { key: 'three', schema: 'test', displayName: 'three', category: 'VIEW' }, status: 'error', error: 'Failed definition' }];
  render();
  const status = walk(tree).find(node => node.props.role === 'status');
  assert.ok(status.children[0].includes('ai_references_loading:1'));
  assert.ok(status.children[0].includes('ai_references_failed:1'));
  assert.equal(toggle().props['aria-expanded'], false);
  assert.equal(targets.length, 3); assert.deepEqual(removed, []);
  toggle().props.onClick(); render();
  walk(tree).find(node => node.props['aria-label'] === 'reload_definitions').props.onClick();
  assert.deepEqual(retried, ['three']);
  available = false; render();
  assert.ok(walk(tree).some(node => node.children.includes('the_target_sql_window_has_been_closed')));
  h.unmount();
});

test('Related object suggestions fetch names on demand and add a reference only after an explicit click', async () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const h = createHookHarness(), added = [], lookedUp = [];
  const child = { key: 'child', dbType: 'postgresql', schema: 'test', name: 'child', displayName: 'child', category: 'TABLE' };
  const parent = { ...child, key: 'parent', name: 'parent', displayName: 'parent' };
  const selection = { id: 'related', subscribe: () => () => {}, isAvailable: () => true,
    getSnapshot: () => [{ object: child, status: 'ready', reference: { definition: 'CREATE TABLE child', details: {} } }],
    addObjects: values => added.push(...values), removeObject() {}, retryObject() {} };
  const react = { ...h.react, useId: () => 'related', useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const deps = { react, '@mui/material': new Proxy({}, { get: (_, key) => key }),
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    './aiObjectRepository': { getAiCategoryLabel: category => category }, './AiObjectPickerDialog': 'Picker',
    './relatedObjects': { listRelatedObjects: async object => { lookedUp.push(object); return [parent]; } } };
  for (const icon of ['Add', 'Close', 'Refresh', 'ExpandMore', 'ChevronRight']) deps['@mui/icons-material/' + icon] = icon;
  const Panel = loadTypeScript('src/features/ai/AiObjectSelectionPanel.tsx', deps, { React: react }).default;
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
  const text = node => node.children.flat(Infinity).filter(child => typeof child === 'string').join('');
  let tree;
  const render = () => { tree = h.render(() => Panel({ selection, disabled: false })); h.commit(); };
  try {
    render(); assert.equal(lookedUp.length, 0);
    walk(tree).find(node => node.type === 'Button' && text(node) === 'ai_find_related_objects').props.onClick();
    await h.settle(); render();
    assert.equal(lookedUp.length, 1); assert.equal(added.length, 0);
    walk(tree).find(node => node.type === 'Button' && text(node).includes('parent')).props.onClick();
    assert.equal(added.length, 1); assert.equal(added[0].key, 'parent');
  } finally { h.unmount(); }
});
