// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useRef, useState } from 'react';

// Disable actions until all parallel and nested operations finish.
export function useLoadingCounter(initiallyLoading = false) {
  const pendingCount = useRef(initiallyLoading ? 1 : 0);
  const [isLoading, setIsLoading] = useState(initiallyLoading);

  const beginLoading = useCallback(() => {
    pendingCount.current += 1;
    if (pendingCount.current === 1) setIsLoading(true);
  }, []);

  const endLoading = useCallback(() => {
    if (pendingCount.current === 0) return;
    pendingCount.current -= 1;
    if (pendingCount.current === 0) setIsLoading(false);
  }, []);

  // Prevent duplicate execution without waiting for a render.
  const isBusy = useCallback(() => pendingCount.current > 0, []);

  return { isLoading, beginLoading, endLoading, isBusy };
}
