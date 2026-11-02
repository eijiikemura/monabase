// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadModule } = require('./helpers/loadModule.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { getSourceHistoryFile, saveSourceHistory, loadSourceHistory, deleteSourceHistories } = require('../electron/ai/sourceHistory');

const identity = { connectionScope: 'a'.repeat(64), dbType: 'oracle', schema: 'TEST_USER', category: 'PACKAGE BODY', objectName: 'SALES_PKG' };
const message = (text = '修正してください') => ({ id: '1', sender: 'user', text, timestamp: '12:30' });
const object = (name = 'SALES') => ({ dbType: 'oracle', schema: 'TEST_USER', category: 'TABLE',
  name, displayName: name, key: JSON.stringify(['oracle', 'TEST_USER', 'TABLE', name]) });
const tick = () => new Promise(resolve => setImmediate(resolve));

function moduleExports(file, dependencies = {}, globals = {}) {
  const runtime = { crypto, window: {}, ...globals };
  return loadTypeScript(file, {
    '@/shared/api/desktop': { ipcRenderer: runtime.window?.require?.('electron')?.ipcRenderer || { invoke() { throw new Error('IPC test double is missing.'); } } },
    ...dependencies
  }, runtime);
}
const conversationModule = moduleExports('src/features/ai/sourceConversation.ts');
const { createSourceConversationController, discardDeletedSourceConversations } = conversationModule;
const { createAiObjectSelectionStore } = moduleExports('src/features/ai/useAiObjectSelection.ts', {
  react: {}, './aiObjectRepository': {}, "@/shared/utils/errorUtils": { getErrorMessage: error => error.message }
});
const target = (initial = identity) => {
  let value = initial;
  const listeners = new Set();
  return {
    getHistoryIdentity: () => value,
    subscribeHistoryIdentity: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    change(next) { value = next; listeners.forEach(listener => listener()); }
  };
};

test('History filenames distinguish database, category, schema, and case and remain safe on Windows', () => {
  for (const [paths, input] of [[path, path.join(os.tmpdir(), 'source')], [path.win32, 'C:/temp/source'], [path.posix, '/tmp/source']]) {
    const directory = paths.normalize(input);
    const historyFile = paths === path ? getSourceHistoryFile : loadModule('electron/ai/sourceHistory.js', { 'node:path': paths }, {}, { strict: false }).getSourceHistoryFile;
    const variants = [identity, { ...identity, dbType: 'postgresql' }, { ...identity, category: 'PACKAGE' },
      { ...identity, schema: 'OTHER' }, { ...identity, objectName: 'sales_pkg' },
      { ...identity, dbType: 'postgresql', signature: 'integer' }, { ...identity, dbType: 'postgresql', signature: 'text' }];
    assert.equal(new Set(variants.map(value => historyFile(directory, value))).size, variants.length);
    const file = historyFile(directory, { ...identity, schema: '../../', objectName: '😀'.repeat(100) + '/:*?' });
    assert.equal(paths.dirname(file), directory);
    assert.ok(Buffer.byteLength(paths.basename(file)) < 255);
    assert.match(paths.basename(file), /^oracle_package-body_/);
    assert.doesNotMatch(paths.basename(file), /[<>:"/\\|?*]/);
    assert.throws(() => historyFile(directory, { ...identity, dbType: '../../' }), /不正/);
  }
});

test('Restores saved conversations, raw AI responses, usage, and selected objects immediately', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-source-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.equal(await loadSourceHistory(directory, identity), null);
  const conversation = {
    messages: [message(), { id: '2', sender: 'ai', text: '反映しました', timestamp: '12:31',
      aiContent: '{"status":"success","source":"BEGIN NULL; END;","message":""}',
      usage: { promptTokens: 100, completionTokens: 20 } }],
    selectedObjects: [object()]
  };
  const saving = saveSourceHistory(directory, identity, conversation);
  const restored = await loadSourceHistory(directory, identity);
  await saving;
  assert.deepEqual(restored.messages, conversation.messages);
  assert.deepEqual(restored.selectedObjects, conversation.selectedObjects);
  await Promise.all([
    saveSourceHistory(directory, identity, conversation),
    saveSourceHistory(directory, identity, { messages: [], selectedObjects: [object()] })
  ]);
  assert.deepEqual((await loadSourceHistory(directory, identity)).messages, []);
  assert.equal((await fs.readdir(directory)).filter(file => file.endsWith('.tmp')).length, 0);
});

test('Rejects corrupted history and history for other objects', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-source-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = getSourceHistoryFile(directory, identity);
  await fs.writeFile(file, '{broken');
  await assert.rejects(loadSourceHistory(directory, identity));
  await fs.writeFile(file, JSON.stringify({ version: 1, identity: { ...identity, schema: 'OTHER' }, messages: [], selectedObjects: [] }));
  await assert.rejects(loadSourceHistory(directory, identity), /一致/);
});

