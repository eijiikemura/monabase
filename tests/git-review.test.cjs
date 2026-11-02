// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createGitRepository } = require('./helpers/gitRepository.cjs');

const source = (name, text) => ({ dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: name,
  key: name, displayName: name, sourceText: text || `CREATE FUNCTION TEST.${name} RETURN NUMBER AS BEGIN RETURN 1; END;` });
const review = async (repo, sources) => {
  const result = await repo.invoke('git-review-sources', sources); assert.equal(result.success, true, result.error); return result;
};

test('Batch recording uses one commit, distinguishes DB/local/HEAD and preserves unrelated staged and working files', async t => {
  const repo = await createGitRepository(t), a = source('A'), b = source('B');
  assert.equal((await repo.invoke('git-commit', { ...a, message: 'Baseline' })).success, true);
  const changed = source('A', a.sourceText.replace('RETURN 1;', 'RETURN 2;'));
  fs.writeFileSync(path.join(repo.repo, 'unrelated.txt'), 'staged'); await repo.git.add('unrelated.txt');
  fs.writeFileSync(path.join(repo.repo, 'unrelated.txt'), 'working');
  const snapshot = await review(repo, [changed, b]);
  assert.equal(snapshot.rows[0].headSource, a.sourceText); assert.equal(snapshot.rows[0].localSource, a.sourceText);
  assert.equal(snapshot.rows[1].headSource, null); assert.equal(snapshot.rows[1].localSource, null);
  const before = (await repo.git.log()).total;
  const result = await repo.invoke('git-commit-sources', { ...snapshot, message: 'Related DB change' });
  assert.equal(result.success, true, result.error); assert.equal((await repo.git.log()).total, before + 1);
  assert.equal((await repo.git.log()).latest.message, 'Related DB change');
  assert.equal((await repo.git.raw(['show', ':unrelated.txt'])), 'staged');
  assert.equal(fs.readFileSync(path.join(repo.repo, 'unrelated.txt'), 'utf8'), 'working');
  const files = (await repo.git.raw(['show', '--format=', '--name-only', 'HEAD'])).trim().split('\n');
  assert.deepEqual(files.sort(), snapshot.rows.map(row => row.path).sort());
  assert.equal((await review(repo, [changed, b])).rows[0].headSource, changed.sourceText);
});

test('Batch recording supports an unborn branch without including pre-existing staged files', async t => {
  const repo = await createGitRepository(t);
  fs.writeFileSync(path.join(repo.repo, 'private.txt'), 'unrelated'); await repo.git.add('private.txt');
  const snapshot = await review(repo, [source('A'), source('B')]); assert.equal(snapshot.head, null);
  const result = await repo.invoke('git-commit-sources', { ...snapshot, message: 'First source snapshot' }); assert.equal(result.success, true, result.error);
  assert.equal((await repo.git.log()).total, 1);
  assert.equal((await repo.git.raw(['diff', '--cached', '--name-only'])).trim(), 'private.txt');
  assert.ok(!(await repo.git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).includes('private.txt'));
});

test('Stale HEAD, edited files, duplicate selections and forged paths are rejected before replacement', async t => {
  const repo = await createGitRepository(t), a = source('A');
  await repo.invoke('git-commit', { ...a, message: 'Base' });
  let snapshot = await review(repo, [source('A', 'new source')]);
  const local = path.join(repo.repo, snapshot.rows[0].path); fs.writeFileSync(local, 'Local work');
  assert.equal((await repo.invoke('git-commit-sources', { ...snapshot, message: 'No' })).success, false);
  assert.equal(fs.readFileSync(local, 'utf8'), 'Local work');
  snapshot = await review(repo, [source('A', 'new source')]);
  assert.equal((await repo.invoke('git-commit-sources', { ...snapshot, message: 'No' })).success, false);
  fs.writeFileSync(local, a.sourceText);
  snapshot = await review(repo, [source('A', 'new source')]);
  assert.equal((await repo.invoke('git-commit-sources', { ...snapshot, rows: [...snapshot.rows, ...snapshot.rows], message: 'No' })).success, false);
  assert.equal((await repo.invoke('git-commit-sources', { ...snapshot, rows: [{ ...snapshot.rows[0], path: '../escape.sql' }], message: 'No' })).success, false);
  await repo.git.raw(['commit', '--allow-empty', '-m', 'Other work']);
  assert.equal((await repo.invoke('git-commit-sources', { ...snapshot, message: 'No' })).success, false);
  assert.equal(fs.readFileSync(local, 'utf8'), a.sourceText);
});

