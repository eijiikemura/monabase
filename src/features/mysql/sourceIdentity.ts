// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DatabaseObject } from '@/shared/types/objectTypes';

// Read only the CREATE header. Stored bodies may contain arbitrary semicolons;
// this validates the editor target and is deliberately not a SQL executor.
export function assertMysqlSourceTarget(source: string, object: DatabaseObject): void {
  let offset = 0;
  const next = (): { text: string; quoted: boolean } => {
    while (offset < source.length) {
      if (/\s/.test(source[offset])) { offset++; continue; }
      if (source.startsWith('--', offset) || source[offset] === '#') { const end = source.indexOf('\n', offset); offset = end < 0 ? source.length : end + 1; continue; }
      if (source.startsWith('/*', offset)) {
        if (source[offset + 2] === '!') throw new Error('Executable comments are not accepted in an AI definition.');
        const end = source.indexOf('*/', offset + 2); if (end < 0) throw new Error('Invalid source header.'); offset = end + 2; continue;
      }
      const quote = source[offset];
      if (['`', "'", '"'].includes(quote)) {
        offset++; let text = '';
        while (offset < source.length) {
          const char = source[offset++];
          if (char === quote) { if (source[offset] === quote) { text += quote; offset++; } else return { text, quoted: true }; }
          else if (char === '\\' && quote !== '`') { if (offset >= source.length) break; text += source[offset++]; }
          else text += char;
        }
        throw new Error('Invalid source header quote.');
      }
      const word = source.slice(offset).match(/^[\p{L}\p{N}_$]+/u)?.[0];
      if (word) { offset += word.length; return { text: word, quoted: false }; }
      return { text: source[offset++], quoted: false };
    }
    throw new Error('Incomplete source header.');
  };
  const keyword = (token: ReturnType<typeof next>, value: string) => !token.quoted && token.text.toUpperCase() === value;
  const expect = (value: string) => { if (!keyword(next(), value)) throw new Error('Invalid source header.'); };
  expect('CREATE');
  let token = next();
  if (keyword(token, 'OR')) { if (object.category !== 'VIEW') throw new Error('MySQL does not support OR REPLACE for this object category.'); expect('REPLACE'); token = next(); }
  for (let count = 0; count < 8; count++) {
    if (keyword(token, 'ALGORITHM')) { expect('='); next(); token = next(); }
    else if (keyword(token, 'DEFINER')) {
      expect('='); const user = next(); let following = next();
      if (keyword(user, 'CURRENT_USER')) {
        if (following.text === '(') { expect(')'); following = next(); }
      } else { if (following.text !== '@') throw new Error('Invalid DEFINER.'); next(); following = next(); }
      token = following;
    } else if (keyword(token, 'SQL')) { expect('SECURITY'); const mode = next(); if (!keyword(mode, 'DEFINER') && !keyword(mode, 'INVOKER')) throw new Error('Invalid SQL SECURITY.'); token = next(); }
    else break;
  }
  if (!keyword(token, object.category)) throw new Error('The AI definition changes the selected object category.');
  token = next();
  if (keyword(token, 'IF')) { expect('NOT'); expect('EXISTS'); token = next(); }
  let schema = object.schema, name = token.text;
  const following = next();
  if (following.text === '.') { schema = name; name = next().text; }
  if (schema !== object.schema || name !== object.name) throw new Error('The AI definition changes the selected schema or object name.');
}
