// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { stableValue, validateSnapshot, type JsonValue, type ResultSnapshot } from './resultSnapshot';
export interface ComparisonOptions { keys: string[]; numericStrings: boolean; }
export interface ResultDifference { kind: 'added' | 'removed' | 'changed'; before?: JsonValue[]; after?: JsonValue[]; columns: string[]; }
export interface Comparison { equal: boolean; unchanged: number; added: number; removed: number; changed: number; differences: ResultDifference[]; }
// Normalize decimal text without converting it to an imprecise IEEE-754 number.
function decimal(value: string): string | null {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return null;
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace(/^[+-]/, '').split('.');
  const normalized = whole.replace(/^0+(?=\d)/, '') + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '');
  return (negative && normalized !== '0' ? '-' : '') + normalized;
}
function cellKey(value: JsonValue, numeric: boolean): string {
  const normalized = numeric && (typeof value === 'string' || typeof value === 'number') ? decimal(String(value)) : null;
  return normalized === null ? stableValue(value) : 'decimal:' + normalized;
}
export function compareResults(leftInput: ResultSnapshot, rightInput: ResultSnapshot, options: ComparisonOptions = { keys: [], numericStrings: false }): Comparison {
  const left = validateSnapshot(leftInput), right = validateSnapshot(rightInput);
  if (left.columns.length !== right.columns.length || left.columns.some(c => !right.columns.includes(c))) throw new Error('quality_columns_differ');
  if (new Set(options.keys).size !== options.keys.length || options.keys.some(key => !left.columns.includes(key))) throw new Error('quality_invalid_keys');
  const rightOrder = left.columns.map(c => right.columns.indexOf(c));
  const rightRows = right.rows.map(row => rightOrder.map(index => row[index]));
  const differences: ResultDifference[] = [];
  let unchanged = 0;
  const key = (row: JsonValue[], positions: number[]) => JSON.stringify(positions.map(index => cellKey(row[index], options.numericStrings)));
  const positions = options.keys.length ? options.keys.map(c => left.columns.indexOf(c)) : left.columns.map((_, index) => index);
  if (options.keys.length) {
    const map = (rows: JsonValue[][]) => {
      const result = new Map<string, JsonValue[]>();
      for (const row of rows) {
        if (positions.some(index => row[index] === null)) throw new Error('quality_null_key');
        const id = key(row, positions);
        if (result.has(id)) throw new Error('quality_duplicate_key');
        result.set(id, row);
      }
      return result;
    };
    const before = map(left.rows), after = map(rightRows);
    for (const [id, row] of before) {
      const next = after.get(id);
      if (!next) differences.push({ kind: 'removed', before: row, columns: [] });
      else {
        const columns = left.columns.filter((_, index) => cellKey(row[index], options.numericStrings) !== cellKey(next[index], options.numericStrings));
        if (columns.length) differences.push({ kind: 'changed', before: row, after: next, columns }); else unchanged++;
        after.delete(id);
      }
    }
    for (const row of after.values()) differences.push({ kind: 'added', after: row, columns: [] });
  } else {
    const remaining = new Map<string, JsonValue[][]>();
    for (const row of rightRows) { const id = key(row, positions); const bucket = remaining.get(id) || []; bucket.push(row); remaining.set(id, bucket); }
    for (const row of left.rows) {
      const bucket = remaining.get(key(row, positions));
      if (bucket?.length) { bucket.pop(); unchanged++; } else differences.push({ kind: 'removed', before: row, columns: [] });
    }
    for (const bucket of remaining.values()) for (const row of bucket) differences.push({ kind: 'added', after: row, columns: [] });
  }
  return { equal: differences.length === 0, unchanged, added: differences.filter(d => d.kind === 'added').length, removed: differences.filter(d => d.kind === 'removed').length, changed: differences.filter(d => d.kind === 'changed').length, differences };
}