test('A rejected commit restores our file writes and preserves the original index and HEAD', async t => {
  const repo = await createGitRepository(t), a = source('A'); await repo.invoke('git-commit', { ...a, message: 'Base' });
  fs.writeFileSync(path.join(repo.repo, 'keep.txt'), 'staged'); await repo.git.add('keep.txt');
  const before = await repo.git.raw(['ls-files', '--stage', '-z']), head = await repo.git.revparse(['HEAD']);
  const snapshot = await review(repo, [source('A', 'changed'), source('B')]);
  const hooks = path.join(repo.directory, 'reject-hooks'); fs.mkdirSync(hooks); fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  await repo.git.addConfig('core.hooksPath', hooks);
  const result = await repo.invoke('git-commit-sources', { ...snapshot, message: 'Rejected' }); assert.equal(result.success, false);
  assert.equal(await repo.git.revparse(['HEAD']), head); assert.equal(await repo.git.raw(['ls-files', '--stage', '-z']), before);
  assert.equal(fs.readFileSync(path.join(repo.repo, snapshot.rows[0].path), 'utf8'), a.sourceText);
  assert.equal(fs.existsSync(path.join(repo.repo, snapshot.rows[1].path)), false);
});

async function makeConflict(t) {
  const repo = await createGitRepository(t);
  for (const name of ['a.sql', 'b.sql']) fs.writeFileSync(path.join(repo.repo, name), 'base\n');
  await repo.git.add(['a.sql', 'b.sql']); await repo.git.commit('Base'); await repo.git.checkoutLocalBranch('other');
  for (const name of ['a.sql', 'b.sql']) fs.writeFileSync(path.join(repo.repo, name), 'theirs\n');
  await repo.git.add(['a.sql', 'b.sql']); await repo.git.commit('Theirs'); await repo.git.checkout('main');
  for (const name of ['a.sql', 'b.sql']) fs.writeFileSync(path.join(repo.repo, name), 'ours\n');
  await repo.git.add(['a.sql', 'b.sql']); await repo.git.commit('Ours');
  await assert.rejects(repo.git.merge(['other'])); return repo;
}
test('Conflict snapshots expose both sides, enforce freshness, resolve individually and complete one merge commit', async t => {
  const repo = await makeConflict(t);
  let snapshot = await repo.invoke('git-get-conflicts'); assert.equal(snapshot.success, true, snapshot.error); assert.equal(snapshot.files.length, 2);
  const first = snapshot.files[0]; assert.equal(first.base, 'base\n'); assert.equal(first.ours, 'ours\n'); assert.equal(first.theirs, 'theirs\n');
  assert.equal((await repo.invoke('git-complete-merge', { token: snapshot.token, message: 'Too soon' })).success, false);
  assert.equal((await repo.invoke('git-resolve-conflict', { ...first, choice: 'manual', content: first.working })).success, false);
  const stale = { ...first }; fs.appendFileSync(path.join(repo.repo, first.path), '\nnew edit');
  assert.equal((await repo.invoke('git-resolve-conflict', { ...stale, choice: 'ours' })).success, false);
  snapshot = await repo.invoke('git-get-conflicts');
  snapshot = await repo.invoke('git-resolve-conflict', { ...snapshot.files[0], choice: 'ours' }); assert.equal(snapshot.success, true, snapshot.error);
  snapshot = await repo.invoke('git-resolve-conflict', { ...snapshot.files[0], choice: 'manual', content: 'combined\n' }); assert.equal(snapshot.success, true, snapshot.error);
  assert.equal(snapshot.files.length, 0);
  const result = await repo.invoke('git-complete-merge', { token: snapshot.token, message: 'Reviewed merge' }); assert.equal(result.success, true, result.error);
  const latest = (await repo.git.log()).latest; assert.equal(latest.message, 'Reviewed merge'); assert.equal(latest.refs.includes('main'), true);
  assert.equal((await repo.git.raw(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ').length, 3);
  assert.equal(fs.readFileSync(path.join(repo.repo, 'a.sql'), 'utf8'), 'ours\n');
  assert.equal(fs.readFileSync(path.join(repo.repo, 'b.sql'), 'utf8'), 'combined\n');
});
test('Changes staged after conflict review prevent merge completion and abort remains available', async t => {
  const repo = await makeConflict(t); let snapshot = await repo.invoke('git-get-conflicts');
  for (const file of snapshot.files) { const result = await repo.invoke('git-resolve-conflict', { ...file, choice: 'theirs' }); assert.equal(result.success, true, result.error); }
  snapshot = await repo.invoke('git-get-conflicts');
  fs.writeFileSync(path.join(repo.repo, 'outside.sql'), 'later'); await repo.git.add('outside.sql');
  assert.equal((await repo.invoke('git-complete-merge', { token: snapshot.token, message: 'No' })).success, false);
  assert.equal((await repo.invoke('git-merge-abort')).success, true); assert.equal((await repo.git.status()).conflicted.length, 0);
});

test('Verified legacy definitions participate in review while batch recording preserves the old file', async t => {
  const repo = await createGitRepository(t), original = source('A');
  const legacy = 'MonaBase/ORACLE/TEST/FUNCTION/A.sql';
  fs.mkdirSync(path.dirname(path.join(repo.repo, legacy)), { recursive: true }); fs.writeFileSync(path.join(repo.repo, legacy), original.sourceText);
  await repo.git.add(legacy); await repo.git.commit('Legacy definition');
  const changed = source('A', original.sourceText.replace('RETURN 1;', 'RETURN 2;'));
  const snapshot = await review(repo, [changed]); assert.equal(snapshot.rows[0].headSource, original.sourceText);
  assert.equal(snapshot.rows[0].headPath, legacy);
  const result = await repo.invoke('git-commit-sources', { ...snapshot, message: 'Record updated source' }); assert.equal(result.success, true, result.error);
  assert.equal(fs.readFileSync(path.join(repo.repo, legacy), 'utf8'), original.sourceText);
  assert.equal(fs.readFileSync(path.join(repo.repo, snapshot.rows[0].path), 'utf8'), changed.sourceText);
});

test('Real Git oversized source blobs and working files are refused without changing HEAD or staging', async t => {
  const { GIT_SOURCE_MAX_BYTES } = require('../electron/services/dataSafety');
  const repo = await createGitRepository(t), a = source('LARGE');
  await repo.invoke('git-commit', { ...a, message: 'Base' });
  const snapshot = await review(repo, [a]), relative = snapshot.rows[0].path, file = path.join(repo.repo, relative);
  const fd = fs.openSync(file, 'w'); fs.ftruncateSync(fd, GIT_SOURCE_MAX_BYTES + 1); fs.closeSync(fd);
  const head = await repo.git.revparse(['HEAD']), index = await repo.git.raw(['ls-files', '--stage', '-z']);
  let result = await repo.invoke('git-review-sources', [a]);
  assert.equal(result.success, false); assert.match(result.error, /safety size limit/);
  assert.equal(await repo.git.revparse(['HEAD']), head); assert.equal(await repo.git.raw(['ls-files', '--stage', '-z']), index);
  await repo.git.add(relative); await repo.git.commit('Oversized external source');
  const oversizedHead = (await repo.git.revparse(['HEAD'])).trim();
  result = await repo.invoke('git-get-file-content', { ...a, commitId: oversizedHead });
  assert.equal(result.success, false); assert.match(result.error, /safety size limit/);
  result = await repo.invoke('git-review-sources', [a]);
  assert.equal(result.success, false); assert.match(result.error, /safety size limit/);
  assert.equal((await repo.git.revparse(['HEAD'])).trim(), oversizedHead);
  fs.writeFileSync(file, a.sourceText); await repo.git.add(relative); await repo.git.commit('Repair source');
  assert.equal((await repo.invoke('git-get-file-content', { ...a, commitId: (await repo.git.revparse(['HEAD'])).trim() })).content, a.sourceText);
});

test('Oversized manual conflict resolution leaves working files, index and merge state unchanged', async t => {
  const { GIT_SOURCE_MAX_BYTES } = require('../electron/services/dataSafety');
  const repo = await makeConflict(t), snapshot = await repo.invoke('git-get-conflicts');
  assert.equal(snapshot.success, true, snapshot.error);
  const first = snapshot.files[0], file = path.join(repo.repo, first.path), before = fs.readFileSync(file);
  const index = await repo.git.raw(['ls-files', '--stage', '-z']);
  const result = await repo.invoke('git-resolve-conflict', { ...first, choice: 'manual', content: 'x'.repeat(GIT_SOURCE_MAX_BYTES + 1) });
  assert.equal(result.success, false); assert.match(result.error, /safety size limit/);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(await repo.git.raw(['ls-files', '--stage', '-z']), index);
  assert.equal(fs.existsSync(path.join(repo.repo, '.git', 'MERGE_HEAD')), true);
});

test('Legacy source discovery enforces the same limit before history or review and preserves repository state', async t => {
  const { GIT_SOURCE_MAX_BYTES } = require('../electron/services/dataSafety');
  const repo = await createGitRepository(t), a = source('LEGACY');
  const file = path.join(repo.repo, 'MonaBase/ORACLE/TEST/FUNCTION/LEGACY.sql');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, a.sourceText);
  const fd = fs.openSync(file, 'r+'); fs.ftruncateSync(fd, GIT_SOURCE_MAX_BYTES + 1); fs.closeSync(fd);
  const before = await repo.git.raw(['ls-files', '--stage', '-z']);
  for (const [channel, request] of [['git-get-history', a], ['git-review-sources', [a]]]) {
    const result = await repo.invoke(channel, request);
    assert.equal(result.success, false); assert.match(result.error, /safety size limit/);
  }
  assert.equal(await repo.git.raw(['ls-files', '--stage', '-z']), before);
  assert.equal(fs.statSync(file).size, GIT_SOURCE_MAX_BYTES + 1);
  fs.writeFileSync(file, a.sourceText);
  const result = await repo.invoke('git-review-sources', [a]);
  assert.equal(result.success, true, result.error);
});
