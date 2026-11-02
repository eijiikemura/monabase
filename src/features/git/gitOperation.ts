// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { TFunction } from 'i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import type { RequestArgs, Response } from '@/shared/api/desktopContract';
import { getErrorMessage } from '@/shared/utils/errorUtils';

type GitOperation = 'git-commit' | 'git-delete-object' | 'git-rename-object' | 'git-commit-er' | 'delete-er-diagram';

// Retry only the requested Git operation; never repeat a completed database operation.
export async function runGitOperation<C extends GitOperation>(t: TFunction, channel: C, ...args: RequestArgs<C>): Promise<Response> {
  for (;;) {
    let error: string;
    try {
      const result = await ipcRenderer.invoke(channel, ...args);
      if (result.success) return result;
      error = result.error;
    } catch (cause: unknown) { error = getErrorMessage(cause); }
    const prompt = channel === 'git-commit-er' || channel === 'delete-er-diagram'
      ? t('er_git_operation_failed_retry', { error })
      : t('database_updated_but_git_failed_retry', { error });
    if (!window.confirm(prompt)) return { success: false, error };
  }
}
