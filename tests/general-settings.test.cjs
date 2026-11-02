// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');

const initial = {
  language: 'en', maxTabs: 20, sqlHistoryLimit: 100, sqlHistoryEnabled: true, outputDateFormat: 'YYYY-MM-DD HH:mm:ss',
  inputDateFormat: 'YYYY-MM-DD', numberFormat: 'comma', timezone: '+09:00', theme: 'mona',
  sqlFileMaxMb: 16, erFileMaxMb: 16,
  aiResponseMaxMb: 16, aiIdleTimeoutSeconds: 120, aiRequestTimeoutSeconds: 600,
  aiSendKey: 'enter', queryTimeout: 0, erNotation: 'barker', oracleClientPath: '/fictional/installed-client'
};
function fixture(respond, { confirm = () => true } = {}) {
  const hook = createHookHarness(), dialogHook = createHookHarness(), alerts = [], calls = [], languages = [];
  const t = key => key;
  const i18n = { language: 'en', changeLanguage: language => { languages.push(language); i18n.language = language; } };
  const react = h => ({ ...h.react, lazy: () => 'Workspace', Suspense: 'Suspense', createElement: (type, props, ...children) => ({ type, props: props || {}, children }) });
  const appReact = react(hook), dialogReact = react(dialogHook);
  const ipc = { invoke: async (channel, ...args) => { calls.push({ channel, args }); return respond(channel, ...args); } };
  const mui = new Proxy({}, { get: (_target, name) => name });
  const App = loadTypeScript('src/App.tsx', {
    './features/ai/AiHistoryConnectionContext': { AiHistoryConnectionContext: { Provider: 'HistoryScopeProvider' } },
    react: appReact, 'react-i18next': { useTranslation: () => ({ t, i18n }) }, '@mui/material': mui,
    '@/components/feedback/NotificationHost': 'NotificationHost', './components/LoginScreen': 'Login', './components/SettingsDialog': 'Settings', './components/feedback/ScreenErrorBoundary': 'Boundary',
    './shared/utils/dateFormatter': { DEFAULT_DATETIME_FORMAT: initial.outputDateFormat, DEFAULT_DATE_FORMAT: initial.inputDateFormat },
    './app/themes': { monaTheme: 'mona', darkTheme: 'dark', simpleTheme: 'simple' }, './shared/api/desktop': { ipcRenderer: ipc }
  }, { React: appReact, alert: message => alerts.push(message), window: { addEventListener() {}, removeEventListener() {}, confirm: () => true } }).default;
  const SettingsDialog = loadTypeScript('src/components/SettingsDialog.tsx', {
    react: dialogReact, 'react-i18next': { useTranslation: () => ({ t }) }, '@mui/material': mui,
    '@mui/icons-material/FolderOpen': 'Folder',
    './useSettingsDialog': loadTypeScript('src/components/useSettingsDialog.ts', {
      react: dialogReact, 'react-i18next': { useTranslation: () => ({ t }) }, '../shared/api/desktop': { ipcRenderer: ipc }
    }, { alert: message => alerts.push(message), window: { confirm } })
  }, { React: dialogReact }).default;
  let tree, dialogTree;
  function walk(value) {
    if (!value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.flatMap(walk);
    return [value, ...walk(value.children)];
  }
  const get = type => walk(tree).find(node => node.type === type);
  const render = () => {
    tree = hook.render(() => App()); hook.commit();
    dialogTree = dialogHook.render(() => SettingsDialog(get('Settings').props)); dialogHook.commit();
    dialogTree = dialogHook.render(() => SettingsDialog(get('Settings').props));
  };
  const settle = async () => { await hook.settle(); render(); };
  const open = async () => { await get('Workspace').props.onOpenSettings(); render(); };
  const enter = async () => { await get('Login').props.onLoginSuccess({ dbType: 'oracle', user: 'demo' }, []); render(); };
  render();
  return { hook, render, settle, get, open, enter, calls, alerts, languages, unmount: () => { hook.unmount(); dialogHook.unmount(); },
    dialogNodes: () => walk(dialogTree),
    field: label => walk(dialogTree).find(node => node.type === 'TextField' && node.props.label === label)
  };
}
const respond = (channel) => channel === 'load-settings' ? { ...initial } : { success: true, info: 'Demo' };

test('Opening and saving general settings preserves stored Oracle path and ER notation', async () => {
  const h = fixture(respond); await h.settle(); await h.enter(); await h.open();
  assert.equal(h.get('Settings').props.oracleClientPath, initial.oracleClientPath);
  assert.equal(h.get('Settings').props.erNotation, 'barker');
  const save = h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save'));
  save.props.onClick(); await h.settle();
  const written = h.calls.find(call => call.channel === 'save-settings').args[0];
  assert.deepEqual({ ...written }, initial);
  assert.equal(h.get('Settings').props.isOpen, false);
  await h.open(); assert.equal(h.get('Settings').props.oracleClientPath, initial.oracleClientPath);
});

for (const failure of ['response', 'rejection']) {
  test(`Settings save ${failure} preserves active settings and draft for retry`, async () => {
    let attempts = 0, stored = { ...initial };
    const h = fixture((channel, value) => {
      if (channel === 'load-settings') return stored;
      if (channel === 'save-settings') {
        if (++attempts === 1) {
          if (failure === 'rejection') throw new Error('Simulated private storage error');
          return { success: false, error: 'Simulated private storage error' };
        }
        stored = { ...value }; return { success: true };
      }
      return { success: true, info: 'Demo' };
    });
    await h.settle(); await h.enter(); await h.open();
    h.field('sql_timeout_in_seconds_0_for_unlimited').props.onChange({ target: { value: '45' } }); h.render();
    const draft = { ...initial, language: 'ja', theme: 'dark', queryTimeout: 45, oracleClientPath: '/fictional/new-client', erNotation: 'ie' };
    await h.get('Settings').props.onSave(draft); h.render();
    assert.deepEqual(h.alerts, ['save_settings_failed']);
    assert.equal(h.get('Settings').props.isOpen, true);
    assert.equal(h.get('Settings').props.language, 'en');
    assert.equal(h.get('Settings').props.theme, 'mona');
    assert.equal(h.get('Settings').props.queryTimeout, 0);
    assert.equal(h.get('Settings').props.oracleClientPath, initial.oracleClientPath);
    assert.equal(h.field('sql_timeout_in_seconds_0_for_unlimited').props.value, 45);
    assert.deepEqual(h.languages, []);
    await h.get('Settings').props.onSave(draft); h.render();
    assert.equal(h.get('Settings').props.isOpen, false);
    assert.equal(h.get('Settings').props.theme, 'dark');
    assert.equal(h.get('Settings').props.queryTimeout, 45);
    assert.equal(h.get('Settings').props.oracleClientPath, draft.oracleClientPath);
    assert.deepEqual(h.languages, ['ja']);
    await h.open(); assert.equal(h.get('Settings').props.erNotation, 'ie');
    assert.equal(h.get('Settings').props.oracleClientPath, draft.oracleClientPath);
  });
}

test('Pending settings save blocks duplicate requests, closing and editing until success', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = fixture(channel => channel === 'save-settings' ? pending : respond(channel));
  await h.settle(); await h.enter(); await h.open();
  const props = h.get('Settings').props;
  const first = props.onSave({ ...initial, theme: 'dark' });
  await props.onSave({ ...initial, theme: 'simple' }); props.onClose(); h.render();
  assert.equal(h.calls.filter(call => call.channel === 'save-settings').length, 1);
  assert.equal(h.get('Settings').props.isOpen, true);
  assert.equal(h.get('Settings').props.theme, 'mona');
  assert.equal(h.get('Settings').props.isSaving, true);
  const controls = h.dialogNodes().filter(node => ['Button', 'TextField', 'FormControl', 'Tab', 'IconButton'].includes(node.type));
  assert.ok(controls.length > 10); assert.ok(controls.every(node => node.props.disabled));
  assert.equal(h.dialogNodes().find(node => node.type === 'Dialog').props.onClose, undefined);
  finish({ success: true }); await first; h.render();
  assert.equal(h.get('Settings').props.theme, 'dark');
  assert.equal(h.get('Settings').props.isSaving, false);
  assert.equal(h.get('Settings').props.isOpen, false);
});

