// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { TFunction } from 'i18next';
import type { ColumnRule } from './generatorTypes';

type Decimal = { units: bigint; scale: number };
const numericFields = ['seqStart', 'seqStep', 'randNumMin', 'randNumMax', 'randNumRound'] as const;
const ruleTypes = ['UNSPECIFIED', 'SEQ_NUM', 'SEQ_DATE', 'RANDOM_NUM', 'RANDOM_CHAR', 'RANDOM_DATE', 'CHOICE', 'FIXED', 'DISABLED'];
const charTypes = ['ALPHA', 'NUM', 'ALPHANUM', 'ZENKAKU', 'REGEX'];
const metadata = ['COLUMN_NAME', 'DATA_TYPE', 'DATA_LENGTH', 'NULLABLE', 'PG_TYPE_SCHEMA', 'PG_TYPE_NAME',
  'PG_TYPE_KIND', 'PG_TYPE_CATEGORY', 'DATA_PRECISION', 'DATA_SCALE', 'DATA_DEFAULT'];
export type ValidateGeneratorRule = (rule: ColumnRule, count: number) => void;

// Bound expansion and reject already rounded numeric JSON values. Text retains exact digits.
function decimal(value: unknown): Decimal {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER))) {
    throw new Error('Invalid or unsafe numeric input.');
  }
  const text = String(value).trim();
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!match || text.length > 200) throw new Error('Invalid numeric input.');
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) throw new Error('Unsupported numeric precision.');
  let scale = fraction.length - exponent;
  let units = BigInt((match[1] === '-' ? '-' : '') + ((match[2] ?? '0') + fraction));
  if (scale < 0) { units *= 10n ** BigInt(-scale); scale = 0; }
  while (scale > 0 && units % 10n === 0n) { units /= 10n; scale--; }
  if (scale > 100 || units.toString().replace('-', '').length > 100) throw new Error('Unsupported numeric precision.');
  return { units, scale };
}
function align(values: Decimal[]) {
  const scale = Math.max(...values.map(value => value.scale));
  return { scale, units: values.map(value => value.units * 10n ** BigInt(scale - value.scale)) };
}
function format(units: bigint, scale: number): string {
  const negative = units < 0n, digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const value = scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
  return (negative ? '-' : '') + value;
}
export function sequenceValue(start: unknown, step: unknown, index: number): string {
  const { scale, units: [first, increment] } = align([decimal(start), decimal(step)]);
  const value = format(first + increment * BigInt(index), scale);
  decimal(value);
  return value;
}
function randomRange(min: unknown, max: unknown, round: unknown) {
  const { scale, units: [first, last, increment] } = align([decimal(min), decimal(max), decimal(round)]);
  if (increment <= 0n || first > last) throw new Error('Invalid random range or rounding unit.');
  const steps = (last - first) / increment;
  if (steps >= BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Unsupported random range precision.');
  return { scale, first, increment, steps: Number(steps) };
}
export function randomDecimalValue(min: unknown, max: unknown, round: unknown, random: number): string {
  const { scale, first, increment, steps } = randomRange(min, max, round);
  return format(first + BigInt(Math.min(steps, Math.floor(random * (steps + 1)))) * increment, scale);
}
export function generationCount(value: unknown, t: TFunction): number {
  try {
    const count = decimal(value);
    if (count.scale !== 0 || count.units <= 0n || count.units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error();
    return Number(count.units);
  } catch { throw new Error(t('specify_a_positive_integer_for_the_row_count')); }
}
export function validateGeneration(rules: ColumnRule[], countInput: unknown, t: TFunction, validateRule?: ValidateGeneratorRule): number {
  const count = generationCount(countInput, t);
  for (const rule of rules) {
    if (rule.ruleType === 'DISABLED') continue;
    try {
      if (!ruleTypes.includes(rule.ruleType) || !charTypes.includes(rule.randCharType) ||
          !Number.isFinite(rule.nullRatio) || rule.nullRatio < 0 || rule.nullRatio > 100 ||
          (rule.NULLABLE === 'N' && (rule.nullRatio !== 0 || rule.ruleType === 'UNSPECIFIED'))) throw new Error();
      if (rule.ruleType === 'SEQ_NUM') { sequenceValue(rule.seqStart, rule.seqStep, 0); sequenceValue(rule.seqStart, rule.seqStep, count - 1); }
      if (rule.ruleType === 'RANDOM_NUM') randomRange(rule.randNumMin, rule.randNumMax, rule.randNumRound);
      if (rule.ruleType === 'SEQ_DATE') {
        const first = new Date(rule.seqStartDate), last = new Date(first);
        last.setDate(last.getDate() + count - 1);
        if (!Number.isFinite(first.getTime()) || !Number.isFinite(last.getTime())) throw new Error();
      }
      if (rule.ruleType === 'RANDOM_DATE' && !/^time(?:\(|\s|$)|^timetz$/i.test(rule.DATA_TYPE)) {
        const first = new Date(rule.randDateMin).getTime(), last = new Date(rule.randDateMax).getTime();
        if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) throw new Error();
      }
      if (rule.ruleType === 'CHOICE' && !rule.choiceValues.split(',').some(value => value.trim())) throw new Error();
      if (rule.ruleType === 'RANDOM_CHAR' && rule.randCharType === 'REGEX') new RegExp(rule.randCharRegex);
      validateRule?.(rule, count);
    } catch { throw new Error(t('generation_rule_invalid', { column: rule.COLUMN_NAME })); }
  }
  return count;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Validate the complete candidate before applying either the rules or the row count.
export function mergeGenerationSettings(payload: unknown, current: ColumnRule[], count: unknown, t: TFunction, matchingOnly = false, validateRule?: ValidateGeneratorRule) {
  if (!isRecord(payload) || !Array.isArray(payload.rules) || !payload.rules.length) throw new Error(t('invalid_settings_file_format'));
  const loaded = new Map<string, Record<string, unknown>>();
  for (const rule of payload.rules) {
    if (!isRecord(rule) || typeof rule.COLUMN_NAME !== 'string' || loaded.has(rule.COLUMN_NAME) ||
        (!matchingOnly && !current.some(column => column.COLUMN_NAME === rule.COLUMN_NAME))) {
      throw new Error(t('the_ai_response_contains_invalid_or_duplicate_column_names'));
    }
    loaded.set(rule.COLUMN_NAME, rule);
  }
  const rules = current.map(column => {
    const source = loaded.get(column.COLUMN_NAME);
    if (!source || column.ruleType === 'DISABLED') return column;
    const next = { ...column };
    for (const [key, value] of Object.entries(source)) {
      if (metadata.includes(key) || !Object.hasOwn(column, key)) continue;
      if (numericFields.some(field => field === key)) {
        try { decimal(value); } catch { throw new Error(t('generation_rule_invalid', { column: column.COLUMN_NAME })); }
      } else if (typeof value !== typeof column[key as keyof ColumnRule] ||
          (typeof value === 'number' && !Number.isFinite(value))) throw new Error(t('invalid_generation_rule_setting_types'));
      Object.assign(next, { [key]: value });
    }
    if (next.ruleType === 'DISABLED') throw new Error(t('generation_rule_invalid', { column: column.COLUMN_NAME }));
    return next;
  });
  const generateCount = validateGeneration(rules, payload.generateCount === undefined ? count : payload.generateCount, t, validateRule);
  return { rules, generateCount };
}

export type GenerationFieldIssues = Partial<Record<keyof ColumnRule, string>>;
// Return field-local feedback without changing the execution/import validation contract.
export function generationIssues(rules: ColumnRule[], countInput: unknown, t: TFunction, validateRule?: ValidateGeneratorRule) {
  let count = 1, countError = '';
  try { count = generationCount(countInput, t); } catch { countError = t('specify_a_positive_integer_for_the_row_count'); }
  const columns: Record<string, GenerationFieldIssues> = Object.create(null);
  for (const rule of rules) {
    if (rule.ruleType === 'DISABLED') continue;
    const fields: GenerationFieldIssues = {};
    const numeric = (field: 'seqStart' | 'seqStep' | 'randNumMin' | 'randNumMax' | 'randNumRound') => {
      try { return decimal(rule[field]); } catch { fields[field] = t('generation_enter_number'); return null; }
    };
    if (!Number.isFinite(rule.nullRatio) || rule.nullRatio < 0 || rule.nullRatio > 100) fields.nullRatio = t('generation_null_ratio_range');
    if (rule.ruleType === 'SEQ_NUM') { numeric('seqStart'); numeric('seqStep'); }
    if (rule.ruleType === 'RANDOM_NUM') {
      const low = numeric('randNumMin'), high = numeric('randNumMax'), unit = numeric('randNumRound');
      if (low && high) {
        const { units: [a, b] } = align([low, high]);
        if (a > b) { fields.randNumMin = t('generation_min_above_max'); fields.randNumMax = t('generation_min_above_max'); }
      }
      if (unit && unit.units <= 0n) fields.randNumRound = t('generation_round_positive');
    }
    if (rule.ruleType === 'SEQ_DATE' && !Number.isFinite(new Date(rule.seqStartDate).getTime())) fields.seqStartDate = t('generation_enter_date');
    if (rule.ruleType === 'RANDOM_DATE' && !/^time(?:\(|\s|$)|^timetz$/i.test(rule.DATA_TYPE)) {
      const low = new Date(rule.randDateMin).getTime(), high = new Date(rule.randDateMax).getTime();
      if (!Number.isFinite(low)) fields.randDateMin = t('generation_enter_date');
      if (!Number.isFinite(high)) fields.randDateMax = t('generation_enter_date');
      if (low > high) { fields.randDateMin = t('generation_min_above_max'); fields.randDateMax = t('generation_min_above_max'); }
    }
    if (rule.ruleType === 'CHOICE' && !rule.choiceValues.split(',').some(value => value.trim())) fields.choiceValues = t('generation_choices_required');
    if (rule.ruleType === 'RANDOM_CHAR' && rule.randCharType === 'REGEX') {
      try { new RegExp(rule.randCharRegex); } catch { fields.randCharRegex = t('generation_invalid_regex'); }
    }
    try { validateGeneration([rule], count, t, validateRule); }
    catch {
      if (!Object.keys(fields).length) {
        const field = rule.ruleType === 'FIXED' ? 'fixedValue' : rule.ruleType === 'CHOICE' ? 'choiceValues' : 'ruleType';
        fields[field] = t('generation_invalid_value');
      }
    }
    if (Object.keys(fields).length) columns[rule.COLUMN_NAME] = fields;
  }
  return { countError, columns, invalid: !!countError || Object.keys(columns).length > 0 };
}
