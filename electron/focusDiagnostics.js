// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const REPORT_REASONS = new Set(['startup', 'window-focus', 'window-blur', 'visibility-change', 'input-attempt', 'recovery-check']);
const ELEMENT_KINDS = new Set(['input', 'textarea', 'contenteditable', 'other', 'none']);

// Keep diagnostics in memory. Never collect input values, key names, URLs, or connection details.
function startFocusDiagnostics({ app, window, powerMonitor, platform = process.platform, now = Date.now }) {
  const history = [];
  const subscriptions = [];
  let stopped = false;
  let recovering = false;
  let lastRecovery = -Infinity;
  let sequence = 0;

  function publish(records) {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      try { window.webContents.send('focus-diagnostics', records); } catch { /* Diagnostics must not interrupt the app. */ }
    }
  }

  function record(event, report) {
    if (stopped) return;
    const available = !window.isDestroyed();
    const contentsAvailable = available && !window.webContents.isDestroyed();
    const entry = {
      sequence: ++sequence,
      time: new Date(now()).toISOString(),
      event,
      platform,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron || null,
      windowFocused: available ? window.isFocused() : null,
      webContentsFocused: contentsAvailable ? window.webContents.isFocused() : null,
      devToolsFocused: contentsAvailable ? window.webContents.isDevToolsFocused() : null,
      minimized: available ? window.isMinimized() : null,
      visible: available ? window.isVisible() : null,
      documentHasFocus: report?.documentHasFocus ?? null,
      activeElement: report?.activeElement ?? null,
      activeElementDisabled: report?.activeElementDisabled ?? null,
      activeElementReadOnly: report?.activeElementReadOnly ?? null
    };
    history.push(entry);
    if (history.length > 200) history.shift();
    publish([entry]);
  }

  function reportFocusState(value) {
    // Copy only validated primitive fields; never echo arbitrary renderer payloads.
    if (!value || !REPORT_REASONS.has(value.reason) || !ELEMENT_KINDS.has(value.activeElement) ||
      typeof value.documentHasFocus !== 'boolean' || typeof value.activeElementDisabled !== 'boolean' ||
      typeof value.activeElementReadOnly !== 'boolean' || !['visible', 'hidden'].includes(value.visibility)) {
      throw new Error('Invalid focus diagnostic report.');
    }
    const report = {
      reason: value.reason, documentHasFocus: value.documentHasFocus, visibility: value.visibility,
      activeElement: value.activeElement, activeElementDisabled: value.activeElementDisabled,
      activeElementReadOnly: value.activeElementReadOnly
    };
    record(`Renderer state: ${report.reason}`, report);
    // Recreate the deactivate/reactivate sequence only while the user is interacting with this window.
    // Never activate an app in the background, interrupt DevTools, or override a modal/disabled input.
    if (stopped || platform !== 'win32' || recovering || now() - lastRecovery < 2000 ||
      !['input-attempt', 'window-focus'].includes(report.reason) || report.documentHasFocus ||
      report.visibility !== 'visible' || report.activeElementDisabled || report.activeElementReadOnly ||
      window.isDestroyed() || window.webContents.isDestroyed() || !window.isFocused() ||
      !window.isVisible() || window.isMinimized() || !window.isEnabled() ||
      window.webContents.isDevToolsFocused() || window.getChildWindows().some(child => !child.isDestroyed() && child.isVisible())) {
      return { recoveryAttempted: false };
    }
    recovering = true;
    lastRecovery = now();
    try {
      record('Focus recovery attempted', report);
      window.blur();
      window.focus();
      window.webContents.focus();
      return { recoveryAttempted: true };
    } catch {
      record('Focus recovery failed', report);
      return { recoveryAttempted: false };
    } finally {
      recovering = false;
    }
  }

  function subscribe(target, event, listener) {
    target.on(event, listener);
    subscriptions.push([target, event, listener]);
  }

  function stop() {
    if (stopped) return;
    record('Diagnostics stopped');
    stopped = true;
    for (const [target, event, listener] of subscriptions) target.removeListener(event, listener);
  }

  for (const [event, label] of [
    ['focus', 'Window focused'], ['blur', 'Window blurred'],
    ['minimize', 'Window minimized'], ['restore', 'Window restored'],
    ['show', 'Window shown'], ['hide', 'Window hidden'],
    ['unresponsive', 'Renderer unresponsive'], ['responsive', 'Renderer responsive']
  ]) subscribe(window, event, () => record(label));
  for (const [event, label] of [
    ['focus', 'Renderer focused'], ['blur', 'Renderer blurred'],
    ['did-finish-load', 'Renderer loaded'], ['render-process-gone', 'Renderer process exited'],
    ['devtools-closed', 'Developer tools closed']
  ]) subscribe(window.webContents, event, () => record(label));
  subscribe(window.webContents, 'devtools-opened', () => {
    record('Developer tools opened');
    publish(history.slice());
  });
  for (const [event, label] of [
    ['lock-screen', 'Screen locked'], ['unlock-screen', 'Screen unlocked'],
    ['suspend', 'System suspended'], ['resume', 'System resumed']
  ]) subscribe(powerMonitor, event, () => record(label));
  subscribe(window, 'closed', stop);
  subscribe(app, 'will-quit', stop);
  record('Diagnostics started');
  return { stop, reportFocusState, getHistory: () => history.slice() };
}

module.exports = { startFocusDiagnostics };
