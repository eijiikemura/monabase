// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHookHarness } = require('./helpers/renderHook.cjs');
const { loadTypeScript } = require('./helpers/loadTypeScript.cjs');
const { translate } = require('../electron/i18n');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const saved = { success: true, isAiEnabled: true, apiKey: 'fictional-test-key', modelName: 'saved-model', endpointUrl: '/mock/endpoint' };
function fixture(language = 'en', saveResponse = async () => ({ success: true })) {
  const hook = createHookHarness(), loads = [], writes = [], alerts = [];
  let t = (key, values) => translate(key, language, values);
  const { useAiSettings } = loadTypeScript('src/features/ai/useAiSettings.ts', {
    react: hook.react, 'react-i18next': { useTranslation: () => ({ t }) },
    '@/shared/api/desktop': { ipcRenderer: { invoke: async (channel, payload) => {
      if (channel === 'get-ai-settings') { const load = deferred(); loads.push(load); return load.promise; }
      assert.equal(channel, 'save-ai-settings');
      writes.push(payload); return saveResponse();
    } } }
  }, { alert: message => alerts.push(message) });
  const render = () => hook.render(() => useAiSettings());
  const flush = async () => { render(); hook.commit(); await hook.settle(); return render(); };
  render(); hook.commit();
  return { hook, loads, writes, alerts, render, flush,
    changeLanguage(next) { t = (key, values) => translate(key, next, values); } };
}

for (const language of ['en', 'ja']) {
  for (const failure of ['response', 'missing', 'rejection']) {
    test(`${language}: ${failure} while loading prevents saving and retry restores editing`, async () => {
      const h = fixture(language);
      assert.equal(h.render().isLoading, true);
      assert.equal(h.render().canEditSettings, false);
      await h.render().handleSave();
      assert.equal(h.writes.length, 0);
      if (failure === 'rejection') h.loads[0].reject(Error('Temporary storage failure'));
      else h.loads[0].resolve(failure === 'missing' ? undefined : { success: false, error: 'Temporary storage failure' });
      await h.flush();
      assert.equal(h.render().isLoading, false);
      assert.ok(h.render().loadError);
      assert.equal(h.render().canEditSettings, false);
      await h.render().handleSave();
      assert.equal(h.writes.length, 0);
      const retry = h.render().retryLoadSettings();
      assert.equal(h.render().isLoading, true);
      h.loads[1].resolve(saved); await retry;
      assert.equal(h.render().loadError, '');
      assert.equal(h.render().canEditSettings, true);
      await h.render().handleSave();
      assert.equal(h.writes.length, 1);
      assert.equal(h.writes[0].modelName, saved.modelName);
      assert.equal(h.writes[0].apiKey, saved.apiKey);
      assert.deepEqual(h.alerts, [translate('ai_settings_were_saved_securely', language)]);
      h.hook.unmount();
    });
  }
}

for (const outcome of ['success', 'failure']) {
  test(`A late initial-load ${outcome} cannot replace a newer dialog response or draft`, async () => {
    const h = fixture();
    h.render().setAiSettingsDialogOpen(true);
    assert.equal(h.loads.length, 2);
    assert.equal(h.render().canEditSettings, false);
    h.loads[1].resolve(saved); await h.flush();
    h.render().setModelName('edited-model');
    h.render().setEndpointUrl('/mock/edited');
    if (outcome === 'success') h.loads[0].resolve({ ...saved, modelName: 'old-model' });
    else h.loads[0].reject(Error('Old request failed'));
    await h.flush();
    assert.equal(h.render().modelName, 'edited-model');
    assert.equal(h.render().endpointUrl, '/mock/edited');
    assert.equal(h.render().loadError, '');
    assert.equal(h.render().canEditSettings, true);
    h.hook.unmount();
  });
}

test('Closing and reopening discards the closed session response', async () => {
  const h = fixture(); h.loads[0].resolve(saved); await h.flush();
  h.render().setAiSettingsDialogOpen(true);
  h.render().setAiSettingsDialogOpen(false);
  h.render().setAiSettingsDialogOpen(true);
  h.loads[2].resolve({ ...saved, modelName: 'new-session' }); await h.flush();
  h.loads[1].resolve({ ...saved, modelName: 'closed-session' }); await h.flush();
  assert.equal(h.render().modelName, 'new-session');
  assert.equal(h.render().aiSettingsDialogOpen, true);
  h.hook.unmount();
});

test('A pending refresh blocks Save until the response has been applied', async () => {
  const h = fixture(); h.loads[0].resolve(saved); await h.flush();
  h.render().setAiSettingsDialogOpen(true);
  assert.equal(h.render().isLoading, true);
  assert.equal(h.render().canEditSettings, false);
  await h.render().handleSave(); assert.equal(h.writes.length, 0);
  h.loads[1].resolve({ ...saved, modelName: 'refreshed-model' }); await h.flush();
  await h.render().handleSave();
  assert.equal(h.writes[0].modelName, 'refreshed-model');
  h.hook.unmount();
});

test('Language changes preserve the draft without another settings request', async () => {
  const h = fixture(); h.loads[0].resolve(saved); await h.flush();
  h.render().setModelName('edited-model'); h.changeLanguage('ja'); await h.flush();
  assert.equal(h.loads.length, 1);
  assert.equal(h.render().modelName, 'edited-model');
  h.hook.unmount();
});

test('Saving excludes duplicate writes and reloads, and a failed save preserves the draft', async () => {
  const response = deferred();
  const h = fixture('en', () => response.promise); h.loads[0].resolve(saved); await h.flush();
  h.render().setAiSettingsDialogOpen(true); h.loads[1].resolve(saved); await h.flush();
  h.render().setModelName('edited-model');
  const pending = h.render().handleSave();
  await h.render().handleSave(); await h.render().retryLoadSettings();
  h.render().setAiSettingsDialogOpen(false);
  assert.equal(h.render().aiSettingsDialogOpen, true);
  assert.equal(h.render().canEditSettings, false);
  assert.equal(h.writes.length, 1);
  assert.equal(h.loads.length, 2);
  response.resolve({ success: false, error: 'Simulated save failure' }); await pending;
  assert.equal(h.render().modelName, 'edited-model');
  assert.equal(h.render().isProcessing, false);
  assert.equal(h.render().canEditSettings, true);
  h.hook.unmount();
});

test('A response after disposal is ignored and cannot enable saving', async () => {
  const h = fixture(); h.hook.unmount(); h.loads[0].resolve(saved); await h.flush();
  assert.equal(h.render().modelName, '');
  await h.render().handleSave();
  assert.equal(h.writes.length, 0);
});
