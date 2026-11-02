// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { simpleGit } = require('simple-git');
const { enqueueGitWrite } = require('../electron/services/gitWrites');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { translate } = require('../electron/i18n');

function handlersFor(git, directory = '/test/git') {
  // Most cases replace transport only; keep an attached local branch for the real handler.
  if (!git.env) git.env = () => git;
  if (!git.getRemotes) git.getRemotes = async () => [];
  if (!git.status) git.status = async () => ({ conflicted: [], files: [] });
  if (!git.raw) git.raw = async () => 'refs/heads/main\n';
  const handlers = new Map();
  const { registerGitHandlers } = loadModule('electron/ipc/git.js', {
    'node:fs': { existsSync: () => true }, 'simple-git': { simpleGit: () => git }
  }, {}, { strict: false });
  registerGitHandlers({ ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, gitDirectory: directory, t: key => key });
  return handlers;
}

function harness(git) {
  return () => handlersFor(git).get('git-pull')();
}

for (const channel of ['git-init-local', 'git-set-remote', 'git-push', 'git-pull', 'git-pull-force', 'git-merge-abort']) {
  test(`${channel} waits for other writes to the same repository`, async () => {
    const directory = path.join(os.tmpdir(), `monabase-queue-${channel}`);
    const order = [];
    const git = Object.fromEntries(['init', 'addRemote', 'push', 'fetch', 'pull', 'merge'].map(method =>
      [method, async () => { order.push(method); }]));
    git.getRemotes = async () => { order.push('getRemotes'); return []; };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const write = enqueueGitWrite(directory, async () => { order.push('write started'); await gate; order.push('write finished'); });
    await Promise.resolve();
    const argument = channel === 'git-set-remote' ? { url: '/mock/remote', branch: 'main' } : 'theirs';
    const pending = handlersFor(git, directory).get(channel)({}, argument);
    try {
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(order, ['write started']);
    } finally { release(); await write; }
    const result = await pending;
    assert.equal(result.success, true);
    assert.equal(order[1], 'write finished');
    assert.ok(order.length > 2);
  });
}

for (const language of ['en', 'ja']) {
  for (const outcome of ['success', 'failure', 'missing', 'rejected']) {
    test(`Pull cancellation reports ${outcome} accurately in ${language}`, async () => {
      const alerts = [], calls = [], loading = [], confirmations = [true, true];
      const t = (key, values) => translate(key, language, values);
      const { useGlobalGit } = loadTypeScript('src/features/git/useGlobalGit.ts', {
        react: { useState: value => [value, () => {}], useEffect() {}, useCallback: callback => callback },
        'react-i18next': { useTranslation: () => ({ t }) },
        '@/shared/api/desktop': { ipcRenderer: { invoke: async channel => {
          calls.push(channel);
          if (channel === 'git-status-check') return { success: true, isRepo: true, remoteUrl: '/mock/remote' };
          if (channel === 'git-pull') return { success: false, isConflict: true };
          assert.equal(channel, 'git-merge-abort');
          if (outcome === 'rejected') throw new Error('Abort transport error');
          if (outcome === 'missing') return undefined;
          return outcome === 'success' ? { success: true } : { success: false, error: 'Cannot restore worktree' };
        } } }
      }, { window: { confirm: () => confirmations.shift(), dispatchEvent() {} }, CustomEvent: class {}, alert: message => alerts.push(message) });
      const logic = useGlobalGit({ setIsGlobalLoading: value => loading.push(value) });
      await logic.handleGitPull(); await logic.handleAbortMerge();
      assert.deepEqual(calls, ['git-status-check', 'git-pull', 'git-merge-abort']);
      assert.equal(alerts.length, 1);
      if (outcome === 'success') {
        assert.equal(alerts[0], t('pull_operation_canceled_restored_to_original_safe_state'));
      } else {
        const error = outcome === 'missing' ? t('git_merge_abort_failed') :
          outcome === 'rejected' ? 'Abort transport error' : 'Cannot restore worktree';
        assert.equal(alerts[0], t('git_pull_cancel_failed', { error }));
        assert.notEqual(alerts[0], t('pull_operation_canceled_restored_to_original_safe_state'));
      }
      assert.equal(loading.at(-1), false);
    });
  }
}

test('Authentication and network errors do not enter conflict resolution or continue after failed fetch', async () => {
  for (const message of ['Authentication failed', 'Could not resolve host']) {
    let pulls = 0;
    const pull = harness({
      fetch: async () => { throw new Error(message); }, pull: async () => { pulls += 1; },
      status: async () => ({ conflicted: [] })
    });
    const result = await pull();
    assert.equal(result.success, false);
    assert.equal(result.isConflict, false);
    assert.equal(result.error, message);
    assert.equal(pulls, 0);
  }
});

