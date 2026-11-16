// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { splitSqlScript, tokenizeSql } from '@/features/sql/sqlScript';
import { mysqlTableName } from '@/features/mysql/table/tableModel';

// Accept exactly one CREATE definition; always qualify its target before executing.
export function mysqlViewStatement(source: string, schema: string, name: string) {
  const statements = splitSqlScript(source, 'mysql');
  if (statements.length !== 1) throw new Error('Enter one CREATE VIEW definition for the selected view.');
  const text = statements[0].text, tokens = tokenizeSql(text, 'mysql');
  let index = 0;
  const word = (value: string) => tokens[index]?.kind === 'word' && tokens[index].text.toUpperCase() === value;
  const take = (value: string) => { if (!word(value)) return false; index++; return true; };
  const expect = (value: string) => { if (!take(value)) throw new Error('Invalid MySQL view definition.'); };
  const symbol = (value: string) => { if (tokens[index++]?.text !== value) throw new Error('Invalid MySQL view header.'); };
  const identifier = () => {
    const token = tokens[index++];
    if (token?.kind === 'word' && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(token.text)) return token.text;
    if (token?.kind === 'quoted' && token.text.startsWith('`')) return token.text.slice(1,-1).replaceAll('``','`');
    throw new Error('Invalid MySQL view identity.');
  };
  expect('CREATE'); const createEnd = tokens[index - 1].end;
  const replace = take('OR'); if (replace) expect('REPLACE');
  if (take('ALGORITHM')) { symbol('='); if (!take('UNDEFINED') && !take('MERGE') && !take('TEMPTABLE')) throw new Error('Invalid MySQL view algorithm.'); }
  if (take('DEFINER')) {
    symbol('=');
    if (take('CURRENT_USER')) { if (tokens[index]?.text === '(') { index++; symbol(')'); } }
    else { if (!tokens[index] || !['quoted','word'].includes(tokens[index++].kind)) throw new Error('Invalid view definer.'); symbol('@'); if (!tokens[index] || !['quoted','word'].includes(tokens[index++].kind)) throw new Error('Invalid view definer.'); }
  }
  if (take('SQL')) { expect('SECURITY'); if (!take('DEFINER') && !take('INVOKER')) throw new Error('Invalid view security mode.'); }
  expect('VIEW');
  const begin = tokens[index]?.start; let owner = schema, view = identifier();
  if (tokens[index]?.text === '.') { index++; owner = view; view = identifier(); }
  const end = tokens[index - 1].end;
  if (owner !== schema || view !== name) throw new Error('The definition changes the selected database or view name.');
  if (tokens[index]?.text === '(') { index++; identifier(); while (tokens[index]?.text === ',') { index++; identifier(); } symbol(')'); }
  expect('AS');
  if (!word('SELECT') && !word('WITH') && tokens[index]?.text !== '(') throw new Error('A view requires a SELECT query.');
  const qualified = text.slice(0, begin) + mysqlTableName(schema, name) + text.slice(end);
  return { sql: replace ? qualified : qualified.slice(0,createEnd) + ' OR REPLACE' + qualified.slice(createEnd), binds: {} };
}