test('Opening settings reloads paths changed by login setup after application startup', async () => {
  let stored = { ...initial, oracleClientPath: '' };
  const h = fixture(channel => channel === 'load-settings' ? stored : { success: true, info: 'Demo' });
  await h.settle(); await h.enter();
  stored = { ...initial, oracleClientPath: '/fictional/login-client' };
  await h.open();
  assert.equal(h.get('Settings').props.oracleClientPath, '/fictional/login-client');
});

test('Settings load failure does not open an empty draft and can be retried', async () => {
  let fail = false;
  const h = fixture(channel => {
    if (channel === 'load-settings' && fail) throw new Error('Simulated read error');
    return respond(channel);
  });
  await h.settle(); await h.enter(); fail = true; await h.open();
  assert.equal(h.get('Settings').props.isOpen, false);
  assert.deepEqual(h.alerts, ['failed_to_load_settings']);
  fail = false; await h.open(); assert.equal(h.get('Settings').props.isOpen, true);
});

test('The AI send-key draft saves, propagates to the workspace and survives reopening settings', async () => {
  let stored = { ...initial };
  const h = fixture((channel, value) => {
    if (channel === 'load-settings') return stored;
    if (channel === 'save-settings') { stored = value; return { success: true }; }
    return { success: true, info: 'Demo' };
  });
  await h.settle(); await h.enter(); await h.open();
  const select = h.dialogNodes().find(node => node.type === 'Select' && node.props.label === 'ux_ai_send_key');
  assert.equal(select.props.value, 'enter');
  select.props.onChange({ target: { value: 'modifier-enter' } }); h.render();
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick();
  await h.settle();
  assert.equal(stored.aiSendKey, 'modifier-enter');
  assert.equal(h.get('Workspace').props.settings.aiSendKey, 'modifier-enter');
  await h.open();
  assert.equal(h.dialogNodes().find(node => node.type === 'Select' && node.props.label === 'ux_ai_send_key').props.value, 'modifier-enter');
});

