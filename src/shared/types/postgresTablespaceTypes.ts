// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { PgPrivilegeContext, PgPrivilegePrincipal } from './postgresPrivilegeTypes';
export interface PgTablespaceTarget { oid: string; identity: string; name: string; }
export interface PgTablespace extends PgTablespaceTarget {
  ownerId: string; owner: string; location: string; locationKind: 'default' | 'global' | 'custom'; options: string[]; protected: boolean;
  canRename: boolean; canDrop: boolean; canChangeOwner: boolean; fingerprint: string;
}
export interface PgTablespaceSnapshot {
  tablespaces: PgTablespace[]; principals: PgPrivilegePrincipal[];
  context: PgPrivilegeContext & { maxIdentifierLength: number; defaultId: string; canCreate: boolean; scope: 'cluster' }; fetchedAt: string;
}
export interface PgTablespaceDetail {
  tablespace: PgTablespace; bytes: string | null; sizeError: string; databasesError: string;
  databases: { oid: string; name: string; default_space: boolean; has_files: boolean }[];
  objects: { oid: string; schema: string; name: string; kind: string; total: string }[]; objectCount: number; objectsTruncated: boolean;
  ownerCandidates: string[]; fingerprint: string; fetchedAt: string;
}
export interface PgTablespaceRequest { action: 'create' | 'rename' | 'owner' | 'drop'; target?: PgTablespaceTarget; expected?: string; newName?: string; ownerId?: string; location?: string; }
export interface PgTablespaceReview { request: PgTablespaceRequest; sql: string; detail: PgTablespaceDetail | null; token: string; }
export interface PgTablespaceExecution extends PgTablespaceRequest { token: string; confirmName?: string; }
export interface PgTablespaceResult { snapshot: PgTablespaceSnapshot; selectedOid: string | null; applied: boolean; }
export interface PgTablespaceFailure { errorCode?: string; applied?: boolean; }
