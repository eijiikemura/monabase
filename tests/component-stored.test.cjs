// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');
const dependencies = { '@mui/x-tree-view/TreeView': { TreeView: 'TreeView' }, '@mui/x-tree-view/TreeItem': { TreeItem: 'TreeItem' } };

test('Stored output hides internal trace records and routes only errors to source navigation', () => {
  const jumps = [], f = render('src/features/stored/StoredCommonUI.tsx', { bottomTab: 1, setBottomTab() {}, returnValues: [{ name: 'amount', value: '9007199254740993.123' }], displayOutputs: ['', '[TRACE hidden]', 'User output', '[ERROR] line 3'], handleClearLogs() {}, handleConsoleClick: value => jumps.push(value) }, { name: 'SharedBottomPanel', dependencies });
  assert.ok(!f.text().includes('[TRACE hidden]')); assert.ok(f.text().includes('9007199254740993.123'));
  f.node('Box', node => node.children.includes('User output')).props.onClick(); assert.deepEqual(jumps, []);
  f.node('Box', node => node.children.includes('[ERROR] line 3')).props.onClick(); assert.deepEqual(jumps, ['[ERROR] line 3']); f.unmount();
});

test('Breakpoint editor loads the selected line, validates hit counts and clears conditions explicitly', async () => {
  const changes = []; let closed = 0;
  const simulator = { breakpointConditions: { 8: { type: 'hit_count', count: 3 } }, setBreakpointCondition: (...args) => changes.push(args) };
  const f = render('src/features/stored/StoredCommonUI.tsx', { anchorEl: {}, menuLineNum: 8, simulator, onClose: () => { closed++; } }, { name: 'BreakpointConditionPopover', dependencies });
  await f.flush(); assert.equal(f.node('TextField').props.value, '3');
  f.node('TextField').props.onChange({ target: { value: '-1' } }); f.render(); await f.click('save'); assert.equal(changes[0][0], 8); assert.equal(changes[0][1], null);
  f.node('RadioGroup').props.onChange({ target: { value: 'variable' } }); f.render();
  f.node('TextField', node => node.props.label === 'variable_name').props.onChange({ target: { value: '  total  ' } }); f.render();
  f.node('TextField', node => node.props.label === 'compare_value').props.onChange({ target: { value: '200' } }); f.render(); await f.click('save');
  assert.equal(changes[1][1].varName, 'total'); assert.equal(changes[1][1].expectedValue, '200'); await f.click('clear'); assert.equal(changes[2][1], null); assert.equal(closed, 3); f.unmount();
});

test('Stored argument panel excludes OUT/return values, preserves exact input and distinguishes defaults from NULL', async () => {
  let values = {}, modes = {};
  const f = render('src/features/stored/StoredCommonUI.tsx', { mainTab: 0, traceRightTab: 0, setTraceRightTab() {}, setIsRightPanelOpen() {}, argumentsList: [
    { POSITION: 0, ARGUMENT_NAME: 'RETURN_VALUE', DATA_TYPE: 'NUMBER', IN_OUT: 'OUT' },
    { POSITION: 1, ARGUMENT_NAME: 'p_out', DATA_TYPE: 'NUMBER', IN_OUT: 'OUT' },
    { POSITION: 2, ARGUMENT_NAME: 'p_in', DATA_TYPE: 'NUMBER', IN_OUT: 'IN', DEFAULTED: 'Y' }
  ], argValues: {}, setArgValues: value => { values = value; }, argumentModes: {}, setArgumentModes: update => { modes = update(modes); },
  traceDateTime: null, traceArguments: {}, simulator: { currentStepIndex: -1, executionSteps: [] }, groupedVariables: {} }, { name: 'SharedRightPanel', dependencies });
  await f.flush(); assert.ok(!f.text().includes('p_out')); assert.ok(!f.text().includes('RETURN_VALUE'));
  f.node('TextField').props.onChange({ target: { value: '9007199254740993.123' } }); assert.equal(values.p_in, '9007199254740993.123');
  f.node('Select').props.onChange({ target: { value: 'default' } }); f.props.argumentModes = modes; f.render();
  assert.equal(f.node('Box', node => node.props.component === 'fieldset').props.disabled, true);
  f.props.argumentModes = { p_in: 'value' }; f.render(); assert.equal(f.node('TextField').props.placeholder, 'routine_blank_is_null'); f.unmount();
});

test('Trace source search wraps matches, ignores inactive shortcuts, maps breakpoints and removes listeners on unmount', async () => {
  const listeners = new Set(), scrolls = [], breakpoints = [], contexts = [];
  const f = render('src/features/stored/TraceDebugArea.tsx', { sourceText: 'SELECT one\nother\nselect two', simulator: { activeLine: null, breakpoints: [], breakpointConditions: {}, toggleBreakpoint: line => breakpoints.push(line) }, isDarkTheme: false, isActiveTab: true,
    onContextMenu: (_event, line) => contexts.push(line), highlightLine: line => line, getActualLineNum: line => line === 2 ? undefined : line + 10
  }, { name: 'TraceDebugArea', globals: {
    window: { addEventListener: (_type, listener) => listeners.add(listener), removeEventListener: (_type, listener) => listeners.delete(listener) },
    document: { getElementById: id => ({ scrollIntoView: () => scrolls.push(id) }) }
  } });
  const key = async (key, extra = {}) => { for (const listener of [...listeners]) listener({ key, preventDefault() {}, ...extra }); await f.flush(); };
  await f.flush(); await key('f', { metaKey: true }); assert.ok(f.node('InputBase'));
  f.node('InputBase').props.onChange({ target: { value: 'SELECT' } }); await f.flush(); assert.ok(f.text().includes('1 / 2'));
  await key('F3'); assert.ok(f.text().includes('2 / 2')); await key('F3'); assert.ok(f.text().includes('1 / 2'));
  await key('F3', { shiftKey: true }); assert.ok(f.text().includes('2 / 2')); assert.ok(scrolls.includes('trace-line-3'));
  const line = f.node('Box', node => node.props.id === 'trace-line-1').children[0]; line.props.onClick(); line.props.onContextMenu({});
  f.node('Box', node => node.props.id === 'trace-line-2').children[0].props.onClick(); assert.deepEqual(breakpoints, [11]); assert.deepEqual(contexts, [11]);
  await key('Escape'); assert.equal(f.node('InputBase'), undefined); f.props.isActiveTab = false; await f.flush(); await key('f', { ctrlKey: true }); assert.equal(f.node('InputBase'), undefined);
  f.unmount(); assert.equal(listeners.size, 0);
});
