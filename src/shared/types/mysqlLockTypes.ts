// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import type {MysqlSession,MysqlSessionDetail,MysqlSessionOutcome} from './mysqlSessionTypes';
export interface MysqlLock {
 id:string;fingerprint:string;engine:string;lockId:string;transactionId:string;threadId:string|null;
 schema:string|null;table:string|null;index:string|null;partition:string|null;type:string;mode:string;status:string;
 blockers:string[];waiters:string[];session:MysqlSession|null;protected:boolean;canKill:boolean;canCancel:boolean;
}
export interface MysqlLockSnapshot {locks:MysqlLock[];fetchedAt:string;context:{server:string;readonly:boolean;consistent:boolean;protectionReady:boolean;canManage:boolean;};}
export interface MysqlLockTarget {id:string;fingerprint:string;}
export interface MysqlLockDetail {lockId:string;fingerprint:string;session:MysqlSessionDetail;}
export interface MysqlLockRequest extends MysqlLockTarget {action:'cancel'|'kill';execution?:string;}
export interface MysqlLockReview {token:string;sql:string;target:MysqlLock;action:'cancel'|'kill';expiresAt:string;}
export type MysqlLockOutcome=MysqlSessionOutcome;
