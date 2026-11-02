// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const path = require('node:path');

function redactGitSecrets(value) {
  return String(value).replace(/\b((?:https?|ssh|git\+ssh):\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1<redacted>@')
    .replace(/([?&](?:access_token|token|api_key|password)=)[^\s&]*/gi, '$1<redacted>');
}
function validateGitRemote(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || value.startsWith('-') || /^(?:\\\\|\/\/)/.test(value)) throw new Error('security_git_invalid_remote');
  if (path.isAbsolute(value) || path.win32.isAbsolute(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new Error('security_git_invalid_remote'); }
    if (url.password || (['http:', 'https:'].includes(url.protocol) && url.username) || url.search || url.hash) throw new Error('security_git_remote_credentials');
    if (!['https:', 'ssh:', 'file:', 'http:'].includes(url.protocol) ||
        url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.protocol === 'file:' && url.hostname && url.hostname !== 'localhost') throw new Error('security_git_invalid_remote');
    return value;
  }
  // SCP-style SSH addresses and local test repositories do not embed a password.
  if (value.includes('::') || /^[a-z][a-z0-9+.-]*:/i.test(value) && !/^(?:[^\s@/:]+@)?[^\s/:]+:[^:]+$/.test(value)) throw new Error('security_git_invalid_remote');
  return value;
}
async function assertSafeOrigin(git) {
  if (!(await git.getRemotes()).some(remote => remote.name === 'origin')) return;
  // Expand URL rewrites and inspect every fetch/push destination, not a collapsed remote summary.
  for (const args of [['remote', 'get-url', '--all', 'origin'], ['remote', 'get-url', '--push', '--all', 'origin']]) {
    const output = await git.raw(args);
    const urls = output.trim().split(/\r?\n/);
    for (const url of urls) validateGitRemote(url);
  }
}
module.exports = { redactGitSecrets, validateGitRemote, assertSafeOrigin };


function formatGitError(error, t = key => key) {
  const message = typeof error?.message === 'string' ? error.message : 'Git operation failed.';
  if (['security_git_transport_setup_failed', 'security_git_invalid_remote', 'security_git_remote_credentials'].includes(message)) return t(message);
  if (/(?:returned error:|HTTP code)\s*(?:301|302|303|307|308)\b|redirect(?:ion)? (?:is )?(?:prohibited|disabled)/i.test(message)) return t('security_git_redirect_refused');
  if (/SSL certificate problem|certificate verify failed|SSL peer certificate.*not OK|CERT_TRUST_IS_UNTRUSTED_ROOT|SEC_E_UNTRUSTED_ROOT|CERT_E_CN_NO_MATCH|CERT_E_EXPIRED|server certificate verification failed|unable to get local issuer certificate|self[- ]signed certificate/i.test(message)) return t('security_git_certificate_rejected');
  return redactGitSecrets(message);
}
module.exports.formatGitError = formatGitError;
