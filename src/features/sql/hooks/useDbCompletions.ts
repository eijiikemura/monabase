// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0


import { useState } from 'react';

export interface DbCompletionOption {
  label: string;
  type: string;
  detail?: string;
  info?: string;
}

// Reuse a static empty cache to avoid recreating objects.
const EMPTY_COMPLETIONS: DbCompletionOption[] = [];
const EMPTY_SCHEMA: { [table: string]: DbCompletionOption[] } = {};

/**
 * Database table and column completion hook.
 * Bypass bulk background loading and return lightweight empty definitions immediately
 * to avoid memory exhaustion and editor freezes with very large databases.
 */
export const useDbCompletions = (_targetSchema?: string) => {
  const [dbCompletions] = useState<DbCompletionOption[]>(EMPTY_COMPLETIONS);
  const [dbSchema] = useState<{ [table: string]: DbCompletionOption[] }>(EMPTY_SCHEMA);

  return { dbCompletions, dbSchema };
};