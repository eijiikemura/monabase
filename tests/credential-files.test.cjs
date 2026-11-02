// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const { test } = require('node:test');
const { readCredentialFile, CREDENTIAL_FILES } = require('../electron/services/credentialFiles');
const { loadModule } = require('./helpers/loadModule.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-auth-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
for (const kind of ['ssh-private-key', 'tls-ca']) {
  test(`${kind}: bounded binary reads preserve bytes and permissions, allow the exact limit and reject one extra byte`, async t => {
    const root = fixture(t), file = path.join(root, 'credential');
    const bytes = Buffer.from([0, 255, 10, 13, 128, 65]);
    fs.writeFileSync(file, bytes, { mode: 0o640 });
    const originalMode = fs.statSync(file).mode;
    assert.deepEqual(await readCredentialFile(file, kind), bytes);
    assert.equal(fs.statSync(file).mode, originalMode);
    const maximum = CREDENTIAL_FILES[kind].limitMiB * 1024 * 1024;
    fs.truncateSync(file, maximum);
    assert.equal((await readCredentialFile(file, kind)).length, maximum);
    fs.truncateSync(file, maximum + 1);
    await assert.rejects(readCredentialFile(file, kind), error => error.code === 'auth_file_too_large' && !error.message.includes(root));
    assert.equal(fs.statSync(file).size, maximum + 1);
  });
  test(`${kind}: directories and inaccessible paths return fixed errors without path or content excerpts`, async t => {
    const root = fixture(t);
    await assert.rejects(readCredentialFile(root, kind), { code: 'auth_file_not_regular' });
    await assert.rejects(readCredentialFile(path.join(root, 'DUMMY_PRIVATE_VALUE'), kind), error =>
      error.code === 'auth_file_unreadable' && !error.message.includes('DUMMY_PRIVATE_VALUE') && !error.message.includes(root));
    await assert.rejects(readCredentialFile(root, 'invalid'), /Invalid credential file kind/);
  });
}

test('Credential files follow selected regular-file links without changing the target and reject dangling links', async t => {
  const root = fixture(t), directory = path.join(root, 'files'), file = path.join(directory, 'key'), link = path.join(root, 'selected-key');
  fs.mkdirSync(directory);
  fs.writeFileSync(file, 'key fixture', { mode: 0o600 });
  // Junction support on Windows permits directory links without developer-mode privileges.
  const directoryLink = path.join(root, 'selected-directory');
  fs.symlinkSync(directory, directoryLink, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await readCredentialFile(path.join(directoryLink, 'key'), 'ssh-private-key')).toString(), 'key fixture');
  if (process.platform !== 'win32') {
    fs.symlinkSync(file, link);
    assert.equal((await readCredentialFile(link, 'ssh-private-key')).toString(), 'key fixture');
    fs.unlinkSync(file);
    await assert.rejects(readCredentialFile(link, 'ssh-private-key'), { code: 'auth_file_unreadable' });
  }
});

if (process.platform !== 'win32') {
  for (const kind of ['ssh-private-key', 'tls-ca']) test(`${kind}: FIFO and device paths are refused without hanging the process`, async t => {
    const root = fixture(t), fifo = path.join(root, 'pipe');
    execFileSync('mkfifo', [fifo]);
    const script = `require(process.argv[1]).readCredentialFile(process.argv[2],process.argv[3]).then(()=>process.exit(2),error=>{console.log(error.code);});`;
    const result = await promisify(execFile)(process.execPath, ['-e', script, path.resolve('electron/services/credentialFiles.js'), fifo, kind], { timeout: 3000 });
    assert.equal(result.stdout.trim(), 'auth_file_not_regular');
    await assert.rejects(readCredentialFile('/dev/zero', kind), { code: 'auth_file_not_regular' });
  });
}

