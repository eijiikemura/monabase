// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import type {MysqlAccount,MysqlAccountRow} from './mysqlUserRoleTypes';
export interface MysqlPrivilegeTarget {schema:string;name:string;type:'TABLE'|'VIEW'|'PROCEDURE'|'FUNCTION';}
export interface MysqlObjectGrant {account:MysqlAccount;privilege:string;grantable:boolean;grantor:string|null;column?:string;}
export interface MysqlObjectPrivilegeDetail {
 target:MysqlPrivilegeTarget;principals:MysqlAccountRow[];scope:'all'|'visible';mutable:boolean;readonly:boolean;current:MysqlAccount;privileges:string[];
 grants:MysqlObjectGrant[];columnGrants:MysqlObjectGrant[];complete:boolean;fingerprint:string;
}
export interface MysqlObjectPrivilegeRequest {target:MysqlPrivilegeTarget;grantee:MysqlAccount;privilege:string;action:'grant'|'revoke';expected:string;}
export interface MysqlObjectPrivilegeReview {token:string;sql:string;request:MysqlObjectPrivilegeRequest;expiresAt:string;}
export interface MysqlObjectPrivilegeExecution {token:string;confirm:string;acknowledged:boolean;}
export interface MysqlObjectPrivilegeOutcome {applied:boolean;outcome:'applied'|'failed'|'unknown';detail?:MysqlObjectPrivilegeDetail;refreshError?:string;errorCode?:string;}
