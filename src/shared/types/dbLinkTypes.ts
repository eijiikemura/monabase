// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

export interface DbLinkIdentity { schema: string; name: string; }
export interface DbLinkForm { name: string; username: string; password: string; host: string; isPublic: boolean; }
export interface DbLinkContext {
  user: string; domain: string; readonly: boolean;
  createPrivate: boolean; createPublic: boolean; alterPrivate: boolean; alterPublic: boolean; dropPublic: boolean;
}
export interface DbLinkMetadata extends DbLinkIdentity {
  username: string; host: string; created: string; fingerprint: string;
  auth: 'fixed' | 'connected' | 'current' | 'unknown'; editable: boolean; source: string;
}
export interface DbLinkRead { context: DbLinkContext; link: DbLinkMetadata | null; }
export interface DbLinkSave extends DbLinkIdentity {
  action: 'create' | 'save' | 'drop'; form?: DbLinkForm; expected?: string; confirmRecreate?: boolean;
}
export type DbLinkPhase = 'unchanged' | 'created' | 'altered' | 'dropped' | 'recreated' | 'dropped-only';
