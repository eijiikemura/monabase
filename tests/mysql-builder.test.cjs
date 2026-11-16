// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { mysqlBuilder } = require('./helpers/mysqlBuilder.cjs');
const model = loadTypeScript('src/features/query-builder/queryBuilderModel.ts');
const identity = loadTypeScript('src/shared/utils/objectIdentity.ts');
const table = (id, name = id) => ({ id, name: identity.qualifiedObjectName({ schema: 'mb_test', objectName: name }), columns: ['id', 'label', 'amount'], x: 20, y: 20 });
const field = (table, column = 'label', extra = {}) => ({ id: table.id + column, tableId: table.id, tableName: table.name, columnName: column, show: true, sort: '', groupBy: '', criteria: '', orCriteria: '', ...extra });
const object = (name, category = 'TABLE') => ({ dbType: 'mysql', key: name, schema: 'mb_test', name, category, displayName: name });
function fixture(extra = {}) {
  return mysqlBuilder(async (channel, sql) => {
    if (channel === 'show-save-dialog') return { canceled: false, filePath: '/tmp/builder-test.json' };
    if (channel === 'save-file') return { success: true };
    if (channel === 'execute-sql') return { success: true, rows: [{ label: 'pending', id: 0 }], metaData: [{ name: 'label' }, { name: 'id' }], executionTime: 1, transactionStatus: 'active', hasUncommittedTx: true };
    if (/SHOW CREATE/.test(sql)) return { success: true, rows: [{ 'Create Table': 'CREATE TABLE demo (id INT, label VARCHAR(30), amount DECIMAL(10,2))' }] };
    if (/information_schema.TABLES/.test(sql)) return { success: true, rows: [{ TABLE_TYPE: 'BASE TABLE', TABLE_COMMENT: 'Fictional orders' }] };
    return { success: true, rows: [{ name: 'id', dataType: 'int unsigned', comment: 'identifier' }, { name: 'label', dataType: 'varchar(30)', comment: 'label' }, { name: 'amount', dataType: 'decimal(10,2)', comment: 'amount' }] };
  }, extra);
}
test('MySQL builder SQL quotes every identifier, joins/composites, aggregates and conditions without ANSI fallback', () => {
  const a = table('a', 'quoted`".table'), b = table('b');
  const settings = { queryTables: [a, b], queryFields: [field(a, 'label', { criteria: "LIKE '%O''Brien%'", groupBy: 'GROUP BY' }), field(b, 'amount', { groupBy: 'SUM', sort: 'DESC' })], queryJoins: [{ id: 'j', fromTableId: a.id, fromCol: 'id', toTableId: b.id, toCol: 'id', joinType: 'LEFT' }] };
  const sql = model.generateQuerySql(settings, 'mysql');
  assert.match(sql, /`mb_test`\.`quoted``"\.table` t1/); assert.match(sql, /LEFT JOIN `mb_test`\.`b` t2 ON t1\.`id` = t2\.`id`/); assert.match(sql, /ORDER BY\n {2}SUM\(t2\.`amount`\) DESC/);
  for (const condition of ["= 'a\\' OR 1=1 #", '= 1 # hidden', '= 1; DELETE FROM t', '= (SELECT 1)']) {
    const next = { ...settings, queryFields: [field(a, 'label', { criteria: condition })] };
    assert.throws(() => model.generateQuerySql(next, 'mysql'), /qb_invalid_condition/);
  }
  const doc = { ...settings, version: 1, dbType: 'mysql', selectedSchema: 'mb_test' };
  assert.equal(model.parseQueryDocument(JSON.stringify(doc), 'mysql').dbType, 'mysql');
  assert.throws(() => model.parseQueryDocument(JSON.stringify(doc), 'oracle'), /qb_invalid_file/);
});
test('MySQL builder uses background metadata, main-session results and native pending state with undo/redo and JSON files', async () => {
  const f = await fixture();
  try {
    await f.state.handleAddObjectsToBuilder([object('demo')]); await f.flush();
    const a = f.state.queryTables[0]; f.state.handleFieldDoubleClick(a, 'label'); await f.flush();
    assert.match(f.state.sqlText, /`mb_test`\.`demo`/); f.state.handleCriteriaChange(f.state.queryFields[0].id, "= 'pending'"); await f.flush();
    f.state.editor.undo(); await f.flush(); assert.equal(f.state.queryFields[0].criteria, ''); f.state.editor.redo(); await f.flush(); assert.equal(f.state.queryFields[0].criteria, "= 'pending'");
    await f.state.handleExecuteSql(); await f.flush(); assert.equal(f.state.rows[0].label, 'pending'); assert.equal(f.states.at(-1).hasUncommittedTx, true); assert.deepEqual(f.busy.slice(-2), [true, false]);
    await f.state.handleExportJson(); await f.flush(); const saved = f.calls.find(c => c[0] === 'save-file'); assert.equal(JSON.parse(saved[2]).dbType, 'mysql');
    f.state.handleImportJson({ target: { files: [{}], value: 'selected' } }); f.readers.at(-1).result = saved[2]; f.readers.at(-1).onload(); await f.flush(); assert.equal(f.state.queryTables.length, 1);
    f.props.disabled = true; await f.flush(); const before = f.calls.length; await f.state.handleExecuteSql(); assert.equal(f.calls.length, before);
    assert.ok(!f.calls.some(c => /commit|rollback/.test(c[0])));
  } finally { f.unmount(); }
});
test('MySQL builder AI carries native references, reviews MySQL SQL and adopts settings only after explicit apply', async () => {
  const f = await fixture();
  try {
    await f.state.handleAddObjectsToBuilder([object('demo')]); await f.flush(); const a = f.state.queryTables[0];
    f.state.handleFieldDoubleClick(a, 'amount'); await f.flush(); await f.state.handleRequestAi(); await f.flush();
    assert.equal(f.contexts.length, 1); const context = f.contexts[0]; assert.match(context.referencePrompt, /MySQL 8.4/); assert.match(context.referencePrompt, /CREATE TABLE/); assert.equal(context.targetTabId, 1);
    const answer = JSON.stringify({ queryTables: f.state.queryTables, queryFields: f.state.queryFields.map(field => ({ ...field, groupBy: 'SUM', sort: 'DESC' })), queryJoins: [] });
    context.onResponse(answer); await f.flush(); assert.match(f.state.ai.review.afterSql, /SUM\(t1\.`amount`\)/); assert.equal(f.state.queryFields[0].groupBy, '');
    await f.state.ai.applyReview(); await f.flush(); assert.equal(f.state.queryFields[0].groupBy, 'SUM'); assert.ok(!f.calls.some(c => c[0] === 'execute-sql'));
    await f.state.handleRequestAi(); await f.flush(); const latest = f.contexts.at(-1); const staleAnswer = JSON.stringify({ queryTables: f.state.queryTables, queryFields: f.state.queryFields, queryJoins: [] }); f.state.handleCriteriaChange(f.state.queryFields[0].id, '> 1'); await f.flush(); assert.throws(() => latest.onResponse(staleAnswer), /query_settings_have_changed/);
  } finally { f.unmount(); }
});

