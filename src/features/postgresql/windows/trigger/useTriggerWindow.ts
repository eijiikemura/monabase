// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { PostgresTriggerMetadata } from '@/shared/api/desktopContract';
import { useTriggerTarget } from '@/features/trigger/useTriggerTarget';
import type { TriggerOverviewData } from '@/features/trigger/TriggerOverview';
import type { PostgresTriggerExpected } from '@/shared/api/desktopContract';
import { finiteNumericSqlLiteral } from '@/shared/utils/numberValues';
import { runGitOperation } from '@/features/git/gitOperation';
import { quoteIdentifier } from '@/shared/utils/objectIdentity';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { buildTriggerTraceProgram } from './triggerTraceProgram';
import { useLoadingCounter } from "@/shared/hooks/useLoadingCounter";
import type { ColumnDefinition } from "@/shared/types/databaseTypes";
import type { GroupedVariables } from "@/shared/types/traceTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { linter, type Diagnostic } from '@codemirror/lint';
import { sql } from '@codemirror/lang-sql';
import { EditorView } from '@codemirror/view';
import { CompletionContext } from '@codemirror/autocomplete';

import { pgDialect, pgFunctionHighlighting, pgBuiltinCompletions } from '../common/pgDialect';
import { useDbCompletions } from "@/features/sql/hooks/useDbCompletions";

import { useTraceSimulator } from '../common/useTraceSimulator';
import { getPostgresFormatForValue, DEFAULT_DATE_FORMAT } from "@/shared/utils/dateFormatter";
import { ipcRenderer } from '@/shared/api/desktop';

export interface CompileError { line: number; col: number; text: string; }

export interface TriggerWindowProps {
  tabId: number;
  schema: string;
  triggerName: string;
  initialTable?: string;
  isNew: boolean;
  isActive: boolean;
  outputDateFormat?: string;
  inputDateFormat?: string;
}



