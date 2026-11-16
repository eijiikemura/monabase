// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createStartupDiagnostics } = require('../electron/startupDiagnostics');

function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const app = Object.assign(new EventEmitter(), { getPath: () => directory, isPackaged: true });
  let clock = 10;
  const diagnostics = createStartupDiagnostics({ started: 10, now: () => clock, pid: 123, ...options });
  const file = path.join(directory, 'startup.jsonl');
  return { app, diagnostics, file, advance: value => { clock = value; }, entries: () => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) };
}

test('Startup milestones are persisted before any window exists using a monotonic elapsed clock', t => {
  const f = setup(t);
  f.diagnostics.mark('main:entry');
  f.advance(70);
  f.diagnostics.attach(f.app);
  const records = f.entries();
  assert.equal(records[0].stage, 'main:entry');
  assert.equal(records[0].elapsedMs, 0);
  assert.equal(records[1].elapsedMs, 60);
  assert.equal(records[0].pid, 123);
  assert.deepEqual(Object.keys(records[0]).sort(), ['elapsedMs', 'pid', 'stage', 'time']);
});

test('Window and document events are observed without showing or loading the window', t => {
  const f = setup(t);
  f.diagnostics.attach(f.app);
  const window = Object.assign(new EventEmitter(), { webContents: new EventEmitter(), show() { assert.fail('Must not change visibility.'); } });
  f.app.emit('browser-window-created', {}, window);
  for (const event of ['show', 'ready-to-show']) window.emit(event);
  for (const event of ['dom-ready', 'did-finish-load', 'did-fail-load', 'render-process-gone']) window.webContents.emit(event, { password: 'DO_NOT_LOG' });
  const stages = f.entries().map(record => record.stage);
  assert.ok(stages.includes('window:show'));
  assert.ok(stages.includes('window:ready-to-show'));
  assert.ok(stages.includes('webContents:dom-ready'));
  assert.ok(stages.includes('webContents:did-finish-load'));
  assert.ok(!fs.readFileSync(f.file, 'utf8').includes('DO_NOT_LOG'));
});

test('Measured synchronous operations preserve results and errors, recording the time spent', t => {
  const f = setup(t);
  f.diagnostics.attach(f.app);
  assert.equal(f.diagnostics.measure('storage:prepare', () => { f.advance(6010); return 42; }), 42);
  const error = new Error('PRIVATE_ERROR_DO_NOT_LOG');
  assert.throws(() => f.diagnostics.measure('settings:load', () => { throw error; }), value => value === error);
  const entries = f.entries();
  assert.equal(entries.find(e => e.stage === 'storage:prepare:end').elapsedMs, 6000);
  assert.equal(entries.at(-1).stage, 'settings:load:end');
  assert.ok(!fs.readFileSync(f.file, 'utf8').includes(error.message));
});

test('Diagnostic IO failures never prevent startup or execute an operation twice', () => {
  const d = createStartupDiagnostics({ io: { mkdirSync() { throw new Error('Denied'); } } });
  d.mark('main:entry');
  assert.doesNotThrow(() => d.attach({ getPath: () => '/unwritable' }));
  let called = 0;
  assert.equal(d.measure('settings:load', () => ++called), 1);
  assert.equal(called, 1);
});

test('Startup logs rotate at one MiB and stop collecting after the per-process event limit', t => {
  const f = setup(t);
  fs.writeFileSync(f.file, 'x'.repeat(1024 * 1024 + 1));
  f.diagnostics.attach(f.app);
  assert.equal(fs.statSync(path.join(path.dirname(f.file), 'startup.previous.jsonl')).size, 1024 * 1024 + 1);
  for (let i = 0; i < 500; i++) f.diagnostics.mark('settings:load');
  assert.equal(f.entries().length, 160);
});
