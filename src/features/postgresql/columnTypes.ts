// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnDefinition } from '@/shared/types/databaseTypes';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';

export type PostgresColumnKind = 'number' | 'date' | 'timestamp' | 'time' | 'binary' | 'boolean' | 'text' | 'other';

// Catalog identity takes precedence; a user-defined name is never a built-in type hint.
export function postgresColumnKind(column: ColumnDefinition): PostgresColumnKind {
  if ((column.PG_TYPE_SCHEMA && column.PG_TYPE_SCHEMA !== 'pg_catalog') ||
      ['e', 'd', 'c'].includes(column.PG_TYPE_KIND || '') || column.PG_TYPE_CATEGORY === 'A') return 'other';
  const type = column.DATA_TYPE.trim().toLowerCase();
  if (/^(?:smallint|integer|bigint|int[248]?|oid|smallserial|serial|bigserial|real|double precision|float[48]?|(?:numeric|decimal)(?:\(\s*\d+(?:\s*,\s*-?\d+)?\s*\))?)$/.test(type)) return 'number';
  if (type === 'date') return 'date';
  if (/^timestamp(?:\(\d+\))?(?: with(?:out)? time zone)?$/.test(type) || type === 'timestamptz') return 'timestamp';
  if (/^time(?:\(\d+\))?(?: with(?:out)? time zone)?$/.test(type) || type === 'timetz') return 'time';
  if (type === 'bytea') return 'binary';
  if (/^(?:boolean|bool)$/.test(type)) return 'boolean';
  if (/^(?:text|(?:character varying|varchar|character|char|bpchar)(?:\(\d+\))?)$/.test(type)) return 'text';
  return 'other';
}

export const postgresIsDateTime = (column: ColumnDefinition) => ['date', 'timestamp', 'time'].includes(postgresColumnKind(column));
export const postgresIsLob = (column: ColumnDefinition) => postgresColumnKind(column) === 'binary' ||
  (postgresColumnKind(column) === 'text' && column.DATA_TYPE.toLowerCase() === 'text');
export const postgresCastType = (column: ColumnDefinition) => column.PG_TYPE_SCHEMA && column.PG_TYPE_NAME
  ? `${quoteIdentifier(column.PG_TYPE_SCHEMA)}.${quoteIdentifier(column.PG_TYPE_NAME)}` : column.DATA_TYPE;

export const postgresColumnMetadataSql = `
  SELECT a.attname AS "COLUMN_NAME", pg_catalog.format_type(a.atttypid, a.atttypmod) AS "DATA_TYPE",
    tn.nspname AS "PG_TYPE_SCHEMA", typ.typname AS "PG_TYPE_NAME", typ.typtype AS "PG_TYPE_KIND", typ.typcategory AS "PG_TYPE_CATEGORY",
    CASE WHEN a.attnotnull THEN 'N' ELSE 'Y' END AS "NULLABLE", pg_get_expr(d.adbin, d.adrelid) AS "DATA_DEFAULT",
    (SELECT array_position(pk.conkey, a.attnum) FROM pg_catalog.pg_constraint pk WHERE pk.conrelid = a.attrelid AND pk.contype = 'p') AS "PK_POSITION"
  FROM pg_catalog.pg_attribute a
  JOIN pg_class tab ON tab.oid = a.attrelid JOIN pg_namespace ns ON ns.oid = tab.relnamespace
  JOIN pg_type typ ON typ.oid = a.atttypid JOIN pg_namespace tn ON tn.oid = typ.typnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE ns.nspname = :schema AND tab.relname = :tableName AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY a.attnum`;
