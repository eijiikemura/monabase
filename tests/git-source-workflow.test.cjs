// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { sourceFileName } = require('../electron/services/gitSourceNames');

const base = { dbType: 'ORACLE', schema: 'TEST', objectType: 'PROCEDURE' };
const request = (name, source = `CREATE PROCEDURE "TEST"."${name.replace(/"/g, '""')}" AS BEGIN NULL; END;`) =>
  ({ ...base, objectName: name, sourceText: source, message: `Update ${name} | exact identity` });
const relative = name => `MonaBase/ORACLE/TEST/PROCEDURE/.objects-v2/${sourceFileName(name)}`;

test('Real Git saves collision-prone names independently and excludes unrelated staged files', async t => {
  const h = await createGitRepository(t);
  fs.writeFileSync(path.join(h.repo, 'unrelated.sql'), 'leave staged');
  await h.git.add('unrelated.sql');
  const names = ['CALC', 'CALC.sql', 'calc', 'Sales"Total', 'CON', '日本語', 'total.'];
  assert.equal(new Set(names.map(name => sourceFileName(name).toLowerCase())).size, names.length);
  for (const name of names) {
    const saved = await h.invoke('git-commit', request(name)); assert.equal(saved.success, true, saved.error);
    const history = await h.invoke('git-get-history', request(name));
    assert.equal(history.history.length, 1);
    assert.equal(history.history[0].message, request(name).message);
    const read = await h.invoke('git-get-file-content', { ...request(name), commitId: history.history[0].fullId });
    assert.equal(read.content, request(name).sourceText);
  }
  assert.equal((await h.git.raw(['diff', '--cached', '--name-only'])).trim(), 'unrelated.sql');
  const before = await h.git.revparse(['HEAD']);
  assert.equal((await h.invoke('git-commit', request('CALC'))).success, true);
  assert.equal(await h.git.revparse(['HEAD']), before, 'Identical retry must not add another commit');
});

test('Legacy sources remain intact and their declared identity controls historical ownership', async t => {
  const h = await createGitRepository(t);
  const directory = path.join(h.repo, 'MonaBase/ORACLE/TEST/PROCEDURE');
  fs.mkdirSync(directory, { recursive: true });
  const legacy = path.join(directory, 'CALC.sql');
  fs.writeFileSync(legacy, request('CALC.sql').sourceText);
  await h.git.add(legacy); await h.git.commit('Legacy suffix source');
  const revision = (await h.git.revparse(['HEAD'])).trim();
  assert.equal((await h.invoke('git-get-history', request('CALC'))).history.length, 0);
  assert.equal((await h.invoke('git-get-history', request('CALC.sql'))).history.length, 1);
  await h.invoke('git-commit', request('CALC'));
  await h.invoke('git-commit', request('CALC.sql', request('CALC.sql').sourceText + '\n-- new'));
  const history = await h.invoke('git-get-history', request('CALC.sql'));
  assert.equal(history.history.length, 2);
  const read = await h.invoke('git-get-file-content', { ...request('CALC.sql'), commitId: revision });
  assert.equal(read.content, request('CALC.sql').sourceText);
  assert.equal(fs.readFileSync(legacy, 'utf8'), request('CALC.sql').sourceText);
  await h.invoke('git-delete-object', request('CALC.sql'));
  assert.equal(fs.readFileSync(legacy, 'utf8'), request('CALC.sql').sourceText, 'Archived source is never deleted implicitly');
});

test('Schema names containing Git pathspec characters are treated as literal paths', async t => {
  const h = await createGitRepository(t);
  for (const schema of ['TEST1', 'TEST[1]']) {
    const saved = await h.invoke('git-commit', { ...request('P'), schema, sourceText: `source for ${schema}` });
    assert.equal(saved.success, true, saved.error);
    const history = await h.invoke('git-get-history', { ...request('P'), schema });
    assert.equal(history.history.length, 1);
    const read = await h.invoke('git-get-file-content', { ...request('P'), schema, commitId: history.history[0].fullId });
    assert.equal(read.content, `source for ${schema}`);
  }
  assert.equal((await h.git.status()).isClean(), true);
});

