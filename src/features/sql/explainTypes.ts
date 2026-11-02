// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ObjectIdentity } from '@/shared/types/objectTypes';

export interface ExplainNode {
  id: string;
  hasAsterisk: boolean;
  operation: string;
  name: string;
  table?: ObjectIdentity;
  rowsVal: string;
  bytes: string;
  cost: string;
  time: string;
  children: ExplainNode[];
}

export interface PgPlanNode {
  'Node Type'?: string;
  'Join Type'?: string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Alias?: string;
  Schema?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  Filter?: string;
  'Index Cond'?: string;
  'Hash Cond'?: string;
  Plans?: PgPlanNode[];
}
