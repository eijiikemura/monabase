// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { test } = require('node:test');
const { createCredentialVault } = require('../electron/services/credentials');
const { createConnectionStore } = require('../electron/services/connections');
const { createAiSettingsStore } = require('../electron/services/aiSettings');

function keyStore(enabled = true, backend = 'test') {
  return {
    isEncryptionAvailable: () => enabled,
    getSelectedStorageBackend: () => backend,
    encryptString: value => Buffer.from('sealed:' + value),
    decryptString(value) {
      assert.ok(value.toString().startsWith('sealed:'));
      return value.toString().slice(7);
    }
  };
}

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-credentials-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('DB and SSH credentials are encrypted together and restored after a restart', t => {
  const file = path.join(directory(t), 'connections.json');
  const vault = createCredentialVault(keyStore());
  const store = createConnectionStore(file, vault);
  store.save({ name: 'local', password: 'db-test-secret', sshPassword: 'ssh-test-secret' });
  const persisted = fs.readFileSync(file, 'utf8');
  assert.ok(!persisted.includes('db-test-secret') && !persisted.includes('ssh-test-secret'));
  const restored = createConnectionStore(file, createCredentialVault(keyStore())).load()[0];
  assert.equal(restored.password, 'db-test-secret');
  assert.equal(restored.sshPassword, 'ssh-test-secret');
  assert.equal('encryptedCredentials' in restored, false);
});

test('Unavailable or basic_text storage keeps credentials in the session only', t => {
  for (const storage of [keyStore(false), keyStore(true, 'basic_text')]) {
    const file = path.join(directory(t), 'connections.json');
    const vault = createCredentialVault(storage);
    assert.equal(vault.available(), false);
    const store = createConnectionStore(file, vault);
    store.save({ name: 'local', password: 'session-db', sshPassword: 'session-ssh' });
    assert.equal(store.load()[0].sshPassword, 'session-ssh');
    assert.equal(store.load()[0].password, 'session-db');
    assert.ok(!fs.readFileSync(file, 'utf8').includes('session-'));
    const restarted = createConnectionStore(file, createCredentialVault(storage));
    assert.equal(restarted.load()[0].password, '');
    assert.equal(restarted.load()[0].sshPassword, '');
  }
});

test('Legacy connection loading migrates plaintext SSH and hex DB credentials', t => {
  const file = path.join(directory(t), 'connections.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'legacy', password: Buffer.from('sealed:db').toString('hex'), sshPassword: 'legacy-ssh' }]));
  const store = createConnectionStore(file, createCredentialVault(keyStore()));
  assert.equal(store.load()[0].password, 'db');
  assert.equal(store.load()[0].sshPassword, 'legacy-ssh');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))[0];
  assert.equal('password' in record, false);
  assert.equal('sshPassword' in record, false);
  assert.ok(record.encryptedCredentials.password && record.encryptedCredentials.sshPassword);
});

test('Unavailable storage removes legacy plaintext without losing existing ciphertext', t => {
  const file = path.join(directory(t), 'connections.json');
  fs.writeFileSync(file, JSON.stringify([{ name: 'legacy', password: Buffer.from('sealed:db').toString('hex'), sshPassword: 'legacy-ssh' }]));
  const store = createConnectionStore(file, createCredentialVault(keyStore(false)));
  assert.equal(store.load()[0].sshPassword, 'legacy-ssh');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('legacy-ssh'));
  assert.equal(createConnectionStore(file, createCredentialVault(keyStore())).load()[0].password, 'db');
});

test('AI settings migrate old API keys and never persist new plaintext keys', t => {
  const file = path.join(directory(t), 'ai.json');
  fs.writeFileSync(file, JSON.stringify({ isAiEnabled: true, apiKey: 'legacy-api', isEncrypted: false }));
  const store = createAiSettingsStore(file, createCredentialVault(keyStore()));
  assert.equal(store.load().apiKey, 'legacy-api');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('legacy-api'));
  const session = createAiSettingsStore(file, createCredentialVault(keyStore(false)));
  const before = fs.readFileSync(file);
  assert.throws(() => session.save({ isAiEnabled: true, apiKey: 'session-api' }), { code: 'CREDENTIAL_SAVE_FAILED' });
  assert.deepEqual(fs.readFileSync(file), before);
  const freshFile = path.join(path.dirname(file), 'session.json');
  const fresh = createAiSettingsStore(freshFile, createCredentialVault(keyStore(false)));
  assert.equal(fresh.save({ isAiEnabled: true, apiKey: 'session-api' }).credentialsPersisted, false);
  assert.equal(fresh.load().apiKey, 'session-api');
  assert.ok(!fs.readFileSync(freshFile, 'utf8').includes('session-api'));
});

