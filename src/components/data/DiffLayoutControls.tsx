// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { ToggleButton, ToggleButtonGroup, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

type Layout = 'split' | 'unified';
export function useDiffLayout() {
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down('md'));
  const [layout, setLayout] = useState<Layout | null>(null);
  return { splitView: layout ? layout === 'split' : !narrow, setLayout };
}

export default function DiffLayoutControls({ splitView, onChange }: { splitView: boolean; onChange: (layout: Layout) => void }) {
  const { t } = useTranslation();
  return <ToggleButtonGroup exclusive size="small" value={splitView ? 'split' : 'unified'} aria-label={t('diff_layout')}
    onChange={(_event, value: Layout | null) => { if (value) onChange(value); }}>
    <ToggleButton value="split">{t('diff_split')}</ToggleButton>
    <ToggleButton value="unified">{t('diff_unified')}</ToggleButton>
  </ToggleButtonGroup>;
}
