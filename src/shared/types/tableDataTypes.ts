// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface TableDataLogEntry {
  time: string;
  sql: string;
  resultMsg: string;
  errorLines?: string[];
}
