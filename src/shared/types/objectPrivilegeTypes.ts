// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ObjectCategory } from './objectTypes';
export interface PrivilegeTarget { owner: string; name: string; type: ObjectCategory; }
export interface PrivilegePrincipal { name: string; kind: 'user' | 'role' | 'public' | 'unknown'; maintained: boolean; }
export interface PrivilegePrincipals { principals: PrivilegePrincipal[]; rolesComplete: boolean; }
export interface ObjectGrant { grantee: string; grantor: string; privilege: string; grantable: boolean; hierarchy: boolean; common: boolean; inherited: boolean; canRevoke: boolean; }
export interface ObjectColumnGrant { grantee: string; grantor: string; column: string; privilege: string; grantable: boolean; }
export interface ObjectPrivilegeDetail {
  object: PrivilegeTarget; context: { user: string; readonly: boolean; grantAny: boolean };
  grants: ObjectGrant[]; columnGrants: ObjectColumnGrant[]; privileges: string[];
  canGrant: Record<string, boolean>; scope: 'all' | 'visible'; fingerprint: string;
}
export interface ObjectPrivilegeMutation { object: PrivilegeTarget; action: 'grant' | 'revoke'; grantee: string; privilege: string; expected: string; }
