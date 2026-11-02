// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createDesktopClient } = loadTypeScript('src/shared/api/createDesktopClient.ts');

function setup(invoke) {
  const loading = [];
  const transport = { invoke, on() {}, removeListener() {} };
  return { transport, loading, client: createDesktopClient(transport, state => loading.push(state)) };
}

test('Overlapping requests keep the loader active until all requests finish', async () => {
  const pending = [];
  const h = setup(() => new Promise(resolve => pending.push(resolve)));
  const first = h.client.invoke('execute-sql', 'SELECT 1');
  const second = h.client.invoke('execute-sql', 'SELECT 2');
  pending[0]({ success: true });
  await first;
  assert.deepEqual(h.loading, [true]);
  pending[1]({ success: true });
  await second;
  assert.deepEqual(h.loading, [true, false]);
});

test('Loading hints are removed before IPC and rejections release loading state', async () => {
  let args;
  const h = setup(async (...values) => { args = values; throw new Error('query failed'); });
  await assert.rejects(h.client.invoke('execute-sql', 'SELECT 1', { skipGlobalLoader: true, value: 7 }), /query failed/);
  assert.deepEqual(h.loading, []);
  assert.equal('skipGlobalLoader' in args[2], false);
  assert.equal(args[2].value, 7);
  await assert.rejects(h.client.invoke('execute-sql', 'SELECT 1'), /query failed/);
  assert.deepEqual(h.loading, [true, false]);
});

test('Canceled requests cannot clear a newer loader or publish stale transaction state', async () => {
  const pending = [];
  const h = setup(() => new Promise(resolve => pending.push(resolve)));
  const states = [];
  h.client.subscribeTransactionState(state => states.push(state));
  const first = h.client.invoke('execute-sql', 'old');
  h.client.resetGlobalLoading();
  const second = h.client.invoke('execute-sql', 'new');
  pending[0]({ hasUncommittedTx: false });
  await first;
  assert.deepEqual(states, []);
  assert.deepEqual(h.loading, [true, false, true]);
  pending[1]({ hasUncommittedTx: true });
  await second;
  assert.deepEqual(states, [true]);
  assert.deepEqual(h.loading, [true, false, true, false]);
});

test('Event cleanup retains callback identity entirely inside the renderer', () => {
  let attached = 0, removed = 0;
  const transport = {
    invoke: async () => ({}),
    on() { attached++; return () => { removed++; }; }
  };
  const client = createDesktopClient(transport, () => {});
  const listener = () => {};
  client.on('ai-response-chunk', listener);
  client.on('ai-response-chunk', listener);
  client.removeListener('ai-response-chunk', listener);
  client.removeListener('ai-response-chunk', listener);
  assert.equal(attached, 1);
  assert.equal(removed, 1);
});

test('Event subscriptions remain independent per channel and never expose transport events', () => {
  const attached = new Map(), removed = [];
  const client = createDesktopClient({ invoke: async () => ({}),
    on(channel, listener) { attached.set(channel, listener); return () => removed.push(channel); }
  }, () => {});
  const received = [];
  const listener = (...args) => received.push(args);
  client.on('ai-response-chunk', listener);
  client.on('ai-usage-history-updated', listener);
  attached.get('ai-response-chunk')({ privileged: true }, { requestId: 'one', text: 'hello' });
  assert.equal(received[0][0], undefined);
  assert.equal(received[0][1].text, 'hello');
  client.removeListener('ai-response-chunk', listener);
  assert.deepEqual(removed, ['ai-response-chunk']);
  client.removeListener('ai-usage-history-updated', listener);
  assert.deepEqual(removed, ['ai-response-chunk', 'ai-usage-history-updated']);
});
