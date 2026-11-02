// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { translate } = require('../electron/i18n');

async function remoteFor(h) {
  const remote = path.join(h.directory, 'remote.git');
  fs.mkdirSync(remote);
  await h.client(remote).raw(['init', '--bare', '--initial-branch=main']);
  return remote;
}

function renderer(invoke, language = 'en') {
  const hook = createHookHarness(), calls = [], alerts = [], confirmations = [], pending = [];
  const t = (key, values) => translate(key, language, values);
  const { useGlobalGit } = loadTypeScript('src/features/git/useGlobalGit.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => {
      calls.push(args);
      const response = Promise.resolve(invoke(...args));
      pending.push(response);
      return response;
    } } }
  }, { alert: message => alerts.push(message), CustomEvent: class {},
    window: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
      confirm: message => { confirmations.push(message); return true; } } });
  const render = () => hook.render(() => useGlobalGit({ setIsGlobalLoading() {} }));
  const flush = async () => { render(); hook.commit(); await Promise.all(pending.splice(0)); await hook.settle(); return render(); };
  return { hook, render, flush, calls, alerts, confirmations, t };
}

for (const branch of ['main', 'master', 'feature/demo']) {
  test(`Initial setup displays and pushes the actual unborn ${branch} branch`, async t => {
    const h = await createGitRepository(t), remote = await remoteFor(h);
    await h.git.raw(['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
    const ui = renderer((...args) => h.invoke(...args));
    t.after(() => ui.hook.unmount());
    const state = await ui.flush();
    assert.equal(state.branchName, branch);
    assert.equal((await h.invoke('git-status-check')).ahead, null);
    state.setTempRemoteUrl(remote);
    await ui.render().handleSetRemote();
    assert.deepEqual(ui.alerts, [ui.t('the_remote_was_configured_and_the_initial_push_completed')]);
    assert.equal((await h.git.branch()).current, branch);
    assert.equal(await h.client(remote).show([`${branch}:README.md`]), '# MonaBase Repository\n');
    const status = await h.invoke('git-status-check');
    assert.equal(status.tracking, `origin/${branch}`);
    assert.equal(status.ahead, 0);
  });
}

test('A stale branch selection is rejected before configuring a remote or committing', async t => {
  const h = await createGitRepository(t), remote = await remoteFor(h);
  const result = await h.invoke('git-set-remote', { url: remote, branch: 'master' });
  assert.equal(result.success, false);
  assert.equal(result.error, 'git_branch_changed_refresh_settings');
  assert.deepEqual(await h.git.getRemotes(), []);
  assert.deepEqual(fs.readdirSync(h.repo), ['.git']);
});

test('A failed initial Push can be retried through the renderer without an upstream', async t => {
  const h = await createGitRepository(t), remote = await remoteFor(h);
  const failed = await h.invoke('git-set-remote', { url: path.join(h.directory, 'missing.git'), branch: 'main' });
  assert.equal(failed.success, false);
  assert.equal(failed.needsPull, false);
  const before = await h.invoke('git-status-check');
  assert.equal(before.tracking, null);
  assert.equal(before.ahead, null);
  await h.git.remote(['set-url', 'origin', remote]);
  const ui = renderer((...args) => h.invoke(...args));
  await ui.render().handleGitPush();
  assert.ok(ui.calls.some(([channel]) => channel === 'git-push'));
  assert.deepEqual(ui.confirmations, [ui.t('confirm_git_push_unknown_count', { url: remote })]);
  assert.deepEqual(ui.alerts, [ui.t('git_push_completed')]);
  assert.equal((await h.invoke('git-status-check')).ahead, 0);
  assert.equal(await h.client(remote).show(['main:README.md']), '# MonaBase Repository\n');
});

test('Only a real non-fast-forward initial Push recommends Pull and can recover through Pull then Push', async t => {
  const h = await createGitRepository(t), remote = await remoteFor(h);
  const peer = path.join(h.directory, 'peer');
  await h.client(h.directory).clone(remote, peer);
  const other = h.client(peer);
  await other.addConfig('user.name', 'Peer'); await other.addConfig('user.email', 'peer@example.invalid');
  await other.addConfig('commit.gpgsign', 'false');
  fs.writeFileSync(path.join(peer, 'peer.sql'), 'Remote fixture');
  await other.add('peer.sql'); await other.commit('Remote initial'); await other.push(['-u', 'origin', 'main']);
  const result = await h.invoke('git-set-remote', { url: remote, branch: 'main' });
  assert.equal(result.success, false);
  assert.equal(result.needsPull, true, result.error);
  assert.equal((await h.invoke('git-pull')).success, true);
  assert.equal((await h.invoke('git-push')).success, true);
  assert.equal(await h.client(remote).show(['main:peer.sql']), 'Remote fixture');
  assert.equal(await h.client(remote).show(['main:README.md']), '# MonaBase Repository\n');
});

test('A server hook rejection is not reported as history divergence', async t => {
  const h = await createGitRepository(t), remote = await remoteFor(h);
  const hook = path.join(remote, 'hooks', 'pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\necho "Policy rejected" >&2\nexit 1\n', { mode: 0o755 });
  const result = await h.invoke('git-set-remote', { url: remote, branch: 'main' });
  assert.equal(result.success, false);
  assert.equal(result.needsPull, false);
  assert.match(result.error, /hook declined/);
});

for (const channel of ['git-pull', 'git-pull-force']) {
  test(`${channel} synchronizes the current feature branch when origin HEAD points to main`, async t => {
    const h = await createGitRepository(t), remote = await remoteFor(h);
    assert.equal((await h.invoke('git-set-remote', { url: remote, branch: 'main' })).success, true);
    await h.git.checkoutLocalBranch('feature/demo');
    assert.equal((await h.invoke('git-set-remote', { url: remote, branch: 'feature/demo' })).success, true);
    const main = await h.client(remote).revparse(['refs/heads/main']);
    const peer = path.join(h.directory, 'peer');
    await h.client(h.directory).raw(['clone', '--branch', 'feature/demo', remote, peer]);
    const other = h.client(peer);
    await other.addConfig('user.name', 'Peer'); await other.addConfig('user.email', 'peer@example.invalid');
    await other.addConfig('commit.gpgsign', 'false');
    fs.writeFileSync(path.join(peer, 'feature.sql'), 'Feature update');
    await other.add('feature.sql'); await other.commit('Feature update'); await other.push();
    const result = await h.invoke(channel, 'theirs');
    assert.equal(result.success, true, result.error);
    assert.equal(fs.readFileSync(path.join(h.repo, 'feature.sql'), 'utf8'), 'Feature update');
    assert.equal((await h.invoke('git-push')).success, true);
    assert.equal(await h.client(remote).revparse(['refs/heads/main']), main);
  });
}

test('Missing tracking refs remain unknown and verified comparisons report actual pending commits', async t => {
  const h = await createGitRepository(t), remote = await remoteFor(h);
  await h.invoke('git-set-remote', { url: remote, branch: 'main' });
  fs.writeFileSync(path.join(h.repo, 'new.sql'), 'Local change');
  await h.git.add('new.sql'); await h.git.commit('Local change');
  assert.equal((await h.invoke('git-status-check')).ahead, 1);
  await h.git.raw(['update-ref', '-d', 'refs/remotes/origin/main']);
  assert.equal((await h.invoke('git-status-check')).ahead, null);
});

test('A failed status query returns failure instead of a fabricated zero count', async () => {
  const handlers = new Map();
  loadModule('electron/ipc/git.js', {
    'node:fs': { existsSync: () => true },
    'simple-git': { simpleGit: () => ({ env() { return this; }, raw: async () => '', getRemotes: async () => [], status: async () => { throw Error('Cannot read index'); } }) }
  }, {}, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) }, gitDirectory: '/mock/repo', t: key => key
  });
  const result = await handlers.get('git-status-check')();
  assert.equal(result.success, false);
  assert.equal(result.error, 'Cannot read index');
  assert.equal(result.ahead, undefined);
});

