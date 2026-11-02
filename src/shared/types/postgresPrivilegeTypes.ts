// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export type PgPrivilegeType = 'SCHEMA' | 'TABLE' | 'VIEW' | 'MATERIALIZED VIEW' | 'SEQUENCE' | 'FUNCTION' | 'PROCEDURE';
export interface PgPrivilegeTarget { type: PgPrivilegeType; oid: string; schema: string; name: string; databaseId: string; identity: string; args: string; label: string; }
export interface PgPrivilegeContext { database: string; databaseId: string; user: string; userId: string; readonly: boolean; version: number; }
export interface PgPrivilegePrincipal { id: string; name: string; login: boolean; superuser: boolean; usable: boolean; settable: boolean; kind: 'user' | 'role' | 'public'; }
export interface PgPrivilegeGrant { grantee_id: string; grantor_id: string; privilege: string; grantable: boolean; source: 'default' | 'acl'; canRevoke: boolean; }
export interface PgColumnGrant { column: string; grantee_id: string; grantor_id: string; privilege: string; grantable: boolean; }
export interface PgEffectivePrivilege { principal_id: string; privilege: string; effective: boolean; column_effective: boolean; schema_usage: boolean; sources: string[]; }
export interface PgPrivilegeDetail {
  object: PgPrivilegeTarget; ownerId: string; owner: string; context: PgPrivilegeContext; principals: PgPrivilegePrincipal[]; grants: PgPrivilegeGrant[]; columnGrants: PgColumnGrant[];
  privileges: string[]; effective: PgEffectivePrivilege[]; grantors: Record<string, string[]>; fingerprint: string; fetchedAt: string;
}
export interface PgPrivilegeListRequest { schema: string; type: PgPrivilegeType; search: string; offset: number; }
export interface PgPrivilegeList { objects: PgPrivilegeTarget[]; hasMore: boolean; context: PgPrivilegeContext; }
export interface PgPrivilegeRequest { object: PgPrivilegeTarget; action: 'grant' | 'revoke'; principalId: string; privilege: string; expected: string; grantorId?: string; grantOption?: boolean; grantOptionOnly?: boolean; }
export interface PgPrivilegeReview { request: PgPrivilegeRequest; sql: string; grantor: PgPrivilegePrincipal; issuer: PgPrivilegePrincipal; principal: PgPrivilegePrincipal; detail: PgPrivilegeDetail; affectedColumns: string[]; token: string; }
export interface PgPrivilegeExecution extends PgPrivilegeRequest { token: string; }
export interface PgPrivilegeFailure { errorCode?: string; applied?: boolean; }
