// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSettingsStore } = require('../electron/services/settings');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createAiRequestBudget } = require('../electron/ai/requestLimits');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-settings-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createSettingsStore({ app: { isReady: () => true, getLocale: () => 'en' }, SETTINGS_FILE: path.join(directory, 'settings.json'), t: key => key, setLanguage() {} });
  store.load();
  return { directory, store, save: patch => store.save({ ...store.load(), ...patch }) };
}
function timers() {
  let now = 0, next = 0; const pending = new Map();
  return { setTimeout: (fn, delay) => { pending.set(++next, { fn, at: now + delay }); return next; }, clearTimeout: id => pending.delete(id),
    advance: ms => { now += ms; for (const [id, task] of [...pending]) if (task.at <= now && pending.delete(id)) task.fn(); },
    get size() { return pending.size; } };
}

test('Persisted SQL history switches and limits drive the actual history handlers immediately', t => {
  const f = fixture(t), handlers = new Map(), file = path.join(f.directory, 'history.json');
  require('../electron/ipc/files').registerFileHandlers({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, HISTORY_FILE: file, getValidatedSettings: () => f.store.load(), t: key => key });
  const invoke = (key, ...args) => handlers.get(key)(null, ...args), add = sql => invoke('add-sql-history', { sql, executeTime: 'test', duration: 1, rowCount: 0 });
  f.save({ sqlHistoryLimit: 2 }); add('SELECT 1'); add('SELECT 2'); add('SELECT 3');
  assert.deepEqual(invoke('get-sql-history').map(row => row.sql), ['SELECT 3', 'SELECT 2']);
  f.save({ sqlHistoryEnabled: false }); const before = fs.readFileSync(file); add('SELECT 4'); assert.ok(fs.readFileSync(file).equals(before));
  f.save({ sqlHistoryEnabled: true, sqlHistoryLimit: 1 }); add('SELECT 5');
  assert.deepEqual(invoke('get-sql-history').map(row => row.sql), ['SELECT 5']);
  add("ALTER USER test PASSWORD 'not-a-real-secret'"); assert.deepEqual(invoke('get-sql-history').map(row => row.sql), ['SELECT 5']);
});

test('Persisted independent SQL and ER limits govern real file reads without accepting partial content', async t => {
  const f = fixture(t), handlers = new Map();
  const sqlFile = path.join(f.directory, 'query.sql'); fs.writeFileSync(sqlFile, 'x'.repeat(1024 * 1024 + 1));
  require('../electron/ipc/files').registerFileHandlers({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, HISTORY_FILE: path.join(f.directory, 'history.json'),
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [sqlFile] }) }, getWindow: () => null, getValidatedSettings: () => f.store.load(), t: key => key });
  const repo = path.join(f.directory, 'repo'), erDir = path.join(repo, 'MonaBase', 'POSTGRESQL', 'ErDiagram'); fs.mkdirSync(erDir, { recursive: true });
  const erFile = path.join(erDir, 'diagram.json'); fs.writeFileSync(erFile, ' '.repeat(1024 * 1024 + 1));
  require('../electron/ipc/er').registerErHandlers({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, gitDirectory: repo, getValidatedSettings: () => f.store.load(), t: key => key });
  const sql = () => handlers.get('open-sql-file')(null), er = () => handlers.get('load-er-diagram')(null, { dbType: 'POSTGRESQL', objectName: 'diagram.json' });
  f.save({ sqlFileMaxMb: 1, erFileMaxMb: 2 });
  assert.equal((await sql()).error, 'file_read_too_large'); assert.equal((await er()).data.length, 1024 * 1024 + 1);
  f.save({ sqlFileMaxMb: 2, erFileMaxMb: 1 });
  assert.equal((await sql()).sql.length, 1024 * 1024 + 1); const rejected = await er(); assert.equal(rejected.error, 'file_read_too_large'); assert.equal(rejected.data, undefined);
  fs.truncateSync(sqlFile, 1024 * 1024); f.save({ sqlFileMaxMb: 1 }); assert.equal((await sql()).success, true);
});

test('Persisted AI capacity changes affect new budgets without changing an active request', t => {
  const f = fixture(t), clock = timers(); f.save({ aiResponseMaxMb: 1 });
  const oldController = new AbortController(), old = createAiRequestBudget(oldController, f.store.load(), clock); t.after(() => old.dispose());
  f.save({ aiResponseMaxMb: 2 });
  assert.throws(() => old.receive(1024 * 1024 + 1), /ai_response_size_exceeded/);
  const nextController = new AbortController(), next = createAiRequestBudget(nextController, f.store.load(), clock); t.after(() => next.dispose());
  next.receive(1024 * 1024 + 1); assert.equal(nextController.signal.aborted, false);
});

