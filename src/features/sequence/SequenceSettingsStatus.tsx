// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { SequenceConflict } from './useSequenceSettings';
export function SequenceSettingsStatus({ error, ready, busy, conflict, restartSupport, onRetry, onDiscard, onKeep }: {
  error: string; ready: boolean; busy: boolean; conflict: SequenceConflict | null; restartSupport: string; onRetry: () => void; onDiscard: () => void; onKeep: () => void;
}) {
  const { t } = useTranslation();
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    {error && <Alert severity="error" action={<Button disabled={busy} onClick={onRetry}>{t('retry')}</Button>}>{error}</Alert>}
    {ready && <Box sx={{ display: 'flex', gap: 1 }}><Button disabled={busy} onClick={onRetry}>{t('refresh')}</Button><Button disabled={busy} onClick={onDiscard}>{t('sequence_discard_edits')}</Button></Box>}
    {restartSupport !== 'supported' && <Alert severity="info">{t(restartSupport === 'unsupported' ? 'sequence_restart_old_version' : 'sequence_restart_version_unknown')}</Alert>}
    {conflict && <Alert severity="warning" action={<Button disabled={busy} onClick={onKeep}>{t('sequence_keep_local_changes')}</Button>}>
      {t('sequence_concurrent_changes')}
      {conflict.fields.map(field => <Typography key={field} variant="body2">{t('sequence_setting_' + field)}: {String(conflict.baseline[field])} → {String(conflict.latest[field])} · {t('sequence_your_value')}: {String(conflict.desired[field])}</Typography>)}
    </Alert>}
  </Box>;
}
