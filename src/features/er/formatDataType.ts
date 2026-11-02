// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const FIXED_TYPES = new Set([
  'INTEGER', 'INT', 'INT2', 'INT4', 'INT8', 'SMALLINT', 'BIGINT',
  'REAL', 'DOUBLE PRECISION', 'FLOAT4', 'FLOAT8', 'BINARY_FLOAT', 'BINARY_DOUBLE',
  'BOOLEAN', 'BOOL', 'TEXT', 'BYTEA', 'DATE', 'UUID', 'JSON', 'JSONB',
]);

export function formatDataTypeString(type: string, length: unknown, scale: unknown): string {
  let cleanType = type ? type.trim().toUpperCase() : 'UNKNOWN';
  if (cleanType === 'CHARACTER VARYING') cleanType = 'VARCHAR';
  if (cleanType === 'CHARACTER') cleanType = 'CHAR';
  if (cleanType === 'TIMESTAMP WITHOUT TIME ZONE') cleanType = 'TIMESTAMP';
  // Integer/float metadata describes storage precision, not a SQL type modifier.
  if (FIXED_TYPES.has(cleanType) || cleanType.startsWith('TIMESTAMP') || cleanType.startsWith('INTERVAL')) {
    return cleanType;
  }
  if (length != null) {
    if (scale != null && ['NUMBER', 'NUMERIC', 'DECIMAL'].includes(cleanType)) {
      return `${cleanType}(${length}, ${scale})`;
    }
    return `${cleanType}(${length})`;
  }
  return cleanType;
}
