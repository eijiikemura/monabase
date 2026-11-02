// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { scanSql } = require('./sqlTokens');

function inspectTokens(tokens, dialect, budget) {
  if (!tokens.some(token => token.kind === 'word' && /^(?:password|identified|subscription|administer)$/i.test(token.text) || /^"password"$/i.test(token.text))) {
    return { sensitive: false, command: '' };
  }
  const word = index => tokens[index]?.kind === 'word' ? tokens[index].text.toUpperCase() : '';
  for (let index = 0; index < tokens.length; index++) {
    if (--budget.steps < 0) return privateDynamic();
    const verb = word(index);
    // Keystore operations may carry passwords, exported-key secrets or client secrets.
    if (dialect === 'oracle' && verb === 'ADMINISTER' && word(index + 1) === 'KEY' && word(index + 2) === 'MANAGEMENT') {
      return { sensitive: true, command: 'ADMINISTER KEY MANAGEMENT' };
    }
    if (!['CREATE', 'ALTER'].includes(verb)) continue;
    let object = index + 1;
    if (word(object) === 'OR' && word(object + 1) === 'REPLACE') object += 2;
    while (['PUBLIC', 'PRIVATE', 'SHARED'].includes(word(object))) object++;
    const kind = word(object), link = kind === 'DATABASE' && word(object + 1) === 'LINK';
    // Protect the whole conninfo clause, including URI passwords without a PASSWORD keyword.
    if (dialect === 'postgresql' && kind === 'SUBSCRIPTION' && word(object + 2) === 'CONNECTION') {
      return { sensitive: true, command: `${verb} SUBSCRIPTION` };
    }
    if (!['USER', 'ROLE', 'SERVER'].includes(kind) && !link) continue;
    const name = object + (link ? 2 : 1);
    for (let next = name + 1; next < tokens.length && tokens[next].text !== ';'; next++) {
      if (--budget.steps < 0) return privateDynamic();
      const passwordOption = word(next) === 'PASSWORD' || /^"password"$/i.test(tokens[next].text);
      if ((passwordOption && tokens[next + 1] && tokens[next + 1].text !== ';') ||
          (word(next) === 'IDENTIFIED' && word(next + 1) === 'BY')) {
        return { sensitive: true, command: `${verb} ${link ? 'DATABASE LINK' : kind}` };
      }
    }
  }
  return { sensitive: false, command: '' };
}

const privateDynamic = () => ({ sensitive: true, command: 'DYNAMIC SQL' });
const safe = () => ({ sensitive: false, command: '' });
const MAX_INSPECTION_CHARS = 2 * 1024 * 1024;
const MAX_INSPECTION_DEPTH = 8;

function literalText(token, escaped = false) {
  const text = token.text;
  if (text[0] === '"') return null;
  const dollar = text.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
  if (dollar) return text.endsWith(dollar) ? text.slice(dollar.length, -dollar.length) : null;
  if (/^[qQ]'/.test(text)) return text.length >= 5 ? text.slice(3, -2) : null;
  if (!text.startsWith("'") || !text.endsWith("'")) return null;
  let value = text.slice(1, -1).replace(/''/g, "'");
  if (escaped) {
    value = value.replace(/\\(U[0-9a-f]{8}|u[0-9a-f]{4}|x[0-9a-f]{1,2}|[0-7]{1,3}|[\s\S])/gi, (_, escape) => {
      if (/^[uUx]/.test(escape)) {
        const code = parseInt(escape.slice(1), 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
      if (/^[0-7]/.test(escape)) return String.fromCharCode(parseInt(escape, 8));
      return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[escape] ?? escape;
    });
  }
  return value;
}

function inspectDialect(source, dialect, budget, depth = 0, inheritedBlock = false) {
  if (depth > MAX_INSPECTION_DEPTH || source.length > budget.remaining) return privateDynamic();
  budget.remaining -= source.length;
  const tokens = scanSql(source, dialect);
  const direct = inspectTokens(tokens, dialect, budget);
  if (direct.sensitive) return direct;
  const word = index => tokens[index]?.kind === 'word' ? tokens[index].text.toUpperCase() : '';
  const block = inheritedBlock || tokens.some((token, index) => {
    if (token.kind !== 'word') return false;
    if (['DO', 'DECLARE', 'BEGIN'].includes(word(index)) && (index === 0 || tokens[index - 1].text === ';')) return true;
    if (word(index) !== 'CREATE') return false;
    let next = index + 1;
    if (word(next) === 'OR' && word(next + 1) === 'REPLACE') next += 2;
    while (['EDITIONABLE', 'NONEDITIONABLE'].includes(word(next))) next++;
    return ['FUNCTION', 'PROCEDURE', 'PACKAGE', 'TRIGGER'].includes(word(next));
  });
  if (!block) return safe();
  const literals = [];
  for (let index = 0; index < tokens.length; index++) {
    if (word(index) === 'DBMS_SQL' && tokens[index + 1]?.text === '.' && word(index + 2) === 'PARSE') return privateDynamic();
    if (word(index) === 'EXECUTE') {
      const argument = index + (word(index + 1) === 'IMMEDIATE' ? 2 : 1);
      const first = word(argument) === 'E' ? argument + 1 : argument;
      // Do not evaluate variables, functions, parameters, or arbitrary procedural code.
      if (tokens[first]?.kind !== 'quoted' || literalText(tokens[first]) === null) return privateDynamic();
      let next = first + 1;
      while (tokens[next]?.text === '|' && tokens[next + 1]?.text === '|') {
        next += 2;
        if (word(next) === 'E') next++;
        if (tokens[next]?.kind !== 'quoted' || literalText(tokens[next]) === null) return privateDynamic();
        next++;
      }
    }
    if (tokens[index].kind !== 'quoted') continue;
    const value = literalText(tokens[index], dialect === 'postgresql' && word(index - 1) === 'E');
    if (value === null) continue;
    literals.push(value);
    const result = inspectDialect(value, dialect, budget, depth + 1, true);
    if (result.sensitive) return result;
  }
  // Joining literal fragments catches split keywords without executing their expressions.
  for (const separator of ['', ' ']) {
    if (literals.length < 2) break;
    const combined = literals.join(separator);
    if (combined.length > budget.remaining) return privateDynamic();
    budget.remaining -= combined.length;
    const fragments = scanSql(combined, dialect);
    const result = inspectTokens(fragments, dialect, budget);
    if (result.sensitive) return result;
    const words = fragments.filter(token => token.kind === 'word').map(token => token.text.toUpperCase()).join(' ');
    if (/\b(?:CREATE|ALTER) (?:USER|ROLE|SERVER|(?:SHARED |PUBLIC |PRIVATE )*DATABASE LINK)\b/.test(words) &&
        /\bPASSWORD\b|\bIDENTIFIED BY\b/.test(words)) return privateDynamic();
  }
  return safe();
}

function inspectSqlPrivacy(source, dialect) {
  if (typeof source !== 'string' || dialect !== undefined && !['oracle', 'postgresql'].includes(dialect)) throw new Error('Invalid SQL privacy request.');
  // History entries have no dialect. Inspect both without guessing their source database.
  for (const candidate of dialect ? [dialect] : ['oracle', 'postgresql']) {
    const result = inspectDialect(source, candidate, { remaining: MAX_INSPECTION_CHARS, steps: MAX_INSPECTION_CHARS });
    if (result.sensitive) return result;
  }
  return { sensitive: false, command: '' };
}
module.exports = { inspectSqlPrivacy };
