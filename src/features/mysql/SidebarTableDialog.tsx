// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { MysqlColumn, MysqlStatement } from './table/tableModel';
import { buildSidebarTableAction, type SidebarTableAction } from './sidebarTableActions';

export default function SidebarTableDialog({ target, action, columns, busy, failureMessage, onClose, onExecute }: {
  target: DatabaseObject; action: SidebarTableAction; columns: MysqlColumn[]; busy: boolean; failureMessage: string;
  onClose: () => void; onExecute: (statement: MysqlStatement, newName: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(action === 'copy' ? target.name + '_COPY' : target.name);
  const [confirmation, setConfirmation] = useState(''), [preview, setPreview] = useState<MysqlStatement>();
  const [error, setError] = useState(''), [attempted, setAttempted] = useState(false);
  const submitted = useRef(false);
  const labels = { rename: 'rename_table', copy: 'copy_table', analyze: 'gather_stats_analyze_2', truncate: 'truncate', drop: 'drop_table' };
  const destructive = action === 'truncate' || action === 'drop';
  return <Dialog open maxWidth="md" fullWidth onClose={() => { if (!busy) onClose(); }}>
    <DialogTitle>{t(labels[action])} · {target.schema}.{target.name}</DialogTitle>
    <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
      <Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert>
      {action === 'copy' && <Alert severity="info">{t('mysql_sidebar_copy_help')}</Alert>}
      {action === 'analyze' && <Alert severity="info">{t('mysql_sidebar_analyze_help')}</Alert>}
      {['rename', 'copy'].includes(action) && <TextField label={t('new_table_name')} size="small" value={name} disabled={busy || attempted} onChange={event => { setName(event.target.value); setPreview(undefined); setError(''); }} />}
      {preview && <Typography component="pre" sx={{ whiteSpace: 'pre-wrap', p: 1, bgcolor: 'action.hover' }}>{preview.sql}</Typography>}
      {destructive && preview && <TextField label={t('mysql_table_confirm_name', { name: target.name })} value={confirmation} disabled={busy || attempted} onChange={event => setConfirmation(event.target.value)} />}
      {attempted && failureMessage && <Alert severity="error">{failureMessage}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {attempted && <Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
    </DialogContent>
    <DialogActions>
      <Button disabled={busy} onClick={onClose}>{t('close')}</Button>
      <Button disabled={busy || attempted} onClick={() => { try { setPreview(buildSidebarTableAction(action, target.schema, target.name, name, columns)); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); } }}>{t('preview')}</Button>
      <Button variant="contained" color={destructive ? 'error' : 'primary'} disabled={busy || attempted || !preview || destructive && confirmation !== target.name} onClick={() => {
        if (submitted.current || !preview) return;
        submitted.current = true; setAttempted(true);
        void onExecute(preview, name).then(success => { if (success) onClose(); else setError(t('mysql_sidebar_action_failed_check')); });
      }}>{t('execute')}</Button>
    </DialogActions>
  </Dialog>;
}
