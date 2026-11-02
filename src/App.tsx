// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { AiHistoryConnectionContext } from './features/ai/AiHistoryConnectionContext';
import NotificationHost from '@/components/feedback/NotificationHost';
import { notify } from '@/shared/utils/notifications';
import type { AppSettings, ConnectionConfig } from "./shared/types/appTypes";
import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { Alert, Box, Button, CircularProgress, CssBaseline, ThemeProvider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import LoginScreen from './components/LoginScreen';
import SettingsDialog from './components/SettingsDialog';
import ScreenErrorBoundary from './components/feedback/ScreenErrorBoundary';

import { DEFAULT_DATETIME_FORMAT, DEFAULT_DATE_FORMAT } from "./shared/utils/dateFormatter";
import { monaTheme, simpleTheme, darkTheme } from "./app/themes";
import { ipcRenderer } from './shared/api/desktop';

const AppOracle = lazy(() => import('./features/oracle/AppOracle'));
const AppPostgresql = lazy(() => import('./features/postgresql/AppPostgresql'));

export default function App() {
  const { t, i18n } = useTranslation();

  const [view, setView] = useState<'login' | 'main'>('login');

  const [config, setConfig] = useState<ConnectionConfig>({ dbType: 'oracle', user: '' });
  const [schemas, setSchemas] = useState<string[]>([]);
  const [dbInfo, setDbInfo] = useState<string>('');

  const [language, setLanguage] = useState<string>('en');
  const [maxTabs, setMaxTabs] = useState<number>(20);
  const [sqlHistoryEnabled, setSqlHistoryEnabled] = useState(true);
  const [sqlHistoryLimit, setSqlHistoryLimit] = useState<number>(100);
  const [outputDateFormat, setOutputDateFormat] = useState<string>(DEFAULT_DATETIME_FORMAT);
  const [inputDateFormat, setInputDateFormat] = useState<string>(DEFAULT_DATE_FORMAT);
  const [numberFormat, setNumberFormat] = useState<string>('comma');
  const [timezone, setTimezone] = useState<string>('+09:00');
  const [theme, setTheme] = useState<string>('mona');
  // A zero query timeout means unlimited execution time.
  const [queryTimeout, setQueryTimeout] = useState<number>(0);
  const [fileLimits, setFileLimits] = useState({ sqlFileMaxMb: 16, erFileMaxMb: 16 });
  const [aiLimits, setAiLimits] = useState({ aiResponseMaxMb: 16, aiIdleTimeoutSeconds: 120, aiRequestTimeoutSeconds: 600 });
  const [aiSendKey, setAiSendKey] = useState<AppSettings['aiSendKey']>('enter');
  const [erNotation, setErNotation] = useState('ie');
  const [oracleClientPath, setOracleClientPath] = useState('');

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const savingSettings = useRef(false);
  const settingsRequest = useRef(0);
  const connectionRevision = useRef(0);
  const disconnecting = useRef(false);
  const cancelConnectionInfo = useEventCallback(() => { connectionRevision.current++; });
  useEffect(() => cancelConnectionInfo, [cancelConnectionInfo]);

  // Prevent Ctrl+R / Cmd+R / F5 from reloading the app and disconnecting the database.
  useEffect(() => {
    const disableReload = (e: KeyboardEvent) => {
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', disableReload);
    return () => window.removeEventListener('keydown', disableReload);
  }, []);

  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  const loadSettings = useEventCallback(async () => {
    const request = ++settingsRequest.current;
    try {
      const savedSettings = await ipcRenderer.invoke('load-settings');
      if (request !== settingsRequest.current) return false;
      if (savedSettings.language) setLanguage(savedSettings.language);
      if (savedSettings.maxTabs) setMaxTabs(savedSettings.maxTabs);
      setSqlHistoryEnabled(savedSettings.sqlHistoryEnabled !== false);
      if (savedSettings.sqlHistoryLimit) setSqlHistoryLimit(savedSettings.sqlHistoryLimit);
      if (savedSettings.outputDateFormat) setOutputDateFormat(savedSettings.outputDateFormat);
      else if (savedSettings.dateFormat) setOutputDateFormat(savedSettings.dateFormat);

      if (savedSettings.inputDateFormat) setInputDateFormat(savedSettings.inputDateFormat);
      else if (savedSettings.dateFormat) setInputDateFormat(savedSettings.dateFormat);

      if (savedSettings.numberFormat) setNumberFormat(savedSettings.numberFormat);
      if (savedSettings.timezone) setTimezone(savedSettings.timezone);
      if (savedSettings.theme) setTheme(savedSettings.theme);
      if (savedSettings.queryTimeout !== undefined) setQueryTimeout(savedSettings.queryTimeout);
      setFileLimits({ sqlFileMaxMb: savedSettings.sqlFileMaxMb ?? 16, erFileMaxMb: savedSettings.erFileMaxMb ?? 16 });
      setAiLimits({ aiResponseMaxMb: savedSettings.aiResponseMaxMb ?? 16, aiIdleTimeoutSeconds: savedSettings.aiIdleTimeoutSeconds ?? 120, aiRequestTimeoutSeconds: savedSettings.aiRequestTimeoutSeconds ?? 600 });
      setAiSendKey(savedSettings.aiSendKey === 'modifier-enter' ? 'modifier-enter' : 'enter');
      setErNotation(savedSettings.erNotation || 'ie');
      setOracleClientPath(savedSettings.oracleClientPath || '');
      return true;
    } catch {
      if (request === settingsRequest.current) notify(t('failed_to_load_settings'));
      return false;
    }
  });
  const cancelSettingsLoad = useEventCallback(() => { settingsRequest.current++; });
  useEffect(() => {
    void loadSettings();
    return cancelSettingsLoad;
  }, [loadSettings, cancelSettingsLoad]);

  const handleOpenSettings = async () => {
    if (savingSettings.current) return;
    if (await loadSettings()) setIsSettingsOpen(true);
  };
  const handleCloseSettings = () => {
    if (!savingSettings.current) setIsSettingsOpen(false);
  };

  const handleLoginSuccess = async (loginConfig: ConnectionConfig, loadedSchemas: string[]) => {
    const revision = ++connectionRevision.current;
    setDbInfo('');
    setConfig(loginConfig);

    const schemasToSet = [...loadedSchemas];
    if (!schemasToSet.includes('public') && loginConfig.dbType === 'postgresql') {
      schemasToSet.push('public');
      schemasToSet.sort();
    } else if (!schemasToSet.includes('PUBLIC') && loginConfig.dbType === 'oracle') {
      schemasToSet.push('PUBLIC');
      schemasToSet.sort();
    }
    setSchemas(schemasToSet);
    setView('main');

    try {
      const infoRes = await ipcRenderer.invoke('get-db-info');
      if (revision !== connectionRevision.current) return;
      setDbInfo(infoRes?.success ? infoRes.info : t('failed_to_fetch_version_information'));
    } catch {
      if (revision === connectionRevision.current) setDbInfo(t('failed_to_fetch_version_information'));
    }
  };

  const handleDisconnect = async () => {
    if (disconnecting.current) return;
    if (window.confirm(t("confirm_disconnect_with_pending_changes"))) {
      disconnecting.current = true;
      connectionRevision.current++;
      try {
        if (await ipcRenderer.invoke('disconnect-db') !== true) throw new Error('Disconnect was not confirmed.');
      } catch {
        notify(t('disconnect_cleanup_failed_retry'));
      } finally {
        setView('login');
        setSchemas([]);
        setConfig({ dbType: 'oracle', user: '' });
        setDbInfo('');
        disconnecting.current = false;
      }
    }
  };

  const handleSaveSettings = async (newSettings: AppSettings) => {
    if (savingSettings.current) return;
    savingSettings.current = true;
    setIsSavingSettings(true);
    settingsRequest.current++;
    try {
      const res = await ipcRenderer.invoke('save-settings', newSettings);
      if (!res.success) {
        notify(t('save_settings_failed'));
        return;
      }
      setFileLimits({ sqlFileMaxMb: newSettings.sqlFileMaxMb ?? 16, erFileMaxMb: newSettings.erFileMaxMb ?? 16 });
      setAiLimits({ aiResponseMaxMb: newSettings.aiResponseMaxMb ?? 16, aiIdleTimeoutSeconds: newSettings.aiIdleTimeoutSeconds ?? 120, aiRequestTimeoutSeconds: newSettings.aiRequestTimeoutSeconds ?? 600 });
      setAiSendKey(newSettings.aiSendKey === 'modifier-enter' ? 'modifier-enter' : 'enter');
      setLanguage(newSettings.language);
      setMaxTabs(newSettings.maxTabs);
      setSqlHistoryLimit(newSettings.sqlHistoryLimit);
      setSqlHistoryEnabled(newSettings.sqlHistoryEnabled !== false);
      setOutputDateFormat(newSettings.outputDateFormat);
      setInputDateFormat(newSettings.inputDateFormat);
      setNumberFormat(newSettings.numberFormat);
      setTimezone(newSettings.timezone);
      setTheme(newSettings.theme);
      setQueryTimeout(newSettings.queryTimeout);
      setErNotation(newSettings.erNotation || 'ie');
      setOracleClientPath(newSettings.oracleClientPath || '');
      setIsSettingsOpen(false);
    } catch {
      notify(t('save_settings_failed'));
    } finally {
      savingSettings.current = false;
      setIsSavingSettings(false);
    }
  };

  const settings = { aiSendKey, language, maxTabs, sqlHistoryLimit, outputDateFormat, inputDateFormat, numberFormat, timezone, theme, queryTimeout };

  const activeTheme = theme === 'simple' ? simpleTheme : theme === 'dark' ? darkTheme : monaTheme;

  return (
    <ThemeProvider theme={activeTheme}>
      <CssBaseline />
      <NotificationHost />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', overflow: 'hidden' }}>

        {view === 'login' && <LoginScreen onLoginSuccess={handleLoginSuccess} />}

        {view === 'main' && (
          <AiHistoryConnectionContext.Provider value={config.aiHistoryScope}>
          <ScreenErrorBoundary
            key={config.dbType}
            fallback={
              <Box sx={{ m: 'auto', p: 3, maxWidth: 560 }}>
                <Alert severity="error">{t('workspace_load_failed_restart_and_reconnect')}</Alert>
                <Button onClick={handleDisconnect}>{t('disconnect_and_return_to_login')}</Button>
              </Box>
            }
          >
            <Suspense fallback={
              <Box role="status" sx={{ m: 'auto', display: 'flex', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={24} aria-hidden="true" />
                <Typography>{t('loading')}</Typography>
              </Box>
            }>
              {config.dbType === 'oracle' && (
                <AppOracle
                  config={config}
                  dbInfo={dbInfo}
                  schemas={schemas}
                  settings={settings}
                  onDisconnect={handleDisconnect}
                  onOpenSettings={handleOpenSettings}
                />
              )}

              {(config.dbType === 'postgres' || config.dbType === 'postgresql') && (
                <AppPostgresql
                  config={config}
                  dbInfo={dbInfo}
                  schemas={schemas}
                  settings={settings}
                  onDisconnect={handleDisconnect}
                  onOpenSettings={handleOpenSettings}
                />
              )}
            </Suspense>
          </ScreenErrorBoundary>
          </AiHistoryConnectionContext.Provider>
        )}

        <SettingsDialog
          {...aiLimits}
          {...fileLimits}
          isOpen={isSettingsOpen}
          onClose={handleCloseSettings}
          isSaving={isSavingSettings}
          language={language}
          maxTabs={maxTabs}
          sqlHistoryLimit={sqlHistoryLimit}
          sqlHistoryEnabled={sqlHistoryEnabled}
          outputDateFormat={outputDateFormat}
          inputDateFormat={inputDateFormat}
          numberFormat={numberFormat}
          timezone={timezone}
          theme={theme}
          aiSendKey={aiSendKey}
          queryTimeout={queryTimeout}
          erNotation={erNotation}
          oracleClientPath={oracleClientPath}
          onSave={handleSaveSettings}
        />
      </Box>
    </ThemeProvider>
  );
}
