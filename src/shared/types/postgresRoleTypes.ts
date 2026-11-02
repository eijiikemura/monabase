// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { PgPrivilegeContext } from './postgresPrivilegeTypes';
export interface PgRoleTarget { oid: string; identity: string; name: string; }
export interface PgRole extends PgRoleTarget {
  login: boolean; superuser: boolean; createDatabase: boolean; createRole: boolean; inherit: boolean; replication: boolean; bypassRls: boolean;
  connectionLimit: number; validUntil: string | null; settings: string[]; system: boolean; self: boolean; protected: boolean;
  canPassword: boolean; canLogin: boolean; canSuperuser: boolean; canDrop: boolean; actorAdmin: boolean; actorUsable: boolean; fingerprint: string;
}
export interface PgRoleMembership { roleId: string; memberId: string; grantorId: string; admin: boolean; inherit: boolean | null; set: boolean | null; }
export interface PgRoleSnapshot { roles: PgRole[]; memberships: PgRoleMembership[]; context: PgPrivilegeContext & { sessionUserId: string; maxIdentifierLength: number; canCreate: boolean; scope: 'cluster' }; fetchedAt: string; }
export interface PgRoleDetail {
  role: PgRole; memberships: (PgRoleMembership & { canRevoke: boolean })[]; members: PgRoleMembership[];
  effectiveRoles: { oid: string; name: string; member: boolean; usable: boolean; settable: boolean; direct: boolean }[];
  candidates: { oid: string; name: string; grantorIds: string[] }[];
  dependencies: { database_id: string; database: string | null; class_id: string; object_id: string; sub_id: number; dependency_type: string; description: string | null; total: string }[];
  dependencyCount: number; dependenciesTruncated: boolean; fingerprint: string; fetchedAt: string;
}
export interface PgRoleRequest {
  action: 'create' | 'password' | 'login' | 'superuser' | 'grant' | 'revoke' | 'drop'; target?: PgRoleTarget; expected?: string;
  newName?: string; login?: boolean; passwordMode?: 'set' | 'none'; enabled?: boolean;
  roleId?: string; grantorId?: string; admin?: boolean; inherit?: boolean; set?: boolean; revokeOption?: 'membership' | 'admin' | 'inherit' | 'set';
}
export interface PgRoleReview { request: PgRoleRequest; sql: string; detail: PgRoleDetail | null; token: string; }
export interface PgRoleExecution extends PgRoleRequest { token: string; confirmName?: string; password?: string; }
export interface PgRoleResult { snapshot: PgRoleSnapshot; selectedOid: string | null; applied: boolean; passwordChanged: boolean; }
