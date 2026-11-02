// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createHash } = require('node:crypto');
function sourceFileName(name, signature, tableName) {
  if (typeof name !== 'string' || !name || /[\\/]/.test(name) || [...name].some(character => character.charCodeAt(0) < 32) || name === '.' || name === '..' || (signature !== undefined && typeof signature !== 'string')) throw new Error('Invalid source identity.');
  if (tableName !== undefined && (typeof tableName !== 'string' || !tableName || tableName.includes('\0'))) throw new Error('Invalid trigger table identity.');
  const label = Array.from(name.replace(/[^a-zA-Z0-9_-]/g, '_')).slice(0, 32).join('') || 'routine';
  return `${label}_${createHash('sha256').update(JSON.stringify(tableName !== undefined ? ['trigger-table-v1', tableName, name] : signature === undefined ? ['object-v2', name] : [name, signature])).digest('hex')}.sql`;
}
const canonicalGitDbType = value => typeof value === 'string' && /^(POSTGRES|POSTGRESQL)$/i.test(value) ? 'POSTGRESQL' : value;

// Associate an archived filename only when its DDL declares the requested identity.
function legacySourceMatches(source, { dbType, schema, objectType, objectName }) {
  const identifier = '"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$#]*';
  const type = objectType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const text = source.replace(/^\s*(?:(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)\s*)*/, '');
  const match = new RegExp(`^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:(?:FORCE|NOFORCE|EDITIONABLE|NONEDITIONABLE)\\s+)*${type}\\s+(${identifier})(?:\\s*\\.\\s*(${identifier}))?`, 'i').exec(text);
  if (!match) return false;
  const decode = name => name.startsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : canonicalGitDbType(dbType) === 'POSTGRESQL' ? name.toLowerCase() : name.toUpperCase();
  return decode(match[2] || match[1]) === objectName && (!match[2] || decode(match[1]) === schema);
}
module.exports = { sourceFileName, canonicalGitDbType, legacySourceMatches };
