// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const assert = require('node:assert/strict');
const { test } = require('node:test');

function createLoader(result) {
  const calls = [];
  const { loadPackageSource } = loadTypeScript('src/features/stored/packageCreation.ts', {
    '@/shared/api/desktop': { ipcRenderer: { async invoke(...args) { calls.push(args); return result; } } },
    i18next: { t: (key, values) => require('../electron/i18n').translate(key, 'ja', values) }
  });
  return { load: loadPackageSource, calls };

}

test('Loads all eight thousand lines of each package specification and body in one query', async () => {
  for (const type of ['PACKAGE', 'PACKAGE BODY']) {
    const source = `CREATE OR REPLACE ${type} "TEST_USER"."LARGE_PKG" AS\n`
      + Array.from({ length: 8000 }, (_, index) => `  -- 日本語コメント ${index}`).join('\n')
      + '\nEND LARGE_PKG;\n';
    const { load, calls } = createLoader({ success: true, rows: [{ DDL: source }] });
    assert.equal(await load('TEST_USER', 'LARGE_PKG', type), source.trim() + '\n/');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'execute-sql-bg');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), {
      ddlType: type === 'PACKAGE' ? 'PACKAGE_SPEC' : 'PACKAGE_BODY',
      name: 'LARGE_PKG', owner: 'TEST_USER'
    });
  }
});

test('Rejects failed, missing, and empty source definitions', async () => {
  for (const result of [
    { success: false, error: '取得エラー' },
    { success: true, rows: [] },
    { success: true, rows: [{ DDL: null }] },
    { success: true, rows: [{ DDL: '  ' }] }
  ]) {
    const { load } = createLoader(result);
    await assert.rejects(load('TEST_USER', 'LARGE_PKG', 'PACKAGE BODY'),
      error => error.message === (result.error || 'ソースの取得に失敗しました。'));
  }
});

test('Does not duplicate the trailing execution slash', async () => {
  const { load } = createLoader({ success: true, rows: [{ DDL: 'PACKAGE BODY P AS\nEND P;\n/\n' }] });
  assert.equal(await load('TEST_USER', 'P', 'PACKAGE BODY'), 'PACKAGE BODY P AS\nEND P;\n/');
});
