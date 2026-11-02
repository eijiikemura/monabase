// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const AI_LIMITS = {
  aiResponseMaxMb: { default: 16, min: 1, max: 64 },
  aiIdleTimeoutSeconds: { default: 120, min: 1, max: 3600 },
  aiRequestTimeoutSeconds: { default: 600, min: 1, max: 86400 }
};

function normalizeAiLimits(settings = {}) {
  return Object.fromEntries(Object.entries(AI_LIMITS).map(([key, rule]) => [key,
    Number.isInteger(settings[key]) && settings[key] >= rule.min && settings[key] <= rule.max
      ? settings[key] : rule.default]));
}

// A single budget spans headers, response reads and any compatibility retry.
function createAiRequestBudget(controller, settings, timers = { setTimeout, clearTimeout }) {
  const limits = normalizeAiLimits(settings);
  let received = 0, idleTimer, totalTimer, disposed = false;
  function abort(key) { if (!controller.signal.aborted) controller.abort(new Error(key)); }
  function progress() {
    if (disposed) return;
    timers.clearTimeout(idleTimer);
    idleTimer = timers.setTimeout(() => abort('ai_idle_timeout_exceeded'), limits.aiIdleTimeoutSeconds * 1000);
  }
  totalTimer = timers.setTimeout(() => abort('ai_request_timeout_exceeded'), limits.aiRequestTimeoutSeconds * 1000);
  progress();
  return {
    receive(bytes) {
      controller.signal.throwIfAborted();
      received += bytes;
      if (received > limits.aiResponseMaxMb * 1024 * 1024) {
        abort('ai_response_size_exceeded');
        controller.signal.throwIfAborted();
      }
      if (bytes > 0) progress();
    },
    dispose() {
      disposed = true;
      timers.clearTimeout(idleTimer); timers.clearTimeout(totalTimer);
    }
  };
}

// Count decoded HTTP body bytes before parsing JSON or appending an SSE event.
async function* readResponseChunks(response, { signal, budget } = {}) {
  if (!response.body) throw new Error('AI response body is missing.');
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const chunk = await reader.read();
      signal?.throwIfAborted();
      if (chunk.done) break;
      budget?.receive(chunk.value.byteLength);
      yield chunk.value;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function readResponseText(response, options) {
  const decoder = new TextDecoder();
  const parts = [];
  for await (const chunk of readResponseChunks(response, options)) parts.push(decoder.decode(chunk, { stream: true }));
  parts.push(decoder.decode());
  return parts.join('');
}
module.exports = { AI_LIMITS, normalizeAiLimits, createAiRequestBudget, readResponseChunks, readResponseText };
