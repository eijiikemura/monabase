// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { spawn } = require('node:child_process');
const { dataError, readGitSource, GIT_SOURCE_MAX_BYTES } = require('./dataSafety');
const { workspaceRelativePath } = require('./workspacePaths');

const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX_BYTES = 8 * 1024 * 1024;
const HISTORY_TIMEOUT_MS = 30_000;

// These read-only commands never invoke a shell, hooks, pagers, or external diffs.
function readHistoryOutput(directory, args, { maximum = HISTORY_MAX_BYTES, timeout = HISTORY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_|^(?:EDITOR|VISUAL|PAGER)$/.test(name)));
    Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' });
    const child = spawn('git', ['--no-pager', ...args], { cwd: directory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let size = 0, failure;
    const stop = code => {
      if (failure) return;
      failure = dataError(code);
      chunks.length = 0;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop('git_history_timeout'), timeout);
    child.stdout.on('data', chunk => {
      if (failure) return;
      size += chunk.length;
      if (size > maximum) stop('git_history_too_large');
      else chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (failure) return;
      size += chunk.length;
      if (size > maximum) stop('git_history_too_large');
      // Do not retain arbitrary Git diagnostics, which may contain credentials.
    });
    child.on('error', () => { failure ||= dataError('git_history_failed'); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(dataError('git_history_failed'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

function historyPage(value = 0) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw dataError('git_history_invalid_page');
  return value;
}

async function readHistoryPage(directory, paths, page = 0, hasRemote = false, follow = true) {
  page = historyPage(page);
  const deadline = Date.now() + HISTORY_TIMEOUT_MS;
  const remaining = () => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw dataError('git_history_timeout');
    return timeout;
  };
  const unique = new Map();
  let hasMore = false, totalBytes = 0;
  // Two paths allow existing portable source names and their earlier names to coexist.
  for (const file of [...new Set(paths.filter(Boolean))]) {
    const output = await readHistoryOutput(directory, ['--literal-pathspecs', 'log', ...(follow ? ['--follow'] : []), '-z',
      `--skip=${page * HISTORY_PAGE_SIZE}`, `--max-count=${HISTORY_PAGE_SIZE + 1}`,
      '--format=%H%x00%ai%x00%p%x00%s', '--', file], { timeout: remaining() });
    totalBytes += Buffer.byteLength(output);
    if (totalBytes > HISTORY_MAX_BYTES) throw dataError('git_history_too_large');
    const fields = output.split('\0');
    const rows = [];
    for (let index = 0; index + 3 < fields.length; index += 4) {
      const [hash, date, parents, message] = fields.slice(index, index + 4);
      if (!/^[a-f0-9]{40,64}$/i.test(hash)) throw dataError('internal_data_invalid');
      rows.push({ id: hash.slice(0, 7), fullId: hash, date, message, hasRemote,
        isPushed: false, isMerge: parents.trim().split(/\s+/).filter(Boolean).length > 1 });
    }
    hasMore ||= rows.length > HISTORY_PAGE_SIZE;
    for (const row of rows.slice(0, HISTORY_PAGE_SIZE)) unique.set(row.fullId, row);
  }
  const history = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (hasRemote) {
    for (const row of history) {
      // Check ancestry only for this page rather than collecting every remote commit.
      row.isPushed = !!(await readHistoryOutput(directory, ['for-each-ref', `--contains=${row.fullId}`,
        '--count=1', '--format=%(objectname)', 'refs/remotes/'], { maximum: 4096, timeout: remaining() })).trim();
    }
  }
  return { history, hasMore, page };
}

const MAX_RENAME_RECORDS = 128;
const MAX_HISTORICAL_PATHS = 256;

async function readHistoricalSource(directory, revision, paths, { readOutput = readHistoryOutput, now = Date.now } = {}) {
  if (!/^[a-f0-9]{7,40}$/i.test(revision) || paths.length > 2) throw dataError('internal_data_invalid');
  const deadline = now() + HISTORY_TIMEOUT_MS;
  let metadataBytes = 0;
  const remaining = () => {
    const timeout = deadline - now();
    if (timeout <= 0) throw dataError('git_history_timeout');
    return timeout;
  };
  const metadata = async args => {
    const maximum = HISTORY_MAX_BYTES - metadataBytes;
    if (maximum <= 0) throw dataError('git_history_too_large');
    const output = await readOutput(directory, args, { maximum, timeout: remaining() });
    metadataBytes += Buffer.byteLength(output);
    if (metadataBytes > HISTORY_MAX_BYTES) throw dataError('git_history_too_large');
    return output;
  };
  const validate = file => workspaceRelativePath(directory, ...file.split('/'));
  const candidates = new Set(paths.filter(Boolean).map(validate));
  const target = (await metadata(['rev-parse', '--verify', `${revision}^{commit}`])).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(target)) throw dataError('internal_data_invalid');
  const tried = new Set();
  const probe = async file => {
    tried.add(file);
    const entry = await metadata(['--literal-pathspecs', 'ls-tree', '-z', target, '--', file]);
    if (!entry) return null;
    const match = /^(100644|100755) blob ([a-f0-9]{40,64})\t([\s\S]+)\0$/.exec(entry);
    if (!match) throw dataError('internal_data_not_regular');
    if (match[3] !== file) throw dataError('internal_data_invalid');
    const boundedGit = { raw: args => args[0] === 'cat-file' && args[1] === 'blob'
      ? readOutput(directory, args, { maximum: GIT_SOURCE_MAX_BYTES, timeout: remaining() })
      : metadata(args) };
    // Read the immutable blob that ls-tree identified, preserving the existing source limit.
    return readGitSource(boundedGit, match[2]);
  };
  for (const file of candidates) {
    const source = await probe(file);
    if (source !== null) return source;
  }
  const primary = paths[0];
  if (!primary) return null;
  const head = (await metadata(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(head)) throw dataError('internal_data_invalid');
  // Ordinary edits are irrelevant here; request only actual rename records.
  const renamed = await metadata(['--literal-pathspecs', 'log', '--follow', '--find-renames', '--diff-filter=R',
    `--max-count=${MAX_RENAME_RECORDS + 1}`, '--format=', '--name-status', '-z', head, '--', primary]);
  if (renamed && !renamed.endsWith('\0')) throw dataError('internal_data_invalid');
  const fields = renamed.split('\0');
  let records = 0;
  for (let index = 0; index < fields.length;) {
    const status = fields[index++].replace(/^\n+/, '');
    if (!status) continue;
    if (!/^R\d{1,3}$/.test(status) || !fields[index] || !fields[index + 1]) throw dataError('internal_data_invalid');
    if (++records > MAX_RENAME_RECORDS) throw dataError('git_history_rename_limit');
    for (const file of [fields[index++], fields[index++]]) {
      if (!file.startsWith('MonaBase/')) continue;
      candidates.add(validate(file));
      if (candidates.size > MAX_HISTORICAL_PATHS) throw dataError('git_history_rename_limit');
    }
  }
  for (const file of candidates) {
    if (tried.has(file)) continue;
    const source = await probe(file);
    if (source !== null) return source;
  }
  return null;
}

module.exports = { readHistoryOutput, readHistoryPage, readHistoricalSource, historyPage,
  HISTORY_PAGE_SIZE, HISTORY_MAX_BYTES, MAX_RENAME_RECORDS, MAX_HISTORICAL_PATHS };
