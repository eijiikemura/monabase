// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const path = require('node:path');

const queues = new Map();

function enqueueGitWrite(directory, operation) {
  const key = path.resolve(directory);
  const result = (queues.get(key) || Promise.resolve()).then(operation);
  const tail = result.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return result;
}

async function commitPaths(git, message, paths) {
  const staged = await git.raw(['--literal-pathspecs', 'diff', '--cached', '--name-only', '--', ...paths]);
  const unstaged = await git.raw(['--literal-pathspecs', 'diff', '--name-only', '--', ...paths]);
  if (staged.trim() || unstaged.trim()) {
    // Preserve unrelated staged work and treat identical retries as successful no-ops.
    await git.raw(['--literal-pathspecs', 'commit', '-m', message, '--', ...paths]);
  }
}

module.exports = { enqueueGitWrite, commitPaths };
