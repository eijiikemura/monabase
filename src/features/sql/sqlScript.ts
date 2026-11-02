// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export type SqlDialect = 'oracle' | 'postgresql';
interface Token { text: string; start: number; end: number; kind: 'word' | 'symbol' | 'quoted'; }
export interface SqlStatement { text: string; lineOffset: number; }

// Positions refer to the original script; comments and quoted bodies are never SQL separators.
function scan(source: string, dialect: SqlDialect): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const start = index;
    if (/\s/.test(source[index])) { index++; continue; }
    if (source.startsWith('--', index)) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end + 1; continue; }
    if (source.startsWith('/*', index)) {
      let depth = 1; index += 2;
      while (index < source.length && depth) {
        if (source.startsWith('/*', index) && dialect === 'postgresql') { depth++; index += 2; }
        else if (source.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      continue;
    }
    let kind: Token['kind'] = 'symbol';
    const dollar = dialect === 'postgresql' ? source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0] : undefined;
    const oracleQuote = dialect === 'oracle' ? source.slice(index).match(/^(?:n?q)'([^\s])/i)?.[0] : undefined;
    if (dollar) {
      kind = 'quoted'; const end = source.indexOf(dollar, index + dollar.length);
      index = end < 0 ? source.length : end + dollar.length;
    } else if (oracleQuote) {
      kind = 'quoted'; const opening = oracleQuote.at(-1)!;
      const closing: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
      const end = source.indexOf((closing[opening] ?? opening) + "'", index + oracleQuote.length);
      index = end < 0 ? source.length : end + 2;
    } else if (source[index] === "'" || source[index] === '"') {
      kind = 'quoted'; const quote = source[index++];
      const escaped = dialect === 'postgresql' && quote === "'" && /[eE]/.test(source[start - 1] ?? '') && (start < 2 || !/[\w$]/.test(source[start - 2]));
      while (index < source.length) {
        if (escaped && source[index] === '\\') { index += 2; continue; }
        if (source[index] === quote) {
          if (source[index + 1] === quote) { index += 2; continue; }
          index++; break;
        }
        index++;
      }
    } else if (/[\p{L}\p{N}_$#]/u.test(source[index])) {
      kind = 'word'; index++;
      while (index < source.length && /[\p{L}\p{N}_$#]/u.test(source[index])) index++;
    } else index++;
    tokens.push({ text: source.slice(start, index), start, end: index, kind });
  }
  return tokens;
}

// Share the same quote/comment boundaries with structured DDL readers.
export function tokenizeSql(source: string, dialect: SqlDialect) { return scan(source, dialect); }

function isTriggerRecord(tokens: Token[], index: number, dialect: SqlDialect): boolean {
  return dialect === 'oracle' && tokens[index + 2]?.text === '.' &&
    tokens.some(token => token.kind === 'word' && /^TRIGGER$/i.test(token.text));
}

export function findSqlBindNames(source: string, dialect: SqlDialect): string[] {
  const tokens = scan(source, dialect), names = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index], name = tokens[index + 1];
    if (token.kind === 'symbol' && token.text === ':' && source[token.start - 1] !== ':' && source[token.end] !== ':' &&
      name.kind === 'word' && name.start === token.end && !isTriggerRecord(tokens, index, dialect) && /^[\p{L}\p{N}_]+$/u.test(name.text)) names.add(name.text.toUpperCase());
  }
  return [...names];
}

export function replaceSqlBinds(source: string, values: Readonly<Record<string, string>>, dialect: SqlDialect): string {
  const tokens = scan(source, dialect), replacements = new Map(Object.entries(values).map(([key, value]) => [key.toUpperCase(), value]));
  let result = '', cursor = 0;
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index], name = tokens[index + 1];
    if (token.kind !== 'symbol' || token.text !== ':' || source[token.start - 1] === ':' || source[token.end] === ':' ||
      name.kind !== 'word' || name.start !== token.end || isTriggerRecord(tokens, index, dialect)) continue;
    const value = replacements.get(name.text.toUpperCase());
    if (value === undefined) continue;
    result += source.slice(cursor, token.start) + value;
    cursor = name.end; index++;
  }
  return result + source.slice(cursor);
}

export function splitSqlScript(source: string, dialect: SqlDialect): SqlStatement[] {
  const tokens = scan(source, dialect), statements: SqlStatement[] = [];
  let from = 0, statementTokens: Token[] = [], atomicDepth = 0, oracleBlock: boolean | undefined;
  const append = (end: number) => {
    if (!statementTokens.length) { from = end + 1; return; }
    const start = statementTokens[0].start;
    const text = source.slice(start, end).trim();
    if (text) statements.push({ text, lineOffset: source.slice(0, start).split('\n').length - 1 });
    statementTokens = []; from = end + 1; atomicDepth = 0; oracleBlock = undefined;
  };
  const isOracleBlock = () => {
    const words = statementTokens.filter(token => token.kind === 'word').slice(0, 8).map(token => token.text.toUpperCase());
    if (['BEGIN', 'DECLARE'].includes(words[0])) return true;
    if (words[0] !== 'CREATE') return false;
    const kind = words.findIndex(word => ['FUNCTION', 'PROCEDURE', 'TRIGGER', 'PACKAGE', 'TYPE'].includes(word));
    return kind >= 0 && (words[kind] !== 'TYPE' || words[kind + 1] === 'BODY');
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const lineStart = source.lastIndexOf('\n', token.start - 1) + 1;
    const lineEnd = source.indexOf('\n', token.end);
    const slashLine = token.kind === 'symbol' && token.text === '/' &&
      source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim() === '/';
    if (dialect === 'oracle' && slashLine) { append(token.start); continue; }
    if (dialect === 'postgresql' && token.kind === 'word') {
      const word = token.text.toUpperCase();
      if (word === 'BEGIN' && (atomicDepth > 0 || tokens[index + 1]?.text.toUpperCase() === 'ATOMIC')) atomicDepth++;
      else if (word === 'CASE' && atomicDepth > 0) atomicDepth++;
      else if (word === 'END' && atomicDepth > 0) atomicDepth--;
    }
    if (token.kind === 'symbol' && token.text === ';' && !atomicDepth && !(dialect === 'oracle' && (oracleBlock ??= isOracleBlock()))) {
      append(token.start);
    } else statementTokens.push(token);
  }
  if (from < source.length) append(source.length);
  return statements;
}
