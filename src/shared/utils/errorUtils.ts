// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// IPC may return values other than Error; inspect them before creating display text.
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}
