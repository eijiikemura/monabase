// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { GridRowId } from '@mui/x-data-grid';

// SQL determines column names and values; check types at the point of use.
export interface DatabaseRow {
  [column: string]: unknown;
  id?: GridRowId;
  ORACLE_ROWID?: string;
  POSTGRES_CTID?: string;
  __row_id?: GridRowId;
}

export interface ColumnMetadata {
  name: string;
  column_name?: string;
  field?: string;
  dbTypeName?: string;
  dataType?: number;
  fetchType?: number;
  nullable?: boolean;
  precision?: number;
  scale?: number;
  byteSize?: number;
}

export interface UniqueKeyPosition { pos: string; isComposite: boolean; }

// Normalize Oracle and PostgreSQL column metadata for the UI.
export interface ColumnDefinition {
  id?: GridRowId;
  rowNo?: number;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  PG_TYPE_SCHEMA?: string;
  PG_TYPE_NAME?: string;
  PG_TYPE_KIND?: string;
  PG_TYPE_CATEGORY?: string;
  DATA_LENGTH?: number | string;
  DATA_PRECISION?: number;
  DATA_SCALE?: number | string;
  NULLABLE?: string;
  DATA_DEFAULT?: string;
  COMMENTS?: string;
  PK_POSITION?: number | string;
  PK_COUNT?: number;
  IS_PK_COMPOSITE?: boolean;
  UK_DATA?: UniqueKeyPosition[];
  INDEX_INFO?: string;
}

export interface IndexDefinition {
  OWNER?: string;
  id?: GridRowId;
  INDEX_NAME: string;
  UNIQUENESS?: string;
  IS_PRIMARY?: boolean;
  INDEX_TYPE?: string;
  STATUS?: string;
  VISIBILITY?: string;
  TYPE_DISP?: string;
  COLUMNS: string;
}

export interface TriggerDefinition {
  OWNER?: string;
  id?: GridRowId;
  TRIGGER_NAME: string;
  TRIGGER_TYPE?: string;
  TRIGGERING_EVENT?: string;
  STATUS?: string;
}

export interface ConstraintDefinition {
  id?: GridRowId;
  CONSTRAINT_NAME: string;
  SEARCH_CONDITION?: string;
  STATUS?: string;
  VALIDATED?: string;
  GENERATED?: string;
}

export interface TableStructureCache {
  tableComment: string;
  structureRows: ColumnDefinition[];
  indexRows: IndexDefinition[];
  triggerRows: TriggerDefinition[];
  constraintRows: ConstraintDefinition[];
}

export interface GitRevision {
  id: string;
  fullId: string;
  date: string;
  message: string;
  author?: string;
  isPushed?: boolean;
  hasRemote?: boolean;
}

export type NamedObject = string | { name: string; type?: string };

export interface SidebarObject {
  signature?: string; name: string; status: string; tableName?: string; }

export interface OracleIndexStatistics {
  BLEVEL?: number;
  LEAF_BLOCKS?: number;
  DISTINCT_KEYS?: number;
  NUM_ROWS?: number;
  SAMPLE_SIZE?: number;
  LAST_ANALYZED?: string | Date;
}

export interface PgIndexStatistics {
  index_size?: string;
  idx_scan?: number;
  idx_tup_read?: number;
  idx_tup_fetch?: number;
  idx_blks_read?: number;
  idx_blks_hit?: number;
  last_analyze?: string | Date;
  last_autoanalyze?: string | Date;
  last_vacuum?: string | Date;
  last_autovacuum?: string | Date;
}

export interface RelationDefinition {
  id: string;
  CONSTRAINT_NAME: string;
  TARGET_TABLE: string;
  DELETE_RULE: string;
  SOURCE_COLS: string[];
  TARGET_COLS: string[];
  SOURCE_COLUMNS: string;
  TARGET_COLUMNS: string;
}

export interface TableRelationCache {
  relations: RelationDefinition[];
  currentTableCols: string[];
  allTables: string[];
}

// Define file selection binary values separately from regular column data.
export interface BinaryFileValue {
  isBlob: true;
  fileName?: string;
  sizeStr?: string;
  data?: ArrayBuffer | Uint8Array;
  hex?: string;
}

export type RecordInputValue = string | number | boolean | Date | BinaryFileValue | null;
export type RecordInputData = Record<string, unknown>;

export interface ObjectContextRow {
  OWNER?: string;
  INDEX_NAME?: string;
  TRIGGER_NAME?: string;
  CONSTRAINT_NAME?: string;
  STATUS?: string;
  VISIBILITY?: string;
  IS_PRIMARY?: boolean;
}

export function isBinaryFileValue(value: unknown): value is BinaryFileValue {
  return !!value && typeof value === 'object' && 'isBlob' in value && value.isBlob === true;
}

export function getObjectName(value: unknown): string {
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') return value.name;
  return String(value);
}
