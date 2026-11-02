// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadModule } = require('./loadModule.cjs');

function application(h, directory) {
  const handlers = new Map();
  loadModule('electron/ipc/git.js', { 'simple-git': { simpleGit: h.client } }, {}, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, gitDirectory: directory, t: key => key,
    createGit: overrides => h.client(directory).env(overrides || {})
  });
  return (channel, request) => handlers.get(channel)(null, request);
}

async function writeCommit(h, files, message) {
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(h.repo, name);
    if (content === null) await h.git.raw(['--literal-pathspecs', 'rm', '--', name]);
    else { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  }
  const written = Object.keys(files).filter(name => files[name] !== null);
  if (written.length) await h.git.raw(['--literal-pathspecs', 'add', '-A', '--', ...written]);
  await h.git.commit(message);
}

async function snapshot(h) {
  return { head: (await h.git.revparse(['HEAD'])).trim(), index: await h.git.raw(['ls-files', '--stage', '-z']), status: await h.git.raw(['status', '--porcelain=v1', '-z']) };
}

async function localRemote(h) {
  const remote = path.join(h.directory, 'remote.git'); fs.mkdirSync(remote);
  await h.client(remote).raw(['init', '--bare', '--initial-branch=main']);
  const configured = await h.invoke('git-set-remote', { url: remote, branch: 'main' }); assert.equal(configured.success, true, configured.error);
  const peerPath = path.join(h.directory, 'peer'); await h.client(h.directory).clone(remote, peerPath);
  const peerGit = h.client(peerPath);
  for (const [key, value] of [['user.name', 'Other test'], ['user.email', 'peer@example.invalid'], ['commit.gpgsign', 'false'], ['core.hooksPath', path.join(h.directory, 'no-hooks')]]) await peerGit.addConfig(key, value, false, 'local');
  return { remote, peer: { ...h, repo: peerPath, git: peerGit } };
}

module.exports = { application, writeCommit, snapshot, localRemote };
