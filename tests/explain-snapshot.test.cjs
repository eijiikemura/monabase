// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSqlWindowHarness } = require('./helpers/sqlWindow.cjs');

function desktop(db) {
  const state = {};
  return { state, invoke: async (channel, sql) => {
    if (state.error) throw new Error('Transport failed');
    if (state.failed) return { success: false, error: 'Analysis failed' };
    assert.ok(['explain-sql', 'execute-sql'].includes(channel));
    return { success: true, executionSchema: db === 'oracle' ? 'Actual.Schema' : undefined,
      rows: [{ PLAN_TABLE_OUTPUT: db === 'oracle' ? `Plan for ${sql}` : JSON.stringify([{ Plan: { 'Node Type': 'Result', Output: [sql] } }]) }],
      metaData: [{ name: 'PLAN_TABLE_OUTPUT' }], executionTime: 1 };
  } };
}
const targetSql = prompt => prompt.match(/\[2\. Target SQL\]\n=+\n([\s\S]*?)\n\n=+/)?.[1];
const explainCalls = h => h.calls.filter(([channel]) => channel === 'explain-sql');

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: tuning retains analyzed SQL, schema and plan after editor and schema changes`, async () => {
    const original = db === 'oracle' ? 'SELECT 1 AS old_value FROM DUAL' : 'SELECT 1 AS old_value';
    const d = desktop(db), h = await createSqlWindowHarness(db, original, d.invoke);
    try {
      h.state.setIsExplainMode(true); await h.flush(); await h.state.handleExecuteSql(); await h.flush();
      const snapshot = h.state.explainSnapshot;
      assert.equal(snapshot.sql, original); assert.equal(snapshot.rows[0].PLAN_TABLE_OUTPUT, h.state.rows[0].PLAN_TABLE_OUTPUT);
      assert.equal(snapshot.schema, db === 'oracle' ? 'Actual.Schema' : 'test');
      h.state.setSqlText('SELECT 999 AS editor_changed');
      if (db === 'postgresql') h.state.setSelectedSchema('other');
      await h.flush(); assert.equal(h.state.explainSnapshot, snapshot);
      const result = await h.requestTuning(); assert.deepEqual(result.alerts, []);
      assert.equal(targetSql(result.contexts[0].initialPrompt), original);
      assert.ok(result.contexts[0].initialPrompt.includes(`Execution schema: ${snapshot.schema}`));
      assert.ok(!result.contexts[0].initialPrompt.includes('editor_changed'));
      assert.equal(explainCalls(h).length, 1);
    } finally { h.unmount(); }
  });
  test(`${db}: edits made while analysis is pending cannot change the completed snapshot`, async () => {
    let release;
    const d = desktop(db), original = db === 'oracle' ? 'SELECT 7 FROM DUAL' : 'SELECT 7';
    const h = await createSqlWindowHarness(db, original, (...args) => new Promise(resolve => { release = async () => resolve(await d.invoke(...args)); }));
    try {
      h.state.setIsExplainMode(true); await h.flush(); const pending = h.state.handleExecuteSql();
      h.state.setSqlText('SELECT 888 AS changed_while_pending');
      if (db === 'postgresql') h.state.setSelectedSchema('other');
      await h.flush(); await release(); await pending; await h.flush();
      assert.equal(h.state.explainSnapshot.sql, original);
      assert.equal(h.state.explainSnapshot.schema, db === 'oracle' ? 'Actual.Schema' : 'test');
      const result = await h.requestTuning({ rows: [{ PLAN_TABLE_OUTPUT: 'unrelated display rows' }] });
      assert.deepEqual(result.alerts, []); assert.equal(targetSql(result.contexts[0].initialPrompt), original);
      assert.ok(!result.contexts[0].initialPrompt.includes('unrelated display rows'));
    } finally { h.unmount(); }
  });
  test(`${db}: selected SQL is captured after bind substitution and excludes unrelated editor text`, async () => {
    const selected = db === 'oracle' ? 'SELECT :amount AS chosen FROM DUAL' : 'SELECT :amount AS chosen';
    const d = desktop(db), h = await createSqlWindowHarness(db, `SELECT 0;\n${selected};\nSELECT 999 AS unrelated`, d.invoke);
    try {
      h.state.setIsExplainMode(true); h.state.setBindValues({ AMOUNT: '42' }); h.state.setBindTypes({ AMOUNT: 'NUMBER' }); await h.flush();
      h.state.editorRef.current = { view: { state: { selection: { main: { empty: false, from: 10, to: 20 } },
        sliceDoc: () => selected, doc: { lineAt: () => ({ number: 2 }) } } } };
      await h.state.handleExecuteSql(); await h.flush();
      const actual = selected.replace(':amount', `CAST(:mb_input_0 AS ${db === 'oracle' ? 'NUMBER' : 'NUMERIC'})`);
      assert.equal(explainCalls(h)[0][2].mb_input_0, '42');
      assert.equal(explainCalls(h).length, 1); assert.equal(explainCalls(h)[0][1], actual);
      assert.equal(h.state.explainSnapshot.sql, actual);
      h.state.setBindValues({ AMOUNT: '99' }); await h.flush();
      const result = await h.requestTuning(); assert.deepEqual(result.alerts, []);
      assert.equal(targetSql(result.contexts[0].initialPrompt), actual);
      assert.ok(!result.contexts[0].initialPrompt.includes('unrelated'));
    } finally { h.unmount(); }
  });
  test(`${db}: a multi-statement analysis attaches only the final statement and its own plan`, async () => {
    const suffix = db === 'oracle' ? ' FROM DUAL' : '';
    const first = `SELECT 111 AS first_value${suffix}`, last = `SELECT 222 AS last_value${suffix}`;
    const d = desktop(db), h = await createSqlWindowHarness(db, `${first};\n${last};`, d.invoke);
    try {
      h.state.setIsExplainMode(true); await h.flush(); await h.state.handleExecuteSql(); await h.flush();
      assert.equal(explainCalls(h).length, 2); assert.equal(h.state.explainSnapshot.sql, last);
      const result = await h.requestTuning(); assert.deepEqual(result.alerts, []);
      assert.equal(targetSql(result.contexts[0].initialPrompt), last);
      assert.ok(result.contexts[0].initialPrompt.includes('last_value')); assert.ok(!result.contexts[0].initialPrompt.includes('first_value'));
    } finally { h.unmount(); }
  });
  test(`${db}: failed analysis and ordinary execution invalidate the tuning snapshot`, async () => {
    const d = desktop(db), h = await createSqlWindowHarness(db, db === 'oracle' ? 'SELECT 1 FROM DUAL' : 'SELECT 1', d.invoke);
    try {
      h.state.setIsExplainMode(true); await h.flush();
      for (const failure of ['failed', 'error']) {
        await h.state.handleExecuteSql(); await h.flush(); assert.ok(h.state.explainSnapshot);
        d.state[failure] = true; await h.state.handleExecuteSql(); await h.flush();
        assert.equal(h.state.explainSnapshot, null);
        const count = h.calls.length, result = await h.requestTuning();
        assert.equal(result.contexts.length, 0); assert.equal(result.alerts.length, 1); assert.equal(h.calls.length, count);
        assert.match(result.alerts[0], /Analyze the SQL again/); d.state[failure] = false;
      }
      await h.state.handleExecuteSql(); await h.flush(); assert.ok(h.state.explainSnapshot);
      h.state.setIsExplainMode(false); await h.flush(); await h.state.handleExecuteSql(); await h.flush();
      assert.equal(h.state.explainSnapshot, null); assert.equal(h.state.isExplainResult, false);
    } finally { h.unmount(); }
  });
}
