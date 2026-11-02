// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { writeCommit, snapshot } = require('./helpers/gitScenarios.cjs');

async function conflict(t, { base = 'base\n', ours = 'ours\n', theirs = 'theirs\n', markerSize = 7, style = 'merge', file = '日本語 schema/[routine] name.sql' } = {}) {
  const h = await createGitRepository(t);
  await writeCommit(h, { '.gitattributes': `*.sql conflict-marker-size=${markerSize}\n`, ...(base === null ? {} : { [file]: base }) }, '競合テストの基準');
  await h.git.addConfig('merge.conflictStyle', style);
  await h.git.checkoutLocalBranch('other'); await writeCommit(h, { [file]: theirs }, '相手側の変更');
  await h.git.checkout('main'); await writeCommit(h, { [file]: ours }, '自分側の変更');
  await assert.rejects(h.git.merge(['other']));
  return { ...h, file };
}

for (const deleted of ['ours', 'theirs']) for (const choice of ['ours', 'theirs']) test(`Real modify/delete conflict: deleted ${deleted}, choosing ${choice} retains the intended file or deletion`, async t => {
  const h = await conflict(t, { [deleted]: null }), state = await h.invoke('git-get-conflicts');
  assert.equal(state.success, true, state.error); assert.equal(state.files.length, 1);
  const file = state.files[0]; assert.equal(file[deleted], null); assert.equal(file.base, 'base\n');
  const resolved = await h.invoke('git-resolve-conflict', { ...file, choice }); assert.equal(resolved.success, true, resolved.error); assert.equal(resolved.files.length, 0);
  const completed = await h.invoke('git-complete-merge', { token: resolved.token, message: '削除と変更の競合を解決' }); assert.equal(completed.success, true, completed.error);
  if (choice === deleted) assert.equal(fs.existsSync(path.join(h.repo, h.file)), false);
  else assert.equal(fs.readFileSync(path.join(h.repo, h.file), 'utf8'), file[choice]);
  assert.equal((await h.git.status()).isClean(), true); assert.equal((await h.git.raw(['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(' ').length, 3);
});

for (const choice of ['ours', 'theirs', 'manual']) test(`Real add/add conflict: ${choice} resolution has no fabricated common-base content`, async t => {
  const h = await conflict(t, { base: null }), state = await h.invoke('git-get-conflicts'); assert.equal(state.success, true, state.error);
  const file = state.files[0]; assert.equal(file.base, null); assert.equal(file.ours, 'ours\n'); assert.equal(file.theirs, 'theirs\n');
  const resolved = await h.invoke('git-resolve-conflict', { ...file, choice, content: 'combined 日本語\r\n' }); assert.equal(resolved.success, true, resolved.error);
  const expected = choice === 'manual' ? 'combined 日本語\r\n' : file[choice];
  assert.equal(fs.readFileSync(path.join(h.repo, h.file), 'utf8'), expected);
  assert.equal((await h.invoke('git-complete-merge', { token: resolved.token, message: '追加同士の競合を解決' })).success, true);
});

for (const markerSize of [3, 7, 12]) test(`Real diff3 conflict with ${markerSize}-character markers cannot be marked resolved while markers remain`, async t => {
  const h = await conflict(t, { markerSize, style: 'diff3' }), state = await h.invoke('git-get-conflicts'); assert.equal(state.success, true, state.error);
  const file = state.files[0], before = await snapshot(h), bytes = fs.readFileSync(path.join(h.repo, h.file));
  assert.ok(file.working.includes('<'.repeat(markerSize) + ' HEAD'));
  const rejected = await h.invoke('git-resolve-conflict', { ...file, choice: 'manual', content: file.working });
  assert.equal(rejected.success, false, 'Unresolved Git markers must not become ordinary committed SQL.');
  assert.deepEqual(await snapshot(h), before); assert.deepEqual(fs.readFileSync(path.join(h.repo, h.file)), bytes);
  assert.equal((await h.invoke('git-resolve-conflict', { ...file, choice: 'manual', content: '|'.repeat(markerSize) + ' base\nSELECT 1;\n' })).success, false, 'A remaining diff3 base marker must also prevent resolution.');
  assert.deepEqual(await snapshot(h), before);
  const resolved = await h.invoke('git-resolve-conflict', { ...file, choice: 'manual', content: 'resolved\n' }); assert.equal(resolved.success, true, resolved.error);
  assert.equal((await h.invoke('git-complete-merge', { token: resolved.token, message: '競合マーカーを除去' })).success, true);
});

test('Real binary conflict is refused without altering any merge stage and can be aborted', async t => {
  const h = await conflict(t, { base: Buffer.from([0, 1]), ours: Buffer.from([0, 2]), theirs: Buffer.from([0, 3]) });
  const before = await snapshot(h), bytes = fs.readFileSync(path.join(h.repo, h.file));
  const result = await h.invoke('git-get-conflicts'); assert.equal(result.success, false); assert.match(result.error, /Binary conflicts/);
  assert.deepEqual(await snapshot(h), before); assert.deepEqual(fs.readFileSync(path.join(h.repo, h.file)), bytes);
  assert.equal((await h.invoke('git-merge-abort')).success, true); assert.deepEqual(fs.readFileSync(path.join(h.repo, h.file)), Buffer.from([0, 2]));
});

test('A real merge commit failure preserves unrelated untracked notes and resolved content for retry', async t => {
  const h = await conflict(t), state = await h.invoke('git-get-conflicts');
  fs.writeFileSync(path.join(h.repo, 'personal-notes.txt'), 'Keep this note');
  const resolved = await h.invoke('git-resolve-conflict', { ...state.files[0], choice: 'ours' }); assert.equal(resolved.success, true, resolved.error);
  const before = await snapshot(h);
  await h.git.addConfig('user.useConfigOnly', 'true'); await h.git.raw(['config', '--local', '--unset', 'user.email']);
  assert.equal((await h.invoke('git-complete-merge', { token: resolved.token, message: '失敗後の再試行' })).success, false);
  assert.deepEqual(await snapshot(h), before); assert.equal(fs.existsSync(path.join(h.repo, '.git/MERGE_HEAD')), true);
  await h.git.addConfig('user.email', 'tests@example.invalid');
  assert.equal((await h.invoke('git-complete-merge', { token: resolved.token, message: '失敗後の再試行' })).success, true);
  assert.equal(fs.readFileSync(path.join(h.repo, 'personal-notes.txt'), 'utf8'), 'Keep this note');
});

test('Source review and completion reject a real unresolved merge without changing conflict bytes or stages', async t => {
  const h = await conflict(t), before = await snapshot(h), bytes = fs.readFileSync(path.join(h.repo, h.file));
  const source = { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'F', sourceText: 'SELECT 1' };
  assert.equal((await h.invoke('git-review-sources', [source])).success, false);
  const conflicts = await h.invoke('git-get-conflicts'); assert.equal((await h.invoke('git-complete-merge', { token: conflicts.token, message: '未解決のまま確定' })).success, false);
  assert.deepEqual(await snapshot(h), before); assert.deepEqual(fs.readFileSync(path.join(h.repo, h.file)), bytes);
  assert.equal((await h.invoke('git-merge-abort')).success, true);
});
