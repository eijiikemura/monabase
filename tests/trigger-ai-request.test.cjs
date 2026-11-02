// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const crypto = require('node:crypto');
const projectRoot = path.resolve(__dirname, '..');
const translate = (key, values) => require('../electron/i18n').translate(key, 'ja', values);

function load(file, dependencies = {}, globals = {}) {
  const runtime = { crypto, window: { require: () => ({ ipcRenderer: {} }), addEventListener() {}, removeEventListener() {} }, ...globals };
  return loadTypeScript(file, {
    '@/shared/api/desktop': { ipcRenderer: runtime.window?.require?.('electron')?.ipcRenderer || { invoke() { throw new Error('IPC test double is missing.'); } } },
    ...dependencies
  }, runtime);
}
const react = {
  useRef: value => ({ current: value }),
  useCallback: callback => callback,
  useMemo: callback => callback(),
  useState: value => [value, () => {}],
  useEffect: callback => { callback(); }
};
const translation = { useTranslation: () => ({ t: translate }) };
const objects = load('src/features/ai/useAiObjectSelection.ts', {
  react,
  "@/shared/utils/errorUtils": { getErrorMessage: error => error.message },
  './aiObjectRepository': {}
});

function createRequest(dbType, targetType = 'TABLE') {
  const opened = [], alerts = [], loaded = [];
  const selection = objects.createAiObjectSelectionStore(dbType, () => 'TEST_USER', async object => {
    loaded.push(object);
    return { definition: '対象の定義', details: {} };
  });
  const coding = { responseTarget: {}, isGenerating: false, displaySource: 'BEGIN NULL; END;' };
  const hook = load('src/features/ai/useTriggerAi.ts', {
    react, 'react-i18next': translation,
    './useAiObjectSelection': { useAiObjectSelection: () => selection },
    './useAiCodingGeneration': { useAiCodingGeneration: () => coding }
  }, { alert: message => alerts.push(message) });
  const options = {
    dbType, schema: 'TEST_USER', triggerName: 'TRG_SALES', targetName: 'AREA_SALES', targetType,
    settings: '{}', body: 'BEGIN NULL; END;', setBody() {}, applySettings() {}, onStart() {},
    isNew: true, isActive: true, isBusy: false, isAiEnabled: true,
    onOpenAiSidebar: context => opened.push(context)
  };
  return { options, opened, alerts, selection, loaded, ai: hook.useTriggerAi(options) };
}

test('Selects the target table or view and opens the AI sidebar for both databases', async () => {
  for (const dbType of ['oracle', 'postgresql']) {
    for (const targetType of ['TABLE', 'VIEW']) {
      const h = createRequest(dbType, targetType);
      h.ai.requestAi();
      assert.equal(h.opened.length, 1);
      assert.equal(h.opened[0].requestType, "coding_trigger");
      assert.equal(h.opened[0].objectSelection, h.selection);
      const [target] = h.selection.getSnapshot();
      assert.equal(target.object.key, JSON.stringify([dbType, 'TEST_USER', targetType, 'AREA_SALES']));
      assert.equal(target.status, 'loading');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(h.selection.getSnapshot()[0].status, 'ready');
      assert.equal(h.loaded.length, 1);
      h.ai.requestAi();
      assert.equal(h.selection.getSnapshot().length, 1);
    }
  }
});

test('Opens the sidebar without a target or schema and blocks incomplete submissions', () => {
  for (const dbType of ['oracle', 'postgresql']) {
    for (const field of ['schema', 'targetName']) {
      const h = createRequest(dbType);
      h.options[field] = '';
      h.ai.requestAi();
      assert.equal(h.alerts.length, 0);
      assert.equal(h.opened.length, 1);
      assert.ok(h.opened[0].validateBeforeSend().includes('対象オブジェクトを選択'));
      assert.equal(h.selection.getSnapshot().length, 0);
    }
  }
});

test('Requires a trigger name before submission and accepts it once provided', () => {
  for (const dbType of ['oracle', 'postgresql']) {
    const h = createRequest(dbType);
    h.options.triggerName = '   ';
    h.ai.requestAi();
    assert.equal(h.opened.length, 1);
    assert.ok(h.opened[0].validateBeforeSend().includes('トリガー名を入力'));
    h.options.triggerName = 'TRG_NEW';
    assert.equal(h.opened[0].validateBeforeSend(), undefined);
  }
});

test('Uses target selections changed after opening the sidebar', () => {
  const h = createRequest('oracle');
  h.options.targetName = '';
  h.ai.requestAi();
  assert.equal(h.selection.getSnapshot().length, 0);
  h.options.targetName = 'SELECTED_LATER';
  assert.equal(h.opened[0].validateBeforeSend(), undefined);
  assert.equal(h.selection.getSnapshot()[0].object.name, 'SELECTED_LATER');
  h.options.targetName = '';
  assert.ok(h.opened[0].validateBeforeSend().includes('対象オブジェクトを選択'));
});

