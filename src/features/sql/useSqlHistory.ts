// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invokeSqlHistoryWhen } from '@/features/sql/sqlHistory';
import type { SqlHistoryEntry } from '@/shared/types/sqlTypes';

// Serialize local operations and version their views, including reads queued before a clear.
export function useSqlHistory() {
  const { t } = useTranslation();
  const [historyLogs, setHistoryLogs] = useState<SqlHistoryEntry[]>([]);
  const generation = useRef(0), mounted = useRef(true), queue = useRef(Promise.resolve());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = useCallback((command: 'get-sql-history' | 'add-sql-history' | 'clear-sql-history', entry?: Omit<SqlHistoryEntry, 'id'>) => {
    const version = ++generation.current;
    const task = queue.current.then(async () => {
      const result = command === 'add-sql-history' && entry ? await invokeSqlHistoryWhen(() => mounted.current, t, command, entry) :
        command === 'clear-sql-history' ? await invokeSqlHistoryWhen(() => mounted.current, t, command) : await invokeSqlHistoryWhen(() => mounted.current, t, 'get-sql-history');
      if (mounted.current && version === generation.current && result) setHistoryLogs(result);
    });
    queue.current = task.catch(() => {});
    return task;
  }, [t]);
  useEffect(() => { void run('get-sql-history'); }, [run]);
  return { historyLogs, addHistory: useCallback((entry: Omit<SqlHistoryEntry, 'id'>) => run('add-sql-history', entry), [run]),
    clearHistory: useCallback(() => run('clear-sql-history'), [run]) };
}
