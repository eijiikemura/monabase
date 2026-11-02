// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

// Shared fields for creation and editing; preserve screen-specific fields through generics.
export interface ColumnDialogState {
  newColName: string;
  newType: string;
  newLength: string;
  newScale: string;
  newNullable: string;
  newDefault: string;
  newDefaultMode: string;
  newComment: string;
  oldType?: string;
  isPk?: boolean;
}
