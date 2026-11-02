// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadModule } = require('./helpers/loadModule.cjs');
const paths = require('../electron/services/workspacePaths');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-paths-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const outside = path.join(root, 'outside.sql');
  fs.writeFileSync(outside, 'preserve');
  const handlers = new Map(), calls = [];
  const git = Object.fromEntries(['add', 'commit', 'rm', 'mv', 'show', 'raw', 'getRemotes'].map(name =>
    [name, async (...args) => { if (!(name === 'raw' && args[0]?.[0] === 'config')) calls.push([name, ...args]); return name === 'getRemotes' ? [] : ''; }]));
  git.env = () => git;
  for (const [file, register] of [['git', 'registerGitHandlers'], ['er', 'registerErHandlers']]) {
    loadModule(`electron/ipc/${file}.js`, {
      'node:fs': fs, 'node:path': path, 'simple-git': { simpleGit: () => git },
      '../services/gitHistory': require('../electron/services/gitHistory'),
      '../services/dataSafety': require('../electron/services/dataSafety'),
      '../services/boundedFiles': require('../electron/services/boundedFiles'),
      '../services/settings': require('../electron/services/settings'),
      '../services/workspacePaths': paths,
      '../services/gitClient': require('../electron/services/gitClient'),
      '../services/gitSecurity': require('../electron/services/gitSecurity'),
      '../services/gitReview': require('../electron/services/gitReview'),
      '../services/gitWrites': require('../electron/services/gitWrites'),
      '../services/atomicFiles': require('../electron/services/atomicFiles'),
      '../services/gitSourceNames': require('../electron/services/gitSourceNames')
    }, { console: { error() {} } })[register]({
      ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, gitDirectory: repo, t: key => key
    });
  }
  return { root, repo, outside, calls, invoke: (channel, args) => handlers.get(channel)(null, args) };
}

test('Rejects traversal, Windows paths, Git metadata, and special pathspec characters on every OS', t => {
  const h = fixture(t);
  for (const value of ['..', '.', '../outside', '..\\outside', '/tmp/x', 'C:\\x', '\\\\server\\x', '.git', '.GIT', 'x\0y', 'NUL', 'x.', ':glob', '*']) {
    assert.throws(() => paths.workspacePath(h.repo, 'MonaBase', value), /Invalid workspace/);
  }
  assert.equal(paths.workspaceRelativePath(h.repo, 'MonaBase', '注文 demo.sql'), 'MonaBase/注文 demo.sql');
});

test('All object and ER handlers reject unsafe paths before disk or Git changes', async t => {
  const h = fixture(t);
  const base = { dbType: 'POSTGRESQL', schema: 'public', objectType: 'FUNCTION', objectName: '../../outside', sourceText: 'overwrite', commitId: 'abc1234' };
  const channels = ['git-commit', 'git-get-history', 'git-get-file-content', 'git-delete-object',
    'git-commit-er', 'git-get-history-er', 'git-get-file-content-er', 'save-er-diagram', 'load-er-diagram', 'delete-er-diagram'];
  for (const channel of channels) {
    const result = await h.invoke(channel, base);
    assert.equal(result.success, false, channel);
  }
  for (const field of ['dbType', 'schema', 'objectType']) {
    assert.equal((await h.invoke('git-commit', { ...base, objectName: 'valid', [field]: '..' })).success, false);
  }
  for (const names of [{ oldName: '../outside', newName: 'safe' }, { oldName: 'safe', newName: '..\\outside' }]) {
    assert.equal((await h.invoke('git-rename-object', { ...base, ...names })).success, false);
  }
  assert.equal((await h.invoke('get-er-diagrams', '../outside')).success, false);
  assert.deepEqual(fs.readdirSync(h.repo), []);
  assert.equal(fs.readFileSync(h.outside, 'utf8'), 'preserve');
  assert.deepEqual(h.calls, []);
});

test('Rejects directory links and final file links without reading or overwriting their targets', async t => {
  const h = fixture(t);
  fs.mkdirSync(path.join(h.repo, 'MonaBase'));
  fs.symlinkSync(h.root, path.join(h.repo, 'MonaBase', 'POSTGRESQL'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await h.invoke('save-er-diagram', { dbType: 'POSTGRESQL', objectName: 'outside', sourceText: 'bad' })).success, false);
  fs.unlinkSync(path.join(h.repo, 'MonaBase', 'POSTGRESQL'));
  const dir = path.join(h.repo, 'MonaBase', 'POSTGRESQL', 'ErDiagram');
  fs.mkdirSync(dir, { recursive: true });
  // Directory junctions above cover Windows without requiring symlink privileges.
  if (process.platform !== 'win32') {
    fs.symlinkSync(h.outside, path.join(dir, 'outside.json'));
    for (const channel of ['save-er-diagram', 'load-er-diagram', 'delete-er-diagram']) {
      assert.equal((await h.invoke(channel, { dbType: 'POSTGRESQL', objectName: 'outside.json', sourceText: 'bad' })).success, false);
    }
  }
  assert.equal(fs.readFileSync(h.outside, 'utf8'), 'preserve');
});

test('Valid ER files still save, load, list, commit, and delete within the selected workspace', async t => {
  const h = fixture(t);
  const args = { dbType: 'POSTGRESQL', objectName: '注文 demo.json', sourceText: '{"nodes":[]}' };
  assert.equal((await h.invoke('save-er-diagram', args)).success, true);
  assert.equal((await h.invoke('load-er-diagram', args)).data, args.sourceText);
  assert.deepEqual(Array.from((await h.invoke('get-er-diagrams', args.dbType)).files), [args.objectName]);
  fs.mkdirSync(path.join(h.repo, '.git'));
  assert.equal((await h.invoke('git-commit-er', args)).success, true);
  assert.equal(h.calls[0][0], 'raw');
  assert.equal(h.calls[0][1][1], 'add');
  assert.equal((await h.invoke('delete-er-diagram', args)).success, true);
  assert.equal(fs.existsSync(path.join(h.repo, 'MonaBase', args.dbType, 'ErDiagram', args.objectName)), false);
});
