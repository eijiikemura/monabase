// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { discardDeletedSourceConversations } from './sourceConversation';
import type { AiSourceIdentity } from '@/shared/types/aiTypes';

import { ipcRenderer } from "@/shared/api/desktop";

export async function deleteAiHistoryForObject(
  dbType: AiSourceIdentity['dbType'], schema: string, objectName: string, category: string, reason?: 'rename', signature?: string, tableName?: string, connectionScope?: string
) {
  // Ignore tab-close deletion notifications caused by a rename.
  if (reason === 'rename') return;
  if (!['TRIGGER', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY'].includes(category)) return;
  const identity: AiSourceIdentity = { connectionScope, dbType, schema, objectName, category: category as AiSourceIdentity['category'], ...(signature !== undefined ? { signature } : {}), ...(tableName !== undefined ? { tableName } : {}) };
  if (!connectionScope) throw new Error('AI history connection scope is unavailable.');
  // Stop autosaving before closing to prevent recreating a deleted file.
  discardDeletedSourceConversations(identity);
  const result = await ipcRenderer.invoke('delete-ai-object-history', identity);
  if (!result.success) throw new Error(result.error || 'AI会話履歴の削除に失敗しました。');
}
