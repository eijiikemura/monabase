// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { readInternalBufferSync, assertDataSize } = require('./dataSafety');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

function atomicWriteJson(file, value) {
  const text = JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error('Cannot save an undefined JSON value.');
  assertDataSize(Buffer.byteLength(text));
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  let descriptor;
  let created = false;
  let failure;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    created = true;
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporary, file);
  } catch (error) { failure = error; }
  if (descriptor !== undefined) {
    try { fs.closeSync(descriptor); } catch (error) { failure ||= error; }
  }
  if (created) {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') failure ||= error; }
  }
  if (failure) throw failure;
}

function readJsonFile(file, validate = () => true) {
  const original = readInternalBufferSync(file);
  const text = original.toString('utf8');
  try {
    const value = JSON.parse(text);
    if (!validate(value)) throw new Error('Unexpected JSON structure.');
    return value;
  } catch {
    // Keep the original and one byte-for-byte recovery copy per corrupt version.
    const digest = createHash('sha256').update(original).digest('hex');
    const backup = `${file}.corrupt-${digest}.bak`;
    try {
      fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST' || fs.lstatSync(backup).isSymbolicLink() || !readInternalBufferSync(backup).equals(original)) throw error;
    }
    const error = new Error('Invalid JSON settings. The original file and a recovery copy have been preserved.');
    error.code = 'INVALID_JSON_SETTINGS';
    throw error;
  }
}

const isJsonObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
module.exports = { atomicWriteJson, readJsonFile, isJsonObject };
