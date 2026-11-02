// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

function sequenceModules(invoke) {
  const desktop = { ipcRenderer: { invoke } };
  const values = loadTypeScript('src/features/sequence/sequenceValues.ts');
  const model = loadTypeScript('src/features/sequence/sequenceModel.ts', { './sequenceValues': values });
  const metadata = loadTypeScript('src/features/sequence/sequenceMetadata.ts', { '@/shared/api/desktop': desktop, './sequenceValues': values, './sequenceModel': model });
  return { values, model, metadata, dependencies: { './sequenceMetadata': metadata, './sequenceModel': model, './sequenceValues': values } };
}
async function createSequenceHarness(db, invoke, props = {}, { confirm = () => true } = {}) {
  const hook = createHookHarness({ doubleUpdates: true }), alerts = [], events = [];
  const t = key => key;
  const { useSequenceStructureTab } = loadTypeScript(`src/features/${db}/windows/sequence/useSequenceStructureTab.ts`, {
    ...sequenceModules(invoke).dependencies, react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) }, '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { alert: message => alerts.push(message), window: { confirm, dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  let state, currentProps = props;
  const render = () => (state = hook.render(() => useSequenceStructureTab({ tabId: 1, schema: 'test', sequenceName: 'DemoSeq', isNew: false, isActive: true, onReload() {}, ...currentProps })));
  async function flush() {
    for (let i = 0; i < 3; i++) { render(); hook.commit(); await hook.settle(); }
    // Expose only a committed snapshot so event callbacks see the same draft.
    const result = render();
    hook.commit();
    return result;
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do {
      await flush();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Sequence state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, render, flush, waitFor, alerts, events, update: next => { currentProps = { ...currentProps, ...next }; }, unmount: () => hook.unmount() };
}

async function createSequenceSourceHarness(db, invoke, props = {}, clipboard = { writeText: async () => {} }) {
  const hook = createHookHarness(), alerts = [];
  const { useSequenceWindow } = loadTypeScript(`src/features/${db}/windows/sequence/useSequenceWindow.ts`, {
    ...sequenceModules(invoke).dependencies, react: hook.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) }
  }, { navigator: { clipboard }, alert: text => alerts.push(text) });
  const render = () => hook.render(() => useSequenceWindow({ tabId: 1, schema: 'test', sequenceName: 'DemoSeq', isActive: true, isNew: false, ...props }));
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  await flush();
  return { render, flush, alerts, unmount: () => hook.unmount() };
}
module.exports = { createSequenceHarness, sequenceModules, createSequenceSourceHarness };
