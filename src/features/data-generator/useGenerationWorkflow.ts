// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { confirmImportBatch } from '@/features/table/importData';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { generationIssues, validateGeneration } from '@/features/data-generator/generatorValidation';
import { validateGeneratorRuleValues, generatorValueSql } from '@/features/data-generator/generatorSql';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import type { ColumnRule } from '@/features/data-generator/generatorTypes';

export type GeneratedRow = Record<string, string | number | null>;
export type UniqueSets = Record<string, Set<string | number | null>>;
interface Options {
  database: 'oracle' | 'postgresql' | 'mysql'; schema: string; table: string; rules: ColumnRule[]; count: number | string;
  inputFormat: string; isBusy: () => boolean; beginLoading: () => void; endLoading: () => void;
  onStart: () => void;
  canExecute?: () => boolean;
  onState?: (state: import('@/shared/api/desktopContract').TransactionState) => void;
  adapter?: {
    batchSize: number;
    validateRule: (rule: ColumnRule, count: number) => void;
    validateValue: (rule: ColumnRule, value: unknown) => void;
    buildInsert: (rows: GeneratedRow[], rules: ColumnRule[]) => { sql: string; binds: Record<string, unknown> };
  };
  generateRow: (rules: ColumnRule[], index: number, unique: UniqueSets) => GeneratedRow;
}
interface Preview { key: string; rows: GeneratedRow[]; unique: UniqueSets }
export interface GenerationResult { status: 'success' | 'stopped' | 'error'; confirmed: number; total: number; error?: string }

