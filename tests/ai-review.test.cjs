// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createVersionControl } = require('./helpers/versionControl.cjs');

const answer = source => JSON.stringify({ status: 'success', source, message: '' });
const responseDeps = { i18next: { t: key => key } };
const codingResponse = loadTypeScript('src/features/ai/codingResponse.ts', responseDeps);
function sqlFixture(language = 'en') {
  const h = createHookHarness(), changes = [];
  const props = { sqlText: 'SELECT 1', setSqlText: text => changes.push(text), isActive: true, dbType: 'postgresql', schema: 'test' };
  const { useAiSqlGeneration } = loadTypeScript('src/features/ai/useAiSqlGeneration.ts', {
    react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language } }) }, './codingResponse': codingResponse
  }, { queueMicrotask, window: { addEventListener() {}, removeEventListener() {} } });
  const render = () => h.render(() => useAiSqlGeneration(props));
  const flush = () => { const result = render(); h.commit(); return result; };
  return { props, flush, changes, unmount: () => h.unmount() };
}

for (const language of ['en', 'ja']) {
  test(`SQL proposals in ${language} wait for approval, retain snapshots and apply only once`, () => {
    const h = sqlFixture(language);
    try {
      let target = h.flush().responseTarget;
      assert.match(target.getReferencePrompt(), language === 'ja' ? /questions in Japanese/ : /questions in English/);
      target.start(); const review = target.review(answer('SELECT 2')); target.cancel();
      assert.deepEqual(h.changes, []); assert.equal(review.before, 'SELECT 1'); assert.equal(review.after, 'SELECT 2');
      review.apply(); assert.deepEqual(h.changes, ['SELECT 2']); assert.throws(() => review.apply());
    } finally { h.unmount(); }
  });
}
test('SQL review refuses changed source, changed schema, and an unmounted editor', () => {
  for (const change of ['source', 'schema', 'unmount']) {
    const h = sqlFixture(), target = h.flush().responseTarget;
    target.start(); const review = target.review(answer('SELECT 2')); target.cancel();
    if (change === 'source') h.props.sqlText = 'SELECT 3';
    if (change === 'schema') h.props.schema = 'other';
    h.flush(); if (change === 'unmount') h.unmount();
    assert.throws(() => review.apply()); assert.deepEqual(h.changes, []); h.unmount();
  }
});

function codingFixture(language = 'en', overrides = {}) {
  const h = createHookHarness(), changes = [], settings = [];
  const props = { dbType: 'postgresql', schema: 'test', objectName: 'demo', objectType: 'FUNCTION',
    sourceText: 'CREATE OR REPLACE FUNCTION test.demo() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;',
    setSourceText: source => changes.push(source), isActive: true, onStart() {}, ...overrides };
  const { useAiCodingGeneration } = loadTypeScript('src/features/ai/useAiCodingGeneration.ts', {
    react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language } }) }, './codingResponse': codingResponse,
    './triggerBodyResponse': loadTypeScript('src/features/ai/triggerBodyResponse.ts', { './codingResponse': codingResponse }),
    '../stored/storedCreation': loadTypeScript('src/features/stored/storedCreation.ts', responseDeps),
    '../stored/packageCreation': loadTypeScript('src/features/stored/packageCreation.ts', { ...responseDeps, '@/shared/api/desktop': { ipcRenderer: {} } })
  }, { queueMicrotask, window: { addEventListener() {}, removeEventListener() {} } });
  props.applyTriggerResponse = (body, config) => { changes.push(body); settings.push(config); };
  const flush = () => { const result = h.render(() => useAiCodingGeneration(props)); h.commit(); return result; };
  return { props, flush, changes, settings, unmount: () => h.unmount() };
}
for (const language of ['en', 'ja']) {
  test(`Stored program review in ${language} preserves source until accepted and checks identity again`, () => {
    const h = codingFixture(language);
    try {
      const target = h.flush().responseTarget;
      assert.match(target.getReferencePrompt(), language === 'ja' ? /questions in Japanese/ : /questions in English/);
      target.start(); const proposed = h.props.sourceText.replace('SELECT 1', 'SELECT 2');
      const review = target.review(answer(proposed)); target.cancel();
      assert.deepEqual(h.changes, []); review.apply(); assert.deepEqual(h.changes, [proposed]);
      target.start(); const stale = target.review(answer(proposed)); target.cancel();
      h.props.objectName = 'other'; h.flush(); assert.throws(() => stale.apply()); assert.equal(h.changes.length, 1);
    } finally { h.unmount(); }
  });
}
test('Trigger review includes both source and settings and applies them together', () => {
  const h = codingFixture('en', { objectType: 'TRIGGER', sourceText: 'BEGIN RETURN NEW; END;', triggerSettings: 'BEFORE INSERT', triggerTargetType: 'TABLE' });
  try {
    const target = h.flush().responseTarget; target.start();
    const config = { timing: 'AFTER', events: ['UPDATE'], forEachRow: true };
    const review = target.review(JSON.stringify({ status: 'success', source: 'BEGIN RETURN OLD; END;', message: '', settings: config }));
    target.cancel(); assert.deepEqual(h.settings, []); assert.equal(review.beforeSettings, 'BEFORE INSERT');
    assert.equal(JSON.parse(review.afterSettings).timing, 'AFTER'); review.apply(); assert.equal(h.settings.length, 1); assert.equal(h.settings[0].timing, 'AFTER');
  } finally { h.unmount(); }
});

