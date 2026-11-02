// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createVersionControl } = require('./helpers/versionControl.cjs');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { getFullTableDDL } = loadTypeScript('src/features/postgresql/windows/common/ddlHelper.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function catalog(overrides = {}) {
  return { invoke: async (channel, query, binds) => {
    assert.equal(channel, 'execute-sql-bg');
    assert.equal(binds.target, '"s\'x"."orders"');
    const kind = query.includes('FROM pg_attribute a\n    JOIN pg_type') ? 'columns' : query.includes('SELECT c.conname') ? 'constraints' : query.includes("SELECT 'TABLE'") ? 'comments' : query.includes('pg_get_indexdef') ? 'indexes' : 'triggers';
    if (overrides[kind]?.success === false) return overrides[kind];
    return { success: true, rows: overrides[kind] || [] };
  } };
}
test('PostgreSQL table source retains complete types, quoted identifiers, named constraints and generation clauses', async () => {
  const columns = [
    { column_name: 'amount', formatted_type: 'numeric(10,2)' },
    { column_name: 'tags', formatted_type: 'text[]' },
    { column_name: 'state', formatted_type: '"Types"."Order Status"' },
    { column_name: 'a"b', formatted_type: 'character varying(25)', expression: "'initial'::character varying", not_null: true },
    { column_name: 'id', formatted_type: 'bigint', identity: 'a' },
    { column_name: 'total', formatted_type: 'numeric(12,2)', generated: 's', expression: '(amount * 2)' }
  ].map(column => ({ not_null: false, expression: null, identity: '', generated: '', ...column }));
  const ddl = await getFullTableDDL(catalog({ columns,
    constraints: [{ name: 'order"pk', ddl: 'PRIMARY KEY (id, amount)' }, { name: 'positive', ddl: 'CHECK ((amount > 0))' }],
    comments: [{ type: 'COLUMN', col_name: 'a"b', comment: "owner's note" }]
  }), "s'x", 'orders', key => key, false);
  for (const fragment of ['"amount" numeric(10,2)', '"tags" text[]', '"state" "Types"."Order Status"', '"a""b" character varying(25)', 'GENERATED ALWAYS AS IDENTITY', 'GENERATED ALWAYS AS ((amount * 2)) STORED', 'CONSTRAINT "order""pk" PRIMARY KEY (id, amount)', 'CONSTRAINT "positive" CHECK', '"a""b" IS \'owner\'\'s note\'']) assert.ok(ddl.includes(fragment), fragment);
});
test('PostgreSQL source retrieval rejects empty and failed metadata instead of returning partial DDL', async () => {
  await assert.rejects(getFullTableDDL(catalog(), "s'x", 'orders', key => key, false), /no visible columns/);
  await assert.rejects(getFullTableDDL(catalog({ columns: [{ column_name: 'id', formatted_type: 'integer' }], constraints: { success: false, error: 'Denied constraints' } }), "s'x", 'orders', key => key, false), /Denied constraints/);
});
test('Refreshed PostgreSQL sources retain changed constraints in real Git history without renderer-side appending', async t => {
  const repo = await createGitRepository(t), requests = [];
  const h = createVersionControl((channel, args) => { requests.push(channel); return repo.invoke(channel, args); }, { schema: "s'x" });
  t.after(h.unmount);
  for (const [index, condition] of ['amount > 0', 'amount > 10'].entries()) {
    h.props.currentSource = ''; await h.flush();
    h.props.currentSource = await getFullTableDDL(catalog({ columns: [{ column_name: 'amount', formatted_type: 'numeric(10,2)', expression: null }], constraints: [{ name: 'positive', ddl: `CHECK ((${condition}))` }] }), "s'x", 'orders', key => key, false);
    await h.flush(); await h.render().handleCommit();
    const history = await repo.invoke('git-get-history', { dbType: 'POSTGRESQL', schema: "s'x", objectType: 'TABLE', objectName: 'orders' });
    assert.equal(history.history.length, index + 1);
    const source = await repo.invoke('git-get-file-content', { dbType: 'POSTGRESQL', schema: "s'x", objectType: 'TABLE', objectName: 'orders', commitId: history.history[0].fullId });
    assert.ok(source.content.includes(condition)); assert.ok(source.content.includes('numeric(10,2)'));
    assert.equal((source.content.match(/CONSTRAINT "positive"/g) || []).length, 1);
  }
  assert.ok(!requests.includes('execute-sql-bg'));
});
for (const failOld of [false, true]) test(`History content ignores a late ${failOld ? 'error' : 'success'} after selecting another revision`, async t => {
  const pending = {};
  const h = createVersionControl((channel, args) => channel === 'git-get-file-content' ? (pending[args.commitId] = deferred()).promise : Promise.resolve({ success: false }));
  t.after(h.unmount); await h.flush();
  const a = h.render().handleHistoryRowClick({ row: { id: 'A', fullId: 'A' } });
  const b = h.render().handleHistoryRowClick({ row: { id: 'B', fullId: 'B' } });
  pending.B.resolve({ success: true, content: 'source B' }); await b;
  if (failOld) pending.A.reject(new Error('Late error')); else pending.A.resolve({ success: true, content: 'source A' });
  await a;
  assert.equal(h.render().selectedHistory.fullId, 'B'); assert.equal(h.render().pastSource, 'source B');
});
test('Switching objects invalidates pending history content and list requests', async t => {
  const content = deferred(), lists = [];
  const h = createVersionControl((channel) => {
    if (channel === 'git-get-file-content') return content.promise;
    if (channel === 'git-get-history') { const request = deferred(); lists.push(request); return request.promise; }
    return Promise.resolve({ success: true, isRepo: true, repoPath: '/test' });
  });
  t.after(h.unmount); await h.flush(); h.render().setActiveSubTab(1); await h.flush();
  const pending = h.render().handleHistoryRowClick({ row: { id: 'A', fullId: 'A' } });
  h.props.objectName = 'other'; await h.flush();
  lists.at(-1).resolve({ success: true, history: [{ id: 'new' }] }); await h.flush();
  lists[0].resolve({ success: true, history: [{ id: 'old' }] }); content.resolve({ success: true, content: 'wrong object' }); await pending; await h.flush();
  assert.equal(h.render().historyList[0].id, 'new'); assert.equal(h.render().selectedHistory, null); assert.equal(h.render().pastSource, '');
});