test('Corrupt settings are reported without overwriting the file', t => {
  const file = path.join(directory(t), 'connections.json');
  fs.writeFileSync(file, '{invalid');
  const store = createConnectionStore(file, createCredentialVault(keyStore()));
  assert.throws(() => store.save({ name: 'new', password: 'test' }));
  assert.equal(fs.readFileSync(file, 'utf8'), '{invalid');
});

function deniedStorage() {
  return { ...keyStore(), decryptString() { throw new Error('Keychain access denied.'); } };
}

for (const mode of ['encrypted', 'session', 'locked']) {
  test(`${mode}: conflicting connection rename preserves file bytes, both credentials and independent ordering/deletion`, t => {
    const file = path.join(directory(t), 'connections.json');
    const initialVault = createCredentialVault(mode === 'session' ? keyStore(false) : keyStore());
    const initial = createConnectionStore(file, initialVault);
    initial.save({ name: 'A', host: 'fixture-a.invalid', password: 'fake-db-a', sshPassword: 'fake-ssh-a' });
    initial.save({ name: 'B', host: 'fixture-b.invalid', password: 'fake-db-b', sshPassword: 'fake-ssh-b' });
    const vault = mode === 'locked' ? createCredentialVault(deniedStorage()) : initialVault;
    const store = createConnectionStore(file, vault);
    const records = store.load(), before = fs.readFileSync(file);
    const mutations = [];
    for (const method of ['write', 'rename', 'forget']) {
      const original = vault[method];
      vault[method] = (...args) => { mutations.push(method); return original(...args); };
    }
    assert.throws(() => store.save({ ...records[0], name: 'B', password: 'fake-replacement' }, 'A'),
      error => error.code === 'CONNECTION_NAME_CONFLICT');
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(mutations, []);
    assert.deepEqual(store.load(), records);
    if (mode !== 'session') {
      const restarted = createConnectionStore(file, createCredentialVault(keyStore())).load();
      assert.equal(restarted[0].password, 'fake-db-a'); assert.equal(restarted[1].password, 'fake-db-b');
      assert.equal(restarted[0].sshPassword, 'fake-ssh-a'); assert.equal(restarted[1].sshPassword, 'fake-ssh-b');
    }
    store.reorder(records.toReversed());
    assert.deepEqual(store.load().map(record => record.name), ['B', 'A']);
    store.remove('B');
    assert.deepEqual(store.load().map(record => record.name), ['A']);
    assert.equal(store.load()[0].host, 'fixture-a.invalid');
    if (mode !== 'locked') assert.equal(store.load()[0].password, 'fake-db-a');
  });
}

test('A connection can keep its own name or rename to an unused name without changing another connection', t => {
  const file = path.join(directory(t), 'connections.json');
  const store = createConnectionStore(file, createCredentialVault(keyStore(false)));
  store.save({ name: 'A', host: 'fixture-a.invalid', password: 'fake-a' });
  store.save({ name: 'B', host: 'fixture-b.invalid', password: 'fake-b' });
  store.save({ ...store.load()[0], host: 'updated.invalid' }, 'A');
  store.save({ ...store.load()[0], name: 'C' }, 'A');
  const records = store.load();
  assert.deepEqual(records.map(record => record.name), ['C', 'B']);
  assert.equal(records[0].password, 'fake-a'); assert.equal(records[0].host, 'updated.invalid');
  assert.equal(records[1].password, 'fake-b'); assert.equal(records[1].host, 'fixture-b.invalid');
});

