// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ResultSnapshot {
  format: 'monabase-result'; version: 1; columns: string[]; rows: JsonValue[][];
}
export const MAX_RESULT_ROWS = 10000;
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

export function jsonValue(value: unknown, depth = 0): JsonValue {
  if (depth > 32) throw new Error('quality_invalid_document');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) throw new Error('quality_inexact_number');
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return { binary: Array.from(value) };
  if (Array.isArray(value)) return value.map(item => jsonValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, depth + 1)]));
  throw new Error('quality_invalid_document');
}
export function validateSnapshot(input: unknown): ResultSnapshot {
  if (!input || typeof input !== 'object') throw new Error('quality_invalid_document');
  const value = input as Partial<ResultSnapshot>;
  if (value.format !== 'monabase-result' || value.version !== 1 || !Array.isArray(value.columns) || !value.columns.length || value.columns.length > 512 ||
    value.columns.some(c => typeof c !== 'string' || !c.length || c.length > 512) || new Set(value.columns).size !== value.columns.length ||
    !Array.isArray(value.rows) || value.rows.length > MAX_RESULT_ROWS || value.rows.some(row => !Array.isArray(row) || row.length !== value.columns!.length)) throw new Error('quality_invalid_document');
  const result: ResultSnapshot = { format: 'monabase-result', version: 1, columns: [...value.columns], rows: value.rows.map(row => row.map(cell => jsonValue(cell))) };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_DOCUMENT_BYTES) throw new Error('quality_document_limit');
  return result;
}
export function captureResult(columns: string[], rows: Record<string, unknown>[]): ResultSnapshot {
  return validateSnapshot({ format: 'monabase-result', version: 1, columns, rows: rows.map(row => columns.map(column => {
    if (!Object.hasOwn(row, column)) throw new Error('quality_missing_column');
    return row[column];
  })) });
}
export function parseDocument(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES) throw new Error('quality_document_limit');
  try { return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown; } catch { throw new Error('quality_invalid_document'); }
}
export function stableValue(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableValue).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableValue(value[key])).join(',') + '}';
}
