// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { createInstance } = require('i18next');
const en = require('../src/locales/en.json');
const ja = require('../src/locales/ja.json');

// Keep main-process translation independent of the renderer's language state.
const i18n = createInstance();
i18n.init({
  resources: { en: { translation: en }, ja: { translation: ja } },
  lng: 'en',
  fallbackLng: 'en',
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false }
});

function translate(key, language = 'en', values = {}) {
  return i18n.t(key, { ...values, lng: language });
}

let currentLanguage = 'en';

function setLanguage(language) {
  currentLanguage = typeof language === 'string' && language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function getLanguage() { return currentLanguage; }

function t(key, values) { return translate(key, currentLanguage, values); }

module.exports = { translate, t, setLanguage, getLanguage };
