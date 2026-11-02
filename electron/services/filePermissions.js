// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function canonicalDestination(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw new Error('Invalid output path.');
  try {
    if (!fs.statSync(file).isFile()) throw new Error('The output destination must be a regular file.');
    return fs.realpathSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Reject dangling links instead of granting a different future target.
    try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid output link.'); }
    catch (linkError) { if (linkError.code !== 'ENOENT') throw linkError; }
    return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
  }
}

function createFilePermissions({ now = Date.now, lifetime = 15 * 60 * 1000 } = {}) {
  const grants = new Map();
  function issue(event, file) {
    if (!event?.sender || !event.senderFrame) throw new Error('Invalid file permission owner.');
    for (const [key, grant] of grants) if (grant.expires <= now()) grants.delete(key);
    if (grants.size >= 128) grants.delete(grants.keys().next().value);
    const token = randomUUID();
    grants.set(token, { sender: event.sender, frame: event.senderFrame, file: path.resolve(file), target: canonicalDestination(file), expires: now() + lifetime });
    return token;
  }
  function authorize(event, token, file) {
    const grant = grants.get(token);
    if (!grant || grant.expires <= now() || grant.sender !== event?.sender || grant.frame !== event?.senderFrame ||
        typeof file !== 'string' || path.resolve(file) !== grant.file || canonicalDestination(file) !== grant.target) {
      throw Object.assign(new Error('Select the output file again to authorize this save.'), { code: 'FILE_PERMISSION_REQUIRED' });
    }
    return grant.target;
  }
  return { issue, authorize };
}
module.exports = { createFilePermissions, canonicalDestination };
