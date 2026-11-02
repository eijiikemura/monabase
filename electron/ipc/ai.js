// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { safeAiError, providerError } = require('../services/aiErrors');
const { createAiRequestBudget, readResponseText } = require('../ai/requestLimits');
const { getCurrentSettings } = require('../services/settings');
const { normalizeAiEndpoint } = require('../services/networkPolicy');
const fs = require('node:fs');
const { createUsageRecord, appendUsage, readUsage } = require('../ai/usageHistory');
const { saveSourceHistory, loadSourceHistory, deleteSourceHistories } = require('../ai/sourceHistory');
const { readChatCompletionResponse, unsupportedStreamingOption } = require('../ai/chatCompletionResponse');

function registerAiHandlers({ state, getValidatedSettings = getCurrentSettings, ipcMain, BrowserWindow, aiSettingsStore, AI_CONFIG_FILE, AI_DIR, AI_USAGE_DIR, AI_SOURCE_DIR, AI_DEBUG_DIR, t }) {

  ipcMain.handle('save-ai-settings', async (event, { isAiEnabled, provider, apiKey, modelName, endpointUrl, ollamaEndpoint }) => {
    try {
      const config = {
        isAiEnabled: isAiEnabled || false,
        provider: provider || 'openai',
        apiKey: apiKey || '',
        modelName: modelName || '',
        endpointUrl: normalizeAiEndpoint(endpointUrl || ollamaEndpoint || 'https://api.openai.com/v1')
      };

      const saved = aiSettingsStore.save(config);
      return { success: true, ...saved };
    } catch (error) {
      return { success: false, error: error.code === 'CREDENTIAL_SAVE_FAILED' ? t('credentials_save_failed') : error.code === 'CREDENTIAL_CONTEXT_CHANGED' ? t('credentials_context_changed') : error.message?.startsWith('security_ai_') ? t(error.message) : error.message };
    }
  });

  ipcMain.handle('get-ai-settings', async () => {
    try {
      if (!fs.existsSync(AI_CONFIG_FILE)) {
        return {
          success: true,
          isAiEnabled: false,
          provider: 'openai',
          apiKey: '',
          modelName: 'gpt-4o-mini',
          endpointUrl: 'https://api.openai.com/v1'
        };
      }

      const config = aiSettingsStore.load();

      return {
        success: true,
        isAiEnabled: config.isAiEnabled || false,
        provider: config.provider || 'openai',
        apiKey: config.apiKey,
        unavailableCredentials: config.unavailableCredentials,
        modelName: config.modelName || 'gpt-4o-mini',
        endpointUrl: config.endpointUrl || config.ollamaEndpoint || 'https://api.openai.com/v1',
        ollamaEndpoint: config.endpointUrl || config.ollamaEndpoint || 'https://api.openai.com/v1'
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  async function saveAiUsage(record) {
    try {
      await appendUsage(AI_USAGE_DIR, record, AI_DIR);
    } catch (error) {
      return error.message || 'AI利用履歴の保存に失敗しました。';
    }
    for (const window of BrowserWindow.getAllWindows()) {
      try {
        if (!window.isDestroyed()) {
          window.webContents.send(
            'ai-usage-history-updated',
            Number(record.requestedAt.slice(0, 4))
          );
        }
      } catch { /* No notification is needed for a closed window. */ }
    }
  }

  ipcMain.handle('get-ai-usage-history', async (_event, year) => {
    try {
      return { success: true, records: await readUsage(AI_USAGE_DIR, year, AI_DIR) };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  const scopedIdentity = identity => {
    if (!identity || !/^[a-f0-9]{64}$/.test(identity.connectionScope) ||
        state?.aiHistoryScopes?.get(identity.connectionScope) !== identity.dbType) {
      throw new Error(t('ai_history_connection_required'));
    }
    return identity;
  };

  ipcMain.handle('load-ai-source-history', async (_event, identity) => {
    try { return { success: true, conversation: await loadSourceHistory(AI_SOURCE_DIR, scopedIdentity(identity)) }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('save-ai-source-history', async (_event, identity, conversation) => {
    try {
      await saveSourceHistory(AI_SOURCE_DIR, scopedIdentity(identity), conversation);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('load-ai-debug-history', async (_event, identity) => {
    try { return { success: true, conversation: await loadSourceHistory(AI_DEBUG_DIR, scopedIdentity(identity)) }; }
    catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('save-ai-debug-history', async (_event, identity, conversation) => {
    try {
      await saveSourceHistory(AI_DEBUG_DIR, scopedIdentity(identity), conversation);
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  ipcMain.handle('delete-ai-object-history', async (_event, identity) => {
    try {
      await deleteSourceHistories([AI_SOURCE_DIR, AI_DEBUG_DIR], scopedIdentity(identity));
      return { success: true };
    } catch (error) { return { success: false, error: error.message }; }
  });

  const activeAiRequests = new Map();

  ipcMain.handle('cancel-ai', (event, requestId) => {
    if (typeof requestId !== 'string' || !requestId) {
      return { success: false, cancelled: false };
    }
    const controller = activeAiRequests.get(`${event.sender.id}:${requestId}`);
    if (controller) controller.abort();
    return { success: true, cancelled: Boolean(controller) };
  });

  ipcMain.handle('ask-ai', async (
    event, promptText, history = [], requestType = "unspecified", requestId, options = {}
  ) => {
    const controller = new AbortController();
    const requestKey = typeof requestId === 'string' && requestId
      ? `${event.sender.id}:${requestId}` : null;
    if (requestKey && activeAiRequests.has(requestKey)) {
      return { success: false, error: t("the_same_ai_request_is_already_running") };
    }
    if (requestKey) activeAiRequests.set(requestKey, controller);
    const onSenderDestroyed = () => controller.abort();
    event.sender.once('destroyed', onSenderDestroyed);
    let usageRecord = null;
    let budget;
    let requestApiKey = '';
    try {
      if (!fs.existsSync(AI_CONFIG_FILE)) {
        return { success: false, error: t("ai_settings_were_not_found_configure_them_in_settings") };
      }

      const config = aiSettingsStore.load();
      if (!config.isAiEnabled) {
        return { success: false, error: t('ai_support_is_disabled_enable_it_in_settings') };
      }
      budget = createAiRequestBudget(controller, getValidatedSettings());
      const decryptedKey = config.apiKey || '';
      requestApiKey = decryptedKey;

      const baseURL = normalizeAiEndpoint(config.endpointUrl || config.ollamaEndpoint || 'https://api.openai.com/v1');

      const modelName = config.modelName || 'gpt-4o-mini';
      const targetUrl = `${baseURL}/chat/completions`;

      const headers = {
        'Content-Type': 'application/json'
      };
      if (decryptedKey) {
        headers['Authorization'] = `Bearer ${decryptedKey}`;
      } else {
        headers['Authorization'] = 'Bearer ollama-local';
      }

      const safeHistory = Array.isArray(history) ? history : [];

      const payload = {
        model: modelName,
        messages: [
          ...safeHistory,
          { role: 'user', content: promptText }
        ]
      };

      usageRecord = createUsageRecord(requestType, modelName);
      // Code responses require normal completion, including buffered compatibility retries.
      const sourceResponse = requestType === "sql_generation" ||
        /^coding_(?:procedure|function|trigger|package)$/.test(requestType);
      let stream = sourceResponse && options?.stream === true;
      let includeUsage = stream;
      let data;
      while (true) {
        controller.signal.throwIfAborted();
        const res = await fetch(targetUrl, {
          method: 'POST', headers, redirect: 'error',
          body: JSON.stringify({ ...payload, ...(stream ? {
            stream: true,
            ...(includeUsage ? { stream_options: { include_usage: true } } : {})
          } : {}) }),
          signal: controller.signal
        });
        if (!res.ok) {
          const errBody = await readResponseText(res, { signal: controller.signal, budget });
          const unsupported = unsupportedStreamingOption(res.status, errBody);
          if (stream && unsupported === 'usage' && includeUsage) {
            includeUsage = false;
            continue;
          }
          if (stream && unsupported === 'stream') {
            stream = false; includeUsage = false;
            continue;
          }
          throw new Error(providerError(res.status, errBody, requestApiKey));
        }
        data = await readChatCompletionResponse(res, {
          signal: controller.signal, budget,
          requireComplete: sourceResponse,
          onText: stream ? (text) => {
            if (!controller.signal.aborted && !event.sender.isDestroyed()) {
              event.sender.send('ai-response-chunk', { requestId, text });
            }
          } : undefined
        });
        break;
      }
      budget.dispose();
      const answer = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || {};

      const promptTokens = usage.prompt_tokens || usage.promptTokens || usage.input_tokens || usage.inputTokens || 0;
      const completionTokens = usage.completion_tokens || usage.completionTokens || usage.output_tokens || usage.outputTokens || 0;

      usageRecord.modelName = typeof data.model === 'string' && data.model
        ? safeAiError(data.model, requestApiKey) : modelName;
      usageRecord.inputTokens = promptTokens;
      usageRecord.outputTokens = completionTokens;
      const historyError = await saveAiUsage(usageRecord);

      // Do not deliver a response if canceled while saving its history.
      if (controller.signal.aborted) {
        return { success: false, cancelled: true, historyError };
      }

      return {
        success: true,
        historyError,
        answer: answer,
        usage: {
          promptTokens: promptTokens,
          completionTokens: completionTokens
        }
      };

    } catch (error) {
      const limitError = controller.signal.reason?.message;
      const limited = ['ai_response_size_exceeded', 'ai_idle_timeout_exceeded', 'ai_request_timeout_exceeded'].includes(limitError);
      const cancelled = controller.signal.aborted && !limited;
      if (!cancelled) console.error('AI request failed.');
      const errorMsg = limited ? t(limitError) : (['security_ai_invalid_endpoint', 'security_ai_https_required', 'ai_response_incomplete'].includes(error.message) ? t(error.message) : safeAiError(error.message, requestApiKey)) || t("failed_to_receive_the_ai_response");
      const historyError = usageRecord
        ? await saveAiUsage(usageRecord) : undefined;
      return {
        success: false, cancelled, historyError,
        error: cancelled ? t("the_ai_request_was_canceled") : errorMsg
      };
    } finally {
      budget?.dispose();
      event.sender.removeListener('destroyed', onSenderDestroyed);
      if (requestKey && activeAiRequests.get(requestKey) === controller) {
        activeAiRequests.delete(requestKey);
      }
    }
  });
}

module.exports = { registerAiHandlers };
