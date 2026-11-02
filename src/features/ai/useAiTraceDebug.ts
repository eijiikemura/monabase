// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StoredAiProps } from '../stored/storedCreation';
import { useAiObjectSelection } from './useAiObjectSelection';
import type { AiSourceIdentity } from '@/shared/types/aiTypes';

import { ipcRenderer } from "@/shared/api/desktop";

interface TraceDebugOptions extends StoredAiProps {
  dbType: 'oracle' | 'postgresql';
  schema: string;
  objectName: string;
  objectType: 'PROCEDURE' | 'FUNCTION' | 'PACKAGE BODY' | 'TRIGGER';
  traceObjectName?: string;
  signature?: string;
  tableName?: string;
  sourceText: string;
}

type TraceFileResult =
  | { success: true; content: string }
  | { success: false; requiresConfirmation: true; sizeBytes: number }
  | { success: false; requiresConfirmation?: false; error: string };

export function useAiTraceDebug(options: TraceDebugOptions) {
  const { t, i18n } = useTranslation();
  const latest = useRef(options);
  latest.current = options;
  const mounted = useRef(false);
  const pending = useRef(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const objectSelection = useAiObjectSelection({ dbType: options.dbType, initialSchema: options.schema });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const requestDebug = useCallback(async () => {
    if (pending.current) return;
    const context = latest.current;
    if (!context.isAiEnabled || !context.onOpenAiSidebar) {
      alert(t("ai_configure_support_instructions"));
      return;
    }
    const isCurrent = () => mounted.current &&
      latest.current.dbType === context.dbType &&
      latest.current.schema === context.schema &&
      latest.current.objectName === context.objectName &&
      latest.current.objectType === context.objectType &&
      latest.current.signature === context.signature && latest.current.tableName === context.tableName &&
      latest.current.traceObjectName === context.traceObjectName;

    pending.current = true;
    setIsPreparing(true);
    try {
      let approvedBytes = 1_000_000;
      let result: TraceFileResult;
      while (true) {
        result = await ipcRenderer.invoke('get-trace-for-ai', {
          dbType: context.dbType,
          schema: context.schema,
          objectType: context.objectType.startsWith('PACKAGE') ? 'PACKAGE' : context.objectType,
          objectName: context.objectName,
          signature: context.signature, tableName: context.tableName,
          approvedBytes
        });
        if (!isCurrent()) return;
        if (result.success === true) break;
        if (result.requiresConfirmation !== true) throw new Error(result.error);
        const size = (result.sizeBytes / 1_000_000).toFixed(2);
        if (!window.confirm(t(
          "the_trace_log_is_mb_send_this_information_to_ai_for_debugging",
          { size }
        ))) return;
        approvedBytes = result.sizeBytes;
      }

      const requestType = context.objectType === 'PROCEDURE'
        ? "debug_procedure"
        : context.objectType === 'FUNCTION'
          ? "debug_function"
          : context.objectType === 'TRIGGER' ? "debug_trigger" : "debug_package";
      const identity: AiSourceIdentity = { historyScope: 'debug', dbType: context.dbType,
        schema: context.schema, objectName: context.objectName, category: context.objectType,
        ...(context.signature !== undefined ? { signature: context.signature } : {}), ...(context.tableName !== undefined ? { tableName: context.tableName } : {}) };
      context.onOpenAiSidebar({
        targetTab: `${context.objectName} (${context.schema} · ${context.objectType})`,
        requestType,
        requestId: crypto.randomUUID(),
        objectSelection,
        historyTarget: { getHistoryIdentity: () => identity, subscribeHistoryIdentity: () => () => {} },
        referencePrompt: [
          t("this_is_a_request", { requestType: t(requestType) }),
          t("target_database", {
            dbType: context.dbType === 'oracle' ? 'Oracle' : 'PostgreSQL'
          }),
          t("target_3", {
            schema: context.schema, objectName: context.objectName
          }),
          t("analyze_the_full_trace_to_identify_the_cause_of_the_user_s_issue_respond_in", {
            language: i18n.resolvedLanguage || i18n.language
          }),
          'When traceInfo.source_kind is original, use traceInfo.executed_source as the source captured for this execution. Its source_sha256 identifies that exact snapshot. currentSource is an editable reference and may differ. Never use currentSource to prove executed behavior.',
          'line_mapping describes source line numbering. If source_kind is instrumented or the snapshot is missing, explicitly report that executed-source mapping is unverified; do not claim a precise source location without evidence. Do not omit trace steps or infer missing variable values.',
          'For generated_procedure_to_original, traceInfo.procedure_to_source maps raw trace line numbers to displayed executed_source body lines. This display mapping can associate generated statements with the nearest body line; it is not proof that every mapped step executed that exact original statement. Check source, step order and variable changes together; unmapped setup steps are not original source statements.',
          ...(context.objectType === 'TRIGGER' ? [t("trace_prompt_trigger_line_mapping")] : []),
          ...[
          "trace_prompt_evidence_requirements",
          "trace_prompt_facts_and_assumptions",
          "trace_prompt_untrusted_text",
          "trace_prompt_reference_source_caveat",
          "reference_data_structure",
          "trace_prompt_reference_structure",
          "traceinfo_execution_information",
          "trace_prompt_execution_timestamp",
          "trace_prompt_target_compile_timestamp",
          "trace_prompt_arguments_json",
          "trace_prompt_package_subprogram",
          "tracesteps_steps_in_execution_order",
          "trace_prompt_execution_order",
          "trace_prompt_source_line_numbers",
          "trace_prompt_repeated_line_numbers",
          "trace_prompt_variables_json",
          "trace_prompt_line_markers",
          "trace_prompt_loop_paths",
          "variable_recording_timing",
          "trace_prompt_step_snapshot_timing",
          "trace_prompt_assignment_visibility",
          "trace_prompt_variable_carryover",
          "trace_prompt_variable_names",
          "analysis_limitations",
          "trace_prompt_missing_values",
          "trace_prompt_incomplete_recording",
          "trace_prompt_no_step_timings",
          "analysis_workflow",
          "trace_prompt_analysis_workflow",
          "trace_prompt_response_structure",
          "the_following_json_contains_the_reference_information_for_analysis",
          ].map(text => t(text)),
          JSON.stringify({
            currentSource: context.sourceText,
            trace: JSON.parse(result.content) as unknown
          })
        ].join('\n')
      });
    } catch (error) {
      if (isCurrent()) {
        alert(t("failed_to_start_the_ai_debugging_request") + '\n' +
          (error instanceof Error ? error.message : String(error)));
      }
    } finally {
      pending.current = false;
      if (mounted.current) setIsPreparing(false);
    }
  }, [t, i18n, objectSelection]);

  return { isPreparing, requestDebug };
}