function find(node, predicate) {
  if (Array.isArray(node)) { for (const child of node) { const value = find(child, predicate); if (value) return value; } return; }
  if (!node || typeof node !== 'object') return;
  return predicate(node) ? node : find(node.children, predicate);
}
async function sidebarFixture({ initialMessages = [], context = {}, response = answer('SELECT 2'), failure, historyByScope, environmentResult } = {}) {
  const h = createHookHarness(), calls = [], alerts = [], saves = [];
  const sql = sqlFixture(), target = sql.flush().responseTarget;
  const react = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot() };
  const deps = {
    react, '@mui/material': new Proxy({}, { get: (_, key) => key }),
    'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) },
    './useChatScroll': loadTypeScript('src/features/ai/useChatScroll.ts', { react }),
    './AiReviewDialog': { default: 'AiReviewDialog', __esModule: true }, './AiObjectSelectionPanel': { default: 'Selection', __esModule: true },
    './codingResponse': codingResponse,
    './requestEvidence': loadTypeScript('src/features/ai/requestEvidence.ts'),
    './packageHeaderRequirement': loadTypeScript('src/features/ai/packageHeaderRequirement.ts'),
    './prepareAiSubmission': loadTypeScript('src/features/ai/prepareAiSubmission.ts', {
      './packageHeaderRequirement': loadTypeScript('src/features/ai/packageHeaderRequirement.ts')
    }),
    './sourceConversation': loadTypeScript('src/features/ai/sourceConversation.ts'),
    './useAiObjectSelection': { buildAiObjectReference: targets => targets.map(item => item.reference?.definition || '').join('\n') },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, ...args) => {
      if (channel === 'get-ai-database-context') return environmentResult || { success: true, environment: { dbType: 'postgresql', session: 'main', readOnlyMode: false, version: '16', schema: 'test' } };
      calls.push([channel, ...args]);
      if (channel === 'load-ai-source-history') return { success: true, conversation: { messages: historyByScope ? historyByScope[args[0].connectionScope] || [] : initialMessages, selectedObjects: [] } };
      if (channel === 'save-ai-source-history') { saves.push(args[1]); return { success: true }; }
      if (channel === 'ask-ai') return failure ? { success: false, cancelled: false, error: failure } : { success: true, answer: response };
      if (channel === 'cancel-ai') return { success: true };
      throw Error('Unexpected IPC: ' + channel);
    } } }
  };
  for (const name of ['RestartAlt', 'Send', 'Stop', 'ContentCopy', 'SmartToyOutlined', 'PersonOutline', 'Close', 'AutoAwesome']) deps['@mui/icons-material/' + name] = name;
  const { default: Sidebar } = loadTypeScript('src/features/ai/AiChatSidebar.tsx', deps, {
    React: react, queueMicrotask, alert: message => alerts.push(message), crypto: { randomUUID: () => 'request-1' },
    window: { confirm: () => true }, navigator: { clipboard: { writeText() {} } }
  });
  const identity = { dbType: 'postgresql', schema: 'test', category: 'FUNCTION', objectName: 'demo', signature: '' };
  const props = { connectionScope: 'a'.repeat(64), onClose() {}, setAiContext() {}, aiContext: { requestId: 'context-1', requestType: 'coding_function', targetTab: 'demo',
    sqlResponse: target, historyTarget: { getHistoryIdentity: () => identity, subscribeHistoryIdentity: () => () => {} }, ...context } };
  let tree;
  const render = () => (tree = h.render(() => Sidebar(props)));
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); h.commit(); await h.settle(); } return render(); };
  await flush();
  const button = label => find(tree, node => node.type === 'Button' && node.children.includes(label));
  const input = () => find(tree, node => node.type === 'TextField' && node.props.multiline && typeof node.props.onKeyDown === 'function');
  return { props, calls, alerts, saves, sql, flush, button, input, get tree() { return tree; },
    unmount: async () => { h.unmount(); sql.unmount(); await h.settle(); } };
}

