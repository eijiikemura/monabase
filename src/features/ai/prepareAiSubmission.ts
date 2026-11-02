// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { AiContext, SelectedAiObject } from '@/shared/types/aiTypes';
import { hasRequiredPackageHeader } from './packageHeaderRequirement';

interface SubmissionOptions {
  text: string;
  isLoading: boolean;
  hasActiveRequest: boolean;
  isHistoryReady: boolean;
  context: AiContext | null;
  allowEmptySelection: boolean;
  headerMessage: string;
  targetMessage: string;
}
export type AiSubmission =
  | { status: 'blocked' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; text: string; targets: readonly SelectedAiObject[] | undefined };

// Re-read the selection after target validation, which may synchronize the current editor.
export function prepareAiSubmission(options: SubmissionOptions): AiSubmission {
  const text = options.text.trim();
  if (!text || options.isLoading || options.hasActiveRequest || !options.isHistoryReady) {
    return { status: 'blocked' };
  }
  const validationError = options.context?.validateBeforeSend?.();
  if (validationError) return { status: 'invalid', message: validationError };
  const selection = options.context?.objectSelection;
  const targets = selection?.getSnapshot();
  if (!hasRequiredPackageHeader(targets || [], options.context?.requiredPackageHeader)) {
    return { status: 'invalid', message: options.headerMessage };
  }
  if (targets && (!selection?.isAvailable() ||
      (!options.allowEmptySelection && !targets.length) ||
      targets.some(target => target.status !== 'ready' || !target.reference?.definition))) {
    return { status: 'invalid', message: options.targetMessage };
  }
  return { status: 'ready', text, targets };
}