test('History pages replace visible rows, preserve the selected snapshot and retain the current page on failure', async t => {
  const pages = [], pending = deferred();
  const h = createVersionControl(async (channel, args) => {
    if (channel === 'git-status-check') return { success: true, isRepo: true };
    if (channel === 'git-get-history') {
      pages.push(args.page);
      if (args.page === 2) return pending.promise;
      return { success: true, history: [{ id: `page${args.page}`, fullId: `page${args.page}` }], hasMore: true };
    }
    if (channel === 'git-get-file-content') return { success: true, content: 'chosen snapshot' };
    return { success: false, error: 'Unexpected request' };
  });
  t.after(h.unmount); await h.flush(); h.render().setActiveSubTab(1); await h.flush();
  await h.render().handleHistoryRowClick({ row: { id: 'chosen', fullId: 'chosen' } }); await h.flush();
  await h.render().loadHistory(1); await h.flush();
  assert.equal(h.render().historyPage, 1); assert.equal(h.render().historyList.length, 1);
  assert.equal(h.render().historyList[0].id, 'page1'); assert.equal(h.render().pastSource, 'chosen snapshot');
  const loading = h.render().loadHistory(2); await h.flush(); assert.equal(h.render().historyLoading, true);
  pending.resolve({ success: false, error: 'Page too large' }); await loading; await h.flush();
  assert.equal(h.render().historyPage, 1); assert.equal(h.render().historyLoading, false);
  assert.equal(h.render().historyList[0].id, 'page1'); assert.ok(h.alerts.includes('Page too large'));
  assert.ok(pages.includes(0) && pages.includes(1) && pages.includes(2));
});
