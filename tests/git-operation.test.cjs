// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');

test('A Git failure is shown and retries only the original Git operation', async () => {
  const calls = [], messages = [];
  const { runGitOperation } = loadTypeScript('src/features/git/gitOperation.ts', {
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      calls.push(args); return calls.length === 1 ? { success: false, error: 'Commit failed' } : { success: true };
    } } }
  }, { window: { confirm: message => { messages.push(message); return true; } } });
  const payload = { dbType: 'ORACLE', schema: 'TEST', objectType: 'VIEW', objectName: 'V', sourceText: 'source', message: 'Update' };
  const result = await runGitOperation((key, values) => `${key}: ${values.error}`, 'git-commit', payload);
  assert.equal(result.success, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([channel, request]) => channel === 'git-commit' && request === payload));
  assert.match(messages[0], /database_updated_but_git_failed_retry: Commit failed/);
});

test('Cancelling after an IPC rejection preserves the failure without repeating the database operation', async () => {
  let calls = 0, confirmations = 0;
  const { runGitOperation } = loadTypeScript('src/features/git/gitOperation.ts', {
    '@/shared/api/desktop': { ipcRenderer: { invoke: async () => { calls++; throw new Error('Disconnected'); } } }
  }, { window: { confirm: () => { confirmations++; return false; } } });
  const result = await runGitOperation(key => key, 'git-delete-object', { dbType: 'ORACLE', schema: 'TEST', objectType: 'VIEW', objectName: 'V' });
  assert.equal(result.success, false); assert.equal(result.error, 'Disconnected');
  assert.equal(calls, 1); assert.equal(confirmations, 1);
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: view saving surfaces commit failure and retries Git without repeating DDL`, async () => {
    const h = createHookHarness(), calls = [], confirmations = [];
    let commits = 0;
    const dialect = { language: { data: { of: () => ({}) } } };
    const { useViewWindow } = loadTypeScript(`src/features/${db}/windows/view/useViewWindow.ts`, {
      react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
      '@codemirror/lint': { linter: () => [] }, '@codemirror/lang-sql': { sql: () => ({}), PostgreSQL: dialect },
      '../common/plsqlDialect': { plsqlDialect: dialect, oracleBuiltinCompletions: [] },
      '../common/loadOracleDdl': loadTypeScript('src/features/oracle/windows/common/loadOracleDdl.ts'),
      '@/features/sql/hooks/useDbCompletions': { useDbCompletions: () => ({ dbCompletions: [], dbSchema: {} }) },
      '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, text) => {
        calls.push(channel);
        if (channel === 'execute-sql-bg') return { success: true, rows: text.includes('ALL_ERRORS') ? [] : [{ DDL: 'CREATE VIEW "TEST"."V" AS SELECT 1', definition: 'SELECT 1' }] };
        if (channel === 'git-commit' && ++commits === 1) return { success: false, error: 'Simulated commit failure' };
        return { success: true };
      } } }
    }, { window: { confirm: message => { confirmations.push(message); return true; }, dispatchEvent() {} }, alert() {}, CustomEvent: class {} });
    const render = () => h.render(() => useViewWindow({ tabId: 1, fullViewName: 'TEST.V', isActive: true }));
    render(); h.commit(); await render().loadSource();
    render().setSourceText('CREATE VIEW "TEST"."V" AS SELECT 1'); render(); h.commit();
    await render().handleSave();
    assert.equal(calls.filter(channel => channel === 'execute-sql').length, 1);
    assert.equal(calls.filter(channel => channel === 'git-commit').length, 2);
    assert.deepEqual(confirmations, ['database_updated_but_git_failed_retry']);
    assert.equal(render().hasUnsavedChanges, false, 'Database save remains successful');
  });
}

function erHookHarness(respond, confirmations) {
  const h = createHookHarness(), calls = [];
  const t = key => key;
  const { useCustomErDiagram } = loadTypeScript('src/features/er/useCustomErDiagram.ts', {
    './erDocument': loadTypeScript('src/features/er/erDocument.ts'),
    './erMetadata': loadTypeScript('src/features/er/erMetadata.ts', { '@/shared/api/desktop': {} }),
    '@/shared/hooks/useLoadingCounter': { useLoadingCounter: () => ({ isLoading: false, beginLoading() {}, endLoading() {}, isBusy: () => false }) },
    react: h.react, 'react-i18next': { useTranslation: () => ({ t }) },
    reactflow: {}, 'html-to-image': {},
    '../postgresql/windows/common/schemaStorage': { getPgSelectSchema: () => '', savePgSelectSchema() {} },
    './useErDiagramWindow': { fetchErSchemas: async () => [], fetchErDiagramData: async () => ({}) },
    '@/shared/api/desktop': { ipcRenderer: { async invoke(channel, ...args) {
      calls.push([channel, ...args]);
      if (channel === 'git-status-check') return { success: true, isRepo: true, remoteUrl: null };
      if (channel === 'get-er-diagrams') return { success: true, files: [] };
      if (channel === 'git-get-history-er') return { success: true, history: [] };
      return respond(channel, ...args);
    } } }
  }, { localStorage: { getItem: () => null }, document: { body: { style: {} } }, alert() {},
    window: { addEventListener() {}, removeEventListener() {}, confirm: message => confirmations(message) } });
  const render = () => h.render(() => useCustomErDiagram({ isActive: false, schemas: [], dbType: 'postgresql' }));
  return { h, calls, render, async prepare() {
    const first = render(); first.handleChangeCustomSchema({ target: { value: 'test' } }); first.setCustomMode('design'); first.setErDiagramName('draft');
    first.setCommitDialogOpen(true); first.setCommitMessage('保持するメッセージ');
    render(); h.commit(); await h.settle(); return render();
  } };
}

test('Cancelling an ER commit retry keeps the dialog and draft message open', async () => {
  const prompts = [];
  const h = erHookHarness(() => ({ success: false, error: 'Simulated Git failure' }), message => { prompts.push(message); return false; });
  const state = await h.prepare(); assert.equal(state.isLocalRepo, true);
  await state.handleCommit();
  assert.equal(h.render().commitDialogOpen, true);
  assert.equal(h.render().commitMessage, '保持するメッセージ');
  assert.equal(h.render().isProcessing, false);
  assert.equal(h.calls.filter(([channel]) => channel === 'git-commit-er').length, 1);
  assert.deepEqual(prompts, ['er_git_operation_failed_retry']);
});

test('ER commit and delete retries repeat only their original requests and refresh after success', async () => {
  for (const operation of ['git-commit-er', 'delete-er-diagram']) {
    let count = 0;
    const h = erHookHarness(channel => {
      assert.equal(channel, operation);
      return ++count === 1 ? { success: false, error: 'Simulated Git failure' } : { success: true };
    }, () => true);
    const state = await h.prepare();
    if (operation === 'git-commit-er') await state.handleCommit();
    else await state.handleDeleteCustomEr('draft.json', { stopPropagation() {} });
    await h.h.settle();
    const requests = h.calls.filter(([channel]) => channel === operation);
    assert.equal(requests.length, 2); assert.equal(requests[0][1], requests[1][1]);
    assert.ok(h.calls.some(([channel]) => channel === 'get-er-diagrams'));
    assert.ok(!h.calls.some(([channel]) => channel.startsWith('execute-')));
    if (operation === 'git-commit-er') assert.equal(h.render().commitDialogOpen, false);
  }
});
