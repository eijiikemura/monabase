// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnDefinition } from '@/shared/types/databaseTypes';

export type RuleType = 'UNSPECIFIED' | 'SEQ_NUM' | 'SEQ_DATE' | 'RANDOM_NUM' | 'RANDOM_CHAR' | 'RANDOM_DATE' | 'CHOICE' | 'FIXED' | 'DISABLED';

export interface ColumnRule extends ColumnDefinition {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  DATA_LENGTH: number;
  NULLABLE: string;
  ruleType: RuleType;
  nullRatio: number;
  seqStart: number | string;
  seqStep: number | string;
  seqPadZero: boolean;
  seqPrefix: string;
  seqStartDate: string;
  randNumMin: number | string;
  randNumMax: number | string;
  randNumRound: number | string;
  randNumUnique: boolean;
  randCharType: 'ALPHA' | 'NUM' | 'ALPHANUM' | 'ZENKAKU' | 'REGEX';
  randCharFill: boolean;
  randCharUnique: boolean;
  randCharRegex: string;
  randDateMin: string;
  randDateMax: string;
  randDateIncludeTime: boolean;
  randDateUnique: boolean;
  choiceValues: string;
  fixedValue: string;
}


export interface GeneratorForeignKey {
  COLUMN_NAME: string;
  R_OWNER: string;
  R_TABLE_NAME: string;
  R_COLUMN_NAME: string;
}
