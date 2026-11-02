// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface OraclePrincipalTarget { identity: string; name: string; kind: 'USER' | 'ROLE'; }
export interface OraclePrincipal extends OraclePrincipalTarget {
 id: string | null; created: string | null; status: string | null; locked: boolean | null; authentication: string | null; common: boolean; maintained: boolean; self: boolean; protected: boolean;
 profile: string | null; defaultTablespace: string | null; temporaryTablespace: string | null; expiry: string | null; canPassword: boolean; canLock: boolean; canDrop: boolean; canQuota: boolean; fingerprint: string;
}
export interface OraclePrincipalGrant { grantee: string; name: string; kind: 'ROLE' | 'SYSTEM'; admin: boolean; defaultRole: boolean | null; common: boolean; inherited: boolean | null; }
export interface OraclePrincipalSnapshot {
 principals: OraclePrincipal[]; grants: OraclePrincipalGrant[]; fetchedAt: string;
 context: { database: string; containerId: string; container: string; user: string; readonly: boolean; scope: 'all' | 'visible'; modern: boolean; maxNameBytes: number; privileges: string[]; canCreateUser: boolean; canCreateRole: boolean; };
}
export interface OraclePrincipalDetail {
 target: OraclePrincipal; grants: (OraclePrincipalGrant & { canRevoke: boolean })[]; effective: (OraclePrincipalGrant & { source: string; direct: boolean })[];
 candidates: { kind: 'ROLE' | 'SYSTEM'; name: string }[]; related: OraclePrincipalGrant[];
 dependencies: { owner: string; name: string; kind: string; relation: string }[]; dependencyCount: number; dependenciesTruncated: boolean; dependenciesError: string;
 quotas: { tablespace: string; usedBytes: string; maxBytes: string | null }[]; quotaError: string; unlimited: boolean; fingerprint: string; fetchedAt: string;
}
export interface OraclePrincipalRequest {
 action: 'create' | 'password' | 'lock' | 'drop' | 'grant' | 'revoke' | 'quota'; kind?: 'USER' | 'ROLE'; newName?: string; target?: OraclePrincipalTarget; expected?: string;
 locked?: boolean; cascade?: boolean; privilegeKind?: 'ROLE' | 'SYSTEM'; privilege?: string; admin?: boolean;
 tablespace?: string; amount?: string; unit?: 'B' | 'K' | 'M' | 'G' | 'T'; unlimited?: boolean;
}
export interface OraclePrincipalReview { request: OraclePrincipalRequest; sql: string; detail: OraclePrincipalDetail | null; token: string; }
export interface OraclePrincipalExecution extends OraclePrincipalRequest { token: string; password?: string; confirmName?: string; }
export interface OraclePrincipalResult { snapshot: OraclePrincipalSnapshot; selectedIdentity: string | null; applied: boolean; }
export interface OraclePrincipalFailure { errorCode?: string; applied?: boolean; }
