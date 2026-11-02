// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createGeneratorHarness, seededRandom, createSeededRandExp } = require('./helpers/dataGenerator.cjs');

async function fixture(db, respond, options = {}) {
  const schema = 'Mi"x.ed', table = 'Order".items', columns = ['A"code', 'B.value'];
  const definitions = options.columnDefs || columns.map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' }));
  const writes = [];
  const h = await createGeneratorHarness(db, async (channel, query) => {
    if (channel === 'load-settings') return {};
    if (channel === 'execute-sql') { writes.push(query); return respond(writes.length, query); }
    assert.equal(channel, 'execute-sql-bg');
    if (/ALL_USERS|information_schema.schemata/.test(query)) return { success: true, rows: [{ USERNAME: schema }] };
    if (/SELECT USER FROM DUAL/.test(query)) return { success: true, rows: [{ USER: schema }] };
    if (/ALL_TAB_COLUMNS|information_schema.columns|PG_TYPE_SCHEMA/.test(query)) return { success: true,
      rows: definitions };
    if (/ALL_OBJECTS|information_schema.tables/.test(query)) return { success: true, rows: [table, 'Other'].map(OBJECT_NAME => ({ OBJECT_NAME })) };
    return { success: true, rows: [] };
  }, { schema, ...options });
  await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
  assert.ok(!h.requests.some(([channel, query]) => channel === 'execute-sql-bg' &&
    (/SELECT OBJECT_NAME FROM ALL_OBJECTS/.test(query) || /table_type = 'BASE TABLE'/.test(query))), 'Initialization must not retrieve an unpaged table list');
  h.state.setSelectedTable(table);
  await h.waitFor(state => !state.isLoading && state.columnRules.length === definitions.length);
  for (let index = 0; index < definitions.length; index++) {
    if (h.state.columnRules[index].ruleType === 'DISABLED') continue;
    h.state.handleRuleChange(index, 'ruleType', 'FIXED');
    h.state.handleRuleChange(index, 'fixedValue', index ? "beta's" : 'alpha');
  }
  h.state.setGenerateCount(2); await h.flush();
  return Object.assign(h, { writes });
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: oversized regex values are rejected without truncation or INSERT even with uniqueness disabled`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); }, {
      columnDefs: [{ COLUMN_NAME: 'CODE', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'character varying', DATA_LENGTH: 1, NULLABLE: 'Y' }],
      RandExp: class { gen() { return 'A1'; } }
    });
    try {
      h.state.handleRuleChange(0, 'ruleType', 'RANDOM_CHAR');
      h.state.handleRuleChange(0, 'randCharType', 'REGEX');
      h.state.handleRuleChange(0, 'randCharRegex', 'A[0-9]');
      for (const unique of [false, true]) {
        h.state.handleRuleChange(0, 'randCharUnique', unique);
        await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.equal(h.writes.length, 0);
        assert.match(h.alerts.at(-1), /CODE.*2 characters.*limit of 1/);
        assert.match(h.alerts.at(-1), /value was not truncated/);
        assert.equal(h.state.columnRules[0].randCharUnique, unique);
      }
    } finally { h.unmount(); }
  });
  test(`${db}: valid regex values retain their full content and uniqueness retries duplicates`, async () => {
    const candidates = ['A1', 'A1', 'A2'];
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), {
      columnDefs: [{ COLUMN_NAME: 'CODE', DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'character varying', DATA_LENGTH: 2, NULLABLE: 'Y' }],
      RandExp: class { gen() { assert.ok(candidates.length); return candidates.shift(); } }
    });
    try {
      for (const [key, value] of Object.entries({ ruleType: 'RANDOM_CHAR', randCharType: 'REGEX', randCharRegex: 'A[0-9]', randCharUnique: true })) {
        h.state.handleRuleChange(0, key, value);
      }
      await h.flush(); await h.state.handleGenerate(); await h.flush();
      assert.equal(candidates.length, 0);
      assert.equal(h.writes.length, 1);
      assert.equal((h.writes[0].match(/'A1'/g) || []).length, 1);
      assert.equal((h.writes[0].match(/'A2'/g) || []).length, 1);
      assert.match(h.alerts.at(-1), /^2 row generation and insertion completed/);
    } finally { h.unmount(); }
  });
  test(`${db}: numeric fixed values, choices and prefixes are validated before the first batch`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); }, {
      columnDefs: [{ COLUMN_NAME: 'N', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'numeric', NULLABLE: 'Y' }]
    });
    try {
      h.state.setGenerateCount(1001);
      for (const value of ['1+2', '(SELECT 3)', 'NaN', 'Infinity', '', "1); DELETE FROM demo;--"]) {
        h.state.handleRuleChange(0, 'fixedValue', value); await h.flush(); await h.state.handleGenerate();
      }
      h.state.handleRuleChange(0, 'ruleType', 'CHOICE');
      h.state.handleRuleChange(0, 'choiceValues', '1, 2, 3+4');
      await h.flush(); await h.state.handleGenerate();
      h.state.handleRuleChange(0, 'ruleType', 'SEQ_NUM'); h.state.handleRuleChange(0, 'seqPrefix', 'SQL');
      await h.flush(); await h.state.handleGenerate();
      assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 8);
      assert.ok(h.alerts.every(message => message.includes('N')));
    } finally { h.unmount(); }
  });
  test(`${db}: finite numeric literal values preserve digits and never become quoted expressions`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), {
      columnDefs: [{ COLUMN_NAME: 'N', DATA_TYPE: db === 'oracle' ? 'NUMBER' : 'numeric', NULLABLE: 'Y' }]
    });
    try {
      for (const value of ['9007199254740993', '-0.1234567890123456789', '1e-20']) {
        h.state.handleRuleChange(0, 'fixedValue', value); await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.ok(h.writes.at(-1).includes(value)); assert.ok(!h.writes.at(-1).includes("'" + value + "'"));
      }
    } finally { h.unmount(); }
  });
  test(`${db}: exact date and timestamp literals select a type-correct conversion and reject malformed data`, async () => {
    for (const [type, value, expected] of db === 'oracle' ? [
      ['DATE', '2026-10-24 12:34:56', 'TO_DATE('],
      ['TIMESTAMP(9)', '2026-10-24 12:34:56.123456789', 'TO_TIMESTAMP('],
      ['TIMESTAMP(9) WITH TIME ZONE', '2026-10-24 12:34:56.123456789 +05:45', 'TO_TIMESTAMP_TZ('],
      ['TIMESTAMP(9) WITH LOCAL TIME ZONE', '2026-10-24 12:34:56.123456789 +05:45', 'TO_TIMESTAMP_TZ(']
    ] : [
      ['date', '2026-10-24', ' AS date)'],
      ['timestamp(6) without time zone', '2026-10-24 12:34:56.123456', ' AS timestamp without time zone)'],
      ['timestamp(6) with time zone', '2026-10-24 12:34:56.123456 +05:45', ' AS timestamp with time zone)']
    ]) {
      const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), {
        columnDefs: [{ COLUMN_NAME: 'STAMP', DATA_TYPE: type, NULLABLE: 'Y' }]
      });
      try {
        h.state.handleRuleChange(0, 'fixedValue', value); await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.equal(h.writes.length, 1); assert.ok(h.writes[0].includes(expected));
        assert.ok(h.writes[0].includes(value));
        for (const invalid of ["2026-10-24'); DELETE FROM demo;--", '2026-02-30 12:00:00']) {
          h.state.handleRuleChange(0, 'fixedValue', invalid); await h.flush(); await h.state.handleGenerate();
        }
        assert.equal(h.writes.length, 1);
      } finally { h.unmount(); }
    }
  });
}
test('postgresql: type catalog identity excludes points, intervals, arrays and misleading custom type names', async () => {
  const defs = [
    { COLUMN_NAME: 'LOCATION', DATA_TYPE: 'point' }, { COLUMN_NAME: 'SPAN', DATA_TYPE: 'interval' },
    { COLUMN_NAME: 'IDS', DATA_TYPE: 'integer[]', PG_TYPE_CATEGORY: 'A' },
    { COLUMN_NAME: 'STATUS', DATA_TYPE: 'integer', PG_TYPE_SCHEMA: 'custom', PG_TYPE_KIND: 'd' },
    { COLUMN_NAME: 'CLOCK', DATA_TYPE: 'time(6) without time zone' }
  ].map(column => ({ ...column, NULLABLE: 'Y' }));
  const h = await fixture('postgresql', () => ({ success: true, rowsAffected: 2 }), { columnDefs: defs });
  try {
    assert.deepEqual(Array.from(h.state.columnRules.slice(0, 4), rule => rule.ruleType), Array(4).fill('DISABLED'));
    h.state.handleRuleChange(4, 'ruleType', 'RANDOM_DATE'); await h.flush(); await h.state.handleGenerate();
    assert.equal(h.writes.length, 1); assert.ok(!h.writes[0].includes('"LOCATION"'));
    assert.ok(h.writes[0].includes(' AS time without time zone)'));
    assert.ok(!h.writes[0].includes('2020'));
  } finally { h.unmount(); }
});
test('postgresql: TIME and TIMETZ generate clock-only values and preserve fixed fractional seconds and offsets', async () => {
  const h = await fixture('postgresql', () => ({ success: true, rowsAffected: 2 }), {
    columnDefs: [{ COLUMN_NAME: 'CLOCK', DATA_TYPE: 'time(6) without time zone', NULLABLE: 'Y' },
      { COLUMN_NAME: 'ZONE', DATA_TYPE: 'time(6) with time zone', NULLABLE: 'Y' }]
  });
  try {
    for (let index = 0; index < 2; index++) h.state.handleRuleChange(index, 'ruleType', 'RANDOM_DATE');
    await h.flush(); await h.state.handleGenerate(); await h.flush();
    assert.ok(h.writes[0].includes(' AS time without time zone)'));
    assert.ok(h.writes[0].includes('+00:00')); assert.ok(!h.writes[0].includes('2020/'));
    h.state.handleRuleChange(0, 'ruleType', 'FIXED'); h.state.handleRuleChange(0, 'fixedValue', '12:34:56.123456');
    h.state.handleRuleChange(1, 'ruleType', 'FIXED'); h.state.handleRuleChange(1, 'fixedValue', '12:34:56.123456+05:45');
    await h.flush(); await h.state.handleGenerate();
    assert.ok(h.writes[1].includes('12:34:56.123456+05:45')); assert.ok(h.writes[1].includes('12:34:56.123456'));
  } finally { h.unmount(); }
});
test('postgresql: invalid time choices, date-bearing values and inverted time ranges stop before SQL', async () => {
  const h = await fixture('postgresql', () => { throw new Error('Unexpected INSERT'); }, {
    columnDefs: [{ COLUMN_NAME: 'CLOCK', DATA_TYPE: 'time without time zone', NULLABLE: 'Y' }]
  });
  try {
    for (const value of ['2026-10-24 12:00:00', "12:00:00'); SELECT 1;--", '25:00:00', '12:00:00+05:45']) {
      h.state.handleRuleChange(0, 'fixedValue', value); await h.flush(); await h.state.handleGenerate();
    }
    h.state.handleRuleChange(0, 'ruleType', 'CHOICE'); h.state.handleRuleChange(0, 'choiceValues', '12:00:00,not-a-time');
    await h.flush(); await h.state.handleGenerate();
    h.state.handleRuleChange(0, 'ruleType', 'RANDOM_DATE');
    h.state.handleRuleChange(0, 'randDateMin', '23:00:00'); h.state.handleRuleChange(0, 'randDateMax', '01:00:00');
    await h.flush(); await h.state.handleGenerate(); assert.equal(h.writes.length, 0);
  } finally { h.unmount(); }
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: generated INSERTs quote exact schema, table and column names`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }));
    try {
      await h.state.handleGenerate();
      assert.equal(h.writes.length, 1);
      assert.ok(h.writes[0].includes('"Mi""x.ed"."Order"".items"'));
      assert.ok(h.writes[0].includes('"A""code", "B.value"'));
      assert.ok(h.writes[0].includes("'beta''s'"));
      assert.match(h.alerts[0], /^2 row generation and insertion completed/);
    } finally { h.unmount(); }
  });
  test(`${db}: zero, partial and invalid generation counts stop without claiming completion`, async () => {
    for (const rowsAffected of [0, 1, undefined, -1, 3, NaN, 0.5]) {
      const h = await fixture(db, () => ({ success: true, rowsAffected }));
      try {
        await h.state.handleGenerate(); await h.flush();
        assert.equal(h.writes.length, 1); assert.equal(h.alerts.length, 1);
        assert.match(h.alerts[0], /Data generation stopped/);
        assert.ok(h.alerts[0].includes(`Confirmed inserted rows: ${rowsAffected === 1 ? 1 : 0}.`));
        assert.match(h.alerts[0], /No automatic commit or rollback/);
        assert.equal(h.state.isLoading, false); assert.equal(h.state.columnRules[0].fixedValue, 'alpha');
      } finally { h.unmount(); }
    }
  });
  test(`${db}: a later generation failure stops before the next batch and retains confirmed rows`, async () => {
    for (const failure of ['partial', 'unknown', 'failed', 'rejected']) {
      const h = await fixture(db, index => {
        if (index === 1) return { success: true, rowsAffected: 500 };
        if (failure === 'rejected') throw new Error('Simulated IPC failure');
        return failure === 'failed' ? { success: false, error: 'Simulated SQL failure' } :
          { success: true, rowsAffected: failure === 'partial' ? 1 : undefined };
      });
      try {
        h.state.setGenerateCount(1001); await h.flush(); await h.state.handleGenerate();
        assert.equal(h.writes.length, 2);
        assert.ok(h.alerts[0].includes(`Confirmed inserted rows: ${failure === 'partial' ? 501 : 500}.`));
        assert.ok(h.requests.every(([channel]) => !['commit-db', 'rollback-db'].includes(channel)));
      } finally { h.unmount(); }
    }
  });
  test(`${db}: successful generation confirms every complete and final batch`, async () => {
    const h = await fixture(db, index => ({ success: true, rowsAffected: index === 1 ? 500 : 1 }));
    try {
      h.state.setGenerateCount(501); await h.flush(); await h.state.handleGenerate(); await h.flush();
      assert.equal(h.writes.length, 2); assert.equal(h.alerts.length, 1);
      assert.match(h.alerts[0], /^501 row generation and insertion completed/);
      assert.equal(h.state.isLoading, false); assert.equal(h.state.progressMsg, '');
    } finally { h.unmount(); }
  });
  test(`${db}: failed generation retains rules and permits an explicit retry`, async () => {
    let success = false;
    const h = await fixture(db, () => ({ success: true, rowsAffected: success ? 2 : 0 }));
    try {
      await h.state.handleGenerate(); await h.flush();
      assert.equal(h.state.selectedTable, 'Order".items'); assert.equal(h.state.generateCount, 2);
      assert.equal(h.state.columnRules[1].fixedValue, "beta's");
      success = true; await h.state.handleGenerate();
      assert.equal(h.writes.length, 2); assert.match(h.alerts[1], /^2 row generation and insertion completed/);
    } finally { h.unmount(); }
  });
}
test('postgresql: NULL-ratio values use explicit NULL without replacing them with defaults', async () => {
  const h = await fixture('postgresql', () => ({ success: true, rowsAffected: 2 }), { randomValues: [0.9, 0.1, 0.1, 0.9] });
  try {
    h.state.handleRuleChange(0, 'nullRatio', 50); h.state.handleRuleChange(1, 'nullRatio', 50);
    await h.flush(); await h.state.handleGenerate();
    assert.match(h.writes[0], /\('alpha', NULL\),\n\(NULL, 'beta''s'\)/);
  } finally { h.unmount(); }
});

