// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { ipcRenderer } from '@/shared/api/desktop';
import { MAX_DOCUMENT_BYTES, parseDocument } from './resultSnapshot';
export async function readQualityFile(file: File): Promise<unknown> {
  if (!file.name.toLowerCase().endsWith('.json')) throw new Error('quality_invalid_document');
  if (file.size > MAX_DOCUMENT_BYTES) throw new Error('quality_document_limit');
  return parseDocument(await file.text());
}
export async function saveQualityFile(name: string, value: unknown): Promise<void> {
  const result = await ipcRenderer.invoke('show-save-dialog', { defaultPath: name, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return;
  const saved = await ipcRenderer.invoke('save-file', result.filePath, new TextEncoder().encode(JSON.stringify(value, null, 2)).length <= MAX_DOCUMENT_BYTES ? JSON.stringify(value, null, 2) : JSON.stringify(value), 'utf8');
  if (!saved.success) throw new Error(saved.error);
}
