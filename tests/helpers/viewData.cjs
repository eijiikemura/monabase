// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');

// Drive the real view hook; only React scheduling and the desktop boundary are simulated.
async function createViewHarness(db, desktop, props = {}) {
  const hook = createHookHarness(), alerts = [];
  const { useViewDataTab } = loadTypeScript(`src/features/${db}/windows/view/useViewDataTab.ts`, {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/features/data-grid/dataGridHelper': {
      buildGridColumns: columns => columns.map(column => ({ field: column.name, headerName: column.name })),
      buildTransposedColumns: () => []
    }, '@/shared/api/desktop': desktop
  }, { window: { addEventListener() {}, removeEventListener() {} }, alert: message => alerts.push(message) });
  let state;
  const render = () => (state = hook.render(() => useViewDataTab({ schema: 'test', viewName: 'items', isActive: true, ...props })));
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
    throw new Error('View state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, render, flush, waitFor, alerts, unmount: () => hook.unmount() };
}

module.exports = { createViewHarness };