// A preview owns its random values and uniqueness sets until it is consumed once.
export function useGenerationWorkflow(options: Options) {
  const { t } = useTranslation();
  const { database, schema, table, rules, count, inputFormat } = options;
  const key = JSON.stringify([database, schema, table, rules, count, inputFormat]);
  const mounted = useRef(true), running = useRef<{ stop: boolean } | null>(null), cached = useRef<Preview | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null), [previewOpen, setPreviewOpen] = useState(false);
  const [progress, setProgress] = useState({ confirmed: 0, total: 0, running: false, stopping: false });
  const [result, setResult] = useState<GenerationResult | null>(null);
  const validateRule = (rule: ColumnRule, amount: number) => {
    if (database === 'mysql') { if (!options.adapter) throw new Error('MySQL generation adapter unavailable.'); options.adapter.validateRule(rule, amount); }
    else validateGeneratorRuleValues(rule, amount, database, inputFormat);
  };
  const issues = generationIssues(rules, count, t, validateRule);
  useEffect(() => {
    mounted.current = true;
    const run = running;
    return () => { mounted.current = false; if (run.current) run.current.stop = true; };
  }, []);
  const prepare = () => {
    const amount = validateGeneration(rules, count, t, (rule, size) => validateRule(rule, size));
    if (!schema || !table || !rules.some(rule => !['DISABLED', 'UNSPECIFIED'].includes(rule.ruleType))) throw new Error(t('no_insertable_columns_configured_please_set_a_value_for_at_least_one_column'));
    return amount;
  };
  const uniqueSets = () => Object.fromEntries(rules.filter(rule =>
    (rule.ruleType === 'RANDOM_CHAR' && rule.randCharUnique) || (rule.ruleType === 'RANDOM_NUM' && rule.randNumUnique) ||
    (rule.ruleType === 'RANDOM_DATE' && rule.randDateUnique)).map(rule => [rule.COLUMN_NAME, new Set<string | number | null>()]));
  const handlePreview = () => {
    if (options.isBusy() || running.current) return;
    try {
      const amount = prepare(), unique = uniqueSets(), active = rules.filter(rule => rule.ruleType !== 'DISABLED');
      const rows = Array.from({ length: Math.min(10, amount) }, (_, index) => options.generateRow(active, index, unique));
      // Validate generated values before showing them, without contacting the database.
      rows.forEach(row => active.forEach(rule => {
        if (Object.hasOwn(row, rule.COLUMN_NAME)) {
          if (database === 'mysql') options.adapter?.validateValue(rule, row[rule.COLUMN_NAME]);
          else generatorValueSql(rule, row[rule.COLUMN_NAME], database, inputFormat);
        }
      }));
      const next = { key, rows, unique }; cached.current = next; setPreview(next); setPreviewOpen(true);
    } catch (error: unknown) { if (mounted.current) alert(getErrorMessage(error)); }
  };
  const handleStop = () => {
    if (!running.current) return;
    running.current.stop = true;
    setProgress(old => ({ ...old, stopping: true }));
  };
  const handleGenerate = async () => {
    if (options.isBusy() || running.current || options.canExecute?.() === false) return;
    let amount: number;
    try { amount = prepare(); } catch (error: unknown) { alert(getErrorMessage(error)); return; }
    if (!window.confirm(t('generation_confirm_target', { schema, table, count: amount }))) return;
    const current = { stop: false }; running.current = current;
    const prior = cached.current?.key === key ? cached.current : null;
    cached.current = null; setPreview(null); setPreviewOpen(false);
    options.onStart(); options.beginLoading();
    setProgress({ confirmed: 0, total: amount, running: true, stopping: false }); setResult(null);
    let confirmed = 0;
    const active = rules.filter(rule => rule.ruleType !== 'DISABLED').map(rule => ({ ...rule }));
    const unique = prior?.unique || uniqueSets();
    const destination = qualifiedObjectName({ schema, objectName: table });
    try {
      const batchSize = database === 'mysql' ? options.adapter?.batchSize || 1 : 500;
      for (let offset = 0; offset < amount; offset += batchSize) {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (current.stop || !mounted.current) break;
        const size = Math.min(batchSize, amount - offset), batch: GeneratedRow[] = [];
        for (let index = offset; index < offset + size; index++) batch.push(prior?.rows[index] || options.generateRow(active, index, unique));
        let sql: string, binds: Record<string, unknown> | undefined;
        if (database === 'mysql') {
          if (!options.adapter) throw new Error('MySQL generation adapter unavailable.');
          const request = options.adapter.buildInsert(batch, active); sql = request.sql; binds = request.binds;
        } else if (database === 'oracle') {
          const lines = batch.map(row => {
            const included = active.filter(rule => Object.hasOwn(row, rule.COLUMN_NAME));
            if (!included.length) throw new Error(t('no_insertable_columns_configured_please_set_a_value_for_at_least_one_column'));
            return `INTO ${destination} (${included.map(rule => quoteIdentifier(rule.COLUMN_NAME)).join(', ')}) VALUES (${included.map(rule => generatorValueSql(rule, row[rule.COLUMN_NAME], database, inputFormat)).join(', ')})`;
          });
          sql = `INSERT ALL\n${lines.join('\n')}\nSELECT 1 FROM DUAL`;
        } else {
          const included = active.filter(rule => rule.ruleType !== 'UNSPECIFIED');
          const values = batch.map(row => `(${included.map(rule => Object.hasOwn(row, rule.COLUMN_NAME) ? generatorValueSql(rule, row[rule.COLUMN_NAME], database, inputFormat) : 'DEFAULT').join(', ')})`);
          sql = `INSERT INTO ${destination} (${included.map(rule => quoteIdentifier(rule.COLUMN_NAME)).join(', ')}) VALUES \n${values.join(',\n')}`;
        }
        let response;
        try { response = binds ? await ipcRenderer.invoke('execute-sql', sql, binds) : await ipcRenderer.invoke('execute-sql', sql); }
        catch (error) { options.onState?.({ transactionStatus: 'unknown' }); throw error; }
        options.onState?.(response);
        if (!response.success) throw new Error(t('bulk_insert_error') + response.error);
        const outcome = confirmImportBatch(response.rowsAffected, size); confirmed += outcome.confirmed;
        if (mounted.current) setProgress(old => ({ ...old, confirmed }));
        if (outcome.error) throw new Error(t(outcome.error, { expected: size, actual: response.rowsAffected }));
      }
      if (mounted.current) {
        const stopped = current.stop && confirmed < amount;
        setResult({ status: stopped ? 'stopped' : 'success', confirmed, total: amount });
        alert(stopped ? t('generation_stopped', { count: confirmed, total: amount }) : confirmed + t('data_generation_completed_commit_required'));
      }
    } catch (error: unknown) {
      if (mounted.current) {
        const message = getErrorMessage(error);
        setResult({ status: 'error', confirmed, total: amount, error: message });
        alert(t('data_generation_stopped_review_transaction', { confirmed, error: message }));
      }
    } finally {
      running.current = null; options.endLoading();
      if (mounted.current) setProgress(old => ({ ...old, running: false, stopping: false }));
    }
  };
  return { issues, progress, result, handleStop, handleGenerate, handlePreview, previewOpen, setPreviewOpen,
    previewRows: preview?.key === key ? preview.rows : [],
    previewColumns: rules.filter(rule => rule.ruleType !== 'DISABLED').map(rule => rule.COLUMN_NAME),
    progressMsg: progress.running ? t('generation_progress', progress) : '' };
}
