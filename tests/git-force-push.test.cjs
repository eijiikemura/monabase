// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');
const { createGitRepository } = require('./helpers/gitRepository.cjs');

async function fixture(t) {
  const h = await createGitRepository(t);
  fs.writeFileSync(path.join(h.repo, 'initial.sql'), 'initial'); await h.git.add('initial.sql'); await h.git.commit('Initial');
  const remote = path.join(h.directory, 'remote.git'); fs.mkdirSync(remote);
  const remoteGit = h.client(remote); await remoteGit.raw(['init', '--bare', '--initial-branch=main']);
  await h.git.addRemote('origin', remote); await h.git.push(['-u', 'origin', 'main']);
  const peer = path.join(h.directory, 'peer'); await h.client(h.directory).clone(remote, peer);
  const other = h.client(peer); await other.addConfig('user.name', 'Peer'); await other.addConfig('user.email', 'peer@example.invalid');
  await other.addConfig('commit.gpgsign', 'false');
  const handlers = new Map();
  loadModule('electron/ipc/git.js', { 'simple-git': { simpleGit: h.client } }, { console: { ...console, error() {} } }, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (key, handler) => handlers.set(key, handler) }, gitDirectory: h.repo, t: key => key
  });
  return { ...h, remoteGit, other, async remoteUpdate() {
    fs.writeFileSync(path.join(peer, 'peer.sql'), 'peer update'); await other.add('peer.sql'); await other.commit('Peer update'); await other.push();
    return (await other.revparse(['HEAD'])).trim();
  }, async localUpdate() {
    fs.writeFileSync(path.join(h.repo, 'local.sql'), 'local update'); await h.git.add('local.sql'); await h.git.commit('Local update');
    return (await h.git.revparse(['HEAD'])).trim();
  }, force: () => handlers.get('git-push-force')(null) };
}
test('A safe force push rejects unseen remote commits without changing either history', async t => {
  const h = await fixture(t), remoteHead = await h.remoteUpdate(), localHead = await h.localUpdate();
  const tracking = await h.git.revparse(['refs/remotes/origin/main']);
  const result = await h.force(); assert.equal(result.success, false);
  assert.equal((await h.remoteGit.revparse(['refs/heads/main'])).trim(), remoteHead);
  assert.equal((await h.git.revparse(['HEAD'])).trim(), localHead);
  assert.equal(await h.git.revparse(['refs/remotes/origin/main']), tracking, 'Failure must not refresh the lease or retry');
  assert.equal(await h.remoteGit.show(['main:peer.sql']), 'peer update');
});
test('A safe force push permits replacing the last fetched remote commit', async t => {
  const h = await fixture(t); await h.remoteUpdate(); const local = await h.localUpdate();
  await h.git.fetch(['origin']);
  assert.equal((await h.force()).success, true);
  assert.equal((await h.remoteGit.revparse(['refs/heads/main'])).trim(), local);
  assert.equal(await h.remoteGit.show(['main:local.sql']), 'local update');
  assert.ok(!(await h.remoteGit.raw(['ls-tree', '--name-only', 'main'])).includes('peer.sql'));
});
test('A safe force push refuses missing tracking information and detached HEAD', async t => {
  const h = await fixture(t), head = (await h.remoteGit.revparse(['refs/heads/main'])).trim();
  await h.git.raw(['update-ref', '-d', 'refs/remotes/origin/main']);
  assert.equal((await h.force()).success, false);
  assert.equal((await h.remoteGit.revparse(['refs/heads/main'])).trim(), head);
  await h.git.fetch(['origin']); await h.git.checkout(['--detach', 'HEAD']);
  assert.equal((await h.force()).success, false);
  assert.equal((await h.remoteGit.revparse(['refs/heads/main'])).trim(), head);
});
test('A safe force push targets the current branch even when origin HEAD points elsewhere', async t => {
  const h = await fixture(t), main = (await h.remoteGit.revparse(['refs/heads/main'])).trim();
  await h.git.checkoutLocalBranch('feature/demo'); await h.localUpdate();
  await h.git.push(['-u', 'origin', 'feature/demo']);
  const result = await h.force(); assert.equal(result.success, true);
  assert.equal((await h.remoteGit.revparse(['refs/heads/main'])).trim(), main);
  assert.equal((await h.remoteGit.revparse(['refs/heads/feature/demo'])).trim(), (await h.git.revparse(['HEAD'])).trim());
});