test('Restoration refreshes definitions without applying responses or sending AI requests', async () => {
  const loaded = [];
  const selection = createAiObjectSelectionStore('oracle', () => 'TEST_USER', async selected => {
    loaded.push(selected.name);
    return { definition: '最新の定義', details: {} };
  });
  selection.addObjects([object('DEFAULT')]);
  const saves = [];
  const controller = createSourceConversationController({
    load: async () => ({ messages: [message('過去の会話')], selectedObjects: [object('RESTORED')] }),
    save: async (key, data) => saves.push({ key, data })
  });
  const detach = controller.attach(target(), selection);
  assert.equal(controller.getSnapshot().ready, false);
  await tick();
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(controller.getSnapshot().messages[0].text, '過去の会話');
  assert.equal(selection.getSnapshot().length, 1);
  assert.equal(selection.getSnapshot()[0].object.name, 'RESTORED');
  assert.equal(selection.getSnapshot()[0].reference.definition, '最新の定義');
  assert.ok(loaded.includes('RESTORED'));
  detach();
});

test('Autosaves message and selection changes, including changes immediately before closing', async () => {
  const saves = [];
  const selection = createAiObjectSelectionStore('oracle', () => '', async () => ({ definition: 'DDL', details: {} }));
  const controller = createSourceConversationController({ load: async () => null,
    save: async (key, data) => saves.push({ key, data }) }, 0);
  const detach = controller.attach(target(), selection);
  await tick();
  controller.setMessages([message()]);
  selection.addObjects([object()]);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.ok(saves.length > 0);
  assert.equal(saves.at(-1).data.selectedObjects[0].name, 'SALES');
  controller.setMessages(previous => [...previous, message('閉じる直前')]);
  detach();
  assert.equal(saves.at(-1).data.messages.at(-1).text, '閉じる直前');
});

test('New objects save history only after compilation under their resulting names', async () => {
  const saves = [], loads = [];
  const controller = createSourceConversationController({
    load: async key => { loads.push(key); return null; },
    save: async (key, data) => saves.push({ key, data })
  });
  const editingTarget = target(null);
  const detach = controller.attach(editingTarget);
  controller.setMessages([message('新規作成の依頼')]);
  await controller.flush();
  assert.equal(saves.length, 0);
  assert.equal(controller.getSnapshot().persistent, false);
  editingTarget.change(identity);
  await tick();
  assert.equal(controller.getSnapshot().persistent, true);
  assert.equal(saves.at(-1).key.objectName, 'SALES_PKG');
  assert.equal(saves.at(-1).data.messages[0].text, '新規作成の依頼');
  assert.equal(loads.length, 0);
  detach();
});