test('Sidebar submission validates the target and trigger name', async () => {
  const header = load('src/features/ai/packageHeaderRequirement.ts');
  const { prepareAiSubmission } = load('src/features/ai/prepareAiSubmission.ts', {
    './packageHeaderRequirement': header
  });
  for (const field of ['targetName', 'triggerName']) {
    const h = createRequest('oracle');
    h.options[field] = '';
    h.ai.requestAi();
    await new Promise(resolve => setImmediate(resolve));
    const result = prepareAiSubmission({
      text: '本体を作成してください', context: h.opened[0],
      isLoading: false, hasActiveRequest: false, isHistoryReady: true,
      allowEmptySelection: true, headerMessage: '', targetMessage: '対象を選択してください'
    });
    assert.equal(result.status, 'invalid');
    assert.ok(result.message.includes(field === 'targetName' ? '対象オブジェクト' : 'トリガー名'));
  }
});

test('Changing the request target updates automatic selection', () => {
  const h = createRequest('oracle');
  h.ai.requestAi();
  h.options.targetName = 'OTHER_TABLE';
  h.ai.requestAi();
  assert.equal(h.selection.getSnapshot().length, 1);
  assert.equal(h.selection.getSnapshot()[0].object.name, 'OTHER_TABLE');
});

const responses = load('src/features/ai/codingResponse.ts', { i18next: { t: translate } });
const bodies = load('src/features/ai/triggerBodyResponse.ts', { './codingResponse': responses });
const stored = load('src/features/stored/storedCreation.ts', { i18next: { t: translate } });
const packages = load('src/features/stored/packageCreation.ts', { i18next: { t: translate } });
const coding = load('src/features/ai/useAiCodingGeneration.ts', {
  react, 'react-i18next': translation, './triggerBodyResponse': bodies,
  './codingResponse': responses, '../stored/storedCreation': stored, '../stored/packageCreation': packages
});

test('Trigger AI responses apply only the body and reject CREATE statements', () => {
  for (const dbType of ['oracle', 'postgresql']) {
    const applied = [];
    const configs = [];
    const generation = coding.useAiCodingGeneration({
      dbType, schema: 'TEST_USER', objectName: 'TRG_SALES', objectType: 'TRIGGER',
      triggerSettings: '{"target":"AREA_SALES","timing":"BEFORE"}',
      sourceText: 'BEGIN NULL; END;', setSourceText: source => applied.push(source),
      applyTriggerResponse: (source, settings) => { applied.push(source); configs.push(settings); },
      isNew: true, isActive: true, onStart() {}
    });
    assert.ok(generation.responseTarget.getReferencePrompt().includes('AREA_SALES'));
    assert.ok(generation.responseTarget.getReferencePrompt().includes('トリガー名: TRG_SALES'));
    assert.ok(generation.responseTarget.getReferencePrompt().includes('トリガー名は上記に指定済み'));
    generation.responseTarget.start();
    const body = dbType === 'oracle' ? 'BEGIN\n  NULL;\nEND;' : 'BEGIN\n  RETURN NULL;\nEND;';
    const settings = { timing: 'AFTER', events: ['INSERT', 'DELETE'], forEachRow: false };
    generation.responseTarget.commit(JSON.stringify({ status: 'success', source: body, message: '', settings }));
    assert.deepEqual(applied, [body]);
    assert.equal(configs[0].timing, 'AFTER');
    assert.equal(configs[0].events.join(','), 'INSERT,DELETE');
    assert.equal(configs[0].forEachRow, false);
    generation.responseTarget.start();
    assert.throws(() => generation.responseTarget.commit(JSON.stringify({
      status: 'success', source: 'CREATE TRIGGER TRG_SALES BEFORE INSERT ON AREA_SALES BEGIN NULL; END;', message: '', settings
    })), /トリガー本体/);
    assert.equal(applied.length, 1);
    generation.responseTarget.cancel();
  }
});

test('System prompts use the latest trigger name after the sidebar opens', () => {
  const refs = [];
  let refIndex = 0;
  const runtime = { ...react, useRef: value => {
    const index = refIndex++;
    if (!refs[index]) refs[index] = { current: value };
    return refs[index];
  } };
  const hook = load('src/features/ai/useAiCodingGeneration.ts', {
    react: runtime, 'react-i18next': translation, './triggerBodyResponse': bodies,
    './codingResponse': responses, '../stored/storedCreation': stored, '../stored/packageCreation': packages
  });
  const options = {
    dbType: 'oracle', schema: 'TEST_USER', objectName: '', objectType: 'TRIGGER',
    triggerSettings: '{"triggerName":""}', sourceText: 'BEGIN NULL; END;',
    setSourceText() {}, isNew: true, isActive: true, onStart() {}
  };
  const first = hook.useAiCodingGeneration(options);
  refIndex = 0;
  hook.useAiCodingGeneration({ ...options, objectName: 'TRG_NEW', triggerSettings: '{"triggerName":"TRG_NEW"}' });
  assert.ok(first.responseTarget.getReferencePrompt().includes('トリガー名: TRG_NEW'));
});
test('Preserves full-source application for existing procedures and packages', () => {
  for (const [objectType, source] of [
    ['PROCEDURE', 'CREATE OR REPLACE PROCEDURE TEST_USER.TEST_PROC IS BEGIN NULL; END;'],
    ['PACKAGE', 'CREATE OR REPLACE PACKAGE TEST_USER.TEST_PROC AS PROCEDURE RUN; END;']
  ]) {
    const applied = [];
    const generation = coding.useAiCodingGeneration({
      dbType: 'oracle', schema: 'TEST_USER', objectName: 'TEST_PROC', objectType,
      sourceText: source, setSourceText: value => applied.push(value), isActive: true, onStart() {}
    });
    generation.responseTarget.start();
    generation.responseTarget.commit(JSON.stringify({ status: 'success', source, message: '' }));
    assert.deepEqual(applied, [source]);
  }
});

