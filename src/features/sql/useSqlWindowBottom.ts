// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { oraclePlanTableIdentity } from './explainIdentity';
import { getFullTableDDL } from '@/features/postgresql/windows/common/ddlHelper';
import type { ObjectIdentity } from '@/shared/types/objectTypes';
import { withRowIdentity } from '@/features/data-grid/rowIdentity';
import type { LogEntry, SqlHistoryEntry, ExplainSnapshot, SqlResultSummary } from '@/shared/types/sqlTypes';
import type { ExplainNode, PgPlanNode } from './explainTypes';
import type { DatabaseRow } from "@/shared/types/databaseTypes";
import type { AiContext } from '@/shared/types/aiTypes';

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useMemo } from 'react';
import { type GridColDef, type GridValueFormatterParams } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';
import { buildTransposedColumns } from "../data-grid/dataGridHelper";
import { formatDbDate } from "@/shared/utils/dateFormatter";
import { ipcRenderer } from "@/shared/api/desktop";

export interface SqlWindowBottomProps {
  layoutActions?: React.ReactNode;
  isVisible?: boolean;
  resultSummary?: SqlResultSummary | null;
  rows: DatabaseRow[];
  columns: GridColDef[]; 
  isExplainResult: boolean;
  explainSnapshot?: ExplainSnapshot | null;
  bottomTab: number; 
  setBottomTab: React.Dispatch<React.SetStateAction<number>>;
  logs: LogEntry[]; 
  historyLogs: SqlHistoryEntry[]; 
  historyLimit: number;
  handleClearLogs: () => void; 
  handleClearHistory: () => void; 
  handleConsoleClick: (lineText: string) => void;
  setSqlText: React.Dispatch<React.SetStateAction<string>>;
  dateFormat: string; 
  sqlText: string;
  dbInfo?: string;
  selectedSchema?: string;
  title: string;
  isAiEnabled: boolean;
  onOpenAiSidebar: (context: AiContext | null) => void;
  dbType?: 'oracle' | 'postgresql';
}

