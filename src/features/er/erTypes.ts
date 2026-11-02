// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface ErColumn {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  comment: string;
}

export interface ErTableData {
  tableName: string;
  tableComment: string;
  columns: ErColumn[];
  showComments?: boolean;
  showDataType?: boolean;
  logicalMode?: boolean;
  diffStatus?: 'added' | 'deleted' | 'modified';
}

export interface ErRelation {
  parent: string;
  child: string;
  childColumn: string;
  isIdentifying: boolean;
}
