// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface SqlToken { text: string; start: number; end: number; kind: 'word' | 'quoted' | 'string' | 'dollar' | 'symbol'; }

// Token positions always refer to the original source, including comments and newlines.
export function tokenizePgSql(source: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    if (/\s/.test(source[index])) { index++; continue; }
    if (source.startsWith('--', index)) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end + 1; continue; }
    if (source.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('Unterminated SQL comment.');
      continue;
    }
    let kind: SqlToken['kind'] = 'symbol';
    const character = source[index];
    const dollar = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      kind = 'dollar';
      const end = source.indexOf(dollar, index + dollar.length);
      if (end < 0) throw new Error('Unterminated dollar-quoted string.');
      index = end + dollar.length;
    } else if (character === "'" || character === '"') {
      kind = character === '"' ? 'quoted' : 'string';
      const escaped = character === "'" && start > 0 && /[eE]/.test(source[start - 1]) && (start < 2 || !/[\w$]/.test(source[start - 2]));
      index++;
      let closed = false;
      while (index < source.length) {
        if (escaped && source[index] === '\\') { index += 2; continue; }
        if (source[index] === character) {
          if (source[index + 1] === character) { index += 2; continue; }
          index++; closed = true; break;
        }
        index++;
      }
      if (!closed) throw new Error('Unterminated quoted SQL value.');
    } else if (/[\p{L}\p{N}_$]/u.test(character)) {
      kind = 'word'; index++;
      while (index < source.length && /[\p{L}\p{N}_$]/u.test(source[index])) index++;
    } else index++;
    tokens.push({ text: source.slice(start, index), start, end: index, kind });
  }
  return tokens;
}

export function pgRoutineInputTypes(source: string): string {
  const tokens = tokenizePgSql(source);
  const kind = tokens.findIndex(token => token.kind === 'word' && /^(FUNCTION|PROCEDURE)$/i.test(token.text));
  const open = tokens.findIndex((token, index) => index > kind && token.text === '(');
  if (kind < 0 || open < 0) throw new Error('Routine declaration requires an argument list.');
  const groups: SqlToken[][] = [];
  let current: SqlToken[] = [], depth = 1;
  for (let index = open + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.kind === 'symbol' && token.text === '(') depth++;
    if (token.kind === 'symbol' && token.text === ')') depth--;
    if (!depth) { if (current.length) groups.push(current); break; }
    if (depth === 1 && token.text === ',') { groups.push(current); current = []; }
    else current.push(token);
  }
  if (depth) throw new Error('Unterminated routine arguments.');
  return groups.flatMap(group => {
    if (/^OUT$/i.test(group[0]?.text)) return [];
    if (/^(IN|INOUT|VARIADIC)$/i.test(group[0]?.text)) group = group.slice(1);
    let nesting = 0;
    const end = group.findIndex(token => {
      if (token.text === '(') nesting++;
      if (token.text === ')') nesting--;
      return nesting === 0 && (token.text === '=' || (token.kind === 'word' && /^DEFAULT$/i.test(token.text)));
    });
    if (end >= 0) group = group.slice(0, end);
    const prefix = group.slice(0, 2).map(token => token.text.toUpperCase()).join(' ');
    const multiwordType = /^(DOUBLE PRECISION|CHARACTER VARYING|BIT VARYING|TIMESTAMP (WITH|WITHOUT)|TIME (WITH|WITHOUT)|NATIONAL CHARACTER)$/.test(prefix);
    if (group.length > 1 && ['word', 'quoted'].includes(group[1].kind) && !multiwordType) group = group.slice(1);
    if (!group.length) throw new Error('Missing routine argument type.');
    // Type modifiers do not participate in PostgreSQL routine identity.
    let modifierDepth = 0;
    group = group.filter(token => {
      if (token.text === '(') { modifierDepth++; return false; }
      if (token.text === ')') { modifierDepth--; return false; }
      return modifierDepth === 0;
    });
    return [group.map(token => token.text).join(' ')];
  }).join(', ');
}
