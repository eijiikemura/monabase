// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { createTraceIdentity, resolveTraceFile } = require('../electron/services/traceFiles');
const { getSourceHistoryFile, saveSourceHistory, loadSourceHistory, deleteSourceHistories } = require('../electron/ai/sourceHistory');
const identities = loadTypeScript('src/features/postgresql/triggerIdentity.ts');
const { rewriteTriggerTraceReferences } = loadTypeScript('src/features/stored/triggerTraceTokens.ts');
const first = { schema: 'Mixed.Schema', objectName: 'Audit".名', tableName: 'Table".First' };
const second = { ...first, tableName: 'Table.Second' };
const plain = value => JSON.parse(JSON.stringify(value));
test('Trigger tab identities retain exact table names and the workspace keeps same-named triggers separate', () => {
  assert.deepEqual(plain(identities.parseTriggerTab(identities.triggerTabKey(first))), first);
  assert.throws(() => identities.parseTriggerTab('@pg-trigger:{"schema":"test"}'), /Invalid/);
  const h = createHookHarness(), react = { ...h.react, useEffect() {}, useLayoutEffect() {} };
  const events = loadTypeScript('src/shared/hooks/useEventCallback.ts', { react });
  const { useAppPostgresql } = loadTypeScript('src/features/postgresql/useAppPostgresql.ts', {
    react, 'react-i18next': { useTranslation: () => ({ t: key => key }) }, './triggerIdentity': identities,
    './routineIdentity': loadTypeScript('src/features/postgresql/routineIdentity.ts'),
    '@/shared/hooks/useEventCallback': events,
    '@/features/table/useTableOpening': { useTableOpening: () => open => open() },
   '@/shared/hooks/useWorkspaceTabs': loadTypeScript('src/shared/hooks/useWorkspaceTabs.ts', { react, './useEventCallback': events }),
    '../ai/aiHistoryCleanup': { deleteAiHistoryForObject() {} }, '../git/useGlobalGit': { useGlobalGit: () => ({}) },
    '../ai/useAiSettings': { useAiSettings: () => ({}) }, '@/shared/api/desktop': { ipcRenderer: { invoke: async () => ({}) } }
  }, { window: {}, alert() {} });
  const render = () => h.render(() => useAppPostgresql({ user: 'test' }, { maxTabs: 20 }, []));
  for (const identity of [first, second, first]) render().handleAddTab('trigger', identities.triggerTabKey(identity));
  const tabs = render().tabs.filter(tab => tab.type === 'trigger');
  assert.equal(tabs.length, 2); assert.deepEqual(plain(tabs[0].triggerIdentity), first); assert.deepEqual(plain(tabs[1].triggerIdentity), second);
  assert.ok(tabs[0].title.includes(first.tableName));
});
test('Real Git histories, old content, renames and deletion are isolated by trigger table and retain unscoped history', async t => {
  const repo = await createGitRepository(t);
  const base = { dbType: 'POSTGRESQL', schema: 'test', objectType: 'TRIGGER', objectName: 'Audit' };
  const a = { ...base, tableName: 'First' }, b = { ...base, tableName: 'Second' };
  for (const [object, source] of [[base, 'legacy'], [a, 'first'], [b, 'second']]) {
    assert.equal((await repo.invoke('git-commit', { ...object, sourceText: source, message: source })).success, true);
  }
  for (const [object, source] of [[a, 'first'], [b, 'second'], [base, 'legacy']]) {
    const history = await repo.invoke('git-get-history', object); assert.equal(history.history.length, 1);
    assert.equal((await repo.invoke('git-get-file-content', { ...object, commitId: history.history[0].fullId })).content, source);
  }
  assert.equal((await repo.invoke('git-rename-object', { ...a, oldName: a.objectName, newName: 'Renamed' })).success, true);
  assert.equal((await repo.invoke('git-delete-object', { ...a, objectName: 'Renamed' })).success, true);
  const history = await repo.invoke('git-get-history', b);
  assert.equal((await repo.invoke('git-get-file-content', { ...b, commitId: history.history[0].fullId })).content, 'second');
  assert.equal((await repo.invoke('git-get-history', base)).history.length, 1);
});
test('Trace and AI conversation storage separates table scopes and deletion preserves the other table and old files', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-trigger-scope-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const base = { schema: 'test', objectName: 'Audit', objectType: 'TRIGGER' };
  const targets = [base, { ...base, tableName: 'First' }, { ...base, tableName: 'Second' }];
  const paths = targets.map(target => resolveTraceFile(directory, 'postgres', createTraceIdentity({ database: 'test' }, target)));
  assert.equal(new Set(paths).size, 3);
  const { loadModule } = require('./helpers/loadModule.cjs');
  const { TraceDatabase } = loadModule('electron/postgres/traceDb.js', { '../services/storagePaths': { getStoragePaths: () => ({ traceDirectory: directory }) } }, {}, { strict: false });
  for (const target of targets) {
    const store = new TraceDatabase(createTraceIdentity({ database: 'test' }, target)); await store.init();
    await store.insertSteps([{ lineNum: 1, variables: {}, logText: target.tableName || 'legacy' }]); store.close();
  }
  TraceDatabase.deleteDatabase(createTraceIdentity({ database: 'test' }, targets[1]));
  assert.equal(TraceDatabase.exists(createTraceIdentity({ database: 'test' }, targets[0])), true);
  assert.equal(TraceDatabase.exists(createTraceIdentity({ database: 'test' }, targets[2])), true);
  const ai = targets.map(({ objectType: category, ...identity }) => ({ connectionScope: 'a'.repeat(64), dbType: 'postgresql', category, ...identity }));
  assert.equal(new Set(ai.map(identity => getSourceHistoryFile(directory, identity))).size, 3);
  for (const identity of ai) await saveSourceHistory(directory, identity, { messages: [{ id: '1', sender: 'user', text: identity.tableName || 'legacy', timestamp: 'now' }], selectedObjects: [] });
  await deleteSourceHistories([directory], ai[1]);
  assert.equal(await loadSourceHistory(directory, ai[1]), null);
  assert.equal((await loadSourceHistory(directory, ai[2])).messages[0].text, 'Second');
  assert.equal((await loadSourceHistory(directory, ai[0])).messages[0].text, 'legacy');
});
for (const dialect of ['oracle', 'postgresql']) {
  test(`${dialect}: executable record references change while literals, identifiers, comments and line count remain exact`, () => {
    const prefix = dialect === 'oracle' ? ':' : '';
    const literal = `${prefix}NEW.ID`;
    const extra = dialect === 'oracle' ? `q'[${literal}]'` : `$body$${literal}$body$`;
    const source = `BEGIN\n ${prefix}NEW.NOTE := '${literal}';\n ${prefix}OLD.ID := ${prefix}NEW.ID; -- ${literal}\n /* ${prefix}OLD.ID */\n x := ${extra};\n x := "NEW.ID";\n x := 'it''s ${literal}';\nEND;`;
    const changed = rewriteTriggerTraceReferences(source, dialect, { dml: 'INSERT' });
    assert.ok(changed.includes(`v_n.NOTE := '${literal}'`)); assert.ok(changed.includes('v_o.ID := v_n.ID'));
    assert.ok(changed.includes(`-- ${literal}`)); assert.ok(changed.includes(`/* ${prefix}OLD.ID */`));
    assert.ok(changed.includes(extra)); assert.ok(changed.includes('"NEW.ID"')); assert.ok(changed.includes(`'it''s ${literal}'`));
    assert.equal(changed.split('\n').length, source.split('\n').length);
    const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${dialect}/windows/trigger/triggerTraceProgram.ts`);
    const program = buildTriggerTraceProgram({ wizBody: source, wizSchema: 'test', wizTargetObject: 'Demo', wizTiming: 'BEFORE', wizForEachRow: true,
      traceTargetDml: 'INSERT', traceInputData: {}, structureDefs: [], checkWhere: '1=1', formatSqlValue: () => 'NULL', wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
    assert.ok(program.sqlText.includes(`v_n.NOTE := '${literal}'`));
    const line = program.mapT2P[2]; assert.ok(line > 0); assert.equal(program.mapP2T[line], 2);
  });
}
test('Oracle custom aliases and event predicates preserve quoted strings and comments', () => {
  const source = `:N.ID := :O.ID; IF INSERTING THEN NULL; END IF; x := 'INSERTING :N.ID'; -- UPDATING\n x := q'[DELETING :O.ID]';`;
  const changed = rewriteTriggerTraceReferences(source, 'oracle', { newAlias: 'N', oldAlias: 'O', dml: 'INSERT' });
  assert.ok(changed.startsWith('v_n.ID := v_o.ID; IF TRUE THEN')); assert.ok(changed.includes("'INSERTING :N.ID'"));
  assert.ok(changed.includes('-- UPDATING')); assert.ok(changed.includes("q'[DELETING :O.ID]'"));
});
test('PostgreSQL token boundaries, escaped literals and nested comments are preserved', () => {
  const source = `RENEW.ID := NEW.ID; x := E'NEW.ID\\\\OLD.ID'; /* outer /* NEW.ID */ OLD.ID */ x := schema.NEW.ID;`;
  const result = rewriteTriggerTraceReferences(source, 'postgresql', { dml: 'INSERT' });
  assert.equal(result, source.replace(':= NEW.ID;', ':= v_n.ID;'));
});

test('AI coding and trace-debug requests retain the selected trigger table in their history identity', async () => {
  const h = createHookHarness(), t = key => key;
  const { useAiCodingGeneration } = loadTypeScript('src/features/ai/useAiCodingGeneration.ts', {
    react: h.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '../stored/storedCreation': {}, '../stored/packageCreation': {}, './codingResponse': {}, './triggerBodyResponse': {}
  }, { queueMicrotask, window: { addEventListener() {}, removeEventListener() {} } });
  const render = tableName => h.render(() => useAiCodingGeneration({ dbType: 'postgresql', schema: 'test', objectName: 'Audit', tableName,
    objectType: 'TRIGGER', sourceText: 'BEGIN END;', setSourceText() {}, isActive: true, isNew: false, onStart() {} }));
  const a = render('First'); h.commit(); assert.equal(a.responseTarget.getHistoryIdentity().tableName, 'First');
  render('Second'); h.commit(); assert.equal(a.responseTarget.getHistoryIdentity().tableName, 'Second'); h.unmount();
  const debug = createHookHarness(), calls = [], contexts = [];
  const { useAiTraceDebug } = loadTypeScript('src/features/ai/useAiTraceDebug.ts', {
    react: debug.react, 'react-i18next': { useTranslation: () => ({ t, i18n: { language: 'en' } }) },
    './useAiObjectSelection': { useAiObjectSelection: () => ({}) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return { success: true, content: '{}' }; } } }
  }, { crypto: { randomUUID: () => 'test' }, alert: error => { throw new Error(error); } });
  const hook = debug.render(() => useAiTraceDebug({ dbType: 'postgresql', schema: 'test', objectName: 'Audit', objectType: 'TRIGGER',
    tableName: 'First', sourceText: 'BEGIN END;', isAiEnabled: true, onOpenAiSidebar: context => contexts.push(context) }));
  debug.commit(); await hook.requestDebug();
  assert.equal(calls[0][1].tableName, 'First'); assert.equal(contexts[0].historyTarget.getHistoryIdentity().tableName, 'First'); debug.unmount();
});

test('PostgreSQL trace bodies choose an outer dollar delimiter absent from the original source', () => {
  const { buildTriggerTraceProgram } = loadTypeScript('src/features/postgresql/windows/trigger/triggerTraceProgram.ts');
  const body = `BEGIN\n NEW.NOTE := $$NEW.ID $monabase_trace$$$;\nEND;`;
  const program = buildTriggerTraceProgram({ wizBody: body, wizSchema: 'test', wizTargetObject: 'Demo', wizTiming: 'BEFORE', wizForEachRow: true,
    traceTargetDml: 'INSERT', traceInputData: {}, structureDefs: [], checkWhere: '1=1', formatSqlValue: () => 'NULL' });
  assert.match(program.sqlText, /AS \$monabase_trace_\$/);
  assert.ok(program.sqlText.includes('$$NEW.ID $monabase_trace$$$'));
});

for (const dialect of ['oracle', 'postgresql']) {
  test(`${dialect}: trigger simulation never emits the triggering DML for any supported timing or event`, () => {
    const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${dialect}/windows/trigger/triggerTraceProgram.ts`);
    for (const timing of ['BEFORE', 'AFTER', 'INSTEAD OF']) for (const event of ['INSERT', 'UPDATE', 'DELETE', ...(dialect === 'postgresql' ? ['TRUNCATE'] : [])]) {
      const program = buildTriggerTraceProgram({ wizBody: 'BEGIN\n NULL;\nEND;', wizSchema: 'test', wizTargetObject: 'Demo', wizTiming: timing, wizForEachRow: event !== 'TRUNCATE',
        traceTargetDml: event, traceInputData: { AMOUNT: '1' }, structureDefs: [{ COLUMN_NAME: 'AMOUNT', DATA_TYPE: 'NUMBER' }], checkWhere: '1=1', formatSqlValue: () => '1', wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
      assert.doesNotMatch(program.sqlText, /\b(?:INSERT INTO|UPDATE .+ SET|DELETE FROM|TRUNCATE TABLE)\b/i);
      assert.match(program.sqlText, /ROLLBACK;/);
      assert.equal(program.mapP2T[program.mapT2P[2]], 2);
    }
  });
}
test('Oracle column predicates consume balanced arguments and preserve source lines, comments and literals', () => {
  const source = `IF UPDATING /* keep */ (\n UPPER('amount')\n) AND UPDATING('OTHER') AND UPDATING THEN NULL; END IF; -- UPDATING('x')`;
  const changed = rewriteTriggerTraceReferences(source, 'oracle', { dml: 'UPDATE', updatedColumns: ['AMOUNT'] });
  assert.match(changed, /UPPER \/\* keep \*\/ \(\n UPPER\('amount'\)\n\) IN \('AMOUNT'\)/);
  assert.ok(changed.includes("UPPER('OTHER') IN ('AMOUNT')"));
  assert.ok(changed.includes('AND TRUE THEN')); assert.ok(changed.includes("-- UPDATING('x')"));
  assert.equal(changed.split('\n').length, source.split('\n').length);
  for (const dml of ['INSERT', 'DELETE']) assert.match(rewriteTriggerTraceReferences("UPDATING('AMOUNT')", 'oracle', { dml, updatedColumns: ['AMOUNT'] }), /THEN 0 ELSE 0/);
  assert.equal(rewriteTriggerTraceReferences("UPDATING('AMOUNT'", 'oracle', { dml: 'UPDATE' }), "UPDATING('AMOUNT'");
});
