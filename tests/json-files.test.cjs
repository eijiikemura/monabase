// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadModule } = require('./helpers/loadModule.cjs');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('../electron/services/jsonFiles');
const { createSettingsStore } = require('../electron/services/settings');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-json-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, file: path.join(directory, 'settings.json') };
}

test('Atomic JSON replacement writes complete private files and removes temporary files', t => {
  const { directory, file } = fixture(t);
  atomicWriteJson(file, { value: 'old' });
  atomicWriteJson(file, { value: '日本語', nested: [1, 2] });
  assert.deepEqual(readJsonFile(file), { value: '日本語', nested: [1, 2] });
  assert.deepEqual(fs.readdirSync(directory), ['settings.json']);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

for (const operation of ['writeFileSync', 'fsyncSync', 'renameSync']) {
  test(`A failed ${operation} preserves the original settings and cleans up its temporary file`, t => {
    const { directory, file } = fixture(t);
    atomicWriteJson(file, { value: 'original' });
    const { atomicWriteJson: failingWrite } = loadModule('electron/services/jsonFiles.js', {
      './dataSafety': require('../electron/services/dataSafety'),
      'node:fs': { ...fs, [operation](...args) {
        if (operation === 'writeFileSync') fs.writeFileSync(args[0], '{partial');
        throw new Error('Simulated disk failure.');
      } },
      'node:path': path, 'node:crypto': require('node:crypto')
    });
    assert.throws(() => failingWrite(file, { value: 'replacement' }), /Simulated disk failure/);
    assert.deepEqual(readJsonFile(file), { value: 'original' });
    assert.deepEqual(fs.readdirSync(directory), ['settings.json']);
  });
}

test('Corrupt JSON retains original bytes and one recovery copy without resetting preferences on load', t => {
  const { directory, file } = fixture(t);
  const original = Buffer.from('{broken\n日本語');
  fs.writeFileSync(file, original);
  const store = createSettingsStore({ app: { isReady: () => true, getLocale: () => 'en' }, SETTINGS_FILE: file, t: text => text, setLanguage() {} });
  assert.equal(store.load().queryTimeout, 0);
  assert.equal(store.load().queryTimeout, 0);
  assert.ok(fs.readFileSync(file).equals(original));
  const backups = fs.readdirSync(directory).filter(name => name.endsWith('.bak'));
  assert.equal(backups.length, 1);
  assert.ok(fs.readFileSync(path.join(directory, backups[0])).equals(original));
  store.save({ theme: 'dark', queryTimeout: 30 });
  assert.equal(readJsonFile(file).theme, 'dark');
  assert.ok(fs.readFileSync(path.join(directory, backups[0])).equals(original));
});

test('Unexpected JSON structures are preserved and reported instead of accepted as settings', t => {
  const { file } = fixture(t);
  for (const value of [null, [], 'invalid']) {
    atomicWriteJson(file, value);
    assert.throws(() => readJsonFile(file, isJsonObject), { code: 'INVALID_JSON_SETTINGS' });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), value);
  }
});

test('Existing recovery copies reject excessive size and special files without reading or modifying originals', t => {
  const { file } = fixture(t), original = Buffer.from('{broken');
  const { createHash } = require('node:crypto');
  const { INTERNAL_FILE_MAX_BYTES } = require('../electron/services/dataSafety');
  const backup = `${file}.corrupt-${createHash('sha256').update(original).digest('hex')}.bak`;
  fs.writeFileSync(file, original);
  const fd = fs.openSync(backup, 'w'); fs.ftruncateSync(fd, INTERNAL_FILE_MAX_BYTES + 1); fs.closeSync(fd);
  assert.throws(() => readJsonFile(file), { code: 'internal_data_too_large' });
  assert.deepEqual(fs.readFileSync(file), original); assert.equal(fs.statSync(backup).size, INTERNAL_FILE_MAX_BYTES + 1);
  fs.unlinkSync(backup); fs.mkdirSync(backup);
  assert.throws(() => readJsonFile(file), { code: 'internal_data_not_regular' });
  assert.deepEqual(fs.readFileSync(file), original);
  fs.rmdirSync(backup); fs.writeFileSync(backup, original);
  assert.throws(() => readJsonFile(file), { code: 'INVALID_JSON_SETTINGS' });
  assert.deepEqual(fs.readFileSync(backup), original);
});
