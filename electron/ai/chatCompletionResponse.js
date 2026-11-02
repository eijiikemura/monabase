// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readResponseChunks, readResponseText } = require('./requestLimits');
// Normalize regular JSON responses and streamed response chunks to a common format.
function unsupportedStreamingOption(status, body) {
  if (![400, 422, 501].includes(status)) return null;
  if (!/(unsupported|not.support|not.allowed|unknown|unrecognized|unexpected|extra.inputs|not.permitted|does.not.support)/i.test(body)) return null;
  if (/stream_options|include_usage/i.test(body)) return 'usage';
  return /\bstream(?:ing)?\b/i.test(body) ? 'stream' : null;
}

async function readChatCompletionResponse(response, { signal, onText, requireComplete = false, budget } = {}) {
  if (!/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
    const data = JSON.parse(await readResponseText(response, { signal, budget }));
    if (data.error) throw new Error(data.error.message || 'AIからエラーが返されました。');
    const reason = data.choices?.[0]?.finish_reason;
    if (requireComplete && reason && reason !== 'stop') throw Object.assign(new Error('ai_response_incomplete'), { code: 'ai_response_incomplete' });
    return data;
  }
  if (!response.body) throw new Error('AIの回答本文を取得できませんでした。');
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let usage = {};
  let model;
  let done = false;
  let finished = false;
  let finishReason;
  const consume = (event) => {
    const dataText = event.split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!dataText) return;
    if (dataText.trim() === '[DONE]') { done = true; return; }
    const data = JSON.parse(dataText);
    if (data.error) throw new Error(data.error.message || 'AIからエラーが返されました。');
    if (data.model) model = data.model;
    if (data.usage) usage = data.usage;
    const choice = data.choices?.find(item => item.index === 0) || data.choices?.[0];
    if (typeof choice?.delta?.content === 'string') {
      answer += choice.delta.content;
      onText?.(answer);
    }
    if (choice?.finish_reason) { finished = true; finishReason = choice.finish_reason; }
  };
  const drain = () => {
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      consume(event);
      if (done) break;
    }
  };
  for await (const chunk of readResponseChunks(response, { signal, budget })) {
    buffer += decoder.decode(chunk, { stream: true });
    // Retain CR until LF arrives when CRLF is split across chunks.
    buffer = buffer.replace(/\r\n/g, '\n');
    drain();
    if (done) break;
  }
  buffer += decoder.decode();
  if (!done && buffer.trim()) consume(buffer);
  signal?.throwIfAborted();
  if ((!done && !finished) || (finishReason && finishReason !== 'stop')) {
    throw Object.assign(new Error('ai_response_incomplete'), { code: 'ai_response_incomplete' });
  }
  return { model, usage, choices: [{ message: { content: answer }, finish_reason: finishReason }] };
}

module.exports = { readChatCompletionResponse, unsupportedStreamingOption };
