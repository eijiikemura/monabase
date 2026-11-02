// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface OracleSessionIdentity {
  sid: number;
  instance: number;
  container: number;
}
export interface OracleLock {
  id: string;
  SID: number;
  SERIAL: number;
  INSTANCE_ID: number;
  CON_ID: number;
  USERNAME: string;
  OSUSER: string;
  PROGRAM: string;
  MACHINE: string;
  STATUS: string;
  TYPE: string;
  ID1: number;
  ID2: number;
  HELD_MODE: number;
  REQUEST_MODE: number;
  BLOCK: number;
  WAITERS: number;
  HOLD_SECONDS: number;
  WAIT_SECONDS: number | null;
  EVENT: string;
  OBJECT_OWNER: string | null;
  OBJECT_NAME: string | null;
  OBJECT_TYPE: string | null;
  BLOCKING_SID: number | null;
  BLOCKING_INSTANCE: number | null;
  SQL_ID: string | null;
  SQL_TEXT: string | null;
  PREV_SQL_ID: string | null;
  PREV_SQL_TEXT: string | null;
  LOGON_TIME: string;
  fingerprint: string;
  protected: boolean;
}
export interface OracleLockSnapshot {
  locks: OracleLock[];
  context: { instance: number; container: number; readonly: boolean; canKill: boolean; protectionReady: boolean };
  fetchedAt: string;
}
export interface OracleLockCommand {
  id: string;
  fingerprint: string;
}
export interface OracleLockResult { status: 'requested' | 'marked'; }
