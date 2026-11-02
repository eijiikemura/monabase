// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { performance } = require('node:perf_hooks');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { createDatabaseIpc } = require('../helpers/ddlEditors.cjs');
const { translate } = require('../../electron/i18n');
const { safeAiError } = require('../../electron/services/aiErrors');
const { readKey, ENDPOINT } = require('./runner.cjs');
const { getAiDatabaseContext } = require('../../electron/services/aiDatabaseContext');
const { buildRequestEvidence, emptyRequestBrief } = loadTypeScript('src/features/ai/requestEvidence.ts');

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function authorizeEffect(args, env = process.env) {
  if (env.CI && env.CI !== 'false') throw new Error('Paid DB/AI effect tests are forbidden in CI.');
  if (args.length !== 1 || args[0] !== '--allow-paid') throw new Error('Explicit --allow-paid is required.');
  if (env.MONABASE_DB_TEST_ALLOW_WRITE !== '1' || !env.MONABASE_TEST_CONFIG) throw new Error('Dedicated DB write opt-in and local config path are required.');
}
function scenario(db, schema, token, kind) {
  assert.ok(['oracle', 'postgresql'].includes(db));
  assert.ok(/^MBT_[A-F0-9]{12}$/.test(token));
  assert.equal(schema.toLowerCase(), 'test');
  const name = token + '_AI', indexName = token + '_IX';
  const table = `${quote(schema)}.${quote(name)}`;
  const query = `SELECT "ID", "LABEL" FROM ${table} WHERE "ID" = 42421`;
  const slowQuery = kind === 'missing-index' ? query : `SELECT "ID", "LABEL" FROM ${table} WHERE ${db === 'oracle' ? 'TO_CHAR("ID")' : 'CAST("ID" AS text)'} = '42421'`;
  return { db, schema, name, indexName, table, kind, query, slowQuery };
}
function validateProposal(answer, spec) {
  const text = answer.trim();
  const fence = /^```json\s*\r?\n([\s\S]*?)\r?\n?```$/i.exec(text);
  const proposal = JSON.parse(fence ? fence[1] : text);
  assert.ok(proposal && typeof proposal === 'object' && !Array.isArray(proposal));
  assert.deepEqual(Object.keys(proposal).sort(), ['explanation', 'indexSql', 'query']);
  assert.ok(typeof proposal.explanation === 'string' && proposal.explanation.trim());
  assert.ok(typeof proposal.query === 'string' && typeof proposal.indexSql === 'string');
  const normalize = sql => sql.trim().replace(/;\s*$/, '').replace(/\s+/g, ' ');
  // Only the exact reviewed read-only query is executable; not arbitrary AI SQL.
  assert.equal(normalize(proposal.query), spec.query, 'The proposed SELECT is outside the reviewed fixture query.');
  let indexSql = '';
  if (proposal.indexSql.trim()) {
    const sql = normalize(proposal.indexSql);
    const prefix = `CREATE INDEX ${spec.db === 'oracle' ? quote(spec.schema) + '.' : ''}${quote(spec.indexName)} ON ${spec.table} `;
    assert.ok(sql.startsWith(prefix), 'Index must use the run-owned name and table.');
    const columns = sql.slice(prefix.length);
    assert.ok(/^\("(?:ID|LABEL|PAD)"(?:, ?"(?:ID|LABEL|PAD)")*\)$/.test(columns), 'Only ordinary fixture-column indexes are permitted.');
    indexSql = sql;
  }
  if (spec.kind === 'missing-index') assert.ok(indexSql, 'Missing-index case must propose a new index.');
  else assert.equal(indexSql, '', 'Rewrite case must use the existing index, without adding another.');
  return { query: spec.query, indexSql, explanation: proposal.explanation };
}

