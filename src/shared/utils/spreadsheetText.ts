// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { CellObject } from 'xlsx';

// Neutralize text only; actual numeric values retain their numeric representation.
export function spreadsheetText(value: unknown, safe: boolean): string {
  const text = String(value ?? '');
  if (safe && typeof value === 'string' && (/^[\t\r\n]/.test(text) || /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text))) return "'" + text;
  return text;
}


// Never let database objects become SheetJS cell metadata (formulas, links or rich text).
export function excelCell(value: unknown): CellObject {
  if (value == null) return { t: 'z' };
  if (typeof value === 'string') return { t: 's', v: value };
  if (typeof value === 'boolean') return { t: 'b', v: value };
  if (typeof value === 'number' && Number.isFinite(value)) return { t: 'n', v: value };
  if (value instanceof Date && Number.isFinite(value.getTime())) return { t: 'd', v: new Date(value.getTime()) };
  if (typeof value === 'object') {
    return { t: 's', v: JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item) };
  }
  return { t: 's', v: String(value) };
}
