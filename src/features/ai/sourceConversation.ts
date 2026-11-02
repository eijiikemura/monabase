// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { AiSourceIdentity, AiChatMessage, AiSourceHistoryTarget, SourceConversation, AiObjectSelectionStore } from '@/shared/types/aiTypes';
import type { AiDatabaseObject } from './aiObjectRepository';

interface HistoryIO {
  load: (identity: AiSourceIdentity) => Promise<SourceConversation | null>;
  save: (identity: AiSourceIdentity, conversation: SourceConversation) => Promise<void>;
}
interface Snapshot {
  messages: AiChatMessage[];
  ready: boolean;
  persistent: boolean;
  error: string;
}
interface Session {
  deleted?: boolean;
  identity: AiSourceIdentity | null;
  messages: AiChatMessage[];
  objects: AiDatabaseObject[];
  hydrated: boolean;
  selection?: AiObjectSelectionStore;
  timer?: ReturnType<typeof setTimeout>;
  unsubscribe?: () => void;
  unsubscribeIdentity?: () => void;
  unsubscribeDeletion?: () => void;
  loadToken?: object;
}

const deletionListeners = new Set<(identity: AiSourceIdentity) => void>();

export function discardDeletedSourceConversations(identity: AiSourceIdentity) {
  deletionListeners.forEach(listener => listener(identity));
}

// Associate saved conversations with their source independently of React renders or navigation.
export function createSourceConversationController(io: HistoryIO, delay = 300) {
  let current: Session | undefined;
  let snapshot: Snapshot = { messages: [], ready: true, persistent: false, error: '' };
  const listeners = new Set<() => void>();
  const publish = (session: Session, error = '') => {
    if (current !== session) return;
    snapshot = { messages: session.messages, ready: session.hydrated,
      persistent: Boolean(session.identity), error };
    listeners.forEach(listener => listener());
  };
  const objects = (selection?: AiObjectSelectionStore) =>
    selection?.getSnapshot().map(item => ({ ...item.object })) || [];
  const flush = (session = current) => {
    if (!session) return Promise.resolve();
    clearTimeout(session.timer);
    session.timer = undefined;
    if (!session.identity || !session.hydrated) return Promise.resolve();
    // Capture the IPC payload before later screen changes can affect it.
    return io.save({ ...session.identity }, {
      messages: session.messages.map(message => ({ ...message })),
      selectedObjects: session.objects.map(object => ({ ...object }))
    }).catch((error: unknown) => {
      publish(session, error instanceof Error ? error.message : String(error));
    });
  };
  const schedule = (session: Session) => {
    clearTimeout(session.timer);
    if (session.identity && session.hydrated) session.timer = setTimeout(() => { void flush(session); }, delay);
  };
  const detach = (session = current) => {
    if (!session) return;
    void flush(session);
    session.unsubscribe?.();
    session.unsubscribeIdentity?.();
    session.unsubscribeDeletion?.();
    if (current === session) current = undefined;
  };
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    attach(target?: Partial<AiSourceHistoryTarget>, selection?: AiObjectSelectionStore, connectionScope?: string) {
      detach();
      const scopeIdentity = (value: AiSourceIdentity | null): AiSourceIdentity | null =>
        value && connectionScope ? { ...value, connectionScope } : value;
      const identity = scopeIdentity(target?.getHistoryIdentity?.() || null);
      const session: Session = { identity, messages: [], objects: objects(selection), hydrated: !identity, selection };
      current = session;
      const onDeleted = (deleted: AiSourceIdentity) => {
        const saved = session.identity;
        if (!saved || saved.connectionScope !== deleted.connectionScope || saved.dbType !== deleted.dbType || saved.schema !== deleted.schema || saved.objectName !== deleted.objectName || saved.signature !== deleted.signature || saved.tableName !== deleted.tableName ||
            (saved.category !== deleted.category && !(deleted.dbType === 'oracle' && deleted.category === 'PACKAGE' && saved.category === 'PACKAGE BODY'))) return;
        clearTimeout(session.timer);
        session.deleted = true;
        session.identity = null;
        session.loadToken = undefined;
        session.messages = [];
        session.hydrated = true;
        publish(session);
      };
      deletionListeners.add(onDeleted);
      session.unsubscribeDeletion = () => { deletionListeners.delete(onDeleted); };
      session.unsubscribe = selection?.subscribe(() => {
        // Do not treat disposal of the originating window as deletion.
        if (!selection.isAvailable()) return;
        const selected = objects(selection);
        if (JSON.stringify(selected) === JSON.stringify(session.objects)) return;
        session.objects = selected;
        schedule(session);
      });
      session.unsubscribeIdentity = target?.subscribeHistoryIdentity?.(() => {
        if (session.deleted) return;
        const next = scopeIdentity(target.getHistoryIdentity?.() || null);
        if (JSON.stringify(next) === JSON.stringify(session.identity)) return;
        // Carry the active conversation from creation into the compiled editor.
        session.identity = next;
        session.loadToken = undefined;
        session.hydrated = true;
        publish(session);
        void flush(session);
      });
      publish(session);
      if (identity) {
        const loadToken = {};
        session.loadToken = loadToken;
        void io.load(identity).then(saved => {
          if (current !== session || session.loadToken !== loadToken) return;
          if (saved) {
            session.messages = saved.messages;
            session.objects = saved.selectedObjects;
            if (selection?.isAvailable()) {
              // Restore empty selections too; fetch definitions from the current database instead of saving them.
              selection.getSnapshot().forEach(item => selection.removeObject(item.object.key));
              selection.addObjects(saved.selectedObjects);
              session.objects = objects(selection);
            }
          }
          session.hydrated = true;
          publish(session);
        }).catch((error: unknown) => {
          if (current !== session || session.loadToken !== loadToken) return;
          // Do not autosave an empty conversation over a file that failed to load.
          publish(session, error instanceof Error ? error.message : String(error));
        });
      }
      return () => {
        if (current === session) detach(session);
      };
    },
    setMessages(value: AiChatMessage[] | ((previous: AiChatMessage[]) => AiChatMessage[])) {
      if (!current || current.deleted) return;
      current.messages = typeof value === 'function' ? value(current.messages) : value;
      publish(current);
      schedule(current);
    },
    reset() {
      if (!current) return;
      current.loadToken = undefined;
      current.messages = [];
      current.hydrated = true;
      publish(current);
      void flush(current);
    },
    flush: () => flush()
  };
}
