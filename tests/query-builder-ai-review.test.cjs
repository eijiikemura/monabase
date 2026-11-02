// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');

async function fixture() {
  const hook = createHookHarness(), applied = [], alerts = [], requests = [], loads = [];
  let context, revision = 1, fail = false;
  const table = { id: 'a', name: '"test"."Orders"', columns: ['ID', 'AMOUNT'], x: 0, y: 0 };
  let settings = { queryTables: [table], queryFields: [{ id: 'f', tableId: 'a', tableName: table.name, columnName: 'AMOUNT', show: true, sort: '', groupBy: '', criteria: '', orCriteria: '' }], queryJoins: [] };
  const answer = () => JSON.stringify({ ...settings, queryFields: settings.queryFields.map(f => ({ ...f, groupBy: 'SUM', sort: 'DESC' })) });
  const { useQueryBuilderAi } = loadTypeScript('src/features/ai/useQueryBuilderAi.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: k => k, i18n: { resolvedLanguage: 'en' } }) }
  }, { alert: message => alerts.push(message), crypto: require('node:crypto').webcrypto });
  let state;
  const render = () => state = hook.render(() => useQueryBuilderAi({ dbType: 'postgresql', title: 'Builder', isAiEnabled: true, ...settings,
    onOpenAiSidebar: value => { context = value; requests.push(value); },
    loadTableInfo: async name => { loads.push(name); if (fail) throw new Error('Metadata failed'); return { ddl: 'CREATE TABLE revision' + revision, columns: [{ name: 'ID', dataType: 'integer' }, { name: 'AMOUNT', dataType: 'numeric' }] }; },
    applySettings: value => { applied.push(value); settings = value; } }));
  const flush = async () => { for (let i = 0; i < 3; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  await flush();
  return { get state() { return state; }, get context() { return context; }, answer, applied, alerts, requests, loads, flush,
    edit: () => { settings = { ...settings, queryTables: settings.queryTables.map(t => ({ ...t, x: t.x + 1 })) }; },
    changeDatabase: () => revision++, setFailure: value => fail = value, unmount: hook.unmount };
}

test('AI JSON becomes a review and applies exactly once only after explicit confirmation and fresh metadata', async () => {
  const h = await fixture();
  try {
    await h.state.handleRequestAi(); assert.equal(h.loads.length, 1);
    assert.match(h.context.referencePrompt, /Write explanations and clarification questions in English/);
    h.context.onResponse(h.answer()); await h.flush(); assert.equal(h.applied.length, 0);
    assert.ok(h.state.review.afterSql.includes('SUM(')); assert.ok(!h.state.review.beforeSql.includes('SUM('));
    await Promise.all([h.state.applyReview(), h.state.applyReview()]); await h.flush();
    assert.equal(h.applied.length, 1); assert.equal(h.loads.length, 2); assert.equal(h.state.review, null);
    h.context.onResponse(h.answer()); await h.flush(); assert.equal(h.state.review, null); assert.equal(h.applied.length, 1);
  } finally { h.unmount(); }
});

test('Discard, edited settings, changed database definitions and failed metadata never apply an AI proposal', async () => {
  for (const mode of ['discard', 'edit', 'database', 'failure', 'unmount']) {
    const h = await fixture();
    try {
      await h.state.handleRequestAi(); h.context.onResponse(h.answer()); await h.flush();
      if (mode === 'discard') h.state.discardReview();
      if (mode === 'edit') { h.edit(); await h.flush(); }
      if (mode === 'database') h.changeDatabase();
      if (mode === 'failure') h.setFailure(true);
      if (mode === 'unmount') h.unmount();
      await h.state.applyReview(); await h.flush();
      assert.equal(h.applied.length, 0, mode);
      if (mode === 'database') assert.equal(h.alerts.at(-1), 'qb_ai_stale');
    } finally { h.unmount(); }
  }
});

test('Every AI request reloads metadata and clarification text never replaces the design', async () => {
  const h = await fixture();
  try {
    await h.state.handleRequestAi(); h.context.onResponse('Which column should be used?'); await h.flush(); assert.equal(h.state.review, null);
    await h.state.handleRequestAi(); assert.equal(h.loads.length, 2); assert.equal(h.applied.length, 0);
    assert.throws(() => h.context.onResponse('{"queryTables": []}')); assert.equal(h.applied.length, 0);
  } finally { h.unmount(); }
});