test('Shared Oracle/MySQL builder panel uses the same table/view picker, toolbar, undo and disabled controls', async () => {
  const { componentHarness } = require('./helpers/componentHarness.cjs');
  const h = await fixture();
  const f = componentHarness('src/features/query-builder/QueryBuilderPanel.tsx', { tabId: 1, title: 'Builder', isActive: true, controller: h.state }, { dependencies: {
    '@/features/query-builder/QueryBuilderReviewDialog': 'AiReview', '@/features/sql/SqlWindowBottom': 'Results', '@/features/objects/ObjectPickerDialog': 'Picker', '@/features/ai/AiRequestButton': 'AiRequest'
  } });
  try {
    assert.equal(f.node('Picker').props.dbType, 'mysql'); assert.equal(f.node('Picker').props.initialSchema, 'mb_test'); assert.deepEqual(Array.from(f.node('Picker').props.categories), ['TABLE','VIEW']);
    assert.equal(f.button('execute').props.disabled, true); await f.click('add'); await h.flush(); f.props.controller = h.state; f.render(); assert.equal(f.node('Picker').props.open, true);
    await h.state.handleAddObjectsToBuilder([object('demo')]); await h.flush(); f.props.controller = h.state; f.render();
    assert.equal(f.node('Card').props['data-table-name'], h.state.queryTables[0].name); assert.equal(f.button('qb_undo').props.disabled, false);
    f.props.disabled = true; f.render(); assert.equal(f.node('Box').props.disabled, true);
  } finally { f.unmount(); h.unmount(); }
});
test('MySQL builder refuses foreign identities, stale additions and uncertain SQL outcomes', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.state.handleAddObjectsToBuilder([{ ...object('demo'), dbType: 'oracle' }]), /select_a_table_or_view/);
    f.props.isActive = false; await f.flush(); await assert.rejects(f.state.handleAddObjectsToBuilder([object('demo')]), /originating_window/); await f.flush(); assert.equal(f.state.queryTables.length, 0);
  } finally { f.unmount(); }
  const h = await mysqlBuilder(async channel => { if (channel === 'execute-sql') throw new Error('Fixture transport disconnected'); return { success: true, rows: [] }; });
  try { h.state.setSqlText('SELECT 1'); await h.flush(); await h.state.handleExecuteSql(); await h.flush(); assert.equal(h.states.at(-1).transactionStatus, 'unknown'); assert.equal(h.state.isLoading, false); }
  finally { h.unmount(); }
});
