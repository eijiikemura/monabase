// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useTranslation } from 'react-i18next';

export function useSqlEditorLayout() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [bindChoice, setBindChoice] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => { if (root.clientWidth > 0) setWidth(root.clientWidth); };
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(root);
    return () => observer.disconnect();
  }, []);
  const narrow = width < 900;
  return { rootRef, narrow, bindOpen: bindChoice ?? !narrow, setBindOpen: setBindChoice };
}

// Measure the actual controls, including translated labels and database-specific fields.
export default function SqlEditorToolbar({ primary, children }: { primary: ReactNode; children: ReactNode }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null), primaryRef = useRef<HTMLDivElement>(null), secondary = useRef<HTMLDivElement>(null);
  const required = useRef(0);
  const [compact, setCompact] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  useLayoutEffect(() => { if (!compact) setAnchor(null); }, [compact]);
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const measure = () => {
      if (host.clientWidth <= 0) return;
      if (!compact && primaryRef.current && secondary.current) required.current = primaryRef.current.scrollWidth + secondary.current.scrollWidth + 8;
      setCompact(host.clientWidth + 1 < required.current);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    if (!compact && secondary.current) observer.observe(secondary.current);
    measure();
    return () => observer.disconnect();
  }, [compact, primary, children]);
  return <Box ref={root} data-testid="sql-editor-toolbar" data-compact={compact} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexShrink: 0, overflow: 'hidden' }}>
    <Box ref={primaryRef} sx={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }}>{primary}</Box>
    {compact ? <>
      <Tooltip title={t('sql_more_actions')}><IconButton size="small" aria-label={t('sql_more_actions')} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(event.currentTarget)}><MoreHorizIcon /></IconButton></Tooltip>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        PaperProps={{ role: 'dialog', 'aria-label': t('sql_more_actions'), sx: { p: 1.5, maxWidth: 'calc(100vw - 32px)', width: 440 } }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('sql_more_actions')}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }} onClick={event => {
          if ((event.target as Element).closest('button')) setAnchor(null);
        }}>{children}</Box>
      </Popover>
    </> : <Box ref={secondary} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0, whiteSpace: 'nowrap', '& > *': { flexShrink: 0 } }}>{children}</Box>}
  </Box>;
}
