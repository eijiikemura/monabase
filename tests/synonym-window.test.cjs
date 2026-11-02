// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { synonymModules, createSynonymHarness } = require('./helpers/synonymData.cjs');
function fixture() {
  const f = { calls: [], exists: true, fail: false, failSource: false, target: 'Rows', link: '', hold: false, release: null, types: [{ OBJECT_TYPE: 'TABLE', STATUS: 'VALID' }], user: 'TEST' };
  f.invoke = async (...args) => {
    f.calls.push(args); const [channel, sql, binds] = args;
    if (channel === 'execute-sql-bg') {
      if (/GET_DDL/.test(sql)) return f.failSource ? { success: false, error: 'Source unavailable' } : { success: true, rows: [{ DDL: `CREATE OR REPLACE EDITIONABLE SYNONYM "TEST"."DemoSyn" FOR "TEST"."${f.target}"` }] };
      if (/FROM ALL_SYNONYMS s/.test(sql)) {
        if (f.fail) return { success: false, error: 'Metadata unavailable' };
        const result = { success: true, rows: f.exists ? [{ OWNER: binds.owner, SYNONYM_NAME: binds.name, TABLE_OWNER: 'TEST', TABLE_NAME: f.target, DB_LINK: f.link || null, EDITIONABLE: binds.owner === 'PUBLIC' ? 'N' : 'Y' }] : [] };
        if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve(result); }); }
        return result;
      }
      if (/ALL_DEPENDENCIES/.test(sql)) return { success: true, rows: [{ OWNER: 'TEST', NAME: 'Dependent', TYPE: 'VIEW' }] };
      if (/SYS_CONTEXT/.test(sql)) return { success: true, rows: [{ CURRENT_USER: f.user }] };
      if (/ALL_OBJECTS/.test(sql)) return { success: true, rows: f.types };
    }
    if (channel === 'execute-sql' && /^CREATE/.test(sql)) {
      f.target = /FOR "(?:[^"]|"")*"\."((?:[^"]|"")*)"/.exec(sql)?.[1]?.replaceAll('""', '"') || f.target;
      f.exists = true;
    }
    return { success: true, rows: [] };
  };
  return f;
}
const writes = f => f.calls.filter(call => call[0] === 'execute-sql');
const edit = async (h, values) => { h.state.setFormData(previous => ({ ...previous, ...values })); await h.flush(); };
test('Synonym DDL quotes exact names, preserves editionability and uses plain CREATE for new objects', () => {
  const m = synonymModules(async () => ({})), d = { owner: 'Team.Data', name: 'Case.Syn', targetSchema: "Owner's", targetObject: 'Order Rows', dbLink: '', editionable: 'N' };
  assert.throws(() => m.synonymSql({ ...d, name: 'Bad"Name' }, false), /synonym_invalid_identifier/);
  const sql = m.synonymSql(d, false);
  assert.ok(sql.startsWith('CREATE NONEDITIONABLE SYNONYM "Team.Data"."Case.Syn"'));
  assert.ok(sql.endsWith('FOR "Owner\'s"."Order Rows";')); assert.ok(!sql.includes('OR REPLACE'));
  assert.ok(m.synonymSql({ ...d, owner: 'PUBLIC' }, true).startsWith('CREATE OR REPLACE NONEDITIONABLE PUBLIC SYNONYM "Case.Syn"'));
});
test('Database link grammar permits dotted names and rejects SQL, quotes, comments and whitespace', () => {
  const m = synonymModules(async () => ({}));
  assert.equal(m.synonymDbLink('reports.example.com'), 'REPORTS.EXAMPLE.COM');
  for (const link of ['X; DROP TABLE T', 'X--note', 'X/*note*/', 'X Y', '"X"', 'X\n', 'X..Y', '@X']) assert.throws(() => m.synonymDbLink(link));
  assert.throws(() => m.synonymSql({ owner: 'TEST', name: '', targetSchema: 'TEST', targetObject: 'T', dbLink: '', editionable: null }, false));
  assert.ok(m.synonymSql({ owner: 'TEST', name: 'S', targetSchema: '', targetObject: 'T', dbLink: 'X', editionable: null }, false).endsWith('FOR "T"@X;'));
});
test('Failed initial metadata blocks execution and deletion until successful retry', async () => {
  const f = fixture(); f.fail = true; const h = await createSynonymHarness(f.invoke);
  try {
    assert.equal(h.state.ready, false); assert.equal(h.state.loadError, 'Metadata unavailable'); await h.state.handleExecute(); await h.state.handleDelete(); assert.equal(writes(f).length, 0);
    f.fail = false; await h.state.loadSynonym(); await h.flush(); assert.equal(h.state.ready, true); assert.equal(h.state.formData.targetObject, 'Rows');
  } finally { h.unmount(); }
});
test('Missing existing metadata never enables default-form execution', async () => {
  const f = fixture(); f.exists = false; const h = await createSynonymHarness(f.invoke);
  try { assert.equal(h.state.ready, false); assert.equal(h.state.loadError, 'synonym_not_found'); } finally { h.unmount(); }
});
test('Existing identity cannot be changed through the form setter', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    await edit(h, { schema: 'OTHER', synonymName: 'OTHER', isPublic: true, targetObject: 'OtherRows' });
    assert.equal(h.state.formData.schema, 'TEST'); assert.equal(h.state.formData.synonymName, 'DemoSyn'); assert.equal(h.state.formData.isPublic, false);
    await h.state.handleExecute(); await h.flush(); assert.match(writes(f)[0][1], /SYNONYM "TEST"\."DemoSyn"/);
  } finally { h.unmount(); }
});
test('Unchanged execution sends no metadata query or DDL and retains the native saved source', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try { assert.ok(h.state.sourceText.includes('EDITIONABLE')); f.calls.length = 0; await h.state.handleExecute(); assert.equal(f.calls.length, 0); } finally { h.unmount(); }
});
test('New synonyms refuse an existing name and use CREATE without replacement for absent names', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke, { isNew: true });
  try {
    await edit(h, { targetObject: 'Rows' }); await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 0); assert.equal(h.state.operationError, 'synonym_name_exists');
    f.exists = false; await h.state.handleExecute(); await h.flush(); assert.match(writes(f)[0][1], /^CREATE SYNONYM/); assert.ok(!writes(f)[0][1].includes('OR REPLACE'));
    assert.ok(h.events.some(event => event.type === 'synonym-created'));
  } finally { h.unmount(); }
});
test('Dirty target survives activation, failed refresh and retry without changing the saved DDL preview', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    const saved = h.state.sourceText; await edit(h, { targetObject: 'MyDraft' }); assert.equal(h.state.sourceText, saved); assert.ok(h.state.generatedSql.includes('MyDraft'));
    h.update({ isActive: false }); await h.flush(); h.update({ isActive: true }); await h.flush(); assert.equal(h.state.formData.targetObject, 'MyDraft');
    f.fail = true; f.failSource = true; await h.state.loadSynonym(); await h.flush(); assert.equal(h.state.formData.targetObject, 'MyDraft'); assert.equal(h.state.sourceText, saved);
    f.fail = false; f.failSource = false; await h.state.loadSynonym(); await h.flush(); assert.equal(h.state.formData.targetObject, 'MyDraft');
  } finally { h.unmount(); }
});
test('Stale metadata responses cannot replace a newer definition or another object identity', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    f.hold = true; const pending = h.state.loadSynonym(); f.target = 'Newest'; await h.state.loadSynonym(); await h.flush(); f.release(); await pending; await h.flush(); assert.equal(h.state.formData.targetObject, 'Newest');
    f.hold = true; const old = h.state.loadSynonym(); h.update({ synonymName: 'Second' }); await h.flush(); f.release(); await old; await h.flush(); assert.equal(h.state.formData.synonymName, 'Second');
  } finally { h.unmount(); }
});
test('External changes require review and another execution, without silently replacing the target', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    await edit(h, { targetObject: 'Mine' }); f.target = 'Theirs'; await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 0); assert.equal(h.state.conflict.targetObject, 'Theirs');
    h.state.keepLocalChanges(); await h.flush(); assert.equal(writes(f).length, 0); await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(f.target, 'Mine');
  } finally { h.unmount(); }
});
test('Reloading database settings discards edits only after explicit confirmation', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try { await edit(h, { targetObject: 'Draft' }); f.target = 'Actual'; h.state.discardChanges(); await h.flush(); assert.equal(h.state.formData.targetObject, 'Actual'); } finally { h.unmount(); }
  const cancelled = await createSynonymHarness(f.invoke, {}, { confirm: () => false });
  try { await edit(cancelled, { targetObject: 'Keep' }); cancelled.state.discardChanges(); await cancelled.flush(); assert.equal(cancelled.state.formData.targetObject, 'Keep'); } finally { cancelled.unmount(); }
});
test('Source failure retains native text and blocks its copy until retry; clipboard failure is visible', async () => {
  const f = fixture(), copies = [], h = await createSynonymHarness(f.invoke, {}, { clipboard: { writeText: async text => { copies.push(text); if (copies.length > 1) throw new Error('Denied'); } } });
  try {
    const source = h.state.sourceText; f.failSource = true; await h.state.loadSynonym(); await h.flush(); assert.equal(h.state.sourceText, source); assert.equal(h.state.sourceReady, false);
    await h.state.copySource(); assert.equal(copies.length, 0); f.failSource = false; await h.state.loadSynonym(); await h.flush(); await h.state.copySource(); assert.equal(copies[0], source);
    await h.state.copySource(); await h.flush(); assert.ok(h.state.operationError.includes('synonym_copy_failed'));
  } finally { h.unmount(); }
});
test('PUBLIC mutations require confirmation and deletion addresses the original public name', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke, { schema: 'PUBLIC' }, { confirm: () => false });
  try { await edit(h, { targetObject: 'Changed' }); await h.state.handleExecute(); assert.equal(writes(f).length, 0); } finally { h.unmount(); }
  const allowed = await createSynonymHarness(f.invoke, { schema: 'PUBLIC' });
  try { await allowed.state.handleDelete(); assert.equal(writes(f)[0][1], 'DROP PUBLIC SYNONYM "DemoSyn"'); } finally { allowed.unmount(); }
});
test('Metadata and dependency inspection never connects to a remote target until explicitly requested', async () => {
  const f = fixture(); f.link = 'REMOTE.EXAMPLE'; const h = await createSynonymHarness(f.invoke);
  try {
    h.state.setActiveTab(2); await h.flush(); assert.equal(h.state.targetInfo.state, 'remote'); assert.ok(f.calls.every(call => !/ALL_OBJECTS@/.test(call[1] || '')));
    await h.state.loadInformation(true); await h.flush(); assert.ok(f.calls.some(call => /ALL_OBJECTS@REMOTE.EXAMPLE/.test(call[1]))); assert.equal(writes(f).length, 0);
  } finally { h.unmount(); }
});
test('Target visibility distinguishes own missing objects from unconfirmed other schemas', async () => {
  const f = fixture(); f.types = []; const m = synonymModules(f.invoke), d = { owner: 'TEST', name: 'S', targetSchema: 'TEST', targetObject: 'T', dbLink: '', editionable: null };
  assert.equal((await m.inspectSynonymTarget(d)).state, 'missing'); assert.equal((await m.inspectSynonymTarget({ ...d, targetSchema: 'OTHER' })).state, 'unknown');
  f.types = [{ OBJECT_TYPE: 'TYPE', STATUS: 'VALID' }]; assert.equal((await m.inspectSynonymTarget(d)).state, 'found');
});
test('Information navigation maps supported local target types and keeps exact schema/name', async () => {
  const f = fixture(), opened = [], h = await createSynonymHarness(f.invoke, { onOpenTarget: (...args) => opened.push(args) });
  try { h.state.setActiveTab(2); await h.flush(); assert.equal(h.state.dependents[0].NAME, 'Dependent'); h.state.openTarget('TABLE'); assert.deepEqual(opened[0], ['table', 'TEST', 'Rows']); } finally { h.unmount(); }
  const m = synonymModules(f.invoke); for (const type of ['TABLE', 'VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'MATERIALIZED VIEW', 'SYNONYM', 'TYPE']) assert.ok(m.synonymTargetWindow(type));
  assert.equal(m.synonymTargetWindow('JAVA CLASS'), null);
});
test('Invalid link input issues no SQL and no metadata request', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    await edit(h, { dbLink: 'X; DROP TABLE T' }); f.calls.length = 0;
    await h.state.handleExecute(); await h.flush(); assert.equal(f.calls.length, 0); assert.equal(h.state.operationError, 'synonym_invalid_link');
  } finally { h.unmount(); }
});
test('An external definition already matching the draft becomes the baseline without another DDL', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    await edit(h, { targetObject: 'Same' }); f.target = 'Same'; await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 0);
    f.calls.length = 0; await h.state.handleExecute(); assert.equal(f.calls.length, 0);
  } finally { h.unmount(); }
});
test('Concurrent execute clicks issue one DDL and a removed target synonym is never recreated by an existing editor', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try {
    await edit(h, { targetObject: 'Next' }); f.hold = true; const first = h.state.handleExecute(); await h.state.handleExecute();
    f.release(); await first; await h.flush(); assert.equal(writes(f).length, 1);
    await edit(h, { targetObject: 'Again' }); f.exists = false; f.calls.length = 0; await h.state.handleExecute(); await h.flush();
    assert.equal(writes(f).length, 0); assert.equal(h.state.operationError, 'synonym_not_found');
  } finally { h.unmount(); }
});
test('A changed definition blocks deletion until it has been reviewed', async () => {
  const f = fixture(), h = await createSynonymHarness(f.invoke);
  try { f.target = 'ExternallyChanged'; await h.state.handleDelete(); await h.flush(); assert.equal(writes(f).length, 0); assert.equal(h.state.conflict.targetObject, 'ExternallyChanged'); } finally { h.unmount(); }
});