export const useSqlWindowBottom = (props: SqlWindowBottomProps) => {
  const { rows, columns, dateFormat, sqlText, dbInfo, isExplainResult } = props;
  const { t, i18n } = useTranslation();

  const resolvedDbType: 'oracle' | 'postgresql' = useMemo(() => {
    if (props.dbType) return props.dbType;
    if (dbInfo && dbInfo.toLowerCase().includes('oracle')) return 'oracle';
    return 'postgresql';
  }, [props.dbType, dbInfo]);

  const [isTransposed, setIsTransposed] = useState<boolean>(false);
  const [sharedBindSnapshot, setSharedBindSnapshot] = useState<ExplainSnapshot | null>(null);
  const includeBindValues = Boolean(props.explainSnapshot && sharedBindSnapshot === props.explainSnapshot);
  const setIncludeBindValues = (value: boolean) => setSharedBindSnapshot(value ? props.explainSnapshot || null : null);

  // Use formatDbDate consistently instead of overriding with toISOString().
  const formatCellValue = useMemo(() => {
    return (params: GridValueFormatterParams<unknown>) => {
      const value = params.value;
      if (value == null) return '';
      if (value instanceof Date) {
        return formatDbDate(value, dateFormat);
      }
      if (value && ((typeof value === 'object' && 'type' in value && value.type === 'Buffer') || value instanceof Uint8Array)) {
        return '<Buffer>';
      }
      if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return String(value); }
      }
      return value;
    };
  }, [dateFormat]);

  const baseColumns = useMemo(() => {
    if (!columns || columns.length === 0) return [];
    
    const built = columns.map(col => ({
      ...col,
      valueFormatter: col.valueFormatter || formatCellValue
    }));

    return built;
  }, [columns, formatCellValue]);

  const displayColumns = useMemo(() => {
    return isTransposed ? buildTransposedColumns(rows, dateFormat) : baseColumns;
  }, [isTransposed, baseColumns, rows, dateFormat]); 
  
  const displayRows = useMemo(() => {
    if (!rows || rows.length === 0) return [];

    if (isTransposed) {
      return displayColumns.map((col, idx) => { 
        const tRow: DatabaseRow = { colName: col.headerName };
        for (let rIdx = 0; rIdx < rows.length; rIdx++) {
          let val = rows[rIdx][col.field as string];
          if (val !== null && typeof val === 'object') {
             try { val = JSON.stringify(val); } catch { val = String(val); }
          }
          tRow[`row_${rIdx}`] = val;
        }
        return withRowIdentity(tRow, `transposed_${idx}`);
      });
    }
    
    return rows;
  }, [isTransposed, displayColumns, rows]);

  const historyColumns: GridColDef[] = useMemo(() => [
    { field: 'executeTime', headerName: t("execution_time"), width: 170 },
    { field: 'sql', headerName: t("sql_statement"), flex: 1 },
    { field: 'duration', headerName: t("time_ms"), width: 120 },
    { field: 'rowCount', headerName: t("process_count"), width: 100, renderCell: (params) => params.value !== null ? params.value : '-' },
  ], [t]);

  const parsedExplain = useMemo(() => {
    if (!isExplainResult || rows.length === 0) return { tree: [], predicates: [], headerText: [] };

    const tree: ExplainNode[] = [];
    const predicates: string[] = [];
    let headerText: string[] = [];

    if (resolvedDbType === 'oracle') {
      let mode = 'search'; 
      const stack: { node: ExplainNode; indent: number }[] = [];
      rows.forEach(r => {
        const text = String(r.PLAN_TABLE_OUTPUT !== undefined ? r.PLAN_TABLE_OUTPUT : (Object.values(r).find(v => typeof v === 'string') || ''));
        if (text.includes('Predicate Information')) { mode = 'predicate'; predicates.push(text); return; }
        if (mode === 'predicate') { predicates.push(text); return; }
        if (text.startsWith('Plan hash value')) headerText.push(text);
        if (text.trim().startsWith('|') && !text.includes('Id') && !text.includes('---')) {
          mode = 'table'; 
          const parts = text.split('|');
          if (parts.length >= 8) {
            const rawId = parts[1].replace('*', '').trim(); 
            const indent = (parts[2].match(/^\s*/) || [''])[0].length;
            const node = { 
              id: rawId, 
              hasAsterisk: parts[1].includes('*'), 
              operation: parts[2].trim(), 
              name: parts[3].trim(),
              table: oraclePlanTableIdentity(r),
              rowsVal: parts[4].trim(), 
              bytes: parts[5].trim(), 
              cost: parts[6].trim(), 
              time: parts[7].trim(), 
              children: [] as ExplainNode[]
            };
            while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop();
            if (stack.length === 0) tree.push(node); 
            else stack[stack.length - 1].node.children.push(node);
            stack.push({ node, indent });
          }
        }
      });
      if (headerText.length === 0) headerText.push(t("oracle_execution_plan_explain_plan"));
    } else {
      try {
        const rawOutput = rows[0]?.PLAN_TABLE_OUTPUT;
        if (!rawOutput) return { tree: [], predicates: [], headerText: [] };

        let planData;
        if (typeof rawOutput === 'string' && (rawOutput.trim().startsWith('[') || rawOutput.trim().startsWith('{'))) {
          planData = JSON.parse(rawOutput);
        } else if (typeof rawOutput === 'object') {
          planData = rawOutput; 
        } else {
          return { tree: [], predicates: [], headerText: [String(rawOutput)] };
        }

        const planRoot = Array.isArray(planData) ? planData[0]?.Plan : planData?.Plan;
        if (!planRoot) return { tree: [], predicates: [], headerText: ["Invalid JSON Plan format"] };

        let idCounter = 1;

        const buildTree = (pgNode: PgPlanNode): ExplainNode => {
          const currentId = String(idCounter++);
          let opName = pgNode['Node Type'] || '';
          if (pgNode['Join Type']) opName += ` (${pgNode['Join Type']})`;
          
          const relationName = pgNode['Relation Name'] || pgNode['Index Name'] || pgNode['Alias'] || '';
          const startupCost = pgNode['Startup Cost'] !== undefined ? Number(pgNode['Startup Cost']).toFixed(2) : '0.00';
          const totalCost = pgNode['Total Cost'] !== undefined ? Number(pgNode['Total Cost']).toFixed(2) : '0.00';
          
          if (pgNode['Filter']) predicates.push(`${currentId} - Filter: ${pgNode['Filter']}`);
          if (pgNode['Index Cond']) predicates.push(`${currentId} - Index Cond: ${pgNode['Index Cond']}`);
          if (pgNode['Hash Cond']) predicates.push(`${currentId} - Hash Cond: ${pgNode['Hash Cond']}`);

          const resultNode = {
            id: currentId,
            hasAsterisk: pgNode['Filter'] || pgNode['Index Cond'] || pgNode['Hash Cond'] ? true : false,
            operation: opName,
            name: relationName,
            table: pgNode['Relation Name'] && pgNode.Schema
              ? { schema: pgNode.Schema, objectName: pgNode['Relation Name'] } : undefined,
            rowsVal: pgNode['Plan Rows'] !== undefined ? String(pgNode['Plan Rows']) : '',
            bytes: pgNode['Plan Width'] !== undefined ? String(pgNode['Plan Width']) : '',
            cost: `${startupCost} .. ${totalCost}`,
            time: '-',
            children: [] as ExplainNode[]
          };

          if (pgNode.Plans && Array.isArray(pgNode.Plans)) {
            resultNode.children = pgNode.Plans.map((childNode) => buildTree(childNode));
          }

          return resultNode;
        };

        tree.push(buildTree(planRoot));
        headerText.push(t("postgresql_execution_plan_explain"));

      } catch {
        headerText = [rows[0]?.PLAN_TABLE_OUTPUT ? String(rows[0]?.PLAN_TABLE_OUTPUT) : ""];
      }
    }

    return { tree, predicates, headerText };
  }, [rows, isExplainResult, resolvedDbType, t]);

  const handleExportForAI = async () => {
    const requireMetadata = (result: { success: boolean; error?: string; rows?: unknown[] }, table: string) => {
      if (!result.success || !Array.isArray(result.rows)) throw new Error(result.error || t('tuning_metadata_unavailable', { table }));
    };
    try {
      const snapshot = props.explainSnapshot;
      if (isExplainResult && (!snapshot?.sql.trim() || !snapshot.rows.length)) {
        throw new Error(t('explain_context_unavailable'));
      }
      const analyzedRows = isExplainResult && snapshot ? snapshot.rows : [];
      const analyzedSql = isExplainResult && snapshot ? snapshot.sql : sqlText;
      const analyzedSchema = isExplainResult && snapshot ? snapshot.schema : props.selectedSchema;
      const isJa = i18n.language !== 'en';
      const isOracle = resolvedDbType === 'oracle';

      let planText = '';
      const tablesOracle = new Map<string, ObjectIdentity>();
      const tablesPg = new Map<string, ObjectIdentity>();

      if (isExplainResult && analyzedRows.length > 0) {
        if (isOracle) {
          planText = analyzedRows.map(r => r.PLAN_TABLE_OUTPUT || Object.values(r).find(v => typeof v === 'string')).join('\n');
          analyzedRows.forEach(row => {
            const table = oraclePlanTableIdentity(row);
            if (table) tablesOracle.set(JSON.stringify([table.schema, table.objectName]), table);
          });
        } else {
          const rawOutput = analyzedRows[0].PLAN_TABLE_OUTPUT;
          try {
            const parsed = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput;
            planText = JSON.stringify(parsed, null, 2);
            const planRoot = Array.isArray(parsed) ? parsed[0]?.Plan : parsed?.Plan;
            const extractTables = (node: PgPlanNode) => {
              if (node['Relation Name']) {
                 const s = node['Schema'] || analyzedSchema || 'public';
                 const identity = { schema: s, objectName: node['Relation Name'] };
                 tablesPg.set(JSON.stringify([identity.schema, identity.objectName]), identity);
              }
              if (node.Plans && Array.isArray(node.Plans)) node.Plans.forEach(extractTables);
            };
            if (planRoot) extractTables(planRoot);
          } catch {
            planText = analyzedRows.map(r => {
               const val = r.PLAN_TABLE_OUTPUT || Object.values(r).find(v => typeof v === 'string');
               return typeof val === 'object' ? JSON.stringify(val) : String(val);
            }).join('\n');
          }
        }
      } else {
        planText = t("no_execution_plan_found_enable_analyze_and_execute_sql");
      }

      let output = isJa ? 
        '【AI SQLチューニング依頼】\n' +
        '以下の情報を元に、パフォーマンス改善のためのSQLチューニングを行ってください。\n\n' +
        '==================================================\n' +
        '【前提事項と指示】\n' +
        '==================================================\n' +
        `- データベースは ${isOracle ? 'Oracle Database' : 'PostgreSQL'} です。${isOracle ? 'Oracle' : 'PostgreSQL'}の仕様や構文に基づいた改善案を提示してください。\n` +
        '- 実行計画を分析し、ボトルネックを特定してください。\n' +
        '- 改善策として、具体的な「SQLの書き換え案」と、効果的な「インデックス作成（CREATE INDEX）文」を提案してください。\n' +
        '- 回答と解説は日本語で出力してください。\n\n'
      : 
        '[AI SQL Tuning Request]\n' +
        'Please perform SQL tuning to improve performance based on the following information.\n\n' +
        '==================================================\n' +
        '[Prerequisites & Instructions]\n' +
        '==================================================\n' +
        `- The database is ${isOracle ? 'Oracle Database' : 'PostgreSQL'}. Please provide improvement suggestions based on ${isOracle ? 'Oracle' : 'PostgreSQL'} specifications and syntax.\n` +
        '- Analyze the execution plan to identify bottlenecks.\n' +
        '- As an improvement measure, specifically propose SQL rewrite ideas and effective index creation (CREATE INDEX) statements.\n' +
        '- Please provide your response and explanations in English.\n\n';

      output += 
        '==================================================\n' +
        (isJa ? '【1. データベース環境】\n' : '[1. Database Environment]\n') +
        '==================================================\n' +
        (dbInfo || (isJa ? '情報なし' : 'No Info')) + '\n' +
        (analyzedSchema ? t('tuning_execution_schema', { schema: analyzedSchema }) + '\n' : '') + '\n' +
        '==================================================\n' +
        (isJa ? '【2. 対象のSQL】\n' : '[2. Target SQL]\n') +
        '==================================================\n' +
        analyzedSql + '\n\n' +
        '==================================================\n' +
        (isJa ? '【3. 実行計画】\n' : '[3. Execution Plan]\n') +
        '==================================================\n' +
        planText + '\n\n' +
        '==================================================\n' +
        (isJa ? '【4. 関連テーブルの構造、統計情報、インデックス】\n' : '[4. Related Table Structures, Statistics, and Indexes]\n') +
        '==================================================\n';

      output += '\n[Execution evidence]\n' + JSON.stringify({
        planKind: snapshot?.planKind || 'estimated', planningDurationMs: snapshot?.planningDurationMs ?? null,
        observedExecution: snapshot?.observedExecution || null,
        binds: snapshot?.binds?.map(bind => ({ ...bind, value: includeBindValues ? bind.value : '[not shared]' })) || [],
        bindValuesShared: includeBindValues
      }) + '\nThis plan is estimated, not EXPLAIN ANALYZE. Planning duration is not SQL execution duration. observedExecution, when present, belongs to an earlier execution of the exact same prepared SQL, binds and schema; timings and data may have changed. No execution was performed to prepare this request. Preserve query results and transaction semantics; propose an index only when justified by evidence.\n';

      if (isOracle) {
        if (tablesOracle.size === 0) {
          output += isJa ? 'テーブル情報が抽出できませんでした。\n' : 'No table information extracted.\n';
        } else {
          for (const { schema: owner, objectName: tableName } of tablesOracle.values()) {
            output += `\n--- Table: ${owner}.${tableName} ---\n`;
            const binds = { owner, tableName };
            const ddlRes = await ipcRenderer.invoke('execute-sql-bg', "SELECT DBMS_METADATA.GET_DDL('TABLE', :tableName, :owner) AS DDL FROM DUAL", binds);
            requireMetadata(ddlRes, tableName);
            if (!ddlRes.rows?.length || typeof ddlRes.rows[0].DDL !== 'string' || !ddlRes.rows[0].DDL.trim()) throw new Error(t('tuning_metadata_unavailable', { table: tableName }));
            if (ddlRes.success && ddlRes.rows && ddlRes.rows.length > 0) {
              output += (isJa ? '[テーブルDDL]\n' : '[Table DDL]\n') + `${String(ddlRes.rows[0].DDL ?? '').trim()};\n\n`;
            }
            const statRes = await ipcRenderer.invoke('execute-sql-bg', `SELECT NUM_ROWS, BLOCKS, AVG_ROW_LEN, LAST_ANALYZED FROM ALL_TABLES WHERE OWNER = :owner AND TABLE_NAME = :tableName`, binds);
            requireMetadata(statRes, tableName);
            if (statRes.success && statRes.rows && statRes.rows.length > 0) {
              output += (isJa ? '[テーブル統計情報]\n' : '[Table Statistics]\n') + `NUM_ROWS: ${statRes.rows[0].NUM_ROWS}, BLOCKS: ${statRes.rows[0].BLOCKS}, AVG_ROW_LEN: ${statRes.rows[0].AVG_ROW_LEN}, LAST_ANALYZED: ${statRes.rows[0].LAST_ANALYZED ?? 'unknown'}\n\n`;
            }
            const colStatRes = await ipcRenderer.invoke<{ COLUMN_NAME: string; NUM_DISTINCT: number; NUM_NULLS: number; DENSITY: number }>('execute-sql-bg', `SELECT COLUMN_NAME, NUM_DISTINCT, NUM_NULLS, DENSITY FROM ALL_TAB_COLUMNS WHERE OWNER = :owner AND TABLE_NAME = :tableName ORDER BY COLUMN_ID`, binds);
            requireMetadata(colStatRes, tableName);
            if (colStatRes.success && colStatRes.rows && colStatRes.rows.length > 0) {
              output += (isJa ? '[カラム統計情報]\n' : '[Column Statistics]\n'); 
              colStatRes.rows.forEach((c: { COLUMN_NAME: string; NUM_DISTINCT: number; NUM_NULLS: number; DENSITY: number }) => {
                output += `- ${c.COLUMN_NAME}: NUM_DISTINCT=${c.NUM_DISTINCT}, NUM_NULLS=${c.NUM_NULLS}, DENSITY=${c.DENSITY}\n`; 
              }); 
              output += `\n`;
            }
            const idxRes = await ipcRenderer.invoke('execute-sql-bg', `SELECT OWNER, INDEX_NAME, INDEX_TYPE, BLEVEL, LEAF_BLOCKS, DISTINCT_KEYS FROM ALL_INDEXES WHERE TABLE_OWNER = :owner AND TABLE_NAME = :tableName`, binds);
            requireMetadata(idxRes, tableName);
            if (idxRes.success && idxRes.rows && idxRes.rows.length > 0) {
              output += (isJa ? '[インデックスと統計情報]\n' : '[Indexes and Statistics]\n');
              for (const idxRow of idxRes.rows) {
                 output += `- ${idxRow.INDEX_NAME} (${idxRow.INDEX_TYPE}): BLEVEL=${idxRow.BLEVEL}, LEAF_BLOCKS=${idxRow.LEAF_BLOCKS}, DISTINCT_KEYS=${idxRow.DISTINCT_KEYS}\n`;
                 const idxDdlRes = await ipcRenderer.invoke('execute-sql-bg', "SELECT DBMS_METADATA.GET_DDL('INDEX', :indexName, :owner) AS DDL FROM DUAL", { indexName: idxRow.INDEX_NAME, owner: idxRow.OWNER });
                 requireMetadata(idxDdlRes, tableName);
                 if (!idxDdlRes.rows?.length || typeof idxDdlRes.rows[0].DDL !== 'string' || !idxDdlRes.rows[0].DDL.trim()) throw new Error(t('tuning_metadata_unavailable', { table: tableName }));
                 output += `  DDL: ${idxDdlRes.rows[0].DDL.trim().replace(/\n/g, ' ')};\n`;
              }
              output += `\n`;
            } else { output += (isJa ? '[インデックス]: なし\n\n' : '[Indexes]: None\n\n'); }
          }
        }
      } else {
        if (tablesPg.size === 0) {
          output += isJa ? 'テーブル情報が抽出できませんでした。\n' : 'No table information extracted.\n';
        } else {
          for (const { schema: tableSchema, objectName: tableName } of tablesPg.values()) {
            output += `\n--- Table: ${tableSchema}.${tableName} ---\n`;
            const binds = { schema: tableSchema, tableName };
            const ddl = await getFullTableDDL(ipcRenderer, tableSchema, tableName, t, false);
            output += (isJa ? '【テーブルDDL】\n' : '[Table DDL]\n') + ddl + '\n';

            const statRes = await ipcRenderer.invoke('execute-sql-bg', `SELECT reltuples::bigint AS num_rows, relpages AS blocks,
              (SELECT last_analyze FROM pg_stat_all_tables s WHERE s.relid=c.oid) AS last_analyze,
              (SELECT last_autoanalyze FROM pg_stat_all_tables s WHERE s.relid=c.oid) AS last_autoanalyze
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = :schema AND c.relname = :tableName`, binds);
            requireMetadata(statRes, tableName);
            if (statRes.success && statRes.rows?.[0]) {
               output += (isJa ? '【テーブル統計情報】\n' : '[Table Statistics]\n') + `NUM_ROWS: ${statRes.rows[0].num_rows}, BLOCKS: ${statRes.rows[0].blocks}, LAST_ANALYZE: ${statRes.rows[0].last_analyze ?? 'unknown'}, LAST_AUTOANALYZE: ${statRes.rows[0].last_autoanalyze ?? 'unknown'}\n\n`;
            }

            const colStatRes = await ipcRenderer.invoke<{ attname: string; null_frac: string; n_distinct: string; correlation: string }>('execute-sql-bg', `SELECT attname, null_frac, n_distinct, correlation FROM pg_stats WHERE schemaname = :schema AND tablename = :tableName`, binds);
            requireMetadata(colStatRes, tableName);
            if (colStatRes.success && colStatRes.rows && colStatRes.rows.length > 0) {
               output += isJa ? '【カラム統計情報】\n' : '[Column Statistics]\n';
               colStatRes.rows.forEach((c: { attname: string; null_frac: string; n_distinct: string; correlation: string }) => {
                  output += `- ${c.attname}: NULL_FRAC=${c.null_frac}, N_DISTINCT=${c.n_distinct}, CORRELATION=${c.correlation}\n`;
               });
               output += '\n';
            }

            const idxRes = await ipcRenderer.invoke<{ indexname: string; indexdef: string }>('execute-sql-bg', `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = :schema AND tablename = :tableName`, binds);
            requireMetadata(idxRes, tableName);
            if (idxRes.success && idxRes.rows && idxRes.rows.length > 0) {
               output += isJa ? '【インデックスとDDL】\n' : '[Indexes and DDL]\n';
               idxRes.rows.forEach((idx: { indexname: string; indexdef: string }) => {
                  output += `- ${idx.indexname}\n  DDL: ${idx.indexdef}\n`;
               });
               output += '\n';
            } else {
               output += (isJa ? '【インデックス】: なし\n\n' : '[Indexes]: None\n\n');
            }
          }
        }
      }

      if (props.isAiEnabled && props.onOpenAiSidebar) {
        props.onOpenAiSidebar({
          targetTab: props.title,
          requestType: "sql_tuning",
          initialPrompt: output
        });
      } else {
        notify(t("ai_external_tuning_export_notice"));
        const saveRes = await ipcRenderer.invoke('show-save-dialog', { title: t("save_ai_tuning_info"), defaultPath: 'tuning_info.txt', filters: [{ name: t("text_file"), extensions: ['txt'] }] });
        if (!saveRes.canceled && saveRes.filePath) {
          const writeRes = await ipcRenderer.invoke('save-file', saveRes.filePath, output, 'utf8');
          if (writeRes.success) notify(t("ai_tuning_prompt_exported"), { severity: 'success' });
          else notify(t("save_error_3") + writeRes.error);
        }
      }
    } catch (err: unknown) { notify(t("export_error_2") + getErrorMessage(err)); }
  };

  return {
    includeBindValues, setIncludeBindValues,
    resolvedDbType,
    isTransposed, 
    setIsTransposed, 
    displayColumns, 
    displayRows, 
    historyColumns, 
    parsedExplain, 
    handleExportForAI
  };
};