test('Git rename retains previous revisions, refuses overwrite, and deletion is retryable', async t => {
  const h = await createGitRepository(t);
  await h.invoke('git-commit', request('BEFORE'));
  const original = (await h.git.revparse(['HEAD'])).trim();
  const renamed = await h.invoke('git-rename-object', { ...base, oldName: 'BEFORE', newName: 'AFTER' });
  assert.equal(renamed.success, true, renamed.error);
  const history = await h.invoke('git-get-history', request('AFTER'));
  assert.equal(history.history.length, 2);
  const read = await h.invoke('git-get-file-content', { ...request('AFTER'), commitId: original });
  assert.equal(read.content, request('BEFORE').sourceText);
  await h.invoke('git-commit', request('OTHER'));
  assert.equal((await h.invoke('git-rename-object', { ...base, oldName: 'AFTER', newName: 'OTHER' })).success, false);
  assert.equal(fs.readFileSync(path.join(h.repo, relative('OTHER')), 'utf8'), request('OTHER').sourceText);
  assert.equal((await h.invoke('git-delete-object', request('AFTER'))).success, true);
  const afterDelete = await h.git.revparse(['HEAD']);
  assert.equal((await h.invoke('git-delete-object', request('AFTER'))).success, true);
  assert.equal(await h.git.revparse(['HEAD']), afterDelete);
});

test('Concurrent Git saves serialize index changes and a failed save can be retried', async t => {
  const h = await createGitRepository(t);
  const results = await Promise.all(['FIRST', 'SECOND'].map(name => h.invoke('git-commit', request(name))));
  assert.ok(results.every(result => result.success));
  const lock = path.join(h.repo, '.git/index.lock');
  fs.writeFileSync(lock, 'test-owned lock');
  assert.equal((await h.invoke('git-commit', request('RETRY'))).success, false);
  fs.unlinkSync(lock);
  const retried = await h.invoke('git-commit', request('RETRY'));
  assert.equal(retried.success, true, retried.error);
  assert.equal((await h.invoke('git-get-history', request('RETRY'))).history.length, 1);
});

test('Rename and deletion retries finish their staged changes after a commit failure', async t => {
  const h = await createGitRepository(t);
  await h.invoke('git-commit', request('RENAME_ME'));
  await h.invoke('git-commit', request('DELETE_ME'));
  await h.git.addConfig('user.useConfigOnly', 'true', false, 'local');
  await h.git.raw(['config', '--local', '--unset', 'user.email']);
  assert.equal((await h.invoke('git-rename-object', { ...base, oldName: 'RENAME_ME', newName: 'RENAMED' })).success, false);
  await h.git.addConfig('user.email', 'tests@example.invalid', false, 'local');
  const renamed = await h.invoke('git-rename-object', { ...base, oldName: 'RENAME_ME', newName: 'RENAMED' });
  assert.equal(renamed.success, true, renamed.error);
  await h.git.raw(['config', '--local', '--unset', 'user.email']);
  assert.equal((await h.invoke('git-delete-object', request('DELETE_ME'))).success, false);
  await h.git.addConfig('user.email', 'tests@example.invalid', false, 'local');
  const deleted = await h.invoke('git-delete-object', request('DELETE_ME'));
  assert.equal(deleted.success, true, deleted.error);
  assert.equal((await h.git.status()).isClean(), true);
});

test('Actual Git push and pull use only a disposable local bare remote', async t => {
  const h = await createGitRepository(t);
  const remote = path.join(h.directory, 'remote.git'); fs.mkdirSync(remote);
  await h.client(remote).raw(['init', '--bare', '--initial-branch=main']);
  await h.invoke('git-commit', request('SYNC'));
  const configured = await h.invoke('git-set-remote', { url: remote, branch: 'main' });
  assert.equal(configured.success, true, configured.error); assert.equal(configured.needsPull, undefined);
  await h.invoke('git-commit', request('SYNC', request('SYNC').sourceText + '\n-- pushed'));
  assert.equal((await h.invoke('git-push')).success, true);
  assert.equal(await h.client(remote).show([`main:${relative('SYNC')}`]), request('SYNC').sourceText + '\n-- pushed');
  const clone = path.join(h.directory, 'other');
  await h.client(h.directory).clone(remote, clone);
  const other = h.client(clone);
  await other.addConfig('user.name', 'Other test', false, 'local');
  await other.addConfig('user.email', 'other@example.invalid', false, 'local');
  await other.addConfig('commit.gpgsign', 'false', false, 'local');
  fs.writeFileSync(path.join(clone, 'remote-only.sql'), 'remote fixture');
  await other.add('remote-only.sql'); await other.commit('Remote fixture'); await other.push();
  const pulled = await h.invoke('git-pull'); assert.equal(pulled.success, true, pulled.error);
  assert.equal(fs.readFileSync(path.join(h.repo, 'remote-only.sql'), 'utf8'), 'remote fixture');
});
