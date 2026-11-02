// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { memo } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Cover only this window so other windows remain usable.
export const WindowLoadingIndicator = memo(function WindowLoadingIndicator() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'absolute', inset: 0, zIndex: theme => theme.zIndex.drawer,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: 'action.disabledBackground', cursor: 'wait',
      }}
    >
      <CircularProgress aria-label={t("loading")} />
    </Box>
  );
});