test('Reset preserves selections and ignores late restoration results', async () => {
  let resolveLoad;
  const saves = [];
  const selection = createAiObjectSelectionStore('oracle', () => '', async () => ({ definition: 'DDL', details: {} }));
  selection.addObjects([object()]);
  const controller = createSourceConversationController({
    load: () => new Promise(resolve => { resolveLoad = resolve; }),
    save: async (key, data) => saves.push(data)
  });
  const detach = controller.attach(target(), selection);
  controller.reset();
  resolveLoad({ messages: [message('古い会話')], selectedObjects: [] });
  await tick();
  assert.equal(controller.getSnapshot().messages.length, 0);
  assert.equal(saves.at(-1).selectedObjects[0].name, 'SALES');
  assert.equal(selection.getSnapshot()[0].object.name, 'SALES');
  detach();
});

test('Late history responses never leak into another object after switching screens', async () => {
  let finishFirst;
  const controller = createSourceConversationController({
    load: key => key.objectName === identity.objectName
      ? new Promise(resolve => { finishFirst = resolve; })
      : Promise.resolve({ messages: [message('別の会話')], selectedObjects: [] }),
    save: async () => {}
  });
  controller.attach(target());
  const detach = controller.attach(target({ ...identity, objectName: 'OTHER_PKG' }));
  await tick();
  finishFirst({ messages: [message('最初の会話')], selectedObjects: [] });
  await tick();
  assert.equal(controller.getSnapshot().messages[0].text, '別の会話');
  detach();
});

test('Restore failures do not overwrite history and allow explicit reset recovery', async () => {
  const saves = [];
  const controller = createSourceConversationController({ load: async () => { throw new Error('破損'); },
    save: async (key, data) => saves.push(data) });
  const detach = controller.attach(target());
  await tick();
  assert.equal(controller.getSnapshot().ready, false);
  assert.match(controller.getSnapshot().error, /破損/);
  await controller.flush();
  assert.equal(saves.length, 0);
  controller.reset();
  assert.equal(controller.getSnapshot().ready, true);
  assert.equal(saves.length, 1);
  detach();
});

test('Disposing the selection store is not saved as removal of all objects', async () => {
  const saves = [];
  const selection = createAiObjectSelectionStore('oracle', () => '', async () => ({ definition: 'DDL', details: {} }));
  selection.addObjects([object()]);
  const controller = createSourceConversationController({ load: async () => null,
    save: async (key, data) => saves.push(data) });
  const detach = controller.attach(target(), selection);
  await tick();
  selection.dispose();
  detach();
  assert.equal(saves.at(-1).selectedObjects[0].name, 'SALES');
});

test('Editors for both databases report history identity after new objects compile', () => {
  for (const dbType of ['oracle', 'postgresql']) {
    const categories = dbType === 'oracle'
      ? ['TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY']
      : ['TRIGGER', 'PROCEDURE', 'FUNCTION'];
    for (const category of categories) {
      const slots = [], effects = [];
      let cursor = 0;
      const react = {
      useCallback: callback => callback,
        useRef(value) {
          const index = cursor++;
          slots[index] ||= { current: value };
          return slots[index];
        },
        useState(value) {
          const index = cursor++;
          if (!(index in slots)) slots[index] = value;
          return [slots[index], next => { slots[index] = next; }];
        },
        useMemo(callback, deps) {
          const index = cursor++;
          if (!slots[index]) slots[index] = { value: callback(), deps };
          return slots[index].value;
        },
        useEffect(callback, deps) {
          const index = cursor++;
          const previous = slots[index];
          if (!previous || deps.some((value, position) => !Object.is(value, previous[position]))) {
            slots[index] = deps;
            effects.push(callback);
          }
        }
      };
      const { useAiCodingGeneration } = moduleExports('src/features/ai/useAiCodingGeneration.ts', {
        react, 'react-i18next': { useTranslation: () => ({ t: text => text }) },
        '../stored/storedCreation': {}, '../stored/packageCreation': {},
        './codingResponse': {}, './triggerBodyResponse': {}
      }, { window: { addEventListener() {}, removeEventListener() {} } });
      const render = isNew => {
        cursor = 0;
        const result = useAiCodingGeneration({ dbType, schema: 'APP', objectName: isNew ? '' : 'PROGRAM',
          objectType: category, sourceText: '', setSourceText() {}, isActive: true, isNew, onStart() {} });
        effects.splice(0).forEach(effect => effect());
        return result.responseTarget;
      };
      const sourceTarget = render(true);
      assert.equal(sourceTarget.getHistoryIdentity(), null);
      let changes = 0;
      sourceTarget.subscribeHistoryIdentity(() => changes++);
      assert.equal(render(false), sourceTarget);
      assert.equal(changes, 1);
      assert.equal(sourceTarget.getHistoryIdentity().category, category);
      assert.equal(sourceTarget.getHistoryIdentity().dbType, dbType);
      assert.equal(sourceTarget.getHistoryIdentity().objectName, 'PROGRAM');
      render(false);
      assert.equal(changes, 1);
    }
  }
});

