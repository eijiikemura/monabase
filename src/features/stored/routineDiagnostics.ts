// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { tokenizePgSql } from '@/features/postgresql/sqlTokens';
import type { CompileError } from '@/features/stored/storedCommon';
export function routineDiagnostics(source: string, error: { error: string; errorPosition?: number; errorContext?: string }): CompileError[] {
  if (error.errorPosition && error.errorPosition > 0) {
    const before = Array.from(source).slice(0, error.errorPosition - 1).join('');
    return [{ line: before.split('\n').length, col: before.split('\n').at(-1)!.length + 1, text: error.error }];
  }
  const match = error.errorContext?.match(/(?:near\s+)?line\s+(\d+)/i);
  if (match) {
    try {
      const tokens = tokenizePgSql(source);
      const at = tokens.findIndex((token, i) => /^AS$/i.test(token.text) && tokens[i + 1]?.kind === 'dollar');
      if (at >= 0) return [{ line: source.slice(0, tokens[at + 1].start).split('\n').length + Number(match[1]) - 1, col: 1, text: error.error }];
    } catch { /* Keep server diagnostics in the log when the source cannot be mapped. */ }
  }
  return [];
}
