// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ObjectIdentity } from '@/shared/types/objectTypes';

export const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;
export const escapeSqlString = (value: string): string => value.replace(/'/g, "''");
export function qualifiedObjectName({ schema, objectName }: ObjectIdentity): string {
  return schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(objectName)}` : quoteIdentifier(objectName);
}

// Legacy unquoted references are accepted; new references always quote each name separately.
export function parseObjectIdentity(value: string, defaultSchema = ''): ObjectIdentity {
  let quoted = false, separator = -1;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') {
      if (quoted && value[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (value[index] === '.' && !quoted && separator < 0) separator = index;
  }
  if (quoted) throw new Error('Unterminated quoted object name.');
  const decode = (part: string) => {
    const trimmed = part.trim();
    return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).replace(/""/g, '"') : trimmed;
  };
  return separator < 0 ? { schema: defaultSchema, objectName: decode(value) }
    : { schema: decode(value.slice(0, separator)), objectName: decode(value.slice(separator + 1)) };
}
export function splitObjectName(value: string, defaultSchema = ''): [string, string] {
  const { schema, objectName } = parseObjectIdentity(value, defaultSchema);
  return [schema, objectName];
}