test('A stale original name cannot replace a different existing connection', t => {
  const file = path.join(directory(t), 'connections.json');
  const store = createConnectionStore(file, createCredentialVault(keyStore()));
  store.save({ name: 'B', host: 'fixture-b.invalid' });
  const before = fs.readFileSync(file);
  assert.throws(() => store.save({ name: 'B', host: 'unexpected.invalid' }, 'missing'), error => error.code === 'CONNECTION_NAME_CONFLICT');
  assert.deepEqual(fs.readFileSync(file), before);
});

test('Failed decryption survives connection edits, renaming, ordering, and a later unlock', t => {
  const file = path.join(directory(t), 'connections.json');
  const initial = createConnectionStore(file, createCredentialVault(keyStore()));
  initial.save({ name: 'first', password: 'original-db', sshPassword: 'original-ssh' });
  initial.save({ name: 'second', password: 'second-db' });
  const original = JSON.parse(fs.readFileSync(file, 'utf8'));
  const locked = createConnectionStore(file, createCredentialVault(deniedStorage()));
  const records = locked.load();
  assert.deepEqual(records[0].unavailableCredentials, ['password', 'sshPassword']);
  locked.reorder(records.toReversed());
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original.toReversed());
  const beforeChange = fs.readFileSync(file);
  assert.throws(() => locked.save({ ...records[0], name: 'renamed', host: 'new-host' }, 'first'), { code: 'CREDENTIAL_CONTEXT_CHANGED' });
  assert.deepEqual(fs.readFileSync(file), beforeChange);
  locked.save({ ...records[0], name: 'renamed', environmentLabel: 'Production' }, 'first');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).find(record => record.name === 'renamed');
  assert.deepEqual(saved.encryptedCredentials, original[0].encryptedCredentials);
  assert.equal('unavailableCredentials' in saved, false);
  const recovered = createConnectionStore(file, createCredentialVault(keyStore())).load().find(record => record.name === 'renamed');
  assert.equal(recovered.password, 'original-db');
  assert.equal(recovered.sshPassword, 'original-ssh');
});

test('Unreadable legacy ciphertext is migrated intact rather than treated as plaintext', t => {
  const file = path.join(directory(t), 'connections.json');
  const encrypted = Buffer.from('sealed:legacy-db').toString('hex');
  fs.writeFileSync(file, JSON.stringify([{ name: 'legacy', password: encrypted }]));
  const record = createConnectionStore(file, createCredentialVault(deniedStorage())).load()[0];
  assert.equal(record.password, '');
  assert.deepEqual(record.unavailableCredentials, ['password']);
  assert.equal(createConnectionStore(file, createCredentialVault(keyStore())).load()[0].password, 'legacy-db');
});

test('Failed AI key decryption survives settings changes and legacy migration', t => {
  for (const legacy of [false, true]) {
    const file = path.join(directory(t), 'ai.json');
    if (legacy) fs.writeFileSync(file, JSON.stringify({ apiKey: Buffer.from('sealed:original-api').toString('base64'), isEncrypted: true }));
    else createAiSettingsStore(file, createCredentialVault(keyStore())).save({ apiKey: 'original-api', modelName: 'old' });
    const locked = createAiSettingsStore(file, createCredentialVault(deniedStorage()));
    const config = locked.load();
    assert.deepEqual(config.unavailableCredentials, ['apiKey']);
    locked.save({ ...config, modelName: 'new' });
    const restored = createAiSettingsStore(file, createCredentialVault(keyStore())).load();
    assert.equal(restored.apiKey, 'original-api');
    assert.equal(restored.modelName, 'new');
  }
});

test('Encryption failure preserves the complete previous AI record and session credentials', t => {
  const file = path.join(directory(t), 'ai.json');
  createAiSettingsStore(file, createCredentialVault(keyStore())).save({ apiKey: 'previous-api' });
  const vault = createCredentialVault({ ...keyStore(), encryptString() { throw new Error('Secure storage locked.'); } });
  const store = createAiSettingsStore(file, vault);
  store.load();
  const before = fs.readFileSync(file);
  assert.throws(() => store.save({ apiKey: 'replacement-api' }), { code: 'CREDENTIAL_SAVE_FAILED' });
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(store.load().apiKey, 'previous-api');
  assert.equal(createAiSettingsStore(file, createCredentialVault(keyStore())).load().apiKey, 'previous-api');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('replacement-api'));
});