test('Sidebar sends no diagnostic messages, stages a proposal, then persists an editable adoption summary', async () => {
  const h = await sidebarFixture({ initialMessages: [
    { id: 'old-system', sender: 'system', text: 'secret-system-display', timestamp: '12:00' },
    { id: 'old-debug', sender: 'debug', text: 'secret-debug-display', timestamp: '12:00' }
  ] });
  try {
    assert.ok(!JSON.stringify(h.tree).includes('secret-system-display')); assert.ok(!JSON.stringify(h.tree).includes('secret-debug-display'));
    h.input().props.onChange({ target: { value: 'Explain the change' } }); await h.flush();
    await h.button('send').props.onClick(); await h.flush();
    const dialog = find(h.tree, node => node.type === 'AiReviewDialog'); assert.ok(dialog); assert.deepEqual(h.sql.changes, []);
    dialog.props.onSummaryChange('Return two instead of one'); await h.flush();
    find(h.tree, node => node.type === 'AiReviewDialog').props.onApply(); await h.flush();
    assert.deepEqual(h.sql.changes, ['SELECT 2']);
    assert.ok(!find(h.tree, node => node.type === 'AiReviewDialog'));
    await h.button('reset_conversation')?.props.onClick?.();
    await h.unmount();
    const records = h.saves.flatMap(item => item.messages);
    assert.ok(records.some(message => message.adoption?.summary === 'Return two instead of one'));
    const sent = h.calls.find(([channel]) => channel === 'ask-ai'); assert.equal(sent[2].filter(message => message.role === 'system').length, 1);
    assert.ok(sent[2].every(message => !message.content.includes('secret-debug-display')));
  } finally { await h.unmount(); }
});
test('Discarding an AI proposal leaves the editor unchanged', async () => {
  const h = await sidebarFixture();
  try {
    h.input().props.onChange({ target: { value: 'Change it' } }); await h.flush(); await h.button('send').props.onClick(); await h.flush();
    find(h.tree, node => node.type === 'AiReviewDialog').props.onDiscard(); await h.flush();
    assert.deepEqual(h.sql.changes, []); assert.ok(!find(h.tree, node => node.type === 'AiReviewDialog'));
  } finally { await h.unmount(); }
});
test('Initial requests remain editable drafts and the preview matches the exact submitted payload', async () => {
  const h = await sidebarFixture({ context: { initialPrompt: 'Draft request', referencePrompt: 'CREATE TABLE customer(id integer)' } });
  try {
    assert.equal(h.calls.filter(([channel]) => channel === 'ask-ai').length, 0); assert.equal(h.input().props.value, 'Draft request');
    h.button('ai_preview_request').props.onClick(); await h.flush();
    const dialog = find(h.tree, node => node.type === 'Dialog'); assert.ok(dialog);
    const preview = find(dialog, node => node.type === 'TextField').props.value;
    assert.ok(preview.includes('CREATE TABLE customer')); assert.ok(preview.includes('questions in English'));
    await find(dialog, node => node.type === 'Button' && node.children.includes('send')).props.onClick(); await h.flush();
    const sent = h.calls.find(([channel]) => channel === 'ask-ai');
    assert.equal(preview, sent[2].map(item => `${item.role}:\n${item.content}`).join('\n\n') + '\n\nuser:\n' + sent[1]);
  } finally { await h.unmount(); }
});

