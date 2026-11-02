// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { createGitRepository } = require('./helpers/gitRepository.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { readHistoryPage, readHistoricalSource, readHistoryOutput, HISTORY_PAGE_SIZE, HISTORY_MAX_BYTES, MAX_RENAME_RECORDS } = require('../electron/services/gitHistory');
const request = { dbType: 'ORACLE', schema: 'TEST', objectType: 'FUNCTION', objectName: 'HISTORY' };

test('Source and ER history pages preserve exact messages and expose older revisions without accumulating all history', async t => {
  const repo = await createGitRepository(t);
  await repo.invoke('git-commit', { ...request, sourceText: 'initial', message: 'Initial' });
  const sourceFile = (await repo.git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).trim();
  const erFile = 'MonaBase/ORACLE/ErDiagram/history.json';
  fs.mkdirSync(path.dirname(path.join(repo.repo, erFile)), { recursive: true });
  for (let index = 0; index < HISTORY_PAGE_SIZE + 2; index++) {
    fs.writeFileSync(path.join(repo.repo, sourceFile), String(index));
    fs.writeFileSync(path.join(repo.repo, erFile), String(index));
    await repo.git.add([sourceFile, erFile]); await repo.git.commit(`Revision ${index} | 日本語 \u001e`);
  }
  const handlers = new Map();
  require('../electron/ipc/er').registerErHandlers({ ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    gitDirectory: repo.repo, createGit: async () => repo.git, t: key => key });
  for (const invoke of [page => repo.invoke('git-get-history', { ...request, page }),
    page => handlers.get('git-get-history-er')(null, { dbType: 'ORACLE', objectName: 'history', page })]) {
    const first = await invoke(0), second = await invoke(1);
    assert.equal(first.success, true, first.error); assert.equal(second.success, true, second.error);
    assert.equal(first.history.length, HISTORY_PAGE_SIZE); assert.equal(first.hasMore, true);
    assert.ok(second.history.length > 0); assert.equal(second.hasMore, false);
    assert.ok(first.history.every(row => !second.history.some(older => older.fullId === row.fullId)));
    assert.equal(first.history.find(row => row.fullId === (second.history[0]?.fullId || '') ), undefined);
    assert.ok(first.history.every(row => row.message.includes('| 日本語 \u001e')));
  }
  const page = await readHistoryPage(repo.repo, [sourceFile, sourceFile], 0);
  assert.equal(page.history.length, HISTORY_PAGE_SIZE);
});

test('Pushed history is determined through remote ancestry including a pushed commit behind the remote tip', async t => {
  const repo = await createGitRepository(t);
  for (const value of ['one', 'two', 'three']) await repo.invoke('git-commit', { ...request, sourceText: value, message: value });
  const commits = (await repo.git.raw(['log', '--format=%H'])).trim().split('\n');
  await repo.git.addRemote('origin', path.join(repo.directory, 'unused-remote'));
  await repo.git.raw(['update-ref', 'refs/remotes/origin/main', commits[1]]);
  const result = await repo.invoke('git-get-history', request);
  assert.equal(result.success, true, result.error);
  assert.equal(result.history.find(row => row.fullId === commits[0]).isPushed, false);
  for (const id of commits.slice(1)) assert.equal(result.history.find(row => row.fullId === id).isPushed, true);
});

test('One oversized commit message is stopped by the streaming limit and reports a fixed error', async t => {
  const repo = await createGitRepository(t);
  await repo.invoke('git-commit', { ...request, sourceText: 'initial', message: 'Initial' });
  const tree = (await repo.git.raw(['rev-parse', 'HEAD^{tree}'])).trim();
  const message = path.join(repo.directory, 'message');
  fs.writeFileSync(message, 'x'.repeat(9 * 1024 * 1024));
  const commit = (await repo.git.raw(['commit-tree', tree, '-F', message])).trim();
  await repo.git.raw(['update-ref', 'HEAD', commit]);
  const result = await repo.invoke('git-get-history', request);
  assert.equal(result.success, false);
  assert.ok(result.error.length < 300); assert.ok(!result.error.includes('xxxxxxxx'));
  for (const page of [-1, 0.5, '0', 1_000_001]) {
    const invalid = await repo.invoke('git-get-history', { ...request, page });
    assert.equal(invalid.success, false);
  }
});

