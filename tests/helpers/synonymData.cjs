// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
function synonymModules(invoke) {
  return loadTypeScript('src/features/oracle/synonymDefinition.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke } } });
}
async function createSynonymHarness(invoke, props = {}, { confirm = () => true, clipboard = { writeText: async () => {} } } = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), alerts = [], events = [];
  const { useSynonymWindow } = loadTypeScript('src/features/oracle/windows/synonym/useSynonymWindow.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: (key, values) => values?.error ? `${key}: ${values.error}` : key }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { navigator: { clipboard }, alert: text => alerts.push(text), window: { confirm, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  let currentProps = { tabId: 1, schema: 'TEST', synonymName: 'DemoSyn', isNew: false, isActive: true, allSchemas: ['TEST'], ...props }, state;
  const render = () => (state = hook.render(() => useSynonymWindow(currentProps)));
  async function flush() { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('Synonym state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, render, flush, waitFor, update: next => { currentProps = { ...currentProps, ...next }; }, alerts, events, unmount: () => hook.unmount() };
}
module.exports = { synonymModules, createSynonymHarness };
