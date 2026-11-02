// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import { useTranslation } from 'react-i18next';
export function IndexColumnOrder({ columns, selected, disabled, onMove }: {
  columns: string[]; selected: string[]; disabled: boolean; onMove: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const index = selected.length === 1 ? columns.indexOf(selected[0]) : -1;
  return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} onKeyDown={event => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || disabled) return;
    event.preventDefault(); onMove(event.key === 'ArrowUp' ? -1 : 1);
  }}>
    <Typography variant="caption">{t('index_column_order_help')}</Typography>
    {([-1, 1] as const).map(direction => <Tooltip key={direction} title={t(direction < 0 ? 'index_column_up' : 'index_column_down')}><span>
      <IconButton size="small" aria-label={t(direction < 0 ? 'index_column_up' : 'index_column_down')}
        disabled={disabled || index < 0 || index + direction < 0 || index + direction >= columns.length} onClick={() => onMove(direction)}>
        {direction < 0 ? <ArrowUpward fontSize="small" /> : <ArrowDownward fontSize="small" />}
      </IconButton>
    </span></Tooltip>)}
  </Box>;
}