test('AI tab validates limits, retains a failed-save draft, saves and restores defaults', async () => {
  let stored = { ...initial }, fail = true;
  const h = fixture((channel, value) => {
    if (channel === 'load-settings') return stored;
    if (channel === 'save-settings') { if (fail) return { success: false }; stored = value; return { success: true }; }
    return { success: true, info: 'Demo' };
  });
  await h.settle(); await h.enter(); await h.open();
  assert.ok(h.dialogNodes().some(node => node.type === 'Tab' && node.props.label === 'ai_settings_tab'));
  const save = () => h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick();
  for (const [label, invalid] of [['ai_response_max_mb', 65], ['ai_idle_timeout_seconds', 0], ['ai_request_timeout_seconds', 1.5]]) {
    const before = h.calls.filter(call => call.channel === 'save-settings').length;
    h.field(label).props.onChange({ target: { value: invalid } }); h.render(); save(); await h.settle();
    assert.equal(h.calls.filter(call => call.channel === 'save-settings').length, before);
    assert.equal(h.field(label).props.error, true);
    assert.equal(h.field(label).props.helperText, 'settings_integer_range');
    h.field(label).props.onChange({ target: { value: label === 'ai_response_max_mb' ? 24 : label === 'ai_idle_timeout_seconds' ? 180 : 900 } }); h.render();
  }
  save(); await h.settle(); assert.equal(h.get('Settings').props.isOpen, true);
  assert.equal(h.field('ai_response_max_mb').props.value, 24);
  fail = false; save(); await h.settle();
  assert.equal(stored.aiResponseMaxMb, 24); assert.equal(stored.aiIdleTimeoutSeconds, 180); assert.equal(stored.aiRequestTimeoutSeconds, 900);
  await h.open(); assert.equal(h.field('ai_response_max_mb').props.value, 24);
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('apply_default')).props.onClick(); h.render();
  assert.equal(h.field('ai_response_max_mb').props.value, 16);
  assert.equal(h.field('ai_idle_timeout_seconds').props.value, 120);
  assert.equal(h.field('ai_request_timeout_seconds').props.value, 600);
});