test('Git summary drafts use only adopted changes and preserve edits during delayed loading', async () => {
  let release;
  const h = createVersionControl(async channel => channel === 'load-ai-source-history' ? new Promise(resolve => { release = resolve; }) : { success: true, isRepo: true },
    { objectType: 'FUNCTION', objectName: 'demo', signature: '', currentSource: 'SELECT 2' });
  try {
    await h.flush(); const first = h.render().handleUseAiSummary();
    h.render().setCommitMessage('My own message'); await h.flush();
    release({ success: true, conversation: { messages: [{ sender: 'ai', adoption: { summary: 'AI summary' } }] } }); await first;
    assert.equal(h.render().commitMessage, 'My own message');
    const second = h.render().handleUseAiSummary(); release({ success: true, conversation: { messages: [{ sender: 'ai', text: 'not adopted' }, { sender: 'ai', adoption: { summary: 'AI summary' } }] } }); await second;
    assert.equal(h.render().commitMessage, 'AI summary');
  } finally { h.unmount(); }
});

test('An adopted summary from persisted history becomes the message of a real local Git commit', async t => {
  const { createGitRepository } = require('./helpers/gitRepository.cjs');
  const { saveSourceHistory, loadSourceHistory } = require('../electron/ai/sourceHistory');
  const path = require('node:path');
  const repo = await createGitRepository(t), directory = path.join(repo.directory, 'ai-history');
  const commitResults = [];
  const identity = { connectionScope: 'a'.repeat(64), dbType: 'postgresql', schema: 'test', objectName: 'demo', category: 'FUNCTION', signature: '' };
  const source = 'CREATE FUNCTION test.demo() RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;';
  const summary = '戻り値を2に変更';
  await saveSourceHistory(directory, identity, { selectedObjects: [], messages: [{ id: 'adopted', sender: 'ai', text: 'Applied', timestamp: '12:00',
    adoption: { summary, source, appliedAt: new Date().toISOString() } }] });
  const h = createVersionControl(async (channel, ...args) => channel === 'load-ai-source-history'
    ? { success: true, conversation: await loadSourceHistory(directory, args[0]) }
    : (async () => { const response = await repo.invoke(channel, ...args); if (channel === 'git-commit') commitResults.push(response); return response; })(), { ...identity, objectType: 'FUNCTION', currentSource: source });
  try {
    await h.flush(); await h.render().handleUseAiSummary(); await h.flush();
    assert.equal(h.render().commitMessage, summary);
    const concurrentStatus = Array.from({ length: 3 }, () => repo.invoke('git-status-check'));
    await h.render().handleCommit();
    for (const status of await Promise.all(concurrentStatus)) assert.equal(status.success, true, status.error);
    assert.equal(commitResults.length, 1); assert.equal(commitResults[0].success, true, commitResults[0].error);
    const log = await repo.git.log(); assert.equal(log.latest.message, summary);
    assert.equal((await repo.git.status()).isClean(), true);
  } finally { h.unmount(); }
});

test('A changed definition invalidates the preview instead of sending an unseen request', async () => {
  const h = await sidebarFixture({ context: { initialPrompt: 'Draft', referencePrompt: 'Original definition' } });
  try {
    h.button('ai_preview_request').props.onClick(); await h.flush();
    h.props.aiContext.referencePrompt = 'Changed definition';
    await find(find(h.tree, node => node.type === 'Dialog'), node => node.type === 'Button' && node.children.includes('send')).props.onClick();
    await h.flush(); assert.equal(h.calls.filter(([channel]) => channel === 'ask-ai').length, 0);
    assert.ok(h.alerts.includes('ai_request_preview_changed'));
  } finally { await h.unmount(); }
});
test('Clarification questions stay in the conversation and never create an editable proposal', async () => {
  const h = await sidebarFixture({ response: JSON.stringify({ status: 'question', source: '', message: 'Which table?' }) });
  try {
    h.input().props.onChange({ target: { value: 'Make a query' } }); await h.flush(); await h.button('send').props.onClick(); await h.flush();
    assert.ok(!find(h.tree, node => node.type === 'AiReviewDialog')); assert.deepEqual(h.sql.changes, []);
  } finally { await h.unmount(); }
});

