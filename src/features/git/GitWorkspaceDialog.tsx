// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import DiffLayoutControls, { useDiffLayout } from '@/components/data/DiffLayoutControls';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, List, ListItemButton, ListItemText, MenuItem, TextField, Typography } from '@mui/material';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import type { GitReviewRow } from '@/shared/api/desktopContract';
import type { DbType } from '@/shared/types/objectTypes';
import { gitSourceCategories, listGitDatabaseObjects, readGitDatabaseSource, type GitDatabaseObject } from './gitDatabaseSources';
import { getErrorMessage } from '@/shared/utils/errorUtils';

const same = (a: string | null, b: string | null) => a === b;
export default function GitWorkspaceDialog({ dbType, schema, onClose }: { dbType: DbType; schema: string; onClose: () => void }) {
  const { t } = useTranslation(), theme = useTheme();
  const { splitView, setLayout } = useDiffLayout();
  const [category, setCategory] = useState('all'), [rows, setRows] = useState<GitReviewRow[]>([]);
  const [objects, setObjects] = useState<GitDatabaseObject[]>([]), [head, setHead] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [active, setActive] = useState('');
  const [compare, setCompare] = useState('head'), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false), [scanning, setScanning] = useState(false), [error, setError] = useState(''), [onlyChanged, setOnlyChanged] = useState(true);
  const version = useRef(0), inFlight = useRef(false);
  useEffect(() => { const requests = version; requests.current++; setRows([]); setSelected([]); setError(''); return () => { requests.current++; }; }, [dbType, schema, category]);
  const refresh = async () => {
    if (inFlight.current) return;
    inFlight.current = true; const request = ++version.current; setBusy(true); setScanning(true); setError(''); setRows([]); setSelected([]);
    try {
      const list: GitDatabaseObject[] = [];
      for (const type of category === 'all' ? gitSourceCategories(dbType) : [category]) {
        if (request !== version.current) return;
        list.push(...await listGitDatabaseObjects(dbType, schema, type));
      }
      const sources = [];
      for (const object of list) {
        if (request !== version.current) return;
        sources.push(await readGitDatabaseSource(object, t));
      }
      if (request !== version.current) return;
      const result = await ipcRenderer.invoke('git-review-sources', sources);
      if (request !== version.current) return;
      if (!result.success) throw new Error(result.error);
      setObjects(list); setRows(result.rows); setHead(result.head); setSelected([]); setActive(result.rows[0]?.key || '');
    } catch (cause: unknown) { if (request === version.current) setError(getErrorMessage(cause)); }
    finally { inFlight.current = false; if (request === version.current) { setBusy(false); setScanning(false); } }
  };
  const commit = async () => {
    if (inFlight.current || !selected.length || !message.trim()) return;
    inFlight.current = true; const request = ++version.current; setBusy(true); setError('');
    try {
      const chosen = rows.filter(row => selected.includes(row.key));
      for (const row of chosen) {
        const object = objects.find(object => object.key === row.key);
        if (!object || (await readGitDatabaseSource(object, t)).sourceText !== row.sourceText) throw new Error(t('git_db_changed_refresh'));
      }
      if (request !== version.current) return;
      const result = await ipcRenderer.invoke('git-commit-sources', { head, rows: chosen, message });
      if (!result.success) throw new Error(result.error);
      setSelected([]); setMessage(''); setRows([]);
      window.dispatchEvent(new CustomEvent('git-status-changed')); notify(t('git_commit_executed'), { severity: 'success' });
    } catch (cause: unknown) { if (request === version.current) setError(getErrorMessage(cause)); }
    finally { inFlight.current = false; if (request === version.current) setBusy(false); }
  };
  const current = rows.find(row => row.key === active);
  return <Dialog open fullWidth maxWidth="xl" onClose={() => !busy && onClose()}>
    <DialogTitle>{t('git_schema_changes')} — {schema}</DialogTitle>
    <DialogContent>
      <Typography sx={{ mb: 1 }}>{t('git_schema_changes_help')}</Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <TextField select label={t('object_type')} value={category} onChange={event => setCategory(event.target.value)} disabled={busy} sx={{ minWidth: 180 }}>
          <MenuItem value="all">{t('all')}</MenuItem>
          {gitSourceCategories(dbType).map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}
        </TextField>
        <Button onClick={refresh} disabled={busy}>{t('refresh')}</Button>
        <FormControlLabel control={<Checkbox checked={onlyChanged} onChange={event => setOnlyChanged(event.target.checked)} />} label={t('git_changed_only')} />
        {scanning && <Button onClick={() => { version.current++; setBusy(false); setScanning(false); }}>{t('cancel_2')}</Button>}
        {busy && <CircularProgress size={24} />}
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 2, minHeight: 300 }}>
        <List sx={{ width: { xs: '100%', md: 350 }, maxHeight: '50vh', overflow: 'auto', flexShrink: 0 }}>
          {rows.filter(row => !onlyChanged || !same(row.sourceText, row.headSource) || !same(row.localSource, row.headSource)).map(row =>
            <ListItemButton key={row.key} selected={row.key === active} onClick={() => setActive(row.key)}>
              <Checkbox disabled={busy || same(row.sourceText, row.headSource)} checked={selected.includes(row.key)} onClick={event => event.stopPropagation()}
                onChange={event => setSelected(previous => event.target.checked ? [...previous, row.key] : previous.filter(key => key !== row.key))} />
              <ListItemText primary={row.displayName} secondary={`${row.headSource === null ? t('git_unregistered') : same(row.sourceText, row.headSource) ? t('git_matches_head') : t('git_db_changed')} · ${same(row.localSource, row.headSource) ? t('git_file_clean') : t('git_file_changed')}`} />
            </ListItemButton>)}
        </List>
        <Box sx={{ minWidth: 0, flex: 1, overflow: 'auto', maxHeight: '55vh' }}>
          {current && <>
            <TextField select label={t('git_compare_with')} value={compare} onChange={event => setCompare(event.target.value)} size="small" sx={{ mb: 1, minWidth: 240 }}>
              <MenuItem value="head">{t('git_recorded_source')}</MenuItem><MenuItem value="local">{t('git_local_file')}</MenuItem>
            </TextField>
            <Box sx={{ mb: 1 }}><DiffLayoutControls splitView={splitView} onChange={setLayout} /></Box>
            <ReactDiffViewer splitView={splitView} oldValue={(compare === 'head' ? current.headSource : current.localSource) || ''} newValue={current.sourceText}
              leftTitle={compare === 'head' ? t('git_recorded_source') : t('git_local_file')} rightTitle={t('git_database_source')} useDarkTheme={theme.palette.mode === 'dark'} />
          </>}
        </Box>
      </Box>
      <TextField fullWidth label={t('commit_message')} value={message} onChange={event => setMessage(event.target.value)} disabled={busy} sx={{ mt: 2 }} />
    </DialogContent>
    <DialogActions><Button onClick={onClose} disabled={busy}>{t('close')}</Button>
      <Button onClick={commit} disabled={busy || !selected.length || !message.trim()} variant="contained">{t('git_commit_selected', { count: selected.length })}</Button></DialogActions>
  </Dialog>;
}
