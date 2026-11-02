// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const translations = require('../electron/i18n');
const { loadModule } = require('./helpers/loadModule.cjs');

test('Already loaded trace modules follow language changes immediately', () => {
  const messages = [];
  const { createTraceDatabase } = loadModule('electron/services/traceStore.js', {
    '../i18n': translations,
    fs: { existsSync: () => true, unlinkSync() {} }
  }, { console: { log: value => messages.push(value) } }, { strict: false });
  const modules = ['oracle', 'postgres'].map(database => ({ TraceDatabase: createTraceDatabase(database, {
    getStoragePaths: () => ({ traceDirectory: '/test/trace' })
  }) }));
  try {
    for (const language of ['ja', 'en']) {
      translations.setLanguage(language);
      for (const { TraceDatabase } of modules) TraceDatabase.deleteDatabase('demo');
      const expected = translations.translate('tracedb_deleted_from_disk', language, { value0: '/test/trace' });
      assert.equal(messages.at(-1).startsWith(expected.split('/test/trace')[0]), true);
    }
    assert.notEqual(messages[0], messages[2]);
  } finally {
    translations.setLanguage('en');
  }
});
