// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ObjectIdentity } from '@/shared/types/objectTypes';

export interface PgTriggerIdentity extends ObjectIdentity { tableName: string; }
export function triggerTabKey(identity: PgTriggerIdentity): string {
  return '@pg-trigger:' + JSON.stringify({ schema: identity.schema, tableName: identity.tableName, objectName: identity.objectName });
}
export function parseTriggerTab(value?: string): PgTriggerIdentity | undefined {
  if (!value?.startsWith('@pg-trigger:')) return undefined;
  const identity: unknown = JSON.parse(value.slice('@pg-trigger:'.length));
  if (!identity || typeof identity !== 'object' || !('schema' in identity) || !('tableName' in identity) || !('objectName' in identity) ||
      typeof identity.schema !== 'string' || !identity.schema || typeof identity.tableName !== 'string' || !identity.tableName ||
      typeof identity.objectName !== 'string' || !identity.objectName) throw new Error('Invalid trigger tab identity.');
  return { schema: identity.schema, tableName: identity.tableName, objectName: identity.objectName };
}
