// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Box, Dialog, DialogContent, DialogTitle, IconButton, List, ListItemButton, ListItemText, TextField, Tooltip, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ListAltIcon from '@mui/icons-material/ListAlt';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';

export interface WorkspaceEntry {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  disabled?: boolean;
  run: () => void;
}

export default function WorkspaceNavigation({ tabs, commands }: { tabs: WorkspaceEntry[]; commands: WorkspaceEntry[] }) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'tabs' | 'commands' | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);

  const open = useEventCallback((value: 'tabs' | 'commands') => {
    if (busy || document.querySelector('[role="dialog"]')) return;
    setQuery('');
    setCursor(0);
    setMode(value);
  });
  const handleKey = useEventCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    const key = event.key.toLowerCase();
    if (key === 'p' || key === 'o') {
      event.preventDefault();
      open(key === 'p' ? 'commands' : 'tabs');
    }
  });
  useEffect(() => {
    const loading = (event: WindowEventMap['toggle-global-loader']) => setBusy(Boolean(event.detail));
    window.addEventListener('keydown', handleKey);
    window.addEventListener('toggle-global-loader', loading);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('toggle-global-loader', loading);
    };
  }, [handleKey]);

  const rows = (mode === 'tabs' ? tabs : commands).filter(row =>
    `${row.label} ${row.detail || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const selectable = rows.map((row, i) => !busy && !row.disabled ? i : -1).filter(i => i >= 0);
  const index = selectable.includes(cursor) ? cursor : selectable.find(i => i >= cursor) ?? selectable[0] ?? -1;
  useEffect(() => {
    if (mode && index >= 0) document.getElementById(`${id}-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [id, index, mode, query]);
  const run = (entry: WorkspaceEntry) => {
    if (busy || entry.disabled) return;
    setMode(null);
    entry.run();
  };

  // Handle navigation before a focused result can consume Enter or arrow keys.
  const handleNavigationKey = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const editingText = event.target === inputRef.current;
    if (editingText && ['Home', 'End'].includes(event.key)) return;
    if ((event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) && event.key !== 'Enter') return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.focus({ preventScroll: true });
      if (!selectable.length) return;
      const position = selectable.indexOf(index);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? selectable.length - 1
        : (position + (event.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length;
      setCursor(selectable[next]);
    } else if (event.key === 'Enter') {
      const optionId = (event.target as HTMLElement | undefined)?.closest?.('[role="option"]')?.id;
      const focusedIndex = rows.findIndex((_row, i) => optionId === `${id}-${i}`);
      const entry = rows[focusedIndex >= 0 ? focusedIndex : index];
      if (!entry) return;
      event.preventDefault();
      event.stopPropagation();
      run(entry);
    }
  };

  return <Box sx={{ display: 'flex', alignItems: 'center' }}>
    <Tooltip title={`${t('ux_search_tabs')} (Ctrl/⌘+Shift+O)`}><span>
      <IconButton size="small" aria-label={t('ux_search_tabs')} disabled={busy} onClick={() => open('tabs')}><ListAltIcon fontSize="small" /></IconButton>
    </span></Tooltip>
    <Tooltip title={`${t('ux_search_commands')} (Ctrl/⌘+Shift+P)`}><span>
      <IconButton size="small" aria-label={t('ux_search_commands')} disabled={busy} onClick={() => open('commands')}><SearchIcon fontSize="small" /></IconButton>
    </span></Tooltip>
    <Dialog onKeyDownCapture={handleNavigationKey} open={mode !== null} onClose={() => setMode(null)} maxWidth="sm" fullWidth>
      <DialogTitle>{t(mode === 'tabs' ? 'ux_search_tabs' : 'ux_search_commands')}</DialogTitle>
      <DialogContent>
        <TextField inputRef={inputRef} autoFocus fullWidth size="small" label={t('ux_search_name')} value={query}
          onChange={event => { setQuery(event.target.value); setCursor(0); }}
          inputProps={{ role: 'combobox', 'aria-controls': id, 'aria-expanded': true, 'aria-activedescendant': index >= 0 ? `${id}-${index}` : undefined, 'aria-autocomplete': 'list' }}
        />
        <List id={id} role="listbox" sx={{ maxHeight: '50vh', overflow: 'auto' }}>
          {rows.map((row, i) => <ListItemButton id={`${id}-${i}`} key={row.id} role="option" tabIndex={-1}
            aria-selected={i === index} aria-disabled={busy || row.disabled} selected={i === index} disabled={busy || row.disabled}
            onMouseMove={event => { if (event.movementX || event.movementY) setCursor(i); }} onClick={() => run(row)}>
            <ListItemText primary={row.label} secondary={row.disabled ? t('ux_command_unavailable') : row.detail} />
            {row.shortcut && <Typography component="kbd" variant="caption" color="text.secondary" sx={{ ml: 2, flexShrink: 0 }}>{row.shortcut}</Typography>}
          </ListItemButton>)}
        </List>
        {!rows.length && <Typography color="text.secondary">{t('ux_no_matches')}</Typography>}
        <Typography variant="caption" color="text.secondary">{t('ux_search_keys')}</Typography>
      </DialogContent>
    </Dialog>
  </Box>;
}
