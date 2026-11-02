// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function createHook(invoke, alert, react) {
  const dependencies = {
    react: react || { useMemo: callback => callback(), useState: value => [value, () => {}], useRef: value => ({ current: value }) },
    'react-i18next': { useTranslation: () => ({ t: text => text, i18n: { language: 'ja' } }) },
    "../data-grid/dataGridHelper": { buildTransposedColumns: () => [] },
    "@/shared/utils/dateFormatter": { formatDbDate: value => String(value) },
    "@/shared/utils/errorUtils": { getErrorMessage: error => error.message }
  };
  const { useSqlWindowBottom } = loadTypeScript('src/features/sql/useSqlWindowBottom.ts', {
    './explainIdentity': loadTypeScript('src/features/sql/explainIdentity.ts'),
    ...dependencies, '@/shared/api/desktop': { ipcRenderer: { invoke } }
  }, { alert });
  return props => useSqlWindowBottom({ ...props, explainSnapshot: Object.hasOwn(props, 'explainSnapshot')
    ? props.explainSnapshot : { sql: props.sqlText, schema: props.selectedSchema, rows: props.rows } });
}

test('Opens the AI sidebar with Oracle column statistics in the tuning request', async () => {
  const calls = [];
  const contexts = [];
  const alerts = [];
  const hook = createHook(async (channel, sql) => {
    calls.push({ channel, sql });
    if (sql.includes('GET_DDL')) return { success: true, rows: [{ DDL: 'CREATE TABLE AREA_SALES (YM NUMBER)' }] };
    if (sql.includes('NUM_DISTINCT')) {
      return { success: true, rows: [{ COLUMN_NAME: 'YM', NUM_DISTINCT: 12, NUM_NULLS: 0, DENSITY: 0.1 }] };
    }
    return { success: true, rows: [] };
  }, text => alerts.push(text));
  const result = hook({
    rows: [{ PLAN_TABLE_OUTPUT: '| 0 | TABLE ACCESS FULL | AREA_SALES | 100 | 1000 | 1 | 00:00:01 |', PLAN_OBJECT_OWNER: 'TEST_USER', PLAN_OBJECT_NAME: 'AREA_SALES', PLAN_OBJECT_TYPE: 'TABLE' }],
    columns: [], isExplainResult: true, dbType: 'oracle', dateFormat: 'YYYY/MM/DD',
    sqlText: 'SELECT * FROM TEST_USER.AREA_SALES', title: 'SQL 1',
    isAiEnabled: true, onOpenAiSidebar: context => contexts.push(context)
  });
  await result.handleExportForAI();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].requestType, "sql_tuning");
  assert.equal(contexts[0].targetTab, 'SQL 1');
  assert.ok(contexts[0].initialPrompt.includes('SELECT * FROM TEST_USER.AREA_SALES'));
  assert.ok(contexts[0].initialPrompt.includes('YM: NUM_DISTINCT=12'));
  assert.ok(calls.length > 0);
  assert.ok(calls.every(call => call.channel === 'execute-sql-bg'));
  assert.equal(alerts.length, 0);
});

test('Opens the AI sidebar with a PostgreSQL execution plan in the tuning request', async () => {
  const calls = [];
  const contexts = [];
  const hook = createHook(async (channel, sql) => {
    calls.push({ channel, sql });
    if (sql.includes('AS formatted_type')) return { success: true, rows: [{ column_name: 'id', formatted_type: 'integer', not_null: true, expression: null, identity: '', generated: '' }] };
    return { success: true, rows: [] };
  }, text => { throw new Error(text); });
  const plan = [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'area_sales', Schema: 'public', 'Plan Rows': 100 } }];
  const result = hook({
    rows: [{ PLAN_TABLE_OUTPUT: JSON.stringify(plan) }], columns: [], isExplainResult: true,
    dbType: 'postgresql', dateFormat: 'YYYY/MM/DD', selectedSchema: 'public',
    sqlText: 'SELECT * FROM public.area_sales', title: 'SQL 2',
    isAiEnabled: true, onOpenAiSidebar: context => contexts.push(context)
  });
  await result.handleExportForAI();
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].requestType, "sql_tuning");
  assert.ok(contexts[0].initialPrompt.includes('Seq Scan'));
  assert.ok(contexts[0].initialPrompt.includes('public.area_sales'));
  assert.ok(calls.every(call => call.channel === 'execute-sql-bg'));
});