test('Users can replace unreadable secrets and explicitly clear successfully unlocked secrets', t => {
  const file = path.join(directory(t), 'ai.json');
  createAiSettingsStore(file, createCredentialVault(keyStore())).save({ apiKey: 'original-api' });
  const locked = createAiSettingsStore(file, createCredentialVault(deniedStorage()));
  locked.load();
  locked.save({ apiKey: 'new-api' });
  const unlocked = createAiSettingsStore(file, createCredentialVault(keyStore()));
  assert.equal(unlocked.load().apiKey, 'new-api');
  unlocked.save({ apiKey: '' });
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(file, 'utf8')).encryptedCredentials, 'apiKey'), false);
});

test('Clearing an unlocked secret does not require encryption or preserve it after the key store locks', t => {
  const file = path.join(directory(t), 'ai.json');
  let enabled = true;
  const storage = { ...keyStore(), isEncryptionAvailable: () => enabled };
  const store = createAiSettingsStore(file, createCredentialVault(storage));
  store.save({ apiKey: 'remove-this-key' });
  assert.equal(store.load().apiKey, 'remove-this-key');
  enabled = false;
  assert.equal(store.save({ apiKey: '' }).credentialsPersisted, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).encryptedCredentials, {});
});

for (const mode of ['encrypted', 'session', 'locked']) {
  test(`${mode}: new and duplicate connection names cannot overwrite saved records or credentials`, t => {
    const file = path.join(directory(t), 'connections.json');
    const initialVault = createCredentialVault(mode === 'session' ? keyStore(false) : keyStore());
    const initial = createConnectionStore(file, initialVault);
    initial.save({ name: 'A', host: 'original.invalid', password: 'fictional-db', sshPassword: 'fictional-ssh' });
    initial.save({ name: 'A - Copy', host: 'copy.invalid', password: 'fictional-copy' });
    const vault = mode === 'locked' ? createCredentialVault(deniedStorage()) : initialVault;
    const store = createConnectionStore(file, vault);
    const before = fs.readFileSync(file), records = store.load(), mutations = [];
    for (const method of ['write', 'rename', 'forget']) {
      const original = vault[method];
      vault[method] = (...args) => { mutations.push(method); return original(...args); };
    }
    for (const originalName of ['', undefined]) {
      for (const name of ['A', 'A - Copy']) {
        assert.throws(() => store.save({ name, host: 'replacement.invalid', password: 'fictional-replacement' }, originalName),
          error => error.code === 'CONNECTION_NAME_CONFLICT');
      }
    }
    assert.deepEqual(fs.readFileSync(file), before);
    assert.deepEqual(store.load(), records);
    assert.deepEqual(mutations, []);
    if (mode !== 'session') {
      const restored = createConnectionStore(file, createCredentialVault(keyStore())).load();
      assert.equal(restored[0].password, 'fictional-db');
      assert.equal(restored[0].sshPassword, 'fictional-ssh');
      assert.equal(restored[1].password, 'fictional-copy');
    }
  });
}

