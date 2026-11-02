// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { memo, type ComponentType } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, IconButton, MenuItem, Paper, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import CodeMirror from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';
import VersionControlTab from '@/features/git/VersionControlTab';
import { WindowLoadingIndicator } from '@/components/feedback/WindowLoadingIndicator';
interface MviewDataProps { schema: string; viewName: string; revision?: number; isActive: boolean; inputDateFormat?: string; dateFormat?: string; }
import type { useMviewWindow, MviewWindowProps } from '@/features/materialized-view/useMviewWindow';
import type { MviewForm } from '@/features/materialized-view/mviewSql';
const MemoCodeMirror = memo(CodeMirror), MemoVersionControl = memo(VersionControlTab);
const setup = { lineNumbers: true };
export function MviewWindowPanel({ database, state: h, props, DataTab }: {
  database: 'oracle' | 'postgresql'; state: ReturnType<typeof useMviewWindow> & { extensions: Extension[] }; props: MviewWindowProps; DataTab: ComponentType<MviewDataProps>;
}) {
  const { t } = useTranslation(), theme = useTheme();
  if (!props.isActive) return null;
  const blocked = h.isLoading || !h.ready || h.gitPending || h.refreshPending;
  const field = (key: keyof MviewForm, value: string | boolean) => h.setFormData(previous => ({ ...previous, [key]: value }));
  const selection = (key: 'refreshMethod' | 'refreshTiming', label: string, values: string[]) => <TextField select label={label} size="small" value={h.formData[key]} disabled={blocked || !props.isNew && key === 'refreshTiming' && h.formData.refreshTiming === 'ON STATEMENT'}
    onChange={event => field(key, event.target.value)}>{[...new Set([...values, h.formData[key]])].map(value => <MenuItem key={value} value={value} disabled={value === 'ON STATEMENT' && (!props.isNew || !h.advancedSupported)}>{value}</MenuItem>)}</TextField>;
  return <Box data-testid="mview-window" aria-busy={h.isLoading} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
    {h.isLoading && <WindowLoadingIndicator />}
    {!props.isNew && <Tabs value={h.activeTab} onChange={(_, value: number) => h.setActiveTab(value)}><Tab label={t('data')} /><Tab label={t('details_actions')} /><Tab label={t('version_control')} /><Tab label={t('view_information')} /></Tabs>}
    {h.loadError && <Alert severity="error" action={<Button disabled={h.isLoading} onClick={() => void h.loadSource()}>{t('retry')}</Button>}>{h.loadError}</Alert>}
    {h.refreshPending && <Alert severity="info">{t('mview_refresh_pending')}</Alert>}
    {h.error && <Alert severity="error">{h.error}</Alert>}
    {h.gitPending && <Alert severity="warning" action={<Button disabled={h.isLoading} onClick={() => void h.retryGit()}>{t('mview_retry_git')}</Button>}>{t('mview_git_pending')}</Alert>}
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
        {!props.isNew && <Box sx={{ display: 'flex', gap: 1, p: 1, flexShrink: 0 }}>
          <Tooltip title={t('mview_reload_help')}><span><Button variant="outlined" startIcon={<RefreshIcon />} disabled={h.isLoading || h.gitPending || h.refreshPending} onClick={() => void h.loadSource()}>{t('refresh')}</Button></span></Tooltip>
          <Button disabled={h.isLoading || h.gitPending || h.refreshPending} onClick={h.discardChanges}>{t('mview_discard_edits')}</Button>
          <Tooltip title={t('mview_refresh_help')}><span><Button disabled={blocked} startIcon={<RefreshIcon />} onClick={() => void h.handleRefreshMView()}>{t('mview_refresh_now')}</Button></span></Tooltip>
          {database === 'postgresql' ? <Tooltip title={t('mview_concurrent_help')}><FormControlLabel label={t('mview_concurrent')} control={<Checkbox checked={h.concurrent} disabled={blocked || !h.metadata?.concurrent} onChange={event => h.setConcurrent(event.target.checked)} />} /></Tooltip>
            : <TextField select label={t('refresh_mode')} size="small" value={h.refreshMethod} disabled={blocked} onChange={event => h.setRefreshMethod(event.target.value)}>{['FORCE', 'COMPLETE', 'FAST'].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>}
        </Box>}
        {!props.isNew && h.activeTab === 0 && <Box sx={{ display: 'flex', flex: 1, minHeight: 0, flexDirection: 'column' }}>
          {database === 'postgresql' && h.metadata && !h.metadata.populated && !h.refreshPending ? <Alert severity="info">{t('mview_no_data')}</Alert>
            : h.ready && <DataTab schema={props.schema} viewName={props.mviewName} revision={h.dataRevision} isActive={props.isActive && !h.isLoading} inputDateFormat={props.inputDateFormat} dateFormat={props.outputDateFormat} />}
        </Box>}
        {(props.isNew || h.activeTab === 1) && <Box sx={{ p: 2, display: 'flex', flex: 1, minHeight: 0, gap: 2, flexDirection: 'column', overflow: 'auto' }}>
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="h6">{t(props.isNew ? 'create_materialized_view_2' : 'details_actions')}</Typography>
            {h.conflict && <Alert severity="warning" action={<Button disabled={h.isLoading} onClick={h.keepLocalChanges}>{t('mview_keep_edits')}</Button>}>{t('mview_conflict')}<Typography variant="caption">{h.conflict.form.refreshMethod} / {h.conflict.form.refreshTiming} / {h.conflict.form.next}</Typography></Alert>}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField size="small" label={t('schema')} value={h.formData.schema} disabled={blocked || !props.isNew} onChange={event => field('schema', event.target.value)} />
              <TextField size="small" label={t('name_mview_name')} value={h.formData.mviewName} disabled={blocked || !props.isNew} onChange={event => field('mviewName', event.target.value)} />
            </Box>
            {database === 'oracle' ? <>
              <Box sx={{ display: 'flex', gap: 2 }}>{selection('refreshMethod', t('refresh_mode'), ['FORCE', 'FAST', 'COMPLETE'])}{selection('refreshTiming', t('refresh_timing'), ['ON DEMAND', 'ON COMMIT', 'ON STATEMENT'])}</Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControlLabel label={t('mutable')} control={<Checkbox checked={h.formData.isUpdatable} disabled={blocked || !props.isNew} onChange={event => field('isUpdatable', event.target.checked)} />} />
                <FormControlLabel label={h.metadata && !h.metadata.realTimeKnown ? t('mview_realtime_unknown') : t('realtime')} control={<Checkbox checked={h.formData.isRealTime} disabled={blocked || !props.isNew || !h.advancedSupported} onChange={event => field('isRealTime', event.target.checked)} />} />
              </Box>
              {!props.isNew && !h.metadata?.scheduleKnown && <Alert severity="info">{t('mview_schedule_unknown')}</Alert>}
              <TextField size="small" label={t('start_with_start_with')} value={h.formData.startWith} disabled={blocked || h.formData.refreshTiming !== 'ON DEMAND' || !props.isNew && !h.metadata?.scheduleKnown} helperText={t('mview_start_help')} onChange={event => field('startWith', event.target.value)} />
              <TextField size="small" label={t('next_date_next')} value={h.formData.next} disabled={blocked || h.formData.refreshTiming !== 'ON DEMAND' || !props.isNew && !h.metadata?.scheduleKnown} onChange={event => field('next', event.target.value)} />
            </> : props.isNew && <FormControlLabel label={t('with_data')} control={<Checkbox checked={h.formData.withData} disabled={blocked} onChange={event => field('withData', event.target.checked)} />} />}
            {h.previewError && <Alert severity="info">{h.previewError}</Alert>}
            <Box sx={{ display: 'flex', gap: 1 }}>
              {(props.isNew || database === 'oracle') && <Tooltip title={t('mview_save_help')}><span><Button variant="contained" disabled={blocked || !!h.previewError} onClick={() => void h.handleExecute()}>{t('execute')}</Button></span></Tooltip>}
              {!props.isNew && <Tooltip title={t('mview_delete_help')}><span><Button color="error" disabled={blocked} onClick={() => void h.handleDelete()}>{t('delete')}</Button></span></Tooltip>}
            </Box>
            {database === 'postgresql' && !props.isNew && <Box sx={{ display: 'flex', gap: 1 }}><TextField size="small" label={t('mview_new_name')} value={h.renameTo} disabled={blocked} onChange={event => h.setRenameTo(event.target.value)} /><Button disabled={blocked || !h.renameTo.trim()} onClick={() => void h.handleRename()}>{t('rename')}</Button></Box>}
          </Paper>
          <Typography variant="subtitle2">{t('query_as_select')}</Typography>
          <MemoCodeMirror value={h.formData.selectSql} onChange={value => field('selectSql', value)} extensions={h.extensions} readOnly={!props.isNew || blocked} basicSetup={setup} theme={theme.palette.mode} />
          {h.previewSql && <><Typography variant="subtitle2">{t('mview_planned_sql')}</Typography><MemoCodeMirror value={h.previewSql} readOnly basicSetup={setup} extensions={h.extensions} theme={theme.palette.mode} /></>}
        </Box>}
        {!props.isNew && h.activeTab === 2 && <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}><MemoVersionControl dbType={database === 'oracle' ? 'ORACLE' : 'POSTGRESQL'} schema={props.schema} objectType="MATERIALIZED VIEW" objectName={props.mviewName} currentSource={h.sourceText} isSourceLoading={h.isLoading || !h.ready || h.refreshPending} onRefresh={() => void h.loadSource()} /></Box>}
        {!props.isNew && h.activeTab === 3 && <Paper sx={{ p: 2, m: 2, overflow: 'auto' }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} disabled={h.infoLoading || h.refreshPending} onClick={() => void h.loadInformation()}>{t('refresh')}</Button>
          {h.infoError && <Alert severity="error" action={<Button onClick={() => void h.loadInformation()}>{t('retry')}</Button>}>{h.infoError}</Alert>}
          {h.metadata && <>{Object.entries(h.metadata.details).map(([key, value]) => <Typography key={key}>{t('mview_detail_' + key)}: {value || t('none')}</Typography>)}
            {database === 'postgresql' && <><Typography>{t(h.metadata.populated ? 'mview_populated' : 'mview_no_data')}</Typography><Typography>{t(h.metadata.concurrent ? 'mview_concurrent_available' : 'mview_concurrent_unavailable')}</Typography></>}
            {database === 'oracle' && <Typography>{t('mview_next_date')}: {h.metadata.nextDate || t('none')}</Typography>}</>}
          <Typography variant="subtitle2">{t('mview_relations')}</Typography>{h.relations.map((value, index) => <Typography key={index}>{value.replace(/^Uses: /, t('mview_uses') + ': ').replace(/^Used by: /, t('mview_used_by') + ': ').replace(/^Index: /, t('mview_index') + ': ')}</Typography>)}<Typography variant="caption">{t('mview_dependency_scope')}</Typography>
        </Paper>}
      </Box>
      {h.isConsoleOpen && <><Box onMouseDown={() => h.setIsResizing(true)} sx={{ width: 4, flexShrink: 0, cursor: 'col-resize', bgcolor: h.isResizing ? 'primary.main' : 'transparent' }} /><Paper sx={{ width: h.consoleWidth, maxWidth: '45%', overflow: 'auto', p: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography>{t('console')}</Typography><Tooltip title={t('clear_log')}><IconButton onClick={() => h.setLogs([])}><DeleteOutlineIcon /></IconButton></Tooltip><IconButton onClick={() => h.setIsConsoleOpen(false)}><CloseIcon /></IconButton></Box>
        {h.logs.map((log, index) => <Box key={index} sx={{ mb: 1 }}><Typography variant="caption">{log.time}: {log.resultMsg}</Typography><Typography component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{log.sql}</Typography>{log.errorLines?.map((line, i) => <Alert severity="error" key={i}>{line}</Alert>)}</Box>)}
      </Paper></>}
    </Box>
  </Box>;
}
