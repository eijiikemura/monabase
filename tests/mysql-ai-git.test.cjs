// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createAiHistoryScope, saveSourceHistory, loadSourceHistory } = require('../electron/ai/sourceHistory');
const deps = { i18next: { t: key => key } };

test('MySQL AI proposals name the correct dialect, require review and reject stale source/schema', () => {
  for (const stale of ['none', 'source', 'schema']) {
    const h = createHookHarness(), changes = [];
    const props = { sqlText: 'SELECT 1', dbType: 'mysql', schema: 'mb_test', isActive: true, setSqlText: text => changes.push(text) };
    const { useAiSqlGeneration } = loadTypeScript('src/features/ai/useAiSqlGeneration.ts', {
      react: h.react, 'react-i18next': { useTranslation: () => ({ t: key => key, i18n: { language: 'en' } }) },
      './codingResponse': loadTypeScript('src/features/ai/codingResponse.ts', deps)
    }, { queueMicrotask, window: { addEventListener() {}, removeEventListener() {} } });
    const render = () => { const result = h.render(() => useAiSqlGeneration(props)); h.commit(); return result; };
    try {
      const response = render().responseTarget;
      assert.match(response.getReferencePrompt(), /MySQL 8\.4/);
      assert.ok(response.getReferencePrompt().includes(loadTypeScript('src/features/ai/sqlGenerationPrompt.ts').SQL_GENERATION_SCOPE));
      assert.doesNotMatch(response.getReferencePrompt(), /PostgreSQLのSQL/);
      response.start(); const review = response.review(JSON.stringify({ status: 'success', source: 'SELECT 42 AS answer', message: '' }));
      assert.deepEqual(changes, []);
      if (stale === 'source') props.sqlText = 'SELECT 3';
      if (stale === 'schema') props.schema = 'other';
      render();
      if (stale === 'none') { review.apply(); assert.deepEqual(changes, ['SELECT 42 AS answer']); }
      else assert.throws(() => review.apply());
    } finally { h.unmount(); }
  }
});

test('MySQL history uses port 3306, normalizes copied hosts, excludes credentials and restores source adoption', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monabase-mysql-ai-'));
  const config = { dbType: 'mysql', host: 'localhost', database: 'mb_test', user: 'test' };
  const connectionScope = createAiHistoryScope(config);
  assert.equal(connectionScope, createAiHistoryScope({ ...config, port: '3306', host: ' localhost ', password: 'not-a-real-secret' }));
  assert.notEqual(connectionScope, createAiHistoryScope({ ...config, dbType: 'postgresql' }));
  const identity = { connectionScope, dbType: 'mysql', schema: 'mb_test', category: 'PROCEDURE', objectName: 'demo' };
  const conversation = { messages: [{ id: 'm1', sender: 'ai', text: 'Reviewed draft', timestamp: '2026-11-12T12:00:00Z', adoption: { source: 'CREATE PROCEDURE demo() SELECT 1', summary: 'Keep one SELECT', appliedAt: '2026-11-12T12:00:01Z' } }], selectedObjects: [] };
  try {
    await saveSourceHistory(directory, identity, conversation);
    const result = await loadSourceHistory(directory, identity);
    assert.equal(result.messages[0].adoption.summary, 'Keep one SELECT');
    const other = await loadSourceHistory(directory, { ...identity, dbType: 'postgresql' });
    assert.equal(other, null);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('MySQL missing SHOW CREATE privileges are errors rather than empty definitions', async () => {
  const repo = loadTypeScript('src/features/objects/mysqlObjects.ts', { '@/shared/api/desktop': { ipcRenderer: { invoke: async () => ({ success: true, rows: [{ 'Create Procedure': null }], metaData: [] }) } } });
  await assert.rejects(repo.loadMysqlReference({ dbType: 'mysql', schema: 'mb_test', category: 'PROCEDURE', name: 'p', key: 'p', displayName: 'p' }), /no readable source definition/);
});

test('MySQL AI definitions retain the native target through DEFINER and quoted CREATE headers', () => {
  const { assertMysqlSourceTarget } = loadTypeScript('src/features/mysql/sourceIdentity.ts');
  const object = { dbType: 'mysql', schema: 'mb_test', category: 'PROCEDURE', name: 'my_proc' };
  for (const source of ["CREATE DEFINER=`test`@`%` PROCEDURE `my_proc`(IN p INT) BEGIN SELECT p; END", "-- settings\nCREATE PROCEDURE `mb_test`.`my_proc`() SELECT 1", "CREATE DEFINER=CURRENT_USER() PROCEDURE my_proc() SELECT 1"]) assert.doesNotThrow(() => assertMysqlSourceTarget(source, object));
  for (const source of ["CREATE PROCEDURE other() SELECT 1", "CREATE PROCEDURE other_db.my_proc() SELECT 1", "CREATE FUNCTION my_proc() RETURNS INT RETURN 1", "/*! CREATE PROCEDURE my_proc() SELECT 1 */"]) assert.throws(() => assertMysqlSourceTarget(source, object));
});

test('MySQL SQL answers accept native hash comments and mysql code fences without changing other dialects', () => {
  const { isAiSql, normalizeAiSql } = loadTypeScript('src/features/ai/useAiSqlGeneration.ts', { react: {}, 'react-i18next': {}, './codingResponse': {} });
  assert.equal(normalizeAiSql('```mysql\nSELECT 42;\n```'), 'SELECT 42;');
  assert.equal(isAiSql('# MySQL comment\nSELECT 42', 'mysql'), true);
  assert.equal(isAiSql('# MySQL comment\nSELECT 42', 'oracle'), false);
});
