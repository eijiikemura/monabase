// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface PostgresLock {
  id: string; fingerprint: string; pid: number | null; backendStart: string | null; queryStart: string | null; userId: string | null; databaseId: string | null;
  database: string | null; username: string | null; program: string | null; address: string | null; backendType: string | null;
  state: string | null; kind: string; mode: string; granted: boolean; schema: string | null; object: string | null; relationId: string | null; transactionId: string | null;
  query: string | null; querySeconds: string | null; waitType: string | null; waitEvent: string | null; transactionStart: string | null;
  blockers: number[]; waiters: number; protected: boolean; canTerminate: boolean; canCancel: boolean;
}
export interface PostgresLockSnapshot {
  locks: PostgresLock[];
  context: { database: string; databaseId: string; readonly: boolean; protectionReady: boolean; scope: 'cluster' };
  fetchedAt: string;
}
export interface PostgresLockCommand { id: string; fingerprint: string; action: 'terminate' | 'cancel'; }
export interface PostgresLockResult { status: 'requested' | 'ended' | 'query-ended'; observationFailed: boolean; }
