// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function SidebarCategoryStatus({ loading, error, size, more, onRetry }: {
  loading: boolean; error?: string; size: number | undefined; more: boolean; onRetry: () => void;
}) {
  const { t } = useTranslation();
  return <Box sx={{ pl: 7, pr: 1, py: 0.5 }}>
    {loading && <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <CircularProgress size={14} /><Typography variant="caption">{t('loading')}</Typography>
    </Box>}
    {error && <Alert severity="warning" action={<Button onClick={onRetry} disabled={loading}>{t('retry')}</Button>}>
      {error} {size !== undefined && t('sidebar_previous_results')}
    </Alert>}
    {size !== undefined && <Typography variant="caption" color="text.secondary" aria-live="polite">
      {t(more ? 'sidebar_shown_more' : 'sidebar_shown', { shown: size })}
    </Typography>}
  </Box>;
}
