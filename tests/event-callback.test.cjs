// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

test('Event callbacks keep their identity and use only the latest committed handler', () => {
  let storedRef, stableCallback;
  const layoutEffects = [];
  const { useEventCallback } = loadTypeScript('src/shared/hooks/useEventCallback.ts', {
    react: {
      useRef: value => storedRef ||= { current: value },
      useLayoutEffect: effect => layoutEffects.push(effect),
      useCallback: callback => stableCallback ||= callback
    }
  });
  const first = useEventCallback(value => `first:${value}`);
  layoutEffects.splice(0).forEach(effect => effect());
  assert.equal(first(1), 'first:1');
  const second = useEventCallback(value => `second:${value}`);
  assert.equal(first, second);
  assert.equal(first(2), 'first:2');
  layoutEffects.splice(0).forEach(effect => effect());
  assert.equal(first(3), 'second:3');
});