test('Only actual conflicted files enable conflict resolution', async () => {
  const result = await harness({
    fetch: async () => {}, pull: async () => { throw new Error('Merge failed'); },
    status: async () => ({ conflicted: ['definition.sql'] })
  })();
  assert.equal(result.isConflict, true);
  assert.equal(result.statusUnavailable, false);
});

test('Unavailable repository status preserves the original error without claiming a conflict', async () => {
  const result = await harness({
    fetch: async () => { throw new Error('Original network error'); },
    status: async () => { throw new Error('Cannot read status'); }
  })();
  assert.equal(result.isConflict, false);
  assert.equal(result.statusUnavailable, true);
  assert.equal(result.error, 'Original network error');
});

test('Actual local repositories distinguish merge conflicts from inaccessible remotes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-git-errors-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config') };
  for (const name of ['GIT_PAGER', 'PAGER', 'EDITOR', 'VISUAL', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR']) delete env[name];
  const git = (args, cwd = root) => execFileSync('git', args, { cwd, env, stdio: 'pipe' });
  const remote = path.join(root, 'remote.git');
  git(['init', '--bare', '--initial-branch=main', remote]);
  git(['clone', remote, 'first']);
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  const configure = cwd => {
    git(['config', 'user.name', 'MonaBase tests'], cwd);
    git(['config', 'user.email', 'tests@example.invalid'], cwd);
  };
  const commit = (cwd, text) => {
    fs.writeFileSync(path.join(cwd, 'definition.sql'), text);
    git(['add', 'definition.sql'], cwd);
    git(['commit', '-m', 'Test fixture'], cwd);
  };
  configure(first);
  commit(first, 'initial\n');
  git(['push', '-u', 'origin', 'main'], first);
  git(['clone', remote, 'second']);
  configure(second);
  commit(first, 'remote change\n');
  git(['push'], first);
  commit(second, 'local change\n');
  // Only this test's temporary config path is enabled; no user configuration is read.
  const client = simpleGit({ baseDir: second, allowEnvironment: ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT', 'GIT_ALLOW_PROTOCOL'], unsafe: { allowUnsafeConfigPaths: true, allowUnsafeProtocolOverride: true } }).env(env);
  const conflicted = await harness(client)();
  assert.equal(conflicted.isConflict, true, JSON.stringify(conflicted));
  assert.deepEqual((await client.status()).conflicted, ['definition.sql']);
  await client.merge(['--abort']);
  await client.remote(['set-url', 'origin', path.join(root, 'missing.git')]);
  const unavailable = await harness(client)();
  assert.equal(unavailable.isConflict, false);
  assert.equal(unavailable.success, false);
});

test('Origin validation rejects every unsafe push URL and expands Git URL rewrites before transport', async t => {
  const { createGitRepository } = require('./helpers/gitRepository.cjs');
  const { assertSafeOrigin } = require('../electron/services/gitSecurity');
  const h = await createGitRepository(t);
  await h.git.addRemote('origin', 'https://example.invalid/repo.git');
  for (const values of [
    ['http://outside.invalid/repo.git', 'https://example.invalid/repo.git'],
    ['https://example.invalid/repo.git', 'http://outside.invalid/repo.git']
  ]) {
    await h.git.raw(['config', '--unset-all', 'remote.origin.pushurl']).catch(() => {});
    for (const value of values) await h.git.raw(['config', '--add', 'remote.origin.pushurl', value]);
    await assert.rejects(assertSafeOrigin(h.git), /security_git_invalid_remote/);
  }
  await h.git.raw(['config', '--unset-all', 'remote.origin.pushurl']);
  execFileSync('git', ['-C', h.repo, 'config', '--local', 'url.http://outside.invalid/.insteadOf', 'https://example.invalid/']);
  await assert.rejects(assertSafeOrigin(h.git), /security_git_invalid_remote/);
  execFileSync('git', ['-C', h.repo, 'config', '--local', '--unset-all', 'url.http://outside.invalid/.insteadOf']);
  execFileSync('git', ['-C', h.repo, 'config', '--local', 'url.http://outside.invalid/.pushInsteadOf', 'https://example.invalid/']);
  await assert.rejects(assertSafeOrigin(h.git), /security_git_invalid_remote/);
  execFileSync('git', ['-C', h.repo, 'config', '--local', '--unset-all', 'url.http://outside.invalid/.pushInsteadOf']);
  await assert.doesNotReject(assertSafeOrigin(h.git));
  await h.git.raw(['config', '--add', 'remote.origin.pushurl', 'https://one.invalid/repo']);
  await h.git.raw(['config', '--add', 'remote.origin.pushurl', 'ssh://git@two.invalid/repo']);
  await assert.doesNotReject(assertSafeOrigin(h.git));
  // This test only inspects local configuration; it never opens a remote connection.
});