test('Persisted idle and total AI budgets enforce their own deadlines and clean up timers', t => {
  const f = fixture(t); f.save({ aiIdleTimeoutSeconds: 2, aiRequestTimeoutSeconds: 5 });
  const clock = timers(), idleController = new AbortController(), idle = createAiRequestBudget(idleController, f.store.load(), clock);
  clock.advance(1999); assert.equal(idleController.signal.aborted, false); clock.advance(1);
  assert.equal(idleController.signal.reason.message, 'ai_idle_timeout_exceeded'); idle.dispose(); assert.equal(clock.size, 0);
  const totalController = new AbortController(), total = createAiRequestBudget(totalController, f.store.load(), clock);
  for (let i = 0; i < 4; i++) { clock.advance(1000); total.receive(1); }
  clock.advance(1000); assert.equal(totalController.signal.reason.message, 'ai_request_timeout_exceeded'); total.dispose(); assert.equal(clock.size, 0);
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: persisted number-format choices reach the real cross-tab formatter`, async t => {
    const f = fixture(t);
    for (const [numberFormat, expected] of [['none', '1234567'], ['comma', '1,234,567'], ['period', '1.234.567'], ['space', '1 234 567']]) {
      f.save({ numberFormat }); const hook = createHookHarness();
      const { useCrossTabWindow } = loadTypeScript(`src/features/${db}/windows/bi/useCrossTabWindow.ts`, {
        react: hook.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) }, 'html-to-image': {}, '../common/schemaStorage': { getPgSelectSchema: () => null, savePgSelectSchema() {} },
        '@/shared/api/desktop': { ipcRenderer: { invoke: async key => key === 'load-settings' ? f.store.load() : { success: true, objects: [] } } }
      }, { window: { addEventListener() {}, removeEventListener() {} } });
      let state; const render = () => { state = hook.render(() => useCrossTabWindow({ initialSchema: 'test', isActive: true, schemas: ['test'] })); hook.commit(); };
      render(); await hook.settle(); render(); assert.equal(state.formatNumberValue(1234567), expected); hook.unmount();
    }
  });
  test(`${db}: changing saved maxTabs enforces the limit without closing existing tabs`, t => {
    const f = fixture(t), hook = createHookHarness();
    const react = { ...hook.react, useEffect() {}, useLayoutEffect() {} };
    const name = db === 'oracle' ? 'Oracle' : 'Postgresql';
    const events = loadTypeScript('src/shared/hooks/useEventCallback.ts', { react });
    const tabs = loadTypeScript('src/shared/hooks/useWorkspaceTabs.ts', { react, './useEventCallback': events });
    const module = loadTypeScript(`src/features/${db}/useApp${name}.ts`, {
      react, '@/shared/hooks/useEventCallback': events, '@/shared/hooks/useWorkspaceTabs': tabs,
      './triggerIdentity': loadTypeScript('src/features/postgresql/triggerIdentity.ts'), './routineIdentity': loadTypeScript('src/features/postgresql/routineIdentity.ts'),
      'react-i18next': { useTranslation: () => ({ t: key => key }) },
      '@/features/table/useTableOpening': { useTableOpening: () => open => open() },
      '../ai/aiHistoryCleanup': {}, '../git/useGlobalGit': { useGlobalGit: () => ({}) }, '../ai/useAiSettings': { useAiSettings: () => ({}) },
      '@/shared/api/desktop': { ipcRenderer: { invoke: async () => ({}) } }
    }, { window: {}, alert() {} });
    const render = () => hook.render(() => module[`useApp${name}`]({ user: 'test' }, f.store.load(), []));
    f.save({ maxTabs: 2 }); render().handleAddTab('sql'); assert.equal(render().tabs.length, 2);
    render().handleAddTab('sql'); assert.equal(render().tabs.length, 2);
    f.save({ maxTabs: 1 }); assert.equal(render().tabs.length, 2); render().handleAddTab('sql'); assert.equal(render().tabs.length, 2);
    f.save({ maxTabs: 3 }); render().handleAddTab('sql'); assert.equal(render().tabs.length, 3);
  });
}