test('Files settings validate whole MiB values, preserve failed drafts and reopen saved values', async () => {
  let stored = { ...initial }, fail = true;
  const h = fixture((channel, value) => {
    if (channel === 'load-settings') return stored;
    if (channel === 'save-settings') { if (fail) return { success: false }; stored = value; return { success: true }; }
    return { success: true, info: 'Demo' };
  });
  await h.settle(); await h.enter(); await h.open();
  assert.ok(h.dialogNodes().some(node => node.type === 'Tab' && node.props.label === 'files_settings_tab'));
  const save = () => h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick();
  for (const value of [0, 65, 1.5, NaN]) {
    h.field('sql_file_max_mb').props.onChange({ target: { value } }); h.render(); save(); await h.settle();
    assert.equal(h.calls.filter(call => call.channel === 'save-settings').length, 0);
    assert.equal(h.field('sql_file_max_mb').props.error, true);
    assert.equal(h.field('sql_file_max_mb').props.helperText, 'settings_integer_range');
  }
  h.field('sql_file_max_mb').props.onChange({ target: { value: 8 } });
  h.field('er_file_max_mb').props.onChange({ target: { value: 24 } }); h.render();
  save(); await h.settle(); assert.equal(h.get('Settings').props.isOpen, true);
  assert.equal(h.field('sql_file_max_mb').props.value, 8);
  fail = false; save(); await h.settle(); await h.open();
  assert.equal(h.field('sql_file_max_mb').props.value, 8); assert.equal(h.field('er_file_max_mb').props.value, 24);
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('apply_default')).props.onClick(); h.render();
  assert.equal(h.field('sql_file_max_mb').props.value, 16); assert.equal(h.field('er_file_max_mb').props.value, 16);
});

test('SQL history setting preserves a failed-save draft, reopens saved opt-out and resets to enabled', async () => {
  let stored = { ...initial }, fail = true;
  const h = fixture((channel, value) => {
    if (channel === 'load-settings') return stored;
    if (channel === 'save-settings') { if (fail) return { success: false }; stored = value; return { success: true }; }
    return { success: true, info: 'Demo' };
  });
  await h.settle(); await h.enter(); await h.open();
  const toggle = () => h.dialogNodes().find(node => node.type === 'FormControlLabel' && node.props.label === 'sql_history_enabled').props.control;
  const save = () => h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick();
  assert.equal(toggle().props.checked, true); toggle().props.onChange({ target: { checked: false } }); h.render();
  save(); await h.settle(); assert.equal(h.get('Settings').props.isOpen, true); assert.equal(toggle().props.checked, false);
  fail = false; save(); await h.settle(); await h.open(); assert.equal(toggle().props.checked, false);
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('apply_default')).props.onClick(); h.render();
  assert.equal(toggle().props.checked, true);
});

test('Settings preserve empty numeric drafts and navigate to the first invalid field without an alert or save', async () => {
  const h = fixture(respond), focused = [];
  await h.settle(); await h.enter(); await h.open();
  const input = h.field('max_visible_tabs_1_99');
  input.props.onChange({ target: { value: '' } }); h.render();
  assert.equal(h.field('max_visible_tabs_1_99').props.value, '');
  assert.equal(h.field('max_visible_tabs_1_99').props.helperText, 'settings_number_required');
  h.field('max_visible_tabs_1_99').props.inputRef({ focus: () => focused.push('maxTabs'), scrollIntoView() {} });
  h.dialogNodes().find(node => node.type === 'Tabs').props.onChange({}, 4); h.render();
  const before = h.calls.filter(call => call.channel === 'save-settings').length;
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick(); h.render();
  assert.equal(h.dialogNodes().find(node => node.type === 'Tabs').props.value, 0);
  assert.deepEqual(focused, ['maxTabs']);
  assert.equal(h.calls.filter(call => call.channel === 'save-settings').length, before);
  assert.equal(h.alerts.length, 0);
  for (const value of ['1.5', 'Infinity', '-1', '100']) {
    h.field('max_visible_tabs_1_99').props.onChange({ target: { value } }); h.render();
    assert.equal(h.field('max_visible_tabs_1_99').props.error, true);
  }
  h.field('max_visible_tabs_1_99').props.onChange({ target: { value: '20' } });
  h.field('sql_timeout_in_seconds_0_for_unlimited').props.onChange({ target: { value: '0' } }); h.render();
  assert.equal(h.field('max_visible_tabs_1_99').props.error, false);
  assert.equal(h.field('sql_timeout_in_seconds_0_for_unlimited').props.error, false);
});