function tuningProps(plan, contexts, extra = {}) {
  return {
    rows: [{ PLAN_TABLE_OUTPUT: JSON.stringify([{ Plan: plan }]) }], columns: [], isExplainResult: true,
    dbType: 'postgresql', dateFormat: 'YYYY-MM-DD', selectedSchema: 'public',
    sqlText: 'SELECT demo', title: 'SQL test', isAiEnabled: true,
    onOpenAiSidebar: context => contexts.push(context), ...extra
  };
}
const column = (column_name, formatted_type) => ({ column_name, formatted_type, not_null: false, expression: null, identity: '', generated: '' });

test('Tuning metadata distinguishes schema/name pairs, deduplicates scans and binds quoted names', async () => {
  const calls = [], contexts = [], alerts = [];
  const identities = [['sales', 'orders'], ['archive', 'orders'], ['a.b', 'c'], ['a', 'b.c'], ['Owner\'s"Schema', 'O\'Reilly"Items']];
  const hook = createHook(async (channel, sql, binds) => {
    assert.equal(channel, 'execute-sql-bg'); calls.push({ sql, binds });
    return { success: true, rows: sql.includes('AS formatted_type') ? [column('id', 'integer')] : [] };
  }, message => alerts.push(message));
  const scans = identities.map(([Schema, name]) => ({ Schema, 'Relation Name': name }));
  await hook(tuningProps({ 'Node Type': 'Append', Plans: [...scans, scans[0]] }, contexts)).handleExportForAI();
  assert.deepEqual(alerts, []); assert.equal(contexts.length, 1);
  const stats = calls.filter(call => call.sql.includes('FROM pg_class c'));
  assert.deepEqual(stats.map(call => [call.binds.schema, call.binds.tableName]), identities);
  for (const [schema, name] of identities) assert.ok(contexts[0].initialPrompt.includes(`--- Table: ${schema}.${name} ---`));
  for (const call of calls) {
    assert.ok(call.binds); assert.ok(!call.sql.includes("O'Reilly")); assert.ok(!call.sql.includes("Owner's"));
  }
  assert.ok(calls.some(call => call.binds.target === '"Owner\'s""Schema"."O\'Reilly""Items"'));
});

test('Tuning DDL retains numeric modifiers, arrays, custom types, quoted columns and constraints', async () => {
  const contexts = [], alerts = [];
  const hook = createHook(async (channel, sql) => {
    assert.equal(channel, 'execute-sql-bg');
    if (sql.includes('AS formatted_type')) return { success: true, rows: [column('amount', 'numeric(10,2)'), column('tags', 'text[]'), column('quote"col', '"types"."Money"'), column('states', '"types"."State"[]')] };
    if (sql.includes('SELECT c.conname')) return { success: true, rows: [{ name: 'amount_positive', ddl: 'CHECK ((amount > 0))' }] };
    return { success: true, rows: [] };
  }, message => alerts.push(message));
  await hook(tuningProps({ Schema: 'public', 'Relation Name': 'items' }, contexts)).handleExportForAI();
  assert.deepEqual(alerts, []);
  const text = contexts[0].initialPrompt;
  for (const definition of ['"amount" numeric(10,2)', '"tags" text[]', '"quote""col" "types"."Money"', '"states" "types"."State"[]', 'CONSTRAINT "amount_positive" CHECK']) assert.ok(text.includes(definition), definition);
});

test('Failed PostgreSQL source metadata does not open an AI request with incomplete DDL', async () => {
  for (const failure of ['columns', 'constraints']) {
    const contexts = [], alerts = [];
    const hook = createHook(async (channel, sql) => {
      assert.equal(channel, 'execute-sql-bg');
      if (sql.includes('AS formatted_type')) return failure === 'columns' ? { success: true, rows: [] } : { success: true, rows: [column('id', 'integer')] };
      if (failure === 'constraints' && sql.includes('SELECT c.conname')) return { success: false, error: 'Constraint metadata failed' };
      return { success: true, rows: [] };
    }, message => alerts.push(message));
    await hook(tuningProps({ Schema: 'public', 'Relation Name': 'items' }, contexts)).handleExportForAI();
    assert.equal(contexts.length, 0); assert.equal(alerts.length, 1);
    assert.match(alerts[0], /no visible columns|Constraint metadata failed/);
  }
});

