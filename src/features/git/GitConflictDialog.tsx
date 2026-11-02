// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { GitConflict } from '@/shared/api/desktopContract';
import { ipcRenderer } from '@/shared/api/desktop';
import { getErrorMessage } from '@/shared/utils/errorUtils';

export default function GitConflictDialog({ onClose, onAbort, onComplete }: { onClose: () => void; onAbort: () => Promise<void>; onComplete: () => void }) {
  const { t } = useTranslation(), theme = useTheme();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<GitConflict[]>([]), [active, setActive] = useState(''), [text, setText] = useState('');
  const [message, setMessage] = useState('Merge remote changes'), [token, setToken] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  const install = useCallback((files: GitConflict[]) => { setFiles(files); setActive(files[0]?.path || ''); setText(files[0]?.working || ''); }, []);
  const load = useCallback(async () => {
    if (pending.current) return; pending.current = true; setBusy(true); setError(''); setReady(false);
    try {
      const result = await ipcRenderer.invoke('git-get-conflicts');
      if (!mounted.current) return;
      if (!result.success) throw new Error(result.error);
      install(result.files); setDrafts({}); setToken(result.token); setReady(true);
    } catch (cause: unknown) { if (mounted.current) setError(getErrorMessage(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }, [install]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, [load]);
  const resolve = async (choice: 'ours' | 'theirs' | 'manual') => {
    const file = files.find(file => file.path === active);
    if (!file || pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await ipcRenderer.invoke('git-resolve-conflict', { path: file.path, token: file.token, choice, content: drafts[file.path] ?? text });
      if (!mounted.current) return;
      if (!result.success) throw new Error(result.error);
      install(result.files); setToken(result.token);
    } catch (cause: unknown) { if (mounted.current) setError(getErrorMessage(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const complete = async () => {
    if (pending.current || !ready || files.length || !message.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      const result = await ipcRenderer.invoke('git-complete-merge', { message, token });
      if (!result.success) throw new Error(result.error);
      if (mounted.current) onComplete();
    } catch (cause: unknown) { if (mounted.current) setError(getErrorMessage(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const abort = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try { await onAbort(); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const file = files.find(file => file.path === active);
  return <Dialog open fullWidth maxWidth="xl" onClose={() => !busy && onClose()}>
    <DialogTitle>{t('git_resolve_conflicts')}</DialogTitle>
    <DialogContent>
      <Typography>{t('git_conflict_help')}</Typography>{error && <Alert severity="error">{error}</Alert>}
      <Button onClick={load} disabled={busy}>{t('refresh')}</Button>{busy && <CircularProgress size={24} />}
      <Box sx={{ display: 'flex', gap: 2 }}>
        <List sx={{ width: 280, flexShrink: 0 }}>{files.map(item => <ListItemButton key={item.path} disabled={busy} selected={item.path === active}
          onClick={() => { setActive(item.path); setText(item.working || ''); }}><ListItemText primary={item.path} /></ListItemButton>)}</List>
        {file && <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ maxHeight: '35vh', overflow: 'auto' }}><ReactDiffViewer oldValue={file.ours || ''} newValue={file.theirs || ''}
            leftTitle={file.ours === null ? t('git_ours_deleted') : t('git_ours')} rightTitle={file.theirs === null ? t('git_theirs_deleted') : t('git_theirs')} useDarkTheme={theme.palette.mode === 'dark'} /></Box>
          <TextField multiline fullWidth minRows={6} maxRows={12} label={t('git_merged_content')} value={drafts[active] ?? text} onChange={event => { setText(event.target.value); setDrafts(previous => ({ ...previous, [active]: event.target.value })); }} disabled={busy} sx={{ my: 1 }} />
          <Button disabled={busy} onClick={() => resolve('ours')}>{t(file.ours === null ? 'git_use_ours_delete' : 'git_use_ours')}</Button>
          <Button disabled={busy} onClick={() => resolve('theirs')}>{t(file.theirs === null ? 'git_use_theirs_delete' : 'git_use_theirs')}</Button>
          <Button disabled={busy} onClick={() => resolve('manual')}>{t('git_mark_resolved')}</Button>
        </Box>}
      </Box>
      {ready && !files.length && <Alert severity="success">{t('git_conflicts_resolved')}</Alert>}
      <TextField fullWidth label={t('commit_message')} value={message} onChange={event => setMessage(event.target.value)} disabled={busy} sx={{ mt: 2 }} />
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={onClose}>{t('close')}</Button><Button disabled={busy} onClick={abort}>{t('git_abort_merge')}</Button>
      <Button disabled={busy || !ready || !!files.length || !message.trim()} onClick={complete} variant="contained">{t('git_finish_merge')}</Button></DialogActions>
  </Dialog>;
}
