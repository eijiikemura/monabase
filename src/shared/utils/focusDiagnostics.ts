// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ipcRenderer } from '@/shared/api/desktop';
import type { EventListener, FocusElementKind, FocusStateReport } from '@/shared/api/desktopContract';

export function startRendererFocusDiagnostics() {
  let stopped = false;
  let pendingInputCheck = false;
  let lastInputReport = -Infinity;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  function later(callback: () => void, delay = 0) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) callback();
    }, delay);
    timers.add(timer);
  }

  async function report(reason: FocusStateReport['reason']) {
    if (stopped) return;
    const active = document.activeElement;
    let kind: FocusElementKind = active ? 'other' : 'none';
    if (active instanceof HTMLInputElement) kind = 'input';
    else if (active instanceof HTMLTextAreaElement) kind = 'textarea';
    else if (active instanceof HTMLElement && active.isContentEditable) kind = 'contenteditable';
    try {
      const result = await ipcRenderer.invoke('report-focus-state', {
        reason,
        documentHasFocus: document.hasFocus(),
        visibility: document.visibilityState === 'visible' ? 'visible' : 'hidden',
        activeElement: kind,
        activeElementDisabled: active?.matches(':disabled') ?? false,
        activeElementReadOnly: (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && active.readOnly
      });
      if (!stopped && result.recoveryAttempted) later(() => { void report('recovery-check'); }, 100);
    } catch { /* Focus reporting must not interrupt user interaction. */ }
  }

  const onDiagnostics: EventListener<'focus-diagnostics'> = (_event, records) => {
    if (stopped) return;
    // Native activation can occur without a corresponding DOM focus event in the broken state.
    if (records.length === 1 && records[0].event === 'Window focused') later(() => { void report('window-focus'); });
  };
  const onFocus = () => later(() => { void report('window-focus'); });
  const onBlur = () => { void report('window-blur'); };
  const onVisibility = () => { void report('visibility-change'); };
  const onInputAttempt = (event: Event) => {
    // Observe focus only; never read keys, input values, or pointer coordinates.
    if (!event.isTrusted || document.hasFocus() || pendingInputCheck || Date.now() - lastInputReport < 2000) return;
    pendingInputCheck = true;
    // Let normal click activation finish before deciding that focus is broken.
    later(() => {
      pendingInputCheck = false;
      if (!document.hasFocus()) {
        lastInputReport = Date.now();
        void report('input-attempt');
      }
    });
  };

  ipcRenderer.on('focus-diagnostics', onDiagnostics);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('pointerdown', onInputAttempt, true);
  document.addEventListener('keydown', onInputAttempt, true);
  void report('startup');

  return () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    ipcRenderer.removeListener('focus-diagnostics', onDiagnostics);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    document.removeEventListener('pointerdown', onInputAttempt, true);
    document.removeEventListener('keydown', onInputAttempt, true);
  };
}
