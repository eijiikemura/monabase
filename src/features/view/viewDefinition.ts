// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { splitSqlScript, tokenizeSql, type SqlDialect } from '@/features/sql/sqlScript';

// Allow exactly one VIEW declaration for the opened identity. Other SQL belongs in the SQL window.
export function validateViewDefinition(source: string, database: SqlDialect, schema: string, name: string) {
  const statements = splitSqlScript(source, database);
  if (statements.length !== 1) throw new Error('view_target_definition_required');
  const statement = statements[0];
  const tokens = tokenizeSql(statement.text, database);
  let index = 0;
  const word = (value: string) => tokens[index]?.kind === 'word' && tokens[index].text.toUpperCase() === value;
  const consume = (value: string) => { if (!word(value)) return false; index++; return true; };
  if (!consume('CREATE')) throw new Error('view_target_definition_required');
  if (consume('OR') && !consume('REPLACE')) throw new Error('view_target_definition_required');
  if (database === 'oracle') {
    if (consume('NO')) { if (!consume('FORCE')) throw new Error('view_target_definition_required'); }
    else consume('FORCE');
    if (!consume('EDITIONABLE')) consume('NONEDITIONABLE');
  }
  if (!consume('VIEW')) throw new Error('view_target_definition_required');
  const identifier = () => {
    const token = tokens[index++];
    if (token?.kind === 'word' && /^[\p{L}_][\p{L}\p{N}_$#]*$/u.test(token.text)) return database === 'oracle' ? token.text.toUpperCase() : token.text.toLowerCase();
    if (token?.kind === 'quoted' && /^"(?:[^"]|"")+"$/.test(token.text)) return token.text.slice(1, -1).replaceAll('""', '"');
    throw new Error('view_target_definition_required');
  };
  // Require an explicit schema so the SQL cannot depend on a different session search path.
  const owner = identifier();
  if (tokens[index++]?.text !== '.') throw new Error('view_target_definition_required');
  const object = identifier();
  if (owner !== schema || object !== name) throw new Error('view_target_definition_required');
  if (!tokens.slice(index).some(token => token.kind === 'word' && token.text.toUpperCase() === 'AS')) throw new Error('view_target_definition_required');
  return statement;
}
