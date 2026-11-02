// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const { simpleGit } = require('simple-git');
const { createGitClient } = require('../electron/services/gitClient');
const { formatGitError } = require('../electron/services/gitSecurity');

async function fixture(t) {
  const base = process.env.MONABASE_GIT_TEST_ROOT ? path.resolve(process.env.MONABASE_GIT_TEST_ROOT) : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, 'monabase-transport-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_|^(?:EDITOR|VISUAL|PAGER)$/.test(name))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'global-config'), GIT_TERMINAL_PROMPT: '0', NO_PROXY: '*', no_proxy: '*' };
  for (const key of Object.keys(env)) if (/^(?:https?|all)_proxy$/i.test(key)) delete env[key];
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const factory = options => {
    const git = simpleGit({ ...options, allowEnvironment: ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT', 'GIT_INDEX_FILE'], unsafe: { allowUnsafeHooksPath: true, allowUnsafeConfigPaths: true } });
    const setEnv = git.env.bind(git);
    git.env = values => setEnv({ ...values, ...env, ...(values.GIT_INDEX_FILE ? { GIT_INDEX_FILE: values.GIT_INDEX_FILE } : {}) });
    return git;
  };
  const raw = factory({ baseDir: root }).env(env);
  await raw.init(); await raw.addConfig('user.name', 'Transport tests'); await raw.addConfig('user.email', 'test@example.invalid');
  await raw.addConfig('commit.gpgsign', 'false');
  await raw.raw(['-c', `core.hooksPath=${path.join(root, 'no-hooks')}`, 'commit', '--allow-empty', '-m', 'Test']);
  const client = () => createGitClient(root, {}, factory);
  const configFile = path.join(root, '.git/config');
  return { root, raw, factory, client, config: () => fs.readFileSync(configFile) };
}
async function listen(t, server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return server.address().port;
}

function advertise(request, response) {
  if (request.url.startsWith('/repo/info/refs')) {
    response.writeHead(200, { 'content-type': 'text/plain' }); response.end('1111111111111111111111111111111111111111\trefs/heads/main\n');
  } else if (request.url === '/repo/HEAD') response.end('ref: refs/heads/main\n');
  else { response.writeHead(404); response.end('Missing test object'); }
}

test('Git runtime policy rejects HTTP redirects even with deeper URL-specific opt-outs, without editing configuration', async t => {
  const h = await fixture(t); let targetRequests = 0;
  const target = http.createServer((_request, response) => { targetRequests++; response.writeHead(404); response.end(); });
  const targetPort = await listen(t, target);
  const source = http.createServer((request, response) => { response.writeHead(302, { Location: `http://127.0.0.1:${targetPort}${request.url}` }); response.end(); });
  const port = await listen(t, source), url = `http://127.0.0.1:${port}/repo`;
  await h.raw.addConfig('http.followRedirects', 'true');
  await h.raw.addConfig(`http.${url}.followRedirects`, 'true');
  await h.raw.addConfig(`http.${url}/info/refs.followRedirects`, 'true');
  const before = h.config(), globalBefore = fs.readFileSync(path.join(h.root, 'global-config'));
  const git = await h.client();
  assert.equal((await git.raw(['config', '--get-urlmatch', 'http.followRedirects', url + '/info/refs'])).trim(), 'false');
  let error;
  try { await git.raw(['ls-remote', url]); } catch (failure) { error = failure; }
  assert.ok(error); assert.equal(formatGitError(error), 'security_git_redirect_refused'); assert.equal(targetRequests, 0);
  await assert.rejects(git.push([url, 'HEAD:refs/heads/main'])); assert.equal(targetRequests, 0);
  assert.ok(h.config().equals(before)); assert.ok(fs.readFileSync(path.join(h.root, 'global-config')).equals(globalBefore));
});

test('Git verifies real TLS despite unsafe scoped settings, accepts an explicit trusted CA and rejects a wrong host', async t => {
  const h = await fixture(t), key = path.join(h.root, 'key.pem'), cert = path.join(h.root, 'ca.pem'), config = path.join(h.root, 'openssl.cnf');
  fs.writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n');
  const windowsOpenSSL = path.join(process.env.ProgramFiles || 'C:/Program Files', 'Git/usr/bin/openssl.exe');
  const openssl = process.platform === 'win32' && fs.existsSync(windowsOpenSSL) ? windowsOpenSSL : 'openssl';
  execFileSync(openssl, ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-x509', '-days', '1', '-config', config, '-keyout', key, '-out', cert], { stdio: 'ignore' });
  let requests = 0;
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (request, response) => { requests++; advertise(request, response); });
  const port = await listen(t, server), url = `https://localhost:${port}/repo`;
  // Write only the disposable local config; the application must override these at runtime.
  execFileSync('git', ['-C', h.root, 'config', '--local', 'http.sslVerify', 'false']);
  execFileSync('git', ['-C', h.root, 'config', '--local', `http.${url}.sslVerify`, 'false']);
  execFileSync('git', ['-C', h.root, 'config', '--local', `http.${url}/info/refs.sslVerify`, 'false']);
  let before = h.config(), git = await h.client();
  assert.equal((await git.raw(['config', '--get-urlmatch', 'http.sslVerify', url + '/info/refs'])).trim(), 'true');
  let error;
  try { await git.raw(['ls-remote', url]); } catch (failure) { error = failure; }
  assert.ok(error); assert.equal(requests, 0); assert.equal(formatGitError(error), 'security_git_certificate_rejected');
  assert.ok(h.config().equals(before));
  await h.raw.addConfig('http.sslCAInfo', cert);
  before = h.config(); git = await h.client();
  assert.match(await git.raw(['ls-remote', url]), /refs\/heads\/main/); assert.ok(requests > 0);
  const received = requests;
  await assert.rejects(git.raw(['ls-remote', `https://127.0.0.1:${port}/repo`])); assert.equal(requests, received);
  assert.ok(h.config().equals(before));
});

test('Secure Git factory keeps only its internal index environment, preserves CA settings and hides failed configuration reads', async () => {
  const clients = [], configs = [];
  const factory = options => {
    const client = { env(value) { client.environment = value; return client; }, raw: async () =>
      'http.sslverify\0http.https://example.invalid/repo.sslverify\0http.https://example.invalid/repo.followredirects\0http.sslcainfo\0' };
    configs.push(options.config); clients.push(client); return client;
  };
  await createGitClient('/test', { GIT_INDEX_FILE: '/internal/index', GIT_SSL_NO_VERIFY: '1', GIT_CONFIG_COUNT: '99' }, factory);
  assert.equal(clients.at(-1).environment.GIT_INDEX_FILE, '/internal/index');
  assert.equal(clients.at(-1).environment.GIT_SSL_NO_VERIFY, undefined); assert.equal(clients.at(-1).environment.GIT_CONFIG_COUNT, undefined);
  assert.ok(configs.at(-1).includes('http.https://example.invalid/repo.sslverify=true'));
  assert.ok(!configs.at(-1).some(key => /sslcainfo/i.test(key)));
  await assert.rejects(createGitClient('/test', {}, () => ({ env() { return this; }, raw: async () => { throw new Error('DUMMY_PRIVATE_CONFIG'); } })), { message: 'security_git_transport_setup_failed' });
  await assert.rejects(createGitClient('/test', {}, () => ({ env() { return this; }, raw: async () => 'http.https://user:DUMMY_PRIVATE_CONFIG@example.invalid/.sslverify\0' })), { message: 'security_git_transport_setup_failed' });
});
