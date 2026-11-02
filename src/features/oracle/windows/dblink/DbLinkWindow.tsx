// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { useMemo } from 'react';
import { Box, Paper, Typography, TextField, Button, Checkbox, FormControlLabel, Tabs, Tab, Alert, IconButton, Tooltip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CloseIcon from '@mui/icons-material/Close';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';
import { plsqlDialect } from '../common/plsqlDialect';
import { WindowLoadingIndicator } from '@/components/feedback/WindowLoadingIndicator';
import { useDbLinkWindow, type DbLinkWindowProps } from './useDbLinkWindow';

const editorSetup = { lineNumbers: true };
export default function DbLinkWindow(props: DbLinkWindowProps) {
  const { t } = useTranslation(), theme = useTheme(), state = useDbLinkWindow(props);
  const { form, setFormData, saved, context, plan, isLoading, ready } = state;
  const extensions = useMemo(() => [sql({ dialect: plsqlDialect })], []);
  const authLabels = { fixed: t('dblink_auth_fixed'), connected: t('dblink_auth_connected'), current: t('dblink_auth_current'), unknown: t('dblink_auth_unknown') };
  const information = saved ? [
    [t('owned_schemas'), saved.schema], [t('db_link_name'), saved.name],
    [t('dblink_auth_type'), authLabels[saved.auth]], [t('user_id'), saved.username || '—'],
    [t('database_using'), saved.host], [t('dblink_created_at'), saved.created || '—']
  ] : [];
  const readOnlyForm = Boolean(context?.readonly || saved && (!saved.editable || saved.schema !== context?.user && saved.schema !== 'PUBLIC'));
  if (!props.isActive) return null;
  const editor = (value: string, kind: 'saved' | 'pending') => <Paper sx={{ display: 'flex', flexDirection: 'column', minHeight: 140, overflow: 'hidden' }}>
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 1, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2">{kind === 'saved' ? t('dblink_saved_template') : t('dblink_pending_sql')}</Typography>
      <Tooltip title={t('copy')}><span><IconButton aria-label={kind === 'saved' ? t('dblink_copy_saved') : t('dblink_copy_pending')}
        disabled={isLoading || !value || kind === 'saved' && !ready} onClick={() => state.copy(kind)} size="small"><ContentCopyIcon fontSize="small" /></IconButton></span></Tooltip>
    </Box>
    <CodeMirror value={value} extensions={extensions} readOnly basicSetup={editorSetup} theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} />
  </Paper>;
  return <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} data-testid="dblink-window"
    sx={{ border: 0, m: 0, p: 0, minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    {isLoading && <WindowLoadingIndicator />}
    {state.error && <Alert severity="error" action={<Button disabled={isLoading} onClick={state.retry}>{t('retry')}</Button>}>{t(state.error)} {state.errorCode}</Alert>}
    {state.phase === 'dropped-only' && <Alert severity="error">{t('dblink_dropped_only')}</Alert>}
    {state.phase && ['created', 'altered', 'recreated'].includes(state.phase) && !ready && <Alert severity="warning">{t('dblink_saved_reload_failed')}</Alert>}
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
      {!props.isNew ? <Tabs value={state.activeTab} onChange={(_, value: number) => state.setActiveTab(value)}>
        <Tab label={t('edit')} /><Tab label={t('source')} /><Tab label={t('view_information')} />
      </Tabs> : <Typography sx={{ px: 2 }}>{t('create_database_link')}</Typography>}
      <Tooltip title={t('dblink_reload_help')}><span><Button variant="outlined" startIcon={<RefreshIcon />} disabled={isLoading} onClick={state.retry}>{t('reload')}</Button></span></Tooltip>
    </Box>
    <Box sx={{ display: 'flex', minHeight: 0, flex: 1, overflow: 'hidden' }}>
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2 }}>
        {(props.isNew || state.activeTab === 0) && <Box sx={{ maxWidth: 800, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="h6">{props.isNew ? t('create_database_link') : t('edit_database_link')}</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Tooltip title={t('dblink_test_help')}><span><Button disabled={!state.canTest} onClick={state.testConnection}>{t('dblink_test_connection')}</Button></span></Tooltip>
                {!props.isNew && <Tooltip title={t('dblink_delete_help')}><span><Button color="error" variant="outlined" startIcon={<DeleteOutlineIcon />} disabled={!state.canDelete} onClick={() => state.execute(true)}>{t('delete')}</Button></span></Tooltip>}
                <Tooltip title={t('dblink_execute_help')}><span><Button color="success" variant="contained" startIcon={<PlayArrowIcon />} disabled={!state.canExecute} onClick={() => state.execute()}>
                  {state.phase === 'dropped-only' ? t('dblink_retry_creation') : t('execute')}
                </Button></span></Tooltip>
              </Box>
            </Box>
            <Alert severity="info">{t('dblink_password_policy')}</Alert>
            {saved && !saved.editable && <Alert severity="warning">{t('dblink_unsupported')}</Alert>}
            {saved && context && saved.schema !== context.user && saved.schema !== 'PUBLIC' && <Alert severity="warning">{t('dblink_owner_restricted')}</Alert>}
            {plan.error && ready && <Alert severity="warning">{t(plan.error)}</Alert>}
            {plan.kind === 'recreate' && <Alert severity="warning">{t('dblink_recreate_help')}</Alert>}
            {state.testResult !== null && <Alert severity="success">{t('dblink_test_success', { ms: state.testResult })}</Alert>}
            <Box component="fieldset" disabled={isLoading || !ready && state.phase !== 'dropped-only' || readOnlyForm} sx={{ border: 0, p: 0, m: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControlLabel control={<Checkbox checked={form.isPublic} disabled={!props.isNew} onChange={event => setFormData({ ...form, isPublic: event.target.checked })} />} label={t('make_public_db_link_public')} />
              {form.isPublic && <Alert severity="info">{t('public_database_link_scope_help')}</Alert>}
              <TextField size="small" label={t('owned_schemas')} value={saved?.schema || (form.isPublic ? 'PUBLIC' : context?.user || '')} disabled helperText={t('dblink_owner_help')} />
              <TextField size="small" required label={t('db_link_name')} value={form.name} disabled={!props.isNew} onChange={event => setFormData({ ...form, name: event.target.value.toUpperCase() })} helperText={t('dblink_name_help')} />
              <TextField size="small" required label={t('user_id')} value={form.username} onChange={event => setFormData({ ...form, username: event.target.value })} helperText={t('dblink_user_help')} />
              <TextField size="small" label={t('password')} type="password" autoComplete="new-password" value={form.password} onChange={event => setFormData({ ...form, password: event.target.value })} helperText={t('dblink_password_help')} />
              <TextField size="small" multiline minRows={1} maxRows={5} required label={t('database_using')} value={form.host} onChange={event => setFormData({ ...form, host: event.target.value })} helperText={t('dblink_host_help')} />
            </Box>
          </Paper>
          {editor(plan.sql || `-- ${t('no_changes_found')}`, 'pending')}
        </Box>}
        {!props.isNew && state.activeTab === 1 && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Alert severity="info">{t('dblink_template_help')}</Alert>
          {editor(saved?.source || '', 'saved')}
          {plan.sql && editor(plan.sql, 'pending')}
        </Box>}
        {!props.isNew && state.activeTab === 2 && <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {information.map(([label, value]) => <Box key={label} sx={{ display: 'flex', gap: 2 }}><Typography sx={{ minWidth: 180 }}>{label}</Typography><Typography sx={{ overflowWrap: 'anywhere' }}>{value}</Typography></Box>)}
          <Alert severity="info">{t('dblink_host_help')}</Alert>
          <Alert severity="info">{t('dblink_template_help')}</Alert>
          <Button disabled={!state.canTest} onClick={state.testConnection}>{t('dblink_test_connection')}</Button>
          {state.testResult !== null && <Alert severity="success">{t('dblink_test_success', { ms: state.testResult })}</Alert>}
        </Box>}
      </Box>
      {state.consoleOpen && <>
        <Box onMouseDown={() => state.setIsResizing(true)} sx={{ width: 4, cursor: 'col-resize', bgcolor: state.isResizing ? 'primary.main' : 'divider' }} />
        <Paper sx={{ width: state.consoleWidth, flexShrink: 0, overflow: 'auto', p: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><Typography>{t('console')}</Typography>
            <Box><Tooltip title={t('clear_log')}><IconButton aria-label={t('clear_log')} onClick={() => state.setLogs([])}><DeleteOutlineIcon /></IconButton></Tooltip>
              <IconButton aria-label={t('close')} onClick={() => state.setConsoleOpen(false)}><CloseIcon /></IconButton></Box>
          </Box>
          {state.logs.map((entry, index) => <Box key={index} sx={{ borderBottom: 1, borderColor: 'divider', py: 1 }}>
            <Typography variant="caption">{entry.time} {t(entry.message)} {entry.code}</Typography>
            <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{entry.sql}</Typography>
          </Box>)}
        </Paper>
      </>}
    </Box>
  </Box>;
}
