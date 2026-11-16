// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSqlPaneLayout } from '@/features/sql/SqlPaneLayout';

// Reuse the SQL split's container measurement, drag limits and keyboard controls.
export default function VerticalSplit({ active, initialHeight, name, upper, lower }: {
  active: boolean; initialHeight: number; name: string; upper: ReactNode; lower: ReactNode;
}) {
  const { t } = useTranslation();
  const panes = useSqlPaneLayout(active, initialHeight);
  return <Box ref={panes.rootRef} data-testid={`mysql-split-${name}`} sx={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', gap: 1 }}>
    <Box data-split-upper sx={{ height: panes.height, flexShrink: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{upper}</Box>
    <Box {...panes.separatorProps} data-resizing={panes.isResizing} aria-label={t('resize_vertical_panes')} title={t('resize_vertical_panes_help')}
      sx={{ height: 8, flexShrink: 0, borderRadius: 1, cursor: 'row-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: panes.isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
      <Box sx={{ width: 40, height: 2, borderRadius: 1, bgcolor: panes.isResizing ? 'background.paper' : 'text.secondary' }} />
    </Box>
    <Box data-split-lower sx={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{lower}</Box>
  </Box>;
}
