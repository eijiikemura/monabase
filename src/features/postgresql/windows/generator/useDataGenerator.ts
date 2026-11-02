// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useGenerationWorkflow } from '@/features/data-generator/useGenerationWorkflow';
import { postgresColumnMetadataSql } from '@/features/postgresql/columnTypes';
import { generatorColumnKind, validateGeneratorRuleValues, generatedTimeValue } from '@/features/data-generator/generatorSql';
import { mergeGenerationSettings, randomDecimalValue, sequenceValue } from '@/features/data-generator/generatorValidation';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { ColumnDefinition } from "@/shared/types/databaseTypes";
import type { AiContext } from '@/shared/types/aiTypes';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import { useTranslation } from 'react-i18next';
import RandExp from 'randexp';
import { formatDateString, DEFAULT_DATETIME_FORMAT } from "@/shared/utils/dateFormatter";
import { getFullTableDDL } from '../common/ddlHelper';
// Import shared helpers.
import { savePgSelectSchema, getPgSelectSchema } from '../common/schemaStorage';
import { ipcRenderer } from '@/shared/api/desktop';

import type { RuleType, ColumnRule, GeneratorForeignKey } from '@/features/data-generator/generatorTypes';
import { randomInt, randomString } from '@/features/data-generator/randomValues';
export type { RuleType, ColumnRule } from '@/features/data-generator/generatorTypes';

