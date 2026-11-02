// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

test('Notifications preserve error actions without blocking and dispose subscriptions', () => {
  const fallback = [], notices = [], events = [];
  const { notify, subscribeNotices } = loadTypeScript('src/shared/utils/notifications.ts', {}, {
    alert: message => fallback.push(message),
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  });
  notify('Standalone failure');
  assert.deepEqual(fallback, ['Standalone failure']);
  const unsubscribe = subscribeNotices(notice => notices.push(notice));
  let attempts = 0;
  notify('Retryable failure', { onAction: () => attempts++ });
  notify('Saved', { severity: 'success' });
  assert.equal(notices[0].severity, 'error');
  assert.equal(notices[1].severity, 'success');
  assert.notEqual(notices[0].id, notices[1].id);
  assert.equal(attempts, 0);
  notices[0].onAction();
  assert.equal(attempts, 1);
  assert.deepEqual(Object.keys(events[0].detail).sort(), ['message', 'severity']);
  assert.equal(fallback.length, 1);
  unsubscribe();
  notify('After disposal');
  assert.equal(notices.length, 2);
  assert.equal(fallback.at(-1), 'After disposal');
});

test('Command search preserves tab identity and rejects modal, busy and disabled actions', () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const hook = createHookHarness(), listeners = new Map(), calls = [];
  let modal = false, tree;
  const react = { ...hook.react, useId: () => 'search', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const Navigation = loadTypeScript('src/components/navigation/WorkspaceNavigation.tsx', {
    react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@mui/icons-material/Search': 'Search', '@mui/icons-material/ListAlt': 'ListAlt'
  }, { React: react, window: { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name) },
    document: { querySelector: () => modal ? {} : null, getElementById: () => null } }).default;
  const props = { tabs: [{ id: 'existing', label: 'Long SQL tab', detail: 'schema.object', run: () => calls.push('existing') }],
    commands: [{ id: 'database', label: 'SQL', disabled: true, run: () => calls.push('disabled') }, { id: 'settings', label: 'Settings', shortcut: 'Ctrl/⌘+S', run: () => calls.push('settings') }] };
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children)];
  const get = type => walk(tree).find(node => node.type === type);
  const render = () => { tree = hook.render(() => Navigation(props)); hook.commit(); };
  const shortcut = key => { listeners.get('keydown')({ key, ctrlKey: true, shiftKey: true, preventDefault() {} }); render(); };
  const enter = () => { get('Dialog').props.onKeyDownCapture({ key: 'Enter', nativeEvent: {}, preventDefault() {}, stopPropagation() {} }); render(); };
  render();
  modal = true; shortcut('p');
  assert.equal(get('Dialog').props.open, false);
  modal = false;
  listeners.get('toggle-global-loader')({ detail: true }); render(); shortcut('p');
  assert.equal(get('Dialog').props.open, false);
  listeners.get('toggle-global-loader')({ detail: false }); render(); shortcut('p');
  get('TextField').props.onChange({ target: { value: 'SQL' } }); render(); enter();
  assert.equal(get('Dialog').props.open, true);
  assert.deepEqual(calls, []);
  get('TextField').props.onChange({ target: { value: 'settings' } }); render(); enter();
  assert.deepEqual(calls, ['settings']);
  assert.equal(get('Dialog').props.open, false);
  props.commands.push({ id: 'blocked', label: 'Blocked', disabled: true, run: () => calls.push('blocked') }, { id: 'other', label: 'Other', run: () => calls.push('other') });
  shortcut('p');
  const key = value => { get('Dialog').props.onKeyDownCapture({ key: value, nativeEvent: {}, preventDefault() {}, stopPropagation() {} }); render(); };
  key('ArrowDown');
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-3');
  key('ArrowDown');
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-1');
  key('End'); key('ArrowUp');
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-1');
  assert.ok(walk(tree).some(node => node.type === 'Typography' && node.props.component === 'kbd' && node.children.includes('Ctrl/⌘+S')));
  props.commands.forEach(command => { command.disabled = true; }); render(); enter();
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], undefined);
  assert.deepEqual(calls, ['settings']);
  get('Dialog').props.onClose(); render();
  shortcut('o');
  get('TextField').props.onChange({ target: { value: 'schema.object' } }); render(); enter();
  assert.deepEqual(calls, ['settings', 'existing']);
  assert.equal(props.tabs.length, 1);
  props.tabs.push({ id: 'second', label: 'Second SQL tab', run: () => calls.push('second') });
  shortcut('o');
  let focusReturns = 0;
  get('TextField').props.inputRef.current = { focus: () => { focusReturns++; } };
  get('Dialog').props.onKeyDownCapture({ key: 'ArrowDown', nativeEvent: { isComposing: true }, preventDefault() { throw Error('IME key was intercepted'); } });
  key('ArrowDown');
  assert.equal(focusReturns, 1);
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-1');
  for (const key of ['Home', 'End']) {
    get('Dialog').props.onKeyDownCapture({ key, target: get('TextField').props.inputRef.current, nativeEvent: {},
      preventDefault() { throw Error('Text editing key was intercepted'); } });
    assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-1');
  }
  get('Dialog').props.onKeyDownCapture({ key: 'ArrowUp', shiftKey: true, nativeEvent: {},
    preventDefault() { throw Error('Modified editing key was intercepted'); } });
  const firstOption = walk(tree).find(node => node.type === 'ListItemButton');
  firstOption.props.onMouseMove?.({ movementX: 0, movementY: 0 }); render();
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-1');
  key('ArrowUp');
  assert.equal(get('TextField').props.inputProps['aria-activedescendant'], 'search-0');
  get('Dialog').props.onKeyDownCapture({ key: 'Enter', nativeEvent: {}, target: { closest: () => ({ id: 'search-1' }) }, preventDefault() {}, stopPropagation() {} }); render();
  assert.equal(calls.at(-1), 'second');
  hook.unmount();
  assert.equal(listeners.size, 0);
});

