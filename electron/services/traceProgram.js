// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { scanSql } = require('./sqlTokens');

// Rename only the generated procedure declaration, never user code or quoted data.
function renameTraceProcedure(source, temporaryName, dialect) {
  const tokens = scanSql(source, dialect);
  let index = 0;
  const word = value => tokens[index]?.kind === 'word' && tokens[index].text.toUpperCase() === value;
  if (!word('CREATE')) throw new Error('Expected a generated trace procedure declaration.');
  index++;
  if (word('OR')) {
    index++;
    if (!word('REPLACE')) throw new Error('Invalid trace procedure declaration.');
    index++;
  }
  if (dialect === 'oracle' && (word('EDITIONABLE') || word('NONEDITIONABLE'))) index++;
  if (!word('PROCEDURE')) throw new Error('Expected a generated trace procedure declaration.');
  index++;
  const identifier = token => token?.kind === 'word' || (token?.kind === 'quoted' && token.text.startsWith('"'));
  if (identifier(tokens[index]) && tokens[index + 1]?.text === '.') index += 2;
  const name = tokens[index];
  if (!identifier(name) || !/^__placeholder__$/i.test(name.text.startsWith('"') ? name.text.slice(1, -1) : name.text)) {
    throw new Error('Generated trace procedure name placeholder is missing.');
  }
  const quotedName = `"${temporaryName.replaceAll('"', '""')}"`;
  return source.slice(0, name.start) + quotedName + source.slice(name.end);
}

module.exports = { renameTraceProcedure };