test('Source and debug IPC use separate history folders and independent resets', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-folders-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const handlers = {};
  const { registerAiHandlers } = loadModule('electron/ipc/ai.js', {}, {}, { strict: false });
  registerAiHandlers({
    state: { aiHistoryScopes: new Map([[identity.connectionScope, identity.dbType]]) }, t: key => key,
    ipcMain: { handle: (name, callback) => { handlers[name] = callback; } },
    AI_SOURCE_DIR: path.join(directory, 'source'), AI_DEBUG_DIR: path.join(directory, 'debug')
  });
  assert.equal((await handlers['save-ai-source-history'](null, identity,
    { messages: [message('編集の会話')], selectedObjects: [] })).success, true);
  assert.equal((await handlers['save-ai-debug-history'](null, { ...identity, historyScope: 'debug' },
    { messages: [message('解析の会話')], selectedObjects: [object()] })).success, true);
  const source = await handlers['load-ai-source-history'](null, identity);
  const debug = await handlers['load-ai-debug-history'](null, identity);
  assert.equal(source.conversation.messages[0].text, '編集の会話');
  assert.equal(debug.conversation.messages[0].text, '解析の会話');
  assert.equal(debug.conversation.selectedObjects[0].name, 'SALES');
  await handlers['save-ai-debug-history'](null, identity, { messages: [], selectedObjects: [object()] });
  assert.equal((await handlers['load-ai-debug-history'](null, identity)).conversation.messages.length, 0);
  assert.equal((await handlers['load-ai-source-history'](null, identity)).conversation.messages[0].text, '編集の会話');
});

test('Trace AI requests use debug history identities and selection stores for both databases', async () => {
  for (const dbType of ['oracle', 'postgresql']) {
    for (const objectType of ['PROCEDURE', 'FUNCTION', 'TRIGGER', ...(dbType === 'oracle' ? ['PACKAGE BODY'] : [])]) {
      const opened = [], calls = [];
      const selection = createAiObjectSelectionStore(dbType, () => 'APP', async () => ({ definition: 'DDL', details: {} }));
      const { useAiTraceDebug } = moduleExports('src/features/ai/useAiTraceDebug.ts', {
        react: { useRef: current => ({ current }), useState: value => [value, () => {}],
          useCallback: callback => callback, useEffect: callback => callback() },
        'react-i18next': { useTranslation: () => ({ t: text => text, i18n: { language: 'ja' } }) },
        './useAiObjectSelection': { useAiObjectSelection: () => selection }
      }, { window: { require: () => ({ ipcRenderer: { invoke: async (channel, value) => {
        assert.equal(channel, 'get-trace-for-ai');
        calls.push(value);
        return { success: true, content: JSON.stringify({ traceInfo: {}, traceSteps: [{}] }) };
      } } }) } });
      const traceObjectName = dbType === 'oracle' && objectType === 'TRIGGER' ? 'TRG_TRACE_TRG_TRIGGER' : 'PROGRAM';
      const hook = useAiTraceDebug({ dbType, schema: 'APP', objectName: 'PROGRAM', objectType,
        traceObjectName, sourceText: 'BEGIN NULL; END;', isAiEnabled: true,
        onOpenAiSidebar: context => opened.push(context) });
      await hook.requestDebug();
      assert.equal(opened.length, 1);
      assert.equal(calls[0].objectName, 'PROGRAM');
      assert.equal(calls[0].schema, 'APP');
      assert.equal(calls[0].objectType, objectType === 'PACKAGE BODY' ? 'PACKAGE' : objectType);
      const savedIdentity = opened[0].historyTarget.getHistoryIdentity();
      assert.equal(savedIdentity.historyScope, 'debug');
      assert.equal(savedIdentity.dbType, dbType);
      assert.equal(savedIdentity.category, objectType);
      assert.equal(savedIdentity.objectName, 'PROGRAM');
      assert.equal(opened[0].objectSelection, selection);
      assert.equal(opened[0].codingResponse, undefined);
      if (objectType === 'TRIGGER') assert.equal(opened[0].requestType, "debug_trigger");
    }
  }
});

