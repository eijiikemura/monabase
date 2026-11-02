// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { simpleGit } = require('simple-git');
const { loadModule } = require('./loadModule.cjs');

async function createGitRepository(t) {
  const base = process.env.MONABASE_GIT_TEST_ROOT ? path.resolve(process.env.MONABASE_GIT_TEST_ROOT) : os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.mkdtempSync(path.join(base, 'monabase-git-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
  for (const name of ['PAGER', 'EDITOR', 'VISUAL']) delete env[name];
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(directory, 'no-global-config'),
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file' });
  const client = input => {
    const options = typeof input === 'string' ? { baseDir: input } : input;
    const git = simpleGit({ ...options, allowEnvironment: ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_TERMINAL_PROMPT', 'GIT_ALLOW_PROTOCOL', 'GIT_INDEX_FILE'], unsafe: { allowUnsafeConfigPaths: true, allowUnsafeHooksPath: true, allowUnsafeProtocolOverride: true } });
    const setEnv = git.env.bind(git);
    git.env = values => setEnv({ ...values, ...env, ...(values.GIT_INDEX_FILE ? { GIT_INDEX_FILE: values.GIT_INDEX_FILE } : {}) });
    return git.env(env);
  };
  const repo = path.join(directory, 'repo');
  fs.mkdirSync(repo);
  const git = client(repo);
  await git.raw(['init', '--initial-branch=main']);
  await git.addConfig('user.name', 'MonaBase tests', false, 'local');
  await git.addConfig('user.email', 'tests@example.invalid', false, 'local');
  await git.addConfig('commit.gpgsign', 'false', false, 'local');
  await git.addConfig('core.hooksPath', path.join(directory, 'no-hooks'), false, 'local');
  const handlers = new Map();
  loadModule('electron/ipc/git.js', { 'simple-git': { simpleGit: client } }, {}, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, gitDirectory: repo, t: key => key,
    createGit: overrides => client(repo).env({ ...env, ...overrides })
  });
  return { directory, repo, git, client, invoke: (channel, request) => handlers.get(channel)(null, request) };
}

module.exports = { createGitRepository };