for (const theme of ['mona', 'simple', 'dark']) test(`All settings controls persist through disk and app restart with ${theme} theme`, async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createSettingsStore } = require('../electron/services/settings');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-settings-ui-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'settings.json');
  const store = createSettingsStore({ app: { isReady: () => true, getLocale: () => 'en' }, SETTINGS_FILE: file, t: key => key, setLanguage() {} });
  store.save(initial);
  const reply = (channel, value) => {
    if (channel === 'load-settings') return store.load();
    if (channel === 'save-settings') { store.save(value); return { success: true }; }
    return { success: true, info: 'Demo' };
  };
  const h = fixture(reply); t.after(h.unmount); await h.settle(); await h.enter(); await h.open();
  const selected = { language: 'ja', timezone: '+05:30', theme, outputDateFormat: 'DD-MMM-YY HH:mm:ss',
    inputDateFormat: 'DD/MM/YYYY HH:mm:ss', numberFormat: 'space', aiSendKey: 'modifier-enter', queryTimeout: 3,
    maxTabs: 7, sqlHistoryLimit: 9, sqlHistoryEnabled: false, aiResponseMaxMb: 32,
    aiIdleTimeoutSeconds: 180, aiRequestTimeoutSeconds: 900, sqlFileMaxMb: 8, erFileMaxMb: 24,
    oracleClientPath: '/test-only/Oracle Client' };
  for (const [label, key] of [['language', 'language'], ['timezone', 'timezone'], ['app_theme_design', 'theme'],
    ['date_display_format', 'outputDateFormat'], ['date_input_format', 'inputDateFormat'], ['number_format', 'numberFormat'], ['ux_ai_send_key', 'aiSendKey']]) {
    h.dialogNodes().find(node => node.type === 'Select' && node.props.label === label).props.onChange({ target: { value: selected[key] } }); h.render();
  }
  for (const [label, key] of [['sql_timeout_in_seconds_0_for_unlimited', 'queryTimeout'], ['max_visible_tabs_1_99', 'maxTabs'],
    ['sql_history_save_limit_1_999', 'sqlHistoryLimit'], ['ai_response_max_mb', 'aiResponseMaxMb'], ['ai_idle_timeout_seconds', 'aiIdleTimeoutSeconds'],
    ['ai_request_timeout_seconds', 'aiRequestTimeoutSeconds'], ['sql_file_max_mb', 'sqlFileMaxMb'], ['er_file_max_mb', 'erFileMaxMb'],
    ['oracle_client_path_os_authentication_thick_mode', 'oracleClientPath']]) {
    h.field(label).props.onChange({ target: { value: String(selected[key]) } }); h.render();
  }
  h.dialogNodes().find(node => node.type === 'FormControlLabel' && node.props.label === 'sql_history_enabled').props.control.props.onChange({ target: { checked: false } }); h.render();
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick(); await h.settle();
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, value] of Object.entries(selected)) assert.equal(saved[key], value, key);
  assert.equal(saved.erNotation, initial.erNotation); assert.equal(h.get('Settings').props.isOpen, false);
  assert.equal(h.get('ThemeProvider').props.theme, theme); assert.equal(h.get('Workspace').props.settings.maxTabs, 7);
  assert.equal(h.get('Workspace').props.settings.outputDateFormat, selected.outputDateFormat); assert.deepEqual(h.languages, ['ja']);
  const restarted = fixture(reply); t.after(restarted.unmount); await restarted.settle(); await restarted.enter(); await restarted.open();
  for (const [key, value] of Object.entries(selected)) assert.equal(restarted.get('Settings').props[key], value, key);
});

