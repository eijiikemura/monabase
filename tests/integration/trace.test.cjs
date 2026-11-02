// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { createHookHarness } = require('../helpers/renderHook.cjs');
const { tracePrograms } = require('../helpers/tracePrograms.cjs');
const { createTraceDatabase } = require('../../electron/services/traceStore');

if (process.env.MONABASE_DB_TEST_ALLOW_WRITE !== '1') throw new Error('Set MONABASE_DB_TEST_ALLOW_WRITE=1; see docs/TESTING.md.');
const databases = (process.env.MONABASE_TEST_DATABASES || 'postgresql,oracle').split(',');
assert.ok(databases.length && databases.every(database => ['oracle', 'postgresql'].includes(database)), 'Invalid MONABASE_TEST_DATABASES');
const configuration = process.env.MONABASE_TEST_CONFIG ? JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8')) : {};
const quote = value => '"' + value.replaceAll('"', '""') + '"';

function replay(database, steps, outsideLine) {
  const hooks = createHookHarness(), notices = [];
  const { useTraceSimulator } = loadTypeScript(`src/features/${database}/windows/common/useTraceSimulator.ts`, {
    react: hooks.react, 'react-i18next': { useTranslation: () => ({ t: key => key }) }
  }, { alert: value => notices.push(value) });
  const render = () => { const state = hooks.render(() => useTraceSimulator()); hooks.commit(); return state; };
  let state = render(); state.loadSimulation(steps); state = render();
  for (let index = 0; index < steps.length; index++) {
    state.handleSimulateStep('step_into'); state = render();
    assert.equal(state.activeLine, steps[index].lineNum); assert.equal(state.currentStepIndex, index);
    assert.deepEqual(state.currentVariables, steps[index].variables);
  }
  state.handleSimulateStep('step_into'); state = render(); assert.equal(state.activeLine, null);
  assert.deepEqual(notices, ['debug_execution_completed_to_the_end']);
  if (outsideLine) {
    state.loadSimulation(steps); state = render();
    const firstInside = steps.find(step => step.loopPath);
    assert.ok(firstInside); state.toggleBreakpoint(firstInside.lineNum); state = render();
    state.handleSimulateStep('start'); state = render(); assert.equal(state.activeLine, firstInside.lineNum);
    state.toggleBreakpoint(firstInside.lineNum); state = render();
    state.handleSimulateStep('step_out'); state = render(); assert.equal(state.activeLine, outsideLine, 'Step out must reach the real statement after the outer loop.');
  }
  hooks.unmount();
}

