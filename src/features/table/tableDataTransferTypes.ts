// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Dispatch, SetStateAction } from 'react';
import type { GridColDef } from '@mui/x-data-grid';
import type { useTranslation } from 'react-i18next';
import type { Condition } from '@/shared/types/queryConditions';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';
import type { TableDataLogEntry } from '@/shared/types/tableDataTypes';

export interface TableDataTransferContext {
  schema: string;
  tableName: string;
  structureDefs: ColumnDefinition[];
  resultColumns: GridColDef[];
  outputDateFormat: string;
  conditions: Record<string, Condition>;
  paginationModel: { page: number; pageSize: number };
  t: ReturnType<typeof useTranslation>['t'];
  formatSqlValue: (column: ColumnDefinition, value: unknown, fromGrid?: boolean) => unknown;
  buildQueryStrings: (conditions: Record<string, Condition>) => { whereStr: string; orderStr: string };
  executeSearch: (conditions: Record<string, Condition>, page: number, pageSize: number) => Promise<void>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setLogs: Dispatch<SetStateAction<TableDataLogEntry[]>>;
  setBottomTab: Dispatch<SetStateAction<number>>;
}
