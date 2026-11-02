// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { MouseEvent } from 'react';
import { Box } from '@mui/material';

interface WorkspaceDividerProps {
  label: string;
  value: number;
  min: number;
  max: number;
  reverse?: boolean;
  onChange: (value: number) => void;
  onMouseDown: (event: MouseEvent) => void;
}

export default function WorkspaceDivider({ label, value, min, max, reverse = false, onChange, onMouseDown }: WorkspaceDividerProps) {
  return <Box role="separator" aria-label={label} aria-orientation="vertical"
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value)} tabIndex={0} onMouseDown={onMouseDown}
    onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const step = (event.shiftKey ? 40 : 16) * (reverse ? -1 : 1);
      const next = event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === 'ArrowLeft' ? -step : step);
      onChange(Math.max(min, Math.min(max, next)));
    }}
    sx={{ width: 6, flexShrink: 0, cursor: 'col-resize', bgcolor: 'divider',
      '&:hover': { bgcolor: 'primary.main' },
      '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }} />;
}
