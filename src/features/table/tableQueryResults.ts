// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnDefinition, DatabaseRow } from '@/shared/types/databaseTypes';

export function requireTableColumns(rows: ColumnDefinition[] | undefined, message: string): ColumnDefinition[] {
  if (!Array.isArray(rows) || !rows.length || rows.some(column =>
    !column || typeof column.COLUMN_NAME !== 'string' || !column.COLUMN_NAME ||
    typeof column.DATA_TYPE !== 'string' || !column.DATA_TYPE.trim()) ||
    new Set(rows.map(column => column.COLUMN_NAME)).size !== rows.length) {
    throw new Error(message);
  }
  return rows;
}

// A missing or failed count is not a successful zero-row result.
export function requireTableCount(result: { success: boolean; error?: string; rows?: DatabaseRow[] }, message: string): number {
  if (!result.success) throw new Error(result.error || message);
  if (!Array.isArray(result.rows) || result.rows.length !== 1) throw new Error(message);
  const row = result.rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(message);
  const value = Object.hasOwn(row, 'CNT') ? row.CNT : row.cnt;
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim()))) throw new Error(message);
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error(message);
  return count;
}
