// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Ignore END inside comments and strings to locate the final block terminator.
export function findTraceBlockEnd(lines: string[]): number {
  const source = lines.join('\n');
  const masked = source.replace(
    /--[^\n]*|\/\*[\s\S]*?\*\/|\bq'\[[\s\S]*?\]'|\bq'\{[\s\S]*?\}'|\bq'\([\s\S]*?\)'|\bq'<[\s\S]*?>'|'(?:[^']|'')*'/gi,
    value => value.replace(/[^\n]/g, ' ')
  );
  const endPattern = /^\s*END(?:\s+("(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$#]*))?\s*;/iu;
  const maskedLines = masked.split('\n');
  for (let i = maskedLines.length - 1; i >= 0; i--) {
    const match = maskedLines[i].match(endPattern);
    if (match && !/^(IF|LOOP|CASE)$/i.test(match[1] || '')) return i;
  }
  return -1;
}

// Remove only the original closing name because the destination is a different block.
export function removeTraceBlockEndName(line: string): string {
  return line.replace(/^(\s*END)\s+(?:"(?:[^"]|"")+"|[\p{L}_][\p{L}\p{N}_$#]*)(\s*;)/iu, '$1$2');
}
