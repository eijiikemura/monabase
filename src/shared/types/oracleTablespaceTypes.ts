// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface ManagedTablespace {
  id: string; fingerprint: string; name: string; kind: string; status: string; bigfile: boolean; blockSize: number; protected: boolean; dropProtected: boolean;
  allocatedMb: string | null; usedMb: string | null; freeMb: string | null; maxMb: string | null; usedPercent: number | null;
}
export interface ManagedTablespaceFile {
  id: string; fileId: string; creationId: string | null; tablespace: string; path: string; kind: 'DATAFILE' | 'TEMPFILE'; bytes: string;
  sizeMb: string; autoExtend: boolean; maxBytes: string | null; maxMb: string | null; nextBytes: string; nextMb: string; online: boolean;
}
export interface TablespaceSnapshot {
  context: { database: string; container: string; containerName: string; instance: string; readonly: boolean; scope: 'all' | 'visible'; canCreate: boolean; canAlter: boolean; canDrop: boolean; omf: boolean; blockSize: number; protectionReady: boolean };
  tablespaces: ManagedTablespace[]; files: ManagedTablespaceFile[]; fetchedAt: string;
}
export interface TablespaceTarget { id: string; expected: string; }
export interface TablespaceDetail {
  target: ManagedTablespace; files: ManagedTablespaceFile[]; users: { USERNAME: string; DEFAULT_TABLESPACE: string; TEMPORARY_TABLESPACE: string }[];
  quotas: { USERNAME: string; MAX_BYTES: string }[]; segments: { OWNER: string; SEGMENT_NAME: string; PARTITION_NAME: string | null; SEGMENT_TYPE: string }[]; segmentCount: number; fetchedAt: string;
}
export interface TablespaceOperation {
  action: 'create' | 'add' | 'resize' | 'drop'; name: string; id?: string; expected?: string; sizeMb?: string; autoExtend?: boolean;
  nextMb?: string; maxMb?: string; bigfile?: boolean; pathMode?: 'omf' | 'path'; path?: string;
}
export interface TablespaceStep { kind: 'create' | 'add' | 'resize' | 'autoextend' | 'drop'; sql: string; }
export interface TablespaceReview { token: string; request: TablespaceOperation; detail: TablespaceDetail | null; steps: TablespaceStep[]; canExecute: boolean; shrinking: boolean; }
export interface TablespaceExecution extends TablespaceOperation { token: string; confirmName?: string; }
export interface TablespaceOutcome { completed: TablespaceStep['kind'][]; attempted: TablespaceStep['kind'] | null; applied: boolean; errorCode?: string; }
