// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { PgPrivilegeContext, PgPrivilegePrincipal, PgPrivilegeDetail } from './postgresPrivilegeTypes';
export interface PgSchemaTarget { oid: string; identity: string; name: string; }
export interface PgManagedSchema extends PgSchemaTarget {
  ownerId: string; owner: string; system: boolean; protected: boolean; extensionOwned: boolean; issuerId: string | null;
  canDrop: boolean; canRename: boolean; canChangeOwner: boolean; fingerprint: string;
}
export interface PgSchemaPrincipal extends PgPrivilegePrincipal { databaseCreate: boolean; }
export interface PgSchemaSnapshot {
  schemas: PgManagedSchema[]; principals: PgSchemaPrincipal[]; context: PgPrivilegeContext & { canCreate: boolean; maxIdentifierLength: number }; fetchedAt: string;
}
export interface PgSchemaObject { class_id: string; object_id: string; sub_id: number; type: string; schema: string | null; name: string | null; identity: string; total: string; }
export interface PgSchemaDetail {
  schema: PgManagedSchema; privileges: PgPrivilegeDetail; ownerCandidates: string[]; objects: PgSchemaObject[]; objectCount: number;
  dependencies: PgSchemaObject[]; dependencyCount: number; dependenciesTruncated: boolean; fingerprint: string; fetchedAt: string;
}
export interface PgSchemaRequest {
  action: 'create' | 'rename' | 'owner' | 'drop'; target?: PgSchemaTarget; expected?: string; newName?: string; ownerId?: string; cascade?: boolean;
}
export interface PgSchemaReview { request: PgSchemaRequest; sql: string; issuer: PgPrivilegePrincipal; detail: PgSchemaDetail | null; token: string; }
export interface PgSchemaChange { action: PgSchemaRequest['action']; oid: string; oldName: string | null; newName: string | null; }
export interface PgSchemaExecution extends PgSchemaRequest { token: string; confirmName?: string; }
export interface PgSchemaResult { snapshot: PgSchemaSnapshot; selectedOid: string | null; applied: boolean; change: PgSchemaChange; }
