// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getTrigger, createSql, replaceBody, saveTrigger } = require('../electron/oracle/triggerDefinition');
const { createDdlEditor } = require('./helpers/ddlEditors.cjs');

function oracleRow(overrides = {}) {
  const header = `TRIGGER "test"."Mixed'Name" BEFORE UPDATE OF "MiXeD" ON "test"."Demo"\nREFERENCING NEW AS "N" OLD AS "O"\nFOR EACH ROW\nFOLLOWS "Other"\nWHEN (N."MiXeD" > 0)\n`;
  return { TRIGGER_TYPE: 'BEFORE EACH ROW', TRIGGERING_EVENT: 'UPDATE', TABLE_OWNER: 'test', TABLE_NAME: 'Demo',
    BASE_OBJECT_TYPE: 'TABLE', REFERENCING_NAMES: 'REFERENCING NEW AS N OLD AS O', WHEN_CLAUSE: 'N."MiXeD" > 0',
    STATUS: 'DISABLED', ACTION_TYPE: 'PL/SQL', CROSSEDITION: 'NO', header, headerLines: 5, body: 'BEGIN NULL; END;',
    source: header + 'BEGIN NULL; END;', editable: true, updateColumns: ['MiXeD'], errors: [], ...overrides };
}
function pgRow(overrides = {}) {
  return { schema_name: 'test', table_name: 'Demo', trigger_name: 'DemoTrigger', trigger_oid: '42', tgtype: 19,
    relkind: 'r', function_schema: 'test', function_name: 'ActualHandler', function_users: 1, language: 'plpgsql',
    function_body: 'BEGIN RETURN NEW; END;', function_ddl: 'CREATE FUNCTION ActualHandler()', trigger_ddl: 'CREATE TRIGGER DemoTrigger',
    complex: true, enabled: 'D', when_condition: 'NEW.amount > 0', update_columns: ['amount'], ...overrides };
}
function catalog(row, calls = []) {
  return async (sql, binds) => {
    calls.push([sql, binds]);
    if (/FROM ALL_TRIGGERS/.test(sql)) return { rows: [row] };
    if (/FROM ALL_SOURCE/.test(sql)) return { rows: [{ TEXT: row.source }] };
    if (/FROM ALL_TRIGGER_COLS/.test(sql)) return { rows: row.updateColumns.map(COLUMN_NAME => ({ COLUMN_NAME })) };
    return { rows: [] };
  };
}
test('Oracle metadata binds exact names and ignores block keywords inside quoted header text', async () => {
  const row = oracleRow(); row.source = row.source.replace('WHEN (N."MiXeD" > 0)', `WHEN (N."BEGIN" <> 'DECLARE ALTER TRIGGER')`);
  const calls = [], result = await getTrigger(catalog(row, calls), { schema: 'test', triggerName: "Mixed'Name" });
  assert.equal(result.editable, true); assert.equal(result.body, 'BEGIN NULL; END;');
  assert.equal(result.STATUS, 'DISABLED'); assert.deepEqual(result.updateColumns, ['MiXeD']);
  for (const [sql, binds] of calls) { assert.ok(!sql.includes("Mixed'Name")); assert.deepEqual(binds, { owner: 'test', name: "Mixed'Name" }); }
});
test('Oracle body replacement preserves WHEN, ordering, aliases, UPDATE OF and disabled state in one CREATE', () => {
  const sql = replaceBody(oracleRow(), `BEGIN DBMS_OUTPUT.PUT_LINE(q'[ALTER TRIGGER BEGIN]'); END;`);
  assert.match(sql, /CREATE OR REPLACE TRIGGER "test"\."Mixed'Name"/);
  assert.match(sql, /UPDATE OF "MiXeD"/); assert.match(sql, /FOLLOWS "Other"/);
  assert.match(sql, /REFERENCING NEW AS "N" OLD AS "O"/);
  assert.match(sql, /DISABLE\s+WHEN \(N\."MiXeD" > 0\)/);
  assert.match(sql, /q'\[ALTER TRIGGER BEGIN\]'/);
});
test('Oracle replacement changes an existing enable token without touching quoted identifiers or WHEN literals', () => {
  const row = oracleRow({ header: 'TRIGGER "ENABLE" BEFORE INSERT ON "T" FOR EACH ROW ENABLE WHEN (NEW."X" <> \'DISABLE\')\n' });
  const sql = replaceBody(row, 'BEGIN NULL; END;');
  assert.match(sql, /TRIGGER "ENABLE"/); assert.match(sql, /DISABLE\s+WHEN/); assert.ok(sql.includes("'DISABLE'"));
  assert.ok(!sql.includes('ROW ENABLE'));
});
test('Oracle compound, CALL, cross-edition and schema event triggers remain read-only', async () => {
  for (const changes of [{ source: 'TRIGGER T FOR INSERT ON Demo COMPOUND TRIGGER BEFORE STATEMENT IS BEGIN NULL; END; END;' },
    { ACTION_TYPE: 'CALL' }, { CROSSEDITION: 'FORWARD' }, { BASE_OBJECT_TYPE: 'SCHEMA' }]) {
    const row = await getTrigger(catalog(oracleRow(changes)), { schema: 'test', triggerName: 'DemoTrigger' });
    assert.equal(row.editable, false); assert.throws(() => replaceBody(row, 'BEGIN NULL; END;'), /read-only/);
  }
});
test('Oracle creation quotes exact identifiers and never replaces an existing trigger', () => {
  const sql = createSql({ schema: "S'Name", triggerName: 'Mixed"Name', tableName: 'Table"Name', timing: 'BEFORE', events: ['UPDATE'],
    forEachRow: true, updateColumns: ['MiXeD"Col'], aliasNew: 'N', aliasOld: 'O', body: 'BEGIN NULL; END;' });
  assert.match(sql, /^CREATE TRIGGER "S'Name"\."Mixed""Name"/); assert.match(sql, /UPDATE OF "MiXeD""Col"/);
  assert.match(sql, /ON "S'Name"\."Table""Name"/); assert.ok(!sql.includes('OR REPLACE'));
});
test('Oracle stale definitions and statuses are rejected before any DDL', async () => {
  for (const expected of [{ source: 'old', status: 'DISABLED' }, { source: oracleRow().source, status: 'ENABLED' }]) {
    const calls = [];
    await assert.rejects(saveTrigger(catalog(oracleRow(), calls), { schema: 'test', triggerName: 'DemoTrigger', isNew: false, body: 'BEGIN NULL; END;', expected }), /changed/);
    assert.ok(calls.every(([sql]) => sql.startsWith('SELECT')));
  }
});
for (const db of ['oracle', 'postgresql']) {
  test(`${db}: failed source refresh keeps edits, blocks save and trace, and supports retry`, async () => {
    let fail = false; const writes = [], channel = `get-${db === 'oracle' ? 'oracle' : 'postgres'}-trigger`;
    const h = await createDdlEditor('trigger', db, async (name, ...args) => {
      if (name === channel) return fail ? { success: false, error: 'Metadata unavailable' } : { success: true, trigger: db === 'oracle' ? oracleRow() : pgRow() };
      if (name.startsWith('save-') || name === 'execute-trace') writes.push([name, ...args]);
      return { success: true, rows: [] };
    }, { isNew: false, triggerName: db === 'oracle' ? "Mixed'Name" : 'DemoTrigger' });
    try {
      assert.equal(h.render().canSave, true);
      const draft = 'BEGIN -- unsaved text\n NULL; END;'; h.render().setWizBody(draft); await h.flush();
      fail = true; await h.render().loadExistingData(); await h.flush();
      assert.equal(h.render().wizBody, draft); assert.match(h.render().loadError, /Metadata unavailable/);
      assert.equal(h.render().canSave, false); assert.equal(h.render().canTrace, false);
      await h.render().handleCreateTrigger(); await h.render().handleStartTrace(); assert.equal(writes.length, 0);
      fail = false; await h.render().retryLoad(); await h.flush(); assert.equal(h.render().canSave, true); assert.equal(h.render().loadError, '');
    } finally { h.unmount(); }
  });
  test(`${db}: changing target invalidates UPDATE columns and trace inputs and binds the new exact target`, async () => {
    const calls = [];
    const h = await createDdlEditor('trigger', db, async (...args) => { calls.push(args); return { success: true, rows: [] }; });
    try {
      h.render().setWizUpdateCols(['old']); h.render().setTraceInputData({ old: '1' }); await h.flush();
      calls.length = 0; h.render().setWizTargetObject("Next'Table");
      assert.equal(h.render().canSave, false); await h.flush();
      assert.deepEqual(Array.from(h.render().wizUpdateCols), []); assert.deepEqual(Object.keys(h.render().traceInputData), []);
      const query = calls.find(c => /(?:ALL_TAB_COLUMNS|information_schema.columns)/.test(c[1]));
      assert.equal(query[2].tableName, "Next'Table"); assert.ok(!query[1].includes("Next'Table"));
      assert.ok(!calls.some(c => /(?:FROM ALL_OBJECTS|FROM information_schema.tables)/.test(c[1])));
    } finally { h.unmount(); }
  });
  test(`${db}: stale definition responses cannot overwrite the most recent successful refresh`, async () => {
    let resolveOld, defer = false;
    const h = await createDdlEditor('trigger', db, async name => {
      if (name === `get-${db === 'oracle' ? 'oracle' : 'postgres'}-trigger`) {
        if (defer) { defer = false; return new Promise(resolve => { resolveOld = resolve; }); }
        return { success: true, trigger: db === 'oracle' ? oracleRow() : pgRow() };
      }
      return { success: true, rows: [] };
    }, { isNew: false, triggerName: db === 'oracle' ? "Mixed'Name" : 'DemoTrigger' });
    try {
      defer = true; const old = h.render().loadExistingData();
      await h.render().loadExistingData();
      resolveOld({ success: true, trigger: db === 'oracle' ? oracleRow({ body: 'stale body' }) : pgRow({ function_body: 'stale body' }) });
      await old; await h.flush(); assert.ok(!h.render().wizBody.includes('stale body')); assert.equal(h.render().canSave, true);
    } finally { h.unmount(); }
  });
}
test('PostgreSQL overview shows WHEN, UPDATE OF, function identity, sharing and replica mode', async () => {
  const h = await createDdlEditor('trigger', 'postgresql', async name => name === 'get-postgres-trigger'
    ? { success: true, trigger: pgRow({ function_users: '2', enabled: 'R' }) } : { success: true, rows: [] }, { isNew: false });
  try { const state = h.render(); assert.equal(state.overview.status, 'REPLICA'); assert.equal(state.overview.when, 'NEW.amount > 0');
    assert.equal(state.overview.functionName, '"test"."ActualHandler"()'); assert.equal(state.overview.functionUsers, 2);
    assert.deepEqual(Array.from(state.overview.updateColumns), ['amount']); assert.equal(state.canSave, false);
  } finally { h.unmount(); }
});