test('Chat reading position survives streamed answers and follows only after returning to the end', () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const h = createHookHarness();
  const { useChatScroll } = loadTypeScript('src/features/ai/useChatScroll.ts', { react: h.react });
  let messages = [], context = 'first', result;
  const container = { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 };
  const render = () => { result = h.render(() => useChatScroll(messages, false, context)); result.scrollRef.current = container; h.commit(); };
  render(); assert.equal(container.scrollTop, 1000);
  container.scrollTop = 100; result.onScroll(); render();
  assert.equal(result.showLatest, true);
  container.scrollHeight = 1200; messages = ['New answer']; render();
  assert.equal(container.scrollTop, 100);
  result.scrollToLatest(); render();
  assert.equal(container.scrollTop, 1200); assert.equal(result.showLatest, false);
  container.scrollTop = 900; result.onScroll();
  container.scrollHeight = 1500; messages = ['New answer', 'More content']; render();
  assert.equal(container.scrollTop, 1500);
  container.scrollTop = 10; result.onScroll(); context = 'second'; render();
  assert.equal(container.scrollTop, 1500); render(); assert.equal(result.showLatest, false);
  h.unmount();
});

test('Tab descriptions distinguish overloads, zero arguments, package bodies and trigger tables', () => {
  const { workspaceTabDescription: describe } = loadTypeScript('src/components/navigation/workspaceTabDescription.ts');
  const en = require('../src/locales/en.json'), t = key => { assert.ok(en[key], 'Missing translation: ' + key); return en[key]; };
  const routine = { type: 'stored', title: 'Function same', storedIdentity: { schema: 'test', objectName: 'same', objectType: 'FUNCTION', signature: 'integer' }, fullObjectName: '@pg-routine:internal' };
  assert.match(describe(routine, t), /test\.same\(integer\)/);
  assert.notEqual(describe(routine, t), describe({ ...routine, storedIdentity: { ...routine.storedIdentity, signature: 'text' } }, t));
  assert.match(describe({ ...routine, storedIdentity: { ...routine.storedIdentity, signature: '' } }, t), /same\(\)/);
  const trigger = { type: 'trigger', title: 'same', triggerIdentity: { schema: 'test', objectName: 'same', tableName: 'first.table' } };
  assert.match(describe(trigger, t), /Table: test\."first.table"/);
  assert.notEqual(describe(trigger, t), describe({ ...trigger, triggerIdentity: { ...trigger.triggerIdentity, tableName: 'other' } }, t));
  assert.match(describe({ type: 'package', title: 'same', packageIdentity: { schema: 'test', objectName: 'same', objectType: 'PACKAGE BODY' } }, t), /Package Body/);
  assert.equal(describe({ type: 'sql', title: 'SQL 1' }, t), 'SQL 1');
  assert.match(describe({ type: 'table', title: 'name', objectIdentity: { schema: 'a.b', objectName: 'x"y' } }, t), /"a.b"\."x""y"/);
  for (const type of ['table', 'view', 'sequence', 'trigger', 'index', 'type', 'synonym', 'dblink', 'mview', 'mview-log', 'constraint']) {
    assert.ok(describe({ type, title: 'object', objectIdentity: { schema: 'test', objectName: 'obj' } }, t));
  }
});

