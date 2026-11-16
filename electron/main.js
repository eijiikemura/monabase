// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const startupEntryTime = require('node:perf_hooks').performance.now();
const startup = require('./startupDiagnostics').createStartupDiagnostics({ started: startupEntryTime });
startup.mark('main:entry');
startup.mark('imports:i18n:begin');
const { t, setLanguage } = require('./i18n');
startup.mark('imports:i18n:end');
const { getStoragePaths, prepareStorage } = require('./services/storagePaths');
const { app, BrowserWindow, ipcMain: nativeIpcMain, shell, clipboard, safeStorage, dialog, Menu, powerMonitor } = require('electron');
startup.attach(app);
const path = require('path');
const appIconPath = path.join(__dirname, '../src/assets/icon.png');

const { startFocusDiagnostics } = require('./focusDiagnostics');

const { createSenderCheckedIpc, validateExternalUrl, restrictBrowserPermissions, createAppPagePolicy, restrictAppNavigation } = require('./ipc/security');
const pagePolicy = createAppPagePolicy({ packaged: app.isPackaged, entryFile: path.join(__dirname, '../dist/index.html') });
const ipcMain = createSenderCheckedIpc(nativeIpcMain, () => mainWindow, pagePolicy.isTrustedFrame);
const { createSshHostKeyVerifier } = require('./services/sshHostKeys');
const { createCredentialVault } = require('./services/credentials');
const { createConnectionStore } = require('./services/connections');
const { createAiSettingsStore } = require('./services/aiSettings');
const { createSettingsStore } = require('./services/settings');
startup.mark('imports:ipc:begin');
const { registerAiHandlers } = require('./ipc/ai');
startup.mark('imports:ai:complete');
const { registerGitHandlers } = require('./ipc/git');
startup.mark('imports:git:complete');
const { registerErHandlers } = require('./ipc/er');
const { registerFileHandlers } = require('./ipc/files');
startup.mark('imports:database:begin');
const { registerDatabaseHandlers } = require('./ipc/database');
startup.mark('imports:complete');

// Disable hardware acceleration.
// Avoid slow rendering in virtual environments and with some graphics drivers.
app.disableHardwareAcceleration();

const paths = startup.measure('storage:paths', () => getStoragePaths());
const { connectionsFile: CONNECTIONS_FILE, historyFile: HISTORY_FILE, aiSettingsFile: AI_CONFIG_FILE, settingsFile: SETTINGS_FILE, aiDirectory: AI_DIR } = paths;
const credentialVault = createCredentialVault(safeStorage);
const connectionStore = createConnectionStore(CONNECTIONS_FILE, credentialVault);
const aiSettingsStore = createAiSettingsStore(AI_CONFIG_FILE, credentialVault);
const loadAiSettings = aiSettingsStore.load;
aiSettingsStore.load = () => startup.measure('ai-settings:load-and-decrypt', loadAiSettings);
const settingsStore = createSettingsStore({ app, SETTINGS_FILE, t, setLanguage });
const AI_USAGE_DIR = path.join(AI_DIR, 'history');
const AI_SOURCE_DIR = path.join(AI_DIR, 'source');
const AI_DEBUG_DIR = path.join(AI_DIR, 'debug');

let mainWindow;
let focusDiagnostics;
const state = { client: null, type: null };
const createSshHostVerifier = createSshHostKeyVerifier({
  file: path.join(app.getPath('userData'), 'ssh-host-keys.json'), t,
  confirm: async ({ host, port, fingerprint }) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: t('ssh_host_key_confirmation'),
      message: t('ssh_host_key_first_connection', { host, port, fingerprint }),
      buttons: [t('cancel'), t('trust_and_connect')], defaultId: 0, cancelId: 0, noLink: true
    });
    return result.response === 1;
  },
  notify: async message => { await dialog.showMessageBox(mainWindow, {
    type: 'error', title: t('ssh_connection_error'), message, buttons: [t('ok')]
  }); }
});


