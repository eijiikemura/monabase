// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
export interface MysqlAccount {user:string;host:string;}
export type MysqlAccountAction='create'|'password'|'lock'|'drop'|'grant'|'revoke'|'role-grant'|'role-revoke'|'default-role'|'limits';
export interface MysqlAccountLimits {queries:number;updates:number;connections:number;concurrent:number;}
export interface MysqlAccountRow extends MysqlAccount {id:string;plugin:string|null;passwordChanged?:string|null;locked:boolean|null;expired:boolean|null;protected:boolean;self:boolean;referencedRole:boolean;limits:MysqlAccountLimits;}
export interface MysqlAccountGrant {scope:'global'|'database';database:string;privilege:string;grantable:boolean;}
export interface MysqlAccountRole extends MysqlAccount {admin:boolean;defaultRole:boolean;}
export interface MysqlAccountSnapshot {
 accounts:MysqlAccountRow[];context:{server:string;current:MysqlAccount;scope:'all'|'self';readonly:boolean;canCreate:boolean;canGrant:boolean;canRole:boolean;canDrop:boolean;roles:string};fetchedAt:string;
}
export interface MysqlAccountDetail {target:MysqlAccountRow;grants:MysqlAccountGrant[];roles:MysqlAccountRole[];recipients:MysqlAccountRole[];grantSql:string[];definers:{schema:string;name:string;kind:string}[];dependenciesComplete:boolean;fingerprint:string;databases:string[];privileges:string[];roleCandidates:MysqlAccount[];}
export interface MysqlAccountRequest {action:MysqlAccountAction;target:MysqlAccount;expected?:string;kind?:'USER'|'ROLE';locked?:boolean;privilege?:string;scope?:'global'|'database';database?:string;role?:MysqlAccount|null;limits?:MysqlAccountLimits;}
export interface MysqlAccountReview {token:string;sql:string;request:MysqlAccountRequest;expiresAt:string;}
export interface MysqlAccountExecution {token:string;password?:string;confirm:string;acknowledged:boolean;}
export interface MysqlAccountOutcome {applied:boolean;outcome:'applied'|'failed'|'unknown';errorCode?:string;}