for (const language of ['en', 'ja']) {
  test(`Setup failure and divergence show different messages and preserve the settings dialog in ${language}`, async () => {
    for (const needsPull of [false, true]) {
      const ui = renderer(async channel => channel === 'git-status-check'
        ? { success: true, isRepo: true, branch: 'main', remoteUrl: '/mock/remote' }
        : { success: false, needsPull, error: 'Authentication failed' }, language);
      await ui.flush();
      ui.render().setGitSettingsDialogOpen(true); ui.render().setTempRemoteUrl('/mock/remote');
      await ui.render().handleSetRemote();
      assert.equal(ui.render().gitSettingsDialogOpen, true);
      assert.equal(ui.render().isGitProcessing, false);
      assert.deepEqual(ui.alerts, [needsPull ? ui.t('git_initial_push_requires_pull') :
        ui.t('settings_error', { error: 'Authentication failed' })]);
    }
  });
  test(`Push stops only for a verified zero count in ${language}`, async () => {
    for (const ahead of [0, null, 2]) {
      const ui = renderer(async channel => channel === 'git-status-check'
        ? { success: true, isRepo: true, remoteUrl: '/mock/remote', ahead } : { success: true }, language);
      await ui.render().handleGitPush();
      assert.equal(ui.calls.some(([channel]) => channel === 'git-push'), ahead !== 0);
      assert.equal(ui.confirmations.length, ahead === 0 ? 0 : 1);
      if (ahead === null) assert.equal(ui.confirmations[0], ui.t('confirm_git_push_unknown_count', { url: '/mock/remote' }));
    }
  });
}