startup.mark('whenReady:wait');
app.whenReady().then(() => {
  startup.mark('whenReady:complete');
  // Apply the app identity before settings or credential initialization can pause startup.
  if (process.platform === 'darwin') startup.measure('dock:icon', () => app.dock.setIcon(appIconPath));

  startup.measure('storage:prepare', () => prepareStorage(paths));
  startup.measure('settings:load', () => settingsStore.load());
  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
  }

  startup.mark('BrowserWindow:begin');
  // Electron shows this window implicitly (the default show option is true).
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "MonaBase",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  startup.mark('BrowserWindow:end');
  startup.mark(mainWindow.isVisible?.() ? 'window:visible-after-constructor' : 'window:not-visible-after-constructor');
  startup.mark('show:implicit-default:no-explicit-call');

  restrictBrowserPermissions(mainWindow.webContents.session);
  focusDiagnostics = startFocusDiagnostics({ app, window: mainWindow, powerMonitor });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const isWinDevTools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    const isMacDevTools = input.meta && input.alt && input.key.toLowerCase() === 'i';

    if (isWinDevTools || isMacDevTools) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('close', (event) => {
    const isConnected = !!state.client;

    const dialogOptions = {
      type: 'question',
      buttons: [t("yes"), t("no")],
      title: t("confirm_exit"),
      message: t("exit_monabase"),
      defaultId: 1,
      cancelId: 1
    };

    if (isConnected) {
      dialogOptions.detail = t("unsaved_changes_awaiting_commit_may_be_lost");
    }

    const choice = dialog.showMessageBoxSync(mainWindow, dialogOptions);

    if (choice === 1) {
      event.preventDefault();
    }
  });

  restrictAppNavigation(mainWindow.webContents, pagePolicy);
  startup.mark(app.isPackaged ? 'loadURL:file:begin' : 'loadURL:dev-server:begin');
  void mainWindow.loadURL(pagePolicy.entryUrl).then(() => {
    startup.mark('loadURL:complete');
  });
}).catch(error => {
  startup.mark('startup:failed');
  console.error('Application startup failed:', error.message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
ipcMain.handle('get-connections', () => {
  try { return startup.measure('connections:load-and-decrypt', () => connectionStore.load()); }
  catch { throw new Error(t('failed_to_load_connections')); }
});
ipcMain.handle('save-connection', (_event, config, originalName) => {
  try {
    return { success: true, ...connectionStore.save(config, originalName) };
  }
  catch (error) {
    return { success: false, error: t(error.code === 'CREDENTIAL_SAVE_FAILED' ? 'credentials_save_failed' : error.code === 'CREDENTIAL_CONTEXT_CHANGED' ? 'credentials_context_changed' : error.code === 'CONNECTION_NAME_CONFLICT' ? 'connection_name_already_exists' : 'failed_to_save_connection') };
  }
});
ipcMain.handle('delete-connection', (_event, name) => {
  try {
    connectionStore.remove(name);
    return { success: true };
  } catch {
    return { success: false, error: t('failed_to_delete_connection') };
  }
});
ipcMain.handle('save-connections-order', (_event, connections) => {
  try { connectionStore.reorder(connections); return { success: true }; }
  catch { return { success: false, error: t('failed_to_save_connection') }; }
});

ipcMain.handle('load-settings', () => {
  return startup.measure('settings:ipc-load', () => settingsStore.load());
});

ipcMain.handle('save-settings', (event, settingsData) => {
  try {
    settingsStore.save(settingsData);
    return { success: true };
  } catch (error) {
    console.error(t("failed_to_save_settings"), error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-focus-diagnostics', () => focusDiagnostics?.getHistory() || []);
ipcMain.handle('report-focus-state', (_event, report) => focusDiagnostics?.reportFocusState(report) || { recoveryAttempted: false });

ipcMain.handle('open-external', (_event, url) => shell.openExternal(validateExternalUrl(url)));

registerAiHandlers({ state, ipcMain, app, BrowserWindow, aiSettingsStore, AI_CONFIG_FILE, AI_DIR, AI_USAGE_DIR, AI_SOURCE_DIR, AI_DEBUG_DIR, t });
registerGitHandlers({ ipcMain, gitDirectory: paths.gitDirectory, t });
registerErHandlers({ getValidatedSettings: settingsStore.load, ipcMain, gitDirectory: paths.gitDirectory, t });
registerFileHandlers({ getValidatedSettings: settingsStore.load, ipcMain, clipboard, dialog, getWindow: () => mainWindow, HISTORY_FILE, t });
registerDatabaseHandlers({ getValidatedSettings: settingsStore.load, ipcMain, state, t, createSshHostVerifier });

startup.mark('main:handlers-registered');
