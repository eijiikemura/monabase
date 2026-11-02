// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
export interface TriggerOverviewData {
  status: string; timing: string; events: string; level: string; when: string | null;
  updateColumns: string[]; functionName?: string; functionUsers?: number; header?: string; readOnly?: boolean;
}
export function TriggerOverview({ data, error, busy, onRetry }: {
  data: TriggerOverviewData | null; error: string; busy: boolean; onRetry: () => void;
}) {
  const { t } = useTranslation();
  return <Box sx={{ px: 2, py: 0.5, flexShrink: 0, maxHeight: 160, overflow: 'auto' }}>
    {error && <Alert severity="error" action={<Button disabled={busy} onClick={onRetry}>{t('retry')}</Button>}>{t('trigger_load_failed')} {error}</Alert>}
    {data && <>
      <Typography variant="caption" component="div">{t('trigger_database_settings')}: {data.status} · {data.timing} · {data.events} · {data.level}</Typography>
      <Typography variant="caption" component="div">WHEN: {data.when || '—'} · UPDATE OF: {data.updateColumns.join(', ') || '—'}</Typography>
      {data.functionName && <Typography variant="caption" component="div">{t('trigger_function')}: {data.functionName} · {t('trigger_function_users', { count: data.functionUsers })}</Typography>}
      {data.header && <Typography component="pre" variant="caption" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>{data.header}</Typography>}
      {data.readOnly && <Alert severity="info">{t('trigger_read_only_definition')}</Alert>}
    </>}
  </Box>;
}
