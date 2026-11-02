// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface ObjectIdentity { schema: string; objectName: string; }

export type DbType = 'oracle' | 'postgresql';

export type ObjectCategory =
  | 'TABLE' | 'VIEW' | 'MATERIALIZED VIEW' | 'MATERIALIZED VIEW LOG'
  | 'SEQUENCE' | 'FUNCTION' | 'PROCEDURE' | 'PACKAGE' | 'TRIGGER'
  | 'DATABASE LINK' | 'SYNONYM' | 'INDEX' | 'TYPE';

export interface DatabaseObject {
  key: string;
  dbType: DbType;
  schema: string;
  category: ObjectCategory;
  name: string;
  displayName: string;
  id?: string;
  parentName?: string;
}

export interface ObjectReference {
  definition: string;
  details: Record<string, unknown>;
}
