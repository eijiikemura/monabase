// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { tokenizeSql, type SqlDialect } from '@/features/sql/sqlScript';

// Rewrite executable references only; retain literal/comment text and original line positions.
export function rewriteTriggerTraceReferences(source: string, dialect: SqlDialect, options: {
  newAlias?: string; oldAlias?: string; dml: string; updatedColumns?: readonly string[];
}): string {
  const tokens = tokenizeSql(source, dialect);
  const aliases = new Map([['NEW', 'v_n'], ['OLD', 'v_o'],
    [(options.newAlias || 'NEW').toUpperCase(), 'v_n'], [(options.oldAlias || 'OLD').toUpperCase(), 'v_o']]);
  const identifier = (token: typeof tokens[number] | undefined) => {
    if (token?.kind === 'word') return token.text.toUpperCase();
    if (token?.text.startsWith('"')) {
      const value = token.text.slice(1, -1).replaceAll('""', '"');
      if (dialect === 'oracle' && value === value.toUpperCase()) return value;
      if (dialect === 'postgresql' && ['new', 'old'].includes(value)) return value.toUpperCase();
    }
    return undefined;
  };
  let result = '', cursor = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const aliasToken = dialect === 'oracle' && token.text === ':' ? tokens[index + 1] : token;
    const alias = identifier(aliasToken);
    const dot = tokens[index + (dialect === 'oracle' ? 2 : 1)];
    if ((dialect !== 'oracle' || (token.text === ':' && aliasToken?.start === token.end)) && alias && aliases.has(alias) && dot?.text === '.' && tokens[index - 1]?.text !== '.') {
      result += source.slice(cursor, token.start) + aliases.get(alias);
      cursor = aliasToken!.end;
      if (dialect === 'oracle') index++;
    } else if (dialect === 'oracle' && token.kind === 'word' && tokens[index - 1]?.text !== '.' && /^(INSERTING|UPDATING|DELETING)$/i.test(token.text)) {
      const event = { INSERTING: 'INSERT', UPDATING: 'UPDATE', DELETING: 'DELETE' }[token.text.toUpperCase()];
      if (event === 'UPDATE' && tokens[index + 1]?.text === '(') {
        let depth = 0, end = index + 1;
        for (; end < tokens.length; end++) {
          if (tokens[end].text === '(') depth++;
          if (tokens[end].text === ')' && --depth === 0) break;
        }
        // Leave malformed syntax for the database's normal compilation diagnostics.
        if (end === tokens.length) continue;
        const columns = options.dml === 'UPDATE' ? options.updatedColumns || [] : [];
        const args = rewriteTriggerTraceReferences(source.slice(token.end, tokens[end].end), dialect, options);
        const rewritten = columns.length
          ? `(CASE WHEN UPPER${args} IN (${columns.map(column => `'${column.toUpperCase().replaceAll("'", "''")}'`).join(', ')}) THEN 1 ELSE 0 END = 1)`
          : `(CASE WHEN UPPER${args} IS NULL THEN 0 ELSE 0 END = 1)`;
        result += source.slice(cursor, token.start) + rewritten;
        cursor = tokens[end].end;
        index = end;
        continue;
      }
      result += source.slice(cursor, token.start) + (event === options.dml ? 'TRUE' : 'FALSE');
      cursor = token.end;
    }
  }
  return result + source.slice(cursor);
}
