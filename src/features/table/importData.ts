// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { TFunction } from 'i18next';

export function confirmImportBatch(rowsAffected: number | undefined, expected: number) {
  if (rowsAffected === undefined || !Number.isSafeInteger(rowsAffected) || rowsAffected < 0 || rowsAffected > expected) {
    return { confirmed: 0, error: 'import_count_unconfirmed' as const };
  }
  return { confirmed: rowsAffected, error: rowsAffected === expected ? null : 'import_count_mismatch' as const };
}

export function resolveImportColumns(headers: string[], columns: string[], t: TFunction): string[] {
  const used = new Set<string>();
  return headers.map(header => {
    // CSV parsing has already removed CSV quoting. Preserve literal identifier characters.
    let matches = columns.filter(column => column === header);
    if (matches.length === 0) {
      const normalized = header.trim().toUpperCase();
      matches = columns.filter(column => column.trim().toUpperCase() === normalized);
    }
    if (matches.length > 1) throw new Error(t('import_column_ambiguous', { column: header }));
    const selected = matches[0] || '';
    if (selected && used.has(selected)) throw new Error(t('import_column_duplicate', { column: header }));
    if (selected) used.add(selected);
    return selected;
  });
}

export function parseDelimitedText(input: string, delimiter: string, t: TFunction): string[][] {
  if (delimiter !== ',' && delimiter !== '\t') throw new Error('Unsupported delimiter.');
  const text = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [], value = '';
  let mode: 'plain' | 'quoted' | 'closed' = 'plain';
  let hasContent = false, line = 1;
  const invalid = () => new Error(t('import_delimited_text_invalid', { line }));
  const finishRow = () => {
    // A delimiter, quotes, or whitespace constitutes a record, even when every value is empty.
    if (hasContent) records.push([...row, value]);
    row = []; value = ''; mode = 'plain'; hasContent = false;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (mode === 'quoted') {
      if (char === '"') {
        if (text[index + 1] === '"') { value += '"'; index++; }
        else mode = 'closed';
      } else {
        value += char;
        if (char === '\n' || (char === '\r' && text[index + 1] !== '\n')) line++;
      }
      continue;
    }
    if (char === delimiter) {
      row.push(value); value = ''; mode = 'plain'; hasContent = true;
    } else if (char === '\n' || char === '\r') {
      finishRow();
      if (char === '\r' && text[index + 1] === '\n') index++;
      line++;
    } else if (char === '"' && mode === 'plain' && value === '') {
      mode = 'quoted'; hasContent = true;
    } else {
      if (mode === 'closed' || char === '"') throw invalid();
      value += char; hasContent = true;
    }
  }
  if (mode === 'quoted') throw invalid();
  finishRow();
  return records;
}

export function previewImport(records: string[][], columns: string[], isHeader: boolean, t: TFunction) {
  const data = records.slice(isHeader ? 1 : 0);
  if (data.length === 0) throw new Error(t('no_data_to_import'));
  const width = records[0].length;
  const targets = isHeader ? resolveImportColumns(records[0], columns, t) : records[0].map((_, index) => columns[index] || '');
  if (targets.every(column => !column)) throw new Error(t('import_delimited_column_mismatch'));
  const invalidRow = data.findIndex(row => row.length !== width);
  if (invalidRow !== -1) throw new Error(t('import_preview_width_error', { row: invalidRow + (isHeader ? 2 : 1), expected: width, actual: data[invalidRow].length }));
  return { targets, rowCount: data.length, sample: data.slice(0, 10) };
}
