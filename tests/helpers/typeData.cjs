// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

async function createTypeHarness(invoke, props = {}, { confirm = () => true, database = 'postgresql' } = {}) {
  const hook = createHookHarness(), alerts = [], events = [];
  const t = (key, values) => values?.error ? `${key}: ${values.error}` : key;
  const { useTypeWindow } = loadTypeScript(`src/features/${database}/windows/type/useTypeWindow.ts`, {
    './typeDiagnostics': loadTypeScript('src/features/type/typeDiagnostics.ts'),
    react: hook.react, i18next: { t }, 'react-i18next': { useTranslation: () => ({ t }) },
    '@codemirror/lint': { linter: () => [] }, '@codemirror/lang-sql': { sql: () => [] }, '@codemirror/view': { EditorView: {} },
    '../common/pgDialect': {}, '../common/plsqlDialect': {}, '@/features/sql/hooks/useDbCompletions': { useDbCompletions: () => ({ dbSchema: {} }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { alert: message => alerts.push(message), window: { confirm, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  let state;
  const render = () => (state = hook.render(() => useTypeWindow({ tabId: 1, schema: 'test', typeName: 'DemoType', isActive: true, ...props })));
  async function flush() {
    for (let i = 0; i < 3; i++) { render(); hook.commit(); await hook.settle(); }
    return render();
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do {
      await flush();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Type state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, render, flush, waitFor, alerts, events, unmount: () => hook.unmount() };
}

module.exports = { createTypeHarness };