test('Reopening settings refreshes the branch after an external checkout', async () => {
  let branch = 'main';
  const ui = renderer(async () => ({ success: true, isRepo: true, branch }));
  assert.equal((await ui.flush()).branchName, 'main');
  branch = 'feature/demo';
  ui.render().setGitSettingsDialogOpen(true);
  assert.equal((await ui.flush()).branchName, 'feature/demo');
});

for (const readmeState of ['absent', 'untracked', 'staged-with-edits', 'ignored']) {
  test(`Initial setup preserves unrelated staging and a ${readmeState} README`, async t => {
    const h = await createGitRepository(t), remote = await remoteFor(h);
    const readme = path.join(h.repo, 'README.md');
    if (readmeState !== 'absent') fs.writeFileSync(readme, 'Original user documentation\r\n日本語\n');
    if (readmeState === 'staged-with-edits') {
      await h.git.add('README.md');
      fs.appendFileSync(readme, 'Unstaged additions\n');
    }
    if (readmeState === 'ignored') fs.appendFileSync(path.join(h.repo, '.git', 'info', 'exclude'), '\nREADME.md\n');
    fs.writeFileSync(path.join(h.repo, 'notes.txt'), 'Fictional personal draft\n');
    await h.git.add('notes.txt');
    const stagedBefore = await h.git.raw(['ls-files', '--stage']);
    const readmeBefore = readmeState === 'absent' ? null : fs.readFileSync(readme);
    const result = await h.invoke('git-set-remote', { url: remote, branch: 'main' });
    assert.equal(result.success, true, result.error);
    const remoteTree = await h.client(remote).raw(['ls-tree', '--name-only', 'main']);
    assert.equal(remoteTree.trim(), readmeState === 'absent' ? 'README.md' : '');
    assert.equal((await h.git.raw(['diff', '--cached', '--name-only', '--', 'notes.txt'])).trim(), 'notes.txt');
    assert.equal(await h.git.raw(['show', ':notes.txt']), 'Fictional personal draft\n');
    if (readmeBefore) {
      assert.deepEqual(fs.readFileSync(readme), readmeBefore);
      assert.equal(await h.git.raw(['ls-files', '--stage']), stagedBefore);
    } else {
      assert.equal(await h.client(remote).show(['main:README.md']), '# MonaBase Repository\n');
    }
    const head = await h.git.revparse(['HEAD']);
    assert.equal((await h.invoke('git-set-remote', { url: remote, branch: 'main' })).success, true);
    assert.equal(await h.git.revparse(['HEAD']), head, 'Retry must not add another initial commit');
  });
}

test('A failed branch-history query stops setup without replacing files or staging work', async t => {
  const h = await createGitRepository(t), remote = await remoteFor(h);
  const readme = path.join(h.repo, 'README.md');
  fs.writeFileSync(readme, 'Preserve user documentation');
  const handlers = new Map();
  loadModule('electron/ipc/git.js', { 'simple-git': { simpleGit: () => ({ env() { return this; }, raw: async args => {
    if (args[0] === 'config') return '';
    if (args[0] === 'for-each-ref') throw new Error('Cannot read repository history');
    return h.git.raw(args);
  } }) } }, { console: { ...console, error() {} } }, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (key, callback) => handlers.set(key, callback) }, gitDirectory: h.repo, t: key => key
  });
  const result = await handlers.get('git-set-remote')(null, { url: remote, branch: 'main' });
  assert.equal(result.success, false);
  assert.equal(result.error, 'Cannot read repository history');
  assert.equal(fs.readFileSync(readme, 'utf8'), 'Preserve user documentation');
  assert.equal(await h.git.raw(['ls-files', '--stage']), '');
  assert.deepEqual(await h.git.getRemotes(), []);
});
