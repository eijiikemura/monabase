// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface CrossTabWindowProps {
  tabId: number;
  isActive: boolean;
  schemas: string[];
  initialSchema: string;
  inputDateFormat: string;
}

export interface LogEntry {
  time: string;
  sql: string;
  execTime: string | number;
  resultMsg: string;
  errorLines?: string[];
}

export interface ColumnInfo {
  name: string;
  type: string;
}

export type CastType = 'STRING' | 'NUMBER' | 'DATE' | 'NONE';

export const GRAPH_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#a4de6c', '#d0ed57'];
