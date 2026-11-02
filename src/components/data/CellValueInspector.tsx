// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { KeyboardEvent, MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { notify } from '@/shared/utils/notifications';
import { isBinaryFileValue } from '@/shared/types/databaseTypes';

export interface CellSnapshot { label: string; value: unknown; binary?: boolean; }

export function describeCellValue(value: unknown, binary = false): { kind: 'null' | 'empty' | 'value' | 'binary' | 'unavailable'; text: string } {
  if (value === null) return { kind: 'null', text: 'NULL' };
  if (value === undefined) return { kind: 'unavailable', text: '' };
  if (binary || isBinaryFileValue(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer ||
      (typeof value === 'object' && 'type' in value && value.type === 'Buffer')) return { kind: 'binary', text: '' };
  if (value === '') return { kind: 'empty', text: '' };
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? { kind: 'value', text: value.toISOString() } : { kind: 'unavailable', text: '' };
  if (typeof value === 'object') {
    try {
      const text = JSON.stringify(value, null, 2);
      return typeof text === 'string' ? { kind: 'value', text } : { kind: 'unavailable', text: '' };
    }
    catch { return { kind: 'unavailable', text: '' }; }
  }
  return { kind: 'value', text: String(value) };
}

// Keep keyboard menus anchored to the focused cell rather than screen coordinates (0, 0).
export function cellMenuTrigger(event: MouseEvent | KeyboardEvent) {
  if (event.defaultPrevented) return null;
  const keyboard = 'key' in event;
  if (keyboard && (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat || event.ctrlKey || event.altKey || event.metaKey ||
      !((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu'))) return null;
  const target = event.target as HTMLElement;
  if (typeof target.closest !== 'function' || target.closest('input, textarea, [contenteditable="true"]')) return null;
  const cell = target.closest<HTMLElement>('.MuiDataGrid-cell[data-field]');
  if (!cell || cell.classList.contains('MuiDataGrid-cell--editing')) return null;
  const rect = cell.getBoundingClientRect();
  event.preventDefault();
  if (keyboard) event.stopPropagation();
  const useCellPosition = keyboard || (event.clientX === 0 && event.clientY === 0);
  return { cell, x: useCellPosition ? rect.left + 8 : event.clientX, y: useCellPosition ? rect.bottom : event.clientY };
}

// Inspect only the captured grid value; never fetch a LOB or open a database editor.
export function useCellValueInspector() {
  const { t } = useTranslation();
  const [view, setView] = useState<CellSnapshot | null>(null);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const viewOpen = useRef(false);
  const origin = useRef<{ cell: HTMLElement; grid: HTMLElement | null; rowId: string | null; field: string | null } | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rememberCell = (cell: HTMLElement) => {
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    origin.current = { cell, grid: cell.closest<HTMLElement>('.MuiDataGrid-root'), rowId: cell.closest('[data-id]')?.getAttribute('data-id') ?? null, field: cell.getAttribute('data-field') };
  };
  const restoreCellFocus = () => {
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    if (!origin.current) return;
    focusTimer.current = setTimeout(() => {
      focusTimer.current = null;
      if (viewOpen.current || !origin.current) return;
      const saved = origin.current;
      let cell: HTMLElement | undefined = saved.cell.isConnected && saved.cell.getAttribute('data-field') === saved.field && saved.cell.closest('[data-id]')?.getAttribute('data-id') === saved.rowId ? saved.cell : undefined;
      if (!cell && saved.grid?.isConnected) {
        const row = Array.from(saved.grid.querySelectorAll<HTMLElement>('[data-id]')).find(element => element.getAttribute('data-id') === saved.rowId);
        cell = row && Array.from(row.querySelectorAll<HTMLElement>('[data-field]')).find(element => element.getAttribute('data-field') === saved.field);
      }
      if (cell && cell.getBoundingClientRect().width > 0 && cell.getBoundingClientRect().height > 0) cell.focus({ preventScroll: true });
    }, 0);
  };
  useEffect(() => () => {
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    origin.current = null;
  }, []);
  const describe = (cell: CellSnapshot) => describeCellValue(cell.value, cell.binary);
  const canCopy = (cell: CellSnapshot) => ['value', 'null', 'empty'].includes(describe(cell).kind);
  const copy = async (cell: CellSnapshot, inDialog = false) => {
    if (inFlight.current || !canCopy(cell)) return;
    inFlight.current = true; setCopying(true); setError('');
    try {
      const copied = await ipcRenderer.invoke('copy-to-clipboard', describe(cell).text);
      if (copied !== true) throw new Error('Clipboard copy was not confirmed.');
      notify(t('cell_value_copied'), { severity: 'success' });
    } catch {
      if (inDialog) setError(t('cell_value_copy_failed'));
      else notify(t('cell_value_copy_failed'));
    } finally { inFlight.current = false; setCopying(false); }
  };
  const menuItems = (cell: CellSnapshot | null, closeMenu: () => void) => !cell ? [] : [
    <MenuItem key="inspect-cell" onClick={() => { setError(''); viewOpen.current = true; setView(cell); closeMenu(); }}>{t('cell_value_view')}</MenuItem>,
    <MenuItem key="copy-cell" disabled={copying || !canCopy(cell)} onClick={() => { closeMenu(); restoreCellFocus(); void copy(cell); }}>{t('cell_value_copy')}</MenuItem>
  ];
  const description = view ? describe(view) : null;
  const kindMessages = { null: t('cell_value_kind_null'), empty: t('cell_value_kind_empty'), binary: t('cell_value_kind_binary'), unavailable: t('cell_value_kind_unavailable'), value: '' };
  const close = () => { if (!inFlight.current) { viewOpen.current = false; setView(null); setError(''); } };
  return { menuItems, rememberCell, restoreCellFocus, dialog: <Dialog disableRestoreFocus TransitionProps={{ onExited: restoreCellFocus }} open={view !== null} onClose={close} fullWidth maxWidth="md">
    <DialogTitle>{t('cell_value_title', { column: view?.label || '' })}</DialogTitle>
    <DialogContent>
      <Typography variant="caption" display="block" sx={{ mb: 1 }}>{t('cell_value_readonly_help')} {t('cell_value_keyboard_help')}</Typography>
      {description && description.kind !== 'value' && <Alert severity="info" sx={{ mb: 1 }}>{kindMessages[description.kind]}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      <TextField fullWidth multiline minRows={6} maxRows={20} value={description?.text || ''} label={t('cell_value_content')}
        InputProps={{ readOnly: true }} inputProps={{ 'aria-readonly': true, style: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }} />
    </DialogContent>
    <DialogActions>
      <Button disabled={copying || !view || !canCopy(view)} onClick={() => { if (view) void copy(view, true); }}>{t('cell_value_copy')}</Button>
      <Button disabled={copying} onClick={close}>{t('close')}</Button>
    </DialogActions>
  </Dialog> };
}
