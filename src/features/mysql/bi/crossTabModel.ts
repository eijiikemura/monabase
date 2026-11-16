// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { CastType, ColumnInfo } from '@/features/cross-tab/crossTabTypes';
import type { Condition } from '@/shared/types/queryConditions';
import { quoteMysql, mysqlTableName } from '@/features/mysql/table/tableModel';
import { canonicalTemporalInput, temporalParts } from '@/shared/utils/temporalValues';
import { finiteNumericSqlLiteral, compareNumericValues } from '@/shared/utils/numberValues';

export interface NumberGroup { enable: boolean; start: number; end: number; step: number; }
export interface CrossTabSettings {
  version: 1; dbType: 'mysql'; schema: string; objectType: 'TABLE' | 'VIEW'; selectedObject: string;
  rowField: string; rowCastType: CastType; rowDateFormat: string; rowDateGroup: string; rowNumGroup: NumberGroup;
  colField: string; colCastType: CastType; colDateFormat: string; colDateGroup: string; colNumGroup: NumberGroup;
  valField: string; aggType: 'SUM' | 'COUNT' | 'AVG' | 'MAX' | 'MIN'; conditions: Record<string, Condition>;
}
export const numericType = (type: string) => /^(TINYINT|SMALLINT|MEDIUMINT|INT|INTEGER|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|YEAR)$/i.test(type);
export const dateType = (type: string) => /^(DATE|DATETIME|TIMESTAMP)$/i.test(type);
export const scalarType = (type: string) => numericType(type) || dateType(type) || /^(CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT|ENUM|SET|TIME)$/i.test(type);
export const initialCast = (column?: ColumnInfo): CastType => column && dateType(column.type) ? 'NONE' : column && numericType(column.type) ? 'NUMBER' : 'STRING';
export const defaultNumberGroup = (): NumberGroup => ({ enable: false, start: 15, end: 48, step: 10 });
export const defaultConditions = (columns: ColumnInfo[]): Record<string, Condition> => Object.fromEntries(columns.map(column => [column.name, { operator: '=', value: '', sort: '', type: dateType(column.type) ? 'DATE' : numericType(column.type) ? 'NUMBER' : 'STRING' }]));
const fail = (): never => { throw new Error('mysql_cross_tab_invalid_settings'); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function mysqlDateFormat(format: string): string {
  if (!format || format.length > 100) return fail();
  const tokens: Record<string, string> = { YYYY: '%Y', YY: '%y', MMM: '%b', MM: '%m', DD: '%d', HH: '%H', mm: '%i', ss: '%s' };
  const residue = format.replace(/YYYY|MMM|YY|MM|DD|HH|mm|ss/g, '');
  if (/[^ /:.,_T-]/.test(residue) || !/YYYY|YY/.test(format) || (format.includes('DD') && !format.includes('MM'))) return fail();
  return format.replace(/YYYY|MMM|YY|MM|DD|HH|mm|ss/g, token => tokens[token]);
}
function validateNumberGroup(value: unknown): NumberGroup {
  if (!record(value) || typeof value.enable !== 'boolean' || ![value.start, value.end, value.step].every(n => typeof n === 'number' && Number.isSafeInteger(n))) return fail();
  const group = value as unknown as NumberGroup;
  if (group.enable && (group.step <= 0 || group.end < group.start || !Number.isSafeInteger(group.end - group.start) || !Number.isSafeInteger(group.end + group.step - 1))) return fail();
  return { ...group };
}
export function parseCrossTabSettings(value: unknown, columns: ColumnInfo[]): CrossTabSettings {
  if (!record(value) || value.version !== 1 || value.dbType !== 'mysql' || !['TABLE','VIEW'].includes(String(value.objectType)) || typeof value.schema !== 'string' || typeof value.selectedObject !== 'string') return fail();
  quoteMysql(value.schema); quoteMysql(value.selectedObject);
  const byName = new Map(columns.map(column => [column.name, column]));
  for (const axis of ['row','col']) {
    const column = byName.get(String(value[axis + 'Field'])), cast = value[axis + 'CastType'];
    if (!column || !['STRING','NUMBER','DATE','NONE'].includes(String(cast)) || (dateType(column.type) ? cast !== 'NONE' : cast === 'NONE') || !['NONE','YEAR','QUARTER','MONTH','DAY'].includes(String(value[axis + 'DateGroup'])) || typeof value[axis + 'DateFormat'] !== 'string') return fail();
    if (cast === 'DATE') mysqlDateFormat(value[axis + 'DateFormat'] as string);
    if (!['NONE','DATE'].includes(String(cast)) && value[axis + 'DateGroup'] !== 'NONE') return fail();
    const group = validateNumberGroup(value[axis + 'NumGroup']);
    if (group.enable && cast !== 'NUMBER') return fail();
  }
  const valColumn = byName.get(String(value.valField));
  if (!valColumn || !['SUM','COUNT','AVG','MAX','MIN'].includes(String(value.aggType)) || (['SUM','AVG'].includes(String(value.aggType)) && !numericType(valColumn.type))) return fail();
  if (!record(value.conditions)) return fail();
  const conditions: Record<string, Condition> = Object.create(null);
  for (const [name, condition] of Object.entries(value.conditions)) {
    if (!byName.has(name) || !record(condition) || !['STRING','NUMBER','DATE','DISABLED'].includes(String(condition.type)) || !['=','<>','<=','>=','LIKE'].includes(String(condition.operator)) || typeof condition.value !== 'string' || condition.value.length > 10000 || condition.sort !== '') return fail();
    conditions[name] = { type: String(condition.type), operator: String(condition.operator), value: condition.value, sort: '' };
  }
  return { version: 1, dbType: 'mysql', schema: value.schema, selectedObject: value.selectedObject, objectType: value.objectType as 'TABLE' | 'VIEW',
    rowField: String(value.rowField), rowCastType: value.rowCastType as CastType, rowDateFormat: String(value.rowDateFormat), rowDateGroup: String(value.rowDateGroup), rowNumGroup: validateNumberGroup(value.rowNumGroup),
    colField: String(value.colField), colCastType: value.colCastType as CastType, colDateFormat: String(value.colDateFormat), colDateGroup: String(value.colDateGroup), colNumGroup: validateNumberGroup(value.colNumGroup),
    valField: String(value.valField), aggType: value.aggType as CrossTabSettings['aggType'], conditions: { ...defaultConditions(columns), ...conditions } };
}
export function buildCrossTab(settings: CrossTabSettings, columns: ColumnInfo[], inputDateFormat: string) {
  const state = parseCrossTabSettings(settings, columns), binds: Record<string, unknown> = {}, checks: string[] = [];
  const bind = (value: unknown) => { const key = 'b' + Object.keys(binds).length; binds[key] = value; return ':' + key; };
  const clauses: string[] = [];
  for (const [name, condition] of Object.entries(state.conditions)) {
    if (condition.type === 'DISABLED' || !condition.value.trim()) continue;
    const column = quoteMysql(name), value = condition.value.trim();
    if (condition.operator === 'LIKE') { clauses.push(`CAST(${column} AS CHAR) LIKE ${bind('%' + value.replace(/[!%_]/g, '!$&') + '%')} ESCAPE '!'`); continue; }
    if (condition.type === 'NUMBER') {
      const numeric = finiteNumericSqlLiteral(value);
      // An exact numeric SQL literal avoids MySQL's string-to-double comparison coercion.
      clauses.push(`${column} ${condition.operator} ${numeric}`);
    } else if (condition.type === 'DATE') {
      const canonical = canonicalTemporalInput(value, inputDateFormat) ?? canonicalTemporalInput(value, inputDateFormat.split(' ')[0]);
      const parts = temporalParts(canonical);
      if (!parts || parts.offset || +parts.year < 1000 || +parts.year > 9999) return fail();
      const date = new Date(0); date.setUTCFullYear(+parts.year, +parts.month - 1, +parts.day);
      if (date.getUTCFullYear() !== +parts.year || date.getUTCMonth() !== +parts.month - 1 || date.getUTCDate() !== +parts.day || +(parts.hour || 0) > 23 || +(parts.minute || 0) > 59 || +(parts.second || 0) > 59) return fail();
      clauses.push(`${column} ${condition.operator} ${bind(canonical)}`);
    } else clauses.push(`${column} ${condition.operator} ${bind(value)}`);
  }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const axis = (side: 'row' | 'col') => {
    const name = state[side + 'Field' as 'rowField' | 'colField'], column = columns.find(column => column.name === name)!;
    const cast = state[side + 'CastType' as 'rowCastType' | 'colCastType'], dateGroup = state[side + 'DateGroup' as 'rowDateGroup' | 'colDateGroup'];
    const group = state[side + 'NumGroup' as 'rowNumGroup' | 'colNumGroup'];
    const original = quoteMysql(name); let base = original;
    if (cast === 'NUMBER' && !numericType(column.type)) {
      const text = `TRIM(CAST(${original} AS CHAR))`;
      checks.push(`${original} IS NOT NULL AND (NOT REGEXP_LIKE(${text}, ${bind('^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$')}) OR CHAR_LENGTH(SUBSTRING_INDEX(TRIM(LEADING '-' FROM TRIM(LEADING '+' FROM ${text})),'.',1)) > 35 OR (LOCATE('.',${text}) > 0 AND CHAR_LENGTH(SUBSTRING_INDEX(${text},'.',-1)) > 30))`);
      base = `CAST(${original} AS DECIMAL(65,30))`;
    } else if (cast === 'DATE') {
      const sourceFormat = state[side + 'DateFormat' as 'rowDateFormat' | 'colDateFormat'];
      const displayFormat = bind(mysqlDateFormat(sourceFormat));
      const suffix = !sourceFormat.includes('MM') ? '-01-01' : !sourceFormat.includes('DD') ? '-01' : '';
      const format = suffix ? bind(mysqlDateFormat(sourceFormat) + (suffix === '-01' ? '-%d' : '-%m-%d')) : displayFormat;
      base = `STR_TO_DATE(${suffix ? `CONCAT(CAST(${original} AS CHAR), '${suffix}')` : `CAST(${original} AS CHAR)`}, ${format})`;
      checks.push(`${original} IS NOT NULL AND (${base} IS NULL OR DATE_FORMAT(${base},${displayFormat}) <> TRIM(CAST(${original} AS CHAR)))`);
    } else if (cast === 'STRING') base = `CAST(${original} AS CHAR)`;
    if (['NONE','DATE'].includes(cast) && dateGroup !== 'NONE') {
      const expr = dateGroup === 'QUARTER' ? `CONCAT(YEAR(${base}), '-Q', QUARTER(${base}))` : `DATE_FORMAT(${base}, '${dateGroup === 'YEAR' ? '%Y' : dateGroup === 'MONTH' ? '%Y-%m' : '%Y-%m-%d'}')`;
      return { label: expr, sort: expr };
    }
    if (cast === 'NUMBER' && group.enable) {
      const start = bind(group.start), end = bind(group.end), step = bind(group.step), index = `FLOOR((${base} - ${start}) / ${step})`;
      return { label: `CASE WHEN ${base} < ${start} THEN CONCAT('<',${start}) WHEN ${base} > ${end} THEN CONCAT('>',${end}) ELSE CONCAT(${index} * ${step} + ${start}, '-', ${index} * ${step} + ${start} + ${step} - 1) END`,
        sort: `CASE WHEN ${base} < ${start} THEN -1 WHEN ${base} > ${end} THEN FLOOR((${end} - ${start}) / ${step}) + 1 ELSE ${index} END` };
    }
    return { label: `CAST(${base} AS CHAR)`, sort: base };
  };
  const row = axis('row'), col = axis('col'), source = mysqlTableName(state.schema, state.selectedObject);
  return { state, binds, validation: checks.length ? `SELECT 1 AS invalid FROM ${source} ${where} ${where ? 'AND' : 'WHERE'} (${checks.map(check => '(' + check + ')').join(' OR ')}) LIMIT 1` : null,
    distinct: `SELECT DISTINCT ${col.label} AS COL_VAL, ${col.sort} AS SORT_KEY FROM ${source} ${where} ${where ? 'AND' : 'WHERE'} ${col.label} IS NOT NULL ORDER BY SORT_KEY, COL_VAL LIMIT 201`,
    pivot: (categories: string[]) => {
      if (!categories.length || categories.length > 200 || new Set(categories).size !== categories.length) return fail();
      const values: Record<string, unknown> = { ...binds };
      const aggregates = categories.map((category, index) => { values['c' + index] = category; return `${state.aggType}(CASE WHEN q.COL_VALUE = :c${index} THEN q.VAL_VALUE END) AS ${quoteMysql('pivot_' + index)}`; });
      return { sql: `SELECT q.ROW_VALUE, q.ROW_SORT, ${aggregates.join(', ')} FROM (SELECT ${row.label} AS ROW_VALUE, ${row.sort} AS ROW_SORT, ${col.label} AS COL_VALUE, ${quoteMysql(state.valField)} AS VAL_VALUE FROM ${source} ${where}) q GROUP BY q.ROW_VALUE, q.ROW_SORT ORDER BY q.ROW_SORT, q.ROW_VALUE`, binds: values };
    }
  };
}
export function formatPivotNumber(value: unknown, format: string): string {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value), match = /^([+-]?)(\d+)(\.\d+)?$/.exec(text);
  if (!match) return text;
  const separator = ({ comma: ',', period: '.', space: ' ' } as Record<string, string>)[format];
  const whole = separator ? match[2].replace(/\B(?=(\d{3})+(?!\d))/g, separator) : match[2];
  return match[1] + whole + (match[3] || '');
}
export { compareNumericValues };
