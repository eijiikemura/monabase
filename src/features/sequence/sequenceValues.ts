// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Validate exact integer literals before embedding them in sequence DDL.
export function sequenceInteger(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('Unsafe sequence integer.');
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Missing sequence integer.');
  const text = String(value).trim();
  if (!/^[+-]?\d+$/.test(text)) throw new Error('Invalid sequence integer.');
  return BigInt(text).toString();
}

export function sequenceDefaults(database: 'oracle' | 'postgresql', increment: string, dataType = 'bigint') {
  const ascending = BigInt(sequenceInteger(increment)) > 0n;
  if (database === 'oracle') return {
    min: ascending ? '1' : (-(10n ** 27n - 1n)).toString(),
    max: ascending ? (10n ** 28n - 1n).toString() : '-1'
  };
  const bits = dataType === 'smallint' ? 16n : dataType === 'integer' ? 32n : dataType === 'bigint' ? 64n : undefined;
  if (!bits) return undefined;
  return { min: ascending ? '1' : (-(2n ** (bits - 1n))).toString(), max: ascending ? (2n ** (bits - 1n) - 1n).toString() : '-1' };
}
