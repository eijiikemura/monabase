// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { isBinaryFileValue, type BinaryFileValue } from '@/shared/types/databaseTypes';

function binaryContents(value: BinaryFileValue) {
  if (value.data) {
    const data = value.data;
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
    return { length: bytes.length, at: (index: number) => bytes[index] };
  }
  if (typeof value.hex === 'string' && value.hex.length % 2 === 0 && /^[0-9a-f]*$/i.test(value.hex)) {
    const hex = value.hex;
    return { length: hex.length / 2, at: (index: number) => parseInt(hex.slice(index * 2, index * 2 + 2), 16) };
  }
  return null;
}

// File labels and storage representation do not change the bytes stored in the database.
export function recordValuesEqual(current: unknown, initial: unknown): boolean {
  if (Object.is(current, initial)) return true;
  if (!isBinaryFileValue(current) || !isBinaryFileValue(initial)) return false;
  const left = binaryContents(current), right = binaryContents(initial);
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left.at(index) !== right.at(index)) return false;
  }
  return true;
}

export function recordUpdateError(rowsAffected: number | undefined): string | null {
  if (rowsAffected === 1) return null;
  return rowsAffected === 0 ? 'record_update_no_rows' : 'record_update_unconfirmed';
}

export function recordInsertError(rowsAffected: number | undefined): string | null {
  if (rowsAffected === 1) return null;
  return rowsAffected === 0 ? 'record_insert_no_rows' : 'record_insert_unconfirmed';
}