test('Deletion removes only matching source and debug history and preserves other objects', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = [path.join(root, 'source'), path.join(root, 'debug')];
  const deleted = { ...identity, category: 'PROCEDURE' };
  const preserved = [{ ...deleted, dbType: 'postgresql' }, { ...deleted, schema: 'OTHER' }, { ...deleted, objectName: 'OTHER' }];
  for (const directory of directories) {
    for (const key of [deleted, ...preserved]) await saveSourceHistory(directory, key, { messages: [message()], selectedObjects: [] });
  }
  await deleteSourceHistories(directories, deleted);
  await deleteSourceHistories(directories, deleted);
  for (const directory of directories) {
    assert.equal(await loadSourceHistory(directory, deleted), null);
    for (const key of preserved) assert.equal((await loadSourceHistory(directory, key)).messages.length, 1);
  }
});

test('Deleting a package body preserves its specification while full deletion removes both', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-package-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = [path.join(root, 'source'), path.join(root, 'debug')];
  const header = { ...identity, category: 'PACKAGE' };
  for (const directory of directories) {
    await saveSourceHistory(directory, identity, { messages: [message()], selectedObjects: [] });
    await saveSourceHistory(directory, header, { messages: [message()], selectedObjects: [] });
  }
  await deleteSourceHistories(directories, identity);
  for (const directory of directories) {
    assert.equal(await loadSourceHistory(directory, identity), null);
    assert.equal((await loadSourceHistory(directory, header)).messages.length, 1);
    await saveSourceHistory(directory, identity, { messages: [message()], selectedObjects: [] });
  }
  await deleteSourceHistories(directories, header);
  for (const directory of directories) {
    assert.equal(await loadSourceHistory(directory, identity), null);
    assert.equal(await loadSourceHistory(directory, header), null);
  }
});

test('Deletion during saving removes files and blocks late AI responses from recreating them', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-save-delete-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directories = [path.join(root, 'source'), path.join(root, 'debug')];
  const saves = [];
  const detach = [];
  for (const [index, directory] of directories.entries()) {
    const controller = createSourceConversationController({ load: async () => null,
      save: async (key, data) => { saves.push(key); await saveSourceHistory(directory, key, data); } });
    detach.push(controller.attach(target({ ...identity, ...(index ? { historyScope: 'debug' } : {}) })));
    await tick();
    controller.setMessages([message()]);
    // Finish pending writes before the deletion queue entry.
    void controller.flush();
    detach.push(() => {
      controller.setMessages([message('削除後に届いた回答')]);
      return controller.flush();
    });
  }
  discardDeletedSourceConversations({ ...identity, category: 'PACKAGE' });
  await deleteSourceHistories(directories, { ...identity, category: 'PACKAGE' });
  const savesBeforeClosing = saves.length;
  for (const stop of detach.reverse()) await stop();
  assert.equal(saves.length, savesBeforeClosing);
  for (const directory of directories) assert.equal(await loadSourceHistory(directory, identity), null);
});

