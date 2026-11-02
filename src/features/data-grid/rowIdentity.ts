// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { GridRowId } from '@mui/x-data-grid';
import type { DatabaseRow } from '@/shared/types/databaseTypes';

// Symbol metadata survives object spreads but cannot collide with SQL column names or JSON exports.
const rowMetadata = Symbol.for('MonaBase.gridRowMetadata');
interface RowMetadata { id: GridRowId; oracleRowId?: string; rawValues: DatabaseRow; }
type IdentifiedRow = DatabaseRow & { [rowMetadata]?: RowMetadata };

export function withRowIdentity(row: DatabaseRow, id: GridRowId, oracleRowId?: string): DatabaseRow {
  const previous = (row as IdentifiedRow)[rowMetadata];
  return { ...row, [rowMetadata]: { id, oracleRowId, rawValues: previous?.rawValues ?? { ...row } } };
}

export function getRowIdentity(row: DatabaseRow): GridRowId {
  const metadata = (row as IdentifiedRow)[rowMetadata];
  if (!metadata) throw new Error('A database result row is missing its grid identity.');
  return metadata.id;
}

export function getOracleRowId(row: DatabaseRow): string {
  const value = (row as IdentifiedRow)[rowMetadata]?.oracleRowId;
  if (!value) throw new Error('A database result row is missing its Oracle row identifier.');
  return value;
}

export function preserveRowIdentity(row: DatabaseRow, original: DatabaseRow): DatabaseRow {
  const metadata = (original as IdentifiedRow)[rowMetadata];
  if (!metadata) throw new Error('A database result row is missing its grid identity.');
  const rawValues = { ...metadata.rawValues };
  for (const column of Object.keys(row)) {
    if (!Object.is(row[column], original[column])) rawValues[column] = row[column];
  }
  return { ...row, [rowMetadata]: { ...metadata, rawValues } };
}

// Display formatting must never become the source for updates, keys or duplication.
export function getRowSourceValue(row: DatabaseRow, column: string): unknown {
  const raw = (row as IdentifiedRow)[rowMetadata]?.rawValues;
  return raw && Object.hasOwn(raw, column) ? raw[column] : row[column];
}

export function oracleRowIdAlias(columns: string[]): string {
  const base = '__MONABASE_ROWID';
  let alias = base;
  let suffix = 1;
  while (columns.includes(alias)) alias = `${base}_${suffix++}`;
  return alias;
}

export function identifyOracleRow(row: DatabaseRow, alias: string, id: GridRowId): DatabaseRow {
  const { [alias]: physicalRowId, ...data } = row;
  return withRowIdentity(data, id, typeof physicalRowId === 'string' ? physicalRowId : undefined);
}