test('The actual review dialog renders source and trigger-setting differences with Apply and Discard controls', () => {
  const React = require('react'), mui = require('@mui/material');
  const { renderToStaticMarkup } = require('react-dom/server');
  const Review = loadTypeScript('src/features/ai/AiReviewDialog.tsx', {
    react: React,
    '@mui/material': { ...mui, Dialog: ({ children }) => React.createElement('section', null, children) },
    '@mui/material/styles': require('@mui/material/styles'),
    'react-diff-viewer-continued': require('react-diff-viewer-continued'),
    'react-i18next': { useTranslation: () => ({ t: key => key }) }
  }, { React }).default;
  const review = { before: 'SELECT 1', after: 'SELECT 2', beforeSettings: 'BEFORE', afterSettings: 'AFTER' };
  const html = renderToStaticMarkup(React.createElement(Review, { review, summary: 'Return two', onSummaryChange() {}, onApply() {}, onDiscard() {} }));
  for (const text of ['ai_source_before', 'ai_source_after', 'ai_settings_before', 'ai_settings_after', 'ai_apply_changes', 'discard', 'Return two']) assert.ok(html.includes(text), text);
});
test('Switching request context invalidates an open review and its previously captured Apply callback', async () => {
  const h = await sidebarFixture();
  try {
    h.input().props.onChange({ target: { value: 'Change it' } }); await h.flush(); await h.button('send').props.onClick(); await h.flush();
    const staleApply = find(h.tree, node => node.type === 'AiReviewDialog').props.onApply;
    h.props.aiContext = { ...h.props.aiContext, requestId: 'context-2' }; await h.flush(); staleApply();
    assert.deepEqual(h.sql.changes, []); assert.ok(!find(h.tree, node => node.type === 'AiReviewDialog'));
  } finally { await h.unmount(); }
});

test('Closing the commit dialog invalidates an outstanding summary load', async () => {
  let release;
  const h = createVersionControl(async channel => channel === 'load-ai-source-history' ? new Promise(resolve => { release = resolve; }) : { success: true, isRepo: true },
    { objectType: 'FUNCTION', objectName: 'demo', signature: '' });
  try {
    await h.flush(); h.render().setCommitDialogOpen(true); await h.flush();
    const loading = h.render().handleUseAiSummary();
    h.render().setCommitDialogOpen(false); await h.flush();
    release({ success: true, conversation: { messages: [{ sender: 'ai', adoption: { summary: 'Late summary' } }] } }); await loading;
    assert.equal(h.render().commitMessage, ''); assert.equal(h.render().isAiSummaryLoading, false);
  } finally { h.unmount(); }
});

test('AI send-key modes distinguish newline, deliberate send and IME composition without losing the draft', async () => {
  for (const mode of ['enter', 'modifier-enter']) {
    const h = await sidebarFixture();
    try {
      h.props.sendKey = mode;
      await h.flush();
      h.input().props.onChange({ target: { value: 'Explain the change' } }); await h.flush();
      const key = (extra = {}) => h.input().props.onKeyDown({ key: 'Enter', nativeEvent: {}, preventDefault() {}, ...extra });
      key({ nativeEvent: { isComposing: true } });
      key({ nativeEvent: { keyCode: 229 } });
      key({ shiftKey: true }); key({ altKey: true });
      if (mode === 'modifier-enter') key();
      await h.flush();
      assert.equal(h.calls.filter(([channel]) => channel === 'ask-ai').length, 0);
      assert.equal(h.input().props.value, 'Explain the change');
      key(mode === 'enter' ? {} : { metaKey: true }); await h.flush();
      assert.equal(h.calls.filter(([channel]) => channel === 'ask-ai').length, 1);
    } finally { await h.unmount(); }
  }
});


