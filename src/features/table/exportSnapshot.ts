// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { DatabaseRow } from '@/shared/types/databaseTypes';

export interface ExportDataFetcher {
  (offset: number, limit: number): Promise<DatabaseRow[]>;
  close?: () => Promise<void>;
}

export function createExportSnapshotFetcher(query: () => string, formatRows: (rows: DatabaseRow[]) => DatabaseRow[] = rows => rows): ExportDataFetcher {
  let exportId: string | undefined;
  let opening: Promise<void> | undefined;
  let finished = false;
  const fetch: ExportDataFetcher = async (offset, limit) => {
    if (finished) return [];
    if (!opening) {
      opening = (async () => {
        const result = await ipcRenderer.invoke('open-data-export', query());
        if (!result.success) throw new Error(result.error);
        exportId = result.exportId;
      })();
    }
    await opening;
    if (!exportId) throw new Error('The export snapshot was not initialized.');
    const result = await ipcRenderer.invoke('read-data-export', exportId, offset, limit);
    if (!result.success) throw new Error(result.error);
    finished = result.done;
    return formatRows(result.rows);
  };
  fetch.close = async () => {
    try { await opening; } catch { /* The failed open has already cleaned up its snapshot. */ }
    const id = exportId;
    exportId = undefined;
    opening = undefined;
    finished = false;
    if (id) {
      const result = await ipcRenderer.invoke('close-data-export', id);
      if (!result.success) throw new Error(result.error);
    }
  };
  return fetch;
}
