// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiContext } from '@/shared/types/aiTypes';
import type { AppSettings } from '@/shared/types/appTypes';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { ColumnRule } from '@/features/data-generator/generatorTypes';
import { useGenerationWorkflow } from '@/features/data-generator/useGenerationWorkflow';
import { createGeneratorRow } from '@/features/data-generator/generateRow';
import { mergeGenerationSettings } from '@/features/data-generator/generatorValidation';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { ipcRenderer } from '@/shared/api/desktop';
import { backgroundRows, loadTableMetadata } from '@/features/mysql/table/tableRepository';
import { mysqlTableName, quoteMysql } from '@/features/mysql/table/tableModel';
import { columnRules as defaults, generatorInsert, mysqlGeneratedValue, validateMysqlRule, type MysqlGeneratorColumn } from './generatorModel';

export interface GeneratorProps {
  active: boolean; initialSchema: string; schemas: string[]; settings: AppSettings; externalBusy: boolean; disabled: boolean; readonly: boolean;
  aiEnabled: boolean; tabId: number; onOpenAi: (context: AiContext) => void; onState: (state: TransactionState) => void; onBusyChange: (busy: boolean) => void;
}
export function useDataGenerator(props: GeneratorProps) {
  const { t } = useTranslation();
  const loading = useLoadingCounter();
  const { beginLoading, endLoading } = loading;
  const [selectedSchema, schemaState] = useState(props.initialSchema), [selectedTable, tableState] = useState('');
  const [columnRules, ruleState] = useState<ColumnRule[]>([]), [generateCount, countState] = useState<number | string>(1000), [error, setError] = useState('');
  const mounted = useRef(true), version = useRef(0), revision = useRef(0), importVersion = useRef(0);
  const isBusy = useEventCallback(() => loading.isBusy() || props.externalBusy || props.disabled);
  const current = useRef({ schema: selectedSchema, table: selectedTable, rules: columnRules, count: generateCount });
  current.current = { schema: selectedSchema, table: selectedTable, rules: columnRules, count: generateCount };
  const inputDateFormat = props.settings.inputDateFormat;
  useEffect(() => {
    const pending = version; mounted.current = true;
    return () => { mounted.current = false; pending.current++; };
  }, []);
  useEffect(() => {
    if (!selectedSchema || !selectedTable) return;
    const request = ++version.current;
    beginLoading(); setError('');
    void (async () => {
      try {
        const meta = await loadTableMetadata(selectedSchema, selectedTable);
        if (meta.table.ENGINE?.toLowerCase() !== 'innodb' || meta.table.TABLE_TYPE !== 'BASE TABLE') throw new Error(t('mysql_generator_innodb_required'));
        const columns = await backgroundRows<MysqlGeneratorColumn>(`SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,CHARACTER_MAXIMUM_LENGTH,NUMERIC_PRECISION,NUMERIC_SCALE,DATETIME_PRECISION,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(:schema AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(:table AS BINARY) ORDER BY ORDINAL_POSITION`, { schema: selectedSchema, table: selectedTable });
        if (!columns.length) throw new Error(t('mysql_table_metadata_retry'));
        const rules = defaults(columns, new Set(meta.indexes.filter(index => String(index.NON_UNIQUE) === '0').map(index => String(index.COLUMN_NAME))));
        const unsupported = rules.find((rule, index) => rule.ruleType === 'DISABLED' && rule.NULLABLE === 'N' && columns[index].COLUMN_DEFAULT === null && !/auto_increment|GENERATED/i.test(columns[index].EXTRA) && !columns[index].GENERATION_EXPRESSION);
        if (unsupported) throw new Error(t('mysql_generator_required_unsupported', { column: unsupported.COLUMN_NAME }));
        if (mounted.current && request === version.current) { revision.current++; ruleState(rules); }
      } catch (failure) { if (mounted.current && request === version.current) { ruleState([]); setError(getErrorMessage(failure)); } }
      finally { endLoading(); }
    })();
    const pending = version;
    return () => { pending.current++; };
  }, [selectedSchema, selectedTable, t, beginLoading, endLoading]);
  const setSelectedSchema = (schema: string) => { if (!isBusy() && schema !== selectedSchema) { revision.current++; schemaState(schema); tableState(''); ruleState([]); setError(''); } };
  const setSelectedTable = (table: string) => { if (!isBusy() && table !== selectedTable) { revision.current++; tableState(table); ruleState([]); setError(''); } };
  const setGenerateCount = (count: number | string) => { if (!isBusy()) { revision.current++; countState(count); } };
  const handleRuleChange = useCallback(<K extends keyof ColumnRule>(index: number, key: K, value: ColumnRule[K]) => {
    if (isBusy()) return;
    revision.current++; ruleState(previous => previous.map((rule, row) => row === index && rule.ruleType !== 'DISABLED' ? { ...rule, [key]: value } : rule));
  }, [isBusy]);
  const apply = (payload: unknown, matchingOnly = false) => {
    const state = current.current;
    const next = mergeGenerationSettings(payload, state.rules, state.count, t, matchingOnly, (rule, count) => validateMysqlRule(rule, count, inputDateFormat));
    revision.current++; ruleState(next.rules); countState(next.generateCount);
  };
  const handleExportSettings = async () => {
    if (isBusy() || !columnRules.length) return;
    const payload = JSON.stringify({ schema: selectedSchema, table: selectedTable, generateCount, rules: columnRules }, null, 2);
    try {
      const destination = await ipcRenderer.invoke('show-save-dialog', { title: t('save_data_generation_rules'), defaultPath: `DataGenerator_${selectedSchema}_${selectedTable}.json`, filters: [{ name: t('json_file'), extensions: ['json'] }] });
      if (!destination.canceled && destination.filePath) { const saved = await ipcRenderer.invoke('save-file', destination.filePath, payload, 'utf8'); if (!saved.success) throw new Error(saved.error); alert(t('settings_saved')); }
    } catch (failure) { alert(getErrorMessage(failure)); }
  };
  const handleImportSettings = () => {
    if (isBusy() || !columnRules.length) return;
    const target = current.current, before = revision.current, request = ++importVersion.current;
    const valid = () => mounted.current && request === importVersion.current && before === revision.current && !isBusy() && target.schema === current.current.schema && target.table === current.current.table;
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 1024 * 1024) { alert(t('mysql_generator_settings_too_large')); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          if (!valid()) throw new Error(t('generation_settings_outdated'));
          const payload: unknown = JSON.parse(String(reader.result));
          if (!payload || typeof payload !== 'object' || !('schema' in payload) || !('table' in payload) || typeof payload.schema !== 'string' || typeof payload.table !== 'string') throw new Error(t('invalid_settings_file_format'));
          const different = payload.schema !== target.schema || payload.table !== target.table;
          if (different && !window.confirm(t('this_setting_file_is_for') + payload.schema + '.' + payload.table + t('setup_currently_selected') + target.schema + '.' + target.table + t('forcefully_only_matching_column_names_will_be_applied'))) return;
          if (!valid()) throw new Error(t('generation_settings_outdated'));
          apply(payload, different);
        } catch (failure) { alert(getErrorMessage(failure)); }
      };
      reader.onerror = reader.onabort = () => { if (mounted.current) alert(t('file_parsing_failed')); };
      try { reader.readAsText(file); } catch (failure) { alert(getErrorMessage(failure)); }
    };
    input.click();
  };
  const handleExportForAI = async () => {
    if (isBusy() || !selectedTable || !columnRules.length) return;
    const target = current.current, before = revision.current;
    beginLoading();
    try {
      const metadata = await loadTableMetadata(target.schema, target.table);
      const ddl = await backgroundRows(`SHOW CREATE TABLE ${mysqlTableName(target.schema, target.table)}`, {});
      const definition = ddl[0]?.['Create Table']; if (typeof definition !== 'string') throw new Error(t('mysql_table_metadata_retry'));
      let output = t('data_prompt_json_generation_request') + '\nDatabase: MySQL 8.4. InnoDB. No Oracle or PostgreSQL syntax.\n' + t('1_target_table_information') + target.schema + '.' + target.table + '\n' + t('table_ddl_constraints_indexes_triggers_information') + definition + '\n';
      output += '\n[Constraints, indexes, triggers and estimated statistics]\n' + JSON.stringify({ table: metadata.table, indexes: metadata.indexes, checks: metadata.checks, triggers: metadata.triggers, foreignKeys: metadata.relations });
      const outgoing = metadata.relations.filter(fk => fk.TABLE_SCHEMA === target.schema && fk.TABLE_NAME === target.table);
      const groups = new Map<string, typeof outgoing>();
      outgoing.forEach(fk => { const key = fk.CONSTRAINT_NAME; groups.set(key, [...(groups.get(key) || []), fk]); });
      for (const [constraint, fks] of groups) {
        const ordered = [...fks].sort((a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION));
        const reference = ordered[0];
        const names = ordered.map(fk => quoteMysql(fk.REFERENCED_COLUMN_NAME)).join(', ');
        let response;
        try { response = await ipcRenderer.invoke('execute-sql', `SELECT DISTINCT ${names} FROM ${mysqlTableName(reference.REFERENCED_TABLE_SCHEMA, reference.REFERENCED_TABLE_NAME)} WHERE ${ordered.map(fk => quoteMysql(fk.REFERENCED_COLUMN_NAME) + ' IS NOT NULL').join(' AND ')} LIMIT 100`); }
        catch (failure) { props.onState({ transactionStatus: 'unknown' }); throw failure; }
        props.onState(response); if (!response.success) throw new Error(response.error);
        output += `\n[Existing reference tuples: ${constraint}]\n` + JSON.stringify(response.rows);
      }
      output += '\n' + t('data_prompt_reference_samples') + t('data_prompt_missing_reference_samples') + '\nComposite foreign keys must use one existing tuple with FIXED rules; independent CHOICE values cannot preserve tuple correlation. Parent samples can include pending rows from the same main transaction. Do not invent valid parent keys.\n';
      output += t('2_current_json_configuration_template') + JSON.stringify({ schema: target.schema, table: target.table, generateCount: target.count, rules: target.rules }, null, 2);
      for (const key of ['data_prompt_adjust_column_rules', 'data_prompt_valid_rule_types', 'data_prompt_regex_rule_type', 'data_prompt_rounding_interval', 'data_prompt_numeric_range_and_nulls', 'data_prompt_preserve_schema', 'data_prompt_business_rules', 'data_prompt_rule_examples', 'data_prompt_regex_examples', 'data_prompt_foreign_key_choices', 'data_prompt_json_response_format']) output += '\n' + t(key);
      output += '\nPreserve DISABLED generated/AUTO_INCREMENT/unsupported columns. Match MySQL integer unsigned bounds, DECIMAL precision/scale, text character length and temporal precision. Return JSON rules only, never SQL or executable expressions. No data is inserted automatically.\n';
      if (!mounted.current || before !== revision.current || target.schema !== current.current.schema || target.table !== current.current.table) throw new Error(t('ai_settings_target_changed'));
      if (props.aiEnabled) {
        props.onOpenAi({ targetTab: `${t('data_generator')} (${target.schema}.${target.table})`, targetTabId: props.tabId, requestId: crypto.randomUUID(), requestType: 'data_generator', initialPrompt: output,
          onResponse: answer => {
            if (!mounted.current || isBusy() || before !== revision.current || target.schema !== current.current.schema || target.table !== current.current.table) throw new Error(t('ai_settings_target_changed'));
            const payload: unknown = JSON.parse((answer.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] || answer).trim());
            if (!payload || typeof payload !== 'object' || !('schema' in payload) || !('table' in payload) || payload.schema !== target.schema || payload.table !== target.table) throw new Error(t('the_ai_response_targets_a_different_table_from_the_current_selection'));
            apply(payload); alert(t('applied_ai_generation_rules'));
          } });
      } else {
        alert(t('ai_external_data_export_notice'));
        const destination = await ipcRenderer.invoke('show-save-dialog', { title: t('save_ai_request_prompt'), defaultPath: `Prompt_DataGen_${target.schema}_${target.table}.txt`, filters: [{ name: t('text_file'), extensions: ['txt'] }] });
        if (!destination.canceled && destination.filePath) { const saved = await ipcRenderer.invoke('save-file', destination.filePath, output, 'utf8'); if (!saved.success) throw new Error(saved.error); alert(t('data_generation_prompt_exported')); }
      }
    } catch (failure) { if (mounted.current) alert(t('export_error_2') + getErrorMessage(failure)); }
    finally { endLoading(); }
  };
  const workflow = useGenerationWorkflow({ database: 'mysql', schema: selectedSchema, table: selectedTable, rules: columnRules, count: generateCount, inputFormat: inputDateFormat,
    isBusy, beginLoading: () => { beginLoading(); props.onBusyChange(true); }, endLoading: () => { endLoading(); props.onBusyChange(false); },
    onStart: () => { revision.current++; }, canExecute: () => !props.readonly && !props.disabled && !props.externalBusy, onState: props.onState,
    generateRow: createGeneratorRow(inputDateFormat, t, 1),
    adapter: { batchSize: Math.max(1, Math.min(500, Math.floor(1000 / Math.max(1, columnRules.filter(rule => !['DISABLED', 'UNSPECIFIED'].includes(rule.ruleType)).length)))),
      validateRule: (rule, count) => validateMysqlRule(rule, count, inputDateFormat), validateValue: (rule, value) => { mysqlGeneratedValue(rule, value, inputDateFormat); }, buildInsert: (rows, rules) => generatorInsert(selectedSchema, selectedTable, rows, rules, inputDateFormat) } });
  return { ...workflow, inputDateFormat, outputDateFormat: props.settings.outputDateFormat, isLoading: loading.isLoading || props.externalBusy || props.disabled, error,
    schemas: [...new Set([props.initialSchema, ...props.schemas.filter(schema => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(schema))])], selectedSchema, setSelectedSchema, selectedTable, setSelectedTable,
    columnRules, generateCount, setGenerateCount, handleRuleChange, handleExportSettings, handleImportSettings, handleExportForAI };
}
