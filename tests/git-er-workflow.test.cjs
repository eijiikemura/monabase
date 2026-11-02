// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./helpers/loadModule.cjs');
const { createGitRepository } = require('./helpers/gitRepository.cjs');

async function fixture(t, createClient) {
  const h = await createGitRepository(t), handlers = new Map();
  loadModule('electron/ipc/er.js', { 'simple-git': { simpleGit: createClient ? folder => createClient(h, folder) : h.client } },
    { console: { ...console, error() {} } }, { strict: false }).registerErHandlers({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, gitDirectory: h.repo, t: key => key
  });
  return { ...h, er: (channel, payload) => handlers.get(channel)(null, payload) };
}
const target = (objectName = 'plan[1]') => ({ dbType: 'POSTGRESQL', objectName, sourceText: '{"nodes":[]}', message: 'ER図を保存 | 詳細 2語' });
const relative = object => `MonaBase/${object.dbType}/ErDiagram/${object.objectName}.json`;

for (const dbType of ['ORACLE', 'POSTGRESQL']) {
  test(`${dbType}: ER commits preserve unrelated staged work, exact messages and no-op retries`, async t => {
    const h = await fixture(t), object = { ...target(), dbType };
    fs.writeFileSync(path.join(h.repo, 'unrelated.sql'), 'Preserve staged work');
    await h.git.add('unrelated.sql');
    assert.equal((await h.er('git-commit-er', object)).success, true);
    assert.equal((await h.git.raw(['show', '--format=', '--name-only', 'HEAD'])).trim(), relative(object));
    assert.equal((await h.git.raw(['diff', '--cached', '--name-only'])).trim(), 'unrelated.sql');
    const head = await h.git.revparse(['HEAD']);
    assert.equal((await h.er('git-commit-er', object)).success, true);
    assert.equal(await h.git.revparse(['HEAD']), head);
    const history = await h.er('git-get-history-er', object);
    assert.equal(history.success, true); assert.equal(history.history.length, 1);
    assert.equal(history.history[0].message, object.message); assert.equal(history.history[0].isMerge, false);
    const content = await h.er('git-get-file-content-er', { ...object, commitId: head });
    assert.equal(content.content, object.sourceText);
  });
}

test('An ER deletion blocked by an index lock reports failure and records deletion on retry', async t => {
  const h = await fixture(t), object = target();
  await h.er('git-commit-er', object);
  fs.writeFileSync(path.join(h.repo, 'unrelated.sql'), 'Preserve staged work'); await h.git.add('unrelated.sql');
  const lock = path.join(h.repo, '.git', 'index.lock'); fs.writeFileSync(lock, 'Test lock');
  assert.equal((await h.er('delete-er-diagram', object)).success, false);
  assert.equal(fs.existsSync(path.join(h.repo, relative(object))), false);
  fs.unlinkSync(lock);
  assert.equal((await h.er('delete-er-diagram', object)).success, true);
  assert.equal((await h.git.raw(['diff', '--cached', '--name-only'])).trim(), 'unrelated.sql');
  const head = await h.git.revparse(['HEAD']);
  assert.equal((await h.er('delete-er-diagram', object)).success, true);
  assert.equal(await h.git.revparse(['HEAD']), head);
  const history = await h.er('git-get-history-er', object);
  assert.equal(history.history.length, 2);
  assert.equal((await h.er('git-get-file-content-er', { ...object, commitId: history.history[1].fullId })).content, object.sourceText);
});

test('An ER deletion whose commit fails remains staged and finishes on retry', async t => {
  const h = await fixture(t), object = target(); await h.er('git-commit-er', object);
  await h.git.raw(['config', '--local', '--unset', 'user.email']); await h.git.addConfig('user.useConfigOnly', 'true', false, 'local');
  assert.equal((await h.er('delete-er-diagram', object)).success, false);
  assert.ok((await h.git.raw(['diff', '--cached', '--name-status'])).startsWith('D'));
  await h.git.addConfig('user.email', 'tests@example.invalid', false, 'local');
  assert.equal((await h.er('delete-er-diagram', object)).success, true);
  assert.equal((await h.git.status()).isClean(), true);
});

test('Failed ER saves can be retried and local-only deletions do not invent Git history', async t => {
  const h = await fixture(t), object = target();
  assert.deepEqual(Array.from((await h.er('git-get-history-er', object)).history), []);
  const lock = path.join(h.repo, '.git', 'index.lock'); fs.writeFileSync(lock, 'Test lock');
  assert.equal((await h.er('git-commit-er', object)).success, false);
  fs.unlinkSync(lock);
  assert.equal((await h.er('git-commit-er', object)).success, true);
  const local = target('local-only'); await h.er('save-er-diagram', local);
  const head = await h.git.revparse(['HEAD']);
  assert.equal((await h.er('delete-er-diagram', local)).success, true);
  assert.equal(await h.git.revparse(['HEAD']), head);
});

test('ER history keeps literal pathspecs, control characters and real merge classification intact', async t => {
  const h = await fixture(t), object = target();
  await h.er('git-commit-er', object);
  await h.er('git-commit-er', { ...target('plan1'), message: '別のER図' });
  assert.equal((await h.er('git-get-history-er', object)).history.length, 1);
  await h.git.checkoutLocalBranch('other');
  await h.er('git-commit-er', { ...object, sourceText: '{"side":"other"}' });
  await h.git.checkout('main');
  await h.er('git-commit-er', { ...object, sourceText: '{"side":"main"}' });
  await assert.rejects(h.git.merge(['other', '--no-commit']));
  fs.writeFileSync(path.join(h.repo, relative(object)), '{"merged":true}'); await h.git.add(relative(object));
  const message = 'ER図を統合 | 詳細 2語\x1e記録'; await h.git.commit(message);
  const history = await h.er('git-get-history-er', object);
  assert.equal(history.history[0].message, message); assert.equal(history.history[0].isMerge, true);
  assert.ok(history.history.slice(1).every(entry => entry.isMerge === false));
});

test('ER writes and stored-source writes share the repository queue', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const firstAdd = new Promise(resolve => { started = resolve; });
  let paused = false;
  const h = await fixture(t, (h, folder) => {
    const git = h.client(folder), raw = git.raw.bind(git);
    git.raw = async args => {
      if (!paused && args[1] === 'add') { paused = true; started(); await gate; }
      return raw(args);
    };
    return git;
  });
  const er = h.er('git-commit-er', target());
  await firstAdd;
  let sourceDone = false;
  const source = h.invoke('git-commit', { dbType: 'POSTGRESQL', schema: 'test', objectType: 'FUNCTION', objectName: 'fn', sourceText: 'SELECT 1', message: '関数を保存' }).then(result => { sourceDone = true; return result; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sourceDone, false);
    assert.equal(fs.existsSync(path.join(h.repo, 'MonaBase', 'POSTGRESQL', 'test')), false);
  } finally { release(); }
  assert.equal((await er).success, true); assert.equal((await source).success, true);
  const commits = (await h.git.log()).all;
  assert.equal(commits.length, 2);
  for (const commit of commits) assert.equal((await h.git.raw(['show', '--format=', '--name-only', commit.hash])).trim().split('\n').length, 1);
});
