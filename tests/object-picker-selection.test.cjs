// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

async function fixture() {
  const h = createHookHarness(), confirmed = [];
  const react = { ...h.react, useId: () => 'selection', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const object = (schema, category, name) => ({ key: JSON.stringify([schema,category,name]), dbType: 'oracle', schema, category, name, displayName: name });
  const Picker = loadTypeScript('src/features/objects/ObjectPickerDialog.tsx', {
    react, '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    'react-i18next': { useTranslation: () => ({ t: (key, args) => args?.name ? key + ':' + args.name : key }) },
    './objectRepository': { OBJECT_PAGE_SIZE: 100, OBJECT_CATEGORIES: { oracle: ['TABLE','VIEW'] }, getObjectCategoryLabel: category => category,
      listObjectSchemas: async () => ['first','second'],
      listObjects: async ({ schema, category, offset }) => offset ? [object(schema,category,'page-two')] : Array.from({ length: 100 }, (_, index) => object(schema,category,index ? 'row-' + index : 'page-one')) }
  }, { React: react }).default;
  const props = { open: true, dbType: 'oracle', initialSchema: 'first', initialCategory: 'TABLE', multiple: true, onConfirm: values => confirmed.push(values), onClose() {} };
  let tree;
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
  const render = () => { tree = h.render(() => Picker(props)); h.commit(); };
  const nodes = () => walk(tree);
  const settle = async () => { for (let i=0;i<5;i++) { await new Promise(resolve => setTimeout(resolve, 5)); render(); } };
  const button = label => nodes().find(node => node.type === 'Button' && node.children.includes(label));
  const select = label => nodes().find(node => node.type === 'Select' && node.props.label === label);
  const row = name => nodes().find(node => node.type === 'ListItemButton' && walk(node).some(child => child.type === 'ListItemText' && child.props.primary === name));
  render(); await settle();
  return { props, confirmed, h, render, settle, nodes, button, select, row };
}

test('Picker selection remains visible and removable across pages, schemas and categories without changing the design', async () => {
  const f = await fixture();
  try {
    f.row('page-one').props.onClick(); f.render();
    f.button('next_100').props.onClick(); await f.settle();
    f.row('page-two').props.onClick(); f.render();
    f.select('schema').props.onChange({ target: { value: 'second' } }); await f.settle();
    f.select('category').props.onChange({ target: { value: 'VIEW' } }); await f.settle();
    f.row('page-one').props.onClick(); f.render();
    f.button('selected_3').props.onClick(); f.render();
    assert.equal(f.nodes().find(node => node.type === 'Collapse').props.in, true);
    let remove = f.nodes().filter(node => node.props['aria-label']?.startsWith('ux_remove_selected_object:'));
    assert.equal(remove.length, 3);
    remove[0].props.onClick(); f.render();
    remove = f.nodes().filter(node => node.props['aria-label']?.startsWith('ux_remove_selected_object:'));
    assert.equal(remove.length, 2);
    assert.equal(f.confirmed.length, 0);
    f.button('ux_clear_selection').props.onClick(); f.render();
    assert.equal(f.button('add').props.disabled, true);
    assert.ok(f.nodes().some(node => node.children.includes('ux_no_selection')));
    assert.equal(f.confirmed.length, 0);
    f.row('page-one').props.onClick(); f.render();
    await f.button('add').props.onClick(); f.render();
    assert.equal(f.confirmed.length, 1);
    assert.equal(f.confirmed[0][0].schema, 'second');
    assert.equal(f.confirmed[0][0].category, 'VIEW');
    f.props.open = false; f.render();
    f.props.open = true; f.render(); await f.settle();
    assert.equal(f.nodes().find(node => node.type === 'Collapse').props.in, false);
    assert.equal(f.button('add').props.disabled, true);
  } finally { f.h.unmount(); }
});

test('A single-selection picker replaces its draft and already-added objects remain protected', async () => {
  const f = await fixture();
  try {
    f.props.multiple = false;
    f.props.isObjectAdded = object => object.name === 'row-1'; f.render();
    assert.equal(f.row('row-1').props.disabled, true);
    f.row('page-one').props.onClick(); f.render();
    f.row('row-2').props.onClick(); f.render();
    await f.button('add').props.onClick(); f.render();
    assert.equal(f.confirmed[0].length, 1);
    assert.equal(f.confirmed[0][0].name, 'row-2');
    assert.equal(f.row('row-1').props.disabled, true);
  } finally { f.h.unmount(); }
});

test('Single-object double-click confirms the clicked row once, retains it on failure and supports retry', async () => {
  const f = await fixture();
  try {
    let finish, calls = 0, closed = 0;
    f.props.multiple = false;
    f.props.onClose = () => closed++;
    f.props.onConfirm = objects => { calls++; f.confirmed.push(objects); return new Promise((resolve, reject) => { finish = { resolve, reject }; }); };
    f.render();
    f.row('page-one').props.onClick(); f.render();
    const clicked = f.row('row-2').props;
    clicked.onDoubleClick(); clicked.onDoubleClick(); f.render();
    assert.equal(calls, 1); assert.equal(f.confirmed[0][0].name, 'row-2');
    assert.equal(f.button('adding').props.disabled, true);
    finish.reject(new Error('Simulated add failure')); await f.settle();
    assert.equal(closed, 0);
    assert.equal(f.row('row-2').children[0].props.checked, true);
    assert.equal(f.button('add').props.disabled, false);
    f.row('row-2').props.onDoubleClick();
    assert.equal(calls, 2); finish.resolve(); await f.settle(); f.render();
    assert.equal(closed, 1); assert.equal(f.confirmed[1][0].name, 'row-2');
  } finally { f.h.unmount(); }
});

test('Multiple selection retains explicit Add and protected or disabled single rows cannot confirm', async () => {
  const f = await fixture();
  try {
    assert.equal(f.row('page-one').props.onDoubleClick, undefined);
    f.props.multiple = false;
    f.props.isObjectAdded = object => object.name === 'row-1'; f.render();
    f.row('row-1').props.onDoubleClick();
    assert.equal(f.confirmed.length, 0);
    f.props.disabled = true; f.render();
    f.row('row-2').props.onDoubleClick();
    assert.equal(f.confirmed.length, 0);
    f.props.disabled = false; f.render();
    f.row('row-2').props.onClick(); f.render();
    assert.equal(f.confirmed.length, 0);
    await f.button('add').props.onClick();
    assert.equal(f.confirmed.length, 1);
  } finally { f.h.unmount(); }
});

const keyEvent = (key, extra = {}) => ({ key, nativeEvent: {}, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra });
function attachRows(f, focused) {
  for (const row of f.nodes().filter(node => node.type === 'ListItemButton')) {
    const name = row.children.find(child => child?.type === 'ListItemText').props.primary;
    row.props.ref({ focus: () => focused.push(name), scrollIntoView() {} });
  }
}
test('Picker keyboard navigation moves focus without selecting and skips already-added rows', async () => {
  const f = await fixture(), focused = [];
  try {
    f.props.isObjectAdded = object => object.name === 'row-1'; f.render(); attachRows(f, focused);
    const search = f.nodes().find(node => node.type === 'TextField');
    search.props.onKeyDown(keyEvent('ArrowDown')); f.render();
    assert.equal(focused.at(-1), 'page-one'); assert.equal(f.button('add').props.disabled, true);
    f.row('page-one').props.onKeyDown(keyEvent('ArrowDown')); f.render();
    assert.equal(focused.at(-1), 'row-2');
    f.row('row-2').props.onKeyDown(keyEvent('End')); f.render(); assert.equal(focused.at(-1), 'row-99');
    f.row('row-99').props.onKeyDown(keyEvent('Home')); f.render(); assert.equal(focused.at(-1), 'page-one');
    assert.equal(f.nodes().filter(node => node.type === 'ListItemButton' && node.props.tabIndex === 0).length, 1);
    assert.equal(f.confirmed.length, 0);
  } finally { f.h.unmount(); }
});
test('Picker Space toggles once and Enter in multiple mode never submits or changes selection', async () => {
  const f = await fixture();
  try {
    f.row('page-one').props.onKeyDown(keyEvent(' ')); f.render();
    assert.equal(f.row('page-one').props['aria-selected'], true);
    f.row('page-one').props.onKeyUp(keyEvent(' '));
    // Model ButtonBase's synthesized Enter click as well as native key handlers.
    f.row('page-one').props.onKeyDown(keyEvent('Enter'));
    f.row('page-one').props.onClick({ type: 'keydown' }); f.render();
    assert.equal(f.row('page-one').props['aria-selected'], true); assert.equal(f.confirmed.length, 0);
    f.row('page-one').props.onKeyDown(keyEvent(' ', { repeat: true })); f.render();
    assert.equal(f.row('page-one').props['aria-selected'], true);
    f.row('page-one').props.onKeyDown(keyEvent(' ')); f.render();
    assert.equal(f.row('page-one').props['aria-selected'], false);
  } finally { f.h.unmount(); }
});
test('Single picker Enter confirms only once and IME, pending and stale-result keys cannot add', async () => {
  const f = await fixture(); let release;
  try {
    f.props.multiple = false; f.props.onConfirm = values => { f.confirmed.push(values); return new Promise(resolve => { release = resolve; }); }; f.render();
    for (const extra of [{ nativeEvent: { isComposing: true } }, { keyCode: 229 }, { ctrlKey: true }]) {
      f.row('page-one').props.onKeyDown(keyEvent('Enter', extra)); f.row('page-one').props.onClick({ type: 'keydown' });
    }
    assert.equal(f.confirmed.length, 0);
    const enter = f.row('page-one').props.onKeyDown;
    enter(keyEvent('Enter')); enter(keyEvent('Enter')); f.render();
    assert.equal(f.confirmed.length, 1); assert.equal(f.confirmed[0][0].name, 'page-one');
    release(); await f.settle();
    f.nodes().find(node => node.type === 'TextField').props.onChange({ target: { value: 'changed' } }); f.render();
    assert.equal(f.row('page-one'), undefined);
  } finally { f.h.unmount(); }
});
