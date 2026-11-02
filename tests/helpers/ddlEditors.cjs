// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
function find(node, predicate) {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; }
  if (!node || typeof node !== 'object') return;
  if (predicate(node)) return node;
  return find(node.children || [], predicate);
}
// Keep real component handlers and effects; replace rendering, editor extensions and IPC boundaries.
async function createDdlEditor(kind, db, invoke, props = {}) {
  let pending = 0;
  const h = createHookHarness(), alerts = [], events = [], t = key => key;
  const dialect = { language: { data: { of: () => [] } } };
  const dependencies = {
    react: h.react, './triggerIdentity': loadTypeScript('src/features/postgresql/triggerIdentity.ts'), 'react-i18next': { useTranslation: () => ({ t }) },
    '@mui/material': new Proxy({}, { get: (_, key) => key }),
    '@mui/material/styles': { useTheme: () => ({ palette: { mode: 'light' } }) },
    '@uiw/react-codemirror': 'CodeMirror', '@codemirror/lang-sql': { sql: () => dialect },
    '@codemirror/lint': { linter: () => [] }, '@codemirror/view': { EditorView: {} },
    '../common/pgDialect': { pgDialect: dialect, pgBuiltinCompletions: [] },
    '../common/plsqlDialect': { plsqlDialect: dialect, oracleBuiltinCompletions: [] },
    './triggerTraceProgram': loadTypeScript(`src/features/${db}/windows/trigger/triggerTraceProgram.ts`), '../common/useTraceSimulator': { useTraceSimulator: () => ({ currentVariables: {} }) },
    '@/features/sql/hooks/useDbCompletions': { useDbCompletions: () => ({ dbSchema: {}, dbCompletions: [] }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { pending++; try { return await invoke(...args); } finally { pending--; } } } }
  };
  for (const icon of ['PlayArrow', 'DeleteOutline', 'ContentCopy']) dependencies[`@mui/icons-material/${icon}`] = {};
  const globals = { React, alert: message => alerts.push(message),
    window: { innerWidth: 1200, innerHeight: 900, confirm: () => false, addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event) },
    document: { body: { style: {} } }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout: callback => { callback(); return 1; } };
  const file = kind === 'constraint' ? 'constraint/CheckConstraintWindow.tsx' : `${kind}/use${kind === 'index' ? 'Index' : 'Trigger'}Window.ts`;
  const module = loadTypeScript(`src/features/${db}/windows/${file}`, dependencies, globals);
  const component = kind === 'constraint' ? module.default : module[kind === 'index' ? 'useIndexWindow' : 'useTriggerWindow'];
  const defaults = { tabId: 1, schema: 'test', tableName: 'Demo', initialTable: 'Demo', indexName: 'DemoIndex', triggerName: 'DemoTrigger', allSchemas: ['test'], isNew: true, isActive: true };
  const render = () => h.render(() => component({ ...defaults, ...props }));
  async function flush() {
    const deadline = Date.now() + 10000;
    for (let i = 0; i < 5 || pending; i++) {
      render(); h.commit(); await h.settle();
      if (Date.now() > deadline) throw new Error('DDL editor requests did not complete.');
      if (pending) await new Promise(resolve => setTimeout(resolve, 10));
    }
    return render();
  }
  await flush();
  return { render, flush, alerts, events, find, setConfirm: fn => { globals.window.confirm = fn; }, unmount: () => h.unmount() };
}
function createDatabaseIpc(client, type) {
  const { loadModule } = require('./loadModule.cjs');
  const handlers = new Map();
  const { registerDatabaseHandlers } = loadModule('electron/ipc/database.js', {
    '../oracle/traceDb': { TraceDatabase: { exists: () => false } }, '../postgres/traceDb': { TraceDatabase: { exists: () => false } },
    '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {}
  }, {}, { strict: false });
  registerDatabaseHandlers({ state: { client, type }, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getValidatedSettings: () => ({}), t: key => key });
  return (channel, ...args) => handlers.get(channel)(null, ...args);
}
async function readSidebarTypes(schema, filter, invoke, type = 'TYPE') {
  const h = createHookHarness(), requests = [];
  const { qualifiedObjectName } = loadTypeScript('src/shared/utils/objectIdentity.ts');
  const { useSidebarLogic } = loadTypeScript('src/features/postgresql/useSidebarLogic.ts', {
    react: { ...h.react, useEffect() {} }, './triggerIdentity': loadTypeScript('src/features/postgresql/triggerIdentity.ts'), 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    './sidebarDataTransfer': { createSidebarDataTransfer: () => ({}) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: (...args) => { const task = invoke(...args); requests.push(task); return task; } } }
  }, { setTimeout: () => 1, clearTimeout() {} });
  const render = () => h.render(() => useSidebarLogic({ schemas: [schema], expandedSchemas: [schema], onAddTab() {}, outputDateFormat: 'YYYY-MM-DD' }));
  const key = qualifiedObjectName({ schema, objectName: type });
  render().handleFilterChange(key, filter);
  await render().toggleType(schema, type);
  await Promise.all(requests); await h.settle();
  return Array.from(render().loadedObjects[key] || [], row => row.name);
}
module.exports = { createDdlEditor, createDatabaseIpc, readSidebarTypes };