function selectSettings(h) {
  h.state.handleImportSettings();
  h.inputs.at(-1).onchange();
  return h.readers.at(-1);
}
function settings(h, values = {}) {
  return { schema: h.state.selectedSchema, table: h.state.selectedTable, generateCount: 2,
    rules: [{ COLUMN_NAME: 'A"code', ruleType: 'FIXED', fixedValue: 'loaded' }], ...values };
}
function finishSettings(reader, payload) { reader.onload({ target: { result: JSON.stringify(payload) } }); }
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: string numeric inputs generate exact large and fractional sequence values`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }));
    try {
      h.state.handleRuleChange(0, 'ruleType', 'SEQ_NUM');
      for (const [start, step, expected] of [
        ['9007199254740993', '1', ['9007199254740993', '9007199254740994']],
        ['0.1', '0.2', ['0.1', '0.3']],
        ['1e-20', '-2e-20', ['0.00000000000000000001', '-0.00000000000000000001']]
      ]) {
        h.state.handleRuleChange(0, 'seqStart', start); h.state.handleRuleChange(0, 'seqStep', step);
        await h.flush(); await h.state.handleGenerate(); await h.flush();
        for (const value of expected) assert.ok(h.writes.at(-1).includes("'" + value + "'"));
      }
    } finally { h.unmount(); }
  });
  test(`${db}: unsafe numeric JSON values and sequence overflow are rejected before any INSERT`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); });
    try {
      h.state.handleRuleChange(0, 'ruleType', 'SEQ_NUM');
      for (const value of [Number('9007199254740993'), Infinity, NaN, '1e101', '']) {
        h.state.handleRuleChange(0, 'seqStart', value); await h.flush(); await h.state.handleGenerate();
      }
      h.state.handleRuleChange(0, 'seqStart', '9'.repeat(100));
      h.state.handleRuleChange(0, 'seqStep', '1');
      await h.flush(); await h.state.handleGenerate();
      assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 6);
    } finally { h.unmount(); }
  });
  test(`${db}: invalid row counts retain the input and never execute SQL`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); });
    try {
      for (const count of [0, -1, 1.5, '', '1.00000000000000000001', '1e309', NaN, Infinity]) {
        h.state.setGenerateCount(count); await h.flush(); await h.state.handleGenerate(); await h.flush();
        assert.ok(Object.is(h.state.generateCount, count));
      }
      assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 8);
      assert.ok(h.alerts.every(message => message.includes('positive integer')));
    } finally { h.unmount(); }
  });
  test(`${db}: invalid dates, empty choices and malformed patterns stop before any INSERT`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); });
    try {
      for (const [type, field, value] of [
        ['SEQ_DATE', 'seqStartDate', 'not-a-date'],
        ['RANDOM_DATE', 'randDateMin', '2040/01/01'],
        ['CHOICE', 'choiceValues', ' , '],
        ['RANDOM_CHAR', 'randCharRegex', '[']
      ]) {
        h.state.handleRuleChange(0, 'ruleType', type); h.state.handleRuleChange(0, field, value);
        if (type === 'RANDOM_CHAR') h.state.handleRuleChange(0, 'randCharType', 'REGEX');
        await h.flush(); await h.state.handleGenerate();
      }
      h.state.handleRuleChange(0, 'ruleType', 'SEQ_DATE'); h.state.handleRuleChange(0, 'seqStartDate', '2026/01/01');
      h.state.setGenerateCount(Number.MAX_SAFE_INTEGER); await h.flush(); await h.state.handleGenerate();
      assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 5);
    } finally { h.unmount(); }
  });
  test(`${db}: random decimals remain exact and invalid ranges are rejected before SQL`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), { randomValues: [0.9, 0.9] });
    try {
      h.state.handleRuleChange(0, 'ruleType', 'RANDOM_NUM');
      h.state.handleRuleChange(0, 'randNumMin', '0.1'); h.state.handleRuleChange(0, 'randNumMax', '0.3');
      h.state.handleRuleChange(0, 'randNumRound', '0.1');
      await h.flush(); await h.state.handleGenerate(); await h.flush();
      assert.equal(h.writes[0].match(/'0.3'/g).length, 2);
      for (const unit of ['0', '-1', '', '1e-100']) {
        h.state.handleRuleChange(0, 'randNumRound', unit); await h.flush(); await h.state.handleGenerate();
      }
      h.state.handleRuleChange(0, 'randNumRound', '0.1'); h.state.handleRuleChange(0, 'randNumMin', '1');
      await h.flush(); await h.state.handleGenerate(); assert.equal(h.writes.length, 1);
    } finally { h.unmount(); }
  });
  test(`${db}: invalid settings files preserve every rule and the row count atomically`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); });
    try {
      for (const overrides of [
        { generateCount: 1.5 },
        { rules: [{ COLUMN_NAME: 'A"code', fixedValue: 'changed' }, { COLUMN_NAME: 'B.value', ruleType: 'RANDOM_NUM', randNumRound: 0 }] },
        { rules: [{ COLUMN_NAME: 'A"code', nullRatio: '20' }] },
        { rules: [{ COLUMN_NAME: 'A"code', ruleType: 'unknown' }] },
        { rules: [{ COLUMN_NAME: 'A"code' }, { COLUMN_NAME: 'A"code' }] },
        { rules: [{ COLUMN_NAME: 'missing' }] },
        { rules: [{ COLUMN_NAME: 'A"code', seqStart: Number('9007199254740993') }] }
      ]) {
        const reader = selectSettings(h); finishSettings(reader, settings(h, overrides)); await h.flush();
        assert.equal(h.state.columnRules[0].fixedValue, 'alpha');
        assert.equal(h.state.columnRules[1].fixedValue, "beta's"); assert.equal(h.state.generateCount, 2);
      }
      assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 7);
    } finally { h.unmount(); }
  });
  test(`${db}: valid legacy and string settings preserve database metadata and retry after read failure`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }));
    try {
      selectSettings(h).onerror(); await h.flush(); assert.equal(h.state.columnRules[0].fixedValue, 'alpha');
      const payload = settings(h, { generateCount: '2', rules: [{ COLUMN_NAME: 'A"code', ruleType: 'SEQ_NUM',
        seqStart: '9007199254740993', seqStep: 1, DATA_TYPE: 'wrong', NULLABLE: 'N' }] });
      finishSettings(selectSettings(h), payload); await h.flush();
      assert.equal(h.state.columnRules[0].seqStart, '9007199254740993');
      assert.equal(h.state.columnRules[0].DATA_TYPE, db === 'oracle' ? 'VARCHAR2' : 'text');
      assert.equal(h.state.columnRules[0].NULLABLE, 'Y'); assert.equal(h.state.generateCount, 2);
      await h.state.handleGenerate(); assert.ok(h.writes[0].includes('9007199254740994'));
    } finally { h.unmount(); }
  });
  test(`${db}: a delayed settings read cannot overwrite another table or edited settings`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); });
    try {
      const reader = selectSettings(h), payload = settings(h);
      h.state.setSelectedTable('Other'); await h.waitFor(state => !state.isLoading && state.columnRules.length === 2);
      finishSettings(reader, payload); await h.flush();
      assert.equal(h.state.selectedTable, 'Other'); assert.notEqual(h.state.columnRules[0].fixedValue, 'loaded');
      const next = selectSettings(h), nextPayload = settings(h);
      h.state.handleRuleChange(0, 'fixedValue', 'edited'); await h.flush();
      finishSettings(next, nextPayload); await h.flush(); assert.equal(h.state.columnRules[0].fixedValue, 'edited');
      assert.ok(h.alerts.every(message => message.includes('was not applied')));
    } finally { h.unmount(); }
  });
  test(`${db}: newer settings reads win and callbacks after unmount have no effect`, async () => {
    const h = await fixture(db, () => { throw new Error('Unexpected INSERT'); });
    const first = selectSettings(h), payload = settings(h), second = selectSettings(h);
    finishSettings(first, payload); await h.flush(); assert.equal(h.alerts.length, 0);
    finishSettings(second, payload); await h.flush(); assert.equal(h.state.columnRules[0].fixedValue, 'loaded');
    const third = selectSettings(h), count = h.alerts.length;
    h.unmount(); finishSettings(third, payload); assert.equal(h.alerts.length, count);
  });
  test(`${db}: generation invalidates pending settings reads and blocks conflicting changes`, async () => {
    let resolve;
    const h = await fixture(db, () => new Promise(done => { resolve = done; }));
    try {
      const reader = selectSettings(h), payload = settings(h);
      const generation = h.state.handleGenerate(); await h.waitFor(() => !!resolve);
      h.state.setGenerateCount('999'); h.state.handleRuleChange(0, 'fixedValue', 'during save');
      await h.flush(); assert.equal(h.state.generateCount, 2); assert.equal(h.state.columnRules[0].fixedValue, 'alpha');
      resolve({ success: true, rowsAffected: 2 }); await generation; await h.flush();
      finishSettings(reader, payload); await h.flush();
      assert.equal(h.state.columnRules[0].fixedValue, 'alpha'); assert.match(h.alerts.at(-1), /was not applied/);
    } finally { h.unmount(); }
  });
  test(`${db}: AI and file settings use the same atomic validation without paid requests`, async () => {
    let context;
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), { onOpenAiSidebar: value => { context = value; } });
    try {
      await h.state.handleExportForAI(); await h.flush(); assert.ok(context);
      const invalid = settings(h, { generateCount: 1.5 });
      assert.throws(() => context.onResponse(JSON.stringify(invalid)), /positive integer/);
      assert.equal(h.state.columnRules[0].fixedValue, 'alpha');
      context.onResponse(JSON.stringify(settings(h, { rules: [{ COLUMN_NAME: 'A"code', ruleType: 'SEQ_NUM', seqStart: '9007199254740993', seqStep: '1' }] })));
      await h.flush(); await h.state.handleGenerate();
      assert.ok(h.writes[0].includes('9007199254740994'));
    } finally { h.unmount(); }
  });
}
test('postgresql: an entirely NULL row is retained in the fixed column list', async () => {
  const h = await fixture('postgresql', () => ({ success: true, rowsAffected: 2 }), { randomValues: [0, 0, 0.9, 0.9] });
  try {
    h.state.handleRuleChange(0, 'nullRatio', 50); h.state.handleRuleChange(1, 'nullRatio', 50);
    await h.flush(); await h.state.handleGenerate();
    assert.match(h.writes[0], /\(NULL, NULL\),\n\('alpha', 'beta''s'\)/);
  } finally { h.unmount(); }
});
test('postgresql: disabled and unspecified rules remain excluded from every generated row', async () => {
  for (const ruleType of ['DISABLED', 'UNSPECIFIED']) {
    const h = await fixture('postgresql', () => ({ success: true, rowsAffected: 2 }));
    try {
      h.state.handleRuleChange(1, 'ruleType', ruleType); await h.flush(); await h.state.handleGenerate();
      assert.ok(!h.writes[0].includes('"B.value"')); assert.ok(!h.writes[0].includes('beta'));
    } finally { h.unmount(); }
  }
});

for (const db of ['oracle', 'postgresql']) {
  for (const special of [false, true]) {
    test(`${db}: AI generation metadata preserves exact names and quotes reference samples (${special ? 'special' : 'mixed case'})`, async () => {
      const schema = special ? "O'Brien.Mixed" : 'MixedSchema';
      const table = special ? "Order'.Items" : 'CaseTable';
      const parent = db === 'postgresql' && special ? 'Parent".Items' : "Parent'.Items";
      const first = special ? 'Ref"key' : 'ParentB', second = "Ref'id";
      const expected = [{ COLUMN_NAME: 'ChildA', R_OWNER: schema, R_TABLE_NAME: parent, R_COLUMN_NAME: first },
        { COLUMN_NAME: 'ChildB', R_OWNER: schema, R_TABLE_NAME: parent, R_COLUMN_NAME: second }];
      let context;
      const metadata = [], samples = [];
      const h = await createGeneratorHarness(db, async (channel, query, binds) => {
        if (channel === 'load-settings') return {};
        if (channel === 'execute-sql') {
          samples.push(query);
          return { success: true, rows: [{ VAL: query.includes(first.replace(/"/g, '""')) ? 'value-for-A' : 'value-for-B' }] };
        }
        assert.equal(channel, 'execute-sql-bg');
        if (/FROM pg_stats|NUM_DISTINCT, NUM_NULLS/.test(query)) {
          metadata.push({ query, binds }); return { success: true, rows: [{ COLUMN_NAME: 'ChildA', NUM_DISTINCT: 7, NULL_FRAC: 0, NUM_NULLS: 0, DENSITY: 1, CORRELATION: 1 }] };
        }
        if (/fk\.contype|ac\.CONSTRAINT_TYPE = 'R'/.test(query)) {
          metadata.push({ query, binds }); return { success: true, rows: expected };
        }
        if (/ALL_USERS|information_schema.schemata/.test(query)) return { success: true, rows: [{ USERNAME: schema }] };
        if (/SELECT USER FROM DUAL/.test(query)) return { success: true, rows: [{ USER: schema }] };
        if (/ALL_TAB_COLUMNS|information_schema.columns|PG_TYPE_SCHEMA/.test(query)) return { success: true, rows: ['ChildA', 'ChildB'].map(COLUMN_NAME => ({ COLUMN_NAME, DATA_TYPE: db === 'oracle' ? 'VARCHAR2' : 'text', NULLABLE: 'Y' })) };
        if (/ALL_OBJECTS|information_schema.tables/.test(query)) return { success: true, rows: [{ OBJECT_NAME: table }] };
        return { success: true, rows: [] };
      }, { schema, onOpenAiSidebar: value => { context = value; } });
      try {
        await h.waitFor(state => !state.isLoading && !!state.selectedSchema);
        h.state.setSelectedTable(table);
        await h.waitFor(state => !state.isLoading && state.columnRules.length === 2);
        await h.state.handleExportForAI(); await h.flush();
        assert.ok(context); assert.equal(metadata.length, 2); assert.equal(samples.length, 2);
        for (const request of metadata) {
          assert.equal(request.binds.owner, schema); assert.equal(request.binds.tableName, table);
          assert.ok(request.query.includes(':owner') && request.query.includes(':tableName'));
          assert.ok(!request.query.includes(table) && !request.query.includes(schema));
        }
        const q = value => '"' + value.replace(/"/g, '""') + '"';
        assert.ok(samples[0].includes(q(schema) + '.' + q(parent)));
        assert.ok(samples[0].includes(q(first))); assert.ok(samples[1].includes(q(second)));
        assert.ok(context.initialPrompt.includes('ChildA:') && context.initialPrompt.includes('7'));
        assert.ok(context.initialPrompt.includes('value-for-A') && context.initialPrompt.includes('value-for-B'));
        assert.ok(context.initialPrompt.includes('ChildA (参照先: ' + schema + '.' + parent + '.' + first + ')'));
        assert.ok(context.initialPrompt.includes('ChildB (参照先: ' + schema + '.' + parent + '.' + second + ')'));
        assert.equal(h.alerts.length, 0);
        assert.ok(!h.requests.some(([channel]) => ['ask-ai', 'commit-db', 'rollback-db'].includes(channel)));
      } finally { h.unmount(); }
    });
  }
}

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: NULL ratio inserts NULL while unspecified columns keep database defaults`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }));
    try {
      h.state.handleRuleChange(0, 'nullRatio', 100); h.state.handleRuleChange(1, 'ruleType', 'UNSPECIFIED');
      await h.flush(); await h.state.handleGenerate();
      assert.ok(h.writes[0].includes('NULL')); assert.ok(!h.writes[0].includes('"B.value"'));
      assert.equal(h.state.result, null); await h.flush(); assert.equal(h.state.result.confirmed, 2);
    } finally { h.unmount(); }
  });
  test(`${db}: preview writes nothing and its exact unique values continue into execution once`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 12 }), { randomValues: Array.from({ length: 12 }, (_, index) => index / 12) });
    try {
      h.state.handleRuleChange(0, 'ruleType', 'RANDOM_NUM'); h.state.handleRuleChange(0, 'randNumMin', '1');
      h.state.handleRuleChange(0, 'randNumMax', '12'); h.state.handleRuleChange(0, 'randNumRound', '1');
      h.state.handleRuleChange(0, 'randNumUnique', true); h.state.setGenerateCount(12); await h.flush();
      h.state.handlePreview(); await h.flush();
      assert.equal(h.writes.length, 0); assert.equal(h.state.previewRows.length, 10);
      const shown = h.state.previewRows.map(row => row['A"code']);
      assert.equal(new Set(shown).size, 10);
      await h.state.handleGenerate(); await h.flush();
      assert.equal(h.writes.length, 1); assert.equal(h.alerts.length, 1);
      for (const value of [...shown, '11', '12']) assert.ok(h.writes[0].includes(`'${value}'`));
      assert.equal(h.state.previewRows.length, 0); assert.equal(h.state.result.confirmed, 12);
    } finally { h.unmount(); }
  });
  test(`${db}: changing settings invalidates preview and cannot execute stale preview data`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }));
    try {
      h.state.handlePreview(); await h.flush(); assert.equal(h.state.previewRows[0]['A"code'], 'alpha');
      h.state.handleRuleChange(0, 'fixedValue', 'changed'); await h.flush(); assert.equal(h.state.previewRows.length, 0);
      await h.state.handleGenerate(); assert.ok(h.writes[0].includes('changed')); assert.ok(!h.writes[0].includes('alpha'));
    } finally { h.unmount(); }
  });
  test(`${db}: stopping waits for the current batch and retains confirmed pending rows`, async () => {
    let release;
    const h = await fixture(db, () => new Promise(resolve => { release = resolve; }));
    try {
      h.state.setGenerateCount(1001); await h.flush(); const pending = h.state.handleGenerate();
      await h.waitFor(() => h.writes.length === 1); assert.equal(h.state.progress.running, true);
      h.state.handleStop(); await h.flush(); assert.equal(h.state.progress.stopping, true);
      release({ success: true, rowsAffected: 500 }); await pending; await h.flush();
      assert.equal(h.writes.length, 1); assert.equal(h.state.result.status, 'stopped'); assert.equal(h.state.result.confirmed, 500);
      assert.equal(h.state.progress.running, false); assert.ok(h.alerts[0].includes('500 / 1001'));
      assert.ok(h.requests.every(([channel]) => !['commit-db', 'rollback-db', 'cancel-execution'].includes(channel)));
    } finally { h.unmount(); }
  });
  test(`${db}: closing a running generator ignores late failure and never starts another batch`, async () => {
    let release;
    const h = await fixture(db, () => new Promise(resolve => { release = resolve; }));
    h.state.setGenerateCount(1001); await h.flush(); const pending = h.state.handleGenerate();
    await h.waitFor(() => h.writes.length === 1); h.unmount(); release({ success: false, error: 'Late failure' }); await pending;
    assert.equal(h.writes.length, 1); assert.equal(h.alerts.length, 0);
  });
  test(`${db}: input feedback identifies invalid fields and clears after correction`, async () => {
    const h = await fixture(db, () => { throw new Error('Invalid input must not execute'); });
    try {
      h.state.handleRuleChange(0, 'ruleType', 'SEQ_NUM'); h.state.handleRuleChange(0, 'seqStart', 'bad');
      h.state.handleRuleChange(1, 'nullRatio', 101); h.state.setGenerateCount('1.5'); await h.flush();
      assert.ok(h.state.issues.countError); assert.ok(h.state.issues.columns['A"code'].seqStart); assert.ok(h.state.issues.columns['B.value'].nullRatio);
      h.state.handleRuleChange(0, 'seqStart', '1'); h.state.handleRuleChange(1, 'nullRatio', 0); h.state.setGenerateCount(2); await h.flush();
      assert.equal(h.state.issues.invalid, false);
      h.state.handleRuleChange(0, 'ruleType', 'RANDOM_NUM'); h.state.handleRuleChange(0, 'randNumMin', '10');
      h.state.handleRuleChange(0, 'randNumMax', '1'); await h.flush();
      assert.ok(h.state.issues.columns['A"code'].randNumMin); assert.ok(h.state.issues.columns['A"code'].randNumMax);
      h.state.handlePreview(); assert.equal(h.writes.length, 0);
    } finally { h.unmount(); }
  });
}

