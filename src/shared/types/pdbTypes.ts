// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export type PdbAction = 'create' | 'clone' | 'open' | 'close' | 'drop' | 'unplug' | 'plugin' | 'mode' | 'password';
export interface PdbAccess { user: string; container: string; containerId: string; database: string; instance: string; common: boolean; sysdba: boolean; }
export interface PdbContext extends PdbAccess { readonly: boolean; writable: boolean; canCreate: boolean; canAlter: boolean; canDrop: boolean; canPassword: boolean; omf: boolean; hotClone: boolean; }
export interface ManagedPdb { id: string; conId: number; name: string; dbid: string; status: string; openMode: string | null; restricted: string | null; sizeMb: number | null; protected: boolean; fingerprint: string; }
export interface PdbSnapshot { context: PdbContext; pdbs: ManagedPdb[]; seedFiles: string[]; }
export interface PdbDetail { target: ManagedPdb; files: string[]; users: string[]; }
export interface PdbOperation {
  action: PdbAction; target?: string; name?: string; expected?: string; user?: string; path?: string;
  mode?: 'READ ONLY' | 'READ WRITE'; pathMode?: 'omf' | 'convert'; conversions?: { source: string; destination: string }[];
}
export interface PdbReview { token: string; request: PdbOperation; target: ManagedPdb | null; stages: string[]; datafiles: string[]; compatibility: { compatible: boolean; violations: { type: string; message: string; action: string }[] } | null; canExecute: boolean; }
export type PdbStage = 'not_started' | 'catalog_removed' | 'applied' | 'outcome_unknown';
export interface PdbFailure { errorCode?: string; stage?: PdbStage; applied?: boolean; }
export interface PdbExecution extends PdbOperation { token: string; password?: string; confirmName?: string; }
