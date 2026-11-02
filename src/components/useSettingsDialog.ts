// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { AiSendKey, AiResponseLimits, FileReadLimits } from '@/shared/types/appTypes';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '../shared/api/desktop';

export interface SettingsDialogProps extends Partial<AiResponseLimits>, Partial<FileReadLimits> {
  isOpen: boolean;
  aiSendKey?: AiSendKey;
  isSaving?: boolean;
  onClose: () => void;
  language: string;
  maxTabs: number;
  sqlHistoryLimit: number;
  sqlHistoryEnabled?: boolean;
  outputDateFormat: string;
  inputDateFormat: string;
  numberFormat: string;
  timezone: string;
  theme: string;
  erNotation?: string; 
  queryTimeout?: number;
  oracleClientPath?: string;
  onSave: (newSettings: AiResponseLimits & FileReadLimits & {
    aiSendKey: AiSendKey;
    language: string; 
    maxTabs: number; 
    sqlHistoryLimit: number;
    sqlHistoryEnabled: boolean;
    outputDateFormat: string; 
    inputDateFormat: string;
    numberFormat: string;
    timezone: string;
    theme: string;
    erNotation: string; 
    queryTimeout: number;
    oracleClientPath: string;
  }) => void | Promise<void>;
}

type NumericDraft = number | '';
type NumericField = 'maxTabs' | 'sqlHistoryLimit' | 'queryTimeout' | 'aiResponseMaxMb' | 'aiIdleTimeoutSeconds' | 'aiRequestTimeoutSeconds' | 'sqlFileMaxMb' | 'erFileMaxMb';