for (const mode of ['encrypted', 'session', 'locked']) {
  for (const kind of ['connection', 'AI']) {
    test(`${mode}: failed ${kind} persistence preserves session credentials and persistence status`, t => {
      const { loadModule } = require('./helpers/loadModule.cjs');
      const json = require('../electron/services/jsonFiles');
      let fail = false;
      const boundary = { ...json, atomicWriteJson(file, value) {
        if (fail) throw new Error('Simulated disk write failure');
        return json.atomicWriteJson(file, value);
      } };
      const file = path.join(directory(t), 'settings.json');
      const firstVault = createCredentialVault(mode === 'session' ? keyStore(false) : keyStore());
      const makeStore = vault => {
        const module = loadModule(kind === 'connection' ? 'electron/services/connections.js' : 'electron/services/aiSettings.js',
          { './jsonFiles': boundary }, {}, { strict: false });
        return kind === 'connection' ? module.createConnectionStore(file, vault) : module.createAiSettingsStore(file, vault);
      };
      makeStore(firstVault).save(kind === 'connection' ? { name: 'A', password: 'fictional-old', sshPassword: 'fictional-ssh', host: 'original.invalid' } : { apiKey: 'fictional-old', modelName: 'original' });
      const vault = mode === 'locked' ? createCredentialVault(deniedStorage()) : firstVault;
      const store = makeStore(vault), before = fs.readFileSync(file), loaded = store.load();
      const identity = kind === 'connection' ? 'connection:A' : 'ai';
      const persisted = vault.isPersisted(identity);
      fail = true;
      const replacements = kind === 'connection' ? [
        { name: 'A', password: 'fictional-new', sshPassword: 'fictional-new-ssh' },
        { name: 'Renamed', password: 'fictional-new' }
      ] : [{ apiKey: 'fictional-new', modelName: 'replacement' }, { apiKey: '', modelName: 'cleared' }];
      for (const replacement of replacements) {
        assert.throws(() => store.save(replacement, 'A'), /Simulated disk write failure/);
        assert.deepEqual(fs.readFileSync(file), before);
        assert.deepEqual(store.load(), loaded);
        assert.equal(vault.isPersisted(identity), persisted);
      }
      if (kind === 'connection') {
        assert.throws(() => store.save({ name: 'New', password: 'fictional-new' }), /Simulated disk write failure/);
        assert.equal(vault.read({}, ['password'], 'connection:New').password, '');
        assert.equal(vault.read({}, ['password'], 'connection:Renamed').password, '');
      }
      fail = false; store.save(replacements[0], 'A');
      const restored = store.load();
      assert.equal(kind === 'connection' ? restored[0].password : restored.apiKey, 'fictional-new');
      assert.notDeepEqual(fs.readFileSync(file), before);
    });
  }
}

for (const kind of ['connection', 'AI']) {
  test(`Failed ${kind} legacy migration does not commit staged credential writes`, t => {
    const { loadModule } = require('./helpers/loadModule.cjs');
    const json = require('../electron/services/jsonFiles');
    const file = path.join(directory(t), 'legacy.json');
    fs.writeFileSync(file, JSON.stringify(kind === 'connection' ? [{ name: 'A', sshPassword: 'fictional-legacy' }, { name: 'B', sshPassword: 'fictional-second' }] : { apiKey: 'fictional-legacy', isEncrypted: false }));
    const before = fs.readFileSync(file), vault = createCredentialVault(keyStore(false));
    let fail = true, commits = 0;
    const original = vault.prepareWrite;
    vault.prepareWrite = (...args) => {
      const prepared = original(...args);
      return { record: prepared.record, commit() { commits++; prepared.commit(); } };
    };
    const module = loadModule(kind === 'connection' ? 'electron/services/connections.js' : 'electron/services/aiSettings.js', {
      './jsonFiles': { ...json, atomicWriteJson(file, value) {
        if (fail) throw new Error('Simulated migration write failure');
        return json.atomicWriteJson(file, value);
      } }
    }, {}, { strict: false });
    const store = kind === 'connection' ? module.createConnectionStore(file, vault) : module.createAiSettingsStore(file, vault);
    assert.throws(() => store.load(), /Simulated migration write failure/);
    assert.equal(commits, 0); assert.deepEqual(fs.readFileSync(file), before);
    fail = false; store.load(); assert.equal(commits, kind === 'connection' ? 2 : 1);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('fictional-legacy'));
  });
}

