// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { application, writeCommit, snapshot, localRemote } = require('./helpers/gitScenarios.cjs');

const source = (name = '計算 "関数"', text = 'SELECT 1;\n-- 日本語') => ({ dbType: 'POSTGRESQL', schema: 'test', objectType: 'FUNCTION', objectName: name, signature: 'integer', sourceText: text, message: '関数の定義を記録' });
async function save(h, request) { const result = await h.invoke('git-commit', request); assert.equal(result.success, true, result.error); }

test('Linked worktree source commits use its own branch/index and leave the main worktree untouched', async t => {
  const h = await createGitRepository(t); await save(h, source());
  fs.writeFileSync(path.join(h.repo, 'main-note.txt'), 'Main staged'); await h.git.add('main-note.txt'); fs.writeFileSync(path.join(h.repo, 'main-note.txt'), 'Main working');
  const before = await snapshot(h), directory = path.join(h.directory, 'linked');
  await h.git.raw(['worktree', 'add', '-b', 'feature/linked', directory]);
  assert.equal(fs.statSync(path.join(directory, '.git')).isFile(), true);
  const invoke = application(h, directory), git = h.client(directory);
  const review = await invoke('git-review-sources', [source(undefined, 'SELECT 2;\n-- linked')]); assert.equal(review.success, true, review.error);
  const committed = await invoke('git-commit-sources', { ...review, message: '別作業フォルダの変更' }); assert.equal(committed.success, true, committed.error);
  assert.deepEqual(await snapshot(h), before); assert.equal(fs.readFileSync(path.join(h.repo, 'main-note.txt'), 'utf8'), 'Main working');
  const status = await invoke('git-status-check'); assert.equal(status.branch, 'feature/linked'); assert.equal((await git.status()).isClean(), true);
  const history = await invoke('git-get-history', source()); assert.equal(history.success, true, history.error); assert.equal(history.history.length, 2);
  assert.equal((await invoke('git-get-file-content', { ...source(), commitId: history.history[0].fullId })).content, 'SELECT 2;\n-- linked');
});

test('Detached HEAD permits immutable history inspection but refuses remote configuration/push without changing repository state', async t => {
  const h = await createGitRepository(t); await save(h, source()); const revision = (await h.git.revparse(['HEAD'])).trim();
  await h.git.checkout(['--detach', revision]); const before = await snapshot(h);
  const status = await h.invoke('git-status-check'); assert.equal(status.success, true); assert.equal(status.branch, null);
  assert.equal((await h.invoke('git-get-file-content', { ...source(), commitId: revision })).content, source().sourceText);
  assert.equal((await h.invoke('git-set-remote', { url: path.join(h.directory, 'unused.git'), branch: 'main' })).success, false);
  assert.equal((await h.invoke('git-push')).success, false); assert.deepEqual(await snapshot(h), before); assert.deepEqual(await h.git.getRemotes(), []);
});

for (const dirty of ['working', 'staged', 'untracked collision']) test(`Real Pull preserves ${dirty} edits when the remote would replace the same path`, async t => {
  const h = await createGitRepository(t); await writeCommit(h, { 'shared.sql': 'base\n' }, '同期の基準');
  const { remote, peer } = await localRemote(h), file = dirty === 'untracked collision' ? 'new.sql' : 'shared.sql';
  await writeCommit(peer, { [file]: 'remote\n' }, '相手の更新'); await peer.git.push();
  fs.writeFileSync(path.join(h.repo, file), 'local draft\n'); if (dirty === 'staged') await h.git.add(file);
  const before = await snapshot(h), remoteHead = await h.client(remote).revparse(['main']);
  const pulled = await h.invoke('git-pull'); assert.equal(pulled.success, false); assert.equal(pulled.isConflict, false);
  assert.deepEqual(await snapshot(h), before); assert.equal(fs.readFileSync(path.join(h.repo, file), 'utf8'), 'local draft\n');
  assert.equal(await h.client(remote).revparse(['main']), remoteHead); assert.equal(fs.existsSync(path.join(h.repo, '.git/MERGE_HEAD')), false);
  fs.unlinkSync(path.join(h.repo, file)); if (dirty !== 'untracked collision') await h.git.raw(['restore', '--source=HEAD', '--staged', '--worktree', '--', file]);
  const retried = await h.invoke('git-pull'); assert.equal(retried.success, true, retried.error); assert.equal(fs.readFileSync(path.join(h.repo, file), 'utf8'), 'remote\n');
});

test('Real Pull accepts unrelated untracked notes and preserves them while fast-forwarding', async t => {
  const h = await createGitRepository(t); await writeCommit(h, { 'shared.sql': 'base\n' }, '同期の基準');
  const { peer } = await localRemote(h); await writeCommit(peer, { 'shared.sql': 'remote\n' }, '相手の更新'); await peer.git.push();
  fs.writeFileSync(path.join(h.repo, 'private-note.txt'), 'Preserve this note');
  const result = await h.invoke('git-pull'); assert.equal(result.success, true, result.error);
  assert.equal(fs.readFileSync(path.join(h.repo, 'private-note.txt'), 'utf8'), 'Preserve this note'); assert.equal(fs.readFileSync(path.join(h.repo, 'shared.sql'), 'utf8'), 'remote\n');
});

