// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const decimalPattern = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/;

// Retain database precision instead of routing exact values through JavaScript Number.
export function numericSqlLiteral(value: unknown): string {
  const text = String(value).trim();
  if (decimalPattern.test(text)) return text;
  if (/^(NaN|[+-]?Infinity)$/i.test(text)) return `'${text}'`;
  throw new Error('Invalid numeric value.');
}

// Trace input must be a finite decimal literal; preserve every supplied digit.
export function finiteNumericSqlLiteral(value: unknown): string {
  const text = String(value).trim();
  if (!decimalPattern.test(text)) throw new Error('Invalid finite numeric value.');
  return text;
}

function decimalParts(value: unknown) {
  const match = decimalPattern.exec(String(value));
  if (!match) return undefined;
  const fraction = match[3] ?? match[4] ?? '';
  const digits = ((match[2] ?? '') + fraction).replace(/^0+/, '') || '0';
  return { negative: match[1] === '-' && digits !== '0', digits,
    magnitude: digits === '0' ? 0n : BigInt(digits.length) + BigInt(match[5] ?? '0') - BigInt(fraction.length) };
}

export function compareNumericValues(left: unknown, right: unknown): number {
  if (left == null || right == null) return left == null ? (right == null ? 0 : -1) : 1;
  const a = decimalParts(left), b = decimalParts(right);
  if (!a || !b) {
    const rank = (value: unknown) => /^-Infinity$/i.test(String(value)) ? -1 : /^\+?Infinity$/i.test(String(value)) ? 1 : /^NaN$/i.test(String(value)) ? 2 : 0;
    return rank(left) - rank(right) || String(left).localeCompare(String(right));
  }
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  let result = 0;
  if (a.digits === '0' || b.digits === '0') result = a.digits === '0' ? (b.digits === '0' ? 0 : -1) : 1;
  else if (a.magnitude !== b.magnitude) result = a.magnitude < b.magnitude ? -1 : 1;
  else {
    const length = Math.max(a.digits.length, b.digits.length);
    const first = a.digits.padEnd(length, '0'), second = b.digits.padEnd(length, '0');
    result = first < second ? -1 : first > second ? 1 : 0;
  }
  return a.negative ? -result : result;
}
