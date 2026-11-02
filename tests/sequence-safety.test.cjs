// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSequenceHarness } = require('./helpers/sequenceData.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { sequenceInteger, sequenceDefaults } = loadTypeScript('src/features/sequence/sequenceValues.ts');

function metadata(db, overrides = {}) {
  return db === 'oracle' ? { INCREMENT_BY: '1', LAST_NUMBER: '9007199254740993', MAX_VAL_STR: '9000000000000000000000000000', MIN_VAL_STR: '1',
    CACHE_SIZE: 20, CYCLE_FLAG: 'N', ORDER_FLAG: 'N', KEEP_VALUE: 'N', SESSION_FLAG: 'N', ...overrides } : {
    increment_by: '1', last_value: '9007199254740993', start_value: '1', max_value: '8000000000000000000', min_value: '1',
    cache_size: '20', cycle: false, data_type: 'bigint', ...overrides };
}
async function setup(db, { row, respond, props, confirm } = {}) {
  const calls = []; let reloads = 0;
  const h = await createSequenceHarness(db, async (...args) => {
    calls.push(args);
    if (args[0] === 'get-db-info') return { success: true, info: 'Oracle Database 23ai Free Release 23.0.0.0.0' };
    if (respond) { const result = await respond(...args); if (result) return result; }
    return { success: true, rows: args[0] === 'execute-sql-bg' ? [row || metadata(db)] : [] };
  }, { schema: "Team's Data", sequenceName: 'Seq"Mixed', onReload: () => { reloads++; }, ...props }, { confirm });
  return { ...h, get state() { return h.state; }, calls, get reloads() { return reloads; } };
}
const writes = h => h.calls.filter(call => call[0] === 'execute-sql');
test('Sequence integers reject rounding, fractional values and SQL fragments', () => {
  assert.equal(sequenceInteger('9007199254740993'), '9007199254740993');
  assert.equal(sequenceInteger('-00042'), '-42'); assert.equal(sequenceInteger(0), '0');
  for (const value of [9007199254740992, '1.5', '1e3', 'NaN', '1; DROP SEQUENCE s', null, undefined, '']) assert.throws(() => sequenceInteger(value));
});
test('Sequence defaults follow direction and database integer limits exactly', () => {
  assert.equal(sequenceDefaults('oracle', '1').max, '9999999999999999999999999999');
  assert.equal(sequenceDefaults('oracle', '-1').min, '-999999999999999999999999999');
  assert.equal(sequenceDefaults('oracle', '-1').max, '-1');
  assert.equal(sequenceDefaults('postgresql', '-1', 'smallint').min, '-32768');
  assert.equal(sequenceDefaults('postgresql', '1', 'integer').max, '2147483647');
  assert.equal(sequenceDefaults('postgresql', '1', 'bigint').max, '9223372036854775807');
  assert.equal(sequenceDefaults('postgresql', '1', 'unknown'), undefined);
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: ordinary save alters the same sequence without dropping or restarting it`, async () => {
    const h = await setup(db);
    try {
      assert.equal(h.state.hasMaxValue, true);
      h.state.setCacheValue('30'); await h.flush(); h.calls.length = 0;
      await h.state.handleSave();
      assert.equal(writes(h).length, 1); assert.equal(h.calls[0][0], 'execute-sql-bg');
      assert.match(writes(h)[0][1], /^ALTER SEQUENCE "Team's Data"\."Seq""Mixed"/);
      assert.match(writes(h)[0][1], /CACHE 30/);
      assert.ok(!/MAXVALUE|MINVALUE/.test(writes(h)[0][1]), 'Unchanged bounds must be omitted');
      assert.ok(!/DROP|CREATE|RESTART|START WITH/.test(writes(h)[0][1])); assert.equal(h.reloads, 1);
    } finally { h.unmount(); }
  });
  test(`${db}: failed settings changes never drop or recreate the sequence`, async () => {
    const h = await setup(db, { respond: channel => channel === 'execute-sql' ? { success: false, error: 'ORA-00922: simulated unsupported option' } : undefined });
    try {
      h.state.setIsCycle(true); await h.flush(); h.calls.length = 0; await h.state.handleSave();
      assert.equal(writes(h).length, 1); assert.match(writes(h)[0][1], /^ALTER SEQUENCE/);
      assert.equal(h.reloads, 0); assert.equal(h.alerts.length, 1); assert.match(h.alerts[0], /simulated unsupported option/);
    } finally { h.unmount(); }
  });
  test(`${db}: large restart targets increment exactly under repeated clicks and double updater evaluation`, async () => {
    const h = await setup(db);
    try {
      assert.equal(h.state.currentValue, '9007199254740993');
      h.state.handleIncrementCurrentValue(); h.state.handleIncrementCurrentValue(); await h.flush();
      assert.equal(h.state.currentValue, '9007199254740995'); assert.equal(h.state.restartPending, true);
      h.calls.length = 0; await h.state.handleSave();
      assert.equal(writes(h).length, 0);
      h.calls.length = 0; await h.state.handleRestart(); await h.flush();
      assert.equal(writes(h).length, 1);
      assert.match(writes(h)[0][1], db === 'oracle' ? /RESTART START WITH 9007199254740995$/ : /RESTART WITH 9007199254740995$/);
      assert.equal(h.state.restartPending, false); assert.equal(h.reloads, 1);
    } finally { h.unmount(); }
  });
  test(`${db}: cancelled or unsupported restart issues no destructive fallback`, async () => {
    for (const confirmed of [false, true]) {
      const h = await setup(db, { confirm: () => confirmed, respond: channel => channel === 'execute-sql' ? { success: false, error: 'Unsupported restart' } : undefined });
      try {
        h.state.handleIncrementCurrentValue(); await h.flush(); h.calls.length = 0;
        await h.state.handleRestart(); await h.flush();
        assert.equal(writes(h).length, confirmed ? 1 : 0);
        if (confirmed) assert.match(writes(h)[0][1], /^ALTER SEQUENCE/);
        assert.equal(h.reloads, 0); assert.equal(h.state.restartPending, true);
      } finally { h.unmount(); }
    }
  });
  test(`${db}: invalid settings are rejected before any database mutation`, async () => {
    const h = await setup(db);
    try {
      for (const increment of ['0', '1.2', '1; DROP SEQUENCE s']) {
        h.state.setIncrementBy(increment); await h.flush(); h.calls.length = 0;
        await h.state.handleSave(); assert.equal(h.calls.length, 0);
      }
      h.state.setIncrementBy('1'); h.state.setHasMinValue(true); h.state.setMinValue(h.state.maxValue); await h.flush();
      await h.state.handleSave(); assert.equal(h.calls.length, 0);
    } finally { h.unmount(); }
  });
  test(`${db}: failed metadata cannot authorize changing an existing sequence`, async () => {
    const h = await setup(db, { respond: () => ({ success: false, error: 'Metadata failed' }) });
    try {
      h.calls.length = 0; await h.state.handleSave(); h.state.handleIncrementCurrentValue(); await h.flush(); await h.state.handleRestart();
      assert.equal(h.calls.length, 0); assert.equal(h.state.restartPending, false);
      assert.ok(h.alerts.includes('sequence_metadata_unavailable'));
    } finally { h.unmount(); }
  });
  test(`${db}: metadata preserves zero rather than replacing it with the start value`, async () => {
    const h = await setup(db, { row: metadata(db, db === 'oracle' ? { LAST_NUMBER: 0 } : { last_value: '0', start_value: '100' }) });
    try { assert.equal(h.state.currentValue, '0'); h.state.handleIncrementCurrentValue(); await h.flush(); assert.equal(h.state.currentValue, '1'); }
    finally { h.unmount(); }
  });
  test(`${db}: creating a new sequence still uses CREATE and the requested starting value`, async () => {
    const h = await setup(db, { props: { isNew: true, sequenceName: '' } });
    try {
      h.state.setSeqName('items_seq'); h.state.setStartWith('9007199254740993'); await h.flush();
      await h.state.handleSave(); assert.equal(writes(h).length, 1);
      assert.match(writes(h)[0][1], /^CREATE SEQUENCE/); assert.match(writes(h)[0][1], /START WITH 9007199254740993/);
      assert.ok(!writes(h)[0][1].includes('DROP'));
    } finally { h.unmount(); }
  });
}
test('Oracle custom negative limits remain exact instead of being treated as defaults', async () => {
  const h = await setup('oracle', { row: metadata('oracle', { INCREMENT_BY: '-1', LAST_NUMBER: '-9007199254740993', MAX_VAL_STR: '-1', MIN_VAL_STR: '-900000000000000000000000000' }) });
  try {
    assert.equal(h.state.hasMaxValue, false); assert.equal(h.state.hasMinValue, true);
    assert.equal(h.state.minValue, '-900000000000000000000000000');
    h.calls.length = 0; await h.state.handleSave(); assert.equal(writes(h).length, 0); assert.equal(h.state.minValue, '-900000000000000000000000000');
  } finally { h.unmount(); }
});
