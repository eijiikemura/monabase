// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Drawer, Checkbox, FormControlLabel, IconButton, Paper, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CloseIcon from '@mui/icons-material/Close';
import DataObjectIcon from '@mui/icons-material/DataObject';
import SqlEditorToolbar from '@/features/sql/SqlEditorToolbar';
import type { AiContext } from '@/shared/types/aiTypes';
import AiRequestButton from '@/features/ai/AiRequestButton';
import { useMysqlEditorAi } from './useMysqlEditorAi';
import SqlBindPanel from './SqlBindPanel';
import {mysqlBindingNames,mysqlBindingValues,mysqlBindingSql,type MysqlBinding} from './sqlBindings';
import SqlFileActions from '@/features/sql/SqlFileActions';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import {EditorView} from '@codemirror/view';
import {useMysqlEditorExtensions} from './useMysqlEditorExtensions';
import { format } from 'sql-formatter';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { AppSettings } from '@/shared/types/appTypes';
import SqlWindowBottom from '@/features/sql/SqlWindowBottom';
import { SqlPaneControls, useSqlPaneLayout } from '@/features/sql/SqlPaneLayout';
import SqlPrivacyToggle from '@/features/sql/SqlPrivacyToggle';
import { useSqlExecution } from './useSqlExecution';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { buildGridColumns } from '@/features/data-grid/dataGridHelper';