test('Environment identity survives restart, duplication, rename and reorder without replacing credentials', t => {
  const file = path.join(directory(t), 'connections.json');
  const store = createConnectionStore(file, createCredentialVault(keyStore()));
  store.save({ name: 'primary', password: 'private-test', environmentLabel: 'Production', environmentColor: 'red' });
  const source = store.load()[0];
  store.save({ ...source, name: 'copy', environmentLabel: 'Development', environmentColor: 'green' });
  store.save({ ...source, name: 'renamed' }, 'primary');
  store.reorder([{ name: 'copy' }, { name: 'renamed' }]);
  const restored = createConnectionStore(file, createCredentialVault(keyStore())).load();
  assert.deepEqual(restored.map(row => [row.name, row.environmentLabel, row.environmentColor, row.password]), [
    ['copy', 'Development', 'green', 'private-test'], ['renamed', 'Production', 'red', 'private-test']
  ]);
  const before = fs.readFileSync(file, 'utf8');
  for (const changes of [{ environmentLabel: 'x'.repeat(41) }, { environmentLabel: {} }, { environmentColor: 'url(invalid)' }]) {
    assert.throws(() => store.save({ ...source, ...changes }, 'renamed'), /Invalid environment/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  }
});

for (const kind of ['AI', 'connection']) {
  test(`${kind}: encryption failure cannot persist a new destination with an old secret across restart`, t => {
    const file = path.join(directory(t), 'settings.json');
    let available = true;
    const storage = { ...keyStore(), isEncryptionAvailable: () => available };
    const vault = createCredentialVault(storage);
    const make = item => kind === 'AI' ? createAiSettingsStore(file, item) : createConnectionStore(file, item);
    const store = make(vault);
    const original = kind === 'AI' ? { endpointUrl: 'https://old.invalid/v1', apiKey: 'dummy-old-key', modelName: 'old' }
      : { name: 'demo', dbType: 'postgresql', host: 'old.invalid', user: 'old_user', password: 'dummy-old-db', sshPassword: 'dummy-old-ssh' };
    const replacement = kind === 'AI' ? { ...original, endpointUrl: 'https://new.invalid/v1', apiKey: 'dummy-new-key', modelName: 'new' }
      : { ...original, host: 'new.invalid', user: 'new_user', password: 'dummy-new-db', sshPassword: 'dummy-new-ssh' };
    store.save(original);
    const bytes = fs.readFileSync(file), oldRecord = store.load(), status = vault.isPersisted(kind === 'AI' ? 'ai' : 'connection:demo');
    available = false;
    assert.throws(() => store.save(replacement, 'demo'), error => error.code === 'CREDENTIAL_SAVE_FAILED' && !error.message.includes('dummy-'));
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(vault.isPersisted(kind === 'AI' ? 'ai' : 'connection:demo'), status);
    assert.deepEqual(store.load(), oldRecord);
    available = true;
    assert.deepEqual(make(createCredentialVault(storage)).load(), oldRecord);
    store.save(replacement, 'demo');
    const restored = make(createCredentialVault(storage)).load();
    if (kind === 'AI') { assert.equal(restored.endpointUrl, replacement.endpointUrl); assert.equal(restored.apiKey, replacement.apiKey); }
    else { assert.equal(restored[0].host, replacement.host); assert.equal(restored[0].password, replacement.password); assert.equal(restored[0].sshPassword, replacement.sshPassword); }
  });
}

test('A partial DB/SSH encryption failure publishes neither settings nor session secrets', t => {
  const file = path.join(directory(t), 'connections.json');
  const storage = { ...keyStore(), encryptString(value) {
    if (value === 'dummy-new-ssh') throw new Error('Dummy provider error containing dummy-new-ssh');
    return keyStore().encryptString(value);
  } };
  const vault = createCredentialVault(storage), store = createConnectionStore(file, vault);
  store.save({ name: 'demo', host: 'old.invalid', password: 'dummy-old-db', sshPassword: 'dummy-old-ssh' });
  const before = fs.readFileSync(file), old = store.load();
  assert.throws(() => store.save({ ...old[0], host: 'new.invalid', password: 'dummy-new-db', sshPassword: 'dummy-new-ssh' }, 'demo'),
    error => error.code === 'CREDENTIAL_SAVE_FAILED' && !error.message.includes('dummy-new-ssh'));
  assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(store.load(), old);
});

test('Unreadable AI keys cannot follow changed endpoint paths or origins but harmless metadata edits survive unlock', t => {
  const file = path.join(directory(t), 'ai.json');
  createAiSettingsStore(file, createCredentialVault(keyStore())).save({ endpointUrl: 'https://old.invalid/v1', apiKey: 'dummy-original' });
  const locked = createAiSettingsStore(file, createCredentialVault(deniedStorage())), original = locked.load();
  const before = fs.readFileSync(file);
  for (const endpointUrl of ['https://new.invalid/v1', 'https://old.invalid/v2', 'http://127.0.0.1:1234/v1']) {
    assert.throws(() => locked.save({ ...original, endpointUrl, apiKey: '' }), { code: 'CREDENTIAL_CONTEXT_CHANGED' });
    assert.deepEqual(fs.readFileSync(file), before);
  }
  locked.save({ ...original, endpointUrl: 'https://OLD.invalid:443/v1/', modelName: 'new-model', isAiEnabled: false });
  const restored = createAiSettingsStore(file, createCredentialVault(keyStore())).load();
  assert.equal(restored.apiKey, 'dummy-original'); assert.equal(restored.modelName, 'new-model');
  locked.save({ ...original, endpointUrl: 'https://new.invalid/v1', apiKey: 'dummy-reentered' });
  assert.equal(createAiSettingsStore(file, createCredentialVault(keyStore())).load().apiKey, 'dummy-reentered');
});

test('Unreadable DB and SSH secrets are scoped to their own recipients, routes, TLS settings and key files', t => {
  const file = path.join(directory(t), 'connections.json');
  const original = { name: 'demo', dbType: 'postgresql', host: 'db.invalid', port: '5432', database: 'demo', user: 'db_user',
    password: 'dummy-db', useSshTunnel: true, sshHost: 'ssh.invalid', sshPort: '22', sshUser: 'ssh_user', sshAuthType: 'key', sshKeyFile: '/fictional/key', sshPassword: 'dummy-passphrase' };
  createConnectionStore(file, createCredentialVault(keyStore())).save(original);
  const locked = createConnectionStore(file, createCredentialVault(deniedStorage())), loaded = locked.load()[0], before = fs.readFileSync(file);
  for (const change of [{ dbType: 'oracle' }, { host: 'other.invalid' }, { port: '5433' }, { database: 'other' }, { user: 'other' },
    { useSshTunnel: false }, { sshHost: 'other.invalid' }, { sshPort: '2222' }, { sshUser: 'other' }, { sshAuthType: 'password' },
    { sshKeyFile: '/fictional/other' }, { pgSslMode: 'verify-full' }, { pgSslCaFile: '/fictional/ca' }, { pgSslServerName: 'other.invalid' }]) {
    assert.throws(() => locked.save({ ...loaded, ...change }, 'demo'), { code: 'CREDENTIAL_CONTEXT_CHANGED' });
    assert.deepEqual(fs.readFileSync(file), before);
  }
  locked.save({ ...loaded, name: 'renamed', environmentLabel: 'Development', host: 'DB.INVALID', port: 5432 }, 'demo');
  const safe = locked.load()[0];
  // Only the DB password needs re-entry when the SSH recipient remains the same.
  locked.save({ ...safe, host: 'new-db.invalid', password: 'dummy-new-db' }, 'renamed');
  const restored = createConnectionStore(file, createCredentialVault(keyStore())).load()[0];
  assert.equal(restored.host, 'new-db.invalid'); assert.equal(restored.password, 'dummy-new-db');
  assert.equal(restored.sshPassword, original.sshPassword);
});

for (const language of ['en', 'ja']) {
  test(`${language}: AI credential failures are translated without exposing provider messages`, async () => {
    const { loadModule } = require('./helpers/loadModule.cjs');
    const { translate } = require('../electron/i18n');
    for (const [code, key] of [['CREDENTIAL_SAVE_FAILED', 'credentials_save_failed'], ['CREDENTIAL_CONTEXT_CHANGED', 'credentials_context_changed']]) {
      const handlers = new Map();
      loadModule('electron/ipc/ai.js', {}, {}, { strict: false }).registerAiHandlers({
        ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, t: key => translate(key, language),
        aiSettingsStore: { save() { throw Object.assign(new Error('DUMMY_PRIVATE_PROVIDER_MESSAGE'), { code }); } }
      });
      const result = await handlers.get('save-ai-settings')(null, { endpointUrl: 'https://example.invalid/v1', apiKey: 'DUMMY_NEW_API_KEY' });
      assert.equal(result.success, false); assert.equal(result.error, translate(key, language));
      assert.ok(!result.error.includes('DUMMY_PRIVATE_PROVIDER_MESSAGE')); assert.ok(!result.error.includes('DUMMY_NEW_API_KEY'));
    }
  });
}
