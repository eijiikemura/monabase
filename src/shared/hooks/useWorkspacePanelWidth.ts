// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

type Panel = 'sidebar' | 'ai';

function clampWidth(value: number, panel: Panel, viewport: number) {
  const maximum = Math.max(1, viewport * (panel === 'sidebar' ? 0.5 : 0.8));
  const minimum = Math.min(panel === 'sidebar' ? 200 : 300, maximum);
  return Math.max(minimum, Math.min(maximum, value));
}

// Store display preferences only, independently of database contents or open tabs.
export function useWorkspacePanelWidth(database: 'oracle' | 'postgresql', panel: Panel, fallback: number) {
  const key = `monabase.panel-width.${database}.${panel}`;
  const [preferred, setPreferred] = useState(() => {
    try {
      const value = Number(localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 && value <= 10000 ? value : fallback;
    } catch { return fallback; }
  });
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const changed = useRef(false);
  const latest = useRef(preferred);
  latest.current = preferred;
  const persist = useCallback(() => {
    if (!changed.current) return;
    try { localStorage.setItem(key, String(latest.current)); } catch { /* Storage restrictions must not block resizing. */ }
  }, [key]);
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    const timer = setTimeout(persist, 150);
    return () => clearTimeout(timer);
  }, [persist, preferred]);
  useEffect(() => persist, [persist]);
  const setWidth = useCallback((update: SetStateAction<number>) => {
    changed.current = true;
    setPreferred(previous => {
      const value = typeof update === 'function' ? update(clampWidth(previous, panel, viewport)) : update;
      return Number.isFinite(value) ? clampWidth(value, panel, viewport) : previous;
    });
  }, [panel, viewport]);
  return [clampWidth(preferred, panel, viewport), setWidth] as const;
}
