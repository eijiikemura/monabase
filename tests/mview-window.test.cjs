// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mviewModules, createMviewHarness } = require('./helpers/mviewData.cjs');
function fixture(database) {
  const f = { calls: [], fail: false, failSource: false, failGit: false, populated: true, unique: true, method: 'FORCE', timing: 'DEMAND', schedule: 'SYSDATE + 1', shared: false, hold: false, release: null, query: 'SELECT 1 AS ID', id: '91' };
  f.invoke = async (...args) => {
    f.calls.push(args); const [channel, sql] = args;
    if (channel === 'get-db-info') return { success: true, info: 'Oracle Database 23ai Release 23.0.0.0.0' };
    if (channel.startsWith('git-')) return { success: !f.failGit, error: 'Git unavailable' };
    if (channel === 'execute-sql-bg') {
      if (/ALL_MVIEWS m JOIN|c.relkind = 'm'/.test(sql)) {
        if (f.fail) return { success: false, error: 'Metadata unavailable' };
        const row = database === 'oracle' ? { QUERY: f.query, OBJECT_ID_TEXT: f.id, REFRESH_METHOD: f.method, REFRESH_MODE: f.timing, UPDATABLE: 'N', ON_QUERY_COMPUTATION: 'Y', LAST_REFRESH_TYPE: 'COMPLETE', STALENESS: 'FRESH', BUILD_MODE: 'IMMEDIATE' }
          : { id: f.id, definition: f.query + ';', populated: f.populated, concurrent: f.unique, method: 'heap', tablespace: 'Demo Space', options: [], owner: 'TEST' };
        if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve({ success: true, rows: [row] }); }); }
        return { success: true, rows: [row] };
      }
      if (/ALL_REFRESH r/.test(sql)) return { success: true, rows: [{ INTERVAL: f.schedule, NEXT_DATE_TEXT: '2026-10-27 00:00:00', GROUP_SIZE: f.shared ? 2 : 1 }] };
      if (/GET_DDL\('MATERIALIZED_VIEW'/.test(sql)) return f.failSource ? { success: false, error: 'DDL unavailable' } : { success: true, rows: [{ DDL: 'CREATE MATERIALIZED VIEW "TEST"."DemoMv" STORAGE (INITIAL 65536) AS SELECT 1 AS ID' }] };
      if (/GET_DDL\('INDEX'/.test(sql)) return { success: true, rows: [] };
      if (/pg_options_to_table/.test(sql)) return { success: true, rows: [{ option_name: 'fillfactor', option_value: '80' }] };
      if (/pg_get_indexdef/.test(sql)) return { success: true, rows: [{ ddl: 'CREATE UNIQUE INDEX "MvIdx" ON "TEST"."DemoMv" ("ID")' }] };
      if (/obj_description/.test(sql)) return { success: true, rows: [{ name: null, comment: "test's comment" }] };
      if (/pg_attribute/.test(sql)) return f.failSource ? { success: false, error: 'DDL unavailable' } : { success: true, rows: [{ name: 'ID' }] };
      if (/ALL_DEPENDENCIES|pg_describe_object/.test(sql)) return { success: true, rows: [database === 'oracle' ? { LABEL: 'Uses: TEST.BASE_ROWS' } : { label: 'Uses: table TEST.BASE_ROWS' }] };
      return { success: true, rows: [] };
    }
    if (channel === 'execute-sql') {
      if (/ALTER MATERIALIZED VIEW/.test(sql)) { for (const method of ['FAST', 'COMPLETE', 'FORCE']) if (sql.includes(method)) f.method = method; if (sql.includes('ON COMMIT')) f.timing = 'COMMIT'; }
      if (/REFRESH MATERIALIZED VIEW/.test(sql)) f.populated = true;
    }
    return { success: true, rows: [] };
  };
  return f;
}
const writes = f => f.calls.filter(call => call[0] === 'execute-sql');
const edit = async (h, values) => { h.state.setFormData(previous => ({ ...previous, ...values })); await h.flush(); };
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: initial and refresh failures block mutations and preserve loaded source and edited settings`, async () => {
    const f = fixture(database); f.fail = true; const h = await createMviewHarness(database, f.invoke);
    try {
      assert.equal(h.state.ready, false); await h.state.handleExecute(); await h.state.handleDelete(); await h.state.handleRefreshMView(); assert.equal(writes(f).length, 0);
      f.fail = false; await h.state.loadSource(); await h.flush(); const source = h.state.sourceText;
      await edit(h, { next: 'SYSDATE + 2' }); f.failSource = true; await h.state.loadSource(); await h.flush(); assert.equal(h.state.sourceText, source); assert.equal(h.state.formData.next, 'SYSDATE + 2'); assert.equal(h.state.ready, false);
      f.failSource = false; await h.state.loadSource(); await h.flush(); assert.equal(h.state.formData.next, 'SYSDATE + 2');
    } finally { h.unmount(); }
  });
  test(`${database}: stale responses cannot overwrite newer definitions and identity setters stay fixed`, async () => {
    const f = fixture(database), h = await createMviewHarness(database, f.invoke);
    try {
      f.hold = true; const old = h.state.loadSource(); f.query = 'SELECT 2 AS ID'; await h.state.loadSource(); await h.flush(); f.release(); await old; await h.flush(); assert.equal(h.state.formData.selectSql.replace(/;$/, ''), f.query);
      await edit(h, { schema: 'OTHER', mviewName: 'WRONG' }); assert.equal(h.state.formData.schema, 'TEST'); assert.equal(h.state.formData.mviewName, 'DemoMv');
    } finally { h.unmount(); }
  });
  test(`${database}: refresh uses saved identity despite a pending rename and duplicate clicks issue one mutation`, async () => {
    const f = fixture(database), h = await createMviewHarness(database, f.invoke);
    try {
      h.state.setRenameTo('WRONG'); await h.flush(); f.hold = true; const first = h.state.handleRefreshMView(); await h.state.handleRefreshMView(); f.release(); await first; await h.flush();
      assert.equal(writes(f).length, 1); const call = writes(f)[0]; assert.ok(database === 'oracle' ? call[2].target.includes('DemoMv') : call[1].includes('"DemoMv"')); assert.ok(!call[1].includes('WRONG'));
    } finally { h.unmount(); }
  });
  test(`${database}: changed external object identity blocks refresh and deletion`, async () => {
    const f = fixture(database), h = await createMviewHarness(database, f.invoke);
    try { f.id = '92'; await h.state.handleRefreshMView(); await h.flush(); await h.state.handleDelete(); await h.flush(); assert.equal(writes(f).length, 0); assert.ok(h.state.conflict); } finally { h.unmount(); }
  });
  test(`${database}: source retains native or catalog options and dependencies are read without main SQL`, async () => {
    const f = fixture(database), h = await createMviewHarness(database, f.invoke);
    try {
      assert.ok(h.state.sourceText.startsWith('CREATE MATERIALIZED VIEW'));
      assert.ok(h.state.sourceText.includes(database === 'oracle' ? 'STORAGE (INITIAL 65536)' : 'CREATE UNIQUE INDEX'));
      if (database === 'postgresql') { assert.ok(h.state.sourceText.includes('TABLESPACE "Demo Space"')); assert.ok(h.state.sourceText.includes('"fillfactor"=E\'80\'')); assert.ok(h.state.sourceText.includes("test''s comment")); }
      h.state.setActiveTab(3); await h.flush(); assert.ok(h.state.relations[0].includes('BASE_ROWS')); assert.equal(writes(f).length, 0);
    } finally { h.unmount(); }
  });
}
test('Oracle: no-op settings do not issue any query, changed settings use minimal ALTER and Git receives CREATE DDL', async () => {
  const f = fixture('oracle'), h = await createMviewHarness('oracle', f.invoke);
  try {
    f.calls.length = 0; await h.state.handleExecute(); assert.equal(f.calls.length, 0);
    await edit(h, { refreshMethod: 'COMPLETE' }); await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 1); assert.ok(writes(f)[0][1].endsWith('REFRESH COMPLETE')); assert.ok(!writes(f)[0][1].includes('NEXT'));
    const git = f.calls.find(call => call[0] === 'git-commit'); assert.match(git[1].sourceText, /^CREATE MATERIALIZED VIEW/); assert.ok(!git[1].sourceText.startsWith('ALTER'));
  } finally { h.unmount(); }
});
test('Oracle: concurrent settings require explicit review and shared schedules stay protected', async () => {
  const f = fixture('oracle'), h = await createMviewHarness('oracle', f.invoke);
  try {
    await edit(h, { refreshMethod: 'COMPLETE' }); f.method = 'FAST'; await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 0); assert.ok(h.state.conflict);
    h.state.keepLocalChanges(); await h.flush(); await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 1);
    f.shared = true; await h.state.loadSource(); await h.flush(); assert.equal(h.state.metadata.scheduleKnown, false); await edit(h, { next: 'SYSDATE + 2' }); const count = writes(f).length; await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, count);
  } finally { h.unmount(); }
});
test('Oracle: failed Git recording retries only Git and never repeats successful ALTER', async () => {
  const f = fixture('oracle'), h = await createMviewHarness('oracle', f.invoke, {}, { confirm: () => false });
  try {
    await edit(h, { refreshMethod: 'COMPLETE' }); f.failGit = true; await h.state.handleExecute(); await h.flush(); assert.equal(h.state.gitPending, true); assert.equal(writes(f).length, 1);
    f.failGit = false; await h.state.retryGit(); await h.flush(); assert.equal(h.state.gitPending, false); assert.equal(writes(f).length, 1);
  } finally { h.unmount(); }
});
test('PostgreSQL: populated state and an eligible unique index both gate concurrent refresh', async () => {
  const f = fixture('postgresql'); f.populated = false; const h = await createMviewHarness('postgresql', f.invoke);
  try {
    assert.equal(h.state.metadata.populated, false); assert.equal(h.state.metadata.concurrent, false); h.state.setConcurrent(true); await h.flush(); await h.state.handleRefreshMView(); await h.flush(); assert.equal(writes(f).length, 0);
    h.state.setConcurrent(false); await h.flush(); await h.state.handleRefreshMView(); await h.flush(); assert.equal(h.state.metadata.populated, true);
    h.state.setConcurrent(true); await h.flush(); await h.state.handleRefreshMView(); await h.flush(); assert.ok(writes(f).at(-1)[1].includes('CONCURRENTLY'));
  } finally { h.unmount(); }
});
test('Query and date-expression validation preserve quoted delimiters but reject extra statements and modifying CTEs', () => {
  const { model } = mviewModules(async () => ({}));
  for (const db of ['oracle', 'postgresql']) {
    assert.ok(model.mviewQuery("SELECT ';' AS ID", db)); assert.ok(model.mviewQuery('WITH x AS (SELECT 1 AS ID) SELECT * FROM x;', db));
    for (const query of ['SELECT 1; DROP TABLE T', 'DELETE FROM T', 'WITH x AS (DELETE FROM T RETURNING *) SELECT * FROM x']) assert.throws(() => model.mviewQuery(query, db));
  }
  for (const value of ['TRUNC(SYSDATE) + 1', "TO_DATE('2026-10-27', 'YYYY-MM-DD')", 'SYSDATE + 1/24']) assert.equal(model.mviewDateExpression(value), value);
  for (const value of ['SYSDATE; DROP TABLE T', 'SYSDATE) NEXT SYSDATE', 'EVIL_FUNCTION()', 'SYSDATE, SYSDATE']) assert.throws(() => model.mviewDateExpression(value));
});
test('Oracle: invalid schedules and unsupported creation features are rejected before SQL', async () => {
  const f = fixture('oracle'), h = await createMviewHarness('oracle', f.invoke);
  try { await edit(h, { next: 'SYSDATE; DROP TABLE T' }); f.calls.length = 0; await h.state.handleExecute(); assert.equal(f.calls.length, 0); } finally { h.unmount(); }
  const invoke = (channel, ...args) => channel === 'get-db-info' ? Promise.resolve({ success: true, info: 'Oracle Database 12c Release 12.1.0.2.0' }) : f.invoke(channel, ...args);
  const old = await createMviewHarness('oracle', invoke, { isNew: true });
  try { await edit(old, { selectSql: 'SELECT 1 FROM DUAL', isRealTime: true }); const count = writes(f).length; await old.state.handleExecute(); await old.flush(); assert.equal(writes(f).length, count); assert.equal(old.state.error, 'mview_version_required'); } finally { old.unmount(); }
});
test('New object Git retry completes navigation without repeating CREATE', async () => {
  const f = fixture('oracle'), h = await createMviewHarness('oracle', f.invoke, { isNew: true }, { confirm: () => false });
  try {
    await edit(h, { selectSql: 'SELECT 1 FROM DUAL' }); f.failGit = true; await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(h.state.gitPending, true); assert.equal(h.events.filter(e => e.type === 'mview-created').length, 0);
    f.failGit = false; await h.state.retryGit(); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(h.events.filter(e => e.type === 'mview-created').length, 1);
  } finally { h.unmount(); }
});
test('PostgreSQL: renaming and Git retry preserve the completed rename phase and use the saved original name', async () => {
  const f = fixture('postgresql'); let failCommit = true;
  const invoke = async (...args) => { if (args[0] === 'git-commit' && failCommit) { f.calls.push(args); return { success: false, error: 'Commit failed' }; } return f.invoke(...args); };
  const h = await createMviewHarness('postgresql', invoke, {}, { confirm: message => message === 'mview_rename_confirm' });
  try {
    h.state.setRenameTo('Next"Name'); await h.flush(); await h.state.handleRename(); await h.flush(); assert.equal(h.state.gitPending, true); assert.match(writes(f)[0][1], /"DemoMv" RENAME TO "Next""Name"$/);
    failCommit = false; await h.state.retryGit(); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(f.calls.filter(c => c[0] === 'git-rename-object').length, 1); assert.ok(h.events.some(e => e.type === 'open-mview-tab'));
  } finally { h.unmount(); }
});
test('PostgreSQL: uncommitted refresh is displayed as pending and actual transaction completion reloads metadata', async () => {
  const f = fixture('postgresql');
  const invoke = async (...args) => { const result = await f.invoke(...args); return args[0] === 'execute-sql' ? { ...result, hasUncommittedTx: true } : result; };
  const h = await createMviewHarness('postgresql', invoke);
  try {
    await h.state.handleRefreshMView(); await h.flush(); assert.equal(h.state.refreshPending, true); const mutation = f.calls.findIndex(c => c[0] === 'execute-sql'); assert.equal(f.calls.slice(mutation + 1).filter(c => c[0] === 'execute-sql-bg').length, 0); const before = f.calls.length;
    h.transactionChanged(false); await h.flush(); assert.equal(h.state.refreshPending, false); assert.ok(f.calls.length > before);
  } finally { h.unmount(); }
});
