// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { compareNumericValues } from '@/shared/utils/numberValues';
import type { ColumnMetadata, DatabaseRow } from "@/shared/types/databaseTypes";

import React from 'react';
import type { GridColDef } from '@mui/x-data-grid';
import i18next from 'i18next';
import { formatDbDate, type DbDateFormatOptions } from "@/shared/utils/dateFormatter";

const cellTextStyle: React.CSSProperties = {
  whiteSpace: 'pre',
  fontFamily: 'monospace',
  fontSize: '0.9rem'
};

const boldTextStyle: React.CSSProperties = {
  fontWeight: 'bold'
};

const dateStringRegex = /^\d{4}[-/]\d{2}[-/]\d{2}$/;

/** Safely extract a value from either a params object or a raw value. */
const extractCellValue = (arg: unknown): unknown => {
  if (arg !== null && typeof arg === 'object' && 'value' in arg) {
    return arg.value;
  }
  return arg;
};

/** Format a value using its column metadata. */
export const getFormattedValue = (rawArg: unknown, meta: ColumnMetadata | undefined, dateFormat: string, dateOptions: DbDateFormatOptions = {}): string => {
  const value = extractCellValue(rawArg);
  if (value === null || value === undefined) return '';

  // Do not convert string columns to dates even when values resemble dates.
  // Without type metadata, preserve values unless they are actual Date objects.
  const isDateColumn = meta?.dbTypeName
    ? /^(DATE|TIMESTAMP)\b/i.test(meta.dbTypeName)
    : value instanceof Date;
  if (!isDateColumn) return String(value);

  // Preserve date-only text by default; strict displays also apply the configured calendar format.
  if (dateOptions.preserveDetails !== false && typeof value === 'string' && value.length <= 10 && dateStringRegex.test(value)) {
    return value;
  }

  return formatDbDate(value, dateFormat, dateOptions);
};

/** Build standard DataGrid columns for Oracle and PostgreSQL. */
export const buildGridColumns = (
  metaData: ColumnMetadata[],
  dateFormat: string, 
  extraProps: Partial<GridColDef> = {},
  dateOptions: DbDateFormatOptions = {}
): GridColDef[] => {
  if (!metaData) return [];

  return metaData.map((meta: ColumnMetadata) => {
    const colName = meta.name || meta.column_name || meta.field || '';
    return {
      field: colName,
      headerName: colName,
      flex: 1,
      minWidth: 120,
      ...(/^(NUMBER|NUMERIC|DECIMAL|BIGINT|INTEGER|SMALLINT|REAL|DOUBLE|FLOAT)\b/i.test(meta.dbTypeName ?? '') ? { sortComparator: compareNumericValues } : {}),
      // Apply dateFormat when copying or exporting, whether passed params or a raw value.
      valueFormatter: (arg) => {
        return getFormattedValue(arg, meta, dateFormat, dateOptions);
      },
      // Apply dateFormat when rendering.
      renderCell: (params) => {
        const displayVal = getFormattedValue(params.value, meta, dateFormat, dateOptions);
        return params.value === null
          ? <span data-db-null style={{ ...cellTextStyle, opacity: 0.55, fontStyle: 'italic' }}>NULL</span>
          : <span style={cellTextStyle}>{displayVal}</span>;
      },
      ...extraProps
    };
  });
};

/** Build transposed DataGrid columns for Oracle and PostgreSQL. */
export const buildTransposedColumns = (
  rows: DatabaseRow[],
  dateFormat: string, 
  extraProps: Partial<GridColDef> = {}
): GridColDef[] => {
  const transCols: GridColDef[] = [
    { 
      field: 'colName', 
      headerName: i18next.t("item_name", { defaultValue: "Item Name" }),
      width: 150, 
      renderCell: (params) => (
        <span style={boldTextStyle}>{params.value}</span>
      ),
      ...extraProps
    }
  ];
  
  rows.forEach((_, idx) => {
    transCols.push({
      field: `row_${idx}`,
      headerName: i18next.t("line_2", { num: idx + 1, defaultValue: "Line {{num}}" }),
      flex: 1,
      minWidth: 120,
      valueFormatter: (arg) => {
        // Date columns are already formatted; do not reparse strings without type metadata.
        return getFormattedValue(arg, undefined, dateFormat);
      },
      renderCell: (params) => {
        const displayVal = getFormattedValue(params.value, undefined, dateFormat);
        return params.value === null
          ? <span data-db-null style={{ ...cellTextStyle, opacity: 0.55, fontStyle: 'italic' }}>NULL</span>
          : <span style={cellTextStyle}>{displayVal}</span>;
      },
      ...extraProps
    });
  });
  
  return transCols;
};