test('PostgreSQL WHEN summary handles nested expressions and literal parentheses without rendering catalog expression trees', () => {
  const { triggerWhen } = require('../electron/postgres/triggerDefinition');
  assert.equal(triggerWhen(`CREATE TRIGGER "WHEN" BEFORE INSERT ON demo FOR EACH ROW WHEN ((NEW.x > 0) AND NEW.label <> ') EXECUTE') EXECUTE FUNCTION fn()`), `(NEW.x > 0) AND NEW.label <> ') EXECUTE'`);
  assert.equal(triggerWhen('CREATE TRIGGER "WHEN" BEFORE INSERT ON demo EXECUTE FUNCTION fn()'), null);
});
for (const database of ['oracle', 'postgresql']) {
  test(`${database}: a late column response cannot restore columns from a previously selected target`, async () => {
    const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
    const { createHookHarness } = require('./helpers/renderHook.cjs');
    const h = createHookHarness(); let resolveOld, target = 'old', fail = false;
    const { useTriggerTarget } = loadTypeScript('src/features/trigger/useTriggerTarget.ts', {
      react: h.react, '@/shared/api/desktop': { ipcRenderer: { invoke: async (_channel, sql, binds) => {
        if (!binds) return { success: true, rows: [] };
        if (binds.tableName === 'old') return new Promise(resolve => { resolveOld = resolve; });
        return fail ? { success: false, error: 'Column metadata denied' } : { success: true, rows: [{ COLUMN_NAME: 'newColumn', column_name: 'newColumn' }] };
      } } }
    });
    const render = () => h.render(() => useTriggerTarget({ database, schema: 'test', table: target, active: true, onInvalidate() {} }));
    try {
      render(); h.commit(); await h.settle(); assert.ok(resolveOld);
      target = 'new'; render(); h.commit(); await h.settle();
      assert.deepEqual(Array.from(render().columnList), ['newColumn']);
      resolveOld({ success: true, rows: [{ COLUMN_NAME: 'staleColumn', column_name: 'staleColumn' }] }); await h.settle();
      assert.deepEqual(Array.from(render().columnList), ['newColumn']);
      fail = true; await render().reloadTarget(); await h.settle();
      assert.equal(render().targetReady, false); assert.match(render().targetError, /Column metadata denied/);
      fail = false; await render().reloadTarget(); await h.settle(); assert.equal(render().targetReady, true);
    } finally { h.unmount(); }
  });
}
test('Oracle trigger saves reserve the main connection, release it on failure, and reject read-only sessions', async () => {
  const { loadModule } = require('./helpers/loadModule.cjs');
  const calls = [];
  const Client = loadModule('electron/oracle/oracleClient.js', { electron: { app: { isPackaged: true } },
    './triggerDefinition': { saveTrigger: async (query, request) => { await query('CREATE TRIGGER demo', {}); return request; } }
  }, {}, { strict: false });
  const client = new Client();
  client.connection = { transactionInProgress: false, execute: async sql => { assert.equal(client.isExecuting, true); calls.push(sql); throw new Error('DDL rejected'); } };
  client.execute = async () => { throw new Error('Background execution is forbidden for trigger writes'); };
  await assert.rejects(client.saveTriggerDefinition({ schema: 'test', triggerName: 'demo' }), /DDL rejected/);
  assert.deepEqual(calls, ['CREATE TRIGGER demo']); assert.equal(client.isExecuting, false);
  client.isReadonly = true;
  await assert.rejects(client.saveTriggerDefinition({ schema: 'test', triggerName: 'demo' })); assert.equal(calls.length, 1);
});
test('Oracle trace programs quote schema, table and column names and escape diagnostic literals', () => {
  const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
  const { buildTriggerTraceProgram } = loadTypeScript('src/features/oracle/windows/trigger/triggerTraceProgram.ts');
  const result = buildTriggerTraceProgram({ wizBody: 'BEGIN\n NULL;\nEND;', wizSchema: 'S"Name', wizTargetObject: "Mixed'Table", wizTiming: 'BEFORE',
    wizForEachRow: true, traceTargetDml: 'UPDATE', traceInputData: { "Amount'Col": '1' }, structureDefs: [{ COLUMN_NAME: "Amount'Col", DATA_TYPE: 'NUMBER' }],
    checkWhere: '1=1', formatSqlValue: (_column, value) => value, wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
  assert.match(result.sqlText, /"S""Name"\."Mixed'Table"%ROWTYPE/);
  assert.match(result.sqlText, /FROM "S""Name"\."Mixed'Table"/);
  assert.ok(result.sqlText.includes(`v_n."Amount'Col" := 1;`));
  assert.ok(result.sqlText.includes(`v_n.AMOUNT''COL = ' || v_n."Amount'Col"`));
});
