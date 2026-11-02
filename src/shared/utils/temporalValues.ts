// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';

// Canonical database text is parsed without JavaScript Date or timezone conversion.
export function temporalParts(value: unknown) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(?:\s*(Z|[+-]\d{2}(?::?\d{2})?|[A-Za-z][A-Za-z0-9_+/-]*(?: [A-Za-z]{2,5})?))?)?$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', zone = ''] = match;
  const offset = zone === 'Z' ? '+00:00' : /^[+-]\d{2}$/.test(zone) ? `${zone}:00` : /^[+-]\d{4}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
  return { year, month, day, hour, minute, second, fraction, offset,
    zoneFormat: /^[A-Za-z]/.test(offset) ? (offset.includes(' ') ? 'TZR TZD' : 'TZR') : 'TZH:TZM',
    canonical: `${year}-${month}-${day}${hour ? ` ${hour}:${minute}:${second}${fraction}${offset ? ` ${offset}` : ''}` : ''}` };
}

// Accept configured calendar formats without converting exact values through Date.
export function canonicalTemporalInput(value: unknown, format: string): string | null {
  const canonical = temporalParts(value);
  if (canonical) return canonical.canonical;
  if (typeof value !== 'string' || !format) return null;
  const patterns: Record<string, string> = { YYYY: '(?<year>\\d{4})', YY: '(?<shortYear>\\d{2})',
    MMM: '(?<monthName>[A-Za-z]{3})', MM: '(?<month>\\d{2})', DD: '(?<day>\\d{2})',
    HH: '(?<hour>\\d{2})', mm: '(?<minute>\\d{2})', ss: '(?<second>\\d{2})(?<fraction>\\.\\d{1,9})?' };
  let pattern = '', end = 0;
  for (const match of format.matchAll(/YYYY|MMM|YY|MM|DD|HH|mm|ss/g)) {
    pattern += format.slice(end, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + patterns[match[0]];
    end = match.index + match[0].length;
  }
  pattern += format.slice(end).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const groups = new RegExp(`^${pattern}(?:\\s*(?<zone>Z|[+-]\\d{2}(?::?\\d{2})?))?$`, 'i').exec(value.trim())?.groups;
  if (!groups?.day || (!groups.year && !groups.shortYear)) return null;
  const names = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = groups.month ?? String(names.indexOf(groups.monthName?.toUpperCase()) + 1).padStart(2, '0');
  if (month === '00') return null;
  const year = groups.year ?? `${String(new Date().getFullYear()).slice(0, 2)}${groups.shortYear}`;
  return temporalParts(`${year}-${month}-${groups.day}${groups.hour ? ` ${groups.hour}:${groups.minute ?? '00'}:${groups.second ?? '00'}${groups.fraction ?? ''}${groups.zone ? ` ${groups.zone}` : ''}` : ''}`)?.canonical ?? null;
}

export const isTemporalColumn = (column: ColumnDefinition) => /^(DATE|TIMESTAMP(?:TZ)?)\b/i.test(column.DATA_TYPE);

export const isTimeColumn = (column: ColumnDefinition) => /^time(?:\(\d+\))?(?: with(?:out)? time zone)?$|^timetz$/i.test(column.DATA_TYPE.trim());

// TIME values have no calendar date. PostgreSQL validates their syntax and range on cast.
export function temporalValueSql(column: ColumnDefinition, value: unknown, database: 'oracle' | 'postgresql', format: string): string | null {
  if (database === 'postgresql' && isTimeColumn(column) && typeof value === 'string') {
    const type = /with time zone|timetz/i.test(column.DATA_TYPE) ? 'time with time zone' : 'time without time zone';
    return `CAST('${value.replace(/'/g, "''")}' AS ${type})`;
  }
  return canonicalTemporalSql(column, canonicalTemporalInput(value, format), database);
}

// Oracle Thin fetches ordinary timestamps through Date; explicit SQL conversion retains nanoseconds.
export function oracleColumnProjection(column: ColumnDefinition, alias = 't') {
  const name = `${alias}.${quoteIdentifier(column.COLUMN_NAME)}`;
  if (!isTemporalColumn(column)) return name;
  const type = column.DATA_TYPE.toUpperCase();
  const withZone = /TIME ZONE/.test(type);
  const expression = /LOCAL TIME ZONE/.test(type) ? `CAST(${name} AS TIMESTAMP WITH TIME ZONE)` : name;
  const format = type === 'DATE' ? 'YYYY-MM-DD HH24:MI:SS' : `YYYY-MM-DD HH24:MI:SS.FF9${withZone ? ' TZR TZD' : ''}`;
  const text = `TO_CHAR(${expression}, '${format}', 'NLS_DATE_LANGUAGE=English')`;
  return `${withZone ? `RTRIM(${text})` : text} AS ${quoteIdentifier(column.COLUMN_NAME)}`;
}

export function canonicalTemporalSql(column: ColumnDefinition, value: unknown, database: 'oracle' | 'postgresql'): string | null {
  const parts = temporalParts(value);
  if (!parts || !isTemporalColumn(column)) return null;
  const type = column.DATA_TYPE.toUpperCase();
  const text = `'${parts.canonical}'`;
  if (database === 'postgresql') {
    const cast = type === 'DATE' ? 'date' : /WITH TIME ZONE|TIMESTAMPTZ/.test(type) ? 'timestamp with time zone' : 'timestamp without time zone';
    return `CAST(${text} AS ${cast})`;
  }
  const format = `YYYY-MM-DD${parts.hour ? ` HH24:MI:SS${parts.fraction ? '.FF' : ''}${parts.offset ? ` ${parts.zoneFormat}` : ''}` : ''}`;
  if (type === 'DATE') return `TO_DATE(${text}, '${format}')`;
  return `${parts.offset ? 'TO_TIMESTAMP_TZ' : 'TO_TIMESTAMP'}(${text}, '${format}')`;
}
