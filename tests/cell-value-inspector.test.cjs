// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { createHookHarness } = require('./helpers/renderHook.cjs');
function fixture(invoke = async () => true) {
  const h = createHookHarness(), requests = [], notices = [];
  const React = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const module = loadTypeScript('src/components/data/CellValueInspector.tsx', {
    react: React, '@mui/material': new Proxy({}, { get: (_, name) => name }),
    'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { requests.push(args); return invoke(...args); } } },
    '@/shared/utils/notifications': { notify: (message, options) => notices.push({ message, ...options }) }
  }, { React, ArrayBuffer });
  let state;
  const render = () => { state = h.render(() => module.useCellValueInspector()); h.commit(); return state; };
  render();
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
  const node = type => walk(state.dialog).find(value => value.type === type);
  const button = label => walk(state.dialog).find(value => value.type === 'Button' && value.children.includes(label));
  return { ...module, render, requests, notices, node, button, h, get state() { return state; } };
}
test('Cell values distinguish NULL, empty, unavailable and binary while preserving exact strings and line breaks', () => {
  const f = fixture(), describe = value => JSON.parse(JSON.stringify(f.describeCellValue(value)));
  assert.deepEqual(describe(null), { kind: 'null', text: 'NULL' });
  assert.deepEqual(describe(''), { kind: 'empty', text: '' });
  assert.deepEqual(describe(undefined), { kind: 'unavailable', text: '' });
  for (const text of ['9007199254740993.123456789', '日本語\r\n"<script>"', '   ', 'NULL']) assert.deepEqual(describe(text), { kind: 'value', text });
  for (const value of [new Uint8Array([1]), new ArrayBuffer(2), { type: 'Buffer', data: [1] }, { isBlob: true }]) assert.equal(describe(value).kind, 'binary');
  assert.equal(f.describeCellValue('[BLOB data]', true).kind, 'binary');
  const cycle = {}; cycle.self = cycle;
  assert.equal(describe(cycle).kind, 'unavailable');
  assert.deepEqual(f.requests, []); f.h.unmount();
});
test('Cell preview is read-only, uses a captured value and never loads database data', async () => {
  const f = fixture(); let closed = 0;
  const value = 'first\nsecond 日本語';
  f.state.menuItems({ label: 'NOTES', value }, () => closed++)[0].props.onClick(); f.render();
  assert.equal(closed, 1); assert.equal(f.node('Dialog').props.open, true);
  assert.equal(f.node('TextField').props.value, value); assert.equal(f.node('TextField').props.InputProps.readOnly, true);
  assert.deepEqual(f.requests, []);
  await f.button('cell_value_copy').props.onClick();
  // React event handlers intentionally do not return the asynchronous copy promise.
  await f.h.settle(); f.render();
  assert.deepEqual(f.requests, [['copy-to-clipboard', value]]);
  assert.deepEqual(f.notices, [{ message: 'cell_value_copied', severity: 'success' }]);
  f.button('close').props.onClick(); f.render(); assert.equal(f.node('Dialog').props.open, false); f.h.unmount();
});
test('NULL and empty text copy explicitly, while binary and unavailable values cannot copy', async () => {
  const f = fixture();
  for (const value of [null, '']) {
    f.state.menuItems({ label: 'VALUE', value }, () => {})[1].props.onClick(); await f.h.settle(); f.render();
  }
  assert.deepEqual(f.requests, [['copy-to-clipboard', 'NULL'], ['copy-to-clipboard', '']]);
  for (const value of [undefined, { isBlob: true }]) {
    const items = f.state.menuItems({ label: 'VALUE', value }, () => {});
    assert.equal(items[1].props.disabled, true);
    items[0].props.onClick(); f.render();
    assert.equal(f.button('cell_value_copy').props.disabled, true);
    f.button('cell_value_copy').props.onClick(); await f.h.settle();
  }
  assert.equal(f.requests.length, 2); f.h.unmount();
});
test('A pending or failed clipboard copy does not close or change the inspected value and allows retry', async () => {
  let finish, first = true;
  const f = fixture(() => first ? new Promise((_resolve, reject) => { finish = reject; }) : true);
  f.state.menuItems({ label: 'VALUE', value: 'private text' }, () => {})[0].props.onClick(); f.render();
  const copy = f.button('cell_value_copy').props.onClick;
  copy(); copy(); f.node('Dialog').props.onClose(); f.render();
  assert.equal(f.requests.length, 1); assert.equal(f.node('Dialog').props.open, true);
  finish(new Error('private text')); await f.h.settle(); f.render();
  assert.equal(f.node('Alert').children[0], 'cell_value_copy_failed');
  assert.equal(f.node('TextField').props.value, 'private text'); assert.deepEqual(f.notices, []);
  first = false; f.button('cell_value_copy').props.onClick(); await f.h.settle(); f.render();
  assert.equal(f.requests.length, 2); assert.equal(f.node('Alert'), undefined); f.h.unmount();
});

