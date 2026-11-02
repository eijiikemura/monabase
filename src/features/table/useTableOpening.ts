// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef } from 'react';
import { beginGlobalLoading } from '@/shared/api/desktop';

// Two frames allow the loader to paint before mounting a potentially expensive table.
export function waitForTablePaint(): Promise<void> {
  return new Promise(resolve => {
    let firstFrame = 0, secondFrame = 0;
    const finish = () => {
      clearTimeout(fallback);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      resolve();
    };
    // Hidden or minimized windows may suspend animation frames.
    const fallback = setTimeout(finish, 100);
    firstFrame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(finish); });
  });
}

export function useTableOpening() {
  const pending = useRef(new Set<() => void>());
  useEffect(() => {
    const operations = pending.current;
    return () => {
      for (const finish of operations) finish();
      operations.clear();
    };
  }, []);
  return useCallback(async (open: () => void) => {
    const finish = beginGlobalLoading();
    pending.current.add(finish);
    try {
      await waitForTablePaint();
      if (!pending.current.has(finish)) return;
      open();
      // Hand the loader to the data hook after its mount effects have run.
      await waitForTablePaint();
    } finally {
      pending.current.delete(finish);
      finish();
    }
  }, []);
}