function editRule(h, fields, index = 0) {
  for (const [key, value] of Object.entries(fields)) h.state.handleRuleChange(index, key, value);
}
async function generatedPreview(h) {
  await h.flush(); h.state.handlePreview(); await h.flush();
  assert.deepEqual(h.alerts, [], 'Valid generation rules must preview without an error');
  assert.equal(h.writes.length, 0, 'Preview must never insert data');
  return Array.from(h.state.previewRows);
}
for (const db of ['oracle', 'postgresql']) {
  const column = (name, kind = 'text', length = 40, nullable = 'Y') => ({ COLUMN_NAME: name,
    DATA_TYPE: kind === 'text' ? db === 'oracle' ? 'VARCHAR2' : 'character varying' : kind === 'date' ? db === 'oracle' ? 'DATE' : 'date' : db === 'oracle' ? 'NUMBER' : 'numeric',
    DATA_LENGTH: length, NULLABLE: nullable });
  test(`${db}: sequence prefixes and padding preserve complete text values`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), { columnDefs: [column('CODE', 'text', 6)] });
    try {
      editRule(h, { ruleType: 'SEQ_NUM', seqStart: '1', seqStep: '2', seqPrefix: 'ORD-', seqPadZero: false });
      assert.deepEqual((await generatedPreview(h)).map(row => row.CODE), ['ORD-1', 'ORD-3']);
      editRule(h, { seqPrefix: '', seqPadZero: true });
      assert.deepEqual((await generatedPreview(h)).map(row => row.CODE), ['000001', '000003']);
      await h.state.handleGenerate(); await h.flush();
      assert.ok(h.writes[0].includes("'000001'") && h.writes[0].includes("'000003'"));
      assert.equal(h.state.result.confirmed, 2);
    } finally { h.unmount(); }
  });
  test(`${db}: sequential dates cross a leap day and month boundary one calendar day per row`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 4 }), { columnDefs: [column('DAY', 'date')] });
    try {
      editRule(h, { ruleType: 'SEQ_DATE', seqStartDate: '2024/02/28' }); h.state.setGenerateCount(4);
      assert.deepEqual((await generatedPreview(h)).map(row => row.DAY), ['2024/02/28', '2024/02/29', '2024/03/01', '2024/03/02']);
      await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, 4);
    } finally { h.unmount(); }
  });
  for (const [type, pattern, length] of [['ALPHA', /^[A-Za-z]{12}$/, 12], ['NUM', /^[0-9]{12}$/, 12],
    ['ALPHANUM', /^[A-Za-z0-9]{12}$/, 12], ['ZENKAKU', /^[あ-ん０-９Ａ-Ｆ]{4}$/u, 4]]) {
    test(`${db}: real ${type} string generation obeys its character set and padding length`, async () => {
      const h = await fixture(db, () => ({ success: true, rowsAffected: 6 }), {
        columnDefs: [column('TEXT', 'text', 12)], random: seededRandom(1234), language: type === 'ZENKAKU' ? 'ja' : 'en'
      });
      try {
        editRule(h, { ruleType: 'RANDOM_CHAR', randCharType: type, randCharFill: true }); h.state.setGenerateCount(6);
        const values = (await generatedPreview(h)).map(row => row.TEXT);
        assert.equal(values.length, 6); assert.ok(values.every(value => pattern.test(value) && value.length === length));
        assert.ok(new Set(values).size > 1);
        if (type === 'ZENKAKU') assert.ok(values.every(value => Buffer.byteLength(value, 'utf8') === 12));
        await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, 6);
      } finally { h.unmount(); }
    });
  }
  test(`${db}: real regex expansion produces unique postal, order and fictional email formats`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 8 }), {
      columnDefs: [column('CODE')], RandExp: createSeededRandExp(5678)
    });
    try {
      h.state.setGenerateCount(8);
      for (const pattern of ['[0-9]{3}-[0-9]{4}', 'ORD-[0-9]{6}', '[a-z]{5}[0-9]{3}@example[.]test']) {
        editRule(h, { ruleType: 'RANDOM_CHAR', randCharType: 'REGEX', randCharRegex: pattern, randCharUnique: true });
        const values = (await generatedPreview(h)).map(row => row.CODE), regex = new RegExp(`^(?:${pattern})$`);
        assert.equal(values.length, 8); assert.ok(values.every(value => regex.test(value))); assert.equal(new Set(values).size, 8);
      }
      await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, 8);
    } finally { h.unmount(); }
  });
  test(`${db}: ordinary random strings retry duplicate values without truncating unique results`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), {
      columnDefs: [column('LETTER', 'text', 1)], randomValues: [0, 0, 0.5]
    });
    try {
      editRule(h, { ruleType: 'RANDOM_CHAR', randCharType: 'ALPHA', randCharFill: true, randCharUnique: true });
      assert.deepEqual((await generatedPreview(h)).map(row => row.LETTER), ['A', 'a']);
      await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, 2);
    } finally { h.unmount(); }
  });
  for (const [kind, choices, draws, expected] of [
    ['text', ' NEW , PAID , , SHIPPED ', [0, 0.4, 0.999999], ['NEW', 'PAID', 'SHIPPED']],
    ['number', '1,2.5,-3', [0, 0.4, 0.999999], ['1', '2.5', '-3']],
    ['date', '2026/01/01,2026/01/02', [0, 0.9], ['2026/01/01', '2026/01/02']],
    ['text', "O'Reilly,青葉商事", [0, 0.9], ["O'Reilly", '青葉商事']]
  ]) {
    test(`${db}: valid ${kind} choices select only the configured nonempty candidates${choices.includes("'") ? ' with quoted and Japanese text' : ''}`, async () => {
      const h = await fixture(db, () => ({ success: true, rowsAffected: expected.length }), {
        columnDefs: [column('VALUE', kind)], randomValues: draws
      });
      try {
        editRule(h, { ruleType: 'CHOICE', choiceValues: choices }); h.state.setGenerateCount(expected.length);
        assert.deepEqual((await generatedPreview(h)).map(row => row.VALUE), expected);
        await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, expected.length);
        if (choices.includes("O'Reilly")) assert.ok(h.writes[0].includes("'O''Reilly'"));
      } finally { h.unmount(); }
    });
  }
  test(`${db}: random numeric interval endpoints and intermediate rounding units remain exact`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 3 }), {
      columnDefs: [column('AMOUNT', 'number')], randomValues: [0, 0.25, 0.999999]
    });
    try {
      editRule(h, { ruleType: 'RANDOM_NUM', randNumMin: '0.1', randNumMax: '0.5', randNumRound: '0.1' }); h.state.setGenerateCount(3);
      assert.deepEqual((await generatedPreview(h)).map(row => row.AMOUNT), ['0.1', '0.2', '0.5']);
      await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, 3);
    } finally { h.unmount(); }
  });
  for (const includeTime of [false, true]) {
    test(`${db}: random dates ${includeTime ? 'retain time' : 'omit time'} within the configured calendar interval`, async () => {
      const h = await fixture(db, () => ({ success: true, rowsAffected: 3 }), {
        columnDefs: [column('DAY', 'date')], randomValues: [0, 0.5, 0.999999]
      });
      try {
        editRule(h, { ruleType: 'RANDOM_DATE', randDateMin: '2026/01/01 00:00:00',
          randDateMax: includeTime ? '2026/01/01 00:00:10' : '2026/01/11 00:00:00', randDateIncludeTime: includeTime });
        h.state.setGenerateCount(3);
        const values = (await generatedPreview(h)).map(row => row.DAY);
        assert.deepEqual(values, includeTime ? ['2026/01/01 00:00:00', '2026/01/01 00:00:05', '2026/01/01 00:00:09']
          : ['2026/01/01', '2026/01/06', '2026/01/10']);
        await h.state.handleGenerate(); await h.flush(); assert.equal(h.state.result.confirmed, 3);
      } finally { h.unmount(); }
    });
  }
  test(`${db}: random dates retry duplicate days and retain distinct preview values during INSERT`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), {
      columnDefs: [column('DAY', 'date')], randomValues: [0, 0, 0.5]
    });
    try {
      editRule(h, { ruleType: 'RANDOM_DATE', randDateMin: '2026/01/01', randDateMax: '2026/01/11', randDateIncludeTime: false, randDateUnique: true });
      assert.deepEqual((await generatedPreview(h)).map(row => row.DAY), ['2026/01/01', '2026/01/06']);
      await h.state.handleGenerate(); await h.flush(); assert.ok(h.writes[0].includes('2026-01-01') && h.writes[0].includes('2026-01-06'));
    } finally { h.unmount(); }
  });
  test(`${db}: NULL probability honors its threshold and zero probability retains every value`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 4 }), {
      columnDefs: [column('MEMO')], randomValues: [0, 0.199999, 0.2, 0.999999]
    });
    try {
      editRule(h, { fixedValue: 'kept', nullRatio: 20 }); h.state.setGenerateCount(4);
      assert.deepEqual((await generatedPreview(h)).map(row => row.MEMO), [null, null, 'kept', 'kept']);
      editRule(h, { nullRatio: 0 });
      assert.deepEqual((await generatedPreview(h)).map(row => row.MEMO), ['kept', 'kept', 'kept', 'kept']);
      await h.state.handleGenerate(); await h.flush(); assert.ok(!h.writes[0].includes('NULL'));
    } finally { h.unmount(); }
  });
  test(`${db}: NOT NULL columns reject nonzero NULL probability before preview or SQL`, async () => {
    const h = await fixture(db, () => ({ success: true, rowsAffected: 2 }), { columnDefs: [column('REQUIRED', 'text', 40, 'N')] });
    try {
      editRule(h, { nullRatio: 100 }); await h.flush(); h.state.handlePreview(); await h.state.handleGenerate(); await h.flush();
      assert.equal(h.state.previewRows.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 2);
      editRule(h, { nullRatio: 0 }); await h.flush(); h.state.handlePreview(); await h.flush();
      assert.deepEqual(Array.from(h.state.previewRows, row => row.REQUIRED), ['alpha', 'alpha']);
    } finally { h.unmount(); }
  });
}
