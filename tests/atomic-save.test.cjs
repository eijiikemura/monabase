// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const iconv = require('iconv-lite');
const { loadModule } = require('./helpers/loadModule.cjs');

function fixture(t, failure) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-save-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let failed = false;
  const fake = { ...fs };
  if (failure) fake[failure] = (...args) => {
    if (!failed) {
      failed = true;
      if (failure === 'writeFileSync') fs.writeFileSync(args[0], Buffer.from('partial'));
      throw Object.assign(new Error('Simulated storage failure'), { code: 'EIO' });
    }
    return fs[failure](...args);
  };
  const atomic = loadModule('electron/services/atomicFiles.js', { 'node:fs': fake, 'node:path': path, 'node:crypto': require('node:crypto') });
  const handlers = new Map();
  const event = { sender: {}, senderFrame: {} };
  let selected;
  loadModule('electron/ipc/files.js', { '../services/atomicFiles': atomic }, {}, { strict: false }).registerFileHandlers({
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: selected }) }, getWindow: () => null,
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, t: key => key
  });
  return { directory, file: path.join(directory, 'export.csv'), save: async (...args) => { try { selected = args[0]; const grant = await handlers.get('show-save-dialog')(event, {}); return handlers.get('save-file')(event, ...args, grant.writeToken); } catch (error) { return { success: false, error: error.message }; } } };
}
for (const failure of ['openSync', 'writeFileSync', 'fchmodSync', 'fsyncSync', 'closeSync', 'renameSync']) {
  test(`A failed export ${failure} preserves the existing file and removes temporary data`, async t => {
    const h = fixture(t, failure), original = Buffer.from('Previous complete export');
    fs.writeFileSync(h.file, original);
    const result = await h.save(h.file, 'New export', 'utf8');
    assert.equal(result.success, false); assert.match(result.error, /Simulated storage failure/);
    assert.ok(fs.readFileSync(h.file).equals(original));
    assert.deepEqual(fs.readdirSync(h.directory), ['export.csv']);
    assert.equal((await h.save(h.file, 'Successful retry', 'utf8')).success, true);
    assert.equal(fs.readFileSync(h.file, 'utf8'), 'Successful retry');
    assert.deepEqual(fs.readdirSync(h.directory), ['export.csv']);
  });
}
for (const encoding of ['utf8', 'sjis', 'binary']) {
  test(`${encoding}: incomplete output neither creates a new destination nor overwrites an old one`, async t => {
    const data = encoding === 'binary' ? Buffer.from([0, 128, 255]) : '日本語\r\nexport';
    for (const exists of [false, true]) {
      const h = fixture(t, 'writeFileSync');
      if (exists) fs.writeFileSync(h.file, 'Original');
      assert.equal((await h.save(h.file, data, encoding)).success, false);
      if (exists) assert.equal(fs.readFileSync(h.file, 'utf8'), 'Original');
      else assert.equal(fs.existsSync(h.file), false);
      assert.deepEqual(fs.readdirSync(h.directory), exists ? ['export.csv'] : []);
    }
  });
  test(`${encoding}: complete output replaces existing files with exact bytes`, async t => {
    const h = fixture(t), data = encoding === 'binary' ? Uint8Array.from([0, 128, 255]) : '日本語\r\nexport';
    const expected = encoding === 'binary' ? Buffer.from(data) : encoding === 'sjis' ? iconv.encode(data, 'Shift_JIS') : Buffer.from(data);
    for (const exists of [false, true]) {
      if (exists) fs.writeFileSync(h.file, 'Original');
      assert.equal((await h.save(h.file, data, encoding)).success, true);
      assert.ok(fs.readFileSync(h.file).equals(expected));
      assert.deepEqual(fs.readdirSync(h.directory), ['export.csv']);
    }
  });
}
test('Export failures do not remove an existing directory', async t => {
  const h = fixture(t); fs.mkdirSync(h.file);
  const result = await h.save(h.file, 'Export', 'utf8');
  assert.equal(result.success, false); assert.ok(fs.statSync(h.file).isDirectory());
  assert.deepEqual(fs.readdirSync(h.directory), ['export.csv']);
});
if (process.platform !== 'win32') {
  test('Replacing an export retains permissions and rejects a read-only destination', async t => {
    const h = fixture(t); fs.writeFileSync(h.file, 'Original', { mode: 0o640 });
    assert.equal((await h.save(h.file, 'Updated', 'utf8')).success, true);
    assert.equal(fs.statSync(h.file).mode & 0o777, 0o640);
    fs.chmodSync(h.file, 0o440);
    assert.equal((await h.save(h.file, 'Rejected', 'utf8')).success, false);
    assert.equal(fs.readFileSync(h.file, 'utf8'), 'Updated');
    fs.chmodSync(h.file, 0o600);
  });
  test('Exports through a symbolic link update the target without replacing the link', async t => {
    const h = fixture(t), target = path.join(h.directory, 'target.csv');
    fs.writeFileSync(target, 'Original'); fs.symlinkSync(target, h.file);
    assert.equal((await h.save(h.file, 'Updated', 'utf8')).success, true);
    assert.ok(fs.lstatSync(h.file).isSymbolicLink()); assert.equal(fs.readFileSync(target, 'utf8'), 'Updated');
    fs.unlinkSync(target);
    assert.equal((await h.save(h.file, 'Rejected', 'utf8')).success, false);
    assert.ok(fs.lstatSync(h.file).isSymbolicLink()); assert.equal(fs.existsSync(target), false);
  });
}