function createPaidSession(apiKey, fetchImpl = globalThis.fetch, { requestType = 'sql_tuning', maxRequests = 4, model = 'gpt-4o-mini' } = {}) {
  assert.ok(['sql_tuning', 'debug_function', 'coding_trigger', 'coding_procedure', 'coding_function', 'coding_package'].includes(requestType));
  assert.ok(Number.isInteger(maxRequests) && maxRequests >= 1 && maxRequests <= 4);
  assert.ok(['gpt-4o-mini','gpt-4.1-mini','gpt-6-luna'].includes(model));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ai-effect-'));
  const file = path.join(directory, 'ai.json'); fs.writeFileSync(file, '{}', { mode: 0o600 });
  const handlers = new Map(), sender = Object.assign(new EventEmitter(), { id: 521, isDestroyed: () => false, send() {} });
  let calls = 0, allowed = 0;
  loadModule('electron/ipc/ai.js', {}, { fetch: async (url, options) => {
    assert.equal(url, ENDPOINT); assert.ok(calls < maxRequests && calls < allowed, 'Paid retry/request ceiling reached.'); calls++;
    const payload = JSON.parse(options.body);
    // Reasoning tokens share the completion budget; retain the model's default reasoning setting.
    payload.max_completion_tokens = model === 'gpt-6-luna' ? 4096 : 1024;
    return fetchImpl(url, { ...options, body: JSON.stringify(payload) });
  } }, { strict: false }).registerAiHandlers({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, BrowserWindow: { getAllWindows: () => [] },
    aiSettingsStore: { load: () => ({ isAiEnabled: true, apiKey, modelName: model, endpointUrl: 'https://api.openai.com/v1' }) },
    getValidatedSettings: () => ({ aiResponseMaxMb: 1, aiIdleTimeoutSeconds: 30, aiRequestTimeoutSeconds: 60 }),
    AI_CONFIG_FILE: file, AI_DIR: directory, AI_USAGE_DIR: path.join(directory, 'usage'), t: key => key
  });
  return {
    async ask(prompt) {
      allowed = calls + 1;
      const result = await handlers.get('ask-ai')({ sender }, prompt, [], requestType, `effect-${calls}`);
      if (!result.success) throw new Error(safeAiError(result.error, apiKey));
      assert.equal(result.historyError, undefined);
      assert.ok(typeof result.answer === 'string' && !result.answer.includes(apiKey), 'Response must not contain credentials.');
      assert.ok(result.usage.promptTokens > 0 && result.usage.completionTokens > 0);
      return result;
    },
    get calls() { return calls; },
    dispose() { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

async function tuningContext(client, spec, plan) {
  const contexts = [], alerts = [], invoke = createDatabaseIpc(client, spec.db);
  const { useSqlWindowBottom } = loadTypeScript('src/features/sql/useSqlWindowBottom.ts', {
    './explainIdentity': loadTypeScript('src/features/sql/explainIdentity.ts'),
    react: { useMemo: fn => fn(), useState: value => [value, () => {}] },
    'react-i18next': { useTranslation: () => ({ t: (key, values) => translate(key, 'en', values), i18n: { language: 'en' } }) },
    '../data-grid/dataGridHelper': { buildTransposedColumns: () => [] },
    '@/shared/api/desktop': { ipcRenderer: { invoke: (channel, query, binds) => { assert.equal(channel, 'execute-sql-bg'); return invoke(channel, query, binds); } } }
  }, { alert: message => alerts.push(message) });
  const hook = useSqlWindowBottom({ rows: plan.rows, columns: [], isExplainResult: true, dbType: spec.db,
    explainSnapshot: { sql: spec.slowQuery, schema: spec.schema, rows: plan.rows },
    dateFormat: 'YYYY-MM-DD', selectedSchema: spec.schema, sqlText: spec.slowQuery,
    title: 'Synthetic tuning effect test', isAiEnabled: true, onOpenAiSidebar: context => contexts.push(context) });
  await hook.handleExportForAI();
  assert.deepEqual(alerts, []); assert.equal(contexts.length, 1);
  const prompt = contexts[0].initialPrompt;
  assert.ok(prompt.includes(spec.slowQuery) && prompt.includes(spec.name));
  return prompt;
}
const logicalReadsSql = `SELECT ss.VALUE AS "READS" FROM SYS.V_$SESSTAT ss JOIN SYS.V_$STATNAME sn ON sn.STATISTIC# = ss.STATISTIC# WHERE ss.SID = TO_NUMBER(SYS_CONTEXT('USERENV', 'SID')) AND sn.NAME = 'session logical reads'`;
async function measure(client, spec, query) {
  const execute = text => client.execute(text);
  // Warm the query without clearing shared caches or changing server settings.
  await execute(query);
  const timings = [], blocks = [], plans = [];
  for (let i = 0; i < 5; i++) {
    if (spec.db === 'postgresql') {
      const result = await execute(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query}`);
      const raw = result.rows[0]['QUERY PLAN']; const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw)[0];
      timings.push(plan['Execution Time']); blocks.push((plan.Plan['Shared Hit Blocks'] || 0) + (plan.Plan['Shared Read Blocks'] || 0)); plans.push(plan);
    } else {
      const before = Number((await execute(logicalReadsSql)).rows[0].READS);
      const start = performance.now(); await execute(query); timings.push(performance.now() - start);
      const after = Number((await execute(logicalReadsSql)).rows[0].READS); blocks.push(after - before);
    }
  }
  assert.ok(blocks.every(value => Number.isFinite(value) && value > 0));
  return { medianMs: median(timings), medianBlocks: median(blocks), plans };
}
function assertImproved(before, after) {
  assert.ok([before.medianBlocks, after.medianBlocks].every(value => Number.isFinite(value) && value > 0));
  assert.ok(after.medianBlocks <= before.medianBlocks * 0.2, 'AI proposal must reduce actual buffer/logical reads by at least 80%.');
  assert.ok(Number.isFinite(before.medianMs) && Number.isFinite(after.medianMs));
}
const sortRows = rows => rows.map(row => JSON.stringify({ ID: row.ID == null ? null : String(row.ID), LABEL: row.LABEL })).sort();
async function runEffects({ configs, ask, log = console.log, databases = ['postgresql', 'oracle'] }) {
  const reports = [];
  for (const db of databases) {
    assert.ok(['oracle', 'postgresql'].includes(db));
    const config = { ...configs[db] }; assert.equal(config.user, 'test'); assert.equal(config.schema, 'test');
    const Client = loadModule(`electron/${db === 'oracle' ? 'oracle/oracleClient' : 'postgres/postgresClient'}.js`, { electron: { app: { isPackaged: true } } }, {}, { strict: false });
    const client = new Client();
    try {
      try { await client.connect({ ...config, queryTimeout: 60 }); }
      catch { throw new Error(`${db}: dedicated database connection failed; details omitted.`); }
      const identity = await client.execute(db === 'oracle' ? 'SELECT USER AS "SCHEMA" FROM DUAL' : 'SELECT current_schema() AS "SCHEMA"');
      const schema = identity.rows[0].SCHEMA; assert.equal(schema, db === 'oracle' ? 'TEST' : 'test');
      for (const kind of ['missing-index', 'non-sargable']) {
        const spec = scenario(db, schema, `MBT_${randomBytes(6).toString('hex').toUpperCase()}`, kind);
        let created = false;
        try {
          await client.execute(`CREATE TABLE ${spec.table} ("ID" ${db === 'oracle' ? 'NUMBER(10)' : 'integer'}, "LABEL" ${db === 'oracle' ? 'VARCHAR2(40)' : 'varchar(40)'}, "PAD" ${db === 'oracle' ? 'VARCHAR2(200)' : 'varchar(200)'})`); created = true;
          await client.execute(db === 'oracle'
            ? `INSERT INTO ${spec.table} SELECT LEVEL, 'row-' || TO_CHAR(LEVEL), RPAD('x', 200, 'x') FROM DUAL CONNECT BY LEVEL <= 100000`
            : `INSERT INTO ${spec.table} SELECT n, 'row-' || n::text, repeat('x', 200) FROM generate_series(1,100000) AS n`);
          for (const [id, label] of [[null, 'null'], [-1, 'negative'], [0, 'zero'], [42421, 'duplicate'], [424210, 'nearby']]) {
            await client.execute(`INSERT INTO ${spec.table} ("ID", "LABEL", "PAD") VALUES (:id, :label, 'edge')`, { id, label });
          }
          await client.commit();
          if (kind === 'non-sargable') await client.execute(`CREATE INDEX ${db === 'oracle' ? quote(schema) + '.' : ''}${quote(spec.indexName)} ON ${spec.table} ("ID")`);
          if (db === 'oracle') await client.execute('BEGIN DBMS_STATS.GATHER_TABLE_STATS(ownname => :owner, tabname => :tableName, cascade => TRUE); END;', { owner: schema, tableName: spec.name });
          else await client.execute(`ANALYZE ${spec.table}`);
          await client.commit();
          const beforePlan = await client.explain(spec.slowQuery);
          const planText = JSON.stringify(beforePlan.rows);
          assert.ok(db === 'oracle' ? /TABLE ACCESS FULL/.test(planText) : /Seq Scan/.test(planText), 'Fixture must start with an inefficient full-table scan.');
          const beforeRows = (await client.execute(spec.slowQuery)).rows;
          assert.equal(beforeRows.length, 2); const expectedRows = (await client.execute(spec.query)).rows; assert.deepEqual(sortRows(beforeRows), sortRows(expectedRows));
          const before = await measure(client, spec, spec.slowQuery);
          const context = await tuningContext(client, spec, beforePlan) + '\n' + buildRequestEvidence(await getAiDatabaseContext(client, db), {
            ...emptyRequestBrief(), expectedResult: 'Preserve the complete result multiset including duplicates and NULL behavior.',
            constraints: kind === 'missing-index' ? 'Only one run-owned ordinary index may be added.' : 'Use the existing index; do not add another index.',
            verification: JSON.stringify({ measuredRequestMedianMs: before.medianMs, measuredReads: before.medianBlocks, returnedRows: beforeRows.length })
          });
          const instruction = [
            'Review this real synthetic test-database tuning context and propose an effective optimization. Do not claim to execute anything.',
            'Return ONLY JSON with exactly query, indexSql, explanation. Keep the SELECT projection as "ID", "LABEL", fully qualified quoted table, numeric constant 42421, no aliases, comments or hints.',
            'Preserve the returned rows, including duplicates. Use a simple numeric equality if rewriting the ID predicate.',
            kind === 'missing-index' ? `You may propose one ordinary CREATE INDEX on this table, named ${db === 'oracle' ? quote(schema) + '.' : ''}${quote(spec.indexName)}. Leave the original equality query unchanged. No schema changes other than that index.` : 'Use the existing ordinary ID index; rewrite the predicate without creating any index. indexSql must be an empty string.',
            'No multiple statements, functions, session/server settings or other objects. Explain why this improves the supplied plan.',
            context
          ].join('\n\n');
          const response = await ask(instruction, spec);
          const proposal = validateProposal(response.answer, spec);
          if (proposal.indexSql) await client.execute(proposal.indexSql);
          await client.commit();
          const afterRows = (await client.execute(proposal.query)).rows;
          assert.deepEqual(sortRows(afterRows), sortRows(beforeRows), 'Tuning must preserve the complete result multiset.');
          const afterPlan = await client.explain(proposal.query);
          assert.ok(/INDEX|Index|Bitmap/.test(JSON.stringify(afterPlan.rows)), 'The proposed query must actually use an index.');
          const after = await measure(client, spec, proposal.query); assertImproved(before, after);
          const count = await client.execute(`SELECT COUNT(*) AS "N" FROM ${spec.table}`); assert.equal(Number(count.rows[0].N), 100005);
          const report = { database: db, case: kind, rows: 100005, matchedRows: afterRows.length, beforeMs: before.medianMs, afterMs: after.medianMs,
            beforeBlocks: before.medianBlocks, afterBlocks: after.medianBlocks, blockMetric: db === 'oracle' ? 'session logical reads' : 'shared hit + read blocks',
            proposal, beforePlan: beforePlan.rows, afterPlan: afterPlan.rows, usage: response.usage };
          reports.push(report); log(JSON.stringify({ database: db, case: kind, beforeMs: +report.beforeMs.toFixed(3), afterMs: +report.afterMs.toFixed(3), beforeBlocks: report.beforeBlocks, afterBlocks: report.afterBlocks, matchedRows: afterRows.length }));
        } finally {
          await client.rollback();
          if (created) await client.execute(`DROP TABLE ${spec.table}${db === 'oracle' ? ' PURGE' : ''}`);
          const remaining = await client.execute(db === 'oracle' ? 'SELECT COUNT(*) AS "N" FROM USER_TABLES WHERE TABLE_NAME = :name' : 'SELECT COUNT(*) AS "N" FROM information_schema.tables WHERE table_schema = :schema AND table_name = :name', db === 'oracle' ? { name: spec.name } : { schema, name: spec.name });
          assert.equal(Number(remaining.rows[0].N), 0, 'Run-owned fixture must be removed.');
        }
      }
    } finally { await client.disconnect(); }
  }
  return reports;
}
async function main() {
  authorizeEffect(process.argv.slice(2));
  const configs = JSON.parse(fs.readFileSync(process.env.MONABASE_TEST_CONFIG, 'utf8'));
  console.log('Effect tests: 4 paid requests maximum, gpt-4o-mini, 1024 output tokens per request. Enter the authorized temporary key on stdin.');
  let apiKey = await readKey(); const paid = createPaidSession(apiKey);
  try {
    const reports = await runEffects({ configs, ask: prompt => paid.ask(prompt) });
    const directory = path.resolve('local/ai-test-reports'); fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `tuning-effect-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), requests: paid.calls, reports }, null, 2) + '\n', { mode: 0o600 });
    console.log(`PASS ${reports.length} effect scenarios; paid requests=${paid.calls}; report=${path.relative(process.cwd(), file)}`);
  } catch (error) { throw new Error(safeAiError(error.code === 'ERR_ASSERTION' ? error.message : (error.code || error.message), apiKey)); }
  finally { paid.dispose(); apiKey = ''; }
}
if (require.main === module) main().catch(error => { console.error(safeAiError(error.message)); process.exitCode = 1; });
module.exports = { authorizeEffect, scenario, validateProposal, createPaidSession, runEffects, assertImproved, median };
