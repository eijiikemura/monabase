// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export type DirectoryPrivilege = 'READ' | 'WRITE' | 'EXECUTE';
export interface DirectoryDefinition { name: string; path: string; owner: string; objectId: string | null; ddlTime: string; }
export interface DirectoryPrincipal { name: string; kind: 'user' | 'role' | 'public' | 'unknown'; maintained: boolean; }
export interface DirectoryContext { user: string; readonly: boolean; canCreate: boolean; canDrop: boolean; grantAny: boolean; roles: string[]; }
export interface DirectoryGrant { grantee: string; grantor: string; privilege: DirectoryPrivilege; grantable: boolean; canRevoke: boolean; }
export interface DirectoryList { context: DirectoryContext; directories: DirectoryDefinition[]; principals: DirectoryPrincipal[]; scope: 'all' | 'visible'; rolesComplete: boolean; }
export interface DirectoryDetail {
  directory: DirectoryDefinition; grants: DirectoryGrant[]; scope: 'all' | 'visible'; fingerprint: string;
  context: DirectoryContext; canGrant: { READ: boolean; WRITE: boolean };
  sessionGrants: DirectoryGrant[];
}
export interface DirectoryMutation {
  action: 'create' | 'replace' | 'drop' | 'grant' | 'revoke'; name: string;
  path?: string; expected?: string; grantee?: string; privilege?: 'READ' | 'WRITE';
}
