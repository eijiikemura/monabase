// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DatabaseRow } from './databaseTypes';

export interface LogEntry { time: string; sql: string; execTime: string | number; resultMsg: string; errorLines?: string[]; }

export interface SqlHistoryEntry { id: string; executeTime: string; sql: string; duration: string | number; rowCount: number | null; }


// Keep the exact analyzed statement and its context independent of the live editor.
export interface ExplainSnapshot {
  readonly sql: string;
  readonly schema?: string;
  readonly rows: DatabaseRow[];
  readonly binds?: readonly { name: string; placeholder: string; type: string; value: string | null }[];
  readonly planKind?: 'estimated';
  readonly planningDurationMs?: number;
  readonly observedExecution?: { requestDurationMs: number | null; returnedRowCount: number; completedAt: string };
}

// Describes the displayed successful result, never a later statement or editor draft.
export interface SqlResultSummary {
  rowCount: number | null;
  durationMs: number | null;
  completedAt: string;
}
