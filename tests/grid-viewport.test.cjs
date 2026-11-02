// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');

function setup(active = true) {
  const hook = createHookHarness(), observers = [], synchronousCommits = [];
  const element = { width: 0, height: 0, getBoundingClientRect() { return this; } };
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target) { assert.equal(target, element); }
    disconnect() { this.disconnected = true; }
  }
  const react = { ...hook.react, createElement: (type, props, ...children) => ({ type, props, children }) };
  const { GridViewport } = loadTypeScript('src/features/data-grid/GridViewport.tsx', {
    react, '@mui/material': { Box: 'Box' }, 'react-dom': { flushSync: callback => { callback(); synchronousCommits.push(render()); } }
  }, { ResizeObserver });
  let child = { grid: true }, tree;
  const render = () => {
    tree = hook.render(() => GridViewport({ active, children: child }));
    tree.props.ref.current = element;
    hook.commit();
    return tree;
  };
  const flush = () => { render(); return render(); };
  return { flush, observers, element, synchronousCommits, setActive: value => { active = value; }, setChild: value => { child = value; }, unmount: hook.unmount };
}

test('Grid viewport waits for positive width and height, then retains its child during valid resizes', () => {
  const h = setup();
  try {
    assert.equal(h.flush().children[0], null);
    h.element.width = 800; h.observers[0].callback();
    assert.equal(h.flush().children[0], null);
    h.element.height = 400; h.observers[0].callback();
    const child = h.flush().children[0]; assert.ok(child.grid);
    h.element.width = 900; h.observers[0].callback();
    assert.equal(h.flush().children[0], child);
    const updated = { grid: true, rows: 20 }; h.setChild(updated);
    assert.equal(h.flush().children[0], updated);
    h.element.height = 0; h.observers[0].callback();
    assert.equal(h.flush().children[0], null);
    h.element.height = 200; h.observers[0].callback();
    assert.equal(h.flush().children[0], updated);
  } finally { h.unmount(); }
  assert.equal(h.observers[0].disconnected, true);
});

test('Inactive grids defer initialization and ignore callbacks from disconnected observers', () => {
  const h = setup(false);
  try {
    h.element.width = 800; h.element.height = 400;
    assert.equal(h.flush().children[0], null); assert.equal(h.observers.length, 0);
    h.setActive(true); assert.ok(h.flush().children[0].grid);
    const previous = h.observers[0];
    h.setActive(false); assert.equal(h.flush().children[0], null); assert.ok(previous.disconnected);
    previous.callback(); assert.equal(h.flush().children[0], null);
    h.element.height = 0; h.setActive(true);
    assert.equal(h.flush().children[0], null); assert.equal(h.observers.length, 2);
    h.element.height = 300; previous.callback(); assert.equal(h.flush().children[0], null);
    h.observers[1].callback(); assert.ok(h.flush().children[0].grid);
  } finally { h.unmount(); }
  assert.ok(h.observers.every(observer => observer.disconnected));
});

test('A zero-size notification commits removal before an already queued grid measurement runs', () => {
  const h = setup();
  try {
    h.element.width = 800; h.element.height = 400;
    assert.ok(h.flush().children[0].grid); assert.equal(h.synchronousCommits.length, 0);
    h.element.width = 900; h.observers[0].callback(); assert.equal(h.synchronousCommits.length, 0);
    h.element.height = 0; h.observers[0].callback();
    assert.equal(h.synchronousCommits.length, 1);
    assert.equal(h.synchronousCommits[0].children[0], null);
    h.element.height = 400; h.observers[0].callback(); assert.ok(h.flush().children[0].grid);
    h.element.width = 0; h.observers[0].callback();
    assert.equal(h.synchronousCommits.length, 2); assert.equal(h.synchronousCommits[1].children[0], null);
    const observer = h.observers[0]; h.unmount(); observer.callback(); assert.equal(h.synchronousCommits.length, 2);
  } finally { h.unmount(); }
});
