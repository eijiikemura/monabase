// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { componentHarness: render } = require('./helpers/componentHarness.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('Diff layout controls ignore deselection and keep the chosen accessible layout', () => {
  const changes = [], f = render('src/components/data/DiffLayoutControls.tsx', { splitView: true, onChange: value => changes.push(value) });
  assert.equal(f.tree.props.value, 'split'); assert.equal(f.tree.props['aria-label'], 'diff_layout');
  f.tree.props.onChange({}, null); assert.deepEqual(changes, []); f.tree.props.onChange({}, 'unified'); assert.deepEqual(changes, ['unified']);
  f.props.splitView = false; f.render(); assert.equal(f.tree.props.value, 'unified'); f.unmount();
});

test('Date input preserves typed values, date/time precision, disabled state and picker fallback', () => {
  const changes = [], f = render('src/components/data/DateInput.tsx', { value: 'original', inputDateFormat: 'YYYY-MM-DD HH24:mm:ss', onChange: value => changes.push(value) });
  f.node('TextField').props.onChange({ target: { value: 'typed value' } }); assert.deepEqual(changes, ['typed value']);
  assert.equal(f.node('input').props.type, 'datetime-local');
  let picker = 0, focused = 0;
  f.node('input').props.ref.current = { showPicker: () => { picker++; }, focus: () => { focused++; } };
  f.node('IconButton').props.onClick(); assert.equal(picker, 1);
  f.node('input').props.ref.current.showPicker = () => { throw new Error('Picker unavailable'); };
  f.node('IconButton').props.onClick(); assert.equal(focused, 1);
  delete f.node('input').props.ref.current.showPicker; f.node('IconButton').props.onClick(); assert.equal(focused, 2);
  const selected = { value: '2026-10-29T12:34:56' }; f.node('input').props.onChange({ target: selected }); assert.equal(selected.value, '');
  f.props.inputDateFormat = 'YYYY-MM-DD'; f.render(); assert.equal(f.node('input').props.type, 'date');
  f.props.disabled = true; f.render(); assert.equal(f.node('TextField').props.disabled, true); assert.equal(f.node('input'), undefined); f.unmount();
});

