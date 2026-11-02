// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createSshHostKeyVerifier } = require('../electron/services/sshHostKeys');
const { loadModule } = require('./helpers/loadModule.cjs');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('../electron/services/jsonFiles');

function fixture(t, approved = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-ssh-keys-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'ssh-host-keys.json'), confirmations = [], notices = [];
  const options = { file, t: (key, values) => `${key}:${JSON.stringify(values || {})}`,
    confirm: async server => { confirmations.push(server); return approved; },
    notify: async message => { notices.push(message); } };
  return { file, directory, confirmations, notices, options, factory: createSshHostKeyVerifier(options) };
}
const endpoint = { host: 'Example.test', port: 22 };
const key = Buffer.from('public host key fixture');
const verify = (factory, destination = endpoint, serverKey = key) => new Promise(resolve => factory(destination)(serverKey, resolve));

test('First SSH connection requires approval and identical saved host keys are accepted after restart', async t => {
  const h = fixture(t);
  assert.equal(await verify(h.factory), true);
  assert.equal(h.confirmations.length, 1);
  const record = JSON.parse(fs.readFileSync(h.file, 'utf8'))[0];
  assert.equal(record.host, 'example.test');
  assert.match(record.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(await verify(createSshHostKeyVerifier({ ...h.options, confirm() { throw new Error('Must not prompt again.'); } })), true);
});

test('Declining the first SSH key prevents trust storage and connection approval', async t => {
  const h = fixture(t, false);
  assert.equal(await verify(h.factory), false);
  assert.equal(fs.existsSync(h.file), false);
});

test('Changed SSH host keys are rejected without replacing the original key or offering automatic acceptance', async t => {
  const h = fixture(t);
  assert.equal(await verify(h.factory), true);
  const original = fs.readFileSync(h.file, 'utf8');
  assert.equal(await verify(h.factory, endpoint, Buffer.from('changed public host key')), false);
  assert.equal(fs.readFileSync(h.file, 'utf8'), original);
  assert.equal(h.confirmations.length, 1);
  assert.match(h.notices[0], /^ssh_host_key_changed:/);
});

test('Invalid trust files fail closed and preserve the original with a recovery copy', async t => {
  const h = fixture(t);
  fs.writeFileSync(h.file, '{invalid');
  assert.equal(await verify(h.factory), false);
  assert.equal(fs.readFileSync(h.file, 'utf8'), '{invalid');
  assert.equal(fs.readdirSync(h.directory).filter(name => name.endsWith('.bak')).length, 1);
  assert.equal(h.confirmations.length, 0);
  assert.match(h.notices[0], /^ssh_host_keys_unavailable:/);
});

test('Failed SSH trust persistence never authorizes the pending connection', async t => {
  const h = fixture(t);
  const { createSshHostKeyVerifier: failingFactory } = loadModule('electron/services/sshHostKeys.js', {
    'node:fs': fs, 'node:crypto': require('node:crypto'),
    './jsonFiles': { atomicWriteJson() { throw new Error('Disk full.'); }, readJsonFile, isJsonObject }
  });
  assert.equal(await verify(failingFactory(h.options)), false);
  assert.equal(fs.existsSync(h.file), false);
  assert.match(h.notices[0], /^ssh_host_keys_unavailable:/);
});

test('Concurrent first connections serialize trust decisions and keep every accepted server', async t => {
  const h = fixture(t);
  assert.deepEqual(await Promise.all([
    verify(h.factory), verify(h.factory), verify(h.factory, { ...endpoint, port: 2222 })
  ]), [true, true, true]);
  assert.equal(h.confirmations.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(h.file, 'utf8')).length, 2);
});

for (const database of ['oracle', 'postgres']) {
  test(`${database}: SSH tunnel setup uses the verified key before becoming ready`, async t => {
    const h = fixture(t);
    let authAttempts = 0;
    class SshClient extends EventEmitter {
      connect(config) {
        assert.equal(typeof config.hostVerifier, 'function');
        config.hostVerifier(key, accepted => {
          if (accepted) { authAttempts++; this.emit('ready'); }
          else this.emit('error', new Error('Host key rejected.'));
        });
        return this;
      }
    }
    const Client = loadModule(`electron/${database}/${database === 'oracle' ? 'oracleClient' : 'postgresClient'}.js`, {
      electron: { app: { isPackaged: true } }, oracledb: {}, './traceExecutor': {},
      pg: { Client: class {}, types: { setTypeParser() {} } }, ssh2: { Client: SshClient },
      net: { createServer: () => ({
        listen(_port, _host, callback) { callback(); }, address: () => ({ port: 12345 }), on() { return this; }
      }) }
    }, {}, { strict: false });
    const config = { sshHost: endpoint.host, sshPort: '22', sshUser: 'fixture', sshPassword: 'fixture', host: 'db.test' };
    await new Client({ createSshHostVerifier: h.factory }).setupSshTunnel(config);
    assert.equal(authAttempts, 1);
    await assert.rejects(new Client().setupSshTunnel(config), /Host key rejected/);
    assert.equal(authAttempts, 1);
    const records = JSON.parse(fs.readFileSync(h.file, 'utf8'));
    records[0].fingerprint = 'SHA256:' + 'a'.repeat(43);
    atomicWriteJson(h.file, records);
    await assert.rejects(new Client({ createSshHostVerifier: h.factory }).setupSshTunnel(config), /Host key rejected/);
    assert.equal(authAttempts, 1);
  });
}

test('SSH network timeout pauses during approval and resumes after the trust decision', async () => {
  const { connectVerifiedSsh } = require('../electron/services/sshHostKeys');
  const client = new EventEmitter();
  let finish, destroyed = false, connectedConfig;
  const errors = [];
  client.on('error', error => errors.push(error.message));
  client.destroy = () => { destroyed = true; client.emit('close'); };
  client.connect = config => { connectedConfig = config; config.hostVerifier(key, () => {}); return client; };
  connectVerifiedSsh(client, { host: 'fixture.test', port: 22, readyTimeout: 20 },
    () => (_key, done) => { finish = done; }, text => text);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(destroyed, false);
  assert.equal(errors.length, 0);
  assert.equal(connectedConfig.readyTimeout, 0);
  finish(true);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(destroyed, true);
  assert.deepEqual(errors, ['ssh_connection_timed_out']);
});
