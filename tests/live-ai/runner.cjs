// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { loadModule } = require('../helpers/loadModule.cjs');
const { loadTypeScript } = require('../helpers/loadTypeScript.cjs');
const { safeAiError } = require('../../electron/services/aiErrors');

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MAX_REQUESTS = 8;
const MAX_COMPLETION_TOKENS = 512;
const coding = loadTypeScript('src/features/ai/codingResponse.ts', { i18next: { t: key => key } });
const trigger = loadTypeScript('src/features/ai/triggerBodyResponse.ts', { './codingResponse': coding });
const generator = loadTypeScript('src/features/data-generator/generatorValidation.ts');
const jsonInstruction = 'Return only JSON with exactly status, source, message in that order. Use status="success", message="", and put the requested code in source. No markdown.';
const parse = answer => { const value = coding.parseCodingResponse(answer); assert.equal(value.status, 'success'); return value.source; };
const rule = { COLUMN_NAME: 'ID', DATA_TYPE: 'integer', NULLABLE: 'N', ruleType: 'SEQ_NUM', nullRatio: 0, randCharType: 'ALPHA', seqStart: '1', seqStep: '1' };
const cases = [
  ...['oracle', 'postgresql'].map(db => ({
    name: `${db}: SQL generation and streaming`, type: 'sql_generation', stream: true,
    prompt: `${jsonInstruction} Write ${db} SQL that selects ID from fictional table MB_AI_DEMO where ID = 7. Do not execute it.`,
    validate(answer) { const source = parse(answer); assert.match(source, /SELECT\b/i); assert.match(source, /MB_AI_DEMO/i); assert.match(source, /\b7\b/); }
  })),
  { name: 'PostgreSQL: stored function coding', type: 'coding_function', stream: true,
    prompt: `${jsonInstruction} Write a PostgreSQL PL/pgSQL function mb_ai_add_one(p_value integer) returning integer. Return p_value + 1. Do not execute it.`,
    validate(answer) { const source = parse(answer); assert.match(source, /mb_ai_add_one/i); assert.match(source, /p_value\s*\+\s*1/i); assert.match(source, /plpgsql/i); } },
  ...['oracle', 'postgresql'].map(db => ({
    name: `${db}: trigger body and settings`, type: 'coding_trigger', stream: true,
    prompt: `Return only a JSON object with exactly status, source, message, settings. status="success", message="". settings must contain exactly timing="BEFORE", events=["INSERT"], forEachRow=true. Write only a ${db} trigger body BEGIN ... END; for table MB_AI_DEMO that makes the NEW.ID column equal to 7. ${db === 'oracle' ? 'Use :NEW.ID := 7;' : 'Use NEW.ID := 7; and RETURN NEW;'} The response must follow this exact shape: {"status":"success","source":"BEGIN ... END;","message":"","settings":{"timing":"BEFORE","events":["INSERT"],"forEachRow":true}}. No CREATE statement, markdown or explanations. Do not execute it.`,
    validate(answer) { const value = trigger.parseTriggerCodingResponse(answer, db, 'TABLE'); assert.equal(value.status, 'success'); trigger.validateTriggerBody(value.source); assert.equal(value.settings.timing, 'BEFORE'); assert.deepEqual([...value.settings.events], ['INSERT']); assert.equal(value.settings.forEachRow, true); assert.match(value.source, /NEW\.ID\s*:=\s*7/i); }
  })),
  { name: 'Trace analysis: recorded values and Japanese response', type: 'debug_function',
    prompt: '架空のトレースです。実DBに接続せず、記録だけを説明してください。期待値は3、記録は[{"line":1,"x":1},{"line":2,"x":2}]。結果が期待値に足りないことを「記録では2、期待値は3」という表現を含めて日本語の一文で述べてください。未記録の実行は推測しないでください。',
    validate(answer) { assert.ok(answer.includes('記録では2、期待値は3')); } },
  { name: 'SQL tuning: conversation context', type: 'sql_tuning', history: [{ role: 'user', content: 'Our fictional PostgreSQL table MB_AI_DEMO(ID integer) has no index. The plan uses Seq Scan for WHERE ID = 7.' }, { role: 'assistant', content: 'I will review this supplied plan without accessing a database.' }],
    prompt: 'In at most two sentences, suggest an index on MB_AI_DEMO(ID) and verifying it using EXPLAIN. Do not claim to have run anything.',
    validate(answer) { assert.match(answer, /index/i); assert.match(answer, /EXPLAIN/i); } },
  { name: 'Data generator: settings validation and exact integers', type: 'data_generator',
    prompt: 'Return only JSON with generateCount:2 and rules:[{COLUMN_NAME:"ID",ruleType:"SEQ_NUM",seqStart:"9007199254740993",seqStep:"1",nullRatio:0}]. Keep the large number as a quoted string. No markdown or other fields. These are fictional settings; do not insert data.',
    validate(answer) { const value = JSON.parse(answer); const merged = generator.mergeGenerationSettings(value, [rule], 1, key => key); assert.equal(merged.generateCount, 2); assert.equal(generator.sequenceValue(merged.rules[0].seqStart, merged.rules[0].seqStep, 1), '9007199254740994'); } }
];

function authorize(args, env = process.env) {
  if (env.CI && env.CI !== 'false') throw new Error('Paid AI tests are forbidden in CI.');
  if (!args.includes('--allow-paid') || args.some(arg => arg !== '--allow-paid' && !/^--from=[0-7]$/.test(arg)) || args.filter(arg => arg.startsWith('--from=')).length > 1) throw new Error('Explicit --allow-paid is required. Run only after a fresh user request and temporary key.');
}

