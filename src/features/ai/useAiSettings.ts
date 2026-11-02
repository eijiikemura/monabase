// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from "@/shared/api/desktop";

export function useAiSettings() {
  const { t } = useTranslation();
  const [aiSettingsDialogOpen, setDialogOpen] = useState<boolean>(false);
  
  // Provider popup visibility.
  const [providerPopupOpen, setProviderPopupOpen] = useState<boolean>(false);
  
  const [isAiEnabled, setIsAiEnabled] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [credentialUnavailable, setCredentialUnavailable] = useState(false);
  
  // Initialize model and endpoint fields as empty.
  const [modelName, setModelName] = useState<string>('');
  const [endpointUrl, setEndpointUrl] = useState<string>('');
  
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);
  const requestVersion = useRef(0);
  const ready = useRef(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  const invalidateRequests = useCallback(() => {
    ready.current = false;
    requestVersion.current++;
  }, []);

  const loadSettings = useCallback(async () => {
    if (saving.current) return;
    const version = ++requestVersion.current;
    ready.current = false;
    setHasLoaded(false);
    setIsLoading(true);
    setLoadError('');
    setProviderPopupOpen(false);
    try {
      const res = await ipcRenderer.invoke('get-ai-settings');
      if (!mounted.current || version !== requestVersion.current) return;
      if (res?.success) {
        setIsAiEnabled(res.isAiEnabled || false);
        setApiKey(res.apiKey || '');
        setCredentialUnavailable(Boolean(res.unavailableCredentials?.includes('apiKey')));
        setEndpointUrl(res.endpointUrl || res.ollamaEndpoint || '');
        setModelName(res.modelName || '');
        ready.current = true;
        setHasLoaded(true);
      } else {
        throw new Error(res?.error || 'Failed to load AI settings.');
      }
    } catch (error: unknown) {
      if (mounted.current && version === requestVersion.current) setLoadError(getErrorMessage(error));
    } finally {
      if (mounted.current && version === requestVersion.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadSettings();
    return () => {
      mounted.current = false;
      invalidateRequests();
    };
  }, [loadSettings, invalidateRequests]);

  const setAiSettingsDialogOpen = useCallback((open: boolean) => {
    if (saving.current) return;
    setDialogOpen(open);
    if (open) void loadSettings();
    else {
      invalidateRequests();
      setHasLoaded(false);
      setIsLoading(false);
      setProviderPopupOpen(false);
    }
  }, [loadSettings, invalidateRequests]);

  const handleSave = async () => {
    // Guard the operation itself as well as the disabled Save button.
    if (!mounted.current || !ready.current || saving.current) return;
    if (isAiEnabled) {
      if (!endpointUrl.trim()) {
        notify(t("enter_an_endpoint_url"));
        return;
      }
      if (!modelName.trim()) {
        notify(t("enter_a_model_name"));
        return;
      }
    }

    saving.current = true;
    const version = requestVersion.current;
    setIsProcessing(true);
    try {
      const res = await ipcRenderer.invoke('save-ai-settings', {
        isAiEnabled,
        provider: 'custom', // Fixed value for the shared API.
        apiKey: apiKey.trim(),
        modelName: modelName.trim(),
        endpointUrl: endpointUrl.trim(),
        ollamaEndpoint: endpointUrl.trim() // Backward compatibility.
      });

      if (!mounted.current || version !== requestVersion.current) return;
      if (res && res.success) {
        notify(t(res.credentialsPersisted === false ? 'credentials_session_only' : 'ai_settings_were_saved_securely'), { severity: res.credentialsPersisted === false ? 'warning' : 'success' });
        setDialogOpen(false);
      } else {
        notify(t("save_error_2", { error: res?.error || t("failed_to_save_2") }));
      }
    } catch (e: unknown) {
      if (mounted.current && version === requestVersion.current) notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      saving.current = false;
      if (mounted.current && version === requestVersion.current) setIsProcessing(false);
    }
  };

  return {
    t,
    aiSettingsDialogOpen, setAiSettingsDialogOpen,
    providerPopupOpen, setProviderPopupOpen,
    isAiEnabled, setIsAiEnabled,
    apiKey, setApiKey, credentialUnavailable,
    modelName, setModelName,
    endpointUrl, setEndpointUrl,
    isProcessing, isLoading, loadError,
    canEditSettings: hasLoaded && !isLoading && !isProcessing && !loadError,
    retryLoadSettings: loadSettings,
    handleSave
  };
}
