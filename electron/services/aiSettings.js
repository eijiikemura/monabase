// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { normalizeAiEndpoint } = require('./networkPolicy');
const fs = require('node:fs');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('./jsonFiles');

function keyScope(config) {
  return normalizeAiEndpoint(config.endpointUrl || config.ollamaEndpoint || 'https://api.openai.com/v1');
}

function createAiSettingsStore(file, vault) {
  function load() {
    if (!fs.existsSync(file)) return null;
    const record = readJsonFile(file, isJsonObject);
    const legacy = record.isEncrypted ? { apiKey: 'base64' } : {};
    const restored = vault.read(record, ['apiKey'], 'ai', legacy);
    if (Object.hasOwn(record, 'apiKey')) {
      const prepared = vault.prepareWrite(restored, ['apiKey'], 'ai', record, legacy);
      delete prepared.record.isEncrypted;
      atomicWriteJson(file, prepared.record);
      prepared.commit();
    }
    return restored;
  }

  function save(config) {
    const previous = fs.existsSync(file) ? readJsonFile(file, isJsonObject) : {};
    const prepared = vault.prepareWrite(config, ['apiKey'], 'ai', previous, previous.isEncrypted ? { apiKey: 'base64' } : {}, {
      consistentSave: true, canRetain: { apiKey: keyScope(previous) === keyScope(config) }
    });
    delete prepared.record.isEncrypted;
    atomicWriteJson(file, prepared.record);
    prepared.commit();
    return { credentialsPersisted: vault.isPersisted('ai') };
  }

  return { load, save };
}

module.exports = { createAiSettingsStore };