for (const database of databases) test(`${database}: real niche stored-program trace analysis and persisted replay`, { timeout: 180000 }, async t => {
  const config = { ...configuration[database] }, prefix = database === 'oracle' ? 'MONABASE_ORACLE_' : 'MONABASE_PG_';
  for (const key of ['host', 'port', 'database', 'user', 'password']) {
    if (process.env[prefix + key.toUpperCase()] !== undefined) config[key] = process.env[prefix + key.toUpperCase()];
    assert.ok(config[key], `Missing ${database} ${key}; see docs/TESTING.md.`);
  }
  const Client = loadModule(`electron/${database === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`, { electron: { app: { isPackaged: true } } }, {}, { strict: false });
  const client = new Client(), token = `MBT_${randomBytes(6).toString('hex').toUpperCase()}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-trace-integration-'));
  const objects = [], failures = [];
  const TraceDatabase = createTraceDatabase(database === 'oracle' ? 'oracle' : 'postgres', { getStoragePaths: () => ({ traceDirectory: directory }) });
  const executor = loadModule(`electron/${database === 'oracle' ? 'oracle/traceExecutor' : 'postgres/traceExecutorPg'}.js`, { './traceDb': { TraceDatabase } }, {}, { strict: false });
  const execute = database === 'oracle' ? executor.executeTrace : executor.executeTracePg;
  const sql = (text, binds = {}) => client.execute(text, binds);
  const scalar = rows => Object.values(rows[0])[0];
  t.after(async () => {
    try { await client.rollback(); } catch { failures.push('rollback'); }
    for (const object of objects.reverse()) {
      try { await sql(`DROP ${object.kind} ${object.target}`); }
      catch { failures.push(`drop ${object.kind} ${object.target}`); }
    }
    try { await client.disconnect(); } catch { failures.push('disconnect'); }
    fs.rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(failures, [], 'Cleanup failed for this run-owned test environment.');
  });
  // Do not expose driver connection errors or configuration in test logs.
  try { await client.connect({ ...config, queryTimeout: 15 }); }
  catch { throw new Error('Trace test database connection failed; configuration details omitted.'); }
  const schema = String(scalar((await sql(database === 'oracle' ? 'SELECT USER FROM DUAL' : 'SELECT current_schema()')).rows));
  assert.equal(schema, database === 'oracle' ? (config.schema || config.user).toUpperCase() : config.schema || 'public', 'Verify the configured schema (or disposable PostgreSQL public schema) before creating objects.');
  t.diagnostic(`Database server version: ${database === 'oracle' ? client.connection.oracleServerVersionString : scalar((await sql("SELECT current_setting('server_version')")).rows)}`);
  const table = `${quote(schema)}.${quote(token + '_DATA')}`;
  await sql(`CREATE TABLE ${table} (id ${database === 'oracle' ? 'NUMBER' : 'integer'} PRIMARY KEY, amount ${database === 'oracle' ? 'NUMBER' : 'integer'})`);
  objects.push({ kind: 'TABLE', target: table });
  const { buildPgTraceProgram } = loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts');
  const remainingTemporary = async name => Number(scalar((await sql(database === 'oracle'
    ? 'SELECT COUNT(*) FROM USER_OBJECTS WHERE OBJECT_NAME = :name'
    : 'SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema AND p.proname=:name',
  { name, ...(database === 'postgresql' ? { schema } : {}) })).rows));
  const runTrace = async (sub, parameters) => {
    const temporary = database === 'oracle' ? `MONA_${parameters.objectName.toUpperCase().slice(0, 20)}_1` : `mona_${parameters.objectName.slice(0, 20)}_1`.toLowerCase();
    assert.equal(await remainingTemporary(temporary), 0, 'Only a previously absent run-owned temporary name may be cleaned up.');
    sub.after(async () => {
      await client.rollback();
      if (await remainingTemporary(temporary)) {
        await sql(`DROP ${database === 'postgresql' && parameters.skipParse ? 'PROCEDURE' : parameters.objectType} ${quote(schema)}.${quote(temporary)}${database === 'postgresql' ? '()' : ''}`);
        assert.fail('Executor left a temporary trace program; the test removed only its own program.');
      }
    });
    return execute(database === 'oracle' ? client.connection : client, { schema, args: {}, inputDateFormat: 'YYYY-MM-DD HH24:MI:SS', ...parameters });
  };

  for (const [index, program] of tracePrograms(database, table).entries()) await t.test(program.name, async sub => {
    sub.after(() => client.rollback());
    const name = `${token}_F${index}`, routine = `${quote(schema)}.${quote(name)}`;
    const source = database === 'oracle'
      ? `CREATE OR REPLACE FUNCTION ${routine}\nRETURN VARCHAR2\nIS\n${program.declarations}\nBEGIN\n${program.body}\nEND;`
      : `CREATE OR REPLACE FUNCTION ${routine}() RETURNS text LANGUAGE plpgsql AS $body$\nDECLARE\n${program.declarations}\nBEGIN\n${program.body}\nEND;\n$body$;`;
    await sql(source); objects.push({ kind: 'FUNCTION', target: routine + (database === 'postgresql' ? '()' : '') });
    if (database === 'oracle') assert.equal((await sql('SELECT TEXT FROM USER_ERRORS WHERE NAME = :name ORDER BY SEQUENCE', { name })).rows.length, 0, 'Native fixture must compile before tracing.');
    let native;
    if (database === 'oracle') {
      const oracle = require('oracledb');
      native = String((await client.connection.execute(`BEGIN :result := ${routine}(); END;`, { result: { dir: oracle.BIND_OUT, type: oracle.STRING, maxSize: 4000 } })).outBinds.result);
    } else {
      await sql('BEGIN');
      native = String(scalar((await sql(`SELECT ${routine}() AS result`)).rows));
    }
    await client.rollback(); assert.equal(native, program.expected, 'Verify the native program independently of instrumentation.');
    const sourceText = database === 'oracle' ? source : buildPgTraceProgram({ schema, objectType: 'FUNCTION', sourceText: source, finalArgs: {}, argumentsList: [], inputDateFormat: 'YYYY-MM-DD HH24:MI:SS', t: key => key });
    const identity = { schema, objectName: name, objectType: 'FUNCTION' };
    const result = await runTrace(sub, { ...identity, sourceText, originalSourceText: source, skipParse: database === 'postgresql', traceIdentity: identity });
    assert.equal(result.success, true); assert.equal(String(result.returnValues[0].value), native, 'Trace instrumentation must preserve the native return value.');
    if (program.output) assert.ok(result.dbmsOutput.includes(program.output), 'Literal user output must survive instrumentation.');
    const store = new TraceDatabase(identity); await store.init();
    const persisted = await store.getTraceSteps(), info = await store.getTraceInfo(); store.close();
    assert.ok(persisted.length > 0, 'Trace steps must be written to the real isolated JSON store.');
    assert.equal(info.arguments, '{}');
    assert.equal(info.executed_source, source);
    assert.equal(info.source_kind, 'original');
    assert.equal(info.source_sha256, require('node:crypto').createHash('sha256').update(source).digest('hex'));
    const steps = persisted.map(step => ({ lineNum: step.line_num, loopPath: step.loop_path, variables: JSON.parse(step.variables_json) }));
    assert.ok(steps.every(step => Number.isInteger(step.lineNum) && step.lineNum > 0 && step.lineNum <= source.split('\n').length), 'Every saved location must reference the original source.');
    assert.ok(result.variablesTrace.some(line => line.includes(`[TRACE VAR] ${program.variable[0]} = ${program.variable[1]}`)), 'The tracked variable must reflect real execution.');
    assert.ok(steps.some(step => step.variables[program.variable[0]] === program.variable[1]), 'The real saved snapshots must retain the observed variable value.');
    if (program.outsideLoop) {
      const outside = steps.filter(step => source.split('\n')[step.lineNum - 1] === program.outsideLoop);
      assert.ok(outside.length); assert.ok(outside.every(step => step.loopPath === ''), 'Statements following EXIT/CONTINUE loops must not retain stale loop frames.');
    }
    if (program.unreachable) assert.ok(!steps.some(step => source.split('\n')[step.lineNum - 1] === program.unreachable), 'Unreachable statements must not appear as executed steps.');
    replay(database, steps, program.outsideLoop ? source.split('\n').indexOf(program.outsideLoop) + 1 : undefined);
    assert.equal(Number(scalar((await sql(`SELECT COUNT(*) FROM ${table}`)).rows)), 0, 'Trace DML must be rolled back.');
    await client.rollback();
    const temporary = `${database === 'oracle' ? 'MONA' : 'mona'}_${name.slice(0, 20)}_1`;
    const remaining = (await sql(database === 'oracle' ? 'SELECT COUNT(*) FROM USER_OBJECTS WHERE OBJECT_NAME = :name' : 'SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema AND p.proname=:name', { name: database === 'oracle' ? temporary : temporary.toLowerCase(), ...(database === 'postgresql' ? { schema } : {}) })).rows;
    assert.equal(Number(scalar(remaining)), 0, 'Temporary instrumentation must be removed.');
  });

  await t.test('Stored procedure IN/OUT values survive tracing and persist the caller arguments', async sub => {
    const name = `${token}_PROC`, routine = `${quote(schema)}.${quote(name)}`;
    const args = database === 'oracle' ? { P_IN: '7', P_OUT: '1' } : { p_in: '7', p_out: '1' };
    const argumentsList = Object.keys(args).map((key, index) => ({ ARGUMENT_NAME: key, POSITION: index + 1, DATA_TYPE: database === 'oracle' ? 'NUMBER' : 'integer', IN_OUT: index ? 'IN/OUT' : 'IN' }));
    const source = database === 'oracle'
      ? `CREATE OR REPLACE PROCEDURE ${routine}(p_in IN NUMBER, p_out IN OUT NUMBER)\nIS\nBEGIN\n  p_out := p_in + p_out;\nEND;`
      : `CREATE OR REPLACE PROCEDURE ${routine}(IN p_in integer, INOUT p_out integer) LANGUAGE plpgsql AS $body$\nBEGIN\n  p_out := p_in + p_out;\nEND;\n$body$;`;
    await sql(source); objects.push({ kind: 'PROCEDURE', target: routine + (database === 'postgresql' ? '(integer, integer)' : '') });
    let native;
    if (database === 'oracle') {
      const oracle = require('oracledb');
      native = (await client.connection.execute(`BEGIN ${routine}(7, :value); END;`, { value: { dir: oracle.BIND_INOUT, type: oracle.NUMBER, val: 1 } })).outBinds.value;
    } else native = scalar((await sql(`CALL ${routine}(7, 1)`)).rows);
    const sourceText = database === 'oracle' ? source : buildPgTraceProgram({ schema, objectType: 'PROCEDURE', sourceText: source, finalArgs: args, argumentsList, inputDateFormat: '', t: key => key });
    const identity = { schema, objectName: name, objectType: 'PROCEDURE' };
    const result = await runTrace(sub, { ...identity, sourceText, args, argTypes: Object.fromEntries(argumentsList.map(arg => [arg.ARGUMENT_NAME, arg.DATA_TYPE])), argDirections: Object.fromEntries(argumentsList.map(arg => [arg.ARGUMENT_NAME, arg.IN_OUT])), skipParse: database === 'postgresql', traceIdentity: identity });
    assert.equal(String(result.returnValues[0].value), String(native)); assert.equal(String(native), '8');
    const store = new TraceDatabase(identity); await store.init();
    assert.deepEqual(JSON.parse((await store.getTraceInfo()).arguments), args);
    const steps = (await store.getTraceSteps()).map(step => ({ lineNum: step.line_num, loopPath: step.loop_path, variables: JSON.parse(step.variables_json) }));
    store.close(); assert.ok(steps.length); replay(database, steps);
  });

  await t.test('Live trigger and traced trigger agree after labeled CONTINUE/EXIT without stale loop frames', async sub => {
    const name = `${token}_TRG`, trigger = `${quote(schema)}.${quote(name)}`, fn = `${quote(schema)}.${quote(token + '_TRGF')}`;
    const field = database === 'oracle' ? ':NEW.amount' : 'NEW.amount';
    const body = `DECLARE
  total integer := 0;
  j integer := 0;
BEGIN
  <<outer_loop>>
  FOR k IN 1..3 LOOP
    CONTINUE outer_loop WHEN k = 2;
    j := 0;
    LOOP
      j := j + 1;
      EXIT WHEN j = 2;
      total := total + k;
    END LOOP;
  END LOOP outer_loop;
  ${field} := total + 10;
${database === 'postgresql' ? '  RETURN NEW;\n' : ''}END;`;
    if (database === 'oracle') {
      await sql(`CREATE OR REPLACE TRIGGER ${trigger} BEFORE INSERT ON ${table} FOR EACH ROW\n${body}`);
      objects.push({ kind: 'TRIGGER', target: trigger });
    } else {
      await sql(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $body$\n${body}\n$body$;`); objects.push({ kind: 'FUNCTION', target: fn + '()' });
      await sql(`CREATE TRIGGER ${quote(name)} BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`); objects.push({ kind: 'TRIGGER', target: `${quote(name)} ON ${table}` });
    }
    await sql(`INSERT INTO ${table} VALUES (77, 0)`);
    const native = String(scalar((await sql(`SELECT amount FROM ${table} WHERE id = 77`)).rows)); await client.rollback(); assert.equal(native, '14');
    const { buildTriggerTraceProgram } = loadTypeScript(`src/features/${database}/windows/trigger/triggerTraceProgram.ts`);
    const column = database === 'oracle' ? 'AMOUNT' : 'amount';
    const program = buildTriggerTraceProgram({ wizBody: body, wizSchema: schema, wizTargetObject: token + '_DATA', wizTiming: 'BEFORE', wizForEachRow: true,
      traceTargetDml: 'INSERT', traceInputData: { [column]: '0' }, structureDefs: [{ COLUMN_NAME: column, DATA_TYPE: 'NUMBER' }], checkWhere: '1=1',
      formatSqlValue: (_column, input) => input, wizAliasOld: 'OLD', newAliasRaw: 'NEW' });
    const identity = { schema, objectName: name, objectType: 'TRIGGER', tableName: token + '_DATA' };
    const result = await runTrace(sub, { schema, objectName: name, objectType: 'PROCEDURE', sourceText: program.sqlText, skipParse: true, traceIdentity: identity });
    assert.ok(result.variablesTrace.some(line => line.includes('V_N.AMOUNT = ' + native)));
    const store = new TraceDatabase(identity); await store.init();
    const steps = (await store.getTraceSteps()).map(step => ({ lineNum: step.line_num, loopPath: step.loop_path, variables: JSON.parse(step.variables_json) })); store.close();
    const outside = steps.filter(step => program.mapP2T[step.lineNum] === body.split('\n').findIndex(line => line.includes(':= total + 10')) + 1);
    assert.ok(outside.length); assert.ok(outside.every(step => step.loopPath === '')); replay(database, steps, outside[0].lineNum);
    assert.equal(Number(scalar((await sql(`SELECT COUNT(*) FROM ${table}`)).rows)), 0, 'Simulation must not insert source rows or fire the live trigger.');
  });

  await t.test('Unhandled stored exception rolls back data, saves no successful trace and leaves the next run usable', async sub => {
    const name = `${token}_FAIL`, routine = `${quote(schema)}.${quote(name)}`;
    const raising = database === 'oracle' ? "RAISE_APPLICATION_ERROR(-20019, 'MBT_NICHE_FAILURE');" : "RAISE EXCEPTION USING ERRCODE = 'P2019', MESSAGE = 'MBT_NICHE_FAILURE';";
    const source = database === 'oracle'
      ? `CREATE OR REPLACE FUNCTION ${routine}\nRETURN VARCHAR2\nIS\nBEGIN\n  INSERT INTO ${table} VALUES (88, 88);\n  ${raising}\n  RETURN 'unreachable';\nEND;`
      : `CREATE OR REPLACE FUNCTION ${routine}() RETURNS text LANGUAGE plpgsql AS $body$\nBEGIN\n  INSERT INTO ${table} VALUES (88, 88);\n  ${raising}\n  RETURN 'unreachable';\nEND;\n$body$;`;
    await sql(source); objects.push({ kind: 'FUNCTION', target: routine + (database === 'postgresql' ? '()' : '') });
    const identity = { schema, objectName: name, objectType: 'FUNCTION' };
    const sourceText = database === 'oracle' ? source : buildPgTraceProgram({ schema, objectType: 'FUNCTION', sourceText: source, finalArgs: {}, argumentsList: [], inputDateFormat: '', t: key => key });
    await assert.rejects(() => runTrace(sub, { ...identity, sourceText, skipParse: database === 'postgresql', traceIdentity: identity }), /MBT_NICHE_FAILURE/);
    assert.equal(TraceDatabase.exists(identity), false, 'Failure must not create a successful trace file.');
    await client.rollback(); assert.equal(Number(scalar((await sql(`SELECT COUNT(*) FROM ${table}`)).rows)), 0);
    const next = `${quote(schema)}.${quote(token + '_F0')}`;
    assert.equal(String(scalar((await sql(`SELECT ${next}()${database === 'oracle' ? ' FROM DUAL' : ''}`)).rows)), tracePrograms(database, table)[0].expected);
  });

  if (database === 'postgresql') await t.test('Native set-returning functions remain explicitly unsupported before a trace procedure or file is created', async () => {
    const name = `${token}_SET`, routine = `${quote(schema)}.${quote(name)}`;
    const source = `CREATE FUNCTION ${routine}() RETURNS SETOF integer LANGUAGE plpgsql AS $body$\nBEGIN\n  RETURN QUERY SELECT generate_series(1, 3);\nEND;\n$body$;`;
    await sql(source); objects.push({ kind: 'FUNCTION', target: routine + '()' });
    assert.deepEqual(Array.from((await sql(`SELECT * FROM ${routine}()`)).rows, row => Number(Object.values(row)[0])), [1, 2, 3]);
    const before = fs.readdirSync(directory);
    assert.throws(() => buildPgTraceProgram({ schema, objectType: 'FUNCTION', sourceText: source, finalArgs: {}, argumentsList: [], inputDateFormat: '', t: key => key }), /trace_(unsupported_source|set_returning_unsupported)/);
    assert.deepEqual(fs.readdirSync(directory), before); assert.equal(await remainingTemporary(`mona_${name.slice(0, 20)}_1`.toLowerCase()), 0);
  });
});
