// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');

async function fixture(t, channel, failure) {
  const h = await createGitRepository(t);
  let fail = false;
  const simulatedFs = { ...fs, [failure]: (...args) => {
    if (fail) {
      fail = false;
      if (failure === 'writeFileSync') fs.writeFileSync(args[0], Buffer.from('partial'));
      throw Object.assign(new Error('Simulated storage failure'), { code: 'ENOSPC' });
    }
    return fs[failure](...args);
  } };
  const atomic = loadModule('electron/services/atomicFiles.js', { 'node:fs': simulatedFs, 'node:path': path, 'node:crypto': crypto });
  const source = channel === 'git-commit';
  const handlers = new Map();
  const module = loadModule(source ? 'electron/ipc/git.js' : 'electron/ipc/er.js', {
    'simple-git': { simpleGit: h.client }, '../services/atomicFiles': atomic
  }, { console: { ...console, error() {} } }, { strict: false });
  (source ? module.registerGitHandlers : module.registerErHandlers)({
    ipcMain: { handle: (key, callback) => handlers.set(key, callback) }, gitDirectory: h.repo, t: key => key
  });
  const request = source
    ? { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'CALC', message: 'Fixture' }
    : { dbType: 'POSTGRESQL', objectName: 'plan[1]', message: 'Fixture' };
  const initial = source ? 'CREATE FUNCTION CALC RETURN NUMBER AS BEGIN RETURN 1; END;\r\n-- 日本語' : '{"nodes":[],"edges":[],"title":"日本語"}';
  const next = source ? initial.replace('RETURN 1;', 'RETURN 2;') : '{"nodes":[{"id":"new"}],"edges":[],"title":"日本語"}';
  const save = text => handlers.get(channel)(null, { ...request, sourceText: text });
  assert.equal((await save(initial)).success, true);
  const files = [];
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) scan(file); else files.push(file);
    }
  }
  scan(h.repo);
  assert.equal(files.length, 1);
  return { ...h, file: files[0], initial, next, save, injectFailure: () => { fail = true; } };
}

for (const channel of ['git-commit', 'git-commit-er', 'save-er-diagram']) {
  for (const failure of ['writeFileSync', 'fsyncSync', 'renameSync']) {
    test(`${channel}: ${failure} failure preserves old bytes, staging and history; retry saves complete content`, async t => {
      const h = await fixture(t, channel, failure);
      fs.writeFileSync(path.join(h.repo, 'notes.txt'), 'Unrelated staged notes');
      await h.git.add('notes.txt');
      const staged = await h.git.raw(['ls-files', '--stage']);
      const commits = await h.git.raw(['rev-list', '--all']);
      h.injectFailure();
      const result = await h.save(h.next);
      assert.equal(result.success, false);
      assert.equal(result.error, 'Simulated storage failure');
      assert.equal(fs.readFileSync(h.file, 'utf8'), h.initial);
      assert.equal(await h.git.raw(['ls-files', '--stage']), staged);
      assert.equal(await h.git.raw(['rev-list', '--all']), commits);
      assert.deepEqual(fs.readdirSync(path.dirname(h.file)), [path.basename(h.file)]);
      assert.equal((await h.save(h.next)).success, true);
      assert.equal(fs.readFileSync(h.file, 'utf8'), h.next);
      assert.deepEqual(fs.readdirSync(path.dirname(h.file)), [path.basename(h.file)]);
      assert.equal((await h.git.raw(['diff', '--cached', '--name-only', '--', 'notes.txt'])).trim(), 'notes.txt');
      if (channel !== 'save-er-diagram') {
        const relative = path.relative(h.repo, h.file).split(path.sep).join('/');
        assert.equal(await h.git.show([`HEAD:${relative}`]), h.next);
        assert.equal(await h.git.show([`HEAD~1:${relative}`]), h.initial);
      }
    });
  }
  test(`${channel}: a failed save to a missing destination leaves no incomplete file and can be retried`, async t => {
    const h = await fixture(t, channel, 'writeFileSync');
    // Remove only this test's fixture to exercise a destination that does not exist yet.
    fs.unlinkSync(h.file);
    h.injectFailure();
    assert.equal((await h.save(h.next)).success, false);
    assert.equal(fs.existsSync(h.file), false);
    assert.deepEqual(fs.readdirSync(path.dirname(h.file)), []);
    assert.equal((await h.save(h.next)).success, true);
    assert.equal(fs.readFileSync(h.file, 'utf8'), h.next);
  });
}
