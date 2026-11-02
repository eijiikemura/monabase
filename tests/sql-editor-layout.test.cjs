// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
const material = new Proxy({}, { get: (_, name) => name });
const translation = { useTranslation: () => ({ t: (key, values) => values?.count ? `${key}:${values.count}` : key }) };
function environment(h) {
  const React = { ...h.react, useId: () => 'bind-panel-test', memo: fn => fn, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const observers = new Set();
  const globals = { React, ResizeObserver: class {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {} disconnect() { observers.delete(this); }
  } };
  const dependencies = { react: React, '@mui/material': material, 'react-i18next': translation, '@mui/icons-material/MoreHoriz': 'More' };
  return { React, observers, globals, dependencies };
}
test('SQL toolbar measures actual available width, moves auxiliary actions into More and closes it on expansion', () => {
  const h = createHookHarness(), env = environment(h);
  const Toolbar = loadTypeScript('src/features/sql/SqlEditorToolbar.tsx', env.dependencies, env.globals).default;
  const host = { clientWidth: 640 }, primary = { scrollWidth: 80 }, auxiliary = { scrollWidth: 520 };
  let tree;
  const render = () => {
    tree = h.render(() => Toolbar({ primary: 'execute', children: 'auxiliary-actions' }));
    const refs = walk(tree).filter(node => node.props.ref);
    refs[0].props.ref.current = host; refs[1].props.ref.current = primary;
    if (refs[2]) refs[2].props.ref.current = auxiliary;
  };
  const flush = () => { for (let i = 0; i < 3; i++) { render(); h.commit(); } render(); };
  const resize = width => { host.clientWidth = width; [...env.observers].forEach(observer => observer.callback()); flush(); };
  flush(); assert.equal(tree.props['data-compact'], false);
  resize(300); assert.equal(tree.props['data-compact'], true);
  const more = walk(tree).find(node => node.type === 'IconButton');
  more.props.onClick({ currentTarget: {} }); flush();
  assert.equal(walk(tree).find(node => node.type === 'Popover').props.open, true);
  assert.ok(walk(tree).some(node => node.children.includes('auxiliary-actions')));
  resize(640); assert.equal(tree.props['data-compact'], false);
  resize(300); assert.equal(walk(tree).find(node => node.type === 'Popover').props.open, false);
  resize(0); assert.equal(tree.props['data-compact'], true);
  h.unmount(); assert.equal(env.observers.size, 0);
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: bind fields collapse with container width, retain their values/types and open in a drawer on narrow screens`, () => {
    const h = createHookHarness(), env = environment(h);
    const Top = loadTypeScript(`src/features/${db}/windows/sql/SqlWindowTop.tsx`, {
      ...env.dependencies, '@mui/icons-material/Close': 'Close', '@mui/icons-material/PlayArrow': 'Play', '@mui/icons-material/AutoFixHigh': 'Format',
      '@mui/material/styles': { useTheme: () => ({ palette: { mode: 'light' } }) },
      '@/features/ai/AiRequestButton': 'AI', '@uiw/react-codemirror': 'Editor', '@/components/data/DateInput': 'DateInput',
      './useSqlWindowTop': { useSqlWindowTop: () => ({ extensions: [] }) }
    }, env.globals).default;
    let calls = 0, tree;
    const props = { sqlText: 'SELECT :amount', editorHeight: 400, isExplainMode: false, bindVariables: ['amount'], bindValues: { amount: '9007199254740993.123456789' }, bindTypes: { amount: 'NUMBER' },
      setSqlText() {}, setIsExplainMode() {}, handleExecuteSql: () => { calls++; }, handleFormatSql() {}, editorRef: {}, compileErrors: [], localInputDateFormat: 'YYYY-MM-DD',
      setBindValues: update => { props.bindValues = update(props.bindValues); }, setBindTypes: update => { props.bindTypes = update(props.bindTypes); } };
    const host = { clientWidth: 1200 };
    const render = () => { tree = h.render(() => Top(props)); tree.props.ref.current = host; };
    const flush = () => { for (let i = 0; i < 3; i++) { render(); h.commit(); } render(); };
    const resize = width => { host.clientWidth = width; [...env.observers].forEach(observer => observer.callback()); flush(); };
    const toolbar = () => walk(tree).find(node => node.type?.displayName === 'SqlToolbar');
    const toggle = () => toolbar().props.bindToggle.children[0];
    flush(); assert.ok(walk(tree).some(node => node.props['data-testid'] === 'sql-bind-panel'));
    resize(500); assert.equal(walk(tree).find(node => node.props['data-testid'] === 'sql-bind-panel'), undefined);
    assert.equal(toggle().props['aria-expanded'], false); toggle().props.onClick(); flush();
    assert.equal(walk(tree).find(node => node.type === 'Drawer').props.open, true);
    assert.equal(walk(tree).find(node => node.type === 'TextField').props.value, '9007199254740993.123456789');
    walk(tree).find(node => node.type === 'TextField').props.onChange({ target: { value: '0.000000000000000001' } });
    walk(tree).find(node => node.type === 'Select').props.onChange({ target: { value: 'STRING' } }); flush();
    walk(tree).find(node => node.type === 'Drawer').props.onClose(); flush();
    resize(1200); assert.equal(toggle().props['aria-expanded'], false);
    toggle().props.onClick(); flush();
    assert.equal(walk(tree).find(node => node.type === 'TextField').props.value, '0.000000000000000001');
    assert.equal(walk(tree).find(node => node.type === 'Select').props.value, 'STRING');
    assert.equal(calls, 0);
    props.ignoreBindVars = true; flush(); assert.equal(walk(tree).find(node => node.props['data-testid'] === 'sql-bind-panel'), undefined);
    assert.equal(props.bindValues.amount, '0.000000000000000001');
    h.unmount(); assert.equal(env.observers.size, 0);
  });
}