for (const stream of ['stdout', 'stderr', 'timeout']) {
  test(`Bounded history ${stream} terminates the child and rejects without retaining diagnostics`, async () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    let signal;
    child.kill = value => { signal = value; queueMicrotask(() => child.emit('close', null)); };
    const { readHistoryOutput } = loadModule('electron/services/gitHistory.js', {
      'node:child_process': { spawn: () => {
        if (stream !== 'timeout') queueMicrotask(() => child[stream].emit('data', Buffer.alloc(1025, 120)));
        return child;
      } }, './dataSafety': require('../electron/services/dataSafety'), './workspacePaths': require('../electron/services/workspacePaths')
    });
    await assert.rejects(readHistoryOutput('.', ['log'], { maximum: 1024, timeout: 10 }),
      error => error.code === (stream === 'timeout' ? 'git_history_timeout' : 'git_history_too_large'));
    assert.equal(signal, 'SIGKILL');
  });
}

test('Remote-history discovery failures redact credential-bearing errors before console output', async t => {
  const repo = await createGitRepository(t), handlers = new Map(), logs = [];
  const secret = 'dummy-password-for-history-test';
  loadModule('electron/ipc/git.js', {}, { console: { ...console, error: (...args) => logs.push(args.join(' ')) } }, { strict: false }).registerGitHandlers({
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, gitDirectory: repo.repo, t: key => key,
    createGit: async () => ({ getRemotes: async () => { throw new Error(`https://demo:${secret}@example.invalid/repo`); }, raw: async () => '' })
  });
  const result = await handlers.get('git-get-history')(null, request);
  assert.equal(result.success, true); assert.equal(logs.length, 1);
  assert.ok(logs[0].includes('<redacted>')); assert.ok(!logs[0].includes(secret));
});


function importChanges(repo, parent, steps) {
  let input = '';
  steps.forEach((commands, index) => {
    input += `commit refs/heads/main\nmark :${index + 1}\ncommitter Review <review@example.invalid> ${1700000000 + index} +0000\ndata 6\nReview\nfrom ${index ? ':' + index : parent}\n${commands}\n`;
  });
  const result = spawnSync('git', ['-C', repo.repo, 'fast-import', '--quiet'], { input, encoding: 'utf8' });
  assert.equal(result.status, 0, 'Disposable Git history import must succeed.');
}

test('A single source from a thousand ordinary revisions uses direct immutable lookup without scanning path history', async t => {
  const repo = await createGitRepository(t);
  await repo.invoke('git-commit', { ...request, sourceText: 'initial', message: 'Initial' });
  const file = (await repo.git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).trim();
  importChanges(repo, (await repo.git.revparse(['HEAD'])).trim(), Array.from({ length: 1000 }, (_, index) =>
    `M 100644 inline ${file}\ndata 1\n${index % 2}`));
  const calls = [];
  const source = await readHistoricalSource(repo.repo, (await repo.git.revparse(['HEAD'])).trim(), [file], {
    readOutput: async (...args) => { calls.push(args[1]); return readHistoryOutput(...args); }
  });
  assert.equal(source, '1'); assert.ok(!calls.some(args => args.includes('log')));
  assert.ok(calls.length <= 5);
  const result = await repo.invoke('git-get-file-content', { ...request, commitId: (await repo.git.revparse(['HEAD'])).trim() });
  assert.equal(result.success, true, result.error); assert.equal(result.content, '1');
});

