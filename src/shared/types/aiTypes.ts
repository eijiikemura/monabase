// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { DbType as AiDbType, DatabaseObject as AiDatabaseObject, ObjectReference as AiObjectReference } from './objectTypes';

export interface AiDatabaseContext {
  dbType: 'oracle' | 'postgresql'; session: 'main'; readOnlyMode: boolean;
  version?: string; schema?: string; timezone?: string; dateFormat?: string;
  timestampFormat?: string; numericCharacters?: string; searchPath?: string;
  dateStyle?: string; standardConformingStrings?: string;
}

export interface AiRequestBrief {
  inputExample: string; expectedResult: string; actualResult: string; constraints: string;
  verification: string;
}

export interface AiSourceIdentity {
  connectionScope?: string;
  signature?: string;
  tableName?: string;
  historyScope?: 'debug';
  dbType: 'oracle' | 'postgresql';
  category: 'TRIGGER' | 'PROCEDURE' | 'FUNCTION' | 'PACKAGE' | 'PACKAGE BODY';
  schema: string;
  objectName: string;
}

export interface AiChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system' | 'debug';
  text: string;
  timestamp: string;
  cancelled?: boolean;
  failed?: boolean;
  aiContent?: string;
  adoption?: { summary: string; source: string; appliedAt: string };
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AiSourceHistoryTarget {
  getHistoryIdentity: () => AiSourceIdentity | null;
  subscribeHistoryIdentity: (listener: () => void) => () => void;
}

export interface SourceConversation {
  messages: AiChatMessage[];
  selectedObjects: AiDatabaseObject[];
}

export interface SelectedAiObject {
  object: AiDatabaseObject;
  status: 'loading' | 'ready' | 'error';
  reference?: AiObjectReference;
  error?: string;
}

export interface AiObjectSelectionStore {
  id: string;
  dbType: AiDbType;
  getInitialSchema: () => string;
  getSnapshot: () => readonly SelectedAiObject[];
  subscribe: (listener: () => void) => () => void;
  addObjects: (objects: AiDatabaseObject[]) => void;
  removeObject: (key: string) => void;
  retryObject: (key: string) => void;
  isAvailable: () => boolean;
  dispose: () => void;
}

export interface AiSourceReview {
  before: string;
  after: string;
  beforeSettings?: string;
  afterSettings?: string;
  apply: () => string;
}

export interface AiCodingResponseTarget extends AiSourceHistoryTarget {
  getReferencePrompt: () => string;
  start: () => void;
  preview: (answer: string) => void;
  commit: (answer: string) => string;
  review: (answer: string) => AiSourceReview | null;
  cancel: () => void;
}

export interface AiSqlResponseTarget {
  getReferencePrompt: () => string;
  start: () => void;
  preview: (sql: string) => void;
  commit: (answer: string) => string;
  review: (answer: string) => AiSourceReview | null;
  cancel: () => void;
}

export interface AiContext {
  targetTab: string;
  targetTabId?: number;
  requestType: string;
  initialPrompt?: string;
  referencePrompt?: string;
  requestId?: string;
  onResponse?: (answer: string) => void;
  objectSelection?: AiObjectSelectionStore;
  requiredPackageHeader?: { schema: string; objectName?: string };
  validateBeforeSend?: () => string | undefined;
  sqlResponse?: AiSqlResponseTarget;
  codingResponse?: AiCodingResponseTarget;
  historyTarget?: AiSourceHistoryTarget;
}
