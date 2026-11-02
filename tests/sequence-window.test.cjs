// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sequenceModules, createSequenceHarness, createSequenceSourceHarness } = require('./helpers/sequenceData.cjs');
const pure = sequenceModules(async () => ({})).model;
function fixture(db) {
  const f = { calls: [], fail: false, version: 'Oracle Database 23ai Free Release 23.0.0.0.0', increment: '1', min: '1', max: '999', cache: '20', cycle: false, observed: '50', start: '1', dataType: 'bigint', hold: false, release: null, owner: null };
  f.row = () => db === 'oracle' ? { INCREMENT_BY: f.increment, LAST_NUMBER: f.observed, MIN_VAL_STR: f.min, MAX_VAL_STR: f.max, CACHE_SIZE: f.cache, CYCLE_FLAG: f.cycle ? 'Y' : 'N', ORDER_FLAG: 'N', KEEP_VALUE: 'N', SESSION_FLAG: 'N' }
    : { increment_by: f.increment, last_value: f.observed, start_value: f.start, min_value: f.min, max_value: f.max, cache_size: f.cache, cycle: f.cycle, data_type: f.dataType };
  f.invoke = async (...args) => {
    f.calls.push(args); const [channel, sql] = args;
    if (channel === 'get-db-info') return { success: true, info: f.version };
    if (channel === 'execute-sql-bg') {
      if (f.fail) return { success: false, error: 'Metadata failed' };
      if (/ALL_DEPENDENCIES/.test(sql)) return { success: true, rows: [{ OWNER: 'test', NAME: 'SEQUENCE_ROWS', TYPE: 'TABLE' }] };
      if (/pg_describe_object/.test(sql)) return { success: true, rows: [{ description: 'default for column id of table test.SEQUENCE_ROWS' }] };
      if (/AS kind/.test(sql)) return { success: true, rows: f.owner ? [f.owner] : [] };
      if (/GET_DDL/.test(sql)) return { success: true, rows: [{ DDL: 'CREATE SEQUENCE "test"."DemoSeq" MINVALUE 1 MAXVALUE 999;' }] };
      const row = f.row();
      if (f.hold) { f.hold = false; return new Promise(resolve => { f.release = () => resolve({ success: true, rows: [row] }); }); }
      return { success: true, rows: [row] };
    }
    if (channel === 'execute-sql') {
      if (/INCREMENT BY ([+-]?\d+)/.test(sql)) f.increment = /INCREMENT BY ([+-]?\d+)/.exec(sql)[1];
      if (/CACHE (\d+)/.test(sql)) f.cache = /CACHE (\d+)/.exec(sql)[1];
      if (/MINVALUE ([+-]?\d+)/.test(sql)) f.min = /MINVALUE ([+-]?\d+)/.exec(sql)[1];
      if (/MAXVALUE ([+-]?\d+)/.test(sql)) f.max = /MAXVALUE ([+-]?\d+)/.exec(sql)[1];
      if (/\nCYCLE/.test(sql)) f.cycle = true;
      if (/NOCYCLE|NO CYCLE/.test(sql)) f.cycle = false;
    }
    return { success: true, rows: [] };
  };
  return f;
}
const writes = f => f.calls.filter(call => call[0] === 'execute-sql');
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: tab activation and failed/retried reads retain settings and an explicit restart candidate`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      h.state.setCacheValue('30'); h.state.setCurrentValue('123'); await h.flush();
      h.update({ isActive: false }); await h.flush(); f.observed = '75'; h.update({ isActive: true }); await h.flush();
      assert.equal(h.state.cacheValue, '30'); assert.equal(h.state.currentValue, '123'); assert.equal(h.state.observedValue, '75');
      f.fail = true; await h.state.loadSequenceInfo(); await h.flush(); assert.equal(h.state.loadError, 'Metadata failed'); assert.equal(h.state.metadataReady, false);
      f.calls.length = 0; await h.state.handleSave(); await h.state.handleRestart(); assert.equal(writes(f).length, 0);
      f.fail = false; await h.state.loadSequenceInfo(); await h.flush(); assert.equal(h.state.cacheValue, '30'); assert.equal(h.state.currentValue, '123'); assert.equal(h.state.metadataReady, true);
    } finally { h.unmount(); }
  });
  test(`${db}: sequence fixture commits late edits before the next save callback`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      await h.waitFor(state => !state.isLoading && state.metadataReady);
      // Complete an edit during the final settle, before the fixture's last render.
      setImmediate(() => setImmediate(() => setImmediate(() => h.state.setCacheValue('30'))));
      await h.flush();
      assert.equal(h.state.cacheValue, '30');
      f.cache = '40'; await h.state.handleSave(); await h.flush();
      assert.ok(h.state.conflict, 'A save must use the latest committed draft');
      assert.deepEqual(Array.from(h.state.conflict.fields), ['cache']);
      assert.equal(writes(f).length, 0);
    } finally { h.unmount(); }
  });
  test(`${db}: delayed reactivation finishes before a reviewed save detects an external edit`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      await h.waitFor(state => !state.isLoading && state.metadataReady);
      h.state.setCacheValue('30'); await h.flush();
      h.update({ isActive: false }); await h.flush();
      f.hold = true; h.update({ isActive: true }); await h.flush();
      assert.equal(h.state.isLoading, true);
      assert.equal(h.state.metadataReady, false);
      f.cache = '40'; await h.state.handleSave(); await h.flush();
      assert.equal(writes(f).length, 0);
      assert.equal(h.state.conflict, null, 'Saving during a metadata read is intentionally ignored');
      f.release();
      await h.waitFor(state => !state.isLoading && (state.metadataReady || state.loadError));
      assert.equal(h.state.metadataReady, true, h.state.loadError);
      assert.equal(h.state.cacheValue, '30');
      await h.state.handleSave(); await h.flush();
      assert.ok(h.state.conflict, 'A save after metadata is ready must detect the external change');
      assert.deepEqual(Array.from(h.state.conflict.fields), ['cache']);
      assert.equal(writes(f).length, 0);
    } finally { h.unmount(); }
  });
  test(`${db}: older responses and edits during loading cannot overwrite the latest values`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      f.hold = true; const first = h.state.loadSequenceInfo(); f.cache = '40'; await h.state.loadSequenceInfo(); await h.flush(); f.release(); await first; await h.flush(); assert.equal(h.state.cacheValue, '40');
      f.hold = true; const pending = h.state.loadSequenceInfo(); h.state.setCacheValue('55'); await h.flush(); f.release(); await pending; await h.flush(); assert.equal(h.state.cacheValue, '55');
    } finally { h.unmount(); }
  });
  test(`${db}: unchanged saves do not issue SQL and unrelated external edits survive a minimal ALTER`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      f.calls.length = 0; await h.state.handleSave(); assert.equal(f.calls.length, 0);
      h.state.setCacheValue('30'); await h.flush(); f.cycle = true; await h.state.handleSave(); await h.flush();
      assert.equal(writes(f).length, 1); assert.ok(writes(f)[0][1].endsWith('CACHE 30')); assert.ok(!/CYCLE|MINVALUE|MAXVALUE/.test(writes(f)[0][1])); assert.equal(f.cycle, true);
    } finally { h.unmount(); }
  });
  test(`${db}: an already applied external value becomes the baseline without another ALTER`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      h.state.setCacheValue('30'); await h.flush(); f.cache = '30'; await h.state.handleSave(); await h.flush();
      assert.equal(writes(f).length, 0); assert.equal(h.state.conflict, null);
      f.calls.length = 0; await h.state.handleSave(); assert.equal(f.calls.length, 0);
    } finally { h.unmount(); }
  });
  test(`${db}: clipboard rejection is reported without discarding valid source`, async () => {
    const f = fixture(db), h = await createSequenceSourceHarness(db, f.invoke, {}, { writeText: async () => { throw new Error('Clipboard denied'); } });
    try {
      const source = h.render().sourceText; await h.render().copySource();
      assert.ok(h.alerts.some(message => message.includes('sequence_copy_failed')));
      assert.equal(h.render().sourceText, source); assert.equal(h.render().sourceReady, true);
    } finally { h.unmount(); }
  });
  test(`${db}: a conflicting external edit requires explicit review before applying the local value`, async () => {
    const f = fixture(db), h = await createSequenceHarness(db, f.invoke);
    try {
      h.state.setCacheValue('30'); await h.flush(); f.cache = '40'; await h.state.handleSave(); await h.flush();
      assert.equal(writes(f).length, 0); assert.deepEqual(Array.from(h.state.conflict.fields), ['cache']);
      h.state.keepLocalChanges(); await h.flush(); await h.state.handleSave(); await h.flush(); assert.equal(writes(f).length, 1); assert.equal(f.cache, '30');
    } finally { h.unmount(); }
  });
  test(`${db}: descending and non-unit increments change only the restart candidate until explicit restart`, async () => {
    const f = fixture(db); f.increment = '-10'; f.min = '-999'; f.max = '-1'; f.observed = '-50'; f.start = '-1';
    const h = await createSequenceHarness(db, f.invoke);
    try {
      h.state.handleIncrementCurrentValue(); h.state.handleIncrementCurrentValue(); await h.flush(); assert.equal(h.state.currentValue, '-70'); assert.equal(writes(f).length, 0);
      h.state.setCurrentValue('-123'); await h.flush(); await h.state.handleRestart(); assert.ok(writes(f)[0][1].endsWith('WITH -123'));
    } finally { h.unmount(); }
  });
  test(`${db}: null reference values remain unknown and out-of-range restart values issue no DDL`, async () => {
    const f = fixture(db); f.observed = null;
    const h = await createSequenceHarness(db, f.invoke);
    try {
      assert.equal(h.state.observedValue, null); h.state.setCurrentValue('1000'); await h.flush(); await h.state.handleRestart(); await h.flush();
      assert.equal(writes(f).length, 0); assert.equal(h.state.fieldErrors.currentValue, 'sequence_start_out_of_bounds');
    } finally { h.unmount(); }
  });
  test(`${db}: stale source is retained on failure but copying is blocked until recovery`, async () => {
    const f = fixture(db), copied = [];
    const h = await createSequenceSourceHarness(db, f.invoke, {}, { writeText: async source => copied.push(source) });
    try {
      const source = h.render().sourceText; assert.equal(h.render().sourceReady, true);
      f.fail = true; await h.render().loadSource(); await h.flush(); assert.equal(h.render().sourceText, source); assert.equal(h.render().sourceReady, false);
      await h.render().copySource(); assert.equal(copied.length, 0);
      f.fail = false; await h.render().loadSource(); await h.flush(); await h.render().copySource(); assert.equal(copied[0], source);
    } finally { h.unmount(); }
  });
}
test('Oracle 12 and an unverifiable version disable restart while preserving ordinary settings saves', async () => {
  for (const version of ['Oracle Database 12c Enterprise Edition Release 12.2.0.1.0', 'Unknown version']) {
    const f = fixture('oracle'); f.version = version; const h = await createSequenceHarness('oracle', f.invoke);
    try {
      assert.notEqual(h.state.restartSupport, 'supported'); h.state.setCurrentValue('100'); h.state.setCacheValue('30'); await h.flush();
      await h.state.handleRestart(); assert.equal(writes(f).length, 0); await h.state.handleSave(); assert.equal(writes(f).length, 1); assert.ok(!writes(f)[0][1].includes('RESTART'));
    } finally { h.unmount(); }
  }
});
test('Validation resolves defaults, start bounds, type bounds, Oracle increment and cycle cache constraints exactly', () => {
  const settings = { increment: '1', min: '1', max: '100', cache: '20', cycle: false, order: false, keep: false, session: false, dataType: 'NUMBER' };
  assert.throws(() => pure.validateSequence('oracle', { ...settings, max: '1' }));
  assert.throws(() => pure.validateSequence('oracle', { ...settings, increment: '99' }));
  assert.throws(() => pure.validateSequence('oracle', { ...settings, cycle: true, cache: '99' }));
  assert.throws(() => pure.validateSequence('oracle', settings, { value: '101', field: 'startWith' }));
  assert.throws(() => pure.validateSequence('postgresql', { ...settings, dataType: 'smallint', max: '32768' }));
  assert.doesNotThrow(() => pure.validateSequence('postgresql', { ...settings, dataType: 'integer', increment: '-10', min: '-2147483648', max: '-1' }));
});
for (const dataType of ['smallint', 'integer', 'bigint']) {
  test(`PostgreSQL source preserves ${dataType}, exact bounds and quoted ownership without issuing numbers`, async () => {
    const f = fixture('postgresql'); f.dataType = dataType; f.owner = { schema: "Team's Data", table: 'Order"Rows', column: 'Id Key', kind: 'a' };
    const { metadata } = sequenceModules(f.invoke); const source = await metadata.readSequenceSource('postgresql', 'test', 'DemoSeq');
    assert.ok(source.includes(`AS ${dataType}`)); assert.ok(source.includes('MINVALUE 1\nMAXVALUE 999'));
    assert.ok(source.includes('OWNED BY "Team\'s Data"."Order""Rows"."Id Key";'));
    assert.equal(writes(f).length, 0); assert.ok(f.calls.every(call => !/nextval|setval/i.test(call[1] || '')));
  });
}