test('About dialog reads the actual license/version, ignores late reads, delegates links and closes explicitly', async () => {
  const pending = deferred(), calls = [], alerts = []; let closed = 0;
  const f = render('src/components/AboutDialog.tsx', { open: true, onClose: () => { closed++; } }, {
    dependencies: { '../../LICENSE?raw': 'Apache License\nCopyright test owner', './MonaBaseLogo': 'Logo', '../shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); if (args[0] === 'get-app-version') return pending.promise; throw new Error('Unavailable'); } } } },
    globals: { window: { alert: value => alerts.push(value) } }
  });
  await f.flush(); f.props.open = false; await f.flush(); pending.resolve('9.9.9'); await f.flush(); assert.ok(!f.text().includes('v9.9.9'));
  const link = f.node('Link'); let prevented = false; await link.props.onClick({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(calls.at(-1)[0], 'open-external'); assert.equal(alerts.length, 1);
  assert.ok(f.text().includes('Apache License\nCopyright test owner')); await f.click('close'); assert.equal(closed, 1); f.unmount();
});
test('About links follow the configured UI language and prevent in-app navigation for website and icon links', async () => {
  const calls = [], language = { language: 'en' };
  const f = render('src/components/AboutDialog.tsx', { open: true, onClose() {} }, {
    dependencies: { '../../LICENSE?raw': 'Apache License', './MonaBaseLogo': 'Logo',
      'react-i18next': { useTranslation: () => ({ t: key => key, i18n: language }) },
      '../shared/api/desktop': { ipcRenderer: { invoke: async (...args) => { calls.push(args); if (args[0] === 'get-app-version') return '1.0.0'; } } }
    }
  });
  try {
    await f.flush();
    for (const locale of ['en', 'ja', 'fr']) {
      language.language = locale; f.render();
      const website = f.node('Link');
      const url = `https://eijiikemura.github.io/monabase/${locale === 'ja' ? 'ja/' : ''}`;
      assert.equal(website.props.href, url);
      let prevented = false; await website.props.onClick({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true); assert.deepEqual(calls.at(-1), ['open-external', url]);
    }
    for (const [name, url, icon] of [['GitHub', 'https://github.com/eijiikemura/monabase', 'GitHub'], ['X', 'https://x.com/eijiikemura', 'X']]) {
      const link = f.node('IconButton', node => node.props['aria-label'] === name);
      assert.equal(link.props.component, 'a'); assert.equal(link.props.href, url);
      assert.equal(link.children[0].type, icon); assert.equal(f.text().includes(url), false);
      assert.ok(f.node('Tooltip', node => node.props.title === name));
      let prevented = false; await link.props.onClick({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true); assert.deepEqual(calls.at(-1), ['open-external', url]);
    }
  } finally { f.unmount(); }
});
test('Shared Help menu orders the localized manual before About and delegates browser opens without navigating', async () => {
  const language = { language: 'en' }, actions = [], alerts = [];
  let fail = false;
  const f = render('src/components/HelpMenu.tsx', { anchorEl: null, onOpen: () => actions.push('open'), onClose: () => actions.push('close'), onAbout: () => actions.push('about') }, {
    dependencies: { 'react-i18next': { useTranslation: () => ({ t: key => key, i18n: language }) },
      '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, url) => { actions.push([channel, url]); if (fail) throw new Error('Unavailable'); } } } },
    globals: { window: { alert: value => alerts.push(value) } }
  });
  try {
    assert.equal(f.node('Button').props['aria-expanded'], false);
    f.node('Button').props.onClick({ currentTarget: 'button' }); assert.equal(actions.at(-1), 'open');
    f.props.anchorEl = {}; f.render(); assert.equal(f.node('Button').props['aria-expanded'], true);
    for (const locale of ['en', 'ja', 'fr']) {
      language.language = locale; f.render();
      const items = f.nodes().filter(node => node.type === 'MenuItem');
      assert.ok(items[0].children.includes('online_manual')); assert.ok(items[1].children.includes('about'));
      const url = `https://eijiikemura.github.io/monabase/${locale === 'ja' ? 'ja/' : ''}guides/getting-started/`;
      assert.equal(items[0].props.href, url); assert.equal(items[0].props.component, 'a');
      let prevented = false; await items[0].props.onClick({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true); assert.equal(actions.at(-2), 'close'); assert.deepEqual(actions.at(-1), ['open-external', url]);
    }
    fail = true; await f.node('MenuItem').props.onClick({ preventDefault() {} }); assert.deepEqual(alerts, ['failed_to_open_external_link']);
    const before = actions.length; f.nodes().filter(node => node.type === 'MenuItem')[1].props.onClick();
    assert.deepEqual(actions.slice(before), ['close', 'about']);
  } finally { f.unmount(); }
});
for (const mode of ['light', 'dark']) test(`Connection badge ${mode} displays verified/disabled TLS and disconnected state without credentials`, () => {
  const config = { dbType: 'postgresql', name: 'Production', database: 'demo', user: 'test', host: 'db.invalid', password: 'DO_NOT_DISPLAY', environmentLabel: 'Production', environmentColor: 'red', pgSslMode: 'verify-full' };
  const f = render('src/components/ConnectionBadge.tsx', { config, dbInfo: 'PostgreSQL', disconnected: false }, { themeMode: mode });
  assert.equal(f.node('Chip').props.label, 'security_tls_verified'); assert.ok(!f.text().includes(config.password));
  config.pgSslMode = 'disable'; f.render(); assert.equal(f.node('Chip').props.label, 'security_tls_disabled');
  f.props.disconnected = true; f.render(); assert.equal(f.node('Chip'), undefined); assert.ok(f.text().includes('not_connected_disconnected'));
  config.dbType = 'oracle'; f.props.disconnected = false; f.render(); assert.equal(f.node('Chip'), undefined); f.unmount();
});

test('Error boundary preserves child content until failure and then renders only its recovery content', () => {
  const { module } = render('src/components/feedback/ScreenErrorBoundary.tsx', { children: 'workspace', fallback: 'reconnect' });
  const Boundary = module.default, boundary = new Boundary({ children: 'workspace', fallback: 'reconnect' });
  assert.equal(boundary.render(), 'workspace'); boundary.state = Boundary.getDerivedStateFromError(new Error('failed')); assert.equal(boundary.render(), 'reconnect');
});

test('Workspace divider clamps normal/reversed keyboard movement and preserves unrelated keys', () => {
  const values = []; const f = render('src/components/navigation/WorkspaceDivider.tsx', { label: 'pane', value: 110, min: 100, max: 150, onChange: value => values.push(value), onMouseDown() {} });
  const key = (value, shiftKey = false) => { let prevented = false; f.tree.props.onKeyDown({ key: value, shiftKey, preventDefault: () => { prevented = true; } }); return prevented; };
  key('ArrowLeft'); key('ArrowRight', true); key('Home'); key('End'); assert.deepEqual(values, [100, 150, 100, 150]);
  f.props.reverse = true; f.render(); key('ArrowRight'); assert.equal(values.at(-1), 100); assert.equal(key('Enter'), false); f.unmount();
});

test('Transaction controls show pending work and invoke only the selected explicit action', async () => {
  const actions = []; const f = render('src/components/TopMenuBar.tsx', { hasUncommittedTx: false, onCommit: () => actions.push('commit'), onRollback: () => actions.push('rollback') });
  assert.equal(f.node('Chip'), undefined); f.props.hasUncommittedTx = true; f.render(); assert.equal(f.node('Chip').props.role, 'status');
  await f.click('commit'); await f.click('rollback'); assert.deepEqual(actions, ['commit', 'rollback']); f.unmount();
});

test('Window progress and logo expose accessible status and the expected vector artwork', () => {
  const f = render('src/components/feedback/WindowLoadingIndicator.tsx', {}, { name: 'WindowLoadingIndicator' });
  assert.equal(f.tree.props.role, 'status'); assert.equal(f.node('CircularProgress').props['aria-label'], 'loading'); f.unmount();
  const logo = render('src/components/MonaBaseLogo.tsx', { titleAccess: 'MonaBase' });
  assert.equal(logo.tree.props.viewBox, '0 0 100 100'); assert.equal(logo.tree.props.titleAccess, 'MonaBase'); assert.ok(logo.nodes().filter(node => node.type === 'path').length >= 3); logo.unmount();
});

test('SQL file actions, privacy toggle and pane controls retain guards and explicit callbacks', async () => {
  const actions = []; const f = render('src/features/sql/SqlFileActions.tsx', { disabled: false, onOpen: () => actions.push('open'), onSaveAs: () => actions.push('save') });
  await f.click('sql_open_file'); await f.click('sql_save_as'); f.props.disabled = true; f.render(); assert.ok(f.nodes().filter(node => node.type === 'IconButton').every(node => node.props.disabled)); f.unmount();
  let privacy = false; const p = render('src/features/sql/SqlPrivacyToggle.tsx', { active: false, disabled: false, onChange: update => { privacy = update(privacy); } });
  await p.click('sql_private_execution'); assert.equal(privacy, true); p.props.active = true; p.props.disabled = true; p.render(); assert.equal(p.node('IconButton').props['aria-pressed'], true); assert.equal(p.node('IconButton').props.disabled, true); p.unmount();
  const panes = render('src/features/sql/SqlPaneLayout.tsx', { mode: 'split', onChange: value => actions.push(value) }, { name: 'SqlPaneControls' });
  await panes.click('sql_maximize_editor'); await panes.click('sql_maximize_result'); panes.props.mode = 'result'; panes.render(); await panes.click('sql_restore_split'); assert.deepEqual(actions, ['open', 'save', 'editor', 'result', 'split']); panes.unmount();
});

test('History paging and category status expose limits, loading and explicit retry', async () => {
  const pages = []; const f = render('src/features/git/GitHistoryPagination.tsx', { page: 0, hasMore: true, loading: false, onChange: value => pages.push(value) });
  assert.equal(f.button('git_history_previous').props.disabled, true); await f.click('git_history_next'); assert.deepEqual(pages, [1]);
  f.props.page = 2; f.render(); await f.click('git_history_previous'); assert.deepEqual(pages, [1, 1]); f.props.loading = true; f.render(); assert.ok(f.nodes().filter(node => node.type === 'Button').every(node => node.props.disabled)); f.unmount();
  let retries = 0; const s = render('src/features/objects/SidebarCategoryStatus.tsx', { loading: true, error: 'failed', size: 100, more: true, onRetry: () => { retries++; } }, { name: 'SidebarCategoryStatus' });
  assert.equal(s.button('retry').props.disabled, true); s.props.loading = false; s.render(); await s.click('retry'); assert.equal(retries, 1); assert.ok(s.text().includes('sidebar_previous_results')); s.unmount();
});

for (const [file, name, kind] of [['src/features/index/IndexTablePicker.tsx', 'IndexTablePicker', 'TABLE'], ['src/features/trigger/TriggerTargetPicker.tsx', 'TriggerTargetPicker', 'VIEW']]) {
  test(`${name} opens the correct schema/category and accepts only explicit selection`, async () => {
    const selected = []; const f = render(file, { database: 'postgresql', schema: 'test', table: '', type: kind, disabled: false, onChange: value => selected.push(value) }, { name, dependencies: { '@/features/objects/ObjectPickerDialog': 'Picker' } });
    f.node('Button').props.onClick(); f.render(); assert.equal(f.node('Picker').props.open, true); assert.equal(f.node('Picker').props.fixedSchema, 'test'); assert.deepEqual(Array.from(f.node('Picker').props.categories), [kind]);
    f.node('Picker').props.onClose(); f.render(); assert.deepEqual(selected, []); f.node('Picker').props.onConfirm([{ name: 'Chosen' }]); f.render(); assert.deepEqual(selected, ['Chosen']); assert.equal(f.node('Picker').props.open, false);
    f.props.schema = ''; f.render(); assert.equal(f.node('Button').props.disabled, true); f.unmount();
  });
}

test('AI object picker prevents a closed source from adding references and tracks existing objects', () => {
  let available = true, added = [];
  const selection = { dbType: 'oracle', subscribe: () => () => {}, getSnapshot: () => [{ object: { key: 'one' } }], getInitialSchema: () => 'TEST', isAvailable: () => available, addObjects: objects => { added = objects; } };
  const f = render('src/features/ai/AiObjectPickerDialog.tsx', { open: true, disabled: false, onClose() {}, selection }, { dependencies: { '../objects/ObjectPickerDialog': 'Picker' } });
  assert.equal(f.tree.props.isObjectAdded({ key: 'one' }), true); f.tree.props.onConfirm([{ key: 'two' }]); assert.equal(added[0].key, 'two'); available = false; f.render(); assert.equal(f.tree.props.disabled, true); assert.throws(() => f.tree.props.onConfirm([{ key: 'three' }]), /closed/); f.unmount();
});

test('Stable footer reads the current context without changing its component identity', () => {
  const f = render('src/features/data-grid/StableGridFooter.tsx', {}, { name: 'StableGridFooter' });
  f.module.GridFooterContent.value = 'updated controls'; f.render(); assert.ok(f.tree.children.includes('updated controls')); f.unmount();
});