test('Notification copies stay attached to their message and the list supports individual and bulk dismissal', async () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const h = createHookHarness(), pending = [];
  let receive, tree, rejectCopy;
  const react = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const Host = loadTypeScript('src/components/feedback/NotificationHost.tsx', {
    react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@mui/icons-material/NotificationsOutlined': 'NotificationsIcon', '@mui/icons-material/Close': 'CloseIcon', '@mui/icons-material/ContentCopy': 'CopyIcon',
    '@/shared/utils/notifications': { subscribeNotificationHistory: () => () => {}, openNotificationHistory() {}, subscribeNotices: listener => { receive = listener; return () => { receive = null; }; } },
    '@/shared/api/desktop': { ipcRenderer: { invoke: () => new Promise((resolve, reject) => { pending.push(resolve); rejectCopy = reject; }) } }
  }, { React: react }).default;
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children), ...walk(value.props?.action)];
  const render = () => { tree = h.render(() => Host()); h.commit(); };
  const banner = () => walk(tree).find(node => node.props['data-testid'] === 'persistent-notification');
  const copy = () => walk(banner()).find(node => node.props['aria-label'] === 'ux_copy_details').props.onClick();
  render(); receive({ id: 1, createdAt: 1000, message: 'first', severity: 'error' }); render(); copy();
  receive({ id: 2, createdAt: 2000, message: 'second', severity: 'warning' }); render();
  pending.shift()(true); await h.settle(); render();
  assert.equal(walk(banner()).some(node => node.props.role === 'status'), false);
  copy(); pending.shift()(true); await h.settle(); render();
  assert.equal(walk(banner()).some(node => node.props.role === 'status'), true);
  copy(); pending.shift()(false); await h.settle(); render();
  assert.ok(walk(banner()).some(node => node.children.includes('ux_copy_failed_retry')));
  copy(); rejectCopy(new Error('Clipboard unavailable')); pending.shift(); await h.settle(); render();
  assert.ok(walk(banner()).some(node => node.children.includes('ux_copy_failed_retry')));
  assert.equal(walk(banner()).find(node => node.props['aria-label'] === 'ux_copy_details').props.disabled, false);
  copy(); pending.shift()(true); await h.settle(); render();
  assert.equal(walk(banner()).some(node => node.children.includes('ux_copy_failed_retry')), false);
  walk(banner()).find(node => node.type === 'Button' && node.children.includes('ux_notifications')).props.onClick(); render();
  assert.equal(walk(tree).find(node => node.type === 'Dialog').props.open, true);
  let rows = walk(tree).filter(node => node.props.component === 'li'); assert.equal(rows.length, 2);
  walk(rows[0]).find(node => node.props['aria-label'] === 'ux_remove_notification').props.onClick(); render();
  rows = walk(tree).filter(node => node.props.component === 'li'); assert.equal(rows.length, 1);
  walk(tree).find(node => node.type === 'Button' && node.children.includes('ux_clear_notification_history')).props.onClick(); render();
  assert.equal(walk(tree).filter(node => node.props.component === 'li').length, 0);
  assert.ok(walk(tree).some(node => node.children.includes('ux_no_notifications')));
  h.unmount(); assert.equal(receive, null);
});