export const useDataGenerator = (
  isActive: boolean,
  initialSchemaProp?: string,
  dbName: string = '',
  userName: string = '',
  isAiEnabled: boolean = false,
  onOpenAiSidebar?: (context: AiContext | null) => void
) => {
  const { t, i18n } = useTranslation();
  // Keep loading active through schema and settings initialization.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(true);
  const initializationStarted = useRef(false);
  const initialLoadingReleased = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  
  const [selectedSchemaState, setSelectedSchemaState] = useState(''); 
  const [selectedTable, setSelectedTableState] = useState('');
  
  const [columnRules, setColumnRules] = useState<ColumnRule[]>([]);
  const [generateCount, setGenerateCountState] = useState<number | string>(1000);
  const settingsRevisionRef = useRef(0);
  const settingsRequestRef = useRef(0);

  const mountedRef = useRef(true);
  const generatorStateRef = useRef({
    schema: selectedSchemaState,
    table: selectedTable,
    rules: columnRules, count: generateCount
  });
  generatorStateRef.current = {
    schema: selectedSchemaState,
    table: selectedTable,
    rules: columnRules, count: generateCount
  };

  const setGenerateCount = useCallback((value: number | string) => {
    if (isBusy()) return;
    settingsRevisionRef.current++;
    setGenerateCountState(value);
  }, [isBusy]);

  useEffect(() => {
    mountedRef.current = true;
    const pendingSettings = settingsRequestRef;
    return () => { mountedRef.current = false; pendingSettings.current++; };
  }, []);

  const [inputDateFormat, setInputDateFormat] = useState(DEFAULT_DATETIME_FORMAT);

  const reportLoadError = useEventCallback((error: unknown) => {
    alert(t("failed_to_retrieve_information_2") + getErrorMessage(error));
  });

  useEffect(() => {
    if (!isActive || initializationStarted.current) return;
    initializationStarted.current = true;
    const fetchInitialData = async () => {
      beginLoading();
      try {
        const [settingsResult, schemasResult] =
          await Promise.allSettled([
            ipcRenderer.invoke('load-settings'),
            ipcRenderer.invoke<{ USERNAME: string }>('execute-sql-bg', `SELECT schema_name AS "USERNAME" FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name`
            )
          ]);

        // Use the default date format if settings cannot be loaded.
        if (settingsResult.status === 'fulfilled' &&
            settingsResult.value?.inputDateFormat) {
          setInputDateFormat(settingsResult.value.inputDateFormat);
        }
        if (schemasResult.status === 'rejected') throw schemasResult.reason;
        const resSchemas = schemasResult.value;
        if (!resSchemas.success) throw new Error(resSchemas.error);
        const fetchedSchemas: string[] = (resSchemas.rows || []).map((row: { USERNAME: string }) => row.USERNAME);
        setSchemas(fetchedSchemas);
        const savedSchema = getPgSelectSchema(dbName, userName);
        const targetSchema = savedSchema && fetchedSchemas.some(name => name.toLowerCase() === savedSchema.toLowerCase())
          ? savedSchema : initialSchemaProp || userName || '';
        setSelectedSchemaState(fetchedSchemas.find(name => name.toLowerCase() === targetSchema.toLowerCase()) || '');
      } catch (error: unknown) {
        reportLoadError(error);
      } finally {
        setIsInitialized(true);
        endLoading();
      }
    };
    void fetchInitialData();
  }, [isActive, initialSchemaProp, dbName, userName, beginLoading, endLoading, t, reportLoadError]);

  const setSelectedSchema = (newSchema: string) => {
    if (isBusy() || newSchema === selectedSchemaState) return;
    settingsRevisionRef.current++;
    setSelectedSchemaState(newSchema);
    setSelectedTableState('');
    setColumnRules([]);
    if (userName && newSchema) savePgSelectSchema(dbName, userName, newSchema);
  };

  const setSelectedTable = (newTable: string) => {
    if (isBusy() || newTable === selectedTable) return;
    settingsRevisionRef.current++;
    setSelectedTableState(newTable);
    setColumnRules([]);
  };

  useEffect(() => {
    if (!selectedSchemaState || !selectedTable) return;
    let isCancelled = false;
    const fetchColumns = async () => {
      beginLoading();
      try {
        const binds = { owner: selectedSchemaState, tableName: selectedTable };
        // Wait for both requests even if one fails.
        const results = await Promise.allSettled([
          ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', postgresColumnMetadataSql, { schema: selectedSchemaState, tableName: selectedTable }),
          ipcRenderer.invoke<{ COLUMN_NAME: string }>('execute-sql-bg', `SELECT kcu.column_name AS "COLUMN_NAME" FROM information_schema.table_constraints tco JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tco.constraint_name AND kcu.constraint_schema = tco.constraint_schema AND kcu.table_name = tco.table_name WHERE tco.constraint_type IN ('PRIMARY KEY', 'UNIQUE') AND tco.table_schema = :owner AND tco.table_name = :tableName`, binds)
        ]);
        if (isCancelled) return;
        const [columnResult, uniqueResult] = results;
        if (columnResult.status === 'rejected') throw columnResult.reason;
        if (uniqueResult.status === 'rejected') throw uniqueResult.reason;
        const colRes = columnResult.value;
        const uniqueRes = uniqueResult.value;
        if (!colRes.success) throw new Error(colRes.error);
        if (!uniqueRes.success) throw new Error(uniqueRes.error);
        if (colRes.rows) {
          const uniqueColumns: string[] = (uniqueRes.rows || []).map((row: { COLUMN_NAME: string }) => row.COLUMN_NAME);
          const rules: ColumnRule[] = colRes.rows.map((col: ColumnDefinition) => {
            const isNotNull = col.NULLABLE === 'N';
            const kind = generatorColumnKind(col, 'postgresql');
            const isUnique = uniqueColumns.includes(col.COLUMN_NAME);
            const isChar = kind === 'text';
            const isTime = kind === 'time';
            const isDate = kind === 'date' || kind === 'timestamp' || isTime;
            const isNum = kind === 'number';

            const isStandardType = isChar || isDate || isNum;
            const isDisabled = !isStandardType;

            let defaultRule: RuleType = 'UNSPECIFIED';
            let defaultRandCharType: ColumnRule['randCharType'] = 'ALPHA';
            let defaultRandCharUnique = false;
            let defaultRandDateUnique = false;

            if (isDisabled) {
              defaultRule = 'DISABLED';
            } else if (isUnique && isNum) {
              defaultRule = 'SEQ_NUM';
            } else if (isUnique && isChar) {
              defaultRule = 'RANDOM_CHAR';
              defaultRandCharType = 'ALPHANUM';
              defaultRandCharUnique = true;
            } else if (isUnique && isDate) {
              defaultRule = 'RANDOM_DATE';
              defaultRandDateUnique = true;
            } else if (isChar) {
              defaultRule = 'RANDOM_CHAR';
            } else if (isDate) {
              defaultRule = 'RANDOM_DATE';
            } else if (isNum) {
              defaultRule = 'RANDOM_NUM';
            } else {
              defaultRule = isNotNull ? 'FIXED' : 'UNSPECIFIED';
            }

            return {
              ...col,
              COLUMN_NAME: col.COLUMN_NAME,
              DATA_TYPE: col.DATA_TYPE,
              DATA_LENGTH: isChar ? Number(col.DATA_LENGTH || /\((\d+)\)/.exec(col.DATA_TYPE)?.[1] || 50) : 0,
              NULLABLE: col.NULLABLE || 'Y',
              ruleType: defaultRule,
              nullRatio: 0,
              seqStart: 1, seqStep: 1, seqPadZero: false, seqPrefix: '', seqStartDate: '2026/01/01',
              randNumMin: 0, randNumMax: 1000, randNumRound: 1, randNumUnique: false,
              randCharType: defaultRandCharType, randCharFill: false, randCharUnique: defaultRandCharUnique, randCharRegex: '',
              randDateMin: isTime ? '00:00:00' : '2020/01/01', randDateMax: isTime ? '23:59:59' : '2030/12/31', randDateIncludeTime: false, randDateUnique: defaultRandDateUnique,
              choiceValues: '', fixedValue: ''
            };
          });
          setColumnRules(rules);
        }
      } catch (error: unknown) {
        if (!isCancelled) reportLoadError(error);
      } finally {
        endLoading();
      }
    };
    void fetchColumns();
    return () => { isCancelled = true; };
  }, [selectedTable, selectedSchemaState, beginLoading, endLoading, t, reportLoadError]);

  // Release the initial loading guard after schema and settings initialization.
  useEffect(() => {
    if (!isInitialized || initialLoadingReleased.current) return;
    initialLoadingReleased.current = true;
    endLoading();
  }, [isInitialized, endLoading]);

  const handleRuleChange = useCallback(<K extends keyof ColumnRule>(
    index: number, field: K, value: ColumnRule[K]
  ) => {
    if (isBusy()) return;
    settingsRevisionRef.current++;
    setColumnRules(previousRules => {
      const currentRule = previousRules[index];
      if (!currentRule || Object.is(currentRule[field], value)) {
        return previousRules;
      }
      const newRules = [...previousRules];
      newRules[index] = { ...currentRule, [field]: value };
      return newRules;
    });
  }, [isBusy]);

  const handleExportSettings = async () => {
    if (isBusy()) return;
    if (!selectedTable || columnRules.length === 0) return;
    const data = {
      schema: selectedSchemaState,
      table: selectedTable,
      generateCount,
      rules: columnRules, count: generateCount
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const defaultPath = `DataGenerator_PG_${selectedSchemaState}_${selectedTable}.json`;
    
    try {
      const options = {
        title: t("save_data_generation_rules"),
        defaultPath: defaultPath,
        filters: [{ name: t("json_file"), extensions: ['json'] }]
      };
      const saveRes = await ipcRenderer.invoke('show-save-dialog', options);
      if (!saveRes.canceled && saveRes.filePath) {
        const res = await ipcRenderer.invoke('save-file', saveRes.filePath, jsonStr, 'utf8');
        if (res.success) alert(t("settings_saved"));
        else alert(t("failed_to_save") + res.error);
      }
    } catch (e: unknown) {
      alert(t("save_error_3") + getErrorMessage(e));
    }
  };

  const applyAiResponse = (answer: string) => {
    if (isBusy()) {
      throw new Error(t("cannot_apply_settings_while_retrieving_information_or_generating_data"));
    }

    const jsonText =
      answer.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? answer;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText.trim());
    } catch {
      throw new Error(t("could_not_parse_the_ai_response_as_json"));
    }

    const current = generatorStateRef.current;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        !('schema' in parsed) || !('table' in parsed) ||
        parsed.schema !== current.schema || parsed.table !== current.table) {
      throw new Error(t("the_ai_response_targets_a_different_table_from_the_current_selection"));
    }
    const next = mergeGenerationSettings(parsed, current.rules, current.count, t, false, (rule, count) => validateGeneratorRuleValues(rule, count, 'postgresql', inputDateFormat));
    settingsRevisionRef.current++;
    setColumnRules(next.rules);
    setGenerateCountState(next.generateCount);
    alert(t("applied_ai_generation_rules"));
  };

  const handleExportForAI = async () => {
    if (isBusy()) return;
    if (!selectedSchemaState || !selectedTable) return;
    beginLoading();
    
    try {
      let output = t("data_prompt_json_generation_request");
      output += t("1_target_table_information");
      output += t("schema_3") + `${selectedSchemaState}\n` + t("table_4") + `${selectedTable}\n\n`;

      const colStatSql = 'SELECT attname AS "COLUMN_NAME", n_distinct AS "NUM_DISTINCT", null_frac AS "NULL_FRAC", correlation AS "CORRELATION" FROM pg_stats WHERE schemaname = :owner AND tablename = :tableName ORDER BY attname';
      const fkSql = `
        SELECT child_col.attname AS "COLUMN_NAME", parent_ns.nspname AS "R_OWNER",
          parent.relname AS "R_TABLE_NAME", parent_col.attname AS "R_COLUMN_NAME"
        FROM pg_catalog.pg_constraint fk
        JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid
        JOIN pg_catalog.pg_namespace child_ns ON child_ns.oid = child.relnamespace
        JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid
        JOIN pg_catalog.pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
        CROSS JOIN LATERAL generate_subscripts(fk.conkey, 1) AS key_position(ordinal)
        JOIN pg_catalog.pg_attribute child_col ON child_col.attrelid = child.oid AND child_col.attnum = fk.conkey[key_position.ordinal]
        JOIN pg_catalog.pg_attribute parent_col ON parent_col.attrelid = parent.oid AND parent_col.attnum = fk.confkey[key_position.ordinal]
        WHERE fk.contype = 'f' AND child_ns.nspname = :owner AND child.relname = :tableName
        ORDER BY fk.oid, key_position.ordinal
      `;
      const metadataBinds = { owner: selectedSchemaState, tableName: selectedTable };
      const [ddlResult, statisticsResult, foreignKeysResult] =
        await Promise.allSettled([
          getFullTableDDL(ipcRenderer, selectedSchemaState, selectedTable, t),
          ipcRenderer.invoke<{ COLUMN_NAME: string; NUM_DISTINCT: number; NULL_FRAC: string; CORRELATION: string }>('execute-sql-bg', colStatSql, metadataBinds),
          ipcRenderer.invoke<GeneratorForeignKey>('execute-sql-bg', fkSql, metadataBinds)
        ]);
      if (ddlResult.status === 'rejected') throw ddlResult.reason;
      const combinedDDL = ddlResult.value;
      if (combinedDDL) {
          output += t("table_ddl_constraints_indexes_triggers_information") + combinedDDL + '\n';
      }

      try {
        if (statisticsResult.status === 'rejected') throw statisticsResult.reason;
        const colStatRes = statisticsResult.value;
        if (colStatRes && colStatRes.success && colStatRes.rows && colStatRes.rows.length > 0) {
          let statStr = '';
          colStatRes.rows.forEach((r: { COLUMN_NAME: string; NUM_DISTINCT: number; NULL_FRAC: string; CORRELATION: string }) => {
            statStr += `- ${r.COLUMN_NAME}: N_DISTINCT=${r.NUM_DISTINCT ?? '不明'}, NULL_FRAC=${r.NULL_FRAC ?? '不明'}, CORRELATION=${r.CORRELATION ?? '不明'}\n`;
          });
          if (statStr) {
            output += t("column_statistics_reference");
            output += t("data_prompt_empty_statistics");
            output += statStr;
          }
        }
      } catch { /* Auxiliary failures must not affect the main operation's result. */ }

      try {
        if (foreignKeysResult.status === 'rejected') throw foreignKeysResult.reason;
        const fkRes = foreignKeysResult.value;
        if (fkRes && fkRes.success && fkRes.rows && fkRes.rows.length > 0) {
          let sampleDataStr = '';
          
          for (const fk of fkRes.rows) {
            const colName = fk.COLUMN_NAME;
            const rOwner = fk.R_OWNER;
            const rTable = fk.R_TABLE_NAME;
            const rCol = fk.R_COLUMN_NAME;
            
            try {
              const sampleSql = `SELECT ${quoteIdentifier(rCol)} AS "VAL" FROM ${qualifiedObjectName({ schema: rOwner, objectName: rTable })} WHERE ${quoteIdentifier(rCol)} IS NOT NULL GROUP BY ${quoteIdentifier(rCol)} LIMIT 100`;
              const sampleRes = await ipcRenderer.invoke<{ VAL: unknown }>('execute-sql', sampleSql);
              if (sampleRes && sampleRes.success && sampleRes.rows) {
                const sampleVals = sampleRes.rows.map(r => String(r.VAL)).filter((v: string) => v);
                if (sampleVals.length > 0) {
                  sampleDataStr += `- ${colName} (参照先: ${rOwner}.${rTable}.${rCol}):\n`;
                  sampleDataStr += `  サンプル値: ${sampleVals.join(', ')}\n\n`;
                } else {
                  sampleDataStr += `- ${colName} (参照先: ${rOwner}.${rTable}.${rCol}):\n`;
                  sampleDataStr += `  サンプル値: なし (データが0件です)\n\n`;
                }
              }
            } catch (e) {
              console.warn(`Failed to fetch sample data for FK: ${colName}`, e);
            }
          }

          if (sampleDataStr) {
            output += t("foreign_key_reference_sample_data");
            output += t("data_prompt_reference_samples");
            output += t("data_prompt_missing_reference_samples");
            output += sampleDataStr;
          }
        }
      } catch { /* Auxiliary failures must not affect the main operation's result. */ }

      const sampleJson = {
        schema: selectedSchemaState,
        table: selectedTable,
        generateCount: generateCount,
        rules: columnRules.map(r => ({
          COLUMN_NAME: r.COLUMN_NAME,
          DATA_TYPE: r.DATA_TYPE,
          DATA_LENGTH: r.DATA_LENGTH,
          NULLABLE: r.NULLABLE,
          ruleType: r.ruleType,
          nullRatio: r.nullRatio,
          seqStart: r.seqStart, seqStep: r.seqStep, seqPadZero: r.seqPadZero, seqPrefix: r.seqPrefix, seqStartDate: r.seqStartDate,
          randNumMin: r.randNumMin, randNumMax: r.randNumMax, randNumRound: r.randNumRound, randNumUnique: r.randNumUnique,
          randCharType: r.randCharType, randCharFill: r.randCharFill, randCharUnique: r.randCharUnique, randCharRegex: r.randCharRegex,
          randDateMin: r.randDateMin, randDateMax: r.randDateMax, randDateIncludeTime: r.randDateIncludeTime, randDateUnique: r.randDateUnique,
          choiceValues: r.choiceValues, fixedValue: r.fixedValue
        }))
      };

      output += t("2_current_json_configuration_template");
      output += t("data_prompt_adjust_column_rules");
      output += JSON.stringify(sampleJson, null, 2) + `\n\n`;

      output += t("3_instructions");
      output += t("data_prompt_valid_rule_types");
      output += t("data_prompt_regex_rule_type");
      output += t("data_prompt_rounding_interval");
      output += t("data_prompt_numeric_range_and_nulls");
      output += t("data_prompt_preserve_schema");
      output += t("data_prompt_business_rules");
      output += t("data_prompt_rule_examples");
      output += t("data_prompt_regex_examples");
      output += t("data_prompt_foreign_key_choices");
      
      let charTypes = 'ALPHA, NUM, ALPHANUM, REGEX';
      if (i18n.language === 'ja') {
        charTypes += ', ZENKAKU';
      }
      output += t("randchartype_can_be_one_of_the_following") + charTypes + '\n';

      output += t("data_prompt_json_response_format");

      if (isAiEnabled && onOpenAiSidebar) {
        const requestSchema = selectedSchemaState;
        const requestTable = selectedTable;
        onOpenAiSidebar({
          targetTab: `${t("data_generator")} (${requestSchema}.${requestTable})`,
          requestType: "data_generator",
          requestId: crypto.randomUUID(),
          initialPrompt: output,
          onResponse: (answer) => {
            const current = generatorStateRef.current;
            if (!mountedRef.current ||
                current.schema !== requestSchema ||
                current.table !== requestTable) {
              throw new Error(t("ai_settings_target_changed"));
            }
            applyAiResponse(answer);
          }
        });
        return;
      }

      if (!isAiEnabled) {
        alert(t(
          "ai_external_data_export_notice"
        ));
      }

      const saveRes = await ipcRenderer.invoke('show-save-dialog', { 
        title: t("save_ai_request_prompt"),
        defaultPath: `Prompt_DataGen_PG_${selectedSchemaState}_${selectedTable}.txt`, 
        filters: [{ name: t("text_file"), extensions: ['txt'] }]
      });

      if (!saveRes.canceled && saveRes.filePath) {
        const writeRes = await ipcRenderer.invoke('save-file', saveRes.filePath, output, 'utf8');
        if (writeRes.success) alert(t("data_generation_prompt_exported"));
        else alert(t("save_error_3") + writeRes.error);
      }
    } catch (err: unknown) {
      alert(t("export_error_2") + getErrorMessage(err));
    } finally { 
      endLoading();
    }
  };

  const handleImportSettings = () => {
    if (isBusy()) return;
    const request = ++settingsRequestRef.current;
    const revision = settingsRevisionRef.current;
    const target = generatorStateRef.current;
    const isCurrent = () => mountedRef.current && request === settingsRequestRef.current &&
      revision === settingsRevisionRef.current && !isBusy() &&
      target.schema === generatorStateRef.current.schema && target.table === generatorStateRef.current.table;
    const reportStale = () => {
      if (mountedRef.current && request === settingsRequestRef.current) alert(t('generation_settings_outdated'));
    };
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!isCurrent()) { reportStale(); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        if (!isCurrent()) { reportStale(); return; }
        try {
          const payload: unknown = JSON.parse(String(ev.target?.result ?? ''));
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
              !('schema' in payload) || !('table' in payload) ||
              typeof payload.schema !== 'string' || typeof payload.table !== 'string') {
            throw new Error(t('invalid_settings_file_format'));
          }
          const differentTarget = payload.schema !== target.schema || payload.table !== target.table;
          if (differentTarget && !window.confirm(t("this_setting_file_is_for") + payload.schema + '.' + payload.table +
              t("setup_currently_selected") + target.schema + '.' + target.table +
              t("forcefully_only_matching_column_names_will_be_applied"))) return;
          const next = mergeGenerationSettings(payload, target.rules, target.count, t, differentTarget, (rule, count) => validateGeneratorRuleValues(rule, count, 'postgresql', inputDateFormat));
          if (!isCurrent()) { reportStale(); return; }
          settingsRevisionRef.current++;
          setColumnRules(next.rules);
          setGenerateCountState(next.generateCount);
          alert(t("settings_loaded"));
        } catch (error: unknown) { alert(t('file_parsing_failed') + ': ' + getErrorMessage(error)); }
      };
      reader.onerror = reader.onabort = () => {
        if (isCurrent()) alert(t('file_parsing_failed'));
        else reportStale();
      };
      try { reader.readAsText(file); }
      catch (error: unknown) { if (isCurrent()) alert(t('file_parsing_failed') + ': ' + getErrorMessage(error)); }
    };
    input.click();
  };

  const getActualFormat = (includeTime: boolean) => {
    let fmt = inputDateFormat;
    if (includeTime && !fmt.match(/H|h|m|s/i)) {
      fmt += ' HH:mm:ss';
    } else if (!includeTime && fmt.match(/H|h|m|s/i)) {
      fmt = fmt.split(' ')[0]; 
    }
    return fmt;
  };

  const generateDataRow = (rules: ColumnRule[], rowIndex: number, uniqueSets: Record<string, Set<string | number | null>>) => {
    const rowValues: Record<string, string | number | null> = Object.create(null);
    for (const rule of rules) {
      if (rule.ruleType === 'DISABLED' || rule.ruleType === 'UNSPECIFIED') {
        continue;
      }

      if (rule.NULLABLE !== 'N' && rule.nullRatio > 0) {
        if (Math.random() * 100 < rule.nullRatio) {
          rowValues[rule.COLUMN_NAME] = null;
          continue; 
        }
      }

      let val: string | number | null = null;

      if (rule.ruleType === 'SEQ_NUM') {
        val = sequenceValue(rule.seqStart, rule.seqStep, rowIndex);
        if (rule.seqPadZero && rule.DATA_LENGTH) {
          val = String(val).padStart(rule.DATA_LENGTH, '0');
        }
        if (rule.seqPrefix) val = rule.seqPrefix + val;
      } 
      else if (rule.ruleType === 'SEQ_DATE') {
        const d = new Date(rule.seqStartDate);
        d.setDate(d.getDate() + rowIndex);
        const targetFormat = getActualFormat(false);
        val = formatDateString(d, targetFormat);
      }
      else if (rule.ruleType === 'RANDOM_NUM') {
        const generateNumVal = () => randomDecimalValue(rule.randNumMin, rule.randNumMax, rule.randNumRound, Math.random());
        val = generateNumVal();

        if (rule.randNumUnique && uniqueSets[rule.COLUMN_NAME]) {
           let attempts = 0;
           while (uniqueSets[rule.COLUMN_NAME].has(val)) {
              val = generateNumVal();
              attempts++;
              if (attempts > 1000) {
                throw new Error(t("column_3") + rule.COLUMN_NAME + t("data_generation_unique_numbers_exhausted"));
              }
           }
           uniqueSets[rule.COLUMN_NAME].add(val);
        }
      }
      else if (rule.ruleType === 'RANDOM_CHAR') {
        let maxChars = rule.DATA_LENGTH || 50;
        if (rule.randCharType === 'ZENKAKU') {
          maxChars = Math.floor(maxChars / 3);
          if (maxChars < 1) maxChars = 1;
        }

        const len = rule.randCharFill ? Math.min(maxChars, 4000) : randomInt(1, Math.min(maxChars, 50));
        
        const generateRawCharVal = () => {
          if (rule.randCharType === 'REGEX' && rule.randCharRegex) {
            try {
              return new RandExp(rule.randCharRegex).gen();
            } catch {
              return randomString(len, 'ALPHA'); 
            }
          } else if (rule.randCharType !== 'REGEX') {
            return randomString(len, rule.randCharType);
          }
          return randomString(len, 'ALPHA');
        };

        // Validate the final value before adding it to the uniqueness set.
        const generateCharVal = () => {
          const candidate = generateRawCharVal();
          if (rule.randCharType === 'REGEX' && candidate.length > maxChars) {
            throw new Error(t('data_generation_regex_value_too_long', {
              column: rule.COLUMN_NAME, length: candidate.length, max: maxChars
            }));
          }
          return candidate.substring(0, maxChars);
        };

        val = generateCharVal();
        
        if (rule.randCharUnique && uniqueSets[rule.COLUMN_NAME]) {
           let attempts = 0;
           while (uniqueSets[rule.COLUMN_NAME].has(val)) {
              val = generateCharVal();
              attempts++;
              if (attempts > 1000) {
                throw new Error(t("column_3") + rule.COLUMN_NAME + t("data_generation_unique_strings_exhausted"));
              }
           }
           uniqueSets[rule.COLUMN_NAME].add(val);
        }
        
      }
      else if (rule.ruleType === 'RANDOM_DATE') {
        const generateDateVal = () => {
          if (generatorColumnKind(rule, 'postgresql') === 'time') return generatedTimeValue(rule, Math.random());
          const minTime = new Date(rule.randDateMin).getTime();
          const maxTime = new Date(rule.randDateMax).getTime();
          const randTime = minTime + Math.random() * (maxTime - minTime);
          const d = new Date(randTime);
          
          if (!rule.randDateIncludeTime) {
            d.setHours(0, 0, 0, 0);
          }
          const targetFormat = getActualFormat(rule.randDateIncludeTime);
          return formatDateString(d, targetFormat);
        };
        
        val = generateDateVal();
        
        if (rule.randDateUnique && uniqueSets[rule.COLUMN_NAME]) {
           let attempts = 0;
           while (uniqueSets[rule.COLUMN_NAME].has(val)) {
              val = generateDateVal();
              attempts++;
              if (attempts > 1000) {
                throw new Error(t("column_3") + rule.COLUMN_NAME + t("data_generation_unique_dates_exhausted"));
              }
           }
           uniqueSets[rule.COLUMN_NAME].add(val);
        }
      }
      else if (rule.ruleType === 'CHOICE') {
        const choices = rule.choiceValues.split(',').map(s => s.trim()).filter(s => s);
        if (choices.length > 0) {
          val = choices[Math.floor(Math.random() * choices.length)];
        }
      }
      else if (rule.ruleType === 'FIXED') {
        val = rule.fixedValue;
      }

      rowValues[rule.COLUMN_NAME] = val;
    }
    return rowValues;
  };

  const workflow = useGenerationWorkflow({ database: 'postgresql', schema: selectedSchemaState, table: selectedTable,
    rules: columnRules, count: generateCount, inputFormat: inputDateFormat, isBusy, beginLoading, endLoading,
    onStart: () => { settingsRevisionRef.current++; }, generateRow: generateDataRow });

  return {
    isLoading,
    ...workflow,
    schemas,
    selectedSchema: selectedSchemaState,
    setSelectedSchema,
    selectedTable,
    setSelectedTable,
    columnRules,
    generateCount,
    setGenerateCount,
    handleRuleChange,
    handleExportSettings,
    handleExportForAI,
    handleImportSettings
  };
};
