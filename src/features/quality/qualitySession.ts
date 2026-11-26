// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { StoredRequest, StoredData } from '@/shared/api/desktopContract';
import { captureResult, type ResultSnapshot } from './resultSnapshot';
import { storedExpectation, type StoredExpectation } from './regression';
export interface QualitySession {
  snapshot?: ResultSnapshot;
  stored?: { request: StoredRequest; expected: StoredExpectation };
  open: boolean; tab: number;
}
let connectionEpoch = 0;
export const getQualityConnectionEpoch = () => connectionEpoch;
let session: QualitySession = { open: false, tab: 0 };
const listeners = new Set<() => void>();
export const getQualitySession = () => session;
export function subscribeQualitySession(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function update(value: QualitySession) { session = value; listeners.forEach(listener => listener()); }
export function openQualityTools(tab = 0) { update({ ...session, open: true, tab }); }
export function closeQualityTools() { update({ ...session, open: false }); }
export function clearQualitySession() { connectionEpoch++; update({ open: false, tab: 0 }); }
export function publishQualityResult(columns: string[], rows: Record<string, unknown>[], tab: number) {
  update({ ...session, snapshot: captureResult(columns, rows), open: true, tab });
}
export function rememberStoredExecution(request: StoredRequest, data: StoredData) {
  try { update({ ...session, stored: { request: structuredClone(request), expected: storedExpectation(data) } }); }
  catch { update({ ...session, stored: undefined }); }
}
