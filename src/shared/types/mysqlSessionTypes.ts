// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
export interface MysqlSession {
 id:string; fingerprint:string; execution:string|null; threadId:string|null; connectionId:string;
 user:string; host:string; database:string|null; command:string; seconds:string; state:string|null;
 protected:boolean; canCancel:boolean; canKill:boolean; sqlText:string|null;
}
export interface MysqlSessionSnapshot {
 sessions:MysqlSession[]; fetchedAt:string;
 context:{server:string;scope:'all'|'visible';source:'performance-schema'|'processlist';protectionReady:boolean;readonly:boolean;canManage:boolean;eventsAvailable:boolean;};
}
export interface MysqlSessionTarget {id:string;fingerprint:string;}
export interface MysqlSessionDetail {sessionId:string;fingerprint:string;execution:string|null;statistics:{id:string;NAME:string;VALUE:string}[];statisticsAvailable:boolean;sqlText:string|null;previousSqlText:string|null;historyAvailable:boolean;fetchedAt:string;}
export interface MysqlSessionRequest extends MysqlSessionTarget {action:'cancel'|'kill';execution?:string;}
export interface MysqlSessionReview {token:string;sql:string;target:MysqlSession;action:'cancel'|'kill';expiresAt:string;}
export interface MysqlSessionExecution {token:string;confirm:string;acknowledged:boolean;}
export interface MysqlSessionOutcome {submitted:boolean;status:'observed'|'requested'|'unknown'|'failed';}
