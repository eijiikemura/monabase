// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const { readBoundedText } = require('./boundedFiles');
const { t } = require('../i18n');

const INTERNAL_FILE_MAX_MB = 64;
const INTERNAL_FILE_MAX_BYTES = INTERNAL_FILE_MAX_MB * 1024 * 1024;
const GIT_SOURCE_MAX_BYTES = 16 * 1024 * 1024;

function dataError(code) { return Object.assign(new Error(t(code)), { code }); }
function assertDataSize(size, maximum = INTERNAL_FILE_MAX_BYTES) {
  if (!Number.isSafeInteger(size) || size < 0 || size > maximum) throw dataError('internal_data_too_large');
}
function parsePrivateJson(text) {
  try { return JSON.parse(text); }
  catch { throw dataError('internal_data_invalid'); }
}
async function readInternalText(file, options) {
  try { return await readBoundedText(file, INTERNAL_FILE_MAX_MB, options); }
  catch (error) {
    if (error.code === 'file_read_too_large') throw dataError('internal_data_too_large');
    if (error.code === 'file_read_not_regular') throw dataError('internal_data_not_regular');
    throw error;
  }
}

// Preserve synchronous settings/history contracts, with bounded descriptor-based reads.
function readInternalBufferSync(file, maximum = INTERNAL_FILE_MAX_BYTES) {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > INTERNAL_FILE_MAX_BYTES) throw new Error('Invalid internal read limit.');
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink()) throw dataError('internal_data_not_regular');
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const initial = fs.fstatSync(descriptor);
    if (!initial.isFile() || initial.dev !== before.dev || initial.ino !== before.ino) throw dataError('internal_data_not_regular');
    assertDataSize(initial.size, maximum);
    const chunks = [];
    let size = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum - size + 1));
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count; assertDataSize(size, maximum);
      chunks.push(buffer.subarray(0, count));
    }
    assertDataSize(fs.fstatSync(descriptor).size, maximum);
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (['ELOOP', 'EISDIR'].includes(error.code)) throw dataError('internal_data_not_regular');
    throw error;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

function createReadBudget() {
  let size = 0;
  return bytes => { assertDataSize(bytes); size += bytes; assertDataSize(size); };
}
async function readGitSource(git, object, consume = createReadBudget(), maximum = GIT_SOURCE_MAX_BYTES) {
  // Resolve first: size, type and contents must refer to the same immutable object.
  const hash = /^[a-f0-9]{40,64}$/i.test(object) ? object : (await git.raw(['rev-parse', '--verify', object])).trim();
  if (!/^[a-f0-9]{40,64}$/i.test(hash)) throw dataError('internal_data_invalid');
  if ((await git.raw(['cat-file', '-t', hash])).trim() !== 'blob') throw dataError('internal_data_not_regular');
  const size = Number((await git.raw(['cat-file', '-s', hash])).trim());
  assertDataSize(size, maximum);
  consume(size);
  const text = await git.raw(['cat-file', 'blob', hash]);
  const actual = Buffer.byteLength(text);
  assertDataSize(actual, maximum);
  if (actual > size) consume(actual - size);
  return text;
}

module.exports = { createReadBudget, readGitSource, INTERNAL_FILE_MAX_BYTES, GIT_SOURCE_MAX_BYTES, assertDataSize, dataError,
  parsePrivateJson, readInternalText, readInternalBufferSync };
