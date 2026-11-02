// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { Dispatch, SetStateAction } from 'react';
import { Box, IconButton, Tooltip } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';

export default function SqlPrivacyToggle({ active, onChange, disabled }: {
  active: boolean; onChange: Dispatch<SetStateAction<boolean>>; disabled: boolean;
}) {
  const { t } = useTranslation();
  return <Tooltip title={t('sql_private_execution_help')}>
    <Box component="span" sx={{ display: 'inline-flex' }}>
      <IconButton size="small" color={active ? 'warning' : 'default'} disabled={disabled}
        aria-label={t('sql_private_execution')} aria-pressed={active} onClick={() => onChange(previous => !previous)}
        sx={{ border: '1px solid', borderColor: active ? 'warning.main' : 'divider', borderRadius: 1,
          bgcolor: active ? 'action.selected' : undefined }} disableRipple>
        <LockOutlinedIcon />
      </IconButton>
    </Box>
  </Tooltip>;
}
