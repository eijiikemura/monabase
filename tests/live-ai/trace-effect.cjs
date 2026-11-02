// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { createHookHarness } = require('../helpers/renderHook.cjs');
const { createTraceDatabase } = require('../../electron/services/traceStore');
const { createTraceIdentity } = require('../../electron/services/traceFiles');
const { translate } = require('../../electron/i18n');
const { safeAiError } = require('../../electron/services/aiErrors');
const { readKey } = require('./runner.cjs');
const { authorizeEffect, createPaidSession } = require('./effect.cjs');
const { getAiDatabaseContext } = require('../../electron/services/aiDatabaseContext');
const { buildRequestEvidence, emptyRequestBrief } = loadTypeScript('src/features/ai/requestEvidence.ts');
const quote = value => '"' + value.replaceAll('"', '""') + '"';

function createProgram(db, schema, name) {
  assert.ok(['oracle', 'postgresql'].includes(db)); assert.equal(schema.toLowerCase(), 'test');
  assert.match(name, /^MBT_[A-F0-9]{12}_LOOP$/);
  const routine = `${quote(schema)}.${quote(name)}`;
  const head = db === 'oracle' ? [`CREATE OR REPLACE FUNCTION ${routine}`, 'RETURN NUMBER', 'IS', '  v_total NUMBER := 0;', '  v_amount NUMBER := 0;']
    : [`CREATE OR REPLACE FUNCTION ${routine}() RETURNS integer LANGUAGE plpgsql AS $body$`, 'DECLARE', '  v_total integer := 0;', '  v_amount integer := 0;', '  i integer := 0;'];
  const lines = [...head, 'BEGIN', '  FOR i IN 1..5 LOOP', '    v_amount := i * 10;', '    IF i = 3 THEN', '      v_total := v_total - v_amount;', '    ELSE', '      v_total := v_total + v_amount;', '    END IF;', '  END LOOP;', '  RETURN v_total;', 'END;', ...(db === 'postgresql' ? ['$body$;'] : [])];
  return { db, schema, name, routine, source: lines.join('\n'), line: lines.indexOf('      v_total := v_total - v_amount;') + 1,
    expected: [1,2,3,4,5].reduce((sum, i) => sum + i * 10, 0), actual: 90 };
}
function valueAt(step, key) {
  const vars = JSON.parse(step.variables_json);
  const field = Object.keys(vars).find(name => name.toLowerCase() === key.toLowerCase());
  return field === undefined || vars[field] === null || vars[field] === '' ? null : Number(vars[field]);
}
function iterationAt(step) {
  const recorded = valueAt(step, 'i');
  if (recorded !== null) return recorded;
  // Oracle's implicit FOR index may be absent from variables; use the recorded loop path.
  const match = /^L1_iter(\d+)$/.exec(step.loop_path);
  return match ? Number(match[1]) : null;
}
function traceEvidence(trace, spec) {
  assert.ok(trace.traceInfo && Array.isArray(trace.traceSteps) && trace.traceSteps.length);
  const anchors = trace.traceSteps.filter(step => step.line_num === spec.line && iterationAt(step) === 3 && valueAt(step, 'v_total') === 30 && valueAt(step, 'v_amount') === 30);
  assert.ok(anchors.length, 'Trace must record the third-iteration subtraction with total=30 and amount=30.');
  // The immediately preceding IF snapshot has the same inputs and is valid evidence too.
  const before = trace.traceSteps.filter(step => step.step_id <= anchors[0].step_id && iterationAt(step) === 3 && valueAt(step, 'v_total') === 30 && valueAt(step, 'v_amount') === 30);
  const after = trace.traceSteps.filter(step => step.step_id > anchors[0].step_id && iterationAt(step) === 3 && valueAt(step, 'v_total') === 0 && valueAt(step, 'v_amount') === 30);
  assert.ok(after.length, 'Trace must expose the value 0 after the faulty subtraction.');
  const iterations = new Set(trace.traceSteps.map(step => iterationAt(step)).filter(value => value >= 1 && value <= 5));
  assert.deepEqual([...iterations].sort(), [1,2,3,4,5]);
  return { before: before.map(step => step.step_id), after: after.map(step => step.step_id) };
}
function validateDiagnosis(answer, spec, trace) {
  const text = answer.trim(), fence = /^```json\s*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  const value = JSON.parse(fence ? fence[1] : text);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), ['line','iteration','before','amount','after','expectedAfter','actualFinal','expectedFinal','evidenceStepIds','cause','replacement'].sort());
  for (const [field, expected] of Object.entries({ line: spec.line, iteration: 3, before: 30, amount: 30, after: 0, expectedAfter: 60, actualFinal: spec.actual, expectedFinal: spec.expected })) assert.equal(value[field], expected, `Incorrect diagnosis: ${field}`);
  assert.ok(typeof value.cause === 'string' && value.cause.trim());
  assert.ok(typeof value.replacement === 'string');
  assert.equal(value.replacement.replace(/\s+/g, '').toLowerCase(), 'v_total:=v_total+v_amount;', 'Only the intended one-line repair may be applied.');
  const evidence = traceEvidence(trace, spec);
  assert.ok(Array.isArray(value.evidenceStepIds) && value.evidenceStepIds.length >= 2);
  const ids = new Set(trace.traceSteps.map(step => step.step_id));
  assert.ok(value.evidenceStepIds.every(id => Number.isInteger(id) && ids.has(id)), 'Evidence must reference real exported steps.');
  assert.ok(value.evidenceStepIds.some(id => evidence.before.includes(id)), 'AI must cite the faulty-step input snapshot.');
  assert.ok(value.evidenceStepIds.some(id => evidence.after.includes(id)), 'AI must cite an observed post-assignment snapshot.');
  return value;
}

async function buildTracePrompt(client, spec, directory, TraceDatabase) {
  const handlers = new Map(), contexts = [], alerts = [];
  loadModule('electron/ipc/database.js', {
    '../services/storagePaths': { getStoragePaths: () => ({ traceDirectory: directory }) },
    '../oracle/traceDb': { TraceDatabase }, '../postgres/traceDb': { TraceDatabase },
    '../oracle/oracleClient': class {}, '../postgres/postgresClient': class {},
    '../oracle/traceExecutor': {}, '../postgres/traceExecutorPg': {}
  }, {}, { strict: false }).registerDatabaseHandlers({ state: { client, type: spec.db }, ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, getValidatedSettings: () => ({}), t: key => key });
  const harness = createHookHarness();
  const { useAiTraceDebug } = loadTypeScript('src/features/ai/useAiTraceDebug.ts', {
    react: harness.react,
    'react-i18next': { useTranslation: () => ({ t: (key, values) => translate(key, 'ja', values), i18n: { language: 'ja', resolvedLanguage: 'ja' } }) },
    './useAiObjectSelection': { useAiObjectSelection: () => ({ getSnapshot: () => [], isAvailable: () => true }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: (key, params) => { assert.equal(key, 'get-trace-for-ai'); return handlers.get(key)(null, params); } } }
  }, { crypto: { randomUUID }, alert: message => alerts.push(message), window: { confirm: () => { throw new Error('Synthetic trace should not require a capacity override.'); } } });
  try {
    const hook = harness.render(() => useAiTraceDebug({ dbType: spec.db, schema: spec.schema, objectName: spec.name, objectType: 'FUNCTION', sourceText: spec.source, isAiEnabled: true, onOpenAiSidebar: context => contexts.push(context) }));
    harness.commit(); await hook.requestDebug();
    assert.deepEqual(alerts, []); assert.equal(contexts.length, 1); assert.equal(contexts[0].requestType, 'debug_function');
    assert.ok(contexts[0].referencePrompt.includes(JSON.stringify(spec.source)));
    return contexts[0].referencePrompt;
  } finally { harness.unmount(); }
}
async function runTraceEffects({ configs, ask, log = console.log, databases = ['postgresql', 'oracle'], onObservation = () => {} }) {
  const reports = [];
  for (const db of databases) {
    assert.ok(['oracle', 'postgresql'].includes(db));
    const config = { ...configs[db] }; assert.equal(config.user, 'test'); assert.equal(config.schema, 'test');
    const Client = loadModule(`electron/${db === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`, { electron: { app: { isPackaged: true } } }, {}, { strict: false });
    const client = new Client(), directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ai-trace-'));
    const TraceDatabase = createTraceDatabase(db === 'oracle' ? 'oracle' : 'postgres', { getStoragePaths: () => ({ traceDirectory: directory }) });
    const executor = loadModule(`electron/${db === 'oracle' ? 'oracle/traceExecutor' : 'postgres/traceExecutorPg'}.js`, { './traceDb': { TraceDatabase } }, {}, { strict: false });
    let spec, created = false, temporary;
    const countObject = async name => Number(Object.values((await client.execute(db === 'oracle' ? 'SELECT COUNT(*) FROM USER_OBJECTS WHERE OBJECT_NAME = :name' : 'SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=:schema AND p.proname=:name', { name, ...(db === 'postgresql' ? { schema: spec.schema } : {}) })).rows[0])[0]);
    const callNative = async () => {
      if (db === 'postgresql') return Number(Object.values((await client.execute(`SELECT ${spec.routine}()`)).rows[0])[0]);
      const oracle = require('oracledb');
      return Number((await client.connection.execute(`BEGIN :result := ${spec.routine}(); END;`, { result: { dir: oracle.BIND_OUT, type: oracle.NUMBER } })).outBinds.result);
    };
    const traceRun = async source => {
      const { buildPgTraceProgram } = loadTypeScript('src/features/postgresql/windows/stored/traceProgramBuilder.ts');
      const sourceText = db === 'oracle' ? source : buildPgTraceProgram({ schema: spec.schema, objectType: 'FUNCTION', sourceText: source, finalArgs: {}, argumentsList: [], inputDateFormat: 'YYYY-MM-DD HH24:MI:SS', t: key => key });
      const target = { schema: spec.schema, objectName: spec.name, objectType: 'FUNCTION' };
      const identity = createTraceIdentity(client.lastConfig, target);
      const result = await (db === 'oracle' ? executor.executeTrace(client.connection, { ...target, sourceText, args: {}, traceIdentity: identity })
        : executor.executeTracePg(client, { ...target, sourceText, originalSourceText: source, args: {}, skipParse: true, traceIdentity: identity }));
      assert.equal(result.success, true, 'Production trace acquisition failed.');
      const store = new TraceDatabase(identity); await store.init();
      const trace = { traceInfo: await store.getTraceInfo(), traceSteps: await store.getTraceSteps() }; store.close();
      return { result: Number(result.returnValues[0].value), trace };
    };
    try {
      try { await client.connect({ ...config, queryTimeout: 60 }); } catch { throw new Error(`${db}: dedicated trace database connection failed.`); }
      const schema = String(Object.values((await client.execute(db === 'oracle' ? 'SELECT USER FROM DUAL' : 'SELECT current_schema()')).rows[0])[0]);
      assert.equal(schema, db === 'oracle' ? 'TEST' : 'test');
      spec = createProgram(db, schema, `MBT_${randomBytes(6).toString('hex').toUpperCase()}_LOOP`);
      temporary = `${db === 'oracle' ? 'MONA' : 'mona'}_${spec.name.slice(0,20)}_1`; if (db === 'postgresql') temporary = temporary.toLowerCase();
      assert.equal(await countObject(temporary), 0);
      assert.equal(await countObject(spec.name), 0);
      await client.execute(spec.source); created = true; await client.commit();
      if (db === 'oracle') assert.equal((await client.execute('SELECT TEXT FROM USER_ERRORS WHERE NAME=:name', { name: spec.name })).rows.length, 0);
      const native = await callNative(); await client.rollback(); assert.equal(native, spec.actual);
      const before = await traceRun(spec.source); assert.equal(before.result, native); traceEvidence(before.trace, spec);
      assert.equal(before.trace.traceInfo.executed_source, spec.source);
      const prompt = await buildTracePrompt(client, spec, directory, TraceDatabase) + '\n' + buildRequestEvidence(await getAiDatabaseContext(client, db), {
        ...emptyRequestBrief(), inputExample: 'Loop i=1..5; each iteration contributes i*10.', expectedResult: '150', actualResult: String(native),
        constraints: 'Preserve the signature and return type; repair only the first incorrect assignment.', verification: 'Native execution and instrumented execution both returned 90.'
      });
      const request = [
        'この関数は1から5までループし、各回の i * 10 を合計する仕様です。期待結果は150ですが実際は90になりました。実際のトレースを根拠に、最初に仕様から逸脱する処理・反復回・変数の変化・原因と最小修正を特定してください。',
        'lineは誤った値を初めて観測した行ではなく、原因となる代入文そのものの行番号です。各スナップショットはそのステップの文の実行前です。代入後の値は次のステップで確認してください。',
        '回答はJSONのみで、キーはline（元ソースの行番号）, iteration, before（逸脱する代入の前の累計）, amount（加えるはずの値）, after（実際の代入後累計）, expectedAfter, actualFinal, expectedFinal, evidenceStepIds（代入前と代入後の観測を裏付ける実在step_idの配列）, cause（日本語）, replacement（置き換える代入文1行）としてください。数値項目は数値にし、未記録の値を観測済みと断定しないでください。DBに接続したりSQLを実行したと主張しないでください。'
        , '以下はcurrentSourceに1から行番号を付けた参照表示です。空行も1行と数えています。\n' + spec.source.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n')
      ].join('\n');
      const response = await ask(`${prompt}\n\n${request}`, spec, before.trace);
      await onObservation({ database: db, source: spec.source, trace: before.trace, answer: response.answer, usage: response.usage });
      const diagnosis = validateDiagnosis(response.answer, spec, before.trace);
      const lines = spec.source.split('\n'); assert.equal(lines[diagnosis.line - 1].trim(), 'v_total := v_total - v_amount;');
      lines[diagnosis.line - 1] = '      ' + diagnosis.replacement.trim(); const repaired = lines.join('\n');
      await client.execute(repaired); await client.commit();
      const fixedNative = await callNative(); await client.rollback(); assert.equal(fixedNative, spec.expected);
      const after = await traceRun(repaired); assert.equal(after.result, spec.expected);
      assert.ok(after.trace.traceSteps.some(step => iterationAt(step) === 3 && valueAt(step, 'v_total') === 60), 'Repaired trace must observe the correct third-iteration total.');
      assert.equal(await countObject(temporary), 0);
      reports.push({ database: db, source: spec.source, repairedSource: repaired, badLine: spec.line, diagnosis, beforeResult: native, afterResult: fixedNative, beforeTrace: before.trace, afterTrace: after.trace, usage: response.usage });
      log(JSON.stringify({ database: db, line: spec.line, iteration: diagnosis.iteration, observed: `${diagnosis.before} -> ${diagnosis.after}`, expectedAfter: diagnosis.expectedAfter, beforeResult: native, afterResult: fixedNative, steps: before.trace.traceSteps.length }));
    } finally {
      try {
        await client.rollback();
        let residueRemoved = false;
        if (spec && temporary && await countObject(temporary)) {
          await client.execute(`DROP ${db === 'oracle' ? 'FUNCTION' : 'PROCEDURE'} ${quote(spec.schema)}.${quote(temporary)}${db === 'postgresql' ? '()' : ''}`);
          residueRemoved = true;
        }
        if (created) { await client.execute(`DROP FUNCTION ${spec.routine}${db === 'postgresql' ? '()' : ''}`); await client.commit(); assert.equal(await countObject(spec.name), 0); }
        assert.equal(residueRemoved, false, 'Executor left a temporary trace routine; run-owned residue was removed.');
      } finally { await client.disconnect(); fs.rmSync(directory, { recursive: true, force: true }); }
    }
  }
  return reports;
}
async function main() {
  authorizeEffect(process.argv.slice(2));
  const configs = JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8'));
  console.log('Trace diagnosis tests: 2 paid requests maximum, gpt-4o-mini, 1024 output tokens each. Enter the authorized temporary key on stdin.');
  let apiKey = await readKey(); const paid = createPaidSession(apiKey, globalThis.fetch, { requestType: 'debug_function', maxRequests: 2 });
  try {
    const directory = path.resolve('local/ai-test-reports'); fs.mkdirSync(directory, { recursive: true });
    const reports = await runTraceEffects({ configs, ask: prompt => paid.ask(prompt), onObservation: observation => {
      const file = path.join(directory, `trace-observation-${Date.now()}-${observation.database}.json`);
      fs.writeFileSync(file, JSON.stringify({ status: 'received-not-yet-validated', ...observation }, null, 2) + '\n', { mode: 0o600 });
    } });
    const file = path.join(directory, `trace-effect-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), requests: paid.calls, reports }, null, 2) + '\n', { mode: 0o600 });
    console.log(`PASS ${reports.length} real trace diagnoses and verified repairs; paid requests=${paid.calls}; report=${path.relative(process.cwd(), file)}`);
  } catch (error) { throw new Error(safeAiError(error.code === 'ERR_ASSERTION' ? error.message : (error.code || error.message), apiKey)); }
  finally { paid.dispose(); apiKey = ''; }
}
if (require.main === module) main().catch(error => { console.error(safeAiError(error.message)); process.exitCode = 1; });
module.exports = { createProgram, iterationAt, traceEvidence, validateDiagnosis, buildTracePrompt, runTraceEffects };