test('Invalid AI configuration applies neither the body nor the configuration', () => {
  const valid = { timing: 'BEFORE', events: ['INSERT', 'UPDATE'], forEachRow: true };
  for (const settings of [
    undefined, null, { ...valid, timing: 'INVALID' }, { ...valid, events: [] },
    { ...valid, events: ['SELECT'] }, { ...valid, events: ['INSERT', 'INSERT'] },
    { ...valid, forEachRow: 'true' }, { timing: 'AFTER', events: ['DELETE'] },
    { ...valid, timing: 'INSTEAD OF' }, { ...valid, extra: 'unexpected' }
  ]) {
    const applied = [];
    const generation = coding.useAiCodingGeneration({
      dbType: 'oracle', schema: 'TEST_USER', objectName: 'TRG_SALES', objectType: 'TRIGGER',
      sourceText: 'BEGIN NULL; END;', setSourceText: source => applied.push(source),
      applyTriggerResponse: (source, config) => applied.push({ source, config }),
      isActive: true, onStart() {}
    });
    generation.responseTarget.start();
    assert.throws(() => generation.responseTarget.commit(JSON.stringify({
      status: 'success', source: 'BEGIN NULL; END;', message: '', settings
    })), /トリガー設定/);
    assert.equal(applied.length, 0);
    generation.responseTarget.cancel();
  }
});

test('View and PostgreSQL TRUNCATE responses follow existing screen constraints', () => {
  const answer = settings => JSON.stringify({ status: 'success', source: 'BEGIN NULL; END;', message: '', settings });
  for (const dbType of ['oracle', 'postgresql']) {
    const view = { timing: 'INSTEAD OF', events: ['INSERT', 'UPDATE'], forEachRow: true };
    assert.equal(bodies.parseTriggerCodingResponse(answer(view), dbType, 'VIEW').settings.timing, 'INSTEAD OF');
    assert.throws(() => bodies.parseTriggerCodingResponse(answer({ ...view, timing: 'AFTER' }), dbType, 'VIEW'));
    assert.throws(() => bodies.parseTriggerCodingResponse(answer({ ...view, forEachRow: false }), dbType, 'VIEW'));
  }
  const truncate = { timing: 'AFTER', events: ['TRUNCATE'], forEachRow: false };
  assert.equal(bodies.parseTriggerCodingResponse(answer(truncate), 'postgresql', 'TABLE').settings.events[0], 'TRUNCATE');
  assert.throws(() => bodies.parseTriggerCodingResponse(answer({ ...truncate, forEachRow: true }), 'postgresql', 'TABLE'));
  assert.throws(() => bodies.parseTriggerCodingResponse(answer(truncate), 'oracle', 'TABLE'));
});

test('Follow-up questions and error responses do not apply configuration', () => {
  for (const status of ['question', 'error']) {
    const response = bodies.parseTriggerCodingResponse(JSON.stringify({
      status, source: '', message: '確認してください'
    }), 'oracle', 'TABLE');
    assert.equal(response.status, status);
    assert.equal('settings' in response, false);
  }
});

test('Both database screens apply AI settings only to new triggers and retain existing database settings', () => {
  for (const dbType of ['oracle', 'postgresql']) {
    const file = path.join(projectRoot, 'src/features/' + dbType + '/windows/trigger/TriggerWindow.tsx');
    const source = ts.createSourceFile('TriggerWindow.tsx', fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let callback;
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'applyAiSettings') callback = node.initializer.arguments[0];
      ts.forEachChild(node, visit);
    }
    visit(source);
    const state = {};
    const context = {
      exports: {}, props: { isNew: true }, setWizTiming: value => { state.timing = value; },
      setWizEvents: value => { state.events = value; },
      setWizForEachRow: value => { state.forEachRow = value; }
    };
    vm.runInNewContext(ts.transpileModule('exports.apply = ' + callback.getText(source) + ';', {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
    }).outputText, context);
    const settings = { timing: 'AFTER', events: ['UPDATE', 'DELETE'], forEachRow: false };
    context.exports.apply(settings);
    assert.deepEqual(state, settings);
    context.props.isNew = false;
    context.exports.apply({ timing: 'BEFORE', events: ['INSERT'], forEachRow: true });
    assert.deepEqual(state, settings, 'Existing trigger headers must remain unchanged');
  }
});
