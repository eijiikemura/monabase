// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createUsageRecord, appendUsage, readUsage } = require('../electron/ai/usageHistory');

const record = text => ({ ...createUsageRecord(text, 'model', new Date(2026, 9, 17, 12, 30)), inputTokens: 100, outputTokens: 20 });
async function directories(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-usage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, history: path.join(root, 'history') };
}

test('Stores usage in the history directory without creating legacy files', async t => {
  const { root, history } = await directories(t);
  await appendUsage(history, record('新しい履歴'), root);
  assert.equal((await readUsage(history, 2026, root))[0].requestType, '新しい履歴');
  await assert.rejects(fs.stat(path.join(root, 'ai-usage-2026.csv')), { code: 'ENOENT' });
});

test('Migrates existing history on first read and preserves the legacy file after appending', async t => {
  const { root, history } = await directories(t);
  await appendUsage(root, record('以前の履歴'));
  const oldText = await fs.readFile(path.join(root, 'ai-usage-2026.csv'), 'utf8');
  assert.equal((await readUsage(history, 2026, root)).length, 1);
  await appendUsage(history, record('追加した履歴'), root);
  assert.deepEqual((await readUsage(history, 2026, root)).map(row => row.requestType), ['以前の履歴', '追加した履歴']);
  assert.equal(await fs.readFile(path.join(root, 'ai-usage-2026.csv'), 'utf8'), oldText);
});

test('Concurrent initial reads and appends neither lose nor duplicate history', async t => {
  const { root, history } = await directories(t);
  await appendUsage(root, record('以前の履歴'));
  await Promise.all([readUsage(history, 2026, root), appendUsage(history, record('新しい履歴'), root)]);
  assert.deepEqual((await readUsage(history, 2026, root)).map(row => row.requestType), ['以前の履歴', '新しい履歴']);
});

test('Existing history at the new location is never overwritten by legacy data', async t => {
  const { root, history } = await directories(t);
  await appendUsage(root, record('旧ファイル'));
  await appendUsage(history, record('新ファイル'));
  assert.deepEqual((await readUsage(history, 2026, root)).map(row => row.requestType), ['新ファイル']);
});

