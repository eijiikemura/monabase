// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { getErrorMessage } from '@/shared/utils/errorUtils';

interface DeleteBatch { sql: string; expected: number }
interface DeleteResponse { success: boolean; rowsAffected?: number; error?: string }
interface DeleteStep extends DeleteBatch { affected?: number; error?: string }

// Stop at the first mismatch. Keep prior successful statements pending for the user's decision.
export async function deleteRecordBatches(batches: DeleteBatch[], execute: (sql: string) => Promise<DeleteResponse>) {
  const steps: DeleteStep[] = [];
  let confirmedCount = 0;
  for (const batch of batches) {
    let response: DeleteResponse;
    try { response = await execute(batch.sql); }
    catch (error) {
      steps.push({ ...batch, error: getErrorMessage(error) });
      return { status: 'failed' as const, confirmedCount, steps };
    }
    if (!response.success) {
      steps.push({ ...batch, error: response.error ?? 'Database deletion failed.' });
      return { status: 'failed' as const, confirmedCount, steps };
    }
    const count = response.rowsAffected;
    if (count === undefined || !Number.isSafeInteger(count) || count < 0 || count > batch.expected) {
      steps.push({ ...batch });
      return { status: 'unconfirmed' as const, confirmedCount, steps };
    }
    confirmedCount += count;
    steps.push({ ...batch, affected: count });
    if (count !== batch.expected) return { status: 'mismatch' as const, confirmedCount, steps };
  }
  return { status: 'complete' as const, confirmedCount, steps };
}
