// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { startFocusDiagnostics } = require('../electron/focusDiagnostics');

function setup(t, options = {}) {
  const calls = [], messages = [];
  let clock = 10000;
  const app = Object.assign(new EventEmitter(), { getVersion: () => '1.0.0' });
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isFocused: () => true, isDevToolsFocused: () => false,
    send: (channel, records) => messages.push({ channel, records }),
    focus: () => calls.push('contents.focus')
  });
  const window = Object.assign(new EventEmitter(), {
    webContents, isDestroyed: () => false, isFocused: () => true,
    isMinimized: () => false, isVisible: () => true, isEnabled: () => true,
    getChildWindows: () => [],
    blur() { calls.push('window.blur'); this.emit('blur'); },
    focus() { calls.push('window.focus'); this.emit('focus'); }
  });
  const powerMonitor = new EventEmitter();
  const controller = startFocusDiagnostics({ app, window, powerMonitor, platform: 'win32', now: () => clock, ...options });
  t.after(controller.stop);
  return { app, window, powerMonitor, controller, calls, messages, advance: () => { clock += 2001; } };
}

const mismatch = {
  reason: 'input-attempt', documentHasFocus: false, visibility: 'visible',
  activeElement: 'input', activeElementDisabled: false, activeElementReadOnly: false
};

test('Publishes bounded in-memory focus history to the bridge without file access', t => {
  const { controller, window, powerMonitor, messages } = setup(t);
  window.emit('blur', { password: '秘密の文字列' });
  powerMonitor.emit('lock-screen');
  powerMonitor.emit('unlock-screen');
  powerMonitor.emit('suspend');
  powerMonitor.emit('resume');
  assert.deepEqual(controller.getHistory().map(record => record.event), [
    'Diagnostics started', 'Window blurred', 'Screen locked', 'Screen unlocked', 'System suspended', 'System resumed'
  ]);
  for (let index = 0; index < 250; index += 1) window.emit('focus');
  assert.equal(controller.getHistory().length, 200);
  window.webContents.emit('devtools-opened');
  const replay = messages.at(-1);
  assert.equal(replay.channel, 'focus-diagnostics');
  assert.equal(replay.records.length, 200);
  assert.equal(replay.records.at(-1).event, 'Developer tools opened');
  assert.ok(replay.records.every(record => Number.isFinite(Date.parse(record.time))));
  assert.doesNotMatch(JSON.stringify(messages), /秘密の文字列/);
});

test('Cycles native and renderer focus once for a Windows foreground mismatch, with a cooldown', t => {
  const { controller, calls, advance } = setup(t);
  assert.equal(controller.reportFocusState(mismatch).recoveryAttempted, true);
  assert.deepEqual(calls, ['window.blur', 'window.focus', 'contents.focus']);
  assert.equal(controller.reportFocusState(mismatch).recoveryAttempted, false);
  advance();
  assert.equal(controller.reportFocusState({ ...mismatch, reason: 'window-focus' }).recoveryAttempted, true);
  assert.equal(calls.length, 6);
  assert.equal(controller.reportFocusState({ ...mismatch, reason: 'recovery-check', documentHasFocus: true }).recoveryAttempted, false);
  assert.equal(controller.getHistory().at(-1).documentHasFocus, true);
});

test('Does not steal focus from other apps, DevTools, minimized/hidden windows, or native dialogs', t => {
  for (const guard of [
    window => { window.isFocused = () => false; },
    window => { window.isMinimized = () => true; },
    window => { window.isVisible = () => false; },
    window => { window.isEnabled = () => false; },
    window => { window.webContents.isDevToolsFocused = () => true; },
    window => { window.getChildWindows = () => [{ isDestroyed: () => false, isVisible: () => true }]; },
    window => { window.isDestroyed = () => true; },
    window => { window.webContents.isDestroyed = () => true; }
  ]) {
    const { controller, window, calls } = setup(t);
    guard(window);
    assert.equal(controller.reportFocusState(mismatch).recoveryAttempted, false);
    assert.deepEqual(calls, []);
  }
});

test('Leaves normal focus, disabled/read-only fields, background reports, and other operating systems unchanged', t => {
  for (const report of [
    { ...mismatch, documentHasFocus: true },
    { ...mismatch, activeElementDisabled: true },
    { ...mismatch, activeElementReadOnly: true },
    { ...mismatch, visibility: 'hidden' },
    ...['startup', 'window-blur', 'visibility-change', 'recovery-check'].map(reason => ({ ...mismatch, reason }))
  ]) {
    const { controller, calls } = setup(t);
    assert.equal(controller.reportFocusState(report).recoveryAttempted, false);
    assert.deepEqual(calls, []);
  }
  for (const platform of ['darwin', 'linux']) {
    const { controller, calls } = setup(t, { platform });
    assert.equal(controller.reportFocusState(mismatch).recoveryAttempted, false);
    assert.deepEqual(calls, []);
  }
});

test('Validates report fields and strips values, keys, and unknown properties', t => {
  const { controller, messages } = setup(t);
  controller.reportFocusState({ ...mismatch, documentHasFocus: true, value: 'secret-value', key: 'secret-key', password: 'secret-password' });
  assert.doesNotMatch(JSON.stringify(messages), /secret-value|secret-key|secret-password/);
  for (const invalid of [null, {}, { ...mismatch, reason: 'secret-value' }, { ...mismatch, documentHasFocus: 'false' }, { ...mismatch, activeElement: 'secret-password' }]) {
    assert.throws(() => controller.reportFocusState(invalid), /^Error: Invalid focus diagnostic report\.$/);
  }
});

test('Handles focus recovery failure without exposing exception details', t => {
  const { controller, window, messages } = setup(t);
  window.blur = () => { throw new Error('secret-password'); };
  assert.equal(controller.reportFocusState(mismatch).recoveryAttempted, false);
  assert.equal(controller.getHistory().at(-1).event, 'Focus recovery failed');
  assert.doesNotMatch(JSON.stringify(messages), /secret-password/);
});

test('Removes observers and avoids destroyed window state after shutdown', t => {
  const { controller, app, window, powerMonitor, messages } = setup(t);
  window.isDestroyed = () => true;
  window.isFocused = () => { throw new Error('Access after destruction'); };
  window.emit('closed');
  assert.equal(controller.getHistory().at(-1).event, 'Diagnostics stopped');
  assert.equal(controller.getHistory().at(-1).windowFocused, null);
  assert.equal(window.listenerCount('focus'), 0);
  assert.equal(window.webContents.listenerCount('blur'), 0);
  assert.equal(powerMonitor.listenerCount('resume'), 0);
  assert.equal(app.listenerCount('will-quit'), 0);
  const count = messages.length;
  powerMonitor.emit('resume');
  controller.stop();
  assert.equal(messages.length, count);
});
