// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, LinearProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { GenerationResult } from './useGenerationWorkflow';

export function GenerationStatus({ progress, result, onStop }: {
  progress: { confirmed: number; total: number; running: boolean; stopping: boolean };
  result: GenerationResult | null; onStop: () => void;
}) {
  const { t } = useTranslation();
  return <>
    {progress.running && <Box sx={{ p: 1, flexShrink: 0 }} role="status" aria-live="polite">
      <Typography>{t('generation_progress', progress)}</Typography>
      <LinearProgress variant="determinate" value={progress.total ? progress.confirmed / progress.total * 100 : 0} />
      <Button disabled={progress.stopping} onClick={onStop}>{progress.stopping ? t('generation_waiting_stop') : t('generation_stop')}</Button>
      <Typography variant="caption">{t('generation_stop_help')}</Typography>
    </Box>}
    {result && <Alert severity={result.status === 'success' ? 'success' : 'warning'} sx={{ mb: 1, flexShrink: 0 }}>
      {t('generation_result', { count: result.confirmed, total: result.total })} {t('generation_pending_help')}{result.error ? ` ${result.error}` : ''}
    </Alert>}
  </>;
}