function contextEvent(key, extra = {}) {
  const cell = { classList: { contains: () => false }, getBoundingClientRect: () => ({ left: 10, bottom: 40 }) };
  const event = { key, shiftKey: key === 'F10', nativeEvent: {}, target: { closest: selector => selector.startsWith('input') ? null : cell },
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
  if (key === undefined) delete event.key;
  return { event, cell };
}
test('Cell keyboard menus accept Shift+F10 and ContextMenu at the focused cell and ignore editing, IME and unrelated keys', () => {
  const f = fixture();
  for (const key of ['F10', 'ContextMenu']) {
    const { event, cell } = contextEvent(key);
    const anchor = f.cellMenuTrigger(event);
    assert.equal(anchor.cell, cell); assert.equal(anchor.x, 18); assert.equal(anchor.y, 40);
    assert.equal(event.defaultPrevented, true); assert.equal(event.stopped, true);
  }
  for (const extra of [{ shiftKey: false }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { defaultPrevented: true }, { key: 'Enter' }, { target: { closest: () => ({}) } }]) {
    assert.equal(f.cellMenuTrigger(contextEvent('F10', extra).event), null);
  }
  const editing = contextEvent('F10'); editing.cell.classList.contains = () => true;
  assert.equal(f.cellMenuTrigger(editing.event), null);
  const mouse = contextEvent(undefined, { clientX: 100, clientY: 200 });
  assert.equal(f.cellMenuTrigger(mouse.event).x, 100);
  f.h.unmount();
});
function focusOrigin() {
  const focused = [], replacement = { isConnected: true, getAttribute: name => name === 'data-field' ? 'odd"[field]' : null,
    getBoundingClientRect: () => ({ width: 100, height: 30 }), focus: () => focused.push('replacement') };
  const row = { getAttribute: () => 'odd"[row]', querySelectorAll: () => [replacement] };
  const grid = { isConnected: true, querySelectorAll: () => [row] };
  const cell = { ...replacement, closest: selector => selector === '.MuiDataGrid-root' ? grid : row, focus: () => focused.push('original') };
  return { cell, grid, row, focused };
}
const waitFocus = () => new Promise(resolve => setTimeout(resolve, 5));
test('Closing the preview restores its originating cell after the dialog exits and never steals focus while open', async () => {
  const f = fixture(), origin = focusOrigin();
  f.state.rememberCell(origin.cell);
  f.state.menuItems({ label: 'value', value: 'text' }, () => {})[0].props.onClick(); f.render();
  f.state.restoreCellFocus(); await waitFocus(); assert.deepEqual(origin.focused, []);
  f.node('Dialog').props.onClose(); f.render();
  f.node('Dialog').props.TransitionProps.onExited(); await waitFocus(); assert.deepEqual(origin.focused, ['original']);
  assert.equal(f.node('Dialog').props.disableRestoreFocus, true); assert.deepEqual(f.requests, []); f.h.unmount();
});
test('Menu dismissal and copy restore current cells safely after rerender and ignore removed rows or unmount', async () => {
  const f = fixture(), origin = focusOrigin(); f.state.rememberCell(origin.cell);
  origin.cell.isConnected = false;
  f.state.menuItems({ label: 'value', value: 'copy' }, () => {})[1].props.onClick(); await waitFocus(); f.render();
  assert.deepEqual(origin.focused, ['replacement']); assert.deepEqual(f.requests, [['copy-to-clipboard', 'copy']]);
  origin.grid.querySelectorAll = () => [];
  f.state.restoreCellFocus(); await waitFocus(); assert.deepEqual(origin.focused, ['replacement']);
  origin.cell.isConnected = true; f.state.restoreCellFocus(); f.h.unmount(); await waitFocus();
  assert.deepEqual(origin.focused, ['replacement']);
});
