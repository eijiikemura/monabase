// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
async function createViewEditor(database, respond, props = {}) {
  const h = createHookHarness(), alerts = [], events = [], calls = [];
  let currentProps = { tabId: 1, fullViewName: '"test"."Demo"', isActive: true, ...props };
  const { useViewEditor } = loadTypeScript('src/features/view/useViewEditor.ts', {
    react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return respond(...args); } } }
  }, { alert: text => alerts.push(text), window: { confirm: () => true, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  const render = () => h.render(() => useViewEditor(database, currentProps));
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); h.commit(); await h.settle(); } return render(); };
  await flush();
  return { render, flush, calls, alerts, events, unmount: () => h.unmount(), update: next => { currentProps = { ...currentProps, ...next }; } };
}
module.exports = { createViewEditor };
