// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { renameTraceProcedure } = require('../electron/services/traceProgram');
class TraceDatabase {
  static deleteDatabase() {} async init() {} async insertSteps() {} async saveTraceInfo() {} close() {}
}

for (const dialect of ['oracle', 'postgresql']) test(`${dialect}: repeated loop starts replace bypassed nested frames and identified ends never pop an unrelated loop`, async () => {
  const notices = ['[TRACE LOOP_START] L1', '[TRACE LINE] 10', '[TRACE LOOP_START] L2', '[TRACE LINE] 11',
    '[TRACE LOOP_START] L1', '[TRACE LINE] 10', '[TRACE LOOP_END] L2', '[TRACE LINE] 12', '[TRACE LOOP_END] L1', '[TRACE LINE] 20'];
  let steps;
  class Store extends TraceDatabase { async insertSteps(value) { steps = value; } }
  const module = loadModule(dialect === 'oracle' ? 'electron/oracle/traceExecutor.js' : 'electron/postgres/traceExecutorPg.js', { './traceDb': { TraceDatabase: Store } }, {}, { strict: false });
  const connection = { execute: async sql => {
    if (sql.includes('DBMS_OUTPUT.GET_LINES')) return { outBinds: { lines: notices } };
    return { success: true, rows: sql.startsWith('SELECT COUNT') ? [{ CNT: 0, cnt: '0' }] : [], outBinds: {}, notices };
  } };
  await (module.executeTrace || module.executeTracePg)(connection, { schema: 'test', objectName: 'loops', objectType: 'PROCEDURE', sourceText: 'CREATE PROCEDURE __placeholder__() AS BEGIN NULL; END;', skipParse: true, args: {} });
  assert.deepEqual(Array.from(steps, step => step.loopPath), ['L1_iter1', 'L1_iter1 > L2_iter1', 'L1_iter2', 'L1_iter2', '']);
});

