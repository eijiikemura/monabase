// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
export interface MysqlTablespace {
  id: string;
  name: string;
  type: string | null;
  rowFormat: string | null;
  pageSize: string | null;
  blockSize: string | null;
  fileSize: string | null;
  allocatedSize: string | null;
  encryption: string | null;
  state: string | null;
  files: { id: string; path: string | null; status: string | null }[];
}
export interface MysqlTablespaceSnapshot { tablespaces: MysqlTablespace[]; fetchedAt: string; }
export interface MysqlTablespaceTarget { id: string; name: string; }
export interface MysqlTablespaceDetail {
  tablespace: MysqlTablespace;
  tables: { id: string; name: string; rowFormat: string | null; columns: string | null }[];
  fetchedAt: string;
}
