// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnRule } from './generatorTypes';
import { sequenceValue } from './generatorValidation';
import { postgresColumnKind, type PostgresColumnKind } from '@/features/postgresql/columnTypes';
import { finiteNumericSqlLiteral } from '@/shared/utils/numberValues';
import { canonicalTemporalInput, canonicalTemporalSql, temporalParts, temporalValueSql } from '@/shared/utils/temporalValues';
import { sqlString } from '@/features/table/searchConditions';

type Database = 'oracle' | 'postgresql';
export function generatorColumnKind(rule: Pick<ColumnRule, 'DATA_TYPE' | 'PG_TYPE_SCHEMA' | 'PG_TYPE_KIND' | 'PG_TYPE_CATEGORY'>, database: Database): PostgresColumnKind {
  if (database === 'postgresql') return postgresColumnKind({ COLUMN_NAME: '', ...rule });
  const type = rule.DATA_TYPE.trim().toUpperCase();
  if (/^(?:NUMBER|FLOAT|INTEGER|DECIMAL|BINARY_FLOAT|BINARY_DOUBLE)(?:\([^)]*\))?$/.test(type)) return 'number';
  if (type === 'DATE') return 'date';
  if (/^TIMESTAMP(?:\(\d+\))?(?: WITH (?:LOCAL )?TIME ZONE)?$/.test(type)) return 'timestamp';
  if (/^(?:VARCHAR2|NVARCHAR2|CHAR|NCHAR)(?:\([^)]*\))?$/.test(type)) return 'text';
  return 'other';
}

function timeParts(value: unknown) {
  const match = /^(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(?:\s*(Z|[+-]\d{2}:\d{2}))?$/.exec(String(value).trim());
  if (!match || +match[1] > 23 || +match[2] > 59 || +match[3] > 59) throw new Error('Invalid time value.');
  if (match[5] && match[5] !== 'Z' && (+match[5].slice(1, 3) > 15 || +match[5].slice(4) > 59)) throw new Error('Invalid time zone offset.');
  return { seconds: +match[1] * 3600 + +match[2] * 60 + +match[3], fraction: match[4] || '', zone: match[5] || '' };
}
function timeRange(rule: ColumnRule) {
  const first = timeParts(rule.randDateMin), last = timeParts(rule.randDateMax);
  if (first.zone || last.zone || first.fraction || last.fraction || first.seconds > last.seconds) throw new Error('Invalid time generation range.');
  return [first.seconds, last.seconds];
}
export function generatedTimeValue(rule: ColumnRule, random: number): string {
  const [first, last] = timeRange(rule);
  const seconds = first + Math.floor(random * (last - first + 1));
  const pad = (value: number) => String(value).padStart(2, '0');
  return pad(Math.floor(seconds / 3600)) + ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60) +
    (/with time zone|timetz/i.test(rule.DATA_TYPE) ? '+00:00' : '');
}

// All values are data literals. Arbitrary expressions belong in the SQL editor.
export function generatorValueSql(rule: ColumnRule, value: unknown, database: Database, inputFormat: string): string {
  if (value === null) return 'NULL';
  const kind = generatorColumnKind(rule, database);
  if (kind === 'number') return finiteNumericSqlLiteral(value);
  if (kind === 'text') return sqlString(String(value));
  if (kind === 'time') {
    const parts = timeParts(value);
    if (parts.zone && !/with time zone|timetz/i.test(rule.DATA_TYPE)) throw new Error('A plain time column cannot retain a time zone.');
    const sql = temporalValueSql(rule, String(value).trim(), database, inputFormat);
    if (sql) return sql;
    throw new Error('Unsupported time column.');
  }
  if (kind === 'date' || kind === 'timestamp') {
    const canonical = canonicalTemporalInput(value, inputFormat) ??
      canonicalTemporalInput(value, inputFormat.split(' ')[0]);
    const parts = temporalParts(canonical);
    if (!parts) throw new Error('Invalid date or timestamp value.');
    const calendar = new Date(0);
    calendar.setUTCFullYear(+parts.year, +parts.month - 1, +parts.day);
    if (+parts.year < 1 || calendar.getUTCFullYear() !== +parts.year || calendar.getUTCMonth() !== +parts.month - 1 ||
        calendar.getUTCDate() !== +parts.day || +(parts.hour ?? 0) > 23 || +(parts.minute ?? 0) > 59 || +(parts.second ?? 0) > 59) {
      throw new Error('Invalid calendar value.');
    }
    if (database === 'oracle' && kind === 'date' && (parts.fraction || parts.offset)) throw new Error('Oracle DATE cannot retain fractional seconds or a time zone.');
    const sql = canonicalTemporalSql(rule, canonical, database);
    if (sql) return sql;
  }
  throw new Error('Unsupported column type for data generation.');
}

export function validateGeneratorRuleValues(rule: ColumnRule, count: number, database: Database, inputFormat: string) {
  const kind = generatorColumnKind(rule, database);
  if (rule.ruleType === 'UNSPECIFIED') return;
  if (kind === 'other' || kind === 'binary' || kind === 'boolean') throw new Error('Unsupported generation type.');
  if (kind === 'number' && !['SEQ_NUM', 'RANDOM_NUM', 'FIXED', 'CHOICE'].includes(rule.ruleType)) throw new Error('A numeric generation rule is required.');
  if (['date', 'timestamp'].includes(kind) && !['SEQ_DATE', 'RANDOM_DATE', 'FIXED', 'CHOICE'].includes(rule.ruleType)) throw new Error('A date generation rule is required.');
  if (kind === 'time' && !['RANDOM_DATE', 'FIXED', 'CHOICE'].includes(rule.ruleType)) throw new Error('A time generation rule is required.');
  if (rule.ruleType === 'FIXED') generatorValueSql(rule, rule.fixedValue, database, inputFormat);
  if (rule.ruleType === 'CHOICE') {
    for (const value of rule.choiceValues.split(',').map(value => value.trim()).filter(Boolean)) generatorValueSql(rule, value, database, inputFormat);
  }
  if (kind === 'time' && rule.ruleType === 'RANDOM_DATE') timeRange(rule);
  if (kind === 'number' && rule.ruleType === 'SEQ_NUM') {
    for (const index of [0, count - 1]) {
      let value = sequenceValue(rule.seqStart, rule.seqStep, index);
      if (rule.seqPadZero && rule.DATA_LENGTH) value = value.padStart(rule.DATA_LENGTH, '0');
      generatorValueSql(rule, rule.seqPrefix + value, database, inputFormat);
    }
  }
}
