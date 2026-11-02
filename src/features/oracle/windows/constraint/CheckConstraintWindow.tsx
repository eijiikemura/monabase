// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { quoteIdentifier, escapeSqlString } from '@/shared/utils/objectIdentity';
import { splitSqlScript } from '@/features/sql/sqlScript';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useMemo } from 'react';
import { 
  Box, Paper, Typography, Button, Checkbox, FormControlLabel,
  TextField, Tabs, Tab,
  Divider, IconButton, Tooltip, Alert
} from '@mui/material';
import { useTheme } from '@mui/material/styles'; // Import theme access helpers.

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';

import { plsqlDialect, oracleBuiltinCompletions, oracleFunctionHighlighting } from '../common/plsqlDialect';
import { CompletionContext } from '@codemirror/autocomplete';
import { useDbCompletions } from "@/features/sql/hooks/useDbCompletions";
import { useTranslation } from 'react-i18next'; 

// Extend the source editor to the bottom of its available area.
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

import { ipcRenderer } from '@/shared/api/desktop';

interface CheckConstraintWindowProps {
  tabId: number;
  schema: string;
  tableName: string; // Originating table name.
  constraintName?: string;
  isNew: boolean;
  isActive: boolean;
}

interface LogEntry {
  time: string;
  sql: string;
  resultMsg: string;
  errorLines?: string[];
}