test('Closing tabs preserves history and deletion notifications affect matching categories only', async () => {
  const calls = [], saves = [];
  const controller = createSourceConversationController({ load: async () => null,
    save: async (key, data) => saves.push(data) });
  const detach = controller.attach(target());
  await tick();
  controller.setMessages([message()]);
  const { deleteAiHistoryForObject } = moduleExports('src/features/ai/aiHistoryCleanup.ts', {
    './sourceConversation': conversationModule
  }, { window: { require: () => ({ ipcRenderer: { invoke: async (channel, value) => {
    calls.push({ channel, value }); return { success: true };
  } } }) } });
  await deleteAiHistoryForObject('oracle', identity.schema, identity.objectName, 'TABLE');
  await deleteAiHistoryForObject('oracle', identity.schema, identity.objectName, 'PACKAGE BODY', 'rename');
  assert.equal(calls.length, 0);
  assert.equal(controller.getSnapshot().persistent, true);
  detach();
  assert.equal(saves.at(-1).messages.length, 1);
  await deleteAiHistoryForObject('postgresql', 'APP', 'PROGRAM', 'FUNCTION', undefined, undefined, undefined, identity.connectionScope);
  assert.equal(calls[0].channel, 'delete-ai-object-history');
  assert.equal(calls[0].value.dbType, 'postgresql');
});

test('Deleting one PostgreSQL overload preserves the other overload conversation and file', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monabase-ai-overload-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = { connectionScope: 'a'.repeat(64), dbType: 'postgresql', schema: 'public', category: 'FUNCTION', objectName: 'total', signature: 'integer' };
  const second = { ...first, signature: 'text' };
  const controller = createSourceConversationController({ load: key => loadSourceHistory(directory, key), save: (key, data) => saveSourceHistory(directory, key, data) });
  await saveSourceHistory(directory, first, { messages: [message('integer')], selectedObjects: [] });
  await saveSourceHistory(directory, second, { messages: [message('text')], selectedObjects: [] });
  const stop = controller.attach(target(second));
  await tick();
  // Hydration performs a real filesystem read.
  for (let attempt = 0; attempt < 100 && controller.getSnapshot().messages.length === 0; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  discardDeletedSourceConversations(first);
  await deleteSourceHistories([directory], first);
  assert.equal(controller.getSnapshot().persistent, true);
  assert.equal(controller.getSnapshot().messages[0].text, 'text');
  assert.equal(await loadSourceHistory(directory, first), null);
  assert.equal((await loadSourceHistory(directory, second)).messages[0].text, 'text');
  stop();
  // Detaching schedules the final save; loading waits for the persistence queue.
  await loadSourceHistory(directory, second);
});

test('Adopted AI summaries survive real history storage and invalid adoption data leaves the file unchanged', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mona-ai-adopt-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const adoption = { summary: 'Validate the order total', source: 'BEGIN NULL; END;', appliedAt: '2026-10-24T12:00:00.000Z' };
  const conversation = { messages: [{ ...message('Applied'), sender: 'ai', adoption }], selectedObjects: [] };
  await saveSourceHistory(directory, identity, conversation);
  assert.deepEqual((await loadSourceHistory(directory, identity)).messages[0].adoption, adoption);
  for (const bad of [{ ...adoption, summary: '' }, { ...adoption, source: {} }, { ...adoption, appliedAt: 'invalid' }]) {
    assert.throws(() => saveSourceHistory(directory, identity, { ...conversation,
      messages: [{ ...conversation.messages[0], adoption: bad }] }), /Invalid adopted AI change/);
  }
  assert.deepEqual((await loadSourceHistory(directory, identity)).messages[0].adoption, adoption);
});

