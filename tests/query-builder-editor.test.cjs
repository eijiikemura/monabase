// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const model = loadTypeScript('src/features/query-builder/queryBuilderModel.ts');
const table = (id, name = id) => ({ id, name: '"test"."' + name.replaceAll('"', '""') + '"', columns: ['ID', 'K', 'A"B', 'AMOUNT'], x: 0, y: 0 });
const field = (table, columnName = 'ID', overrides = {}) => ({ id: 'field-' + table.id + columnName, tableId: table.id, tableName: table.name, columnName, sort: '', criteria: '', orCriteria: '', show: true, groupBy: '', ...overrides });
const join = (id, from, to, type = 'LEFT', fromCol = 'ID', toCol = 'ID') => ({ id, fromTableId: from.id, toTableId: to.id, fromCol, toCol, joinType: type });
const document = (db = 'oracle') => { const a = table('A'), b = table('B'); return { version: 1, dbType: db, selectedSchema: 'test', queryTables: [b, a], queryFields: [field(a)], queryJoins: [join('one', a, b), join('two', a, b, 'LEFT', 'K', 'K')] }; };
const plain = value => JSON.parse(JSON.stringify(value));

test('ANSI joins preserve the retained side regardless of table order and combine composite keys once', () => {
  const doc = document(), sql = model.generateQuerySql(doc);
  assert.match(sql, /FROM\n {2}"test"\."A" t2\n {2}LEFT JOIN "test"\."B" t1 ON t2\."ID" = t1\."ID" AND t2\."K" = t1\."K"/);
  assert.equal((sql.match(/JOIN/g) || []).length, 1);
  const reversed = { ...doc, queryTables: [...doc.queryTables].reverse() };
  assert.match(model.generateQuerySql(reversed), /FROM\n {2}"test"\."A" t1\n {2}LEFT JOIN "test"\."B" t2/);
  doc.queryJoins.push(join('backwards', doc.queryTables[0], doc.queryTables[1], 'RIGHT', 'AMOUNT', 'AMOUNT'));
  assert.equal((model.generateQuerySql(doc).match(/JOIN/g) || []).length, 1);
  doc.queryJoins.at(-1).joinType = 'LEFT'; assert.throws(() => model.generateQuerySql(doc), /qb_invalid_join/);
});

test('Joined components, over ten joins, cyclic joins and dangling columns are handled explicitly', () => {
  const nodes = Array.from({ length: 13 }, (_, i) => table('T' + i));
  const settings = { queryTables: nodes, queryFields: [], queryJoins: nodes.slice(1).map((n, i) => join('j' + i, nodes[i], n, 'INNER')) };
  assert.equal((model.generateQuerySql(settings).match(/INNER JOIN/g) || []).length, 12);
  settings.queryJoins.push(join('cycle', nodes[0], nodes.at(-1), 'INNER'));
  assert.throws(() => model.generateQuerySql(settings), /qb_cyclic_join/);
  settings.queryJoins = [join('ab', nodes[0], nodes[1]), join('cd', nodes[2], nodes[3])];
  assert.match(model.generateQuerySql(settings), /CROSS JOIN/);
  settings.queryJoins[0].toCol = 'missing'; assert.throws(() => model.generateQuerySql(settings), /qb_invalid_join/);
});

test('Quoted column names and aggregate sorting use the exact selected expression', () => {
  const a = table('A'), settings = { queryTables: [a], queryFields: [field(a, 'A"B'), field(a, 'AMOUNT', { groupBy: 'SUM', sort: 'DESC' })], queryJoins: [] };
  const sql = model.generateQuerySql(settings);
  assert.ok(sql.includes('t1."A""B"')); assert.match(sql, /ORDER BY\n {2}SUM\(t1\."AMOUNT"\) DESC$/);
  assert.match(sql, /GROUP BY\n {2}t1\."A""B"/);
  settings.queryFields[0].show = false; settings.queryFields[0].sort = 'ASC';
  assert.throws(() => model.generateQuerySql(settings), /qb_invalid_aggregate/);
});

