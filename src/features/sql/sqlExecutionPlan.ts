// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { findSqlBindNames, replaceSqlBinds, tokenizeSql, type SqlDialect } from './sqlScript';
import { finiteNumericSqlLiteral } from '@/shared/utils/numberValues';
import { canonicalTemporalInput, temporalParts } from '@/shared/utils/temporalValues';

// Only placeholders and type conversions enter SQL; user values travel as separate binds.
export function prepareSqlStatement(sql: string, dialect: SqlDialect, values: Record<string, string>, types: Record<string, string>, dateFormat: string, ignore = false) {
  if (ignore) return { sql, binds: {} };
  const binds: Record<string, string | null> = {}, replacements: Record<string, string> = {};
  findSqlBindNames(sql, dialect).forEach((name, index) => {
    const key = `mb_input_${index}`, placeholder = `:${key}`, value = values[name], type = types[name] || 'STRING';
    if (!['STRING', 'NUMBER', 'DATE'].includes(type)) throw new Error('sql_invalid_bind_type');
    binds[key] = value === undefined || value === '' ? null : value;
    if (type === 'NUMBER') {
      if (binds[key] !== null) binds[key] = finiteNumericSqlLiteral(value);
      replacements[name] = `CAST(${placeholder} AS ${dialect === 'oracle' ? 'NUMBER' : 'NUMERIC'})`;
    } else if (type === 'DATE') {
      const canonical = binds[key] === null ? null : canonicalTemporalInput(value, dateFormat);
      if (binds[key] !== null && !canonical) throw new Error('sql_invalid_bind_date');
      binds[key] = canonical;
      const parts = temporalParts(canonical);
      if (parts) {
        const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
          (parts.hour && (Number(parts.hour) > 23 || Number(parts.minute) > 59 || Number(parts.second) > 59))) throw new Error('sql_invalid_bind_date');
      }
      if (dialect === 'postgresql') replacements[name] = `CAST(${placeholder} AS ${parts?.offset ? 'timestamp with time zone' : 'timestamp'})`;
      else if (parts?.fraction || parts?.offset) {
        replacements[name] = `${parts.offset ? 'TO_TIMESTAMP_TZ' : 'TO_TIMESTAMP'}(${placeholder}, 'YYYY-MM-DD HH24:MI:SS${parts.fraction ? '.FF' : ''}${parts.offset ? ` ${parts.zoneFormat}` : ''}')`;
      } else replacements[name] = `TO_DATE(${placeholder}, 'YYYY-MM-DD${parts?.hour ? ' HH24:MI:SS' : ''}')`;
    } else replacements[name] = placeholder;
  });
  return { sql: replaceSqlBinds(sql, replacements, dialect), binds };
}

export function parseDdlAction(source: string, dialect: SqlDialect): { schema?: string; objType: string } | null {
  const tokens = tokenizeSql(source, dialect);
  let index = 0;
  const word = () => tokens[index]?.kind === 'word' ? tokens[index].text.toUpperCase() : '';
  if (!['CREATE', 'ALTER', 'DROP'].includes(word())) return null;
  index++;
  if (word() === 'OR') { index++; if (word() !== 'REPLACE') return null; index++; }
  while (['NO', 'FORCE', 'EDITIONABLE', 'NONEDITIONABLE', 'UNIQUE', 'BITMAP', 'PUBLIC', 'PRIVATE', 'TEMP', 'TEMPORARY', 'UNLOGGED'].includes(word())) index++;
  let objType = word();
  if (objType === 'MATERIALIZED') { index++; if (word() !== 'VIEW') return null; objType = 'MATERIALIZED VIEW'; }
  if (!['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'TRIGGER', 'TYPE', 'INDEX', 'SYNONYM', 'SCHEMA'].includes(objType)) return null;
  index++;
  if (objType === 'MATERIALIZED VIEW' && word() === 'LOG') { objType = 'MATERIALIZED VIEW LOG'; index++; if (word() === 'ON') index++; }
  if (['PACKAGE', 'TYPE'].includes(objType) && word() === 'BODY') index++;
  if (word() === 'IF') { index++; if (word() === 'NOT') index++; if (word() !== 'EXISTS') return null; index++; }
  const identifier = () => {
    const token = tokens[index++];
    if (token?.kind === 'quoted' && token.text.startsWith('"')) return token.text.slice(1, -1).replace(/""/g, '"');
    if (token?.kind === 'word') return dialect === 'oracle' ? token.text.toUpperCase() : token.text.toLowerCase();
    return null;
  };
  const first = identifier();
  if (!first) return null;
  if (objType === 'SCHEMA') return { schema: first, objType };
  if (tokens[index]?.text === '.') { index++; if (!identifier()) return null; return { schema: first, objType }; }
  return { objType };
}