export const useSettingsDialog = (props: SettingsDialogProps) => {
  const { t } = useTranslation();
  
  const [tempSqlFileMaxMb, setTempSqlFileMaxMb] = useState<NumericDraft>(16);
  const [tempErFileMaxMb, setTempErFileMaxMb] = useState<NumericDraft>(16);
  const [tempAiSendKey, setTempAiSendKey] = useState<AiSendKey>('enter');
  const [tempAiResponseMaxMb, setTempAiResponseMaxMb] = useState<NumericDraft>(16);
  const [tempAiIdleTimeoutSeconds, setTempAiIdleTimeoutSeconds] = useState<NumericDraft>(120);
  const [tempAiRequestTimeoutSeconds, setTempAiRequestTimeoutSeconds] = useState<NumericDraft>(600);
  const [activeTab, setActiveTab] = useState<number>(0);
  const [tempLanguage, setTempLanguage] = useState<string>('ja');
  const [tempMaxTabs, setTempMaxTabs] = useState<NumericDraft>(20);
  const [tempSqlHistoryEnabled, setTempSqlHistoryEnabled] = useState(true);
  const [tempSqlHistoryLimit, setTempSqlHistoryLimit] = useState<NumericDraft>(100);
  const [tempOutputDateFormat, setTempOutputDateFormat] = useState<string>('');
  const [tempInputDateFormat, setTempInputDateFormat] = useState<string>('');
  const [tempNumberFormat, setTempNumberFormat] = useState<string>('none');
  const [tempTimezone, setTempTimezone] = useState<string>('+09:00');
  const [tempTheme, setTempTheme] = useState<string>('mona');
  const [tempErNotation, setTempErNotation] = useState<string>('ie');
  const [tempQueryTimeout, setTempQueryTimeout] = useState<NumericDraft>(0);
  const [tempOracleClientPath, setTempOracleClientPath] = useState<string>('');
  const wasOpen = useRef(false);

  useEffect(() => {
    const opening = props.isOpen && !wasOpen.current;
    wasOpen.current = props.isOpen;
    // Parent updates must not replace the draft during the current editing session.
    if (opening) {
      setTempSqlFileMaxMb(props.sqlFileMaxMb ?? 16);
      setTempErFileMaxMb(props.erFileMaxMb ?? 16);
      setTempAiSendKey(props.aiSendKey === 'modifier-enter' ? 'modifier-enter' : 'enter');
      setTempAiResponseMaxMb(props.aiResponseMaxMb ?? 16);
      setTempAiIdleTimeoutSeconds(props.aiIdleTimeoutSeconds ?? 120);
      setTempAiRequestTimeoutSeconds(props.aiRequestTimeoutSeconds ?? 600);
      setTempLanguage(props.language);
      setTempMaxTabs(props.maxTabs);
      setTempSqlHistoryLimit(props.sqlHistoryLimit);
      setTempSqlHistoryEnabled(props.sqlHistoryEnabled !== false);
      setTempOutputDateFormat(props.outputDateFormat);
      setTempInputDateFormat(props.inputDateFormat);
      setTempNumberFormat(props.numberFormat);
      setTempTimezone(props.timezone);
      setTempTheme(props.theme || 'mona');
      setTempErNotation(props.erNotation || 'ie'); 
      setTempQueryTimeout(props.queryTimeout ?? 0);
      setTempOracleClientPath(props.oracleClientPath || '');
      setActiveTab(0);
    }
  }, [props]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const handleSelectOracleFolder = async () => {
    try {
      const res = await ipcRenderer.invoke('show-open-folder-dialog', t("select_the_oracle_client_64_bit_instant_client_folder"));
      if (res && res.filePaths && res.filePaths.length > 0) {
        setTempOracleClientPath(res.filePaths[0]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const numericRefs = useRef<Partial<Record<NumericField, HTMLInputElement | null>>>({});
  const [focusRequest, setFocusRequest] = useState<{ field: NumericField } | null>(null);
  const rules: { field: NumericField; value: NumericDraft; tab: number; min: number; max?: number }[] = [
    { field: 'queryTimeout', value: tempQueryTimeout, tab: 0, min: 0 },
    { field: 'maxTabs', value: tempMaxTabs, tab: 0, min: 1, max: 99 },
    { field: 'sqlHistoryLimit', value: tempSqlHistoryLimit, tab: 0, min: 1, max: 999 },
    { field: 'aiResponseMaxMb', value: tempAiResponseMaxMb, tab: 3, min: 1, max: 64 },
    { field: 'aiIdleTimeoutSeconds', value: tempAiIdleTimeoutSeconds, tab: 3, min: 1, max: 3600 },
    { field: 'aiRequestTimeoutSeconds', value: tempAiRequestTimeoutSeconds, tab: 3, min: 1, max: 86400 },
    { field: 'sqlFileMaxMb', value: tempSqlFileMaxMb, tab: 4, min: 1, max: 64 },
    { field: 'erFileMaxMb', value: tempErFileMaxMb, tab: 4, min: 1, max: 64 }
  ];
  const errors: Partial<Record<NumericField, string>> = {};
  for (const rule of rules) {
    if (rule.value === '') errors[rule.field] = t('settings_number_required');
    else if (!Number.isSafeInteger(rule.value) || rule.value < rule.min || rule.max !== undefined && rule.value > rule.max) {
      errors[rule.field] = rule.max === undefined ? t('settings_integer_minimum', { min: rule.min })
        : t('settings_integer_range', { min: rule.min, max: rule.max });
    }
  }
  useEffect(() => {
    if (!focusRequest) return;
    const input = numericRefs.current[focusRequest.field];
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);
  const numericFieldProps = (field: NumericField, help?: string) => ({
    inputRef: (input: HTMLInputElement | null) => { numericRefs.current[field] = input; },
    error: Boolean(errors[field]), helperText: errors[field] || help
  });
  const parseNumericInput = (value: string): NumericDraft => value.trim() === '' ? '' : Number(value);
  const handleSaveClick = () => {
    if (props.isSaving) return;
    const invalid = rules.find(rule => errors[rule.field]);
    if (invalid) {
      setActiveTab(invalid.tab);
      setFocusRequest({ field: invalid.field });
      return;
    }
    props.onSave({
      sqlFileMaxMb: Number(tempSqlFileMaxMb),
      erFileMaxMb: Number(tempErFileMaxMb),
      aiResponseMaxMb: Number(tempAiResponseMaxMb),
      aiIdleTimeoutSeconds: Number(tempAiIdleTimeoutSeconds),
      aiRequestTimeoutSeconds: Number(tempAiRequestTimeoutSeconds),
      aiSendKey: tempAiSendKey,
      language: tempLanguage,
      maxTabs: Number(tempMaxTabs),
      sqlHistoryLimit: Number(tempSqlHistoryLimit),
      sqlHistoryEnabled: tempSqlHistoryEnabled,
      outputDateFormat: tempOutputDateFormat,
      inputDateFormat: tempInputDateFormat,
      numberFormat: tempNumberFormat,
      timezone: tempTimezone,
      theme: tempTheme,
      erNotation: tempErNotation,
      queryTimeout: Number(tempQueryTimeout),
      oracleClientPath: tempOracleClientPath.trim()
    });
  };

  const handleReset = () => {
    if (window.confirm(t("reset_all_settings_to_default"))) {
      const isJa = tempLanguage === 'ja';
      setTempLanguage(isJa ? 'ja' : 'en');
      setTempMaxTabs(20);
      setTempSqlHistoryLimit(100);
      setTempSqlHistoryEnabled(true);
      setTempOutputDateFormat(isJa ? 'YYYY/MM/DD HH:mm:ss' : 'YYYY-MM-DD HH:mm:ss');
      setTempInputDateFormat(isJa ? 'YYYY/MM/DD' : 'YYYY-MM-DD');
      setTempNumberFormat('comma');
      setTempTimezone('+09:00');
      setTempTheme('mona');
      setTempAiSendKey('enter');
      setTempSqlFileMaxMb(16);
      setTempErFileMaxMb(16);
      setTempAiResponseMaxMb(16);
      setTempAiIdleTimeoutSeconds(120);
      setTempAiRequestTimeoutSeconds(600);
      setTempErNotation('ie'); 
      setTempQueryTimeout(0);
      setTempOracleClientPath('');
    }
  };

  return {
    t,
    activeTab,
    numericFieldProps, parseNumericInput,
    handleTabChange,
    tempSqlFileMaxMb, setTempSqlFileMaxMb,
    tempErFileMaxMb, setTempErFileMaxMb,
    tempAiResponseMaxMb, setTempAiResponseMaxMb,
    tempAiIdleTimeoutSeconds, setTempAiIdleTimeoutSeconds,
    tempAiRequestTimeoutSeconds, setTempAiRequestTimeoutSeconds,
    tempAiSendKey, setTempAiSendKey,
    tempLanguage, setTempLanguage,
    tempMaxTabs, setTempMaxTabs,
    tempSqlHistoryLimit, setTempSqlHistoryLimit,
    tempSqlHistoryEnabled, setTempSqlHistoryEnabled,
    tempOutputDateFormat, setTempOutputDateFormat,
    tempInputDateFormat, setTempInputDateFormat,
    tempNumberFormat, setTempNumberFormat,
    tempTimezone, setTempTimezone,
    tempTheme, setTempTheme,
    tempErNotation, setTempErNotation, 
    tempQueryTimeout, setTempQueryTimeout,
    tempOracleClientPath, setTempOracleClientPath,
    handleSelectOracleFolder,
    handleSaveClick,
    handleReset
  };
};
