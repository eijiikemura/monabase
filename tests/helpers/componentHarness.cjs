// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

// Render real component functions; replace visual libraries and external boundaries only.
function componentHarness(file, props, { dependencies = {}, globals = {}, name = 'default', themeMode = 'light' } = {}) {
  const hooks = createHookHarness(), translations = [], stateWrites = [];
  const React = { ...hooks.react, Fragment: Symbol.for('react.fragment'), Component: require('react').Component,
    memo: component => component, forwardRef: component => input => component(input, input.ref),
    createElement: (type, input, ...children) => ({ type, props: input || {}, children }),
    createContext: value => ({ value }), useContext: context => context.value,
    useState: initial => { const [value, setValue] = hooks.react.useState(initial); return [value, update => { stateWrites.push(update); setValue(update); }]; },
    useId: () => hooks.react.useRef('component-test-id').current,
    useSyncExternalStore: (subscribe, getSnapshot) => { hooks.react.useEffect(() => subscribe(() => {}), [subscribe]); return getSnapshot(); }
  };
  const t = (key, values) => { translations.push({ key, values }); return key; };
  const theme = require('@mui/material/styles').createTheme({ palette: { mode: themeMode } });
  const deps = {
    react: React, '@mui/material': new Proxy({}, { get: (_, key) => key }),
    '@mui/material/styles': { ...require('@mui/material/styles'), useTheme: () => theme },
    'react-i18next': { useTranslation: () => ({ t, i18n: { language: 'en' } }) },
    '@mui/x-data-grid': { DataGrid: 'DataGrid', GridFooterContainer: 'GridFooterContainer' },
    '@/shared/api/desktop': { ipcRenderer: { invoke() { throw new Error('Unexpected desktop request in component test.'); } } }
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
  for (const match of source.matchAll(/from\s+['"](@mui\/icons-material\/[^'"]+)['"]/g)) deps[match[1]] = match[1].split('/').at(-1);
  const overrides = typeof dependencies === 'function' ? dependencies(React, deps) : dependencies;
  const module = loadTypeScript(file, { ...deps, ...overrides }, { React, ...globals });
  let tree;
  const Component = module[name];
  const instance = Component.prototype?.render ? new Component(props) : null;
  const render = () => (tree = hooks.render(() => instance ? (instance.props = props, instance.render()) : Component(props)));
  function walk(node, found = []) {
    if (Array.isArray(node)) { node.forEach(child => walk(child, found)); return found; }
    if (!node || typeof node !== 'object' || !node.props) return found;
    found.push(node); walk(node.children, found);
    for (const key of ['action', 'control', 'label', 'title', 'helperText']) walk(node.props[key], found);
    return found;
  }
  const nodes = () => walk(tree);
  const node = (type, predicate = () => true) => nodes().find(value => value.type === type && predicate(value));
  const button = label => node('Button', value => value.children.includes(label)) || node('IconButton', value => value.props['aria-label'] === label);
  const click = async label => { const target = button(label); require('node:assert/strict').ok(target && !target.props.disabled, `Expected enabled action: ${label}`); await target.props.onClick(); render(); };
  const flush = async () => { for (let index = 0; index < 3; index++) { render(); hooks.commit(); await hooks.settle(); } render(); };
  render();
  return { props, module, React, hooks, translations, stateWrites, render, flush, nodes, node, button, click,
    text: () => nodes().flatMap(value => value.children).filter(value => typeof value === 'string').join('\n'),
    unmount: () => hooks.unmount(), get tree() { return tree; } };
}
module.exports = { componentHarness };
