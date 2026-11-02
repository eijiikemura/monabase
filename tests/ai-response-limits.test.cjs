// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { loadModule } = require('./helpers/loadModule.cjs');
const { AI_LIMITS, normalizeAiLimits, createAiRequestBudget, readResponseText } = require('../electron/ai/requestLimits');
const { readChatCompletionResponse } = require('../electron/ai/chatCompletionResponse');

function clock() {
  let now = 0, id = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, delay) { tasks.set(++id, { fn, at: now + delay }); return id; },
    clearTimeout(key) { tasks.delete(key); },
    advance(ms) { now += ms; for (const [key, task] of [...tasks]) if (task.at <= now && tasks.delete(key)) task.fn(); },
    get pending() { return tasks.size; }
  };
}
function response(chunks, type = 'text/event-stream') {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(Buffer.from(chunk)); controller.close(); },
    cancel() { cancelled = true; }
  });
  return { body, headers: new Headers({ 'content-type': type }), wasCancelled: () => cancelled };
}
const completion = text => JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
const event = text => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`;

test('AI response limits reject nonfinite, fractional, missing and out-of-range settings', () => {
  for (const [key, rule] of Object.entries(AI_LIMITS)) {
    for (const value of [undefined, null, NaN, Infinity, '2', 0, -1, 1.5, rule.max + 1]) {
      assert.equal(normalizeAiLimits({ [key]: value })[key], rule.default);
    }
    for (const value of [rule.min, rule.max]) assert.equal(normalizeAiLimits({ [key]: value })[key], value);
  }
});

test('Idle budget resets on bytes, total budget does not reset, and disposal clears both timers', () => {
  const timers = clock(), controller = new AbortController();
  const budget = createAiRequestBudget(controller, { aiIdleTimeoutSeconds: 2, aiRequestTimeoutSeconds: 5 }, timers);
  for (let i = 0; i < 4; i++) { timers.advance(1000); budget.receive(1); }
  timers.advance(1000);
  assert.equal(controller.signal.reason.message, 'ai_request_timeout_exceeded');
  budget.dispose(); assert.equal(timers.pending, 0);
  const idle = new AbortController(), empty = createAiRequestBudget(idle, { aiIdleTimeoutSeconds: 1 }, timers);
  timers.advance(900); empty.receive(0); timers.advance(100);
  assert.equal(idle.signal.reason.message, 'ai_idle_timeout_exceeded');
  empty.dispose(); assert.equal(timers.pending, 0);
  const stopped = new AbortController(), disposed = createAiRequestBudget(stopped, {}, timers);
  disposed.dispose(); timers.advance(1000000); assert.equal(stopped.signal.aborted, false);
});

test('JSON, SSE and error bodies count UTF-8 bytes before parsing and share retry capacity', async () => {
  const controller = new AbortController(), budget = createAiRequestBudget(controller, { aiResponseMaxMb: 1 });
  try {
    const text = '日本語';
    const result = await readChatCompletionResponse(response([completion(text)], 'application/json'), { signal: controller.signal, budget });
    assert.equal(result.choices[0].message.content, text);
    const streamed = await readChatCompletionResponse(response([event(text), 'data: [DONE]\n\n']), { signal: controller.signal, budget });
    assert.equal(streamed.choices[0].message.content, text);
    await readResponseText(response(['x'.repeat(600000)], 'text/plain'), { signal: controller.signal, budget });
    await assert.rejects(readResponseText(response(['x'.repeat(500000)], 'text/plain'), { signal: controller.signal, budget }), /ai_response_size_exceeded/);
  } finally { budget.dispose(); }
  for (const type of ['application/json', 'text/event-stream', 'text/plain']) {
    const abort = new AbortController(), limit = createAiRequestBudget(abort, { aiResponseMaxMb: 1 });
    try {
      const source = response(['あ'.repeat(350000)], type);
      await assert.rejects(type === 'text/plain' ? readResponseText(source, { signal: abort.signal, budget: limit }) :
        readChatCompletionResponse(source, { signal: abort.signal, budget: limit }), /ai_response_size_exceeded/);
      assert.equal(abort.signal.aborted, true);
    } finally { limit.dispose(); }
  }
});

test('An aborted read cancels a pending stream and never returns a partial completion', async () => {
  const controller = new AbortController(), timers = clock();
  const budget = createAiRequestBudget(controller, { aiIdleTimeoutSeconds: 1 }, timers);
  let released = false, received = '';
  const stream = new ReadableStream({ start(c) { c.enqueue(Buffer.from(event('partial'))); }, cancel() { released = true; } });
  const pending = readChatCompletionResponse({ headers: new Headers({ 'content-type': 'text/event-stream' }), body: stream },
    { signal: controller.signal, budget, onText: text => { received = text; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(received, 'partial'); timers.advance(1000);
  await assert.rejects(pending, /ai_idle_timeout_exceeded/);
  assert.equal(released, true); budget.dispose();
});

function handlers(t, fetch, limits = () => ({})) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ai-limit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'ai.json'); fs.writeFileSync(file, '{}');
  const handlers = new Map(), sender = Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false, send() {} });
  loadModule('electron/ipc/ai.js', {}, { fetch }, { strict: false }).registerAiHandlers({
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, app: { isPackaged: true }, BrowserWindow: { getAllWindows: () => [] },
    aiSettingsStore: { load: () => ({ isAiEnabled: true, endpointUrl: 'https://example.invalid/v1' }) },
    getValidatedSettings: limits, AI_CONFIG_FILE: file, AI_USAGE_DIR: path.join(directory, 'usage'), t: key => key
  });
  return { ask: (id, options, requestType = 'sql_generation') => handlers.get('ask-ai')({ sender }, 'fictional prompt', [], requestType, id, options),
    cancel: id => handlers.get('cancel-ai')({ sender }, id), sender };
}

test('AI IPC size failures have no answer or automatic retries and next requests use changed limits', async t => {
  let calls = 0, size = 1;
  const h = handlers(t, async () => { calls++; return new Response(completion('x'.repeat(1100000)), { headers: { 'content-type': 'application/json' } }); }, () => ({ aiResponseMaxMb: size }));
  const failed = await h.ask('first');
  assert.equal(failed.success, false); assert.equal(failed.cancelled, false); assert.equal(failed.error, 'ai_response_size_exceeded');
  assert.equal(failed.answer, undefined); assert.equal(calls, 1);
  size = 2;
  const success = await h.ask('second'); assert.equal(success.success, true); assert.equal(success.answer.length, 1100000);
  assert.equal(h.sender.listenerCount('destroyed'), 0);
});

test('AI IPC reports header timeout separately from an explicit user cancellation', async t => {
  const h = handlers(t, (_url, { signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }),
    () => ({ aiIdleTimeoutSeconds: 1 }));
  const timeout = await h.ask('timeout');
  assert.equal(timeout.success, false); assert.equal(timeout.cancelled, false); assert.equal(timeout.error, 'ai_idle_timeout_exceeded');
  const pending = h.ask('cancel'); h.cancel('cancel');
  const cancelled = await pending; assert.equal(cancelled.cancelled, true); assert.equal(cancelled.answer, undefined);
  assert.equal(h.sender.listenerCount('destroyed'), 0);
});

test('AI IPC oversized error bodies abort before compatibility retry', async t => {
  let calls = 0;
  const h = handlers(t, async () => { calls++; return new Response('unsupported stream_options ' + 'x'.repeat(1100000), { status: 400 }); }, () => ({ aiResponseMaxMb: 1 }));
  const result = await h.ask('large-error', { stream: true });
  assert.equal(result.error, 'ai_response_size_exceeded'); assert.equal(result.answer, undefined); assert.equal(calls, 1);
});

test('Bounded readers preserve split UTF-8 and CRLF and reject unfinished streamed code', async () => {
  const source = Buffer.from((event('日本語') + 'data: [DONE]\n\n').replaceAll('\n', '\r\n'));
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < source.length; i++) c.enqueue(source.subarray(i, i + 1)); c.close(); } });
  const result = await readChatCompletionResponse({ headers: new Headers({ 'content-type': 'text/event-stream' }), body: stream });
  assert.equal(result.choices[0].message.content, '日本語');
  await assert.rejects(readChatCompletionResponse(response([event('unfinished')])), /ai_response_incomplete/);
  await assert.rejects(readChatCompletionResponse(response([event('cut off'), 'data: {"choices":[{"finish_reason":"length"}]}\n\n'])), /ai_response_incomplete/);
});

for (const requestType of ['sql_generation', 'coding_procedure', 'coding_function', 'coding_trigger', 'coding_package']) {
  for (const reason of ['length', 'content_filter', 'tool_calls', 'function_call']) {
    test(`${requestType}: buffered code with ${reason} is rejected even when its SQL or JSON is syntactically valid`, async t => {
      let calls = 0;
      const answer = requestType === 'sql_generation' ? 'DELETE FROM demo_orders' :
        JSON.stringify({ status: 'success', source: 'CREATE PROCEDURE demo AS BEGIN NULL; END;', message: '' });
      const h = handlers(t, async (_url, options) => {
        calls++; assert.equal(JSON.parse(options.body).stream, undefined);
        return new Response(JSON.stringify({ choices: [{ finish_reason: reason, message: { content: answer } }] }), { headers: { 'content-type': 'application/json' } });
      });
      const result = await h.ask('buffered', { stream: false }, requestType);
      assert.equal(result.success, false); assert.equal(result.cancelled, false);
      assert.equal(result.error, 'ai_response_incomplete'); assert.equal(result.answer, undefined);
      assert.equal(calls, 1); assert.equal(h.sender.listenerCount('destroyed'), 0);
    });
  }
}

test('Streaming compatibility fallback retains code completion validation after switching to buffered JSON', async t => {
  let calls = 0;
  const h = handlers(t, async () => ++calls === 1 ? new Response('stream is unsupported', { status: 400 }) :
    new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'DELETE FROM demo_orders' } }] }), { headers: { 'content-type': 'application/json' } }));
  const result = await h.ask('fallback', { stream: true });
  assert.equal(calls, 2); assert.equal(result.success, false); assert.equal(result.error, 'ai_response_incomplete');
  assert.equal(result.answer, undefined);
});

test('Buffered code preserves successful and compatible missing finish reasons while ordinary chat retains partial text', async t => {
  let reason = 'stop';
  const h = handlers(t, async () => new Response(JSON.stringify({ choices: [{ finish_reason: reason, message: { content: 'SELECT 1' } }] }), { headers: { 'content-type': 'application/json' } }));
  for (const value of ['stop', undefined]) {
    reason = value;
    const result = await h.ask('valid', { stream: false });
    assert.equal(result.success, true); assert.equal(result.answer, 'SELECT 1');
  }
  reason = 'length';
  assert.equal((await h.ask('ordinary-chat', { stream: false }, 'unspecified')).success, true);
});
