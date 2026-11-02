// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createViewEditor } = require('./helpers/viewEditor.cjs');
const { validateViewDefinition } = loadTypeScript('src/features/view/viewDefinition.ts');
const sql = 'CREATE OR REPLACE VIEW "test"."Demo" AS\nSELECT 1 AS "Value"';
const respond = async (channel, text) => channel === 'execute-sql-bg' && !text.includes('ALL_ERRORS')
  ? { success: true, rows: [{ DDL: sql, definition: 'SELECT 1 AS "Value"' }] } : { success: true, rows: [] };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: view target validation preserves quotes and literals and refuses other targets, commands and statement batches`, () => {
    assert.equal(validateViewDefinition(sql + '; -- trailing comment', database, 'test', 'Demo').text, sql);
    const literals = `CREATE OR REPLACE VIEW "test"."Demo" AS SELECT '; DROP VIEW x' AS value${database === 'oracle' ? ' FROM DUAL' : ''}`;
    assert.ok(validateViewDefinition(literals, database, 'test', 'Demo').text.includes("'; DROP VIEW x'"));
    for (const source of [sql.replace('"Demo"', '"Other"'), sql.replace('"test"', '"Other"'), 'DROP VIEW "test"."Demo"', sql + '; DELETE FROM x', 'CREATE TABLE "test"."Demo" (id int)', 'CREATE VIEW Demo AS SELECT 1']) {
      assert.throws(() => validateViewDefinition(source, database, 'test', 'Demo'), /view_target_definition_required/);
    }
  });
  test(`${database}: source refresh failure keeps an existing draft and baseline, blocks saves and permits retry`, async () => {
    let fail = false;
    const h = await createViewEditor(database, (...args) => fail && args[0] === 'execute-sql-bg' ? { success: false, error: 'Read failed' } : respond(...args));
    try {
      await h.render().loadSource(); await h.flush(); const baseline = h.render().savedSourceText;
      h.render().setSourceText(sql + '\n-- unsaved'); await h.flush();
      fail = true; await h.render().loadSource(); await h.flush();
      assert.equal(h.render().sourceText, sql + '\n-- unsaved'); assert.equal(h.render().savedSourceText, baseline);
      assert.equal(h.render().canSave, false); assert.match(h.render().sourceError, /Read failed/);
      h.calls.length = 0; await h.render().handleSave(); assert.equal(h.calls.length, 0);
      fail = false; await h.render().loadSource(); await h.flush(); assert.equal(h.render().canSave, true);
      assert.equal(h.render().sourceText, sql + '\n-- unsaved', 'Retry must retain a previously loaded dirty draft');
    } finally { h.unmount(); }
  });
  test(`${database}: saving another view never sends a database or Git write`, async () => {
    const h = await createViewEditor(database, respond);
    try {
      await h.render().loadSource(); await h.flush(); h.render().setSourceText(sql.replace('"Demo"', '"Other"')); await h.flush();
      h.calls.length = 0; await h.render().handleSave();
      assert.equal(h.calls.length, 0); assert.deepEqual(h.alerts, ['view_target_definition_required']);
    } finally { h.unmount(); }
  });
  test(`${database}: duplicate saves and delete during save are blocked and Git receives the executed snapshot`, async () => {
    const pending = deferred();
    const h = await createViewEditor(database, (channel, ...args) => channel === 'execute-sql' ? pending.promise : respond(channel, ...args));
    try {
      await h.render().loadSource(); await h.flush(); h.calls.length = 0;
      const first = h.render().handleSave();
      await h.render().handleSave(); await h.render().handleDelete();
      assert.equal(h.calls.filter(c => c[0] === 'execute-sql').length, 1);
      h.render().setSourceText(sql + '\n-- later edit'); await h.flush();
      pending.resolve({ success: true }); await first; await h.flush();
      const git = h.calls.find(c => c[0] === 'git-commit'); assert.ok(git); assert.equal(git[1].sourceText, database === 'oracle' ? sql : h.render().savedSourceText);
      assert.ok(!h.render().savedSourceText.includes('later edit')); assert.equal(h.render().dataRevision, 1);
      assert.equal(h.render().hasUnsavedChanges, true); assert.equal(h.render().isLoading, false);
    } finally { h.unmount(); }
  });
  test(`${database}: failed DDL keeps the editor, skips Git and does not refresh cached data`, async () => {
    const h = await createViewEditor(database, (channel, ...args) => channel === 'execute-sql' ? { success: false, error: 'Syntax rejected', errorPosition: 62 } : respond(channel, ...args));
    try {
      await h.render().loadSource(); await h.flush(); const draft = h.render().sourceText;
      await h.render().handleSave(); await h.flush();
      assert.equal(h.render().sourceText, draft); assert.equal(h.render().dataRevision, 0);
      assert.equal(h.calls.some(c => c[0] === 'git-commit'), false); assert.equal(h.render().compileErrors[0].line, 2);
    } finally { h.unmount(); }
  });
  test(`${database}: view deletion uses the main connection and emits scoped refresh and close events`, async () => {
    const h = await createViewEditor(database, respond);
    try {
      await h.render().handleDelete(); await h.flush();
      assert.equal(h.calls[0][0], 'execute-sql'); assert.equal(h.calls[0][1], 'DROP VIEW "test"."Demo"');
      assert.deepEqual(h.events.map(event => event.type), ['refresh-sidebar', 'object-deleted', 'close-tab']);
    } finally { h.unmount(); }
  });
}
test('Oracle FORCE view compilation diagnostics prevent a success notification and Git commit', async () => {
  const h = await createViewEditor('oracle', async (channel, text) => {
    if (channel === 'execute-sql-bg' && text.includes('ALL_ERRORS')) return { success: true, rows: [{ LINE: 2, POSITION: 8, TEXT: 'ORA-00904: invalid identifier' }] };
    return respond(channel, text);
  });
  try {
    await h.render().loadSource(); await h.flush(); await h.render().handleSave(); await h.flush();
    assert.equal(h.calls.some(c => c[0] === 'git-commit'), false); assert.equal(h.render().compileErrors[0].line, 2);
    assert.equal(h.alerts.includes('view_updated_successfully'), false); assert.equal(h.render().dataRevision, 1);
  } finally { h.unmount(); }
});
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: successful view changes reload columns and data on activation while keeping compatible filters`, async () => {
    const { createViewHarness } = require('./helpers/viewData.cjs');
    let names = ['KEEP', 'OLD']; const calls = [], props = { revision: 0, isActive: true };
    const h = await createViewHarness(database, { ipcRenderer: { invoke: async (...args) => {
      calls.push(args);
      if (args[0] === 'get-columns') return { success: true, columns: names };
      if (args[0] === 'execute-sql-bg') return { success: true, rows: names.map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'VARCHAR2' })) };
      if (/COUNT/.test(args[1])) return { success: true, rows: [{ CNT: 1 }] };
      return { success: true, rows: [Object.fromEntries(names.map(name => [name, 'value']))], metaData: names.map(name => ({ name })) };
    } } }, props);
    try {
      await h.waitFor(state => state.displayRows.length === 1 && !state.isLoading);
      h.state.handleConditionChange('KEEP', 'value', 'wanted'); await h.flush();
      props.isActive = false; props.revision++; names = ['KEEP', 'NEW']; calls.length = 0;
      await h.flush(); assert.equal(calls.length, 0, 'Hidden data tabs must not run a refresh');
      props.isActive = true; await h.waitFor(state => state.columns.includes('NEW') && !state.isLoading && state.displayRows.length === 1);
      assert.equal(h.state.conditions.KEEP.value, 'wanted'); assert.equal('OLD' in h.state.conditions, false);
      assert.equal(h.state.paginationModel.page, 0); assert.ok('NEW' in h.state.displayRows[0]);
      assert.equal(calls.filter(call => call[0] === 'execute-sql').length, 2);
    } finally { h.unmount(); }
  });
  test(`${database}: metadata lists direct references and dependents with exact bound identities`, async () => {
    const calls = [];
    const { loadViewMetadata } = loadTypeScript('src/features/view/viewMetadata.ts', {
      '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, text, binds) => {
        calls.push({ text, binds });
        if (/SELECT STATUS|SELECT 'VALID'/.test(text)) return { success: true, rows: [{ STATUS: 'VALID', status: 'VALID' }] };
        if (/ORDER BY (COLUMN_ID|a.attnum)/.test(text)) return { success: true, rows: [{ name: 'MiXeD', type: 'numeric', nullable: 'Y' }] };
        return { success: true, rows: [{ schema: 'test', name: 'Linked', type: 'VIEW' }] };
      } } }
    });
    const result = await loadViewMetadata(database, "S'Name", 'V"Name');
    assert.equal(result.columns[0].name, 'MiXeD'); assert.equal(result.references[0].name, 'Linked'); assert.equal(result.dependents[0].name, 'Linked');
    for (const call of calls) { assert.ok(!call.text.includes("S'Name")); assert.equal(call.binds.schema, "S'Name"); assert.equal(call.binds.name, 'V"Name'); }
  });
}
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: metadata failures remain visible and a later retry wins over older responses`, async () => {
    let fail = true, held, hold = false;
    const h = await createViewEditor(database, async (channel, text) => {
      if (/SELECT STATUS|SELECT 'VALID'/.test(text)) {
        if (hold) { hold = false; return new Promise(resolve => { held = resolve; }); }
        return fail ? { success: false, error: 'Metadata denied' } : { success: true, rows: [{ STATUS: 'VALID', status: 'VALID' }] };
      }
      return { success: true, rows: [] };
    });
    try {
      h.render().setActiveTab(3); await h.flush(); assert.match(h.render().metadataError, /Metadata denied/);
      assert.equal(h.render().metadata, null);
      fail = false; hold = true; const old = h.render().reloadMetadata();
      await h.render().reloadMetadata(); await h.flush(); assert.equal(h.render().metadata.status, 'VALID');
      held({ success: true, rows: [{ STATUS: 'STALE', status: 'STALE' }] }); await old; await h.flush();
      assert.equal(h.render().metadata.status, 'VALID'); assert.equal(h.render().metadataError, '');
    } finally { h.unmount(); }
  });
}
test('Oracle successful DDL invalidates cached data even when checking compilation diagnostics fails', async () => {
  const h = await createViewEditor('oracle', async (channel, text) => channel === 'execute-sql-bg' && text.includes('ALL_ERRORS')
    ? { success: false, error: 'Diagnostics unavailable' } : respond(channel, text));
  try {
    await h.render().loadSource(); await h.flush(); await h.render().handleSave(); await h.flush();
    assert.equal(h.render().dataRevision, 1); assert.ok(h.render().dbmsOutputs.some(text => text.includes('Diagnostics unavailable')));
    assert.equal(h.calls.some(call => call[0] === 'git-commit'), false); assert.equal(h.render().isLoading, false);
  } finally { h.unmount(); }
});