test('Preserves empty history, other years, quotes, and multiline content', async t => {
  const { root, history } = await directories(t);
  assert.deepEqual(await readUsage(history, 2025, root), []);
  const value = record('依頼,"内容"\n次の行');
  await appendUsage(history, value, root);
  assert.deepEqual(await readUsage(history, 2026, root), [value]);
  await assert.rejects(readUsage(history, 0, root), /履歴の年が不正/);
});

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
function usageFixture(respond = async () => ({ success: true, records: [] })) {
  const h = createHookHarness(), calls = [], listeners = new Map();
  const React = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const t = (key, args) => key + (args?.count !== undefined ? ':' + args.count : '');
  class Clock extends Date { constructor(...args) { if (args.length) super(...args); else super(2026, 9, 29, 12); } }
  const module = loadTypeScript('src/features/ai/AiUsageHistoryDialog.tsx', {
    react: React, '@mui/material': new Proxy({}, { get: (_, name) => name }), '@mui/x-data-grid': { DataGrid: 'DataGrid' },
    'react-i18next': { useTranslation: () => ({ t }) }, '@/components/data/ExportDialog': 'Export', '@/features/data-grid/GridViewport': { GridViewport: 'GridViewport' },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, year) => { assert.equal(channel, 'get-ai-usage-history'); calls.push(year); return respond(year, calls.length); },
      on: (channel, fn) => listeners.set(channel, fn), removeListener: channel => listeners.delete(channel) } }
  }, { React, Date: Clock });
  const props = { open: true, onClose() {}, outputDateFormat: 'YYYY-MM-DD' }; let tree;
  const render = () => { tree = h.render(() => module.default(props)); return tree; };
  const flush = async () => { for (let i = 0; i < 3; i++) { render(); h.commit(); await h.settle(); } render(); };
  const nodes = () => walk(tree), node = type => nodes().find(value => value.type === type);
  const button = label => nodes().find(value => value.type === 'Button' && value.children.includes(label));
  const changeMonth = value => { node('TextField').props.onChange({ target: { value } }); render(); };
  const totals = () => walk(nodes().find(value => value.props['data-testid'] === 'ai-usage-totals')).filter(value => value.type === 'Typography').map(value => value.children.at(-1));
  render(); return { ...module, h, props, calls, listeners, render, flush, node, nodes, button, changeMonth, totals };
}
const pendingUsage = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const usageRecord = (requestedAt, inputTokens = 12, outputTokens = 3) => ({ requestedAt, requestType: 'sql_generation', modelName: 'demo-model', inputTokens, outputTokens });
test('Usage month selection validates bounds, moves directly and returns to the current month without loading invalid years', async () => {
  const f = usageFixture();
  try {
    for (const value of ['', '0000-01', '10000-01', '2026-00', '2026-13', '2026-1', '2026-10-extra']) assert.equal(f.parseUsageMonth(value), null);
    await f.flush(); f.changeMonth('0001-01'); await f.flush(); assert.equal(f.button('previous_month').props.disabled, true);
    f.changeMonth('9999-12'); await f.flush(); assert.equal(f.button('next_month').props.disabled, true);
    f.changeMonth(''); assert.equal(f.node('TextField').props.error, true); assert.equal(f.node('Export').props.disabled, true);
    f.button('ai_usage_this_month').props.onClick(); await f.flush(); assert.equal(f.node('TextField').props.value, '2026-10');
    assert.deepEqual(f.calls, [2026, 1, 9999, 2026]);
  } finally { f.h.unmount(); }
});
test('Usage loading and failure show unavailable totals, retry remains in the dialog and successful empty history shows zero', async () => {
  const retry = pendingUsage(); const f = usageFixture(async (_year, call) => call === 1 ? { success: false, error: 'read failed' } : retry.promise);
  try {
    assert.deepEqual(f.totals(), ['—', '—']); assert.equal(f.node('Export').props.disabled, true);
    await f.flush(); assert.equal(f.node('Alert').children[0], 'read failed'); assert.deepEqual(f.totals(), ['—', '—']);
    // The retry button is an Alert action rather than a direct child in the test tree.
    f.node('Alert').props.action.props.onClick(); f.render();
    assert.deepEqual(f.totals(), ['—', '—']); assert.equal(f.node('DataGrid').props.loading, true);
    await f.flush(); retry.resolve({ success: true, records: [] }); await f.flush();
    assert.deepEqual(f.calls, [2026, 2026]); assert.deepEqual(f.totals(), ['0', '0']);
    assert.equal(f.node('DataGrid').props.localeText.noRowsLabel, 'no_ai_usage_history_for_this_month');
  } finally { f.h.unmount(); }
});
test('Late usage responses cannot overwrite another year and same-year month changes reuse the loaded records and reset pagination', async () => {
  const first = pendingUsage(), second = pendingUsage(); const f = usageFixture(async (_year, call) => call === 1 ? first.promise : second.promise);
  try {
    await f.flush(); f.changeMonth('2025-10'); assert.deepEqual(f.totals(), ['—', '—']); await f.flush();
    first.resolve({ success: true, records: [usageRecord('2026-10-01')] }); await f.flush(); assert.deepEqual(f.totals(), ['—', '—']);
    second.resolve({ success: true, records: [usageRecord('2025-10-01', 20, 5), usageRecord('2025-09-01', 10, 2)] }); await f.flush();
    assert.deepEqual(f.totals(), ['20', '5']); f.node('DataGrid').props.onPaginationModelChange({ page: 3, pageSize: 50 }); f.render();
    f.changeMonth('2025-09'); await f.flush(); assert.deepEqual(f.totals(), ['10', '2']); assert.deepEqual(f.calls, [2026, 2025]);
    assert.equal(f.node('DataGrid').props.paginationModel.page, 0); assert.equal(f.node('DataGrid').props.paginationModel.pageSize, 50);
    assert.equal(f.node('Export').props.disabled, false);
  } finally { f.h.unmount(); }
});
test('Usage update reloads accept only the latest request and closing removes subscriptions and ignores pending results', async () => {
  const latest = []; const f = usageFixture(() => { const p = pendingUsage(); latest.push(p); return p.promise; });
  try {
    await f.flush(); latest[0].resolve({ success: true, records: [usageRecord('2026-10-01')] }); await f.flush();
    f.listeners.get('ai-usage-history-updated')(null, 2026); f.render(); assert.deepEqual(f.totals(), ['—', '—']);
    f.listeners.get('ai-usage-history-updated')(null, 2026); latest[2].resolve({ success: true, records: [usageRecord('2026-10-01', 99, 8)] }); await f.flush();
    latest[1].reject(new Error('old failure')); await f.flush(); assert.deepEqual(f.totals(), ['99', '8']);
    f.listeners.get('ai-usage-history-updated')(null, 2026); f.props.open = false; await f.flush();
    latest[3].resolve({ success: true, records: [usageRecord('2026-10-01', 777, 8)] }); await f.flush();
    assert.deepEqual(f.totals(), ['—', '—']); assert.equal(f.listeners.size, 0);
  } finally { f.h.unmount(); }
});