for (const limit of ['ai_response_size_exceeded', 'ai_idle_timeout_exceeded', 'ai_request_timeout_exceeded', 'ai_response_incomplete']) {
  test(`Sidebar never stages or applies an incomplete answer after ${limit}`, async () => {
    const h = await sidebarFixture({ failure: limit });
    try {
      h.input().props.onChange({ target: { value: 'Change the fictional SQL' } }); await h.flush();
      await h.button('send').props.onClick(); await h.flush();
      assert.deepEqual(h.sql.changes, []);
      assert.ok(!find(h.tree, node => node.type === 'AiReviewDialog'));
      assert.ok(JSON.stringify(h.tree).includes('could_not_generate_sql_reason'));
      assert.equal(h.calls.filter(([channel]) => channel === 'ask-ai').length, 1);
      assert.equal(h.sql.flush().isGenerating, false);
    } finally { await h.unmount(); }
    assert.ok(h.saves.flatMap(item => item.messages).some(message => message.sender === 'ai' && message.failed));
  });
}

test('Switching the workspace connection reloads history and excludes the previous connection from the AI payload', async () => {
  const scopeA = 'a'.repeat(64), scopeB = 'b'.repeat(64);
  const old = { id: 'production', sender: 'user', text: 'FICTIONAL_PRODUCTION_ONLY', timestamp: 'now' };
  const current = { id: 'development', sender: 'user', text: 'FICTIONAL_DEVELOPMENT_ONLY', timestamp: 'now' };
  const h = await sidebarFixture({ historyByScope: { [scopeA]: [old], [scopeB]: [current] } });
  try {
    h.props.connectionScope = scopeB;
    await h.flush();
    h.input().props.onChange({ target: { value: 'Change development only' } });
    await h.flush(); await h.button('send').props.onClick(); await h.flush();
    const request = h.calls.find(call => call[0] === 'ask-ai');
    assert.ok(request);
    assert.ok(JSON.stringify(request).includes(current.text));
    assert.ok(!JSON.stringify(request).includes(old.text));
    const loads = h.calls.filter(call => call[0] === 'load-ai-source-history');
    assert.deepEqual(loads.map(call => call[1].connectionScope), [scopeA, scopeB]);
    const saves = h.calls.filter(call => call[0] === 'save-ai-source-history');
    assert.ok(saves.some(call => call[1].connectionScope === scopeA && call[2].messages[0]?.text === old.text));
    assert.ok(saves.every(call => call[1].connectionScope !== scopeB || !JSON.stringify(call[2]).includes(old.text)));
  } finally { await h.unmount(); }
});

test('Missing workspace scope blocks restoration and AI sending instead of adopting an unscoped conversation', async () => {
  const h = await sidebarFixture();
  try {
    h.props.connectionScope = undefined;
    await h.flush();
    const before = h.calls.length;
    h.input().props.onChange({ target: { value: 'Do not send without a scope' } });
    await h.flush(); await h.button('send').props.onClick(); await h.flush();
    assert.ok(!h.calls.slice(before).some(call => call[0] === 'ask-ai' || call[0] === 'load-ai-source-history'));
  } finally { await h.unmount(); }
});

test('Git adopted summaries use the mounted connection scope and ignore a response after its scope changes', async () => {
  let resolve;
  const scopes = [];
  const h = createVersionControl(async (channel, value) => {
    if (channel === 'load-ai-source-history') {
      scopes.push(value.connectionScope);
      return new Promise(done => { resolve = done; });
    }
    return { success: true, isRepo: true };
  }, { objectType: 'FUNCTION', objectName: 'demo', connectionScope: 'a'.repeat(64) });
  try {
    await h.flush(); h.render().setCommitDialogOpen(true); await h.flush();
    const pending = h.render().handleUseAiSummary();
    h.props.connectionScope = 'b'.repeat(64); await h.flush();
    resolve({ success: true, conversation: { messages: [{ sender: 'ai', adoption: { summary: 'Production only' } }] } });
    await pending;
    assert.equal(h.render().commitMessage, '');
    const next = h.render().handleUseAiSummary();
    resolve({ success: true, conversation: { messages: [{ sender: 'ai', adoption: { summary: 'Development only' } }] } });
    await next;
    assert.equal(h.render().commitMessage, 'Development only');
    assert.deepEqual(scopes, ['a'.repeat(64), 'b'.repeat(64)]);
  } finally { h.unmount(); }
});

