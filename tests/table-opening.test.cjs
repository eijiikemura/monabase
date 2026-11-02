// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { createTableHarness } = require('./helpers/tableData.cjs');
const { createDesktopClient } = loadTypeScript('src/shared/api/createDesktopClient.ts');
function setup() {
  let nextId = 0;
  const frames = new Map(), timers = new Map(), loading = [];
  const client = createDesktopClient({ invoke: async () => ({}), on() {} }, value => loading.push(value));
  const hook = createHookHarness();
  const module = loadTypeScript('src/features/table/useTableOpening.ts', {
    react: hook.react, '@/shared/api/desktop': { beginGlobalLoading: client.beginGlobalLoading }
  }, {
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: callback => { timers.set(++nextId, callback); return nextId; },
    clearTimeout: id => timers.delete(id)
  });
  const open = hook.render(() => module.useTableOpening()); hook.commit();
  const frame = async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); await Promise.resolve(); };
  return { ...module, client, loading, open, frame, timers, unmount: () => hook.unmount() };
}

test('Opening a table shows the loader before mounting and waits for a paint opportunity', async () => {
  const h = setup(), events = [];
  const task = h.open(() => events.push('mounted'));
  assert.deepEqual(h.loading, [true]); assert.deepEqual(events, []);
  await h.frame(); assert.deepEqual(events, []);
  await h.frame(); assert.deepEqual(events, ['mounted']);
  assert.deepEqual(h.loading, [true]);
  await h.frame(); await h.frame(); await task;
  assert.deepEqual(h.loading, [true, false]); assert.equal(h.timers.size, 0); h.unmount();
});

test('Unmounting before the paint barrier cancels the pending table open and releases its loader', async () => {
  const h = setup(); let mounted = false;
  const task = h.open(() => { mounted = true; });
  h.unmount(); assert.deepEqual(h.loading, [true, false]);
  await h.frame(); await h.frame(); await task; assert.equal(mounted, false);
});

test('Opening handoff retains another loading operation and reset invalidates stale releases', async () => {
  const h = setup(); let finishData;
  const task = h.open(() => { finishData = h.client.beginGlobalLoading(); });
  await h.frame(); await h.frame(); await h.frame(); await h.frame(); await task;
  assert.deepEqual(h.loading, [true]); finishData(); finishData();
  assert.deepEqual(h.loading, [true, false]);
  const stale = h.client.beginGlobalLoading(); h.client.resetGlobalLoading();
  const current = h.client.beginGlobalLoading(); stale();
  assert.deepEqual(h.loading.slice(-3), [true, false, true]); current();
  assert.equal(h.loading.at(-1), false); h.unmount();
});

test('Suspended animation frames have a fallback and throwing opens release the loader', async () => {
  const h = setup();
  const task = h.open(() => { throw new Error('Open failed'); });
  const rejected = assert.rejects(task, /Open failed/);
  [...h.timers.values()][0](); await rejected;
  assert.deepEqual(h.loading, [true, false]); assert.equal(h.timers.size, 0); h.unmount();
});

for (const db of ['oracle', 'postgresql']) {
  test(`${db}: initial metadata waits for loader paint and keeps the loader through read failures`, async () => {
    const loading = [], calls = []; let paint, metadata;
    const client = createDesktopClient({ invoke: async () => ({}), on() {} }, value => loading.push(value));
    const h = await createTableHarness(db, async channel => {
      calls.push(channel);
      return new Promise(resolve => { metadata = resolve; });
    }, { beginGlobalLoading: client.beginGlobalLoading, waitForTablePaint: () => new Promise(resolve => { paint = resolve; }) });
    try {
      assert.deepEqual(loading, [true]); assert.deepEqual(calls, []);
      paint(); await h.flush(); assert.deepEqual(calls, ['execute-sql-bg']);
      assert.deepEqual(loading, [true]);
      metadata({ success: false, error: 'Metadata unavailable' }); await h.flush();
      assert.deepEqual(loading, [true, false]); assert.equal(h.state.isLoading, false);
      assert.ok(h.alerts.at(-1).includes('Metadata unavailable'));
    } finally { h.unmount(); }
  });
  test(`${db}: unmounting before the first read releases the loader and sends no SQL`, async () => {
    const loading = [], calls = []; let paint;
    const client = createDesktopClient({ invoke: async () => ({}), on() {} }, value => loading.push(value));
    const h = await createTableHarness(db, async channel => { calls.push(channel); return { success: true, rows: [] }; }, {
      beginGlobalLoading: client.beginGlobalLoading, waitForTablePaint: () => new Promise(resolve => { paint = resolve; })
    });
    h.unmount(); paint(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(loading, [true, false]); assert.deepEqual(calls, []);
  });
}
