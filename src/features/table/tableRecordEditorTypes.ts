// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { GridRowId } from '@mui/x-data-grid';
import type { ColumnDefinition, DatabaseRow, RecordInputData } from '@/shared/types/databaseTypes';
import type { Condition } from '@/shared/types/queryConditions';
import type { TableDataLogEntry } from '@/shared/types/tableDataTypes';

export interface RecordDialogState {
  isOpen: boolean;
  mode: 'insert' | 'update' | 'duplicate';
  recordData: RecordInputData;
  initialRecordData: RecordInputData;
}
export interface OracleRecordDialogState extends RecordDialogState { targetRowId: GridRowId; }
export interface TableRecordEditorContext<State extends RecordDialogState = RecordDialogState> {
  schema: string;
  tableName: string;
  structureDefs: ColumnDefinition[];
  inputDateFormat: string;
  hasLobColumns: boolean;
  isTransposed: boolean;
  recordDialog: State;
  recordSaving: MutableRefObject<boolean>;
  setIsSavingRecord?: Dispatch<SetStateAction<boolean>>;
  conditions: Record<string, Condition>;
  paginationModel: { page: number; pageSize: number };
  t: TFunction;
  formatSqlValue: (column: ColumnDefinition, value: unknown, fromGrid?: boolean) => string | number;
  executeSearch: (conditions: Record<string, Condition>, page: number, pageSize: number) => Promise<void>;
  setRecordDialog: Dispatch<SetStateAction<State>>;
  setDataContextMenu: Dispatch<SetStateAction<{ mouseX: number; mouseY: number; row: DatabaseRow } | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLogs: Dispatch<SetStateAction<TableDataLogEntry[]>>;
  setBottomTab: Dispatch<SetStateAction<number>>;
  setResultRows: Dispatch<SetStateAction<DatabaseRow[]>>;
}