test('Current format imports validate IDs, coordinates, fields, join references, options and SQL fragments atomically', () => {
  const valid = document();
  assert.equal(model.parseQueryDocument(JSON.stringify(valid), 'oracle').version, 1);
  for (const mutate of [d => delete d.version, d => d.dbType = 'postgresql', d => d.queryTables[0].x = null,
    d => d.queryTables[1].id = d.queryTables[0].id, d => d.queryFields[0].columnName = 'missing',
    d => d.queryFields[0].sort = 'DESC;DROP', d => d.queryJoins[0].fromTableId = 'missing',
    d => d.queryFields[0].criteria = '= 1; DELETE FROM demo', d => d.queryFields[0].criteria = '= 1 --comment',
    d => d.queryFields[0].criteria = "= 'unterminated", d => d.queryFields[0].criteria = 'IN (SELECT 1)',
    d => d.queryFields[0].show = 'yes']) {
    const invalid = plain(valid); mutate(invalid); assert.throws(() => model.parseQueryDocument(JSON.stringify(invalid), 'oracle'));
  }
  valid.queryFields[0].criteria = "= 'O''Brien; --text'";
  assert.ok(model.parseQueryDocument(JSON.stringify(valid), 'oracle'));
});

async function editorFixture(db = 'oracle', customInvoke) {
  const hook = createHookHarness({ doubleUpdates: true }), readers = [], alerts = [], calls = [];
  class FileReader { constructor() { readers.push(this); } readAsText() {} }
  const { useQueryBuilderDocument } = loadTypeScript('src/features/query-builder/useQueryBuilderDocument.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t: k => k }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); return customInvoke ? customInvoke(...args) : args[0] === 'show-save-dialog' ? { canceled: false, filePath: 'mock.json' } : { success: true }; } } }
  }, { FileReader, alert: value => alerts.push(value) });
  let state;
  const render = () => state = hook.render(() => useQueryBuilderDocument(db));
  const flush = async () => { for (let i = 0; i < 4; i++) { render(); hook.commit(); await hook.settle(); } return render(); };
  await flush();
  const read = content => { state.handleImportJson({ target: { files: [{}], value: '' } }); const reader = readers.at(-1); reader.result = JSON.stringify(content); reader.onload(); };
  return { get state() { return state; }, flush, readers, read, alerts, calls, unmount: hook.unmount };
}
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: editing history groups drags, saves only after persistence, and keeps failed saves dirty`, async () => {
    let fail = true;
    const h = await editorFixture(db, channel => channel === 'show-save-dialog' ? { canceled: false, filePath: 'mock.json' } : { success: !fail });
    try {
      h.read(document(db)); await h.flush(); assert.equal(h.state.isDirty, false); assert.equal(h.state.canUndo, false);
      h.state.dragging.current = true;
      h.state.setQueryTables(nodes => nodes.map(node => ({ ...node, x: 100 }))); await h.flush();
      h.state.setQueryTables(nodes => nodes.map(node => ({ ...node, x: 200 }))); await h.flush();
      assert.equal(h.state.canUndo, false); h.state.finishDrag(); await h.flush(); assert.equal(h.state.canUndo, true);
      h.state.undo(); await h.flush(); assert.equal(h.state.document.queryTables[0].x, 0); assert.equal(h.state.isDirty, false);
      h.state.redo(); await h.flush(); assert.equal(h.state.document.queryTables[0].x, 200);
      await h.state.handleExportJson(); await h.flush(); assert.equal(h.state.isDirty, true); assert.equal(h.alerts.at(-1), 'qb_save_failed');
      fail = false; await h.state.handleExportJson(); await h.flush(); assert.equal(h.state.isDirty, false);
      assert.equal(JSON.parse(h.calls.find(c => c[0] === 'save-file')[2]).dbType, db);
      h.state.undo(); await h.flush(); h.state.setQueryJoins([]); await h.flush(); assert.equal(h.state.canRedo, false);
    } finally { h.unmount(); }
  });
  test(`${db}: delayed, reversed, failed and invalid file reads never overwrite newer edits or a disposed design`, async () => {
    const h = await editorFixture(db);
    try {
      h.read(document(db)); await h.flush(); const original = h.state.document;
      h.state.handleImportJson({ target: { files: [{}], value: '' } }); const old = h.readers.at(-1);
      h.state.setQueryFields([]); await h.flush(); old.result = JSON.stringify(document(db)); old.onload(); await h.flush();
      assert.equal(h.state.document.queryFields.length, 0);
      h.read({ ...document(db), version: 99 }); await h.flush(); assert.equal(h.state.document.queryFields.length, 0); assert.equal(h.alerts.at(-1), 'qb_invalid_file');
      h.state.handleImportJson({ target: { files: [{}], value: '' } }); const before = h.readers.at(-1);
      h.read(document(db)); await h.flush(); before.result = JSON.stringify({ ...document(db), queryTables: [] }); before.onload(); await h.flush();
      assert.deepEqual(plain(h.state.document), plain(original));
      h.state.handleImportJson({ target: { files: [{}], value: '' } }); const latest = h.readers.at(-1); latest.onerror(); assert.equal(h.alerts.at(-1), 'qb_read_failed');
      const count = h.alerts.length; h.unmount(); latest.onload(); latest.onerror(); assert.equal(h.alerts.length, count);
    } finally { h.unmount(); }
  });
  test(`${db}: pending save and cancellation exclude duplicate requests and do not clear dirty changes`, async () => {
    let resolve;
    const h = await editorFixture(db, channel => channel === 'show-save-dialog' ? new Promise(done => { resolve = done; }) : { success: true });
    try {
      h.read(document(db)); await h.flush(); h.state.setQueryFields([]); await h.flush();
      const first = h.state.handleExportJson(); const second = h.state.handleExportJson();
      h.state.setQueryTables([]); await h.flush(); assert.equal(h.state.document.queryTables.length, 2);
      assert.equal(h.calls.length, 1); resolve({ canceled: true }); await Promise.all([first, second]); await h.flush();
      assert.equal(h.state.isDirty, true); assert.equal(h.calls.length, 1); assert.equal(h.state.busy.current, false);
    } finally { h.unmount(); }
  });
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: execution excludes double clicks, freezes design, preserves temporal source text and allows retry after errors`, async () => {
    const { createQueryBuilder } = require('./helpers/queryBuilder.cjs');
    let resolve;
    const h = await createQueryBuilder(db, channel => channel === 'execute-sql' ? new Promise(done => { resolve = done; }) : { success: true, rows: [] });
    try {
      h.state.editor.replace(document(db)); await h.flush();
      const first = h.state.handleExecuteSql(); const second = h.state.handleExecuteSql();
      h.state.handleRemoveTable('A'); await h.flush(); assert.equal(h.state.queryTables.length, 2);
      assert.equal(h.calls.filter(c => c[0] === 'execute-sql').length, 1);
      const exact = '2026-10-25 12:34:56.123456789 +05:45';
      resolve({ success: true, rows: [{ STAMP: exact, ID: '9007199254740993' }], metaData: [{ name: 'STAMP', dbTypeName: 'TIMESTAMP WITH TIME ZONE' }, { name: 'ID' }] });
      await Promise.all([first, second]); await h.flush(); assert.equal(h.state.rows[0].STAMP, exact);
      assert.equal(h.state.columns[0].valueFormatter({ value: exact }), exact); assert.equal(h.state.rows[0].ID, '9007199254740993');
      const failed = h.state.handleExecuteSql(); resolve({ success: false, error: 'Expected failure' }); await failed; await h.flush();
      assert.equal(h.state.isLoading, false); assert.equal(h.state.rows[0].STAMP, exact);
      const retry = h.state.handleExecuteSql(); resolve({ success: true, rows: [], metaData: [] }); await retry; await h.flush();
      assert.equal(h.state.rows.length, 0); assert.equal(h.calls.filter(c => c[0] === 'execute-sql').length, 3);
    } finally { h.unmount(); }
  });
  test(`${db}: an execution response after unmount cannot replace results or add SQL history`, async () => {
    const { createQueryBuilder } = require('./helpers/queryBuilder.cjs');
    let resolve;
    const h = await createQueryBuilder(db, () => new Promise(done => { resolve = done; }));
    h.state.editor.replace(document(db)); await h.flush(); const execution = h.state.handleExecuteSql(); h.unmount();
    resolve({ success: true, rows: [{ ID: 'late' }], metaData: [{ name: 'ID' }] }); await execution;
    assert.equal(h.alerts.length, 0); assert.equal(h.state.rows.length, 0);
  });
}