export default function CheckConstraintWindow({ tabId, schema, tableName, constraintName, isNew, isActive }: CheckConstraintWindowProps) {
  const { t } = useTranslation(); 
  const theme = useTheme(); // Get the current theme.

  const [activeTab, setActiveTab] = useState<number>(0);
  const [, setIsLoading] = useState<boolean>(false);
  const [isFetched, setIsFetched] = useState<boolean>(false);
  
  const [, setLogs] = useState<LogEntry[]>([]);

  const [formData, setFormData] = useState({
    constraintName: constraintName || '',
    searchCondition: '',
    isEnabled: true
  });

  const [initialState, setInitialState] = useState({
    isEnabled: true
  });

  const { dbCompletions, dbSchema } = useDbCompletions();
  const [tableColumns, setTableColumns] = useState<string[]>([]);

  useEffect(() => {
    if (isNew) setActiveTab(0);
  }, [isNew]);

  useEffect(() => {
    if (!isActive || !schema || !tableName) return;
    const fetchColumns = async () => {
      try {
        const res = await ipcRenderer.invoke('get-columns', schema, tableName);
        if (res.success && res.columns) {
          setTableColumns(res.columns);
        }
      } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    };
    fetchColumns();
  }, [isActive, schema, tableName]);

  useEffect(() => {
    const fetchConstraint = async () => {
      if (isNew || isFetched || !constraintName) return;
      setIsLoading(true);
      try {
        const query = `
          SELECT STATUS, SEARCH_CONDITION 
          FROM ALL_CONSTRAINTS 
          WHERE OWNER = '${escapeSqlString(schema)}' AND CONSTRAINT_NAME = '${escapeSqlString(constraintName || '')}'
        `;
        const res = await ipcRenderer.invoke('execute-sql', query);
        if (res.success && res.rows && res.rows.length > 0) {
          const row = res.rows[0];
          
          setFormData({
            constraintName: constraintName,
            searchCondition: String(row.SEARCH_CONDITION || ''),
            isEnabled: row.STATUS === 'ENABLED'
          });
          setInitialState({
            isEnabled: row.STATUS === 'ENABLED'
          });
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
        setIsFetched(true);
      }
    };
    if (isActive) fetchConstraint();
  }, [isActive, isNew, constraintName, schema, isFetched]);

  const handleDelete = async () => {
    if (window.confirm(t("delete_check_constraint_this_operation_cannot_be_undone", { name: constraintName }))) {
      setIsLoading(true);
      try {
        const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : quoteIdentifier(tableName);
        const sqlText = `ALTER TABLE ${targetTable} DROP CONSTRAINT ${quoteIdentifier(constraintName || '')}`;
        const res = await ipcRenderer.invoke('execute-sql', sqlText);
        if (res.success) {
          alert(t("check_constraint_dropped"));
          window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TABLE' } }));
          window.dispatchEvent(new CustomEvent('refresh-table-structure', { detail: { schema, tableName } }));
          window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId } }));
        } else {
          alert(t("delete_error_4", { error: res.error }));
        }
      } catch (e: unknown) {
        alert(t("delete_error_4", { error: getErrorMessage(e) }));
      } finally {
        setIsLoading(false);
      }
    }
  };

  const createSql = useMemo(() => {
    const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : quoteIdentifier(tableName);
    const safeName = formData.constraintName ? ` CONSTRAINT ${quoteIdentifier(formData.constraintName)}` : '';
    const condition = formData.searchCondition || 'condition_expression';
    const enableState = formData.isEnabled ? 'ENABLE' : 'DISABLE';
    
    return `ALTER TABLE ${targetTable} ADD${safeName} CHECK (${condition}) ${enableState};`;
  }, [formData, schema, tableName]);

  const alterSql = useMemo(() => {
    const targetTable = schema ? `${quoteIdentifier(schema)}.${quoteIdentifier(tableName)}` : quoteIdentifier(tableName);
    const oldName = constraintName || 'OLD_CONSTRAINT';
    const newName = formData.constraintName || 'NEW_CONSTRAINT';
    
    const statements = [];

    if (formData.isEnabled !== initialState.isEnabled) {
      statements.push(`ALTER TABLE ${targetTable} ${formData.isEnabled ? 'ENABLE' : 'DISABLE'} CONSTRAINT ${quoteIdentifier(oldName)}`);
    }

    if (newName !== oldName) {
      statements.push(`ALTER TABLE ${targetTable} RENAME CONSTRAINT ${quoteIdentifier(oldName)} TO ${quoteIdentifier(newName)}`);
    }

    if (statements.length > 0) {
      return statements.join(';\n') + ';';
    }

    return t("oracle_constraint_unchanged_hint");
  }, [formData, initialState, constraintName, schema, tableName, t]);

  const handleExecute = async () => {
    if (isNew && !formData.constraintName.trim()) { 
      alert(t("please_enter_constraint_name_auto_generation_not_supported"));
      return; 
    }
    if (isNew && !formData.searchCondition.trim()) { 
      alert(t("please_enter_the_check_condition_expression"));
      return; 
    }

    setIsLoading(true);
    const timestamp = new Date().toLocaleString('ja-JP');
    const executionSql = isNew ? createSql : alterSql;

    if (!isNew && alterSql.includes(t("no_changes"))) {
      alert(t("no_changes_found"));
      setIsLoading(false);
      return;
    }

    try {
      const statements = splitSqlScript(executionSql, 'oracle').map(statement => statement.text);
      if (!statements.length) { alert(t('no_changes_found')); return; }
      let hasError = false;

      for (const stmt of statements) {
        const res = await ipcRenderer.invoke('execute-sql', stmt);
        if (res.success) {
          setLogs(prev => [{ time: timestamp, sql: stmt, resultMsg: t("success") }, ...prev]);
        } else {
          setLogs(prev => [{ time: timestamp, sql: stmt, resultMsg: t("error_occurred"), errorLines: [res.error] }, ...prev]);
          alert(t("an_error_occurred_2", { error: res.error }));
          hasError = true;
          break; 
        }
      }

      if (!hasError) {
        window.dispatchEvent(new CustomEvent('refresh-sidebar', { detail: { schema: schema, objType: 'TABLE' } }));
        window.dispatchEvent(new CustomEvent('refresh-table-structure', { detail: { schema, tableName } }));

        if (isNew || formData.constraintName !== constraintName) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('constraint-created', {
              detail: { tabId: tabId, schema: schema, tableName: tableName, constraintName: formData.constraintName }
            }));
          }, 50);
          setTimeout(() => alert(t("check_constraint_3", { name: formData.constraintName, action: isNew ? t("create") : t("change") })), 150);
        } else {
          setInitialState({ isEnabled: formData.isEnabled });
          setTimeout(() => alert(t("updated_check_constraint", { name: formData.constraintName })), 150);
        }
      }

    } catch {
      alert(t("connection_error_occurred_2"));
    } finally {
      setIsLoading(false);
    }
  };

  const editorExtensions = useMemo(() => {
    const colCompletions = tableColumns.map(col => ({
      label: col,
      type: 'property'
    }));

    return [
      sql({ dialect: plsqlDialect, upperCaseKeywords: true, schema: dbSchema }),
      oracleFunctionHighlighting, 
      plsqlDialect.language.data.of({
        autocomplete: (context: CompletionContext) => {
          const word = context.matchBefore(/\w*/);
          const dotBefore = context.matchBefore(/\.\w*/);
          if (dotBefore) return null;
          if (!word || (word.from === word.to && !context.explicit)) return null;
          return {
            from: word.from,
            options: [...dbCompletions, ...oracleBuiltinCompletions, ...colCompletions]
          };
        }
      })
    ];
  }, [dbCompletions, dbSchema, tableColumns]);

  return (
    <Box sx={{ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: 'background.default', overflow: 'hidden' }}>
      {!isNew && (
        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2 }}>
          <Tabs value={activeTab} onChange={(_e, val) => setActiveTab(val)} sx={{ minHeight: 40 }}>
            <Tab label={t("edit")} sx={{ minHeight: 40, py: 0 }} />
            <Tab label={t("source")} sx={{ minHeight: 40, py: 0 }} />
          </Tabs>
        </Box>
      )}

      <Box sx={{ minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        <Box sx={{ flexGrow: 1, display: (isNew || activeTab === 0) ? 'flex' : 'none', p: 3, overflowY: 'auto', alignItems: 'flex-start', flexDirection: 'column' }}>
          <Paper elevation={1} sx={{ p: 3, maxWidth: 800, width: '100%', mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" fontWeight="bold">
                {isNew ? t("create_check_constraint_check") : t("edit_check_constraint", { name: constraintName })}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                {!isNew && (
                  <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} sx={{ mr: 2 }} disableElevation>
                    {t("delete")}
                  </Button>
                )}
                <Button variant="contained" color="success" startIcon={<PlayArrowIcon />} onClick={handleExecute} disableElevation>
                  {isNew ? t("create") : t("change")}
                </Button>
              </Box>
            </Box>
            <Divider />
            
            {!isNew && (
              <Alert severity="info" sx={{ py: 0 }}>
                {t("oracle_constraint_edit_limitations")}
              </Alert>
            )}

            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField label={t("schema")} size="small" sx={{ width: 200 }} value={schema} disabled />
              <TextField label={t("target_table")} size="small" sx={{ flexGrow: 1 }} value={tableName} disabled />
            </Box>

            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <TextField 
                label={t("constraint_name_required")}
                size="small" 
                sx={{ width: 350 }} 
                value={formData.constraintName} 
                onChange={(e) => setFormData({...formData, constraintName: e.target.value.toUpperCase()})} 
                required
              />
              <FormControlLabel 
                control={<Checkbox checked={formData.isEnabled} onChange={(e) => setFormData({...formData, isEnabled: e.target.checked})} color="primary" />} 
                label={t("enable")}
                sx={{ ml: 1 }} 
              />
            </Box>

            <Box sx={{ mt: 1 }}>
              <Typography variant="caption" fontWeight="bold" sx={{ mb: 0.5, display: 'block', color: 'text.primary' }}>
                {t("check_condition_e_g_salary_0_and_status_in_a_b")}
              </Typography>
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', height: 250 }}>
                {/* Apply the CodeMirror theme option. */}
                <CodeMirror 
                  value={formData.searchCondition} 
                  onChange={(val) => setFormData({...formData, searchCondition: val})} 
                  extensions={editorExtensions} 
                  basicSetup={{ lineNumbers: true, autocompletion: true }} 
                  readOnly={!isNew}
                  height="100%"
                  theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                />
              </Box>
            </Box>

          </Paper>

          {!isNew && (
            <Paper elevation={1} sx={{ mt: 3, maxWidth: 800, width: '100%', mx: 'auto', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" fontWeight="bold">{t("alter_table_statement_ddl")}</Typography>
                <Tooltip title={t("copy")}>
                  <IconButton size="small" onClick={() => navigator.clipboard.writeText(alterSql)}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ flexGrow: 1, overflow: 'auto', '& .cm-editor': { minHeight: '60px', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } }}>
                {/* Apply the CodeMirror theme option. */}
                <CodeMirror 
                  value={alterSql} 
                  extensions={editorExtensions} 
                  readOnly={true} 
                  basicSetup={{ lineNumbers: true }} 
                  theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                />
              </Box>
            </Paper>
          )}
        </Box>

        {!isNew && (
          <Box sx={{ minHeight: 0, minWidth: 0, flexGrow: 1, display: activeTab === 1 ? 'flex' : 'none', flexDirection: 'column', p: 1 }}>
            <Paper elevation={1} sx={{ minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" fontWeight="bold">DDL</Typography>
                <Tooltip title={t("copy")}>
                  <IconButton size="small" onClick={() => navigator.clipboard.writeText(createSql)}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
              <Box sx={{ flex: '1 1 0', minHeight: 0, minWidth: 0, position: 'relative', overflow: 'hidden', '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } }}>
                {/* Apply the CodeMirror theme option. */}
                <CodeMirror 
                  value={createSql} 
                  height="100%" 
                  style={SOURCE_HOST_STYLE}
                  extensions={editorExtensions} 
                  readOnly={true} 
                  basicSetup={{ lineNumbers: true }} 
                  theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                />
              </Box>
            </Paper>
          </Box>
        )}

      </Box>
    </Box>
  );
}