for (const scenario of ['replacement', 'growth', 'read-error']) test(`Credential file ${scenario} closes its descriptor and returns a sanitized failure`, async () => {
  let closed = 0;
  const status = size => ({ size, dev: 1, ino: 1, isFile: () => true, isSymbolicLink: () => false });
  const maximum = 1024 * 1024;
  const { readBoundedBuffer } = loadModule('electron/services/boundedFiles.js', {
    'node:fs': { constants: fs.constants, promises: {
      realpath: async file => file,
      lstat: async () => status(1),
      open: async () => ({
        stat: async () => ({ ...status(1), ino: scenario === 'replacement' ? 2 : 1 }),
        read: async buffer => {
          if (scenario === 'read-error') throw new Error('DUMMY_PRIVATE_VALUE');
          return { bytesRead: Math.min(buffer.length, maximum) };
        },
        close: async () => { closed++; }
      })
    } }
  });
  const { readCredentialFile: read } = loadModule('electron/services/credentialFiles.js', {
    './boundedFiles': { readBoundedBuffer }, '../i18n': require('../electron/i18n')
  });
  await assert.rejects(read('/fictional/key', 'ssh-private-key'), error =>
    error.code === ({ replacement: 'auth_file_not_regular', growth: 'auth_file_too_large', 'read-error': 'auth_file_unreadable' })[scenario] &&
    !error.message.includes('DUMMY_PRIVATE_VALUE') && !error.message.includes('/fictional'));
  assert.equal(closed, 1);
});

for (const database of ['oracle', 'postgres']) test(`${database}: key rejection creates no SSH connection and a successful retry retains the passphrase`, async t => {
  const root = fixture(t), key = path.join(root, 'key');
  let constructions = 0, connected;
  class SshClient extends EventEmitter {
    constructor() { super(); constructions++; }
    connect(config) { connected = config; this.emit('ready'); return this; }
  }
  const Client = loadModule(`electron/${database}/${database === 'oracle' ? 'oracleClient' : 'postgresClient'}.js`, {
    electron: { app: { isPackaged: true } }, oracledb: {}, './traceExecutor': {},
    pg: { Client: class {}, types: { setTypeParser() {} } }, ssh2: { Client: SshClient },
    net: { createServer: () => ({ listen(_port, _host, callback) { callback(); }, address: () => ({ port: 12345 }), on() { return this; } }) }
  }, {}, { strict: false });
  const client = new Client();
  const config = { sshAuthType: 'key', sshKeyFile: key, sshHost: 'localhost', sshUser: 'fixture', sshPassword: 'DUMMY_PASSPHRASE' };
  await assert.rejects(client.setupSshTunnel(config), { code: 'auth_file_unreadable' });
  assert.equal(constructions, 0); assert.equal(client.sshClient, null);
  fs.writeFileSync(key, 'DUMMY_KEY_BYTES');
  await client.setupSshTunnel(config);
  assert.equal(constructions, 1); assert.equal(connected.privateKey.toString(), 'DUMMY_KEY_BYTES');
  assert.equal(connected.passphrase, config.sshPassword); assert.equal(typeof connected.hostVerifier, 'function');
});

test('Invalid PostgreSQL CA files stop before DB or SSH connection creation', async t => {
  const root = fixture(t);
  let dbConnections = 0, sshConnections = 0;
  const Client = loadModule('electron/postgres/postgresClient.js', {
    electron: { app: { isPackaged: true } }, pg: { Client: class { constructor() { dbConnections++; } }, types: { setTypeParser() {} } }
  }, {}, { strict: false });
  const client = new Client();
  client.setupSshTunnel = async () => { sshConnections++; };
  await assert.rejects(client.connect({ host: 'db.test', pgSslMode: 'verify-full', pgSslCaFile: root, useSshTunnel: true }), error =>
    error.message.includes('CA certificate must be a regular file') && !error.message.includes(root));
  assert.equal(dbConnections, 0); assert.equal(sshConnections, 0);
});
