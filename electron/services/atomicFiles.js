// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function atomicWriteFile(file, data) {
  // Resolve links before replacement so saving through a link still updates its target.
  let destination = path.resolve(file);
  let mode = 0o600;
  try {
    const status = fs.statSync(destination);
    if (!status.isFile()) throw new Error('The output destination must be a regular file.');
    destination = fs.realpathSync(destination);
    mode = status.mode & 0o777;
    if ((mode & 0o222) === 0) throw new Error('The output destination is read-only.');
    fs.accessSync(destination, fs.constants.W_OK);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Do not replace a dangling link with an unrelated regular file.
    try {
      if (fs.lstatSync(destination).isSymbolicLink()) throw new Error('The output link target does not exist.');
    } catch (linkError) { if (linkError.code !== 'ENOENT') throw linkError; }
  }
  const temporary = path.join(path.dirname(destination), `.monabase-export-${randomUUID()}.tmp`);
  let descriptor;
  let created = false;
  let failure;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, data);
    fs.fchmodSync(descriptor, mode);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    // Never unlink the destination first: a failed replacement must leave it intact.
    fs.renameSync(temporary, destination);
  } catch (error) { failure = error; }
  if (descriptor !== undefined) {
    try { fs.closeSync(descriptor); } catch (error) { failure ||= error; }
  }
  if (created) {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') failure ||= error; }
  }
  if (failure) throw failure;
}

module.exports = { atomicWriteFile };
