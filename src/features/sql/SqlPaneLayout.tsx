// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useTranslation } from 'react-i18next';

type PaneMode = 'split' | 'editor' | 'result';
const clampHeight = (height: number, available: number) => Math.max(80, Math.min(height, Math.max(80, available - 110)));

export function useSqlPaneLayout(isActive: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(600);
  const [preferredHeight, setPreferredHeight] = useState(260);
  const [mode, setMode] = useState<PaneMode>('split');
  const [isResizing, setIsResizing] = useState(false);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const height = clampHeight(preferredHeight, available);
  useEffect(() => {
    const host = rootRef.current;
    if (!isActive || !host) return;
    const observer = new ResizeObserver(() => setAvailable(host.clientHeight - 40));
    setAvailable(host.clientHeight - 40);
    observer.observe(host);
    return () => observer.disconnect();
  }, [isActive]);
  useEffect(() => {
    if (!isResizing) return;
    const move = (event: MouseEvent) => {
      if (drag.current) setPreferredHeight(clampHeight(drag.current.height + event.clientY - drag.current.y, available));
    };
    const stop = () => { drag.current = null; setIsResizing(false); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
    };
  }, [isResizing, available]);
  const changeMode = useCallback((next: PaneMode) => {
    drag.current = null; setIsResizing(false); setMode(next);
  }, []);
  const onSeparatorKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    const step = event.shiftKey ? 60 : 20;
    let next: number;
    if (event.key === 'ArrowUp') next = height - step;
    else if (event.key === 'ArrowDown') next = height + step;
    else if (event.key === 'Home') next = 80;
    else if (event.key === 'End') next = available;
    else return;
    event.preventDefault(); setPreferredHeight(clampHeight(next, available));
  };
  return { rootRef, mode, changeMode, height, isResizing,
    separatorProps: {
      role: 'separator', tabIndex: 0, 'aria-orientation': 'horizontal' as const,
      'aria-valuemin': 80, 'aria-valuemax': Math.max(80, available - 110), 'aria-valuenow': height,
      onKeyDown: onSeparatorKeyDown,
      onDoubleClick: () => setPreferredHeight(clampHeight(available / 2, available)),
      onMouseDown: (event: React.MouseEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        drag.current = { y: event.clientY, height }; setIsResizing(true);
      }
    }
  };
}

export function SqlPaneControls({ mode, onChange }: { mode: PaneMode; onChange: (mode: PaneMode) => void }) {
  const { t } = useTranslation();
  return <>
    {mode === 'split' ? <>
      <Tooltip title={t('sql_maximize_editor')}><IconButton size="small" aria-label={t('sql_maximize_editor')} onClick={() => onChange('editor')}><VerticalAlignTopIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title={t('sql_maximize_result')}><IconButton size="small" aria-label={t('sql_maximize_result')} onClick={() => onChange('result')}><VerticalAlignBottomIcon fontSize="small" /></IconButton></Tooltip>
    </> : <Tooltip title={t('sql_restore_split')}><IconButton size="small" aria-label={t('sql_restore_split')} onClick={() => onChange('split')}><UnfoldMoreIcon fontSize="small" /></IconButton></Tooltip>}
  </>;
}
