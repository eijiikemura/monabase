// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useLayoutEffect, useRef } from 'react';

// Subscribe once while invoking the handler from the latest committed render.
// Use this for events and explicitly triggered loads, not to hide reactive dependencies.
export function useEventCallback<Args extends unknown[], Result>(handler: (...args: Args) => Result) {
  const latest = useRef(handler);
  useLayoutEffect(() => { latest.current = handler; });
  return useCallback((...args: Args) => latest.current(...args), []);
}
