// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import type { TFunction } from 'i18next';
import type { RequestArgs, RequestResult } from '@/shared/api/desktopContract';
import { ipcRenderer } from '@/shared/api/desktop';
import { getErrorMessage } from '@/shared/utils/errorUtils';

type HistoryCommand = 'get-sql-history' | 'add-sql-history' | 'clear-sql-history';

export async function invokeSqlHistory<C extends HistoryCommand>(t: TFunction, command: C, ...args: RequestArgs<C>): Promise<RequestResult<C> | null> {
  return invokeSqlHistoryWhen(() => true, t, command, ...args);
}

export async function invokeSqlHistoryWhen<C extends HistoryCommand>(current: () => boolean, t: TFunction, command: C, ...args: RequestArgs<C>): Promise<RequestResult<C> | null> {
  try {
    return await ipcRenderer.invoke(command, ...args);
  } catch (error) {
    // History failures must not change the outcome of a completed database operation.
    if (current()) notify(t('sql_history_operation_failed', { error: getErrorMessage(error) }));
    return null;
  }
}