test('Notification history retains closed errors and expired successes, opens from the header and never replays archived actions', () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const h = createHookHarness();
  const notices = loadTypeScript('src/shared/utils/notifications.ts');
  const react = { ...h.react, createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  const { default: Host, NotificationHistoryButton } = loadTypeScript('src/components/feedback/NotificationHost.tsx', {
    react, 'react-i18next': { useTranslation: () => ({ t: key => key }) },
    '@mui/material': new Proxy({}, { get: (_target, name) => name }),
    '@mui/icons-material/NotificationsOutlined': 'Bell', '@mui/icons-material/Close': 'Close', '@mui/icons-material/ContentCopy': 'Copy',
    '@/shared/utils/notifications': notices, '@/shared/api/desktop': { ipcRenderer: { invoke: async () => true } }
  }, { React: react });
  const walk = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(walk) : [value, ...walk(value.children), ...walk(value.props?.action)];
  let tree, attempts = 0;
  const render = () => { tree = h.render(() => Host()); h.commit(); };
  render();
  notices.notify('Retryable failure', { onAction: () => attempts++ }); render();
  const banner = walk(tree).find(node => node.props['data-testid'] === 'persistent-notification');
  walk(banner).find(node => node.props['aria-label'] === 'close').props.onClick(); render();
  assert.ok(!walk(tree).some(node => node.props['data-testid'] === 'persistent-notification'));
  notices.notify('Saved successfully', { severity: 'success' }); render();
  walk(tree).find(node => node.type === 'Snackbar').props.onClose({}, 'timeout'); render();
  assert.equal(walk(tree).find(node => node.type === 'Snackbar').props.open, false);
  const button = NotificationHistoryButton();
  walk(button).find(node => node.type === 'IconButton').props.onClick(); render();
  assert.equal(walk(tree).find(node => node.type === 'Dialog').props.open, true);
  let rows = walk(tree).filter(node => node.props.component === 'li');
  assert.equal(rows.length, 2);
  assert.ok(walk(rows).some(node => node.children.includes('Retryable failure')));
  assert.ok(walk(rows).some(node => node.children.includes('Saved successfully')));
  assert.equal(walk(rows).filter(node => node.props.component === 'time').length, 2);
  assert.ok(!walk(rows).some(node => node.children.includes('retry')));
  assert.equal(attempts, 0);
  for (let i = 0; i < 55; i++) notices.notify('Recent ' + i, { severity: 'info' });
  render(); rows = walk(tree).filter(node => node.props.component === 'li');
  assert.equal(rows.length, 50);
  assert.ok(walk(rows[0]).some(node => node.children.includes('Recent 54')));
  assert.ok(!walk(rows).some(node => node.children.includes('Retryable failure')));
  walk(tree).find(node => node.type === 'Button' && node.children.includes('ux_clear_notification_history')).props.onClick(); render();
  assert.equal(walk(tree).filter(node => node.props.component === 'li').length, 0);
  h.unmount();
  const fresh = createHookHarness();
  Object.assign(react, fresh.react);
  // Host memory is discarded when the application root is unmounted.
  tree = fresh.render(() => Host()); fresh.commit();
  assert.equal(walk(tree).filter(node => node.props.component === 'li').length, 0);
  fresh.unmount();
});

test('Workspace widths restore after quick unmount, separate DB/panel preferences and preserve them during viewport resize', () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  const storage = new Map(), writes = [];
  function mount(database, panel, fallback, viewport = 1200) {
    const h = createHookHarness(), listeners = new Map(), window = { innerWidth: viewport,
      addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
    const { useWorkspacePanelWidth } = loadTypeScript('src/shared/hooks/useWorkspacePanelWidth.ts', { react: h.react }, {
      window, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); writes.push({ key, value }); } }
    });
    const render = () => { const result = h.render(() => useWorkspacePanelWidth(database, panel, fallback)); h.commit(); return result; };
    return { render, resize: width => { window.innerWidth = width; listeners.get('resize')(); }, unmount: () => { h.unmount(); assert.equal(listeners.size, 0); } };
  }
  let first = mount('oracle', 'ai', 400);
  first.render()[1](620); assert.equal(first.render()[0], 620); first.unmount();
  first = mount('oracle', 'ai', 400);
  assert.equal(first.render()[0], 620);
  first.resize(500); assert.equal(first.render()[0], 400);
  first.resize(1200); assert.equal(first.render()[0], 620);
  first.unmount();
  assert.equal(storage.get('monabase.panel-width.oracle.ai'), '620');
  const otherDb = mount('postgresql', 'ai', 300), otherPanel = mount('oracle', 'sidebar', 270);
  assert.equal(otherDb.render()[0], 300); assert.equal(otherPanel.render()[0], 270);
  otherPanel.render()[1](9999); assert.equal(otherPanel.render()[0], 600); otherPanel.unmount();
  otherDb.render()[1](10); assert.equal(otherDb.render()[0], 300); otherDb.unmount();
  assert.ok(writes.every(row => /^monabase\.panel-width\.(oracle|postgresql)\.(ai|sidebar)$/.test(row.key)));
});

test('Invalid or unavailable panel storage falls back safely and never blocks resizing', () => {
  const { createHookHarness } = require('./helpers/renderHook.cjs');
  for (const value of [null, '', 'bad', '-2', 'Infinity', '10001', 'throws']) {
    const h = createHookHarness();
    const { useWorkspacePanelWidth } = loadTypeScript('src/shared/hooks/useWorkspacePanelWidth.ts', { react: h.react }, {
      window: { innerWidth: 1000, addEventListener() {}, removeEventListener() {} },
      localStorage: { getItem: () => { if (value === 'throws') throw Error('Storage unavailable'); return value; }, setItem() { throw Error('Read-only storage'); } }
    });
    const render = () => { const result = h.render(() => useWorkspacePanelWidth('postgresql', 'sidebar', 270)); h.commit(); return result; };
    assert.equal(render()[0], 270);
    render()[1](330); assert.equal(render()[0], 330);
    h.unmount();
  }
});