for (const [label, min, max] of [
  ['sql_timeout_in_seconds_0_for_unlimited', 0, 50], ['max_visible_tabs_1_99', 1, 99], ['sql_history_save_limit_1_999', 1, 999],
  ['ai_response_max_mb', 1, 64], ['ai_idle_timeout_seconds', 1, 3600], ['ai_request_timeout_seconds', 1, 86400],
  ['sql_file_max_mb', 1, 64], ['er_file_max_mb', 1, 64]
]) test(`Settings dialog blocks empty and unsafe numeric input and accepts boundaries: ${label}`, async t => {
  const h = fixture(respond); t.after(h.unmount); await h.settle(); await h.enter(); await h.open();
  const invalid = ['', String(min - 1), '1.5', 'NaN', 'Infinity', ...(label === 'sql_timeout_in_seconds_0_for_unlimited' ? ['9007199254740992'] : [String(max + 1)])];
  for (const value of invalid) {
    h.field(label).props.onChange({ target: { value } }); h.render();
    h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick(); await h.settle();
    assert.equal(h.field(label).props.error, true); assert.equal(h.calls.some(call => call.channel === 'save-settings'), false);
  }
  for (const value of [min, max]) { h.field(label).props.onChange({ target: { value: String(value) } }); h.render(); assert.equal(h.field(label).props.error, false); }
});

test('Cancel discards edited settings and rejecting defaults leaves the draft and saved preferences intact', async t => {
  const h = fixture(respond, { confirm: () => false }); t.after(h.unmount); await h.settle(); await h.enter(); await h.open();
  h.field('sql_timeout_in_seconds_0_for_unlimited').props.onChange({ target: { value: '42' } }); h.render();
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('apply_default')).props.onClick(); h.render();
  assert.equal(h.field('sql_timeout_in_seconds_0_for_unlimited').props.value, 42);
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('cancel')).props.onClick(); h.render();
  assert.equal(h.get('Settings').props.isOpen, false); assert.equal(h.calls.some(call => call.channel === 'save-settings'), false);
  await h.open(); assert.equal(h.field('sql_timeout_in_seconds_0_for_unlimited').props.value, 0);
});

test('Applying defaults changes the complete draft only until Save succeeds', async t => {
  let stored = { ...initial, language: 'ja', theme: 'dark', timezone: '-07:00', maxTabs: 7, queryTimeout: 9, numberFormat: 'space',
    outputDateFormat: 'DD-MMM-YY HH:mm:ss', inputDateFormat: 'DD/MM/YYYY', sqlFileMaxMb: 8, erFileMaxMb: 24, aiSendKey: 'modifier-enter' };
  const h = fixture((channel, value) => {
    if (channel === 'load-settings') return stored;
    if (channel === 'save-settings') { stored = value; return { success: true }; }
    return { success: true, info: 'Demo' };
  }); t.after(h.unmount); await h.settle(); await h.enter(); await h.open();
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('apply_default')).props.onClick(); h.render();
  assert.equal(h.calls.some(call => call.channel === 'save-settings'), false); assert.equal(h.get('Settings').props.theme, 'dark');
  h.dialogNodes().find(node => node.type === 'Button' && node.children.includes('save')).props.onClick(); await h.settle();
  assert.deepEqual({ ...stored }, { ...initial, language: 'ja', outputDateFormat: 'YYYY/MM/DD HH:mm:ss', inputDateFormat: 'YYYY/MM/DD',
    theme: 'mona', timezone: '+09:00', numberFormat: 'comma', erNotation: 'ie', oracleClientPath: '' });
});

for (const mode of ['selected', 'cancelled', 'failure']) test(`Oracle client folder picker ${mode} preserves the correct draft without loading a library`, async t => {
  const h = fixture(channel => {
    if (channel === 'show-open-folder-dialog') {
      if (mode === 'failure') throw new Error('Simulated folder selection error');
      return mode === 'selected' ? { filePaths: ['/fixture/Oracle Client'] } : { canceled: true, filePaths: [] };
    }
    return respond(channel);
  }); t.after(h.unmount); await h.settle(); await h.enter(); await h.open();
  await h.dialogNodes().find(node => node.type === 'IconButton').props.onClick(); h.render();
  assert.equal(h.field('oracle_client_path_os_authentication_thick_mode').props.value, mode === 'selected' ? '/fixture/Oracle Client' : initial.oracleClientPath);
  assert.equal(h.calls.some(call => call.channel === 'save-settings'), false);
});
