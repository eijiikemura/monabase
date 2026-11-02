// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./loadTypeScript.cjs');
const { createHookHarness } = require('./renderHook.cjs');
const { translate } = require('../../electron/i18n');

// Run the real generator hook with deterministic randomness and replaceable desktop IPC.
async function createGeneratorHarness(db, invoke, { schema = 'test', randomValues = [], onOpenAiSidebar,
  getFullTableDDL = async () => 'CREATE TABLE demo (ID text)', RandExp = require('randexp'), random, language = 'en' } = {}) {
  const hook = createHookHarness(), alerts = [], requests = [], randoms = [...randomValues];
  const readers = [], inputs = [];
  class FileReader {
    constructor() { readers.push(this); }
    readAsText() {}
  }
  const math = Object.create(Math);
  math.random = () => randoms.length ? randoms.shift() : random ? random() : 0.9;
  const t = (key, options) => translate(key, language, options);
  const dependencies = {
    './generatorValidation': loadTypeScript('src/features/data-generator/generatorValidation.ts'),
    react: hook.react, randexp: RandExp,
    'react-i18next': { useTranslation: () => ({ t, i18n: { language } }) },
    '../common/ddlHelper': { getFullTableDDL },
    '../common/schemaStorage': { getPgSelectSchema: () => '', savePgSelectSchema() {} },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, ...args) => {
      requests.push([channel, ...args]);
      return invoke(channel, ...args);
    } } }
  };
  const globals = { alert: message => alerts.push(message), Math: math,
    FileReader, crypto: { randomUUID: () => 'test-request' },
    document: { createElement: () => {
      const input = { files: [{}], click() {} }; inputs.push(input); return input;
    } },
    localStorage: { getItem: () => null, setItem() {} },
    window: { confirm: () => true, addEventListener() {}, removeEventListener() {} } };
  const { useDataGenerator } = loadTypeScript(`src/features/${db}/windows/generator/useDataGenerator.ts`, dependencies, globals);
  let state;
  const render = () => (state = hook.render(() => db === 'oracle'
    ? useDataGenerator(true, !!onOpenAiSidebar, onOpenAiSidebar)
    : useDataGenerator(true, schema, '', '', !!onOpenAiSidebar, onOpenAiSidebar)));
  async function flush() {
    for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); }
    return render();
  }
  async function waitFor(predicate) {
    const deadline = Date.now() + 10000;
    do {
      await flush();
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    throw new Error('Generator state did not reach the expected condition.');
  }
  await flush();
  return { get state() { return state; }, alerts, requests, readers, inputs, flush, waitFor, unmount: () => hook.unmount() };
}
// Isolated deterministic streams avoid mutating Math.random or RandExp's global prototype.
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
}
function createSeededRandExp(seed) {
  const RandExp = require('randexp'), next = seededRandom(seed);
  return class extends RandExp {
    randInt(min, max) { return min + Math.floor(next() * (max - min + 1)); }
  };
}
module.exports = { createGeneratorHarness, seededRandom, createSeededRandExp };
