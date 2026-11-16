// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useGenerationWorkflow } from '@/features/data-generator/useGenerationWorkflow';
import { generatorColumnKind, validateGeneratorRuleValues } from '@/features/data-generator/generatorSql';
import { mergeGenerationSettings } from '@/features/data-generator/generatorValidation';
import { qualifiedObjectName, quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import type { ColumnDefinition } from "@/shared/types/databaseTypes";
import type { AiContext } from '@/shared/types/aiTypes';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import { useTranslation } from 'react-i18next';
import { DEFAULT_DATETIME_FORMAT } from "@/shared/utils/dateFormatter";

import { getFullTableDDL } from '../common/ddlHelper';
import { ipcRenderer } from '@/shared/api/desktop';

import type { RuleType, ColumnRule, GeneratorForeignKey } from '@/features/data-generator/generatorTypes';
import { createGeneratorRow } from '@/features/data-generator/generateRow';
export type { RuleType, ColumnRule } from '@/features/data-generator/generatorTypes';

export const useDataGenerator = (
  isActive: boolean,
  isAiEnabled: boolean = false,
  onOpenAiSidebar?: (context: AiContext | null) => void
) => {
  // Use the i18n instance to determine the language.
  const { t, i18n } = useTranslation();
  // Keep loading active through schema and settings initialization.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(true);
  const initializationStarted = useRef(false);
  const initialLoadingReleased = useRef(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchemaState] = useState('');
  const [selectedTable, setSelectedTableState] = useState('');
  
  const [columnRules, setColumnRules] = useState<ColumnRule[]>([]);
  const [generateCount, setGenerateCountState] = useState<number | string>(1000);
  const settingsRevisionRef = useRef(0);
  const settingsRequestRef = useRef(0);

  const mountedRef = useRef(true);
  const generatorStateRef = useRef({
    schema: selectedSchema,
    table: selectedTable,
    rules: columnRules, count: generateCount
  });
  generatorStateRef.current = {
    schema: selectedSchema,
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
  const [outputDateFormat, setOutputDateFormat] = useState(DEFAULT_DATETIME_FORMAT);

  const reportLoadError = useEventCallback((error: unknown) => {
    alert(t("failed_to_retrieve_information_2") + getErrorMessage(error));
  });

  useEffect(() => {
    if (!isActive || initializationStarted.current) return;
    initializationStarted.current = true;
    const fetchInitialData = async () => {
      beginLoading();
      try {
        const fetchSchemas = async () => {
          let result = await ipcRenderer.invoke<{ USERNAME: string }>('execute-sql-bg', "SELECT USERNAME FROM ALL_USERS WHERE ORACLE_MAINTAINED = 'N' ORDER BY USERNAME"
          );
          if (!result.success) {
            result = await ipcRenderer.invoke<{ USERNAME: string }>('execute-sql-bg', 'SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME'
            );
          }
          if (!result.success) throw new Error(result.error);
          return result;
        };

        // Wait for all requests to complete.
        const [settingsResult, schemasResult, userResult] =
          await Promise.allSettled([
            ipcRenderer.invoke('load-settings'),
            fetchSchemas(),
            ipcRenderer.invoke<{ USER: string }>('execute-sql-bg', 'SELECT USER FROM DUAL')
          ]);

        if (settingsResult.status === 'fulfilled' && settingsResult.value?.outputDateFormat) {
          setOutputDateFormat(settingsResult.value.outputDateFormat);
        }
        // Use the default date format if settings cannot be loaded.
        if (settingsResult.status === 'fulfilled' &&
            settingsResult.value?.inputDateFormat) {
          setInputDateFormat(settingsResult.value.inputDateFormat);
        }
        if (schemasResult.status === 'rejected') throw schemasResult.reason;
        const resSchemas = schemasResult.value;
        const fetchedSchemas: string[] = (resSchemas.rows || []).map((row: { USERNAME: string }) => row.USERNAME);
        setSchemas(fetchedSchemas);
        if (fetchedSchemas.length > 0) {
          if (userResult.status === 'rejected') throw userResult.reason;
          const resUser = userResult.value;
          if (!resUser.success) throw new Error(resUser.error);
          const currentUser = resUser.rows?.[0]?.USER;
          setSelectedSchemaState(fetchedSchemas.includes(currentUser) ? currentUser : fetchedSchemas[0]);
        }
      } catch (error: unknown) {
        reportLoadError(error);
      } finally {
        setIsInitialized(true);
        endLoading();
      }
    };
    void fetchInitialData();
  }, [isActive, beginLoading, endLoading, t, reportLoadError]);

  const setSelectedSchema = (newSchema: string) => {
    if (isBusy() || newSchema === selectedSchema) return;
    settingsRevisionRef.current++;
    setSelectedSchemaState(newSchema);
    setSelectedTableState('');
    setColumnRules([]);
  };

  const setSelectedTable = (newTable: string) => {
    if (isBusy() || newTable === selectedTable) return;
    settingsRevisionRef.current++;
    setSelectedTableState(newTable);
    setColumnRules([]);
  };

  useEffect(() => {
    if (!selectedSchema || !selectedTable) return;
    let isCancelled = false;
    const fetchColumns = async () => {
      beginLoading();
      try {
        const binds = { owner: selectedSchema, tableName: selectedTable };
        // Wait for both requests even if one fails.
        const results = await Promise.allSettled([
          ipcRenderer.invoke<ColumnDefinition>('execute-sql-bg', `SELECT COLUMN_NAME, DATA_TYPE, DATA_LENGTH, NULLABLE FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tableName ORDER BY COLUMN_ID`, binds),
          ipcRenderer.invoke<{ COLUMN_NAME: string }>('execute-sql-bg', `SELECT cc.COLUMN_NAME FROM ALL_CONSTRAINTS c JOIN ALL_CONS_COLUMNS cc ON c.CONSTRAINT_NAME = cc.CONSTRAINT_NAME AND c.OWNER = cc.OWNER WHERE c.TABLE_NAME = :tableName AND c.CONSTRAINT_TYPE IN ('P', 'U') AND c.OWNER = :owner`, binds)
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
            const kind = generatorColumnKind(col, 'oracle');
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
              DATA_LENGTH: Number(col.DATA_LENGTH ?? 0),
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
  }, [selectedTable, selectedSchema, beginLoading, endLoading, t, reportLoadError]);

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
      schema: selectedSchema,
      table: selectedTable,
      generateCount,
      rules: columnRules, count: generateCount
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const defaultPath = `DataGenerator_${selectedSchema}_${selectedTable}.json`;
    
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
    const next = mergeGenerationSettings(parsed, current.rules, current.count, t, false, (rule, count) => validateGeneratorRuleValues(rule, count, 'oracle', inputDateFormat));
    settingsRevisionRef.current++;
    setColumnRules(next.rules);
    setGenerateCountState(next.generateCount);
    alert(t("applied_ai_generation_rules"));
  };

  const handleExportForAI = async () => {
    if (isBusy()) return;
    if (!selectedSchema || !selectedTable) return;
    beginLoading();
    
    try {
      let output = t("data_prompt_json_generation_request");
      output += t("1_target_table_information");
      output += t("schema_3") + `${selectedSchema}\n` + t("table_4") + `${selectedTable}\n\n`;

      const colStatSql = 'SELECT COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tableName ORDER BY COLUMN_ID';
      const fkSql = `
        SELECT acc.COLUMN_NAME, ac.R_OWNER, rc.TABLE_NAME AS R_TABLE_NAME, rcc.COLUMN_NAME AS R_COLUMN_NAME
        FROM ALL_CONSTRAINTS ac
        JOIN ALL_CONS_COLUMNS acc ON ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME AND ac.OWNER = acc.OWNER
        JOIN ALL_CONSTRAINTS rc ON ac.R_CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND ac.R_OWNER = rc.OWNER
        JOIN ALL_CONS_COLUMNS rcc ON rc.CONSTRAINT_NAME = rcc.CONSTRAINT_NAME AND rc.OWNER = rcc.OWNER AND acc.POSITION = rcc.POSITION
        WHERE ac.TABLE_NAME = :tableName AND ac.OWNER = :owner AND ac.CONSTRAINT_TYPE = 'R'
        ORDER BY ac.CONSTRAINT_NAME, acc.POSITION
      `;
      const metadataBinds = { owner: selectedSchema, tableName: selectedTable };
      const [ddlResult, statisticsResult, foreignKeysResult] =
        await Promise.allSettled([
          getFullTableDDL(ipcRenderer, selectedSchema, selectedTable, t),
          ipcRenderer.invoke<{ COLUMN_NAME: string; NUM_DISTINCT: number; NUM_NULLS: number; DENSITY: number }>('execute-sql-bg', colStatSql, metadataBinds),
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
          colStatRes.rows.forEach((r: { COLUMN_NAME: string; NUM_DISTINCT: number; NUM_NULLS: number; DENSITY: number }) => {
            statStr += `- ${r.COLUMN_NAME}: DISTINCT=${r.NUM_DISTINCT ?? '不明'}, NULLS=${r.NUM_NULLS ?? '不明'}, DENSITY=${r.DENSITY ?? '不明'}\n`;
          });
          if (statStr) {
            output += t("column_statistics_reference");
            output += t("data_prompt_missing_statistics");
            output += statStr;
          }
        }
      } catch (e) {
        console.warn('Failed to fetch column statistics for DataGen prompt', e);
      }

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
            const sampleSql = `SELECT * FROM (SELECT ${quoteIdentifier(rCol)} AS VAL FROM ${qualifiedObjectName({ schema: rOwner, objectName: rTable })} WHERE ${quoteIdentifier(rCol)} IS NOT NULL GROUP BY ${quoteIdentifier(rCol)}) WHERE ROWNUM <= 100`;
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

      const sampleJson = {
        schema: selectedSchema,
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
      
      // Include the random character format in AI instructions, selected by language.
      let charTypes = 'ALPHA, NUM, ALPHANUM, REGEX';
      if (i18n.language === 'ja') {
        charTypes += ', ZENKAKU';
      }
      output += t("randchartype_can_be_one_of_the_following") + charTypes + '\n';

      output += t("data_prompt_json_response_format");

      if (isAiEnabled && onOpenAiSidebar) {
        const requestSchema = selectedSchema;
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
        defaultPath: `Prompt_DataGen_${selectedSchema}_${selectedTable}.txt`, 
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
          const next = mergeGenerationSettings(payload, target.rules, target.count, t, differentTarget, (rule, count) => validateGeneratorRuleValues(rule, count, 'oracle', inputDateFormat));
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

  const generateDataRow = createGeneratorRow(inputDateFormat, t);

  const workflow = useGenerationWorkflow({ database: 'oracle', schema: selectedSchema, table: selectedTable,
    rules: columnRules, count: generateCount, inputFormat: inputDateFormat, isBusy, beginLoading, endLoading,
    onStart: () => { settingsRevisionRef.current++; }, generateRow: generateDataRow });

  return {
    inputDateFormat, outputDateFormat,
    isLoading,
    ...workflow,
    schemas,
    selectedSchema,
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
