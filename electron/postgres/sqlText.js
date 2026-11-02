// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { scanSql } = require('../services/sqlTokens');

function bindSql(source, binds = {}) {
  if (Array.isArray(binds)) return { text: source, values: binds };
  const tokens = scanSql(source), values = [], positions = new Map();
  let text = '', cursor = 0;
  for (let index = 0; index < tokens.length - 1; index++) {
    const token = tokens[index], name = tokens[index + 1];
    if (token.text !== ':' || token.kind !== 'symbol' || source[token.start - 1] === ':' || source[token.end] === ':' ||
        name.start !== token.end || name.kind !== 'word' || !binds || !Object.hasOwn(binds, name.text)) continue;
    if (!positions.has(name.text)) { values.push(binds[name.text]); positions.set(name.text, values.length); }
    text += source.slice(cursor, token.start) + `$${positions.get(name.text)}`;
    cursor = name.end;
    index++;
  }
  return { text: text + source.slice(cursor), values };
}

function classifySql(source) {
  const tokens = scanSql(source);
  const statements = [[]];
  for (const token of tokens) {
    if (token.kind === 'symbol' && token.text === ';') {
      if (statements.at(-1).length) statements.push([]);
    } else statements.at(-1).push(token);
  }
  const commands = statements.filter(statement => statement.length).map(statement => statement[0].text.toUpperCase());
  const firstWord = commands[0] || '';
  const ordinary = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'WITH', 'VALUES', 'EXPLAIN', 'FETCH', 'MOVE']);
  const isDml = ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(firstWord) ||
    (firstWord === 'WITH' && tokens.some(token => token.kind === 'word' && /^(INSERT|UPDATE|DELETE|MERGE)$/i.test(token.text)));
  return { firstWord, isDml, canUseSavepoint: commands.length > 0 && commands.every(command => ordinary.has(command)) };
}

module.exports = { bindSql, classifySql };