test('Oracle BULK COLLECT INTO excludes LIMIT from the variable expression and preserves the original statement', async () => {
  let compiled;
  const { executeTrace } = loadModule('electron/oracle/traceExecutor.js', { './traceDb': {} }, {}, { strict: false });
  const source = 'CREATE OR REPLACE FUNCTION "test"."bulk"\nRETURN NUMBER\nIS\n  TYPE values_type IS TABLE OF NUMBER;\n  batch values_type;\nBEGIN\n  FETCH source_rows BULK COLLECT INTO batch LIMIT 1;\n  RETURN 0;\nEND;';
  await assert.rejects(() => executeTrace({ execute: async sql => {
    if (sql.startsWith('CREATE')) { compiled = sql; throw new Error('Compilation boundary'); }
    return { rows: [{ CNT: 0 }] };
  } }, { schema: 'test', objectName: 'bulk', objectType: 'FUNCTION', sourceText: source, args: {} }), /Compilation boundary/);
  assert.ok(compiled.includes('FETCH source_rows BULK COLLECT INTO batch LIMIT 1;'));
  assert.ok(compiled.includes('[TRACE VAR] BATCH = (Collection:'));
  assert.ok(!compiled.includes('[TRACE VAR] BATCH LIMIT'));
});
for (const dialect of ['oracle', 'postgresql']) {
  test(`${dialect}: renames only the generated declaration while preserving all other source bytes and lines`, () => {
    const source = `-- __placeholder__\nCREATE /* __placeholder__ */ OR REPLACE PROCEDURE "schema"."__placeholder__"()\n${dialect === 'oracle' ? 'AS' : 'LANGUAGE plpgsql AS $body$'}\nBEGIN\n x := '__placeholder__'; -- __placeholder__\n x := "__placeholder__";\n x := ${dialect === 'oracle' ? "q'[__placeholder__]'" : '$inner$__placeholder__$inner$'};\nEND;`;
    const expected = source.replace('"schema"."__placeholder__"', '"schema"."temporary""name"');
    assert.equal(renameTraceProcedure(source, 'temporary"name', dialect), expected);
    assert.equal(expected.split('\n').length, source.split('\n').length);
    for (const invalid of ["SELECT '__placeholder__'", 'CREATE PROCEDURE ordinary() AS BEGIN NULL; END;', 'CREATE FUNCTION __placeholder__() RETURNS text']) {
      assert.throws(() => renameTraceProcedure(invalid, 'temp', dialect), /trace procedure|placeholder/i);
    }
  });
  test(`${dialect}: generated trigger source preserves raises and exception handlers instead of replacing them with exits`, () => {
    const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${dialect}/windows/trigger/triggerTraceProgram.ts`);
    const raise = dialect === 'oracle' ? "RAISE_APPLICATION_ERROR(-20001, 'expected');" : "RAISE EXCEPTION 'expected';";
    const body = `BEGIN\n BEGIN\n  BEGIN\n   ${raise}\n  EXCEPTION WHEN OTHERS THEN\n   RAISE;\n  END;\n EXCEPTION WHEN OTHERS THEN\n  ${dialect === 'oracle' ? ':NEW' : 'NEW'}.AMOUNT := 99;\n END;\nEND;`;
    const program = buildTriggerTraceProgram({ wizBody: body, wizSchema: 'test', wizTargetObject: 'Demo', wizTiming: 'BEFORE', wizForEachRow: true,
      traceTargetDml: 'INSERT', traceInputData: { AMOUNT: '1' }, structureDefs: [{ COLUMN_NAME: 'AMOUNT', DATA_TYPE: 'NUMBER' }], checkWhere: '1=1', formatSqlValue: () => '1', wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
    assert.ok(program.sqlText.includes(raise)); assert.match(program.sqlText, /^\s*RAISE;$/m);
    assert.doesNotMatch(program.sqlText, /Exception Halt|Ignored for trace/);
    for (const line of [4, 6, 9]) assert.equal(program.mapP2T[program.mapT2P[line]], line);
  });
  test(`${dialect}: actual executor preserves literal placeholders at its compilation boundary`, async () => {
    let compiled;
    const file = dialect === 'oracle' ? 'electron/oracle/traceExecutor.js' : 'electron/postgres/traceExecutorPg.js';
    const mod = loadModule(file, { '../i18n': { t: key => key }, './traceDb': {} }, {}, { strict: false });
    const source = `CREATE OR REPLACE PROCEDURE "test"."__placeholder__"()\nAS\nBEGIN\n x := '__placeholder__'; -- __placeholder__\nEND;`;
    await assert.rejects((mod.executeTrace || mod.executeTracePg)({ execute: async sql => {
      if (/^CREATE/.test(sql)) { compiled = sql; throw new Error('Stop before compilation'); }
      return { success: true, rows: [{ cnt: '0', CNT: 0 }] };
    } }, { schema: 'test', objectName: 'demo', objectType: 'PROCEDURE', sourceText: source, skipParse: true, args: {} }), /Stop before compilation/);
    assert.ok(compiled.includes("x := '__placeholder__'; -- __placeholder__"));
    assert.ok(!compiled.includes('"test"."__placeholder__"'));
  });
}
test('PostgreSQL ordinary function tracing does not infer generated-procedure mode from literal placeholder text', async () => {
  const queries = [];
  const { executeTracePg } = loadModule('electron/postgres/traceExecutorPg.js', {
    '../services/traceProgram': require('../electron/services/traceProgram'), '../i18n': { t: key => key }, './traceDb': { TraceDatabase }
  });
  const source = `CREATE OR REPLACE FUNCTION "test"."demo"() RETURNS text\nLANGUAGE plpgsql AS $$\nBEGIN\n RETURN '__placeholder__';\nEND;\n$$;`;
  const result = await executeTracePg({ execute: async sql => {
    queries.push(sql); return { success: true, rows: sql.startsWith('SELECT COUNT') ? [{ cnt: '0' }] : [], notices: [] };
  } }, { schema: 'test', objectName: 'demo', objectType: 'FUNCTION', sourceText: source, skipParse: false, args: {} });
  assert.equal(result.success, true); assert.match(result.generatedSource, /FUNCTION "test"\."mona_demo_1"/);
  assert.ok(result.generatedSource.includes("'__placeholder__'"));
  assert.ok(queries.some(query => query.startsWith('SELECT * FROM'))); assert.ok(!queries.some(query => query.startsWith('CALL')));
  assert.ok(queries.some(query => query.startsWith('DROP FUNCTION')));
});

test('PostgreSQL stored-function wrapper retains handled exceptions and bare reraises', () => {
  const { buildPgTraceProgram } = loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts', { '../../sqlTokens': loadTypeScript('src/features/postgresql/sqlTokens.ts') });
  const sourceText = `CREATE FUNCTION test.demo() RETURNS integer LANGUAGE plpgsql AS $$\nBEGIN\n BEGIN\n  RAISE EXCEPTION 'expected';\n EXCEPTION WHEN OTHERS THEN\n  RAISE;\n END;\n RETURN 1;\nEND;\n$$;`;
  const program = buildPgTraceProgram({ schema: 'test', objectType: 'FUNCTION', sourceText, finalArgs: {}, argumentsList: [], inputDateFormat: '', t: key => key });
  assert.ok(program.includes("RAISE EXCEPTION 'expected';")); assert.match(program, /^\s*RAISE;$/m);
  assert.doesNotMatch(program, /Exception Halt|Ignored for trace/);
});
for (const dialect of ['oracle', 'postgresql']) test(`${dialect}: ordinary stored-program instrumentation preserves exception statements`, async () => {
  let compiled;
  const file = dialect === 'oracle' ? 'electron/oracle/traceExecutor.js' : 'electron/postgres/traceExecutorPg.js';
  const mod = loadModule(file, { '../i18n': { t: key => key }, './traceDb': {} }, {}, { strict: false });
  const raise = dialect === 'oracle' ? "RAISE_APPLICATION_ERROR(-20001, 'expected');" : "RAISE EXCEPTION 'expected';";
  const body = `BEGIN\n BEGIN\n  ${raise}\n EXCEPTION WHEN OTHERS THEN\n  RAISE;\n END;\nEND;`;
  const sourceText = `CREATE OR REPLACE PROCEDURE "test"."demo"${dialect === 'postgresql' ? '() LANGUAGE plpgsql AS $$' : ' AS'}\n${body}${dialect === 'postgresql' ? '\n$$;' : ''}`;
  await assert.rejects((mod.executeTrace || mod.executeTracePg)({ execute: async sql => {
    if (/^CREATE/.test(sql)) { compiled = sql; throw new Error('Stop before compilation'); }
    return { success: true, rows: [{ cnt: '0', CNT: 0 }] };
  } }, { schema: 'test', objectName: 'demo', objectType: 'PROCEDURE', sourceText, args: {} }), /Stop before compilation/);
  assert.ok(compiled.includes(raise)); assert.match(compiled, /^\s*RAISE;$/m);
  assert.doesNotMatch(compiled, /Ignored for trace/);
});

for (const dialect of ['oracle', 'postgresql']) test(`${dialect}: source snapshots distinguish trigger mappings from identically named routine arguments`, async () => {
  for (const trigger of [false, true]) {
    let snapshot;
    class Store extends TraceDatabase { async saveTraceInfo(...args) { snapshot = args[4]; } }
    const module = loadModule(dialect === 'oracle' ? 'electron/oracle/traceExecutor.js' : 'electron/postgres/traceExecutorPg.js', { './traceDb': { TraceDatabase: Store } }, {}, { strict: false });
    const notices = ['[TRACE LINE] 10', '[TRACE LINE] 11'];
    const connection = { execute: async sql => sql.includes('DBMS_OUTPUT.GET_LINES') ? { outBinds: { lines: notices } }
      : { success: true, rows: sql.startsWith('SELECT COUNT') ? [{ CNT: 0, cnt: '0' }] : [], outBinds: {}, notices } };
    const map = Array.from({ length: 20 }, (_, index) => index === 10 ? 2 : index === 11 ? 3 : 0);
    const sourceText = 'CREATE PROCEDURE __placeholder__() AS BEGIN NULL; END;';
    await (module.executeTrace || module.executeTracePg)(connection, { schema: 'test', objectName: 'snapshot', objectType: 'PROCEDURE',
      sourceText, skipParse: true, ...(trigger ? { traceTarget: { objectType: 'TRIGGER' } } : {}),
      args: { __WIZ_BODY__: 'BEGIN NULL; END;', __PROC_MAP__: trigger ? JSON.stringify(map) : 'An ordinary string argument, not JSON' } });
    assert.equal(snapshot.text, trigger ? 'BEGIN NULL; END;' : sourceText);
    assert.equal(snapshot.instrumented, !trigger);
    if (trigger) assert.deepEqual(JSON.parse(JSON.stringify(snapshot.lineMap)), { 10: 2, 11: 3 });
    else assert.equal(snapshot.lineMap, null);
  }
});
