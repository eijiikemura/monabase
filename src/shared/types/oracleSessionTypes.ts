// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface OracleSession {
  id: string; fingerprint: string; execution: string; protected: boolean;
  SID: number; SERIAL: number; INSTANCE_ID: number; CON_ID: number; USERNAME: string | null;
  STATUS: string; OSUSER: string | null; MACHINE: string | null; PROGRAM: string | null; LOGON_TIME: string;
  SQL_ID: string | null; SQL_EXEC_START: string | null; SQL_EXEC_ID: string | null; PREV_SQL_ID: string | null;
  EVENT: string | null; STATE: string | null; WAIT_CLASS: string | null; WAIT_SECONDS: number | null;
  BLOCKING_SID: number | null; BLOCKING_INSTANCE: number | null;
}
export interface OracleSessionSnapshot {
  sessions: OracleSession[]; fetchedAt: string;
  context: { instance: number; container: number; readonly: boolean; protectionReady: boolean; canManage: boolean; cancelSupported: boolean };
}
export interface OracleSessionTarget { id: string; fingerprint: string; }
export interface OracleSessionDetail {
  fingerprint: string;
  sessionId: string; execution: string; statistics: { id: string; NAME: string; VALUE: string }[];
  sqlText: string | null; previousSqlText: string | null; fetchedAt: string;
}
export interface OracleSessionCommand extends OracleSessionTarget { action: 'kill' | 'cancel'; execution?: string; }
