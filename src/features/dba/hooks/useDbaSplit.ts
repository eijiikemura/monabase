// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
export function useDbaSplit(active: boolean, axis: 'rows' | 'columns' = 'rows') {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ element: HTMLElement; id: number; cursor: string } | null>(null);
  const [ratio, setRatio] = useState(axis === 'columns' ? 0.35 : 0.55), [height, setHeight] = useState(0), [dragging, setDragging] = useState(false);
  const available = Math.max(0, height - 8), minimum = Math.min(axis === 'columns' ? 250 : 140, available / 2);
  const topHeight = Math.max(minimum, Math.min(available - minimum, available * ratio));
  const stop = useEventCallback(() => {
    const current = drag.current; if (!current) return;
    drag.current = null; document.body.style.cursor = current.cursor;
    if (current.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id);
    setDragging(false);
  });
  useEffect(() => {
    const element = container.current;
    if (!active || !element) { stop(); return; }
    const measure = () => setHeight(axis === 'rows' ? element.getBoundingClientRect().height : element.getBoundingClientRect().width);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    window.addEventListener('blur', stop);
    return () => { observer.disconnect(); window.removeEventListener('blur', stop); stop(); };
  }, [active, axis, stop]);
  const move = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId || !container.current || !available) return;
    const rect = container.current.getBoundingClientRect();
    const y = axis === 'rows' ? event.clientY - rect.top : event.clientX - rect.left;
    setRatio(Math.max(minimum, Math.min(available - minimum, y)) / available);
  };
  const start = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !active || drag.current) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { element: event.currentTarget, id: event.pointerId, cursor: document.body.style.cursor };
    document.body.style.cursor = axis === 'rows' ? 'row-resize' : 'col-resize'; setDragging(true);
  };
  const key = (event: KeyboardEvent<HTMLElement>) => {
    const backward = axis === 'rows' ? 'ArrowUp' : 'ArrowLeft', forward = axis === 'rows' ? 'ArrowDown' : 'ArrowRight';
    if (!active || ![backward, forward, 'Home', 'End'].includes(event.key) || !available) return;
    event.preventDefault(); setRatio(previous => event.key === 'Home' ? minimum / available : event.key === 'End' ? 1 - minimum / available : Math.max(minimum / available, Math.min(1 - minimum / available, previous + (event.key === backward ? -0.05 : 0.05))));
  };
  return { container, topHeight, leftWidth: topHeight, ratio, dragging, start, move, stop, key };
}