test('AI conversation saves and legacy reads restrict access without changing content', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'monabase-ai-private-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'conversations'), file = getSourceHistoryFile(directory, identity);
  await saveSourceHistory(directory, identity, { messages: [message('private demo source')], selectedObjects: [] });
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await fs.chmod(directory, 0o755); await fs.chmod(file, 0o644);
  }
  const before = await fs.readFile(file, 'utf8');
  assert.equal((await loadSourceHistory(directory, identity)).messages[0].text, 'private demo source');
  assert.equal(await fs.readFile(file, 'utf8'), before);
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
});

test('AI history connection scopes distinguish destinations without depending on secrets or display labels', () => {
  const { createAiHistoryScope } = require('../electron/ai/sourceHistory');
  const base = { dbType: 'postgresql', host: 'db.example.invalid', port: '5432', database: 'app', user: 'app' };
  const scope = createAiHistoryScope(base);
  assert.match(scope, /^[a-f0-9]{64}$/);
  for (const change of [{ name: 'Renamed', environmentLabel: 'production', readonly: true },
    { password: 'fictional-new-secret', sshPassword: 'fictional-passphrase', sshKeyFile: '/fictional/key' },
    { dbType: 'postgres', port: 5432 }, { sshHost: 'unused.invalid', sshUser: 'unused' }]) {
    assert.equal(createAiHistoryScope({ ...base, ...change }), scope);
  }
  for (const change of [{ host: 'other.invalid' }, { port: '5433' }, { database: 'other' }, { user: 'other' },
    { dbType: 'oracle' }, { useSysdba: true }, { useOsAuth: true }, { useSshTunnel: true }]) {
    assert.notEqual(createAiHistoryScope({ ...base, ...change }), scope);
  }
  const tunnel = { ...base, useSshTunnel: true, sshHost: 'jump.invalid', sshPort: '2222', sshUser: 'jump' };
  for (const change of [{ sshHost: 'other.invalid' }, { sshPort: '2223' }, { sshUser: 'other' }]) {
    assert.notEqual(createAiHistoryScope({ ...tunnel, ...change }), createAiHistoryScope(tunnel));
  }
  assert.equal(createAiHistoryScope({ dbType: 'oracle' }), createAiHistoryScope({ dbType: 'oracle', host: '127.0.0.1', port: '1521' }));
});

for (const dbType of ['oracle', 'postgresql']) {
  test(`${dbType}: same-named source and debug histories are isolated across connection scopes and retain legacy bytes`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-ai-connection-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const { createAiHistoryScope } = require('../electron/ai/sourceHistory');
    const first = { ...identity, dbType, category: dbType === 'oracle' ? 'PACKAGE' : 'FUNCTION',
      connectionScope: createAiHistoryScope({ dbType, host: 'production.invalid', database: 'production', user: 'app' }) };
    const second = { ...first, connectionScope: createAiHistoryScope({ dbType, host: 'development.invalid', database: 'development', user: 'app' }) };
    const directories = ['source', 'debug'].map(name => path.join(root, name));
    for (const directory of directories) {
      await fs.mkdir(directory);
      const legacyIdentity = { dbType, category: first.category, schema: first.schema, objectName: first.objectName };
      const legacyHash = crypto.createHash('sha256').update(JSON.stringify(legacyIdentity)).digest('hex');
      const legacy = getSourceHistoryFile(directory, first).replace(/[a-f0-9]{64}\.json$/, legacyHash + '.json');
      const legacyBytes = JSON.stringify({ version: 1, identity: legacyIdentity, messages: [message('legacy')], selectedObjects: [] });
      await fs.writeFile(legacy, legacyBytes);
      assert.equal(await loadSourceHistory(directory, first), null);
      assert.equal(await loadSourceHistory(directory, second), null);
      await saveSourceHistory(directory, first, { messages: [message('production only')], selectedObjects: [] });
      assert.equal(await loadSourceHistory(directory, second), null);
      await saveSourceHistory(directory, second, { messages: [message('development only')], selectedObjects: [] });
      assert.equal((await loadSourceHistory(directory, first)).messages[0].text, 'production only');
      assert.equal((await loadSourceHistory(directory, second)).messages[0].text, 'development only');
      if (dbType === 'oracle') {
        for (const key of [first, second]) await saveSourceHistory(directory, { ...key, category: 'PACKAGE BODY' }, { messages: [message(key.connectionScope)], selectedObjects: [] });
      }
      await deleteSourceHistories([directory], second);
      assert.equal(await loadSourceHistory(directory, second), null);
      assert.equal((await loadSourceHistory(directory, first)).messages[0].text, 'production only');
      if (dbType === 'oracle') {
        assert.equal(await loadSourceHistory(directory, { ...second, category: 'PACKAGE BODY' }), null);
        assert.ok(await loadSourceHistory(directory, { ...first, category: 'PACKAGE BODY' }));
      }
      assert.equal(await fs.readFile(legacy, 'utf8'), legacyBytes);
    }
  });
}