// Read a one-time key from stdin, never from arguments, files or personal settings.
async function readKey(input = process.stdin) {
  if (input.isTTY) input.setRawMode(true);
  let value = '';
  try {
    for await (const chunk of input) {
      const text = chunk.toString();
      if (text.includes('\u0003')) throw new Error('Cancelled before any API request.');
      value += text;
      if (value.length > 1024) throw new Error('Invalid temporary key input.');
      if (/[\r\n]/.test(value)) break;
    }
  } finally { if (input.isTTY) input.setRawMode(false); input.pause(); }
  const key = value.trim();
  if (!/^sk-[A-Za-z0-9_-]{20,1000}$/.test(key)) throw new Error('A temporary OpenAI key is required on stdin.');
  return key;
}

async function runLiveAi({ apiKey, fetchImpl = globalThis.fetch, log = console.log, from = 0 }) {
  assert.ok(Number.isInteger(from) && from >= 0 && from < cases.length);
  const selected = cases.slice(from);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-live-ai-'));
  let calls = 0, allowedCalls = 0, inputTokens = 0, outputTokens = 0;
  try {
    const configFile = path.join(directory, 'ai.json'); fs.writeFileSync(configFile, '{}', { mode: 0o600 });
    const handlers = new Map(), chunks = [];
    const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, send: (channel, data) => { if (channel === 'ai-response-chunk') chunks.push(data); } });
    const boundedFetch = async (url, options) => {
      assert.equal(url, ENDPOINT);
      assert.ok(calls < MAX_REQUESTS && calls < allowedCalls, 'Request ceiling reached; automatic retry is forbidden.');
      calls++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'gpt-4o-mini');
      // This test-only cap leaves production request defaults unchanged.
      payload.max_completion_tokens = MAX_COMPLETION_TOKENS;
      return fetchImpl(url, { ...options, body: JSON.stringify(payload) });
    };
    loadModule('electron/ipc/ai.js', {}, { fetch: boundedFetch }, { strict: false }).registerAiHandlers({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, BrowserWindow: { getAllWindows: () => [] },
      aiSettingsStore: { load: () => ({ isAiEnabled: true, apiKey, modelName: 'gpt-4o-mini', endpointUrl: 'https://api.openai.com/v1' }) },
      getValidatedSettings: () => ({ aiResponseMaxMb: 1, aiIdleTimeoutSeconds: 30, aiRequestTimeoutSeconds: 60 }),
      AI_CONFIG_FILE: configFile, AI_DIR: directory, AI_USAGE_DIR: path.join(directory, 'usage'), t: key => key
    });
    for (const [index, scenario] of selected.entries()) {
      allowedCalls = calls + 1;
      const before = calls; chunks.length = 0;
      const result = await handlers.get('ask-ai')({ sender }, scenario.prompt, scenario.history || [], scenario.type, `live-${index}`, { stream: scenario.stream === true });
      if (!result.success) throw new Error(`${scenario.name}: ${safeAiError(result.error, apiKey)}`);
      assert.equal(calls - before, 1, 'Each scenario must issue exactly one HTTP request.');
      assert.equal(result.historyError, undefined);
      assert.ok(result.answer && !result.answer.includes(apiKey), 'Response must contain an answer without credentials.');
      try { scenario.validate(result.answer); }
      catch (error) {
        let shape = 'non-JSON response';
        try { const value = JSON.parse(result.answer); shape = JSON.stringify({ keys: Object.keys(value), status: value.status, settingsKeys: value.settings && Object.keys(value.settings) }); } catch {}
        throw new Error(`${scenario.name}: validation failed (${shape}): ${error.message}`);
      }
      assert.ok(result.usage.promptTokens > 0); assert.ok(result.usage.completionTokens > 0);
      if (scenario.stream) { assert.ok(chunks.length > 0); assert.equal(chunks.at(-1).text, result.answer); }
      assert.equal(sender.listenerCount('destroyed'), 0);
      inputTokens += result.usage.promptTokens; outputTokens += result.usage.completionTokens;
      log(`PASS ${scenario.name} (input=${result.usage.promptTokens}, output=${result.usage.completionTokens})`);
    }
    const records = await handlers.get('get-ai-usage-history')({}, new Date().getFullYear());
    assert.equal(records.success, true); assert.equal(records.records.length, selected.length);
    assert.equal(records.records.reduce((sum, r) => sum + r.inputTokens, 0), inputTokens);
    assert.equal(records.records.reduce((sum, r) => sum + r.outputTokens, 0), outputTokens);
    for (const file of fs.readdirSync(path.join(directory, 'usage'))) assert.ok(!fs.readFileSync(path.join(directory, 'usage', file), 'utf8').includes(apiKey));
    log(`PASS usage history; requests=${calls}, input=${inputTokens}, output=${outputTokens}`);
    return { requests: calls, inputTokens, outputTokens };
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  authorize(process.argv.slice(2));
  const from = Number(process.argv.find(arg => arg.startsWith('--from='))?.slice(7) || 0);
  console.log(`Paid AI tests: ${cases.length - from} serial requests at most, gpt-4o-mini, ${MAX_COMPLETION_TOKENS} output tokens per request. Supply a temporary key on stdin.`);
  let apiKey = await readKey();
  try { await runLiveAi({ apiKey, from }); }
  catch (error) { throw new Error(safeAiError(error.message, apiKey)); }
  finally { apiKey = ''; }
}
if (require.main === module) main().catch(error => { console.error(safeAiError(error.message)); process.exitCode = 1; });
module.exports = { authorize, readKey, runLiveAi, cases, ENDPOINT, MAX_COMPLETION_TOKENS };
