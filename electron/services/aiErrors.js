// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Sanitize before truncation so a long provider message cannot expose a partial known key.
function safeAiError(value, apiKey = '') {
  let text = String(value || 'AI request failed.');
  if (apiKey) {
    const variants = [apiKey, encodeURIComponent(apiKey), JSON.stringify(apiKey).slice(1, -1)];
    for (const secret of variants) text = text.split(secret).join('<redacted>');
  }
  text = text.replace(/\b(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1<redacted>@')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer <redacted>')
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|password|authorization|secret)\s*["']?\s*[:=]\s*["']?)[^\s"',;}]+/gi, '$1<redacted>')
    .replace(/\bsk-[\w*-]+/g, '<redacted>');
  text = Array.from(text, character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('');
  return text.length > 1000 ? text.slice(0, 1000) + '…' : text;
}

function providerError(status, body, apiKey) {
  // Extract an explanation, never expose an arbitrary HTML/plain-text response body.
  let message = '';
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.error?.message === 'string') message = parsed.error.message;
    else if (typeof parsed?.message === 'string') message = parsed.message;
  } catch { /* A status code is sufficient when the body is not structured. */ }
  return safeAiError(`HTTP ${status}${message ? ': ' + message : ''}`, apiKey);
}
module.exports = { safeAiError, providerError };
