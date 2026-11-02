// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { TypeChangePlan } from './useTypeEditor';

export function TypeChangeDialog({ plan, busy, ready, onClose, onConfirm, onRetry }: { plan: TypeChangePlan | null; busy: boolean; ready: boolean; onClose: () => void; onConfirm: () => void; onRetry: () => void }) {
  const { t } = useTranslation();
  return <Dialog open={!!plan} onClose={() => { if (!busy) onClose(); }} fullWidth maxWidth="md" disableEscapeKeyDown={busy}>
    <DialogTitle>{t('type_changes_preview')}</DialogTitle>
    <DialogContent>
      <Alert severity={plan?.failed ? 'error' : 'info'}>{plan?.failed ? t('type_partial_result', { completed: plan.completed, total: plan.statements.length }) : t('type_changes_count', { count: plan?.statements.length || 0 })}</Alert>
      {plan?.error && <Typography color="error">{plan.error}</Typography>}
      <Typography variant="body2" sx={{ my: 1 }}>{t('type_changes_commit_notice')}</Typography>
      {plan?.statements.map((sql, index) => <Box key={index} sx={{ mt: 2 }}>
        <Typography variant="caption">{index + 1}. {index < plan.completed ? t('type_change_applied') : plan.failed && index === plan.completed ? t('type_change_failed') : t('type_change_pending')}</Typography>
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', m: 0 }}>{sql}</Box>
      </Box>)}
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>{t('close')}</Button>
      {plan?.failed ? <Button disabled={busy || !ready} onClick={onRetry}>{t('type_retry_preview')}</Button> : <Button variant="contained" disabled={busy || !ready} onClick={onConfirm}>{t('execute')}</Button>}
    </DialogActions>
  </Dialog>;
}
