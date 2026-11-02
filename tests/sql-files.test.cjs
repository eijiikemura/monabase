// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
function fixture(invoke) {
  const h = createHookHarness(), calls = [], alerts = []; let state, sql = '', confirm = true;
  const t = key => key;
  const { useSqlFile } = loadTypeScript('src/features/sql/useSqlFile.ts', { react: h.react,
    'react-i18next': { useTranslation: () => ({ t }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: (...args) => { calls.push(args); return invoke(...args); } } }
  }, { alert: value => alerts.push(value), window: { confirm: () => confirm } });
  const render = () => (state = h.render(() => useSqlFile({ sql, setSql: value => { sql = value; } })));
  const flush = async () => { for (let i = 0; i < 2; i++) { render(); h.commit(); await h.settle(); } render(); };
  return { h, calls, alerts, get state() { return state; }, get sql() { return sql; }, edit: value => { sql = value; }, flush,
    rejectConfirm: () => { confirm = false; } };
}
test('SQL files perform no automatic reads or writes on mount, edits or closing', async () => {
  const h = fixture(() => { throw new Error('Unexpected automatic file operation'); });
  await h.flush(); h.edit('SELECT 1'); await h.flush(); h.h.unmount(); assert.equal(h.calls.length, 0);
});
test('SQL save-as always selects a destination and preserves edits and input on failure', async () => {
  let release, fail = true;
  const h = fixture(async channel => {
    if (channel === 'show-save-dialog') return { canceled: false, filePath: '/mock/query.sql' };
    if (channel === 'save-file' && fail) return { success: false, error: 'disk full' };
    if (channel === 'save-file') return new Promise(resolve => { release = resolve; });
    if (channel === 'open-sql-file') return { success: true, canceled: true };
    throw new Error('Unexpected channel');
  });
  await h.flush(); h.edit('SELECT 1'); await h.flush(); await h.state.saveAs(); await h.flush();
  assert.equal(h.sql, 'SELECT 1'); assert.equal(h.alerts.length, 1);
  fail = false; const pending = h.state.saveAs(); await h.flush(); await h.state.saveAs();
  h.edit('SELECT 2'); await h.flush(); release({ success: true }); await pending; await h.flush();
  assert.equal(h.calls.filter(([c]) => c === 'save-file').length, 2);
  assert.equal(h.calls.filter(([c]) => c === 'save-file').at(-1)[2], 'SELECT 1'); assert.equal(h.sql, 'SELECT 2');
  h.rejectConfirm(); await h.state.openFile(); assert.equal(h.calls.filter(([c]) => c === 'open-sql-file').length, 0);
  const again = h.state.saveAs(); await h.flush(); release({ success: true }); await again;
  assert.equal(h.calls.filter(([c]) => c === 'show-save-dialog').length, 3); h.h.unmount();
});
test('SQL file dialog cancellation, late opening and unmount keep the current text', async () => {
  let release;
  const h = fixture(async channel => channel === 'show-save-dialog' ? { canceled: true } : new Promise(resolve => { release = resolve; }));
  await h.flush(); h.edit('SELECT 1'); await h.flush(); await h.state.saveAs();
  assert.equal(h.calls.filter(([c]) => c === 'save-file').length, 0);
  const cancelled = h.state.openFile(); await h.flush(); release({ success: true, canceled: true }); await cancelled;
  assert.equal(h.sql, 'SELECT 1');
  const pending = h.state.openFile(); await h.flush(); h.edit('SELECT 2'); await h.flush();
  release({ success: true, canceled: false, filePath: '/mock/query.sql', sql: 'SELECT stale' }); await pending;
  assert.equal(h.sql, 'SELECT 2');
  const unmounted = h.state.openFile(); await h.flush(); h.h.unmount(); release({ success: false, error: 'Late failure' }); await unmounted;
  assert.equal(h.alerts.length, 0);
});
test('SQL file opening reads only the native selection, strips a UTF-8 BOM and handles cancellation', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-sql-open-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'query.sql'); fs.writeFileSync(file, '\uFEFFSELECT \'日本語\';');
  const handlers = new Map(); let selection = { canceled: false, filePaths: [file] };
  require('../electron/ipc/files').registerFileHandlers({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    getWindow: () => null, dialog: { showOpenDialog: async () => selection }, HISTORY_FILE: path.join(root, 'history.json') });
  const open = () => handlers.get('open-sql-file')(null, '/untrusted/renderer/path');
  const result = await open(); assert.equal(result.success, true); assert.equal(result.sql, "SELECT '日本語';"); assert.equal(result.filePath, file);
  selection = { canceled: true, filePaths: [] }; assert.equal((await open()).canceled, true);
  selection = { canceled: false, filePaths: [path.join(root, 'missing.sql')] }; assert.equal((await open()).success, false);
  assert.equal(fs.readFileSync(file, 'utf8'), "\uFEFFSELECT '日本語';");
});
