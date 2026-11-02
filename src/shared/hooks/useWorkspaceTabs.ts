// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useEventCallback } from './useEventCallback';

interface Tab { id: number }
type OpenResult<T> = { tab: T } | { existingId: number } | { limitReached: true };

// Keep tab selection and IDs in the same pure update, including batched opens/closes.
export function useWorkspaceTabs<T extends Tab>(initialTabs: T[], onLimitReached: () => void) {
  const [state, setState] = useState(() => ({
    tabs: initialTabs,
    activeTabId: initialTabs[0]?.id ?? 0,
    nextId: Math.max(0, ...initialTabs.map(tab => tab.id)) + 1,
    limitNotice: 0
  }));
  const notify = useEventCallback(onLimitReached);
  const notified = useRef(0);
  useEffect(() => {
    if (state.limitNotice === notified.current) return;
    notified.current = state.limitNotice;
    notify();
  }, [state.limitNotice, notify]);

  const setTabs = useCallback((update: SetStateAction<T[]>) => {
    setState(previous => {
      const tabs = typeof update === 'function' ? update(previous.tabs) : update;
      let activeTabId = previous.activeTabId;
      if (!tabs.some(tab => tab.id === activeTabId)) {
        const oldIndex = previous.tabs.findIndex(tab => tab.id === activeTabId);
        activeTabId = previous.tabs.slice(0, oldIndex).reverse().find(tab => tabs.some(next => next.id === tab.id))?.id ?? tabs[0]?.id ?? 0;
      }
      return { ...previous, tabs, activeTabId };
    });
  }, []);
  const setActiveTabId = useCallback((update: SetStateAction<number>) => {
    setState(previous => ({ ...previous, activeTabId: typeof update === 'function' ? update(previous.activeTabId) : update }));
  }, []);
  const openTab = useCallback((decide: (tabs: T[], nextId: number) => OpenResult<T>) => {
    setState(previous => {
      const result = decide(previous.tabs, previous.nextId);
      if ('existingId' in result) return { ...previous, activeTabId: result.existingId };
      if ('limitReached' in result) return { ...previous, limitNotice: previous.limitNotice + 1 };
      return { ...previous, tabs: [...previous.tabs, result.tab], activeTabId: result.tab.id, nextId: previous.nextId + 1 };
    });
  }, []);
  return { tabs: state.tabs, activeTabId: state.activeTabId, setTabs, setActiveTabId, openTab };
}