export const useTriggerWindow = (props: TriggerWindowProps) => {
  const { tabId, schema, triggerName, initialTable, isNew, isActive, inputDateFormat = DEFAULT_DATE_FORMAT } = props;
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState<string>('edit');
  // Disable actions from the initial render until startup fetching completes.
  const { isLoading, beginLoading, endLoading, isBusy } = useLoadingCounter(true);
  const [isExecuting, setIsExecuting] = useState(false);
  const initialLoadStarted = useRef(false);
  const existingDefinitionReady = useRef(isNew);
  const expectedDefinition = useRef<PostgresTriggerExpected | undefined>(undefined);
  const originalTarget = useRef({ schema, table: initialTable || '', name: triggerName });
  const [loadError, setLoadError] = useState('');
  const [definitionReady, setDefinitionReady] = useState(isNew);
  const [overview, setOverview] = useState<TriggerOverviewData | null>(null);
  const definitionVersion = useRef(0);
  useEffect(() => () => { definitionVersion.current++; }, []);
  const [sourceText, setSourceText] = useState<string>(t("fetching_data"));

  const [wizTriggerName, setWizTriggerName] = useState(triggerName || '');
  const [wizSchema, setWizSchemaState] = useState(schema || 'public');
  const [wizTargetType, setWizTargetTypeState] = useState<'TABLE' | 'VIEW'>('TABLE');
  const [wizTargetObject, setWizTargetObjectState] = useState(initialTable || '');

  const [wizTiming, setWizTiming] = useState<'BEFORE' | 'AFTER' | 'INSTEAD OF'>('BEFORE');
  const [wizEvents, setWizEvents] = useState<string[]>(['INSERT', 'UPDATE']);
  const [wizUpdateCols, setWizUpdateCols] = useState<string[]>([]);
  const [wizForEachRow, setWizForEachRow] = useState(true);

  const [wizBody, setWizBody] = useState(`BEGIN\n  -- ${t("write_your_processing_here")}\n  RETURN NEW;\nEND;`);

  const [structureDefs, setStructureDefs] = useState<ColumnDefinition[]>([]);

  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [compileErrors, setCompileErrors] = useState<CompileError[]>([]);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const resizeRef = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

  const [topHeight, setTopHeight] = useState<number>(300);
  const [leftWidth, setLeftWidth] = useState<number>(window.innerWidth * 0.5);
  const ratioRef = useRef({ left: 0.5 });

  const [isResizingV, setIsResizingV] = useState(false);
  const [isResizingH, setIsResizingH] = useState(false);

  const [isTraceDialogOpen, setIsTraceDialogOpen] = useState<boolean>(false);
  const [traceTargetDml, setTraceTargetDml] = useState<'INSERT' | 'UPDATE' | 'DELETE' | 'TRUNCATE'>('INSERT');
  const [traceWhereClause, setTraceWhereClause] = useState<string>('');
  const [traceInputData, setTraceInputData] = useState<{ [key: string]: string }>({});

  const { schemaList, columnList, targetError, targetReady, reloadTarget } = useTriggerTarget({
    database: 'postgresql', schema: wizSchema, table: wizTargetObject, active: isActive,
    onInvalidate: () => { setStructureDefs([]); setTraceInputData({}); setTraceWhereClause(''); setIsTraceDialogOpen(false); }
  });
  const setWizSchema = useEventCallback((value: string) => {
    if (value === wizSchema) return;
    setWizSchemaState(value); setWizTargetObjectState(''); setWizUpdateCols([]);
  });
  const setWizTargetType = useEventCallback((value: 'TABLE' | 'VIEW') => {
    if (value === wizTargetType) return;
    setWizTargetTypeState(value); setWizTargetObjectState(''); setWizUpdateCols([]);
  });
  const setWizTargetObject = useEventCallback((value: string) => {
    if (value === wizTargetObject) return;
    setWizTargetObjectState(value); setWizUpdateCols([]);
  });
  const targetIdentity = JSON.stringify([wizSchema, wizTargetObject]);
  const targetIdentityRef = useRef(targetIdentity);
  targetIdentityRef.current = targetIdentity;
  const canSave = definitionReady && targetReady && !overview?.readOnly;
  const canTrace = definitionReady && targetReady && !overview?.readOnly;

  const simulator = useTraceSimulator();
  const [traceDateTime, setTraceDateTime] = useState<string | null>(null);
  const [triggerDisplaySql, setTriggerDisplaySql] = useState<string>('');
  const [procToTrgMap, setProcToTrgMap] = useState<number[]>([]);
  const [trgToProcMap, setTrgToProcMap] = useState<number[]>([]);

  const [traceArguments, setTraceArguments] = useState<{ [key: string]: string }>({});
  const [traceConditions, setTraceConditions] = useState<{ [key: string]: string }>({});

  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [traceRightTab, setTraceRightTab] = useState(0);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuLineNum, setMenuLineNum] = useState<number | null>(null);

  const displayAliasNew = 'NEW';
  const displayAliasOld = 'OLD';

  const { dbCompletions, dbSchema } = useDbCompletions(wizSchema);

  // Store current values in refs to avoid recreating callbacks.
  const completionStateRef = useRef({ dbSchema, wizTargetObject, columnList, dbCompletions });
  useEffect(() => {
    completionStateRef.current = { dbSchema, wizTargetObject, columnList, dbCompletions };
  }, [dbSchema, wizTargetObject, columnList, dbCompletions]);

  const compileErrorsRef = useRef(compileErrors);
  useEffect(() => {
    compileErrorsRef.current = compileErrors;
  }, [compileErrors]);

  const handleTabChange = useCallback((_: React.SyntheticEvent, val: string) => {
    setActiveTab(val);
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      if (window.innerWidth >= window.screen.availWidth * 0.95) {
        setLeftWidth(window.innerWidth * 0.7);
      } else {
        setLeftWidth(window.innerWidth * ratioRef.current.left);
      }
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingV) {
        const delta = e.clientY - resizeRef.current.startY;
        let newHeight = resizeRef.current.startHeight + delta;
        if (newHeight < 100) newHeight = 100;
        if (newHeight > window.innerHeight - 200) newHeight = window.innerHeight - 200;
        setTopHeight(newHeight);
      }
      if (isResizingH) {
        const delta = e.clientX - resizeRef.current.startX;
        let newWidth = resizeRef.current.startWidth + delta;
        if (newWidth < 200) newWidth = 200;
        if (newWidth > window.innerWidth - 100) newWidth = window.innerWidth - 100;
        setLeftWidth(newWidth);
        ratioRef.current.left = newWidth / window.innerWidth;
      }
    };

    const handleMouseUp = () => {
      setIsResizingV(false);
      setIsResizingH(false);
    };

    if (isResizingV || isResizingH) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = isResizingH ? 'col-resize' : 'row-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingV, isResizingH]);

  const groupedVariables = useMemo(() => {
    const groups: GroupedVariables = {};
    Object.entries(simulator.currentVariables).forEach(([key, val]) => {
      let displayKey = key;
      if (key.toUpperCase().startsWith('V_N')) {
         displayKey = key.replace(/^v_n/i, displayAliasNew);
      } else if (key.toUpperCase().startsWith('V_O')) {
         displayKey = key.replace(/^v_o/i, displayAliasOld);
      }

      const baseMatch = displayKey.match(/^([a-zA-Z0-9_]+)(.*)$/);
      if (baseMatch) {
        if (baseMatch[2] === '') groups[baseMatch[1]] = val;
        else {
            if (typeof groups[baseMatch[1]] !== 'object') groups[baseMatch[1]] = {};
            const group = groups[baseMatch[1]];
            if (typeof group === 'object') group[baseMatch[2]] = val;
        }
      } else {
          groups[displayKey] = val;
      }
    });
    return groups;
  }, [simulator.currentVariables]);

  const loadExistingData = useEventCallback(async () => {
    const version = ++definitionVersion.current;
    setDefinitionReady(false); setLoadError('');
    beginLoading();
    try {
      const res = await ipcRenderer.invoke('get-postgres-trigger', { schema, triggerName, tableName: initialTable });
      if (!res.success) throw new Error(res.error);
      if (version !== definitionVersion.current) return;
      const row: PostgresTriggerMetadata = res.trigger;
      {
        existingDefinitionReady.current = true;
        expectedDefinition.current = { triggerOid: row.trigger_oid, triggerDefinition: row.trigger_ddl,
          functionDefinition: row.function_ddl, enabled: row.enabled };
        originalTarget.current = { schema: row.schema_name, table: row.table_name, name: row.trigger_name };
        setWizTriggerName(row.trigger_name); setWizSchemaState(row.schema_name);
        setWizTargetTypeState(row.relkind === 'v' ? 'VIEW' : 'TABLE'); setWizTargetObjectState(row.table_name);
        const timing = row.tgtype & 64 ? 'INSTEAD OF' : row.tgtype & 2 ? 'BEFORE' : 'AFTER';
        setWizTiming(timing); setWizForEachRow(Boolean(row.tgtype & 1));
        const evts = [[4, 'INSERT'], [16, 'UPDATE'], [8, 'DELETE'], [32, 'TRUNCATE']] as const;
        const events = evts.filter(([bit]) => row.tgtype & bit).map(([, name]) => name);
        setWizEvents(events); setWizUpdateCols(row.update_columns || []);
        const extractedBody = row.function_body;
        setWizBody(extractedBody); setSourceText(`${row.function_ddl};\n\n${row.trigger_ddl};`);
        setOverview({ status: ({ O: 'ENABLED', D: 'DISABLED', R: 'REPLICA', A: 'ALWAYS' } as Record<string, string>)[row.enabled] || row.enabled,
          timing, events: events.join(' OR '), level: row.tgtype & 1 ? 'ROW' : 'STATEMENT', when: row.when_condition,
          updateColumns: row.update_columns || [], functionName: `${quoteIdentifier(row.function_schema)}.${quoteIdentifier(row.function_name)}()`,
          functionUsers: Number(row.function_users), readOnly: row.language !== 'plpgsql' || Number(row.function_users) > 1 });
        setDefinitionReady(true);
        try {
          const traceDataRes = await ipcRenderer.invoke('get-trace-data', { schema, objectName: triggerName, objectType: 'TRIGGER', tableName: originalTarget.current.table || initialTable });
          if (version === definitionVersion.current && traceDataRes.success && traceDataRes.info) {
            setTraceDateTime(traceDataRes.info.compile_date);
            let loadedWizBody = '';
            let loadedProcMap = null;
            let loadedTrgMap = null;

            if (traceDataRes.info.arguments) {
              const parsedArgs = JSON.parse(traceDataRes.info.arguments);
              const args: Record<string, string> = {};
              const conds: Record<string, string> = {};

              Object.keys(parsedArgs).forEach(k => {
                 if (k === '__WIZ_BODY__') loadedWizBody = parsedArgs[k];
                 else if (k === '__PROC_MAP__') loadedProcMap = JSON.parse(parsedArgs[k]);
                 else if (k === '__TRG_MAP__') loadedTrgMap = JSON.parse(parsedArgs[k]);
                 else if (k === 'OLD (条件)') conds[k] = parsedArgs[k];
                 else args[k] = parsedArgs[k];
              });

              setTraceArguments(args);
              setTraceConditions(conds);
            }

            setTriggerDisplaySql(loadedWizBody || extractedBody);

            if (loadedProcMap && loadedTrgMap) {
                setProcToTrgMap(loadedProcMap);
                setTrgToProcMap(loadedTrgMap);
            } else {
                const fallbackMap = new Array(5000).fill(0).map((_, idx) => idx);
                setProcToTrgMap(fallbackMap);
                setTrgToProcMap(fallbackMap);
            }

            if (traceDataRes.steps && traceDataRes.steps.length > 0) {
               simulator.loadSimulation(traceDataRes.steps);
            }
          }
        } catch (e) {
          console.warn("Failed to load trace history.", e);
        }

      }
    } catch (error) {
      if (version === definitionVersion.current) {
        existingDefinitionReady.current = false; setDefinitionReady(false); setLoadError(getErrorMessage(error));
      }
    } finally {
      endLoading();
    }
  });

  useEffect(() => {
    if (!isActive || initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    const requests: Promise<void>[] = [];
    if (!isNew) requests.push(loadExistingData());
    void Promise.all(requests)
      .catch((error: unknown) => {
        setConsoleLogs(previous => [...previous, `[ERROR] ${getErrorMessage(error)}`]);
        setIsConsoleOpen(true);
      })
      .finally(endLoading);
  }, [isActive, isNew, loadExistingData, endLoading]);


  useEffect(() => {
    if (isNew && wizTargetType === 'VIEW') {
      setWizTiming('INSTEAD OF');
      setWizForEachRow(true);
    } else if (isNew && wizTiming === 'INSTEAD OF') {
      setWizTiming('BEFORE');
    }
  }, [isNew, wizTargetType, wizTiming]);

  const loadStructureForTrace = async () => {
    const identity = targetIdentityRef.current, version = definitionVersion.current;
    const sqlCols = `SELECT c.column_name AS "COLUMN_NAME", c.data_type AS "DATA_TYPE", c.character_maximum_length AS "DATA_LENGTH", CASE WHEN c.is_nullable = 'NO' THEN 'N' ELSE 'Y' END AS "NULLABLE", c.column_default AS "DATA_DEFAULT" FROM information_schema.columns c WHERE c.table_schema = :schema AND c.table_name = :tableName ORDER BY c.ordinal_position`;
    const res = await ipcRenderer.invoke<(({ COLUMN_NAME: string })) & (ColumnDefinition)>('execute-sql-bg', sqlCols, { schema: wizSchema, tableName: wizTargetObject });
    if (identity !== targetIdentityRef.current || version !== definitionVersion.current) return false;
    if (res.success && res.rows) {
      setStructureDefs(res.rows);
      const initData: Record<string, string> = {};
      res.rows.forEach((col: { COLUMN_NAME: string }) => { initData[col.COLUMN_NAME] = ''; });
      setTraceInputData(initData);
      return true;
    }
    return false;
  };

  const handleEventChange = useCallback((event: string) => {
    setWizEvents(prev => prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]);
  }, []);

  const handleDelete = useEventCallback(async () => {
    if (isBusy()) return;
    if (!definitionReady) return;
    if (window.confirm(t("trigger_3") + triggerName + t("this_operation_cannot_be_undone"))) {
      beginLoading();
      try {
        const safeSchema = schema ? `${quoteIdentifier(schema)}.` : '';
        const sqlText = `DROP TRIGGER ${quoteIdentifier(triggerName)} ON ${safeSchema}${quoteIdentifier(originalTarget.current.table || initialTable || wizTargetObject)}`;
        const res = await ipcRenderer.invoke('execute-sql', sqlText);
        if (res.success) {
          try { await ipcRenderer.invoke('delete-trace-db', { schema, objectName: triggerName, objectType: 'TRIGGER', tableName: originalTarget.current.table || initialTable }); } catch { /* Auxiliary failures must not affect the main operation's result. */  }

          try {
            await runGitOperation(t, 'git-delete-object', {
              dbType: 'POSTGRES',
              schema: schema,
              objectType: 'TRIGGER',
              objectName: triggerName, tableName: originalTarget.current.table || initialTable
            });
          } catch (e) {
            console.error("Failed to delete the object from Git.", e);
          }

          alert(t("deleted"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TRIGGER' } }));
          window.dispatchEvent(new CustomEvent('object-deleted', { detail: { schema: schema, objectName: triggerName, objectType: 'TRIGGER', tableName: originalTarget.current.table || initialTable } }));
          window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
        } else {
          alert(t("delete_error_3") + res.error);
        }
      } catch (e: unknown) {
        alert(t("delete_error_3") + getErrorMessage(e));
      } finally {
        endLoading();
      }
    }
  });

  const handleCreateTrigger = useEventCallback(async () => {
    if (isBusy()) return;
    if (!canSave) { alert(t('trigger_not_ready')); return; }
    if (!existingDefinitionReady.current) { alert(t('failed_to_fetch_source')); return; }
    if (!wizTriggerName.trim() || !wizTargetObject || !wizEvents.length) { alert(t("please_fill_in_required_fields_trigger_name_target_events")); return; }

    beginLoading(); setConsoleLogs([]); setCompileErrors([]);
    try {
      const original = originalTarget.current;
      if (!isNew && (wizSchema !== original.schema || wizTargetObject !== original.table || wizTriggerName !== original.name)) {
        throw new Error(t('trigger_identity_edit_blocked'));
      }
      const result = await ipcRenderer.invoke('save-postgres-trigger', {
        schema: wizSchema, tableName: wizTargetObject, triggerName: wizTriggerName, isNew,
        body: wizBody, timing: wizTiming, events: wizEvents, forEachRow: wizEvents.includes('TRUNCATE') ? false : wizForEachRow,
        expected: expectedDefinition.current
      });
      if (!result.success) throw new Error(t('trigger_creation_error') + result.error);

      if (!isNew && wizTriggerName !== triggerName) {
        try {
          await runGitOperation(t, 'git-rename-object', {
            dbType: 'POSTGRES',
            schema: wizSchema,
            objectType: 'TRIGGER',
            oldName: triggerName, tableName: wizTargetObject,
            newName: wizTriggerName
          });
        } catch (e) {
          console.error("Failed to rename the object in Git.", e);
        }
      }

      window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: wizSchema, objType: 'TRIGGER' } }));

      alert(t("trigger_4") + (isNew ? t("create") : t("change")) + t("successful"));
      setIsConsoleOpen(false);

      if (isNew || wizTriggerName !== triggerName || wizSchema !== schema || wizTargetObject !== originalTarget.current.table) window.dispatchEvent(new CustomEvent('trigger-created', { detail: { tabId, schema: wizSchema, triggerName: wizTriggerName, tableName: wizTargetObject } }));
      else await loadExistingData();

    } catch (e: unknown) {
      setConsoleLogs([t("creation_modification_error"), `[ERROR] ${getErrorMessage(e)}`]);
      setIsConsoleOpen(true);
      alert(t("an_error_occurred_please_check_the_console"));
    } finally {
      endLoading();
    }
  });

  const handleTraceExecuteClick = useEventCallback(async () => {
    if (isBusy()) return;
    if (!canTrace) { alert(t('trigger_not_ready')); return; }
    beginLoading();
    try {
      const success = await loadStructureForTrace();
      if (success) {
        if (wizEvents.includes('INSERT')) setTraceTargetDml('INSERT');
        else if (wizEvents.includes('UPDATE')) setTraceTargetDml('UPDATE');
        else if (wizEvents.includes('DELETE')) setTraceTargetDml('DELETE');
        else if (wizEvents.includes('TRUNCATE')) setTraceTargetDml('TRUNCATE');
        setIsTraceDialogOpen(true);
      } else {
        alert(t("failed_to_fetch_table_structure_please_check_the_target_object_settings"));
      }
    } catch (error: unknown) {
      alert(t("failed_to_fetch_table_structure") + '\n' + getErrorMessage(error));
    } finally {
      endLoading();
    }
  });

  const formatSqlValue = (col: ColumnDefinition, val: unknown) => {
    if (val === null || val === undefined || val === '') return 'NULL';
    const typeUpper = col.DATA_TYPE.toUpperCase();
    if (/INT|NUMERIC|DECIMAL|FLOAT|REAL|DOUBLE/.test(typeUpper)) return finiteNumericSqlLiteral(val);
    if (typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP') || typeUpper.includes('TIME')) {
       const pgFormat = getPostgresFormatForValue(inputDateFormat, String(val).trim());
       return `TO_TIMESTAMP('${String(val).replace(/'/g, "''").trim()}', '${pgFormat}')`;
    }
    const isStandardType = ['VARCHAR', 'CHAR', 'TEXT', 'INT', 'NUMERIC', 'FLOAT', 'REAL', 'DOUBLE', 'SERIAL', 'DATE', 'TIMESTAMP', 'TIME', 'BOOLEAN', 'BYTEA'].some(t => typeUpper.includes(t));
    if (!isStandardType) {
      return `'${String(val).trim().replace(/'/g, "''")}'::${typeUpper}`;
    }
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  const handleStartTrace = useEventCallback(async () => {
    if (isBusy()) return;
    if (!canTrace) { alert(t('trigger_not_ready')); return; }
    const traceArgs: Record<string, string> = {};
    const traceConds: Record<string, string> = {};

    if (traceTargetDml === 'INSERT' || traceTargetDml === 'UPDATE') {
      for (const col of structureDefs) {
        const val = traceInputData[col.COLUMN_NAME];
        const isNullOrEmpty = val === null || val === undefined || val === '';

        if (traceTargetDml === 'INSERT' && col.NULLABLE === 'N' && isNullOrEmpty && !col.DATA_DEFAULT) {
          alert(t("column_3") + col.COLUMN_NAME + t("is_required"));
          return;
        }

        if (!isNullOrEmpty) {
           if (/INT|NUMERIC|DECIMAL|FLOAT|REAL|DOUBLE/i.test(col.DATA_TYPE)) {
            try { finiteNumericSqlLiteral(val); } catch {
              alert(t("column_3") + col.COLUMN_NAME + t("must_be_a_number"));
              return;
            }
           }
           if (['varchar', 'char'].includes(col.DATA_TYPE) && col.DATA_LENGTH) {
              if (String(val).length > Number(col.DATA_LENGTH)) {
                 alert(t("column_3") + col.COLUMN_NAME + t("input_length_is_too_long_max") + col.DATA_LENGTH + t("characters"));
                 return;
              }
           }
           traceArgs[`NEW.${col.COLUMN_NAME}`] = val;
        }
      }
    }

    const checkWhere = traceWhereClause.trim() || '1=1';
    if (traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE') {
      traceConds['OLD (条件)'] = checkWhere;
    }

    if (traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE') {
      beginLoading();
      try {
        const targetTableSql = wizSchema ? `"${wizSchema}"."${wizTargetObject}"` : `"${wizTargetObject}"`;
        const checkSql = `SELECT COUNT(*) AS cnt FROM ${targetTableSql} WHERE ${checkWhere}`;
        const countRes = await ipcRenderer.invoke('execute-sql-bg', checkSql);

        if (!countRes.success) {
          alert(t("condition_evaluation_failed") + countRes.error);
          endLoading();
          return;
        }

        if (countRes.rows && countRes.rows.length > 0) {
          const row = countRes.rows[0];
          const countVal = row.cnt || row.CNT || Object.values(row)[0];
          const cnt = parseInt(String(countVal), 10);
          if (isNaN(cnt) || cnt === 0) {
            alert(t("trace_analysis_skipped_because_no_data_matches_the_specified_conditions"));
            try { await ipcRenderer.invoke('delete-trace-db', { schema: wizSchema, objectName: wizTriggerName, objectType: 'TRIGGER', tableName: wizTargetObject }); } catch { /* Auxiliary failures must not affect the main operation's result. */ }
            endLoading();
            return;
          }
        }
      } catch (e: unknown) {
        alert(t("error_evaluating_condition") + getErrorMessage(e));
        endLoading();
        return;
      }
      endLoading();
    }

    setTraceArguments(traceArgs);
    setTraceConditions(traceConds);
    setIsTraceDialogOpen(false);
    beginLoading();
    setConsoleLogs([]);

    const { sqlText, mapP2T, mapT2P } = buildTriggerTraceProgram({ wizBody, wizSchema, wizTargetObject, wizTiming, wizForEachRow, traceTargetDml, traceInputData, structureDefs, checkWhere, formatSqlValue });
    setTriggerDisplaySql(wizBody);
    setProcToTrgMap(mapP2T);
    setTrgToProcMap(mapT2P);

    setConsoleLogs([
      t("auto_generated_debugging_program"),
      sqlText
    ]);
    setIsConsoleOpen(true);

    const backendArgs = { ...traceArgs, ...traceConds };
    backendArgs['__WIZ_BODY__'] = wizBody;
    backendArgs['__PROC_MAP__'] = JSON.stringify(mapP2T);
    backendArgs['__TRG_MAP__'] = JSON.stringify(mapT2P);

    setIsExecuting(true);
    try {
      const res = await ipcRenderer.invoke('execute-trace', {
         traceTarget: { schema: wizSchema, objectName: wizTriggerName, objectType: 'TRIGGER', tableName: wizTargetObject },
         schema: wizSchema,
         objectName: wizTriggerName,
         objectType: 'PROCEDURE',
         sourceText: sqlText,
         args: backendArgs,
         argTypes: {}, argDirections: {},
         inputDateFormat: inputDateFormat,
         skipParse: true
      });

      if (res.errorCode === 'TRACE_MAIN_TRANSACTION_PENDING' ||
          res.errorCode === 'TRACE_MAIN_CONNECTION_BUSY') {
        setConsoleLogs([`[ERROR] ${res.error}`]);
        setIsConsoleOpen(true);
        alert(res.error);
        return;
      }

      if (res.success) {
        if (res.variablesTrace) simulator.parseTraceLogs(res.variablesTrace, true);
        setTraceDateTime(res.traceDate || new Date().toLocaleString('ja-JP'));
        setActiveTab('trace');

        setConsoleLogs([
          t("trace_analysis_successful"),
          ...(res.dbmsOutput || []).map((l:string) => `[LOG] ${l}`),
          "",
          t("auto_generated_debugging_program"),
          res.generatedSource || sqlText
        ]);
        setIsConsoleOpen(true);

      } else {
        setConsoleLogs([
          t("trace_analysis_error"),
          ...res.error.split('\n').map((e:string) => `[ERROR] ${e}`),
          "",
          t("auto_generated_debugging_program"),
          sqlText
        ]);
        setIsConsoleOpen(true);
      }
    } finally {
      endLoading();
      setIsExecuting(false);
    }
  });

  const handleConsoleClick = useEventCallback((lineText: string) => {
    const match = lineText.match(/行\s+(\d+)/) || lineText.match(/Line\s+(\d+)/i);
    if (match && editorRef.current?.view) {
      const lineNum = parseInt(match[1], 10);
      const docLines = editorRef.current.view.state.doc.lines;
      const safeLine = Math.min(Math.max(1, lineNum), docLines);
      const pos = editorRef.current.view.state.doc.line(safeLine).from;
      editorRef.current.view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  });

  // Keep extensions stable to prevent CodeMirror recreation.
  const extensions = useMemo(() => {
    const triggerCompletion = (context: CompletionContext) => {
      const newAlias = 'NEW';
      const oldAlias = 'OLD';

      const { dbSchema: currentDbSchema, wizTargetObject: currentObj, columnList: currentCols, dbCompletions: currentCompletions } = completionStateRef.current;

      let targetCols = currentDbSchema[currentObj];
      if (!targetCols) {
         const actualKey = Object.keys(currentDbSchema).find(k => k.toLowerCase() === currentObj.toLowerCase());
         if (actualKey) targetCols = currentDbSchema[actualKey];
      }

      const dotMatch = context.matchBefore(new RegExp(`\\b(?:${newAlias}|${oldAlias})\\.\\w*$`, 'i'));
      if (dotMatch) {
        const word = context.matchBefore(/\w*/);
        const options = targetCols || currentCols.map(col => ({ label: col, type: 'property', detail: 'カラム' }));
        return {
          from: word ? word.from : context.pos,
          options: options
        };
      }

      const dotBefore = context.matchBefore(/\.\w*/);
      if (dotBefore) return null;

      const word = context.matchBefore(/\w*/);
      if (!word || (word.from === word.to && !context.explicit)) return null;

      const baseOptions = [
        { label: newAlias, type: 'keyword', detail: '別名(新)' },
        { label: oldAlias, type: 'keyword', detail: '別名(旧)' },
        ...currentCompletions,
        ...pgBuiltinCompletions
      ];

      return { from: word.from, options: baseOptions };
    };

    const pgLinter = linter((view) => {
      const currentErrors = compileErrorsRef.current;
      return currentErrors.map(err => {
        if (err.line > 0 && err.line <= view.state.doc.lines) {
          const line = view.state.doc.line(err.line);
          const from = line.from + (err.col > 0 ? err.col - 1 : 0);
          return { from: Math.min(from, line.to), to: line.to, severity: "error", message: err.text };
        }
        return null;
      }).filter(Boolean) as Diagnostic[];
    });

    return [
      sql({ dialect: pgDialect, upperCaseKeywords: true }),
      pgDialect.language.data.of({ autocomplete: triggerCompletion }),
      pgLinter,
      pgFunctionHighlighting
    ];
  }, []);

  const retryLoad = useEventCallback(async () => {
    await Promise.all([reloadTarget(), ...(!isNew ? [loadExistingData()] : [])]);
  });

  return {
    canSave, canTrace, definitionReady, overview, loadError: [loadError, targetError].filter(Boolean).join(' · '), retryLoad,
    activeTab, setActiveTab, handleTabChange, isLoading, isExecuting, sourceText, setSourceText,
    wizTriggerName, setWizTriggerName, wizSchema, setWizSchema,
    wizTargetType, setWizTargetType, wizTargetObject, setWizTargetObject,
    wizTiming, setWizTiming, wizEvents, setWizEvents, wizUpdateCols, setWizUpdateCols,
    wizForEachRow, setWizForEachRow,
    wizBody, setWizBody, schemaList, columnList, structureDefs,
    isConsoleOpen, setIsConsoleOpen, consoleLogs, setConsoleLogs, setCompileErrors,
    editorRef, topHeight, leftWidth, isResizingV, setIsResizingV, isResizingH, setIsResizingH, resizeRef,
    isTraceDialogOpen, setIsTraceDialogOpen, traceTargetDml, setTraceTargetDml, traceWhereClause, setTraceWhereClause,
    traceInputData, setTraceInputData, simulator, traceDateTime, triggerDisplaySql,
    procToTrgMap, trgToProcMap, isRightPanelOpen, setIsRightPanelOpen, traceRightTab, setTraceRightTab,
    anchorEl, setAnchorEl, menuLineNum, setMenuLineNum, displayAliasNew, displayAliasOld, groupedVariables,
    handleEventChange, handleDelete, handleCreateTrigger, handleTraceExecuteClick, handleStartTrace, handleConsoleClick, extensions, loadExistingData,
    traceArguments, traceConditions
  };
};
