// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { logModules, createMviewLogHarness } = require('./helpers/mviewLogData.cjs');
function fixture() {
  const f = { calls: [], fail: false, failDdl: false, missing: false, id: '7', include: true, rowid: false, sequence: false, filters: ['ID', 'a,b'], hold: false, release: null };
  f.invoke = async (...args) => {
    f.calls.push(args); const [channel, query, binds] = args;
    if (channel === 'execute-sql-bg') {
      if (query.includes('FROM ALL_TABLES t JOIN')) return { success: true, rows: [{ ID: '1', HAS_PK: 1, IS_OBJECT: 0 }] };
      if (query.includes('FROM ALL_TAB_COLUMNS')) return { success: true, rows: ['ID', 'a,b', 'Order Total'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: 'NUMBER', DATA_TYPE_OWNER: null })) };
      if (query.includes('SELECT MASTER FROM ALL_MVIEW_LOGS')) return { success: true, rows: [{ MASTER: 'MASTER' }] };
      if (query.includes('FROM ALL_MVIEW_LOGS l JOIN')) {
        const result = f.fail ? { success: false, error: 'Metadata denied' } : { success: true, rows: f.missing ? [] : [{ LOG_ID: f.id, LOG_TABLE: 'MLOG$_MASTER', LOG_OWNER: binds.owner, MASTER: binds.tableName, PRIMARY_KEY: 'YES', ROWIDS: f.rowid ? 'YES' : 'NO', SEQUENCE: f.sequence ? 'YES' : 'NO', COMMIT_SCN_BASED: 'NO', OBJECT_ID: 'NO', INCLUDE_NEW_VALUES: f.include ? 'YES' : 'NO', LAST_PURGE_STATUS: 0, NUM_ROWS_PURGED: 11 }] };
        if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve(result); }); }
        return result;
      }
      if (query.includes("GET_DDL('MATERIALIZED_VIEW_LOG'")) return f.failDdl ? { success: false, error: 'DDL denied' } : { success: true, rows: [{ DDL: `CREATE MATERIALIZED VIEW LOG ON "TEST"."MASTER" STORAGE (INITIAL 65536) WITH PRIMARY KEY${f.rowid ? ', ROWID' : ''}${f.sequence ? ', SEQUENCE' : ''} (${f.filters.map(c => '"' + c + '"').join(', ')}) ${f.include ? 'INCLUDING' : 'EXCLUDING'} NEW VALUES` }] };
      throw new Error('Unexpected metadata query');
    }
    if (channel === 'execute-sql') {
      f.include = query.includes('EXCLUDING') ? false : query.includes('INCLUDING') ? true : f.include;
      if (query.includes('ADD SEQUENCE')) f.sequence = true;
      if (query.includes('DROP MATERIALIZED')) f.missing = true;
      return { success: true };
    }
    throw new Error('Unexpected channel');
  };
  return f;
}
const edit = async (h, values) => { h.state.setFormData(current => ({ ...current, ...values })); await h.flush(); };
const writes = f => f.calls.filter(c => c[0] === 'execute-sql');
test('Log SQL quotes exact column names and parses explicit primary-key filters without system-column guessing', () => {
  const m = logModules(async () => {}), form = { ...m.emptyLogForm('Mixed.Schema', 'Order Table'), filterColumns: ['a,b', 'Order Total', 'Mi"xed'] };
  const sql = m.logSql(form);
  assert.ok(sql.includes('"Mixed.Schema"."Order Table"'));
  assert.ok(sql.includes('("a,b", "Order Total", "Mi""xed")'));
  assert.deepEqual(Array.from(m.logFilterColumns(sql)), form.filterColumns);
  assert.deepEqual(Array.from(m.logFilterColumns('CREATE MATERIALIZED VIEW LOG ON "X" STORAGE (INITIAL 64) WITH PRIMARY KEY ("ID", "SNAPTIME$$") INCLUDING NEW VALUES')), ['ID', 'SNAPTIME$$']);
  assert.deepEqual(Array.from(m.logFilterColumns('CREATE MATERIALIZED VIEW LOG ON "WITH" WITH ROWID INCLUDING NEW VALUES')), []);
  assert.throws(() => m.logFilterColumns('WITH PRIMARY KEY ("ID",)'));
});
test('Log validation protects invalid key, column, SCN, identity and removal settings', () => {
  const m = logModules(async () => {}), form = m.emptyLogForm('TEST', 'MASTER');
  const master = { id: '1', columns: [{ name: 'ID', eligible: true }], primaryKey: true, objectTable: false, hasLob: false };
  assert.equal(m.logValidation(form, master), null);
  assert.equal(m.logValidation(form, { ...master, primaryKey: false }), 'mview_log_pk_required');
  assert.equal(m.logValidation({ ...form, withPrimaryKey: false }, master), 'mview_log_key_required');
  assert.equal(m.logValidation({ ...form, withObjectId: true }, master), 'mview_log_object_required');
  assert.equal(m.logValidation({ ...form, withCommitScn: true }, { ...master, hasLob: true }), 'mview_log_lob_scn');
  assert.equal(m.logValidation({ ...form, filterColumns: ['missing'] }, master), 'mview_log_invalid_columns');
  assert.equal(m.logValidation({ ...form, withCommitScn: true }, master, form), 'mview_log_recreate_required');
  assert.equal(m.logValidation(form, master, { ...form, withSequence: true }), 'mview_log_recreate_required');
  assert.equal(m.logValidation(form, master, { ...form, filterColumns: ['ID'] }), 'mview_log_recreate_required');
  assert.equal(m.logSql(form, form), '');
  assert.match(m.logSql({ ...form, includingNewValues: false }, { ...form, includingNewValues: true }), /EXCLUDING NEW VALUES/);
});
test('Conflict comparison ignores purge counters and deferred storage allocation but protects recording settings and identities', () => {
  const m = logModules(async () => {}), saved = { id: '1', logTable: 'MLOG$_MASTER', source: 'TABLESPACE "USERS"', form: m.emptyLogForm('TEST', 'MASTER'), details: { NUM_ROWS_PURGED: '0' } };
  assert.equal(m.sameLog(saved, { ...saved, details: { NUM_ROWS_PURGED: '10' } }), true);
  assert.equal(m.sameLog(saved, { ...saved, source: 'STORAGE(INITIAL 65536) TABLESPACE "USERS"' }), true);
  assert.equal(m.sameLog(saved, { ...saved, form: { ...saved.form, withRowid: true } }), false);
  assert.equal(m.sameLog(saved, { ...saved, id: '2' }), false);
});
test('Missing metadata and failed native DDL block both writes and deletion; retry preserves draft and saved source', async () => {
  const f = fixture(); f.fail = true; const h = await createMviewLogHarness(f.invoke);
  try {
    assert.equal(h.state.ready, false); await h.state.handleDelete(); await h.state.handleExecute(); assert.equal(writes(f).length, 0);
    f.fail = false; h.state.retry(); await h.flush(); assert.equal(h.state.ready, true);
    assert.deepEqual(Array.from(h.state.formData.filterColumns), ['ID', 'a,b']);
    const source = h.state.metadata.source; await edit(h, { includingNewValues: false });
    f.failDdl = true; h.state.retry(); await h.flush(); assert.equal(h.state.ready, false); assert.equal(h.state.metadata.source, source); assert.equal(h.state.formData.includingNewValues, false);
    f.failDdl = false; h.state.retry(); await h.flush(); assert.equal(h.state.ready, true); assert.equal(h.state.formData.includingNewValues, false);
    f.missing = true; h.state.retry(); await h.flush(); assert.equal(h.state.ready, false); await h.state.handleDelete(); assert.equal(writes(f).length, 0);
  } finally { h.unmount(); }
});
test('No-op sends no IPC; minimal ALTER supports EXCLUDING and reloads the saved native definition', async () => {
  const f = fixture(), h = await createMviewLogHarness(f.invoke);
  try {
    f.calls.length = 0; await h.state.handleExecute(); assert.equal(f.calls.length, 0);
    await edit(h, { includingNewValues: false }); assert.ok(h.state.metadata.source.includes('INCLUDING'));
    await h.state.handleExecute(); await h.flush();
    assert.equal(writes(f).length, 1); assert.equal(writes(f)[0][1], 'ALTER MATERIALIZED VIEW LOG ON "TEST"."MASTER"\nEXCLUDING NEW VALUES');
    assert.ok(h.state.metadata.source.includes('EXCLUDING')); assert.equal(h.state.alterSql, '');
    assert.equal(h.state.metadata.details.NUM_ROWS_PURGED, '11');
  } finally { h.unmount(); }
});
test('Concurrent settings or replacement block mutations, and duplicate execution issues one ALTER', async () => {
  for (const change of [f => { f.id = '8'; }, f => { f.rowid = true; }]) {
    const f = fixture(), h = await createMviewLogHarness(f.invoke);
    try { await edit(h, { withSequence: true }); change(f); await h.state.handleExecute(); await h.flush(); assert.equal(writes(f).length, 0); assert.equal(h.state.error, 'mview_log_conflict'); } finally { h.unmount(); }
  }
  const f = fixture(), h = await createMviewLogHarness(f.invoke);
  try {
    await edit(h, { withSequence: true }); f.hold = true;
    const pending = h.state.handleExecute(); await h.state.handleExecute(); f.release(); await pending; await h.flush(); assert.equal(writes(f).length, 1);
  } finally { h.unmount(); }
});
test('Late metadata cannot replace another table, and table selection clears stale filters', async () => {
  const f = fixture(), h = await createMviewLogHarness(f.invoke);
  try {
    f.hold = true; h.state.retry(); await h.flush(); h.update({ tableName: 'OTHER' }); await h.flush(); f.release(); await h.flush(); assert.equal(h.state.formData.targetTable, 'OTHER');
  } finally { h.unmount(); }
  const n = fixture(); n.missing = true; const fresh = await createMviewLogHarness(n.invoke, { isNew: true, tableName: '' });
  try {
    await fresh.state.openPicker(); await fresh.flush(); assert.equal(fresh.state.pickerOpen, true);
    await edit(fresh, { filterColumns: ['stale'] });
    fresh.state.selectTable([{ schema: 'TEST', name: 'NEW', category: 'TABLE' }]); await fresh.flush();
    assert.deepEqual(Array.from(fresh.state.formData.filterColumns), []); assert.equal(fresh.state.ready, true);
    n.missing = false; await fresh.state.handleExecute(); await fresh.flush(); assert.equal(writes(n).length, 0); assert.equal(fresh.state.error, 'mview_log_exists');
  } finally { fresh.unmount(); }
});
test('Column toggles retain comma names, reject removal, and clipboard rejection is visible', async () => {
  const f = fixture(), h = await createMviewLogHarness(f.invoke, {}, { failCopy: true });
  try {
    h.state.toggleColumn('a,b', false); await h.flush(); assert.ok(h.state.formData.filterColumns.includes('a,b'));
    h.state.toggleColumn('Order Total', true); await h.flush(); assert.ok(h.state.alterSql.includes('("Order Total")'));
    await h.state.handleCopy(h.state.metadata.source); await h.flush(); assert.equal(h.state.error, 'Copy denied'); assert.equal(h.state.isConsoleOpen, true);
  } finally { h.unmount(); }
});
test('Delete confirmation cancellation performs no IPC and a confirmed drop closes the exact tab', async () => {
  for (const confirm of [() => false, () => true]) {
    const f = fixture(), h = await createMviewLogHarness(f.invoke, {}, { confirm });
    try {
      f.calls.length = 0; await h.state.handleDelete(); await h.flush();
      assert.equal(writes(f).length, confirm() ? 1 : 0);
      if (confirm()) { assert.equal(writes(f)[0][1], 'DROP MATERIALIZED VIEW LOG ON "TEST"."MASTER"'); assert.ok(h.events.some(e => e.type === 'close-tab')); }
      else assert.equal(f.calls.length, 0);
    } finally { h.unmount(); }
  }
});