test('Oracle tuning binds table and index names containing apostrophes', async () => {
  const calls = [], contexts = [], alerts = [];
  const tableName = "O'Reilly", indexName = "Ix'Name";
  const hook = createHook(async (channel, sql, binds) => {
    assert.equal(channel, 'execute-sql-bg'); calls.push({ sql, binds });
    if (sql.includes('GET_DDL')) return { success: true, rows: [{ DDL: 'CREATE TABLE demo (id NUMBER)' }] };
    if (sql.includes('FROM ALL_INDEXES')) return { success: true, rows: [{ OWNER: 'TEST_USER', INDEX_NAME: indexName, INDEX_TYPE: 'NORMAL' }] };
    return { success: true, rows: [] };
  }, message => alerts.push(message));
  await hook(tuningProps(null, contexts, { dbType: 'oracle', rows: [{ PLAN_TABLE_OUTPUT: `| 0 | TABLE ACCESS FULL | ${tableName} | 1 | 1 | 1 | 00:00:01 |`, PLAN_OBJECT_OWNER: 'TEST_USER', PLAN_OBJECT_NAME: tableName, PLAN_OBJECT_TYPE: 'TABLE' }] })).handleExportForAI();
  assert.deepEqual(alerts, []); assert.equal(contexts.length, 1);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(call => !call.sql.includes(tableName) && !call.sql.includes(indexName)));
  assert.ok(calls.filter(call => call.binds.tableName === tableName).length === 4);
  assert.ok(calls.some(call => call.binds.indexName === indexName));
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: failed metadata never opens or saves an AI request or reports absent indexes`, async () => {
    const stages = db === 'oracle' ? ['table DDL', 'table statistics', 'column statistics', 'index list', 'index DDL'] : ['table statistics', 'column statistics', 'index list'];
    for (const failingStage of stages) for (const mode of ['failed', 'rejected', 'missing rows']) {
      const contexts = [], alerts = [], calls = [];
      const hook = createHook(async (channel, sql) => {
        assert.equal(channel, 'execute-sql-bg'); calls.push(sql);
        const stage = sql.includes("GET_DDL('TABLE'") ? 'table DDL'
          : /FROM ALL_TABLES|FROM pg_class c JOIN/.test(sql) ? 'table statistics'
          : /FROM ALL_TAB_COLUMNS|FROM pg_stats/.test(sql) ? 'column statistics'
          : /FROM ALL_INDEXES|FROM pg_indexes/.test(sql) ? 'index list'
          : sql.includes("GET_DDL('INDEX'") ? 'index DDL' : undefined;
        if (stage === failingStage) {
          if (mode === 'rejected') throw new Error(`Unavailable ${stage}`);
          if (mode === 'missing rows') return { success: true };
          return { success: false, error: `Unavailable ${stage}` };
        }
        if (sql.includes('GET_DDL')) return { success: true, rows: [{ DDL: 'CREATE TABLE items (id NUMBER)' }] };
        if (sql.includes('AS formatted_type')) return { success: true, rows: [column('id', 'integer')] };
        if (sql.includes('FROM ALL_INDEXES')) return { success: true, rows: [{ OWNER: 'TEST', INDEX_NAME: 'ITEMS_IDX' }] };
        return { success: true, rows: [] };
      }, message => alerts.push(message));
      const rows = db === 'oracle' ? [{ PLAN_TABLE_OUTPUT: '| 1 | TABLE ACCESS FULL | items | 1 | 1 | 1 | 1 |', PLAN_OBJECT_OWNER: 'TEST', PLAN_OBJECT_NAME: 'items', PLAN_OBJECT_TYPE: 'TABLE' }] : undefined;
      await hook(tuningProps({ Schema: 'test', 'Relation Name': 'items' }, contexts, { dbType: db, ...(rows ? { rows } : {}) })).handleExportForAI();
      assert.equal(contexts.length, 0, `${failingStage}: ${mode}`); assert.equal(alerts.length, 1);
      assert.match(alerts[0], /Unavailable|tuning_metadata_unavailable/); assert.ok(calls.length);
    }
  });
  test(`${db}: a successful empty index list is reported as no indexes`, async () => {
    const contexts = [], alerts = [];
    const hook = createHook(async (channel, sql) => {
      assert.equal(channel, 'execute-sql-bg');
      if (sql.includes('GET_DDL')) return { success: true, rows: [{ DDL: 'CREATE TABLE items (id NUMBER)' }] };
      if (sql.includes('AS formatted_type')) return { success: true, rows: [column('id', 'integer')] };
      return { success: true, rows: [] };
    }, message => alerts.push(message));
    const rows = db === 'oracle' ? [{ PLAN_TABLE_OUTPUT: '| 1 | TABLE ACCESS FULL | items | 1 | 1 | 1 | 1 |', PLAN_OBJECT_OWNER: 'TEST', PLAN_OBJECT_NAME: 'items', PLAN_OBJECT_TYPE: 'TABLE' }] : undefined;
    await hook(tuningProps({ Schema: 'test', 'Relation Name': 'items' }, contexts, { dbType: db, ...(rows ? { rows } : {}) })).handleExportForAI();
    assert.deepEqual(alerts, []); assert.equal(contexts.length, 1);
    assert.ok(contexts[0].initialPrompt.includes('[インデックス]: なし') || contexts[0].initialPrompt.includes('【インデックス】: なし'));
  });
}

test('Tuning discloses estimated plans, planning time and prior observations while bind values stay private by default', async () => {
  const contexts = [];
  const hook = createHook(async () => ({ success: true, rows: [] }), message => { throw new Error(message); });
  const rows = [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Result' } }] }];
  const state = hook({ rows, columns: [], isExplainResult: true, dbType: 'postgresql', sqlText: 'SELECT :mb_input_0',
    explainSnapshot: { sql: 'SELECT :mb_input_0', rows, schema: 'test', planKind: 'estimated', planningDurationMs: 9,
      binds: [{ name: 'ID', placeholder: 'mb_input_0', type: 'STRING', value: 'PRIVATE_BIND_42' }],
      observedExecution: { requestDurationMs: 200, returnedRowCount: 3, completedAt: 'earlier' } },
    title: 'SQL', isAiEnabled: true, onOpenAiSidebar: value => contexts.push(value) });
  await state.handleExportForAI();
  assert.equal(contexts.length, 1);
  const prompt = contexts[0].initialPrompt;
  assert.match(prompt, /"planKind":"estimated"/); assert.match(prompt, /"planningDurationMs":9/);
  assert.match(prompt, /"returnedRowCount":3/); assert.match(prompt, /not SQL execution duration/);
  assert.match(prompt, /not shared/); assert.ok(!prompt.includes('PRIVATE_BIND_42'));
});

test('Bind sharing requires explicit consent for each plan snapshot and does not carry over to the next plan', async () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const h = createHookHarness(), contexts = [];
  const hook = createHook(async () => ({ success: true, rows: [] }), message => { throw new Error(message); }, h.react);
  const rows = [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Result' } }] }];
  const props = { rows, columns: [], isExplainResult: true, dbType: 'postgresql', sqlText: 'SELECT :mb_input_0',
    explainSnapshot: { sql: 'SELECT :mb_input_0', rows, schema: 'test', binds: [{ name: 'ID', placeholder: 'mb_input_0', type: 'STRING', value: 'ONLY_WITH_CONSENT' }] },
    title: 'SQL', isAiEnabled: true, onOpenAiSidebar: value => contexts.push(value) };
  try {
    const render = () => h.render(() => hook(props));
    let state = render(); assert.equal(state.includeBindValues, false);
    state.setIncludeBindValues(true); state = render(); assert.equal(state.includeBindValues, true);
    await state.handleExportForAI(); assert.ok(contexts[0].initialPrompt.includes('ONLY_WITH_CONSENT'));
    props.explainSnapshot = { ...props.explainSnapshot, sql: 'SELECT :mb_input_0 + 1' };
    state = render(); assert.equal(state.includeBindValues, false);
    await state.handleExportForAI(); assert.ok(!contexts[1].initialPrompt.includes('ONLY_WITH_CONSENT'));
  } finally { h.unmount(); }
});
