// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
const { translate } = require('../../electron/i18n');
async function mysqlGenerator(invoke, overrides = {}) {
  const hook = createHookHarness(), alerts = [], requests = [], contexts = [], states = [], readers = [], inputs = [];
  const t = (key, args) => translate(key, 'en', args);
  const globals = { alert: message => alerts.push(message), crypto: { randomUUID: () => 'generator-test' },
    window: { confirm: () => true }, FileReader: class { constructor() { readers.push(this); } readAsText() {} },
    document: { createElement: () => { const input = { files: [{ size: 100 }], click() {} }; inputs.push(input); return input; } } };
  const dependencies = { './generatorValidation': loadTypeScript('src/features/data-generator/generatorValidation.ts'), react: hook.react, randexp: require('randexp'), 'react-i18next': { useTranslation: () => ({ t }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { requests.push(args); return invoke(...args); } } } };
  dependencies['./generatorModel'] = loadTypeScript('src/features/mysql/generator/generatorModel.ts', dependencies, globals);
  const { useDataGenerator } = loadTypeScript('src/features/mysql/generator/useDataGenerator.ts', dependencies, globals);
  const props = { active: true, initialSchema: 'mb_test', schemas: ['mb_test'], settings: { inputDateFormat: 'YYYY-MM-DD' }, externalBusy: false, disabled: false, readonly: false, aiEnabled: true, tabId: 1, onOpenAi: c => contexts.push(c), onState: s => states.push(s), onBusyChange() {}, ...overrides };
  let state;
  const render = () => (state = hook.render(() => useDataGenerator(props)));
  async function flush() { for (let i = 0; i < 8; i++) { render(); hook.commit(); await hook.settle(); } return render(); }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do { await flush(); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 10)); } while (Date.now() < deadline);
    throw new Error('MySQL generator did not reach expected state: ' + state.error);
  }
  await flush();
  return { get state() { return state; }, props, alerts, requests, contexts, states, readers, inputs, flush, waitFor, unmount: () => hook.unmount() };
}
module.exports = { mysqlGenerator };
