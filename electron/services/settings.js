// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

const { FILE_LIMITS, normalizeFileLimits } = require('./boundedFiles');
const { AI_LIMITS, normalizeAiLimits } = require('../ai/requestLimits');
const fs = require('node:fs');
const { atomicWriteJson, readJsonFile, isJsonObject } = require('./jsonFiles');
const { 
  DEFAULT_DATETIME_FORMAT, 
  DEFAULT_DATE_FORMAT,
  DEFAULT_DATETIME_FORMAT_EN,
  DEFAULT_DATE_FORMAT_EN
} = require('../oracle/oracleFormatHelper');
const DEFAULT_SETTINGS_BASE = {
  ...normalizeAiLimits(),
  ...normalizeFileLimits(),
  maxTabs: 20,
  sqlHistoryLimit: 100,
  sqlHistoryEnabled: true,
  numberFormat: 'comma',
  timezone: '+09:00',
  theme: 'mona',
  erNotation: 'ie',
  aiSendKey: 'enter',
  queryTimeout: 0
};

let activeSettings = {};

function getCurrentSettings() { return { ...activeSettings }; }

function createSettingsStore({ app, SETTINGS_FILE, t, setLanguage }) {
  function getSystemTimezoneOffset() {
    const offsetMinutes = new Date().getTimezoneOffset();
    const absMinutes = Math.abs(offsetMinutes);
    const hours = Math.floor(absMinutes / 60).toString().padStart(2, '0');
    const minutes = (absMinutes % 60).toString().padStart(2, '0');
    const sign = offsetMinutes > 0 ? '-' : '+';
    return `${sign}${hours}:${minutes}`;
  }

  function getValidatedSettings() {
    let currentSettings = {};
    let needsSave = false;
    let readFailed = false;

    const systemLocale = app.isReady() ? app.getLocale() : Intl.DateTimeFormat().resolvedOptions().locale;
    const isJa = systemLocale && systemLocale.toLowerCase().startsWith('ja');

    const sysTimezone = getSystemTimezoneOffset();

    const dynamicDefaults = {
      ...DEFAULT_SETTINGS_BASE,
      language: isJa ? 'ja' : 'en',
      outputDateFormat: isJa ? DEFAULT_DATETIME_FORMAT : DEFAULT_DATETIME_FORMAT_EN,
      inputDateFormat: isJa ? DEFAULT_DATE_FORMAT : DEFAULT_DATE_FORMAT_EN,
      timezone: sysTimezone,
      oracleClientPath: ''
    };

    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        currentSettings = readJsonFile(SETTINGS_FILE, isJsonObject);
      } else {
        needsSave = true;
      }
    } catch (error) {
      console.error(t("failed_to_load_settings"), error);
      readFailed = true;
    }

    const finalSettings = { ...dynamicDefaults, ...currentSettings, ...normalizeAiLimits(currentSettings), ...normalizeFileLimits(currentSettings) };
    if (Object.keys(FILE_LIMITS).some(key => currentSettings[key] !== finalSettings[key])) needsSave = true;
    if (Object.keys(AI_LIMITS).some(key => currentSettings[key] !== finalSettings[key])) needsSave = true;

    if (typeof currentSettings.sqlHistoryEnabled !== 'boolean') {
      finalSettings.sqlHistoryEnabled = true;
      needsSave = true;
    }

    if (!['enter', 'modifier-enter'].includes(currentSettings.aiSendKey)) {
      finalSettings.aiSendKey = dynamicDefaults.aiSendKey;
      needsSave = true;
    }

    if (currentSettings?.queryTimeout === undefined) needsSave = true;

    if (!Number.isSafeInteger(finalSettings.maxTabs) || finalSettings.maxTabs < 1 || finalSettings.maxTabs > 99) {
      finalSettings.maxTabs = dynamicDefaults.maxTabs;
      needsSave = true;
    }

    if (!Number.isSafeInteger(finalSettings.sqlHistoryLimit) || finalSettings.sqlHistoryLimit < 1 || finalSettings.sqlHistoryLimit > 999) {
      finalSettings.sqlHistoryLimit = dynamicDefaults.sqlHistoryLimit;
      needsSave = true;
    }

    if (!Number.isSafeInteger(finalSettings.queryTimeout) || finalSettings.queryTimeout < 0) {
      finalSettings.queryTimeout = dynamicDefaults.queryTimeout;
      needsSave = true;
    }

    if (typeof finalSettings.outputDateFormat !== 'string' || finalSettings.outputDateFormat.trim() === '') {
       finalSettings.outputDateFormat = dynamicDefaults.outputDateFormat;
       needsSave = true;
    }

    if (typeof finalSettings.inputDateFormat !== 'string' || finalSettings.inputDateFormat.trim() === '') {
       finalSettings.inputDateFormat = dynamicDefaults.inputDateFormat;
       needsSave = true;
    }

    if (typeof finalSettings.language !== 'string' || !['ja', 'en'].includes(finalSettings.language)) {
      finalSettings.language = dynamicDefaults.language;
      needsSave = true;
    }

    if (typeof finalSettings.numberFormat !== 'string' || !['none', 'comma', 'period', 'space'].includes(finalSettings.numberFormat)) {
      finalSettings.numberFormat = dynamicDefaults.numberFormat;
      needsSave = true;
    }

    if (typeof finalSettings.theme !== 'string' || !['mona', 'simple', 'dark'].includes(finalSettings.theme)) {
      finalSettings.theme = dynamicDefaults.theme;
      needsSave = true;
    }

    if (!['ie', 'barker'].includes(finalSettings.erNotation)) {
      finalSettings.erNotation = dynamicDefaults.erNotation;
      needsSave = true;
    }

    // Accept fixed offsets supported by Oracle, including quarter-hour OS offsets.
    const offset = typeof finalSettings.timezone === 'string' && /^([+-])(\d{2}):(\d{2})$/.exec(finalSettings.timezone);
    const minutes = offset ? Number(offset[2]) * 60 + Number(offset[3]) : NaN;
    if (!offset || Number(offset[3]) > 59 || minutes > (offset[1] === '-' ? 12 : 14) * 60) {
      finalSettings.timezone = dynamicDefaults.timezone;
      needsSave = true;
    }

    if (typeof finalSettings.oracleClientPath !== 'string') {
      finalSettings.oracleClientPath = '';
      needsSave = true;
    }

    activeSettings = { ...finalSettings };
    setLanguage(finalSettings.language);

    if (needsSave && !readFailed) {
      try {
        atomicWriteJson(SETTINGS_FILE, finalSettings);
      } catch (error) {
        console.error(t("failed_to_autosave_settings"), error);
      }
    }

    return finalSettings;
  }


  return { load: getValidatedSettings, save: value => {
    if (fs.existsSync(SETTINGS_FILE)) {
      try { readJsonFile(SETTINGS_FILE, isJsonObject); }
      catch (error) {
        if (error.code !== 'INVALID_JSON_SETTINGS') throw error;
      }
    }
    atomicWriteJson(SETTINGS_FILE, value);
    return getValidatedSettings();
  } };
}

module.exports = { createSettingsStore, getCurrentSettings };
