// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { memo } from 'react';
import { Alert, Box, Button, Checkbox, Divider, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';
import { WindowLoadingIndicator } from '@/components/feedback/WindowLoadingIndicator';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import { synonymTargetCategories, synonymTargetWindow } from '@/features/oracle/synonymDefinition';
import { plsqlDialect } from '../common/plsqlDialect';
import { useSynonymWindow, type SynonymWindowProps } from './useSynonymWindow';

const MemoCodeMirror = memo(CodeMirror);
const extensions = [sql({ dialect: plsqlDialect })];
const basicSetup = { lineNumbers: true };
export default function SynonymWindow(props: SynonymWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const h = useSynonymWindow(props);
  const { formData, setFormData } = h;
  if (!props.isActive) return null;
  const blocked = h.isLoading || !h.ready;
  const previewField = h.previewError;
  const sourcePanel = (planned: boolean) => <Paper sx={{ flex: 1, minHeight: 150, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="subtitle2">{t(planned ? 'synonym_planned_sql' : 'synonym_saved_ddl')}</Typography>
      <Tooltip title={t('copy')}><span><IconButton aria-label={t(planned ? 'synonym_copy_planned' : 'synonym_copy_saved')}
        disabled={h.isLoading || (planned ? !h.generatedSql : !h.sourceReady)} onClick={() => void h.copySource(planned)} size="small"><ContentCopyIcon fontSize="small" /></IconButton></span></Tooltip>
    </Box>
    {(planned ? h.previewError : h.sourceError) && <Alert severity={planned ? 'info' : 'error'} action={!planned ? <Button disabled={h.isLoading} onClick={() => void h.loadSynonym()}>{t('retry')}</Button> : undefined}>{planned ? h.previewError : h.sourceError}</Alert>}
    <Box data-testid={planned ? 'synonym-planned-source' : 'synonym-saved-source'} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <MemoCodeMirror value={planned ? h.generatedSql : h.sourceText} height="100%" extensions={extensions} readOnly basicSetup={basicSetup} theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} />
    </Box>
  </Paper>;
  return <Box data-testid="synonym-window" aria-busy={h.isLoading} sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
    {h.isLoading && <WindowLoadingIndicator />}
    <Tabs value={h.activeTab} onChange={(_, value: number) => h.setActiveTab(value)}>
      <Tab label={t('edit')} /><Tab label={t('source')} />{!props.isNew && <Tab label={t('view_information')} />}
    </Tabs>
    {h.loadError && <Alert severity="error" action={<Button disabled={h.isLoading} onClick={() => void h.loadSynonym()}>{t('retry')}</Button>}>{h.loadError}</Alert>}
    {h.operationError && <Alert severity="error">{h.operationError}</Alert>}
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {!props.isNew && <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} disabled={h.isLoading} onClick={() => void h.loadSynonym()}>{t('refresh')}</Button>
          <Button disabled={h.isLoading} onClick={h.discardChanges}>{t('synonym_discard_edits')}</Button>
        </Box>}
        {h.activeTab === 0 && <Paper sx={{ p: 3, maxWidth: 700, width: '100%', boxSizing: 'border-box', mx: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="h6">{t(props.isNew ? 'create_synonym' : 'edit_synonym')}</Typography>
          {formData.isPublic && <Alert severity="info">{t('public_synonym_scope_help')}</Alert>}
          {h.conflict && <Alert severity="warning" action={<Button disabled={blocked} onClick={h.keepLocalChanges}>{t('synonym_keep_changes')}</Button>}>
            {t('synonym_conflict')}
            <Typography variant="body2">{t('synonym_database_target')}: {h.conflict.targetSchema}.{h.conflict.targetObject}{h.conflict.dbLink ? '@' + h.conflict.dbLink : ''}</Typography>
            <Typography variant="body2">{t('synonym_local_target')}: {formData.targetSchema}.{formData.targetObject}{formData.dbLink ? '@' + formData.dbLink : ''}</Typography>
          </Alert>}
          <Box component="fieldset" disabled={blocked} sx={{ border: 0, m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControlLabel control={<Checkbox disabled={blocked || !props.isNew} checked={formData.isPublic} onChange={event => setFormData(previous => ({ ...previous, isPublic: event.target.checked }))} />} label={t('make_public_synonym_public')} />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl fullWidth size="small" disabled={blocked || !props.isNew || formData.isPublic}>
                <InputLabel>{t('owned_schemas')}</InputLabel><Select value={formData.schema} label={t('owned_schemas')} onChange={event => setFormData(previous => ({ ...previous, schema: event.target.value }))}>
                  {[...new Set([...props.allSchemas, formData.schema].filter(Boolean))].map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField disabled={blocked || !props.isNew} label={t('synonym_name')} value={formData.synonymName} size="small" fullWidth required
                inputProps={{ 'aria-label': t('synonym_name') }} onChange={event => setFormData(previous => ({ ...previous, synonymName: event.target.value }))} />
            </Box>
            <Typography variant="caption">{t('synonym_exact_names')}</Typography><Divider />
            <Tooltip title={t('synonym_choose_target_help')}><span><Button disabled={blocked} variant="outlined" onClick={() => h.setPickerOpen(true)}>{t('synonym_choose_target')}</Button></span></Tooltip>
            <TextField disabled={blocked} label={t('target_schema')} value={formData.targetSchema} size="small" required={!formData.dbLink}
              inputProps={{ 'aria-label': t('target_schema') }} onChange={event => setFormData(previous => ({ ...previous, targetSchema: event.target.value }))} />
            <TextField disabled={blocked} label={t('target_object')} value={formData.targetObject} size="small" required
              inputProps={{ 'aria-label': t('target_object') }} onChange={event => setFormData(previous => ({ ...previous, targetObject: event.target.value }))} />
            <TextField disabled={blocked} label={t('db_link_optional')} value={formData.dbLink} size="small" inputProps={{ 'aria-label': t('db_link_optional') }}
              onChange={event => setFormData(previous => ({ ...previous, dbLink: event.target.value }))} helperText={t('synonym_link_help')} />
          </Box>
          {previewField && <Alert severity="info">{previewField}</Alert>}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            {!props.isNew && <Tooltip title={t('synonym_delete_help')}><span><Button disabled={blocked} color="error" variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={() => void h.handleDelete()}>{t('delete')}</Button></span></Tooltip>}
            <Tooltip title={t('synonym_execute_help')}><span><Button disabled={blocked || !!h.previewError} variant="contained" startIcon={<PlayArrowIcon />} onClick={() => void h.handleExecute()}>{t('execute')}</Button></span></Tooltip>
          </Box>
        </Paper>}
        {h.activeTab === 1 && <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {!props.isNew && sourcePanel(false)}{sourcePanel(true)}
        </Box>}
        {h.activeTab === 2 && h.savedDefinition && <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Button variant="outlined" startIcon={<RefreshIcon />} disabled={h.infoLoading || h.isLoading} onClick={() => void h.loadInformation()}>{t('refresh')}</Button>
          {h.infoError && <Alert severity="error" action={<Button disabled={h.infoLoading} onClick={() => void h.loadInformation()}>{t('retry')}</Button>}>{h.infoError}</Alert>}
          <Typography fontWeight="bold">{h.savedDefinition.owner}.{h.savedDefinition.name}</Typography>
          <Typography>{t('target_object')}: {h.savedDefinition.targetSchema}.{h.savedDefinition.targetObject}{h.savedDefinition.dbLink ? '@' + h.savedDefinition.dbLink : ''}</Typography>
          {h.targetInfo && <Typography>{t('synonym_target_' + h.targetInfo.state)}</Typography>}
          {h.targetInfo?.types.map(item => <Box key={item.OBJECT_TYPE} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography>{item.OBJECT_TYPE}: {item.STATUS}</Typography>
            {synonymTargetWindow(item.OBJECT_TYPE) && props.onOpenTarget && !h.savedDefinition?.dbLink && <Button disabled={h.infoLoading || !h.ready} onClick={() => h.openTarget(item.OBJECT_TYPE)}>{t('synonym_open_target')}</Button>}
          </Box>)}
          {h.savedDefinition.dbLink && <Button disabled={h.infoLoading || h.isLoading} onClick={() => { if (window.confirm(t('synonym_remote_confirm'))) void h.loadInformation(true); }}>{t('synonym_check_remote')}</Button>}
          <Typography variant="subtitle2">{t('view_dependents')}</Typography>
          {h.dependents.length ? h.dependents.map(item => <Typography key={JSON.stringify(item)}>{item.OWNER}.{item.NAME} ({item.TYPE})</Typography>) : <Typography>{t('none')}</Typography>}
          <Typography variant="caption">{t('synonym_dependency_scope')}</Typography>
        </Paper>}
      </Box>
      {h.isConsoleOpen && <><Box onMouseDown={() => h.setIsResizing(true)} sx={{ width: 4, flexShrink: 0, cursor: 'col-resize', bgcolor: h.isResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' } }} /><Paper sx={{ width: h.consoleWidth, maxWidth: '45%', display: 'flex', flexDirection: 'column', p: 1, overflow: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><Typography>{t('console')}</Typography>
          <Box><Tooltip title={t('clear_log')}><IconButton aria-label={t('clear_log')} onClick={() => h.setLogs([])}><DeleteOutlineIcon /></IconButton></Tooltip>
            <IconButton aria-label={t('close')} onClick={() => h.setIsConsoleOpen(false)}><CloseIcon /></IconButton></Box>
        </Box>
        {h.logs.map((log, index) => <Box key={index} sx={{ mb: 2 }}><Typography variant="caption">{log.time} {log.resultMsg}</Typography>
          <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{log.sql}</Typography>{log.errorLines?.map((line, i) => <Alert severity="error" key={i}>{line}</Alert>)}</Box>)}
      </Paper></>}
    </Box>
    <ObjectPickerDialog open={h.pickerOpen} dbType="oracle" initialSchema={formData.targetSchema} initialCategory="TABLE" categories={synonymTargetCategories} multiple={false}
      disabled={blocked} title={t('synonym_choose_target')} onClose={() => h.setPickerOpen(false)} onConfirm={h.selectTarget} />
  </Box>;
}
