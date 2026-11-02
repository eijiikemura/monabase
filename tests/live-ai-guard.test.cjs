// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { authorize, readKey, runLiveAi, ENDPOINT, MAX_COMPLETION_TOKENS } = require('./live-ai/runner.cjs');
const key = 'sk-fictional-not-a-real-api-key';

test('Paid AI entry point refuses absent approval, extra arguments and CI before reading credentials', () => {
  assert.throws(() => authorize([], {}), /allow-paid/);
  assert.throws(() => authorize(['--allow-paid', '--other'], {}), /allow-paid/);
  assert.throws(() => authorize(['--allow-paid'], { CI: 'true' }), /forbidden in CI/);
  assert.doesNotThrow(() => authorize(['--allow-paid'], {}));
  assert.doesNotThrow(() => authorize(['--allow-paid', '--from=3'], {}));
  for (const start of ['--from=-1', '--from=8', '--from=abc']) assert.throws(() => authorize(['--allow-paid', start], {}));
  for (const args of [[], ['--allow-paid']]) {
    const child = spawnSync(process.execPath, ['tests/live-ai/runner.cjs', ...args], {
      cwd: require('node:path').resolve(__dirname, '..'), input: key, encoding: 'utf8', env: { ...process.env, CI: 'true' }, timeout: 10000
    });
    assert.equal(child.status, 1); assert.ok(!`${child.stdout}${child.stderr}`.includes(key));
  }
});

test('Temporary credentials are accepted only as bounded stdin input', async () => {
  assert.equal(await readKey(Readable.from([key + '\n'])), key);
  for (const value of ['', 'invalid', 'x'.repeat(1025), '\u0003']) await assert.rejects(readKey(Readable.from([value])));
});

function answer(index) {
  if (index < 2) return JSON.stringify({ status: 'success', source: 'SELECT ID FROM MB_AI_DEMO WHERE ID = 7', message: '' });
  if (index === 2) return JSON.stringify({ status: 'success', source: 'CREATE FUNCTION mb_ai_add_one(p_value integer) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN p_value + 1; END; $$;', message: '' });
  if (index < 5) return JSON.stringify({ status: 'success', source: `BEGIN ${index === 3 ? ':' : ''}NEW.ID := 7; ${index === 4 ? 'RETURN NEW;' : ''} END;`, message: '', settings: { timing: 'BEFORE', events: ['INSERT'], forEachRow: true } });
  if (index === 5) return '記録では2、期待値は3です。';
  if (index === 6) return 'Consider an index on MB_AI_DEMO(ID), then verify with EXPLAIN.';
  return JSON.stringify({ generateCount: 2, rules: [{ COLUMN_NAME: 'ID', ruleType: 'SEQ_NUM', seqStart: '9007199254740993', seqStep: '1', nullRatio: 0 }] });
}

test('Live harness exercises production IPC, SSE, parsers and usage with a credential-free report', async () => {
  const logs = []; let calls = 0;
  const result = await runLiveAi({ apiKey: key, log: text => logs.push(text), fetchImpl: async (url, options) => {
    assert.equal(url, ENDPOINT); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_completion_tokens, MAX_COMPLETION_TOKENS);
    assert.equal(payload.model, 'gpt-4o-mini'); assert.equal(payload.tools, undefined);
    const text = answer(calls++), usage = { prompt_tokens: 12, completion_tokens: 9 };
    if (calls === 7) assert.equal(payload.messages.length, 3);
    if (payload.stream) return new Response([
      { choices: [{ index: 0, delta: { content: text }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage }
    ].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage }), { headers: { 'content-type': 'application/json' } });
  } });
  assert.deepEqual(result, { requests: 8, inputTokens: 96, outputTokens: 72 });
  assert.equal(calls, 8); assert.equal(logs.length, 9); assert.ok(!logs.join('\n').includes(key));
});

for (const status of [401, 429, 500]) test(`Provider HTTP ${status} stops immediately and redacts credentials`, async () => {
  let calls = 0;
  await assert.rejects(runLiveAi({ apiKey: key, log() {}, fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ error: { message: `api_key=${key}` } }), { status });
  } }), error => error.message.includes(`HTTP ${status}`) && !error.message.includes(key));
  assert.equal(calls, 1);
});

test('Malformed model output fails the run instead of being counted as success', async () => {
  let calls = 0;
  await assert.rejects(runLiveAi({ apiKey: key, log() {}, fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'invalid JSON' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  } }));
  assert.equal(calls, 1);
});


test('Unsupported streaming options cannot trigger a second paid HTTP attempt', async () => {
  let calls = 0;
  await assert.rejects(runLiveAi({ apiKey: key, log() {}, fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'Unsupported parameter: stream_options', param: 'stream_options' } }), { status: 400 });
  } }), /automatic retry is forbidden/);
  assert.equal(calls, 1);
});
