// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface PostgresSession {
  id: string; fingerprint: string; pid: number; backendStart: string | null; queryStart: string | null; transactionStart: string | null; stateChangedAt: string | null;
  userId: string | null; databaseId: string | null; database: string | null; username: string | null; program: string | null; address: string | null; port: number | null;
  backendType: string; state: string | null; waitType: string | null; waitEvent: string | null; blockers: number[]; query: string | null;
  queryVisibility: 'visible' | 'restricted' | 'disabled' | 'unavailable'; querySeconds: string | null; transactionSeconds: string | null; stateSeconds: string | null;
  protected: boolean; canTerminate: boolean; canCancel: boolean;
}
export interface PostgresSessionSnapshot {
  sessions: PostgresSession[]; context: { database: string; databaseId: string; readonly: boolean; protectionReady: boolean; scope: 'cluster' }; fetchedAt: string;
}
export interface PostgresSessionCommand { id: string; fingerprint: string; action: 'terminate' | 'cancel'; }
export interface PostgresSessionResult { status: 'requested' | 'ended' | 'query-ended'; observationFailed: boolean; }
