// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

function createVersionControl(invoke, initial = {}) {
  const h = createHookHarness(), t = key => key, events = [], alerts = [];
  const { useVersionControlTab } = loadTypeScript('src/features/git/useVersionControlTab.ts', {
    '@/features/ai/AiHistoryConnectionContext': { useAiHistoryConnectionScope: () => props.connectionScope ?? 'a'.repeat(64) },
    react: h.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@codemirror/lang-sql': { sql: () => ({}), PostgreSQL: {} },
    '../oracle/windows/common/plsqlDialect': { plsqlDialect: {}, oracleFunctionHighlighting: {} },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, {
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event), innerHeight: 800 },
    document: { body: { style: {} } }, alert: message => alerts.push(message),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  });
  const props = { dbType: 'POSTGRESQL', schema: 'test', objectType: 'TABLE', objectName: 'orders', currentSource: '', ...initial };
  const render = () => h.render(() => useVersionControlTab(props));
  const flush = async () => { for (let i = 0; i < 3; i++) { render(); h.commit(); await h.settle(); } return render(); };
  return { props, render, flush, unmount: () => h.unmount(), events, alerts };
}
module.exports = { createVersionControl };
