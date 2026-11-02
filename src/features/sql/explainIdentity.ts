// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { ObjectIdentity } from '@/shared/types/objectTypes';

// Display names can be aliases or index names; only structured table metadata is actionable.
export function oraclePlanTableIdentity(row: DatabaseRow): ObjectIdentity | undefined {
  const owner = row.PLAN_OBJECT_OWNER;
  const name = row.PLAN_OBJECT_NAME;
  const type = row.PLAN_OBJECT_TYPE;
  if (typeof owner !== 'string' || !owner || typeof name !== 'string' || !name ||
      typeof type !== 'string' || type.trim().toUpperCase() !== 'TABLE') return undefined;
  return { schema: owner, objectName: name };
}
