// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');

const FILE_LIMITS = {
  sqlFileMaxMb: { default: 16, min: 1, max: 64 },
  erFileMaxMb: { default: 16, min: 1, max: 64 }
};
function normalizeFileLimits(settings = {}) {
  return Object.fromEntries(Object.entries(FILE_LIMITS).map(([key, rule]) => [key,
    Number.isInteger(settings[key]) && settings[key] >= rule.min && settings[key] <= rule.max ? settings[key] : rule.default]));
}
function readError(code, limitMiB) { return Object.assign(new Error(code), { code, limitMiB }); }

async function readBoundedBuffer(file, limitMiB, { privateFile = false, followSymlinks = false } = {}) {
  if (!Number.isInteger(limitMiB) || limitMiB < 1 || limitMiB > 64) throw new Error('Invalid file read limit.');
  const maximum = limitMiB * 1024 * 1024;
  if (followSymlinks) file = await fs.promises.realpath(file);
  const before = await fs.promises.lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw readError('file_read_not_regular', limitMiB);
  let handle;
  try {
    // Nonblocking/no-follow also protect a POSIX path changed to a FIFO or link before open.
    handle = await fs.promises.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const initial = await handle.stat();
    if (!initial.isFile() || initial.dev !== before.dev || initial.ino !== before.ino) throw readError('file_read_not_regular', limitMiB);
    if (privateFile && process.platform !== 'win32') await handle.chmod(0o600);
    if (initial.size > maximum) throw readError('file_read_too_large', limitMiB);
    const chunks = [];
    let size = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum - size + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > maximum) throw readError('file_read_too_large', limitMiB);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    if ((await handle.stat()).size > maximum) throw readError('file_read_too_large', limitMiB);
    return Buffer.concat(chunks, size);
  } catch (error) {
    if (['ELOOP', 'EISDIR'].includes(error.code)) throw readError('file_read_not_regular', limitMiB);
    throw error;
  } finally { if (handle) await handle.close(); }
}
async function readBoundedText(file, limitMiB, options) {
  return (await readBoundedBuffer(file, limitMiB, options)).toString('utf8');
}
module.exports = { FILE_LIMITS, normalizeFileLimits, readBoundedText, readBoundedBuffer };