test('AI history IPC rejects missing, forged and wrong-database scopes before file access', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mb-ai-scope-ipc-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const handlers = new Map();
  loadModule('electron/ipc/ai.js', {}, {}, { strict: false }).registerAiHandlers({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    state: { aiHistoryScopes: new Map([[identity.connectionScope, identity.dbType]]) },
    AI_SOURCE_DIR: path.join(root, 'source'), AI_DEBUG_DIR: path.join(root, 'debug'), t: key => key
  });
  for (const invalid of [{ ...identity, connectionScope: undefined }, { ...identity, connectionScope: 'b'.repeat(64) },
    { ...identity, connectionScope: '../outside' }, { ...identity, dbType: 'postgresql' }]) {
    for (const channel of ['load-ai-source-history', 'load-ai-debug-history', 'save-ai-source-history', 'save-ai-debug-history', 'delete-ai-object-history']) {
      const result = await handlers.get(channel)(null, invalid, { messages: [message()], selectedObjects: [] });
      assert.equal(result.success, false, channel);
      assert.equal(result.error, 'ai_history_connection_required');
    }
  }
  assert.deepEqual(await fs.readdir(root), []);
  assert.throws(() => getSourceHistoryFile(root, { ...identity, connectionScope: undefined }));
});

test('Workspace scoping keeps delayed saves, restored messages and deletion notifications in their original connection', async () => {
  const scopeA = 'a'.repeat(64), scopeB = 'b'.repeat(64);
  const saved = [], loads = [];
  let finishA;
  const controller = createSourceConversationController({
    load: async key => {
      loads.push(key);
      if (key.connectionScope === scopeA) return new Promise(resolve => { finishA = resolve; });
      return { messages: [message('development only')], selectedObjects: [] };
    },
    save: async (key, conversation) => saved.push({ key, conversation })
  });
  controller.attach(target(identity), undefined, scopeA);
  controller.attach(target(identity), undefined, scopeB);
  await tick();
  finishA({ messages: [message('production only')], selectedObjects: [] });
  await tick();
  assert.equal(controller.getSnapshot().messages[0].text, 'development only');
  discardDeletedSourceConversations({ ...identity, connectionScope: scopeA });
  assert.equal(controller.getSnapshot().persistent, true);
  controller.setMessages([message('development edit')]);
  await controller.flush();
  assert.equal(saved.at(-1).key.connectionScope, scopeB);
  assert.equal(saved.at(-1).conversation.messages[0].text, 'development edit');
  assert.deepEqual(loads.map(key => key.connectionScope), [scopeA, scopeB]);
  // A detach captures the original scope before another workspace is attached.
  const detach = controller.attach(target(identity), undefined, scopeB);
  await tick();
  controller.setMessages([message('final development edit')]);
  detach();
  controller.attach(target(identity), undefined, scopeA);
  assert.equal(saved.at(-1).key.connectionScope, scopeB);
  assert.equal(saved.at(-1).conversation.messages[0].text, 'final development edit');
});