test('Rename-only discovery retains older source through multiple renames and a thousand later ordinary changes', async t => {
  const repo = await createGitRepository(t);
  await repo.invoke('git-commit', { ...request, sourceText: 'original source', message: 'Initial' });
  const original = (await repo.git.revparse(['HEAD'])).trim();
  const first = (await repo.git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).trim();
  const middle = 'MonaBase/middle.sql', last = 'MonaBase/latest.sql';
  const steps = [`R ${first} ${middle}`, `R ${middle} ${last}`];
  for (let index = 0; index < 1000; index++) steps.push(`M 100644 inline ${last}\ndata 1\n${index % 2}`);
  importChanges(repo, original, steps);
  const calls = [];
  const source = await readHistoricalSource(repo.repo, original, [last], {
    readOutput: async (...args) => { calls.push(args[1]); return readHistoryOutput(...args); }
  });
  assert.equal(source, 'original source');
  const logs = calls.filter(args => args.includes('log')); assert.equal(logs.length, 1);
  assert.ok(logs[0].includes('--diff-filter=R')); assert.ok(logs[0].includes('--name-status'));
  assert.equal(logs[0].filter(arg => arg.startsWith('--max-count=')).length, 1);
});

test('Excessive real rename chains fail explicitly without changing HEAD, staging or working files', async t => {
  const repo = await createGitRepository(t);
  await repo.invoke('git-commit', { ...request, sourceText: 'unchanged source', message: 'Initial' });
  const original = (await repo.git.revparse(['HEAD'])).trim();
  const first = (await repo.git.raw(['ls-tree', '-r', '--name-only', 'HEAD'])).trim();
  let file = first;
  const steps = [];
  for (let index = 0; index <= MAX_RENAME_RECORDS; index++) {
    const next = `MonaBase/renamed_${index}.sql`; steps.push(`R ${file} ${next}`); file = next;
  }
  importChanges(repo, original, steps);
  const head = await repo.git.revparse(['HEAD']), index = await repo.git.raw(['ls-files', '--stage', '-z']);
  const bytes = fs.readFileSync(path.join(repo.repo, first));
  await assert.rejects(readHistoricalSource(repo.repo, original, [file]), { code: 'git_history_rename_limit' });
  assert.equal(await repo.git.revparse(['HEAD']), head); assert.equal(await repo.git.raw(['ls-files', '--stage', '-z']), index);
  assert.ok(fs.readFileSync(path.join(repo.repo, first)).equals(bytes));
});

test('Historical source metadata shares one byte budget and one deadline across all commands', async () => {
  const hash = 'a'.repeat(40), calls = [];
  await assert.rejects(readHistoricalSource('.', hash, ['MonaBase/current.sql'], {
    readOutput: async (_directory, args, options) => {
      calls.push(options.maximum);
      if (args[0] === 'rev-parse') return hash + '\n';
      if (args.includes('ls-tree')) return '';
      return 'x'.repeat(HISTORY_MAX_BYTES);
    }
  }), { code: 'git_history_too_large' });
  assert.ok(calls.at(-1) < HISTORY_MAX_BYTES);
  let clock = 0, commands = 0;
  await assert.rejects(readHistoricalSource('.', hash, ['MonaBase/current.sql'], {
    now: () => clock,
    readOutput: async () => { commands++; clock = 31000; return hash + '\n'; }
  }), { code: 'git_history_timeout' });
  assert.equal(commands, 1);
});

test('Malformed or unsafe rename metadata is refused before reading any historical content', async () => {
  const hash = 'a'.repeat(40);
  for (const output of ['R100\0MonaBase/../outside.sql\0MonaBase/current.sql\0', 'R100\0MonaBase/old.sql', 'A\0MonaBase/old.sql\0']) {
    let blobReads = 0;
    await assert.rejects(readHistoricalSource('.', hash, ['MonaBase/current.sql'], {
      readOutput: async (_directory, args) => {
        if (args[0] === 'rev-parse') return hash + '\n';
        if (args.includes('ls-tree')) return '';
        if (args[0] === 'cat-file') blobReads++;
        return output;
      }
    }));
    assert.equal(blobReads, 0);
  }
});
