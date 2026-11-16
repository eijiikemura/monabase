// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnRule } from '@/features/data-generator/generatorTypes';
import type { GeneratedRow } from '@/features/data-generator/useGenerationWorkflow';
import { generatorValueSql, validateGeneratorRuleValues } from '@/features/data-generator/generatorSql';
import { sequenceValue } from '@/features/data-generator/generatorValidation';
import { canonicalTemporalInput, temporalParts } from '@/shared/utils/temporalValues';
import { mysqlTableName, quoteMysql } from '@/features/mysql/table/tableModel';

export interface MysqlGeneratorColumn {
  COLUMN_NAME: string; DATA_TYPE: string; COLUMN_TYPE: string; CHARACTER_MAXIMUM_LENGTH: string | number | null;
  NUMERIC_PRECISION: string | number | null; NUMERIC_SCALE: string | number | null; DATETIME_PRECISION: string | number | null;
  IS_NULLABLE: string; COLUMN_DEFAULT: unknown; EXTRA: string; GENERATION_EXPRESSION: string;
}
export interface MysqlGeneratorRule extends ColumnRule { MYSQL_COLUMN_TYPE?: string; }
export function columnRules(columns: MysqlGeneratorColumn[], unique: Set<string>): MysqlGeneratorRule[] {
  return columns.map(column => {
    const type = column.DATA_TYPE.toUpperCase(), number = /^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)$/.test(type);
    const text = /^(CHAR|VARCHAR|TINYTEXT|TEXT|MEDIUMTEXT|LONGTEXT)$/.test(type), date = /^(DATE|DATETIME|TIMESTAMP|TIME)$/.test(type);
    const disabled = Boolean(column.GENERATION_EXPRESSION) || /auto_increment/i.test(column.EXTRA) || !number && !text && !date;
    return { COLUMN_NAME: column.COLUMN_NAME, DATA_TYPE: type, MYSQL_COLUMN_TYPE: column.COLUMN_TYPE,
      generationExclusion: /auto_increment/i.test(column.EXTRA) ? 'auto_increment' : column.GENERATION_EXPRESSION ? 'generated' : undefined,
      DATA_LENGTH: Number(column.CHARACTER_MAXIMUM_LENGTH || column.NUMERIC_PRECISION || 0),
      DATA_PRECISION: Number(column.NUMERIC_PRECISION || 0), DATA_SCALE: Number(date ? column.DATETIME_PRECISION || 0 : column.NUMERIC_SCALE || 0), NULLABLE: column.IS_NULLABLE === 'YES' ? 'Y' : 'N',
      ruleType: disabled ? 'DISABLED' : number ? unique.has(column.COLUMN_NAME) ? 'SEQ_NUM' : 'RANDOM_NUM' : text ? 'RANDOM_CHAR' : 'RANDOM_DATE',
      nullRatio: 0, seqStart: 1, seqStep: 1, seqPadZero: false, seqPrefix: '', seqStartDate: '2026/01/01',
      randNumMin: 0, randNumMax: type === 'TINYINT' ? 100 : 1000, randNumRound: 1, randNumUnique: false,
      randCharType: unique.has(column.COLUMN_NAME) ? 'ALPHANUM' : 'ALPHA', randCharFill: false, randCharUnique: unique.has(column.COLUMN_NAME), randCharRegex: '',
      randDateMin: type === 'TIME' ? '00:00:00' : '2020/01/01', randDateMax: type === 'TIME' ? '23:59:59' : '2030/12/31', randDateIncludeTime: false, randDateUnique: unique.has(column.COLUMN_NAME), choiceValues: '', fixedValue: '' };
  });
}
function portable(rule: ColumnRule): ColumnRule {
  return { ...rule, DATA_TYPE: /^(TINYINT|SMALLINT|MEDIUMINT|INT|BIGINT|DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL)$/.test(rule.DATA_TYPE) ? 'NUMBER' : /^(CHAR|VARCHAR|.*TEXT)$/.test(rule.DATA_TYPE) ? 'VARCHAR2' : rule.DATA_TYPE === 'DATETIME' ? 'TIMESTAMP' : rule.DATA_TYPE };
}
export function mysqlGeneratedValue(rule: MysqlGeneratorRule, value: unknown, inputFormat: string): string | null {
  if (value === null) { if (rule.NULLABLE === 'N') throw new Error('A required column cannot be NULL.'); return null; }
  const type = rule.DATA_TYPE, converted = portable(rule);
  if (converted.DATA_TYPE === 'NUMBER') {
    const canonical = sequenceValue(value, 0, 0);
    const integerBits: Record<string, number> = { TINYINT: 8, SMALLINT: 16, MEDIUMINT: 24, INT: 32, BIGINT: 64 };
    const unsigned = /\bunsigned\b/i.test(rule.MYSQL_COLUMN_TYPE || '');
    if (unsigned && canonical.startsWith('-')) throw new Error('An unsigned value cannot be negative.');
    if (Object.hasOwn(integerBits, type)) {
      if (canonical.includes('.')) throw new Error('An integer value is required.');
      const bits = BigInt(integerBits[type]), n = BigInt(canonical);
      if (n < (unsigned ? 0n : -(1n << (bits - 1n))) || n > (1n << (unsigned ? bits : bits - 1n)) - 1n) throw new Error('The generated integer is out of range.');
    }
    if (['DECIMAL', 'NUMERIC'].includes(type)) {
      const [whole, fraction = ''] = canonical.replace('-', '').split('.');
      if (whole.replace(/^0+/, '').length > Number(rule.DATA_PRECISION) - Number(rule.DATA_SCALE) || fraction.length > Number(rule.DATA_SCALE)) throw new Error('The generated decimal exceeds its precision or scale.');
    }
    if (['FLOAT', 'DOUBLE', 'REAL'].includes(type) && !Number.isFinite(Number(canonical))) throw new Error('The generated floating point value is out of range.');
    return canonical;
  }
  if (converted.DATA_TYPE === 'VARCHAR2') {
    const text = String(value); if (rule.ruleType === 'RANDOM_CHAR' && rule.randCharType === 'REGEX' && !new RegExp(rule.randCharRegex).test(text)) throw new Error('The generated text does not match its regular expression.'); if ([...text].length > rule.DATA_LENGTH) throw new Error('The generated text exceeds the column length.'); return text;
  }
  if (['DATE', 'DATETIME', 'TIMESTAMP'].includes(type)) {
    const canonical = canonicalTemporalInput(value, inputFormat) || canonicalTemporalInput(value, inputFormat.split(' ')[0]);
    const parts = temporalParts(canonical);
    if (!parts || parts.offset || Number(parts.year) < 1000 || Number(parts.year) > 9999 || (parts.fraction?.slice(1).length || 0) > Number(rule.DATA_SCALE || 0)) throw new Error('The generated date cannot be represented by this MySQL column.');
    if (type === 'DATE' && [parts.hour, parts.minute, parts.second].some(part => Number(part || 0) !== 0)) throw new Error('MySQL DATE cannot retain a time of day.');
    if (type === 'TIMESTAMP' && (Number(parts.year) < 1970 || Number(parts.year) > 2038)) throw new Error('The generated TIMESTAMP is outside the MySQL range.');
    generatorValueSql(converted, value, 'oracle', inputFormat);
    return type === 'DATE' ? canonical!.slice(0, 10) : canonical!;
  }
  if (type === 'TIME') {
    generatorValueSql({ ...rule, DATA_TYPE: 'time without time zone' }, value, 'postgresql', inputFormat);
    const text = String(value); if (/[+Z]/i.test(text) || (text.split('.')[1]?.length || 0) > Number(rule.DATA_SCALE || 0)) throw new Error('The generated time cannot retain its precision or time zone.'); return text;
  }
  throw new Error('Unsupported MySQL generation type.');
}
export function validateMysqlRule(rule: ColumnRule, count: number, inputFormat: string) {
  if (rule.ruleType === 'UNSPECIFIED') return;
  const normalized = portable(rule);
  validateGeneratorRuleValues(normalized, count, rule.DATA_TYPE === 'TIME' ? 'postgresql' : 'oracle', inputFormat);
  if (rule.ruleType === 'SEQ_NUM') for (const index of [0, count - 1]) mysqlGeneratedValue(rule, rule.seqPrefix + sequenceValue(rule.seqStart, rule.seqStep, index), inputFormat);
  if (rule.ruleType === 'RANDOM_NUM') for (const value of [rule.randNumMin, rule.randNumMax, rule.randNumRound]) mysqlGeneratedValue(rule, value, inputFormat);
  if (rule.ruleType === 'FIXED') mysqlGeneratedValue(rule, rule.fixedValue, inputFormat);
  if (rule.ruleType === 'CHOICE') rule.choiceValues.split(',').map(value => value.trim()).filter(Boolean).forEach(value => mysqlGeneratedValue(rule, value, inputFormat));
}
export function generatorInsert(schema: string, table: string, rows: GeneratedRow[], rules: ColumnRule[], inputFormat: string) {
  const included = rules.filter(rule => !['DISABLED', 'UNSPECIFIED'].includes(rule.ruleType));
  if (!included.length || !rows.length || included.length * rows.length > 1000) throw new Error('Invalid MySQL generation batch.');
  const binds: Record<string, unknown> = {};
  const values = rows.map((row, index) => '(' + included.map((rule, column) => {
    const name = `g_${index}_${column}`; binds[name] = mysqlGeneratedValue(rule, row[rule.COLUMN_NAME], inputFormat); return ':' + name;
  }).join(', ') + ')');
  return { sql: `INSERT INTO ${mysqlTableName(schema, table)} (${included.map(rule => quoteMysql(rule.COLUMN_NAME)).join(', ')}) VALUES ${values.join(',\n')}`, binds };
}
