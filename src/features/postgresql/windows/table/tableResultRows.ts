// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { withRowIdentity } from '@/features/data-grid/rowIdentity';
import type { TFunction } from 'i18next';
import type { ColumnDefinition, DatabaseRow } from '@/shared/types/databaseTypes';
import { formatDbDate } from '@/shared/utils/dateFormatter';

// Normalize driver values consistently for initial and paginated results.
export function formatTableResultRows(rows: DatabaseRow[], structureDefs: ColumnDefinition[], outputDateFormat: string, t: TFunction, offset = 0) {
  return rows.map((r: DatabaseRow, i: number) => {
    const rowData: DatabaseRow = withRowIdentity(r, offset + i + 1);
    structureDefs.forEach(col => {
      const tUp = col.DATA_TYPE.toUpperCase();
      const colName = col.COLUMN_NAME;
      if (tUp.includes('DATE') || tUp.includes('TIMESTAMP')) {
        let currentFormat = outputDateFormat;
        if (tUp === 'DATE' && currentFormat.match(/H|h|m|s/i)) {
          currentFormat = currentFormat.split(' ')[0];
        }
        rowData[colName] = formatDbDate(rowData[colName], currentFormat);
      } else if (tUp.includes('BYTEA')) {
        if (rowData[colName] != null) rowData[colName] = '[BYTEA' + t("data_2");
      }
    });
    return rowData;
  });
}
