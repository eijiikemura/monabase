// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import DiffLayoutControls, { useDiffLayout } from '@/components/data/DiffLayoutControls';
import GitHistoryPagination from '@/features/git/GitHistoryPagination';
import { useEffect, useState, useRef } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ReactDiffViewer from 'react-diff-viewer-continued';
import type { GitObject } from '@/shared/api/desktopContract';
import type { GitRevision } from '@/shared/types/databaseTypes';
import { ipcRenderer } from '@/shared/api/desktop';
import { getErrorMessage } from '@/shared/utils/errorUtils';

export default function GitRevisionCompareDialog({ object, onClose }: { object: GitObject; onClose: () => void }) {
  const { t } = useTranslation(), theme = useTheme();
  const { splitView, setLayout } = useDiffLayout();
  const [history, setHistory] = useState<GitRevision[]>([]), [left, setLeft] = useState(''), [right, setRight] = useState('');
  const [content, setContent] = useState<{ left: string; right: string; leftId: string; rightId: string; target: string } | null>(null), [error, setError] = useState('');
  const initializedTarget = useRef('');
  const [pageRequest, setPageRequest] = useState({ target: '', page: 0, attempt: 0 });
  const [loadedPage, setLoadedPage] = useState({ target: '', page: 0 });
  const [hasMore, setHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedRevisions, setSelectedRevisions] = useState<GitRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const { dbType, schema, objectType, objectName, signature, tableName } = object;
  const target = JSON.stringify([dbType, schema, objectType, objectName, signature, tableName]);
  const requestedPage = pageRequest.target === target ? pageRequest.page : 0;
  const page = loadedPage.target === target ? loadedPage.page : 0;
  useEffect(() => {
    initializedTarget.current = '';
    setLeft(''); setRight(''); setSelectedRevisions([]); setContent(null); setHistory([]); setHasMore(false);
  }, [target]);
  useEffect(() => {
    let active = true; setError(''); setHistoryLoading(true);
    void (async () => {
      try {
        const result = await ipcRenderer.invoke('git-get-history', { dbType, schema, objectType, objectName, signature, tableName, page: requestedPage });
        if (!active) return;
        if (!result.success) throw new Error(result.error);
        setHistory(result.history); setHasMore(!!result.hasMore); setLoadedPage({ target, page: requestedPage });
        if (initializedTarget.current !== target) {
          initializedTarget.current = target;
          setLeft(result.history[1]?.fullId || result.history[0]?.fullId || ''); setRight(result.history[0]?.fullId || '');
          setSelectedRevisions(result.history.slice(0, 2));
        }
      } catch (cause: unknown) { if (active) setError(getErrorMessage(cause)); }
      finally { if (active) { setHistoryLoading(false); setLoading(false); } }
    })();
    return () => { active = false; };
  }, [dbType, schema, objectType, objectName, signature, tableName, requestedPage, pageRequest.attempt, target]);
  useEffect(() => {
    if (!left || !right) return;
    let active = true; setContent(null); setError(''); setLoading(true);
    void (async () => {
      try {
        const args = { dbType, schema, objectType, objectName, signature, tableName };
        const [a, b] = await Promise.all([ipcRenderer.invoke('git-get-file-content', { ...args, commitId: left }), ipcRenderer.invoke('git-get-file-content', { ...args, commitId: right })]);
        if (!active) return;
        if (!a.success) throw new Error(a.error);
        if (!b.success) throw new Error(b.error);
        setContent({ left: a.content, right: b.content, leftId: left, rightId: right, target: JSON.stringify(args) });
      } catch (cause: unknown) { if (active) setError(getErrorMessage(cause)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [left, right, dbType, schema, objectType, objectName, signature, tableName]);
  return <Dialog open fullWidth maxWidth="xl" onClose={onClose}>
    <DialogTitle>{t('git_compare_revisions')} — {objectName}</DialogTitle>
    <DialogContent>
      <Box sx={{ display: 'flex', gap: 2, my: 1 }}>
        {(['left', 'right'] as const).map(side => <TextField key={side} select fullWidth label={t(side === 'left' ? 'git_compare_from' : 'git_compare_to')}
          value={side === 'left' ? left : right} onChange={event => {
            const value = event.target.value;
            (side === 'left' ? setLeft : setRight)(value);
            const other = side === 'left' ? right : left;
            setSelectedRevisions([...new Map([...selectedRevisions, ...history].filter(revision =>
              revision.fullId === value || revision.fullId === other).map(revision => [revision.fullId, revision])).values()]);
          }}>
          {[...new Map([...selectedRevisions, ...history].map(revision => [revision.fullId, revision])).values()].map(revision => <MenuItem key={revision.fullId} value={revision.fullId}>{revision.id} · {revision.date} · {revision.message}</MenuItem>)}
        </TextField>)}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <DiffLayoutControls splitView={splitView} onChange={setLayout} />
        <Button size="small" disabled={!left || !right || left === right || loading || historyLoading} onClick={() => { setLeft(right); setRight(left); }}>{t('git_swap_revisions')}</Button>
      </Box>
      <GitHistoryPagination page={page} hasMore={hasMore} loading={historyLoading} onChange={next => setPageRequest(previous => ({ target, page: next, attempt: previous.attempt + 1 }))} />
      {(loading || historyLoading) && <CircularProgress size={24} />}{error && <Alert severity="error">{error}</Alert>}
      {!loading && !historyLoading && !history.length && !error && <Alert severity="info">{t('no_past_history')}</Alert>}
      {content && content.leftId === left && content.rightId === right && content.target === JSON.stringify({ dbType, schema, objectType, objectName, signature, tableName }) && <Box sx={{ maxHeight: '65vh', overflow: 'auto' }}><ReactDiffViewer splitView={splitView} oldValue={content.left} newValue={content.right}
        leftTitle={`${t('git_compare_from')}: ${left.slice(0, 7)}`} rightTitle={`${t('git_compare_to')}: ${right.slice(0, 7)}`} useDarkTheme={theme.palette.mode === 'dark'} /></Box>}
    </DialogContent>
    <DialogActions><Button onClick={onClose}>{t('close')}</Button></DialogActions>
  </Dialog>;
}
