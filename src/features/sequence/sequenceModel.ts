// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { sequenceInteger, sequenceDefaults } from './sequenceValues';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
export type SequenceDatabase = 'oracle' | 'postgresql';
export interface SequenceSettings { increment: string; min: string; max: string; cache: string; cycle: boolean; order: boolean; keep: boolean; session: boolean; dataType: string; }
export interface SequenceMetadata { settings: SequenceSettings; observed: string | null; start: string; }
export interface SequenceDraft { incrementBy: string; hasMinValue: boolean; minValue: string; hasMaxValue: boolean; maxValue: string; hasCache: boolean; cacheValue: string; isCycle: boolean; isOrder: boolean; isKeep: boolean; isSession: boolean; }
export type SequenceField = keyof SequenceDraft | 'startWith' | 'currentValue';
export class SequenceValidationError extends Error { readonly field: SequenceField; readonly key: string; constructor(field: SequenceField, key: string) { super(key); this.field = field; this.key = key; } }
export const settingKeys = ['increment', 'min', 'max', 'cache', 'cycle', 'order', 'keep', 'session', 'dataType'] as const;
const integer = (value: unknown, field: SequenceField) => { try { return sequenceInteger(value); } catch { throw new SequenceValidationError(field, 'sequence_integer_required'); } };
export function sequenceDraft(database: SequenceDatabase, settings: SequenceSettings): SequenceDraft {
  const defaults = sequenceDefaults(database, settings.increment, settings.dataType);
  const hasMinValue = settings.min !== defaults?.min, hasMaxValue = settings.max !== defaults?.max;
  return { incrementBy: settings.increment, hasMinValue, minValue: hasMinValue ? settings.min : '', hasMaxValue, maxValue: hasMaxValue ? settings.max : '',
    hasCache: BigInt(settings.cache) > (database === 'oracle' ? 0n : 1n), cacheValue: settings.cache, isCycle: settings.cycle, isOrder: settings.order, isKeep: settings.keep, isSession: settings.session };
}
export function desiredSequence(database: SequenceDatabase, draft: SequenceDraft, dataType: string): SequenceSettings {
  const increment = integer(draft.incrementBy, 'incrementBy');
  if (BigInt(increment) === 0n) throw new SequenceValidationError('incrementBy', 'sequence_increment_must_not_be_zero');
  const defaults = sequenceDefaults(database, increment, dataType);
  if (!defaults) throw new SequenceValidationError('incrementBy', 'sequence_metadata_unavailable');
  return { increment, min: draft.hasMinValue ? integer(draft.minValue, 'minValue') : defaults.min, max: draft.hasMaxValue ? integer(draft.maxValue, 'maxValue') : defaults.max,
    cache: draft.hasCache ? integer(draft.cacheValue, 'cacheValue') : database === 'oracle' ? '0' : '1', cycle: draft.isCycle, order: draft.isOrder, keep: draft.isKeep, session: draft.isSession, dataType };
}
export function validateSequence(database: SequenceDatabase, settings: SequenceSettings, start?: { value: string; field: 'startWith' | 'currentValue' }) {
  const increment = BigInt(settings.increment), min = BigInt(settings.min), max = BigInt(settings.max), cache = BigInt(settings.cache);
  if (min >= max) throw new SequenceValidationError('maxValue', 'sequence_invalid_bounds');
  const typeDefaults = sequenceDefaults(database, '1', settings.dataType);
  const negativeDefaults = sequenceDefaults(database, '-1', settings.dataType);
  if (!typeDefaults || !negativeDefaults || min < BigInt(negativeDefaults.min) || max > BigInt(typeDefaults.max)) throw new SequenceValidationError('maxValue', 'sequence_type_bounds');
  const step = increment < 0n ? -increment : increment;
  if (!step) throw new SequenceValidationError('incrementBy', 'sequence_increment_must_not_be_zero');
  if (database === 'oracle' && step >= max - min) throw new SequenceValidationError('incrementBy', 'sequence_increment_exceeds_range');
  if (database === 'postgresql' && (increment < -(2n ** 63n) || increment > 2n ** 63n - 1n)) throw new SequenceValidationError('incrementBy', 'sequence_type_bounds');
  if (!(database === 'oracle' && settings.session)) {
    if ((database === 'oracle' && cache !== 0n && cache < 2n) || (database === 'postgresql' && cache < 1n)) throw new SequenceValidationError('cacheValue', 'sequence_invalid_cache');
    if (database === 'oracle' && cache > 10n ** 28n - 1n || database === 'postgresql' && cache > 2n ** 63n - 1n) throw new SequenceValidationError('cacheValue', 'sequence_invalid_cache');
    if (database === 'oracle' && settings.cycle && cache > 0n && cache >= (max - min + step - 1n) / step) throw new SequenceValidationError('cacheValue', 'sequence_cache_exceeds_cycle');
  }
  if (start) {
    const value = BigInt(integer(start.value, start.field));
    if (value < min || value > max) throw new SequenceValidationError(start.field, 'sequence_start_out_of_bounds');
  }
}
export function sequenceChanges(baseline: SequenceSettings, desired: SequenceSettings) { return settingKeys.filter(key => baseline[key] !== desired[key]); }
export function mergeSequenceChanges(baseline: SequenceSettings, desired: SequenceSettings, latest: SequenceSettings) {
  const keys = sequenceChanges(baseline, desired);
  const conflicts = keys.filter(key => latest[key] !== baseline[key] && latest[key] !== desired[key]);
  if (latest.dataType !== baseline.dataType) conflicts.push('dataType');
  const merged = { ...latest };
  for (const key of keys) Object.assign(merged, { [key]: desired[key] });
  return { merged, conflicts };
}
export function sequenceStatement(database: SequenceDatabase, schema: string, name: string, settings: SequenceSettings, baseline?: SequenceSettings, start?: string) {
  const keys = baseline ? sequenceChanges(baseline, settings) : [...settingKeys];
  if (baseline && !keys.length) return '';
  const clauses: string[] = [];
  if (!baseline && database === 'postgresql') clauses.push(`AS ${settings.dataType}`);
  if (keys.includes('increment')) clauses.push(`INCREMENT BY ${settings.increment}`);
  if (!baseline) clauses.push(`START WITH ${sequenceInteger(start)}`);
  if (keys.includes('min')) clauses.push(`MINVALUE ${settings.min}`);
  if (keys.includes('max')) clauses.push(`MAXVALUE ${settings.max}`);
  if (keys.includes('cycle')) clauses.push(settings.cycle ? 'CYCLE' : database === 'oracle' ? 'NOCYCLE' : 'NO CYCLE');
  if (database === 'oracle') {
    if (!settings.session && keys.includes('cache')) clauses.push(settings.cache === '0' ? 'NOCACHE' : `CACHE ${settings.cache}`);
    if (!settings.session && keys.includes('order')) clauses.push(settings.order ? 'ORDER' : 'NOORDER');
    if (keys.includes('keep')) clauses.push(settings.keep ? 'KEEP' : 'NOKEEP');
    if (keys.includes('session')) clauses.push(settings.session ? 'SESSION' : 'GLOBAL');
  } else if (keys.includes('cache')) clauses.push(`CACHE ${settings.cache}`);
  if (!clauses.length) return '';
  return `${baseline ? 'ALTER' : 'CREATE'} SEQUENCE ${qualifiedObjectName({ schema, objectName: name })}\n${clauses.join('\n')}`;
}
export function oracleSequenceRestartSupported(info: string): boolean {
  const major = /Oracle Database\s+(\d+)/i.exec(info)?.[1] ?? /\b(?:Release|Version)\s+(\d+)\./i.exec(info)?.[1];
  return major !== undefined && Number(major) >= 18;
}
