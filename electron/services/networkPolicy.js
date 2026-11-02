// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

function normalizeAiEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('security_ai_invalid_endpoint'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('security_ai_invalid_endpoint');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('security_ai_https_required');
  return url.href.replace(/\/+$/, '');
}
module.exports = { normalizeAiEndpoint };