interface Props {
  dbInfo?: string;
  tabId: number;
  initialSql?: string;
  aiEnabled: boolean;
  onOpenAi: (context: AiContext) => void;
  active: boolean;
  database: string;
  settings: AppSettings;
  busy: boolean;
  disabled: boolean;
  setBusy: (value: boolean) => void;
  onState: (state: TransactionState) => void;
}
export default function SqlWindow({ dbInfo, initialSql, tabId, aiEnabled, onOpenAi, active, database, settings, busy, disabled, setBusy, onState }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialSql ?? 'SELECT CURRENT_TIMESTAMP;');
  const schema = database;
  const [bindings,setBindings]=useState<Record<string,MysqlBinding>>({});
  const names=useMemo(()=>mysqlBindingNames(text),[text]);
  const prepareBinds=(source=text)=>mysqlBindingValues(mysqlBindingNames(source),bindings,settings.inputDateFormat||'YYYY-MM-DD HH:mm:ss');
  const [bindOpen, setBindOpen] = useState(false);
  const ai = useMysqlEditorAi({ text, setText, active, schema, tabId, onOpenAi });
  const editor = useRef<ReactCodeMirrorRef>(null);
  const execution = useSqlExecution({ text, prepareBinds, prepareSql:source=>mysqlBindingSql(source,bindings), schema, editor, settings, busy: busy || ai.isGenerating, disabled, setBusy, onState });
  const { error, setError } = execution;
  const panes = useSqlPaneLayout(active);
  const paneControls = <SqlPaneControls mode={panes.mode} onChange={panes.changeMode} />;
  const columns = useMemo(() => buildGridColumns(execution.metadata, settings.outputDateFormat, {}, { preserveDetails: false }), [execution.metadata, settings.outputDateFormat]);
  const extensions=useMysqlEditorExtensions(execution.editorError);
  const jumpToError=(lineText:string)=>{const issue=execution.editorError,view=editor.current?.view;if(!issue||!view||view.state.doc.toString()!==issue.source||lineText!==`[ERROR] Line ${issue.line}: ${issue.message}`||issue.line>view.state.doc.lines)return;const pos=view.state.doc.line(issue.line).from;view.dispatch({selection:{anchor:pos},effects:EditorView.scrollIntoView(pos,{y:'center'})});view.focus();};
  const execute = useEventCallback(execution.execute);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.altKey || document.querySelector('[role="dialog"]')) return;
      if (event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter')) { event.preventDefault(); void execute(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, execute]);
  const fileAction = async (save: boolean) => {
    setError('');
    try {
      if (save) {
        const response = await ipcRenderer.invoke('show-save-dialog', { defaultPath: 'query.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] });
        if (response.canceled || !response.filePath) return;
        const saved = await ipcRenderer.invoke('save-file', response.filePath, text, 'utf8');
        if (!saved.success) throw new Error(saved.error);
      } else {
        const response = await ipcRenderer.invoke('open-sql-file');
        if (!response.success) throw new Error(response.error);
        if (!response.canceled && response.sql !== undefined) setText(response.sql);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
  };
  const formatSql = () => {
    try { setText(format(text, { language: 'mysql' })); setError(''); }
    catch { setError(t('mysql_format_failed')); }
  };
  return <Box data-testid="mysql-sql-window" ref={panes.rootRef} sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1, p: 1 }}>
    <Paper data-split-upper elevation={1} sx={{ display: panes.mode === 'result' ? 'none' : 'flex', height: panes.mode === 'editor' ? undefined : panes.height, flex: panes.mode === 'editor' ? 1 : undefined, flexShrink: 0, minHeight: 80, p: 2, flexDirection: 'column', gap: 1, bgcolor: 'background.paper' }}>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <CodeMirror ref={editor} value={ai.displaySql} height="100%" style={{ position: 'absolute', inset: 0 }} theme={settings.theme === 'dark' ? 'dark' : 'light'} extensions={extensions} editable={!busy && !ai.isGenerating} onChange={setText} aria-label={t('sql_editor')} />
      </Box>
      <SqlEditorToolbar primary={<>
        <Tooltip title={execution.isExplainMode ? t('analyze_the_sql_execution_plan_f5') : t('execute_sql_or_only_the_selected_text_if_a_selection_exists_f5')}><Box component="span" sx={{ display: 'inline-flex' }}><IconButton aria-label={execution.isExplainMode ? t('analyze_sql_execution_plan') : t('execute_sql')} disabled={busy || disabled || ai.isGenerating} onClick={() => void execute()} size="small" sx={{ bgcolor: 'success.main', color: 'white', '&:hover': { bgcolor: 'success.dark' }, borderRadius: 1 }}>{busy ? <CircularProgress size={20} /> : <PlayArrowIcon />}</IconButton></Box></Tooltip>
        <Tooltip title={t('mysql_bind_form_help')}><span><Button size="small" disabled={busy} startIcon={<DataObjectIcon />} aria-expanded={bindOpen} onClick={() => setBindOpen(true)}>{t('sql_bind_count',{count:names.length})}</Button></span></Tooltip>
      </>}>
        <Tooltip title={t('when_checked_the_execute_button_analyzes_the_sql_execution_plan')}><FormControlLabel sx={{ m: 0, whiteSpace: 'nowrap' }} control={<Checkbox size="small" disabled={busy || ai.isGenerating} checked={execution.isExplainMode} onChange={event => execution.setIsExplainMode(event.target.checked)} />} label={t('parse')} /></Tooltip>
        {paneControls}
        <SqlPrivacyToggle active={execution.privateExecution} onChange={execution.setPrivateExecution} disabled={busy || ai.isGenerating} />
        {aiEnabled && <Tooltip title={t('ask_ai_to_create_or_modify_sql')}><span><AiRequestButton disabled={busy || ai.isGenerating} onClick={ai.open} /></span></Tooltip>}
        <SqlFileActions disabled={busy || ai.isGenerating} onOpen={() => void fileAction(false)} onSaveAs={() => void fileAction(true)} />
        <Tooltip title={t('format_sql_line_breaks_and_indentation_and_uppercase_keywords')}><Box component="span" sx={{ display: 'inline-flex' }}><IconButton size="small" color="info" aria-label={t('format_sql')} disabled={busy} onClick={formatSql} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}><AutoFixHighIcon /></IconButton></Box></Tooltip>
        <Tooltip title={t('stop')}><Box component="span" sx={{ display: 'inline-flex' }}><IconButton size="small" aria-label={t('stop')} disabled={!busy || !execution.executing} onClick={() => { void execution.cancel().catch(() => setError(t('execution_failed'))); }} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}><StopIcon /></IconButton></Box></Tooltip>
      </SqlEditorToolbar>
    </Paper>
    <Drawer anchor="right" open={bindOpen} onClose={() => setBindOpen(false)}>
      <Box sx={{ width: 'min(350px, 90vw)', height: '100%', bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', p: 1, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}><Typography variant="subtitle2" sx={{ flex: 1 }}>{t('bind_variables')}</Typography><IconButton size="small" aria-label={t('close')} onClick={() => setBindOpen(false)}><CloseIcon /></IconButton></Box>
        <SqlBindPanel names={names} bindings={bindings} onChange={(name,value)=>setBindings(old=>({...old,[name]:value}))} disabled={busy||ai.isGenerating} inputFormat={settings.inputDateFormat||'YYYY-MM-DD HH:mm:ss'}/>
      </Box>
    </Drawer>
    {error && <Alert severity="error" role="alert">{error}</Alert>}
    {execution.notices.map((notice, index) => <Alert key={index} severity="warning">{notice}</Alert>)}
    {panes.mode === 'split' && <Box {...panes.separatorProps} data-resizing={panes.isResizing} aria-label={t('sql_resize_panes')} title={t('sql_resize_panes_help')} sx={{ height: 8, cursor: 'row-resize', flexShrink: 0, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: panes.isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}><Box sx={{ width: 40, height: 2, borderRadius: 1, bgcolor: panes.isResizing ? 'background.paper' : 'text.secondary' }} /></Box>}
    <Box data-split-lower sx={{ flex: 1, minHeight: 0, display: panes.mode === 'editor' ? 'none' : 'flex' }}>
      <SqlWindowBottom isVisible={active && panes.mode !== 'editor'} layoutActions={paneControls}
        rows={execution.rows} columns={columns} resultSummary={execution.resultSummary} isExplainResult={execution.isExplainResult} explainSnapshot={execution.explainSnapshot}
        bottomTab={execution.bottomTab} setBottomTab={execution.setBottomTab} logs={execution.logs} historyLogs={execution.historyLogs} historyLimit={settings.sqlHistoryLimit}
        handleClearLogs={() => execution.setLogs([])} handleClearHistory={() => { if (window.confirm(t('clear_all_execution_history'))) void execution.clearHistory(); }}
        handleConsoleClick={jumpToError} setSqlText={setText} dateFormat={settings.outputDateFormat} sqlText={text} selectedSchema={schema} dbInfo={dbInfo} dbType="mysql" title={`SQL ${tabId}`} isAiEnabled={aiEnabled} onOpenAiSidebar={context => { if (context) onOpenAi(context); }} />
    </Box>
  </Box>;
}
