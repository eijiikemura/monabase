// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import CodeMirror from '@uiw/react-codemirror';
import { MySQL, sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';
import type { AiContext } from '@/shared/types/aiTypes';
import VersionControlTab from '@/features/git/VersionControlTab';
import { ViewMetadataTab } from '@/features/view/ViewMetadataTab';
import AiRequestButton from '@/features/ai/AiRequestButton';
import WorkspaceDivider from '@/components/navigation/WorkspaceDivider';
import TableDataTab from '../table/TableDataTab';
import { useMysqlTable } from '../table/useMysqlTable';
import { createMysqlSidebarExport, prepareMysqlTransfer } from '../sidebarDataTransfer';
import { useMysqlEditorAi } from '../useMysqlEditorAi';
import { useMysqlView, type MysqlViewProps } from './useMysqlView';

const extensions = [sql({ dialect: MySQL })];
function ViewDataPane({ props }: { props: MysqlViewProps }) {
  const { t } = useTranslation();
  const dataProps = { ...props, schema: props.object.schema, table: props.object.name, readonly: true };
  const c = useMysqlTable(dataProps, props.active);
  const fetch = useMemo(() => {
    if (!c.metadata) return undefined;
    // The export formatter is initialized on demand; metadata and applied filters are fixed for this export.
    const metadata = c.metadata, conditions = c.applied;
    let snapshot: Promise<ReturnType<typeof createMysqlSidebarExport>> | undefined;
    const exporter: ReturnType<typeof createMysqlSidebarExport> = async (offset, limit) => {
      if (!snapshot) snapshot = (async () => {
        const prepared = await prepareMysqlTransfer(props.object.schema, props.object.name, props.settings.outputDateFormat);
        if (JSON.stringify(prepared.metadata.columns) !== JSON.stringify(metadata.columns)) throw new Error(t('mysql_view_changed_reload'));
        return createMysqlSidebarExport(props.object.schema, props.object.name, metadata, prepared.formatRows, props.onState, props.setBusy, conditions);
      })();
      return (await snapshot)(offset, limit);
    };
    exporter.close = async () => { const current = await snapshot; await current?.close?.(); snapshot = undefined; };
    return exporter;
  }, [c.metadata, c.applied, props.object.schema, props.object.name, props.settings.outputDateFormat, props.onState, props.setBusy, t]);
  return <Box data-testid="mysql-view-data" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
    {c.error && <Alert severity="error" action={<Button disabled={props.busy || props.disabled} onClick={() => void c.refresh()}>{t('retry')}</Button>}>{c.error}</Alert>}
    <TableDataTab view controller={c} props={dataProps} fetchDataChunk={fetch} />
  </Box>;
}
export default function ViewWindow(props: MysqlViewProps & { aiEnabled: boolean; onOpenAi: (context: AiContext) => void }) {
  const { t } = useTranslation(), c = useMysqlView(props);
  const [tab, setTab] = useState(0), [confirm, setConfirm] = useState(''), [consoleOpen, setConsoleOpen] = useState(false), [consoleWidth, setConsoleWidth] = useState(350), [resizing, setResizing] = useState(false);
  const ai = useMysqlEditorAi({ text: c.text, setText: c.setText, active: props.active && tab === 1 && !props.busy && !props.readonly && !props.disabled && !c.loading && !c.review,
    schema: props.object.schema, tabId: props.tabId, object: props.object, onOpenAi: props.onOpenAi });
  useEffect(() => { if (props.request) { setTab(1); setConfirm(''); } }, [props.request]);
  useEffect(() => { if (c.logs.length) setConsoleOpen(true); }, [c.logs.length]);
  const editorLocked = props.busy || props.readonly || props.disabled || c.loading || ai.isGenerating;
  return <Box data-testid="mysql-view-window" sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
    <Tabs value={tab} onChange={(_event, value: number) => setTab(value)} variant="scrollable" sx={{ minHeight: 40, px: 2, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      {['data', 'edit', 'version_control', 'view_information'].map((key,i) => <Tab key={key} label={i === 1 && c.text !== c.saved ? '* ' + t(key) : t(key)} sx={{ minHeight: 40, py: 0 }} />)}
    </Tabs>
    {c.error && <Alert severity="error" action={<Button disabled={props.busy || c.loading} onClick={() => void c.load()}>{t('retry')}</Button>}>{c.error}</Alert>}
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
        <Box sx={{ display: tab === 0 ? 'flex' : 'none', flex: 1, minHeight: 0 }}><ViewDataPane key={c.dataRevision} props={{ ...props, active: props.active && tab === 0 }} /></Box>
        {tab === 1 && <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minHeight: 0 }}>
          <Paper sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}><Typography variant="subtitle1" sx={{ mr: 'auto', fontWeight: 'bold' }}>{t('edit_view')} · {props.object.schema}.{props.object.name}</Typography>
            <Tooltip title={t('fetch_latest_source')}><span><Button variant="outlined" size="small" startIcon={<RefreshIcon />} disabled={props.busy || c.loading || ai.isGenerating} onClick={() => void c.load()}>{t('refresh')}</Button></span></Tooltip>
            <Tooltip title={t('delete')}><span><Button variant="outlined" size="small" color="error" startIcon={<DeleteOutlineIcon />} disabled={c.locked || ai.isGenerating || Boolean(c.details?.metadata.dependents.length)} onClick={() => { setConfirm(''); c.prepare(true); }}>{t('delete')}</Button></span></Tooltip>
            <Tooltip title={t('compile_save')}><span><Button variant="contained" size="small" color="success" startIcon={<PlayArrowIcon />} disabled={c.locked || ai.isGenerating || !c.text.trim()} onClick={() => c.prepare()}>{t('compile_save')}</Button></span></Tooltip>
            {props.aiEnabled && <Tooltip title={t('ask_ai_to_create_or_modify_sql')}><span><AiRequestButton disabled={editorLocked || !c.details} onClick={ai.open} /></span></Tooltip>}
            <Button size="small" onClick={() => setConsoleOpen(value => !value)}>{t('console')}</Button>
          </Paper>
          <Typography variant="caption">{t('mysql_view_editor_help')}</Typography>
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}><CodeMirror value={ai.displaySql} onChange={c.setText} readOnly={editorLocked} editable={!editorLocked} extensions={extensions} height="100%" style={{ position: 'absolute', inset: 0 }} theme={props.settings.theme === 'dark' ? 'dark' : 'light'} /></Box>
        </Box>}
        {tab === 2 && <VersionControlTab isActive={props.active} dbType="MYSQL" schema={props.object.schema} objectType="VIEW" objectName={props.object.name} currentSource={c.details?.native || ''} isSourceLoading={c.loading || !c.details} onRefresh={() => void c.load()} />}
        {tab === 3 && <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'auto' }}>
          {c.details && <Paper sx={{ p: 2 }}><Typography variant="subtitle2">{t('mysql_view_settings')}</Typography>{Object.entries(c.details.settings).map(([key,value]) => <Typography key={key} variant="body2">{key}: {String(value)}</Typography>)}<Typography variant="caption">{t('mysql_view_readonly_data')}</Typography></Paper>}
          <ViewMetadataTab data={c.details?.metadata || null} error="" loading={c.loading || props.busy} onRefresh={() => void c.load()} />
        </Box>}
      </Box>
      {tab === 1 && consoleOpen && <><WorkspaceDivider label={t('console')} value={consoleWidth} min={220} max={window.innerWidth / 2} reverse onChange={setConsoleWidth} onMouseDown={event => { event.preventDefault(); setResizing(true); }} /><Paper square sx={{ width: consoleWidth, display: 'flex', flexDirection: 'column', flexShrink: 0, minHeight: 0 }}><Box sx={{ display: 'flex', p: 1, justifyContent: 'space-between' }}><Typography>{t('console')}</Typography><Tooltip title={t('clear_log')}><IconButton size="small" aria-label={t('clear_log')} onClick={c.clearLogs}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip></Box><Box sx={{ overflow: 'auto', p: 1 }}>{c.logs.map((log,i) => <Box key={i} sx={{ mb: 2 }}><Typography variant="caption">{log.message}</Typography><Typography component="pre" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{log.sql}</Typography></Box>)}</Box></Paper></>}
    </Box>
    {resizing && <Box onMouseMove={event => setConsoleWidth(Math.max(220,Math.min(window.innerWidth / 2,window.innerWidth - event.clientX)))} onMouseUp={() => setResizing(false)} onMouseLeave={() => setResizing(false)} sx={{ position: 'fixed', inset: 0, zIndex: 1500, cursor: 'col-resize' }} />}
    <Dialog open={Boolean(c.review)} fullWidth maxWidth="md" onClose={c.closeReview}><DialogTitle>{t(c.review?.drop ? 'delete' : 'compile_save')}</DialogTitle><DialogContent><Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert><Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', my: 2 }}>{c.review?.sql}</Typography>{c.review?.drop && <TextField size="small" fullWidth label={t('mysql_view_name')} value={confirm} helperText={t('mysql_view_confirm_name')} disabled={props.busy || c.attempted} onChange={event => setConfirm(event.target.value)} />}{c.error && <Alert severity="error">{c.error}</Alert>}{c.attempted && <Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}</DialogContent><DialogActions><Button disabled={props.busy} onClick={c.closeReview}>{t('close')}</Button><Button variant="contained" disabled={c.locked || c.attempted || Boolean(c.review?.drop && confirm !== props.object.name)} onClick={() => void c.execute()}>{t('execute')}</Button></DialogActions></Dialog>
  </Box>;
}
