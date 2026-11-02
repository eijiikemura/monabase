// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createSettingsStore } = require('../../electron/services/settings');
const root = path.resolve(__dirname, '../..'), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monabase-settings-e2e-'));
app.disableHardwareAcceleration(); app.setPath('userData', path.join(temporary, 'profile'));
const settingsFile = path.join(temporary, 'settings.json');
const store = createSettingsStore({ app: { isReady: () => true, getLocale: () => 'en' }, SETTINGS_FILE: settingsFile, t: key => key, setLanguage() {} });
store.load();
ipcMain.handle('load-settings', () => store.load());
ipcMain.handle('save-settings', (_event, settings) => { store.save(settings); return { success: true }; });
const connection = { name: 'Settings UI fixture', dbType: 'oracle', host: 'fixture.invalid', port: 1521, database: 'DEMO', user: 'demo', password: '' };
for (const [channel, result] of Object.entries({
  'get-connections': [connection], 'save-connection': { success: true }, 'connect-db': { success: true, aiHistoryScope: 'a'.repeat(64) },
  'get-schemas': { success: true, schemas: ['DEMO'] }, 'get-db-info': { success: true, info: 'Settings fixture' },
  'get-ai-settings': { success: true, isAiEnabled: false }, 'git-status-check': { success: true, isRepo: false },
  'get-sql-history': [], 'get-app-version': '1.0.0', 'execute-sql-bg': { success: true, rows: [] }, 'get-objects': { success: true, objects: [] },
  'get-columns': { success: true, columns: [] }, 'get-focus-diagnostics': [], 'report-focus-state': {},
  'show-open-folder-dialog': { canceled: false, filePaths: ['/fixture/oracle-client'] }
})) ipcMain.handle(channel, () => result);
let win; const errors = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Settings UI checks timed out.'); app.exit(1); }, 90000);
const js = code => win.webContents.executeJavaScript(code, true);
async function wait(code) { for (let i = 0; i < 200; i++) { if (await js(code)) return; await pause(100); } throw new Error('Settings UI condition timed out: ' + code); }
async function click(selector, text) { await js(`(()=>{const e=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.getBoundingClientRect().width>0&&e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('Missing settings control');e.click();return true})()`); }
async function select(label, value) {
  await js(`(()=>{const label=Array.from(document.querySelectorAll('[role=dialog] label')).find(e=>e.textContent.trim()===${JSON.stringify(label)});const control=label.closest('.MuiFormControl-root').querySelector('[role=combobox]');control.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));return true})()`);
  const option = `[role=option][data-value=${JSON.stringify(String(value))}]`;
  await wait(`Boolean(document.querySelector(${JSON.stringify(option)}))`);
  await js(`document.querySelector(${JSON.stringify(option)}).click();true`);
  await wait("!document.querySelector('[role=listbox]')");
  await wait(`(()=>{const label=Array.from(document.querySelectorAll('[role=dialog] label')).find(e=>e.textContent.trim()===${JSON.stringify(label)});return label.closest('.MuiFormControl-root').querySelector('input').value===${JSON.stringify(String(value))}})()`);
}
async function input(label, value) {
  await js(`(()=>{const label=Array.from(document.querySelectorAll('[role=dialog] label')).find(e=>e.textContent.trim()===${JSON.stringify(label)});const input=document.getElementById(label.htmlFor);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(String(value))});input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
}
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1440, height: 1050, show: false, webPreferences: { preload: path.join(root, 'electron/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('preload-error', (_event, _file, error) => errors.push(error.message));
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (request, done) => done({ cancel: /^https?:/.test(request.url) }));
  await win.loadFile(path.join(root, 'dist/index.html'));
  for (const [theme, language, color] of [['dark', 'ja', 'rgb(18, 18, 18)'], ['simple', 'en', 'rgb(240, 242, 245)'], ['mona', 'ja', 'rgb(239, 235, 233)']]) {
    const before = store.load(), words = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${before.language}.json`), 'utf8'));
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(words.connect)})`);
    await click('button', words.connect); await wait("Boolean(document.querySelector('header'))");
    await click('header button', words.settings); await click('[role=menuitem]', words.settings_2); await wait("Boolean(document.querySelector('[role=dialog]'))");
    const original = fs.readFileSync(settingsFile);
    await input(words.max_visible_tabs_1_99, ''); await click('[role=dialog] button', words.save);
    assert.ok(fs.readFileSync(settingsFile).equals(original)); assert.equal(await js("Boolean(document.querySelector('[role=dialog] input[aria-invalid=true]'))"), true);
    const target = { ...before, theme, language, maxTabs: 7, queryTimeout: 3, sqlHistoryLimit: 9, sqlHistoryEnabled: false,
      timezone: '+05:30', outputDateFormat: 'DD-MMM-YY HH:mm:ss', inputDateFormat: 'DD/MM/YYYY HH:mm:ss', numberFormat: 'space',
      aiSendKey: 'modifier-enter', aiResponseMaxMb: 24, aiIdleTimeoutSeconds: 180, aiRequestTimeoutSeconds: 900, sqlFileMaxMb: 8, erFileMaxMb: 24, oracleClientPath: '/fixture/oracle-client' };
    for (const [key, value] of [['max_visible_tabs_1_99', 7], ['sql_timeout_in_seconds_0_for_unlimited', 3], ['sql_history_save_limit_1_999', 9]]) await input(words[key], value);
    await select(words.language, language); await select(words.timezone, '+05:30');
    await js(`(()=>{const label=Array.from(document.querySelectorAll('[role=dialog] .MuiFormControlLabel-root')).find(e=>e.textContent===${JSON.stringify(words.sql_history_enabled)});if(label.querySelector('input').checked)label.click();return true})()`);
    await click('[role=dialog] [role=tab]', words.view_4);
    for (const [key, value] of [['app_theme_design', theme], ['date_display_format', target.outputDateFormat], ['date_input_format', target.inputDateFormat], ['number_format', 'space']]) await select(words[key], value);
    await click('[role=dialog] [role=tab]', 'Oracle'); await js("document.querySelector('[role=dialog] [data-testid=FolderOpenIcon]').closest('button').click();true");
    await input(words.oracle_client_path_os_authentication_thick_mode, target.oracleClientPath);
    await click('[role=dialog] [role=tab]', words.ai_settings_tab); await select(words.ux_ai_send_key, 'modifier-enter');
    for (const [key, value] of [['ai_response_max_mb', 24], ['ai_idle_timeout_seconds', 180], ['ai_request_timeout_seconds', 900]]) await input(words[key], value);
    await click('[role=dialog] [role=tab]', words.files_settings_tab); await input(words.sql_file_max_mb, 8); await input(words.er_file_max_mb, 24);
    await click('[role=dialog] button', words.save);
    await wait("!document.querySelector('[role=dialog]')");
    assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')), target);
    await wait(`getComputedStyle(document.body).backgroundColor===${JSON.stringify(color)}`);
    await win.loadFile(path.join(root, 'dist/index.html')); await wait(`getComputedStyle(document.body).backgroundColor===${JSON.stringify(color)}`);
    const currentWords = JSON.parse(fs.readFileSync(path.join(root, `src/locales/${language}.json`), 'utf8'));
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(currentWords.connect)})`);
    console.log('Settings UI saved and renderer reloaded:', theme, language);
  }
  assert.deepEqual(errors, []);
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(timeout); win?.destroy(); fs.rmSync(temporary, { recursive: true, force: true }); app.quit();
});