for (const initialNarrow of [true, false]) {
  test(`AI diff layout adapts to a ${initialNarrow ? 'narrow' : 'wide'} viewport and preserves an explicit choice without applying code`, () => {
    const h = createHookHarness();
    let narrow = initialNarrow, applied = 0;
    const react = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
    const Review = loadTypeScript('src/features/ai/AiReviewDialog.tsx', {
      react, '@mui/material': new Proxy({ useMediaQuery: () => narrow }, { get: (target, key) => target[key] || key }),
      '@mui/material/styles': { useTheme: () => ({ palette: { mode: 'light' }, breakpoints: { down: () => 'media' } }) },
      'react-diff-viewer-continued': 'Diff', 'react-i18next': { useTranslation: () => ({ t: key => key }) }
    }, { React: react }).default;
    const review = { before: 'SELECT 1', after: 'SELECT 2', beforeSettings: 'BEFORE', afterSettings: 'AFTER' };
    const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
    const render = () => h.render(() => Review({ review, summary: '', onSummaryChange() {}, onApply: () => applied++, onDiscard() {} }));
    let tree = render();
    const diffs = () => walk(tree).filter(node => node.type === 'Diff');
    assert.equal(diffs().length, 2);
    assert.ok(diffs().every(node => node.props.splitView === !initialNarrow));
    narrow = !narrow; tree = render();
    assert.ok(diffs().every(node => node.props.splitView === initialNarrow));
    walk(tree).find(node => node.type?.name === 'DiffLayoutControls').props.onChange('unified'); tree = render();
    narrow = false; tree = render();
    assert.ok(diffs().every(node => node.props.splitView === false));
    const controls = walk(tree).find(node => node.type?.name === 'DiffLayoutControls');
    const renderedControls = controls.type(controls.props);
    renderedControls.props.onChange({}, null); tree = render();
    assert.ok(diffs().every(node => node.props.splitView === false));
    assert.equal(diffs()[1].props.oldValue, review.before);
    assert.equal(diffs()[1].props.newValue, review.after);
    assert.equal(walk(tree).find(node => node.type === 'Button' && node.children.includes('ai_apply_changes')).props.disabled, true);
    assert.equal(applied, 0);
    h.unmount();
  });
}


test('Optional requirements and user-run verification reach the exact preview and repair request without executing code', async () => {
  const h = await sidebarFixture();
  try {
    const field = label => find(h.tree, node => node.type === 'TextField' && node.props.label === label);
    field('ai_brief_expectedResult').props.onChange({ target: { value: '150' } });
    field('ai_brief_actualResult').props.onChange({ target: { value: '90' } });
    field('ai_brief_verification').props.onChange({ target: { value: 'The third iteration subtracts 30.' } });
    await h.flush(); h.button('ai_create_repair_request').props.onClick(); await h.flush();
    assert.equal(h.input().props.value, 'ai_request_verification_repair');
    await h.button('send').props.onClick(); await h.flush();
    const sent = h.calls.find(call => call[0] === 'ask-ai'); assert.ok(sent);
    const payload = JSON.stringify(sent[2]);
    assert.match(payload, /150/); assert.match(payload, /The third iteration subtracts 30/);
    assert.match(payload, /readOnlyMode/); assert.match(payload, /not a claim that you executed code/);
    assert.ok(!h.calls.some(call => ['execute-sql','execute-trace','execute-stored'].includes(call[0])));
  } finally { await h.unmount(); }
});
test('Unavailable environments are disclosed instead of invented and context changes clear requirement drafts', async () => {
  const h = await sidebarFixture({ environmentResult: { success: false, error: 'PRIVATE_DRIVER_DETAIL' } });
  try {
    const field = find(h.tree, node => node.type === 'TextField' && node.props.label === 'ai_brief_constraints');
    field.props.onChange({ target: { value: 'Keep signature' } });
    h.input().props.onChange({ target: { value: 'Inspect failure' } }); await h.flush();
    await h.button('send').props.onClick(); await h.flush();
    const payload = JSON.stringify(h.calls.find(call => call[0] === 'ask-ai')[2]);
    assert.match(payload, /unavailable/); assert.ok(!payload.includes('PRIVATE_DRIVER_DETAIL'));
    h.props.aiContext = { ...h.props.aiContext, requestId: 'new-context' }; await h.flush();
    assert.equal(find(h.tree, node => node.type === 'TextField' && node.props.label === 'ai_brief_constraints').props.value, '');
  } finally { await h.unmount(); }
});
