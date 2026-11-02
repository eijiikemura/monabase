// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { tokenizeSql } from '@/features/sql/sqlScript';
import type { SqlData } from '@/shared/api/desktopContract';
import type { CompileError } from '@/features/stored/storedCommon';

// ALTER locations belong to generated SQL: map only an unambiguous token into CREATE source.
export function postgresTypeDiagnostics(source: string, statement: string, error: Pick<SqlData, 'errorPosition'> & { error: string }): CompileError[] {
  if (!error.errorPosition) return [];
  const offset = Array.from(statement).slice(0, error.errorPosition - 1).join('').length;
  const failed = tokenizeSql(statement, 'postgresql').find(token => offset >= token.start && offset < token.end);
  if (!failed) return [];
  const same = (text: string, kind: string) => failed.kind === 'word' && kind === 'word' ? text.toLowerCase() === failed.text.toLowerCase() : text === failed.text;
  const matches = tokenizeSql(source, 'postgresql').filter(token => same(token.text, token.kind));
  if (matches.length !== 1) return [];
  const before = source.slice(0, matches[0].start);
  return [{ line: before.split('\n').length, col: before.split('\n').at(-1)!.length + 1, text: error.error }];
}
