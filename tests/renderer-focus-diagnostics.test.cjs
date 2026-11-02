// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setImmediate: settle } = require('node:timers/promises');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

class Events {
  listeners = new Map();
  addEventListener(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
  }
  removeEventListener(event, listener) { this.listeners.get(event)?.delete(listener); }
  emit(event, value = {}) { for (const listener of this.listeners.get(event) || []) listener(value); }
}

function setup(t, recovery = false) {
  const reports = [], output = [], channels = [], timers = new Map(), callbacks = new Map();
  let timerId = 0, focused = true, rejectReports = false;
  class HTMLElement { isContentEditable = false; matches() { return false; } }
  class HTMLInputElement extends HTMLElement { readOnly = false; value = 'secret-password'; }
  class HTMLTextAreaElement extends HTMLElement { readOnly = false; }
  const window = new Events();
  const document = Object.assign(new Events(), {
    activeElement: new HTMLInputElement(), visibilityState: 'visible', hasFocus: () => focused
  });
  const ipcRenderer = {
    on(channel, listener) { callbacks.set(channel, listener); },
    removeListener(channel) { callbacks.delete(channel); },
    async invoke(channel, report) {
      channels.push(channel);
      assert.equal(channel, 'report-focus-state');
      reports.push(report);
      if (rejectReports) throw new Error('Simulated focus reporting failure');
      return { recoveryAttempted: recovery && report.reason === 'input-attempt' };
    }
  };
  const { startRendererFocusDiagnostics } = loadTypeScript('src/shared/utils/focusDiagnostics.ts', {
    '@/shared/api/desktop': { ipcRenderer }
  }, {
    window, document, HTMLElement, HTMLInputElement, HTMLTextAreaElement,
    console: { log: text => output.push(text), warn: text => output.push(text) },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const stop = startRendererFocusDiagnostics();
  t.after(stop);
  const flush = () => {
    const queued = [...timers.values()];
    timers.clear();
    for (const { callback } of queued) callback();
  };
  return { document, window, reports, output, channels, callbacks, timers, stop, flush, setFocused: value => { focused = value; }, setRejectReports: value => { rejectReports = value; } };
}

test('Reports a trusted input attempt after normal activation settles without reading key or input contents', async t => {
  const { document, reports, output, setFocused, flush } = setup(t);
  await settle();
  document.emit('keydown', { isTrusted: true });
  assert.equal(reports.length, 1);
  setFocused(false);
  document.emit('pointerdown', { isTrusted: false });
  flush();
  assert.equal(reports.length, 1);
  document.emit('keydown', { isTrusted: true, get key() { throw new Error('Must not read keys'); } });
  document.emit('pointerdown', { isTrusted: true });
  assert.equal(reports.length, 1);
  flush();
  assert.equal(reports.length, 2);
  assert.equal(reports.at(-1).reason, 'input-attempt');
  assert.equal(reports.at(-1).documentHasFocus, false);
  assert.equal(reports.at(-1).activeElement, 'input');
  assert.doesNotMatch(JSON.stringify({ reports, output }), /secret-password/);
});

test('Avoids recovery reports when a normal click has restored document focus', t => {
  const { document, reports, setFocused, flush } = setup(t);
  setFocused(false);
  document.emit('pointerdown', { isTrusted: true });
  setFocused(true);
  flush();
  assert.equal(reports.length, 1);
});

test('Verifies document focus after recovery without printing native events or DevTools history', async t => {
  const { document, reports, output, channels, callbacks, setFocused, flush } = setup(t, true);
  setFocused(false);
  document.emit('pointerdown', { isTrusted: true });
  flush();
  await settle();
  setFocused(true);
  flush();
  assert.equal(reports.at(-1).reason, 'recovery-check');
  assert.equal(reports.at(-1).documentHasFocus, true);
  callbacks.get('focus-diagnostics')(undefined, [{ event: 'Window focused' }]);
  flush();
  assert.equal(reports.at(-1).reason, 'window-focus');
  callbacks.get('focus-diagnostics')(undefined, [{ event: 'Screen locked' }, { event: 'Screen unlocked' }]);
  callbacks.get('focus-diagnostics')(undefined, [{ event: 'Diagnostics started' }, { event: 'Developer tools opened' }]);
  assert.deepEqual(output, []);
  assert.deepEqual([...new Set(channels)], ['report-focus-state']);
});

test('Rejected focus reports remain silent and later focus reporting still works', async t => {
  const { window, reports, output, setRejectReports } = setup(t);
  setRejectReports(true); window.emit('blur'); await settle();
  assert.equal(reports.at(-1).reason, 'window-blur'); assert.deepEqual(output, []);
  setRejectReports(false); window.emit('blur'); await settle();
  assert.equal(reports.length, 3); assert.deepEqual(output, []);
});

test('Cleans up listeners and pending timers on renderer disposal', async t => {
  const { window, document, timers, stop, callbacks, reports, setFocused } = setup(t);
  await settle();
  setFocused(false);
  document.emit('keydown', { isTrusted: true });
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
  assert.equal(callbacks.size, 0);
  window.emit('focus');
  document.emit('keydown', { isTrusted: true });
  assert.equal(reports.length, 1);
});
