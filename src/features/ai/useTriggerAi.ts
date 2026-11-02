// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredAiProps } from '../stored/storedCreation';
import { useAiObjectSelection } from './useAiObjectSelection';
import { useAiCodingGeneration } from './useAiCodingGeneration';
import type { TriggerAiSettings } from './triggerBodyResponse';

interface Options extends StoredAiProps {
  dbType: 'oracle' | 'postgresql';
  schema: string;
  triggerName: string;
  targetName: string;
  targetType: 'TABLE' | 'VIEW';
  settings: string;
  body: string;
  setBody: (body: string) => void;
  applySettings: (settings: TriggerAiSettings) => void;
  isNew: boolean;
  isActive: boolean;
  isBusy: boolean;
  onStart: () => void;
}

export function useTriggerAi(options: Options) {
  const { t } = useTranslation();
  const selection = useAiObjectSelection({ dbType: options.dbType, initialSchema: options.schema });
  const initialTarget = useRef<string>();
  const generation = useAiCodingGeneration({
    dbType: options.dbType, schema: options.schema, objectName: options.triggerName,
    tableName: options.dbType === 'postgresql' ? options.targetName || undefined : undefined,
    objectType: 'TRIGGER', triggerSettings: options.settings,
    triggerTargetType: options.targetType,
    applyTriggerResponse: (body, settings) => { options.setBody(body); options.applySettings(settings); },
    sourceText: options.body, setSourceText: options.setBody,
    isNew: options.isNew, isActive: options.isActive, isBusy: options.isBusy,
    onStart: options.onStart
  });
  const latest = useRef({ options, isGenerating: generation.isGenerating });
  latest.current = { options, isGenerating: generation.isGenerating };
  const sidebarRequested = useRef(false);
  const syncInitialTarget = useCallback(() => {
    const current = latest.current.options;
    const key = current.schema && current.targetName
      ? JSON.stringify([current.dbType, current.schema, current.targetType, current.targetName])
      : undefined;
    if (initialTarget.current && initialTarget.current !== key) selection.removeObject(initialTarget.current);
    initialTarget.current = key;
    if (!key) return;
    selection.addObjects([{
      key, dbType: current.dbType, schema: current.schema, category: current.targetType,
      name: current.targetName, displayName: current.targetName
    }]);
  }, [selection]);
  useEffect(() => {
    if (sidebarRequested.current) syncInitialTarget();
  }, [options.schema, options.targetName, options.targetType, syncInitialTarget]);
  const validateBeforeSend = useCallback(() => {
    const current = latest.current.options;
    if (!current.schema || !current.targetName) {
      return t("select_the_trigger_schema_and_target_object_before_sending");
    }
    if (!current.triggerName.trim()) {
      return t("enter_a_trigger_name_before_sending");
    }
    syncInitialTarget();
    return undefined;
  }, [syncInitialTarget, t]);
  const requestAi = useCallback(() => {
    const { options, isGenerating } = latest.current;
    if (options.isBusy || isGenerating) return;
    if (!options.isAiEnabled || !options.onOpenAiSidebar) {
      alert(t("ai_configure_support_instructions"));
      return;
    }
    sidebarRequested.current = true;
    syncInitialTarget();
    options.onOpenAiSidebar({
      targetTab: `${options.triggerName || t("create_new")} (${options.schema} · TRIGGER)`,
      requestType: "coding_trigger", objectSelection: selection,
      referencePrompt: t("ai_trigger_body_instruction"),
      codingResponse: generation.responseTarget, validateBeforeSend
    });
  }, [generation.responseTarget, selection, syncInitialTarget, validateBeforeSend, t]);
  return { ...generation, requestAi };
}
