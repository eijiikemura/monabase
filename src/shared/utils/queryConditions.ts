// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Condition } from '@/shared/types/queryConditions';

export function hasConditionInput(condition: Condition | undefined, includeSort = true) {
  return Boolean(condition && condition.type !== 'DISABLED' &&
    (condition.value !== '' || includeSort && condition.sort.trim()));
}

// Clear drafts atomically; preserve column types, exclusions and the original objects.
export function clearConditionInputs(conditions: Record<string, Condition>): Record<string, Condition> {
  return Object.fromEntries(Object.entries(conditions).map(([name, condition]) =>
    [name, { ...condition, value: '', sort: '', operator: '=' }]));
}