test('Divergent real local/remote commits merge once and a normal Push publishes both histories', async t => {
  const h = await createGitRepository(t); await save(h, source('local')); const { remote, peer } = await localRemote(h);
  await save(h, source('local', 'SELECT 2')); await writeCommit(peer, { 'remote.sql': 'remote only\n' }, '相手側の独立した更新'); await peer.git.push();
  const ours = (await h.git.revparse(['HEAD'])).trim(), theirs = (await peer.git.revparse(['HEAD'])).trim();
  const rejected = await h.invoke('git-push'); assert.equal(rejected.success, false); assert.equal((await h.git.revparse(['HEAD'])).trim(), ours);
  const pulled = await h.invoke('git-pull'); assert.equal(pulled.success, true, pulled.error);
  const parents = (await h.git.raw(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' '); assert.deepEqual(parents.slice(1).sort(), [ours, theirs].sort());
  assert.equal((await h.invoke('git-push')).success, true); assert.equal((await h.client(remote).revparse(['main'])).trim(), parents[0]);
  assert.equal((await h.invoke('git-status-check')).ahead, 0); assert.equal(fs.readFileSync(path.join(h.repo, 'remote.sql'), 'utf8'), 'remote only\n');
});

test('Real selected-source staging and external commits invalidate a batch review without replacing files or index entries', async t => {
  const h = await createGitRepository(t), request = source(); await save(h, request);
  const review = await h.invoke('git-review-sources', [source(undefined, 'SELECT 2')]); assert.equal(review.success, true, review.error);
  const file = path.join(h.repo, review.rows[0].path); fs.writeFileSync(file, 'staged source'); await h.git.add(review.rows[0].path);
  fs.writeFileSync(file, 'working source'); const before = await snapshot(h);
  assert.equal((await h.invoke('git-commit-sources', { ...review, message: '古いレビューを拒否' })).success, false);
  assert.deepEqual(await snapshot(h), before); assert.equal(fs.readFileSync(file, 'utf8'), 'working source');
  await h.git.raw(['restore', '--source=HEAD', '--staged', '--worktree', '--', review.rows[0].path]);
  const refreshed = await h.invoke('git-review-sources', [source(undefined, 'SELECT 2')]);
  await h.git.raw(['commit', '--allow-empty', '-m', '別操作による更新']); const changed = await snapshot(h);
  assert.equal((await h.invoke('git-commit-sources', { ...refreshed, message: '古いHEADを拒否' })).success, false); assert.deepEqual(await snapshot(h), changed);
});

test('Packed refs, garbage collection and a stash do not alter immutable source history or include uncommitted drafts', async t => {
  const h = await createGitRepository(t), first = source(); await save(h, first); const revision = (await h.git.revparse(['HEAD'])).trim();
  await save(h, source(undefined, 'SELECT 2')); const review = await h.invoke('git-review-sources', [first]); const file = path.join(h.repo, review.rows[0].path);
  fs.writeFileSync(file, 'UNCOMMITTED DRAFT'); await h.git.raw(['stash', 'push', '-m', '個人の下書き']);
  await h.git.raw(['pack-refs', '--all']); await h.git.raw(['gc', '--prune=now']);
  const before = await snapshot(h), history = await h.invoke('git-get-history', first); assert.equal(history.success, true, history.error); assert.equal(history.history.length, 2);
  assert.equal((await h.invoke('git-get-file-content', { ...first, commitId: revision })).content, first.sourceText);
  assert.deepEqual(await snapshot(h), before); await h.git.raw(['stash', 'pop']); assert.equal(fs.readFileSync(file, 'utf8'), 'UNCOMMITTED DRAFT');
});

test('A real shallow clone reports only available history and becomes complete after explicit unshallow fetch', async t => {
  const h = await createGitRepository(t); await save(h, source(undefined, 'SELECT 1')); const old = (await h.git.revparse(['HEAD'])).trim();
  await save(h, source(undefined, 'SELECT 2')); await save(h, source(undefined, 'SELECT 3'));
  const shallow = path.join(h.directory, 'shallow'); await h.client(h.directory).raw(['clone', '--depth=1', pathToFileURL(h.repo).href, shallow]);
  const invoke = application(h, shallow), git = h.client(shallow);
  assert.equal((await git.raw(['rev-parse', '--is-shallow-repository'])).trim(), 'true');
  const partial = await invoke('git-get-history', source()); assert.equal(partial.success, true, partial.error); assert.equal(partial.history.length, 1);
  assert.equal((await invoke('git-get-file-content', { ...source(), commitId: old })).success, false);
  await git.raw(['fetch', '--unshallow', 'origin']); const full = await invoke('git-get-history', source()); assert.equal(full.success, true, full.error); assert.equal(full.history.length, 3);
  assert.equal((await invoke('git-get-file-content', { ...source(), commitId: old })).content, 'SELECT 1');
});

test('Many real source commits and status refreshes share the write queue without losing unrelated staging', async t => {
  const h = await createGitRepository(t); fs.writeFileSync(path.join(h.repo, 'unrelated.txt'), 'staged'); await h.git.add('unrelated.txt');
  const requests = Array.from({ length: 12 }, (_, index) => source('function_' + index, 'SELECT ' + index));
  const results = await Promise.all(requests.flatMap(request => [h.invoke('git-commit', request), h.invoke('git-status-check')]));
  assert.ok(results.every(result => result.success)); assert.equal((await h.git.log()).total, 12);
  assert.equal((await h.git.raw(['diff', '--cached', '--name-only'])).trim(), 'unrelated.txt');
  for (const request of requests) { const history = await h.invoke('git-get-history', request); assert.equal(history.history.length, 1); assert.equal((await h.invoke('git-get-file-content', { ...request, commitId: history.history[0].fullId })).content, request.sourceText); }
  assert.equal(fs.existsSync(path.join(h.repo, '.git/index.lock')), false); await h.git.raw(['fsck', '--full']);
});
