// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react';
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";

// Wait from the initial render until all parallel and additional fetches complete.
export function useDbaLoading() {
  const loading = useLoadingCounter(true);
  const initialLoadStarted = useRef(false);
  const [initialLoadCompleted, setInitialLoadCompleted] = useState(false);
  const { endLoading } = loading;
  const loadInitialData = useCallback(async (load: () => Promise<unknown>) => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    try {
      await load();
    } finally {
      setInitialLoadCompleted(true);
      endLoading();
    }
  }, [endLoading]);
  return { ...loading, loadInitialData, initialLoadCompleted };
}
