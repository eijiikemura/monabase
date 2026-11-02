// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export default function GitHistoryPagination({ page, hasMore, loading, onChange }: {
  page: number; hasMore: boolean; loading: boolean; onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
    <Button size="small" disabled={loading || page === 0} onClick={() => onChange(page - 1)}>{t('git_history_previous')}</Button>
    <Typography variant="caption" aria-live="polite">{t('git_history_page', { page: page + 1 })}</Typography>
    <Button size="small" disabled={loading || !hasMore} onClick={() => onChange(page + 1)}>{t('git_history_next')}</Button>
  </Box>;
}
