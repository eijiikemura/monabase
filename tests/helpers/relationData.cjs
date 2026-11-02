// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

async function createRelationHarness(db, invoke, props = {}) {
  const hook = createHookHarness(), alerts = [], listeners = new Map();
  const t = key => key;
  const { useTableRelationTab } = loadTypeScript(`src/features/${db}/windows/table/useTableRelationTab.ts`, {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { alert: message => alerts.push(message), CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    window: { confirm: () => true, addEventListener: (type, callback) => listeners.set(type, callback),
      removeEventListener: type => listeners.delete(type), dispatchEvent: event => listeners.get(event.type)?.(event) } });
  let state;
  const render = () => (state = hook.render(() => useTableRelationTab({ schema: 'test', tableName: 'ChildMix', isActive: true, ...props })));
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
    throw new Error('Relationship state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, render, flush, waitFor, alerts, unmount: () => hook.unmount() };
}

module.exports = { createRelationHarness };
