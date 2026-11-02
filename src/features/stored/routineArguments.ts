// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { tokenizeSql } from '@/features/sql/sqlScript';
import type { ArgInfo } from '@/features/stored/storedCommon';
export type ArgumentMode = 'value' | 'null' | 'default';
export type ArgumentModes = Record<string, ArgumentMode>;
export const hasArgumentDefault = (arg: ArgInfo) => arg.DEFAULTED === 'Y' || arg.DEFAULT_LENGTH > 0;
export function argumentMode(arg: ArgInfo, modes: ArgumentModes, _values: Record<string, string>): ArgumentMode {
  return modes[arg.ARGUMENT_NAME] || 'value';
}
// Catalog default expressions may contain commas in functions, arrays, quoted text and nested expressions.
export function splitDefaultExpressions(source: string): string[] {
  if (!source.trim()) return [];
  const result: string[] = []; let depth = 0, start = 0;
  for (const token of tokenizeSql(source, 'postgresql')) {
    if (token.kind !== 'symbol') continue;
    if (['(', '['].includes(token.text)) depth++;
    else if ([')', ']'].includes(token.text)) depth--;
    else if (token.text === ',' && depth === 0) { result.push(source.slice(start, token.start).trim()); start = token.end; }
  }
  result.push(source.slice(start).trim()); return result;
}
