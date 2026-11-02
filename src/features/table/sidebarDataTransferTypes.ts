// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { TFunction } from 'i18next';
import type { GridColDef } from '@mui/x-data-grid';
import type { ColumnDefinition } from '@/shared/types/databaseTypes';

export interface SidebarTransferMenu { schema?: string; value: string; objType?: string; }
export interface SidebarImportTarget { schema: string; tableName: string; structureDefs: ColumnDefinition[]; }
export interface SidebarExportTarget {
  schema: string;
  tableName: string;
  columns: GridColDef[];
  totalCount: number;
  structureDefs?: ColumnDefinition[];
}
export interface SidebarTransferContext<Menu extends SidebarTransferMenu, Export extends SidebarExportTarget = SidebarExportTarget> {
  sidebarContextMenu: Menu | null;
  setSidebarContextMenu: Dispatch<SetStateAction<Menu | null>>;
  exportTarget: Export | null;
  setExportTarget: Dispatch<SetStateAction<Export | null>>;
  importTarget: SidebarImportTarget | null;
  setImportTarget: Dispatch<SetStateAction<SidebarImportTarget | null>>;
  exportContainerRef: RefObject<HTMLDivElement>;
  importContainerRef: RefObject<HTMLDivElement>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  outputDateFormat: string;
  t: TFunction;
}
