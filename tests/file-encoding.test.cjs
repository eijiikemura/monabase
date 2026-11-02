// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const iconv = require('iconv-lite');
const { loadModule } = require('./helpers/loadModule.cjs');
const { translate } = require('../electron/i18n');

function fixture(t, language = 'en') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-encoding-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const handlers = new Map();
  const event = { sender: {}, senderFrame: {} };
  let selected;
  const { registerFileHandlers } = loadModule('electron/ipc/files.js', {
    '../services/sqlPrivacy': require('../electron/services/sqlPrivacy'),
    '../services/boundedFiles': require('../electron/services/boundedFiles'),
    '../services/settings': require('../electron/services/settings'),
    '../services/filePermissions': require('../electron/services/filePermissions'),
    '../services/atomicFiles': require('../electron/services/atomicFiles'),
    'node:fs': fs, 'iconv-lite': iconv, 'node:crypto': require('node:crypto'),
    '../services/jsonFiles': require('../electron/services/jsonFiles')
  });
  registerFileHandlers({ dialog: { showSaveDialog: async () => ({ canceled: false, filePath: selected }) }, getWindow: () => null, ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    t: (key, values) => translate(key, language, values) });
  return { file: path.join(directory, 'export.csv'),
    save: async (file, data, encoding) => { selected = file; const grant = await handlers.get('show-save-dialog')(event, {}); return handlers.get('save-file')(event, file, data, encoding, grant.writeToken); } };
}

for (const [name, text] of [['supplementary characters', 'name,𠮷田😀\r\n'], ['emoji', 'quoted,"emoji 😀",?\r\n'], ['wave dash', 'name,〜\r\n'], ['yen sign mapping', 'currency,¥\r\n']]) {
  test(`Lossy Shift-JIS output neither creates nor overwrites a destination: ${name}`, async t => {
    const h = fixture(t);
    assert.equal((await h.save(h.file, text, 'sjis')).success, false);
    assert.equal(fs.existsSync(h.file), false);
    const original = Buffer.from('Existing export must survive.\r\n');
    fs.writeFileSync(h.file, original);
    const result = await h.save(h.file, text, 'sjis');
    assert.equal(result.success, false);
    assert.match(result.error, /Select UTF-8/);
    assert.ok(fs.readFileSync(h.file).equals(original));
    assert.ok(!result.error.includes(text), 'Errors must not expose exported data');
  });
}

test('Representable Japanese, CP932 extensions, half-width kana and literal question marks export unchanged', async t => {
  const h = fixture(t);
  const text = 'name,note\r\n"日本語,髙﨑",ｶﾀｶﾅ ? \\ ""quote""\r\n';
  assert.equal((await h.save(h.file, text, 'sjis')).success, true);
  const bytes = fs.readFileSync(h.file);
  assert.ok(bytes.equals(iconv.encode(text, 'Shift_JIS')));
  assert.equal(iconv.decode(bytes, 'Shift_JIS'), text);
});

test('UTF-8 retry preserves characters rejected for Shift-JIS and binary output preserves every byte', async t => {
  const h = fixture(t), text = '𠮷田😀,〜,¥\r\n';
  assert.equal((await h.save(h.file, text, 'sjis')).success, false);
  assert.equal((await h.save(h.file, text, 'utf8')).success, true);
  assert.equal(fs.readFileSync(h.file, 'utf8'), text);
  const bytes = Uint8Array.from([0, 0x3f, 0x80, 0xff]);
  assert.equal((await h.save(h.file, bytes, 'binary')).success, true);
  assert.ok(fs.readFileSync(h.file).equals(Buffer.from(bytes)));
});

test('Shift-JIS failure guides Japanese users to UTF-8', async t => {
  const h = fixture(t, 'ja');
  const result = await h.save(h.file, '😀', 'sjis');
  assert.equal(result.success, false);
  assert.match(result.error, /UTF-8に変更/);
  assert.match(result.error, /ファイルは保存していません/);
});
