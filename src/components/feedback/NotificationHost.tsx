// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Snackbar, Stack, Tooltip, Typography } from '@mui/material';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useTranslation } from 'react-i18next';
import { subscribeNotices, subscribeNotificationHistory, openNotificationHistory, type Notice } from '@/shared/utils/notifications';
import { ipcRenderer } from '@/shared/api/desktop';

export function NotificationHistoryButton() {
  const { t } = useTranslation();
  return <Tooltip title={t('ux_notifications')}>
    <IconButton size="small" aria-label={t('ux_notifications')} onClick={openNotificationHistory}><NotificationsOutlinedIcon fontSize="small" /></IconButton>
  </Tooltip>;
}

export default function NotificationHost() {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<Notice[]>([]);
  const [errors, setErrors] = useState<Notice[]>([]);
  const [successes, setSuccesses] = useState<Notice[]>([]);
  const [copiedIds, setCopiedIds] = useState<number[]>([]);
  const [copyFailedIds, setCopyFailedIds] = useState<number[]>([]);
  const [copyingIds, setCopyingIds] = useState<number[]>([]);
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => subscribeNotificationHistory(() => setListOpen(true)), []);
  useEffect(() => subscribeNotices(notice => {
    // Archived entries are informational; never retain retry callbacks from old screens.
    const archived = { ...notice };
    delete archived.onAction;
    setRecent(previous => [...previous, archived].slice(-50));
    if (notice.severity === 'error' || notice.severity === 'warning') setErrors(previous => [...previous, notice].slice(-20));
    else setSuccesses(previous => [...previous, notice].slice(-10));
  }), []);

  const current = errors.at(-1), success = successes[0];
  const dismiss = (id: number) => {
    setErrors(previous => previous.filter(row => row.id !== id));
    setCopiedIds(previous => previous.filter(value => value !== id));
    setCopyFailedIds(previous => previous.filter(value => value !== id));
  };
  const removeFromHistory = (id: number) => {
    dismiss(id);
    setSuccesses(previous => previous.filter(row => row.id !== id));
    setRecent(previous => previous.filter(row => row.id !== id));
  };
  const copyDetails = async (notice: Notice) => {
    setCopyingIds(previous => [...previous.filter(id => id !== notice.id), notice.id].slice(-20));
    setCopyFailedIds(previous => previous.filter(id => id !== notice.id));
    try {
      const result = await ipcRenderer.invoke('copy-to-clipboard', notice.message);
      setCopyFailedIds(previous => result ? previous.filter(id => id !== notice.id) : [...previous.filter(id => id !== notice.id), notice.id].slice(-20));
      setCopiedIds(previous => result ? [...previous.filter(id => id !== notice.id), notice.id].slice(-20) : previous.filter(id => id !== notice.id));
    } catch {
      setCopiedIds(previous => previous.filter(id => id !== notice.id));
      setCopyFailedIds(previous => [...previous.filter(id => id !== notice.id), notice.id].slice(-20));
    } finally {
      setCopyingIds(previous => previous.filter(id => id !== notice.id));
    }
  };
  const actions = (notice: Notice, archived = false) => <Stack alignItems="flex-end">
    <Stack direction="row" alignItems="center">
    {!archived && notice.onAction && <Button color="inherit" size="small" onClick={() => { dismiss(notice.id); notice.onAction?.(); }}>{notice.actionLabel || t('retry')}</Button>}
    <Tooltip title={copiedIds.includes(notice.id) ? t('ux_copied') : t('ux_copy_details')}>
      <IconButton size="small" color="inherit" disabled={copyingIds.includes(notice.id)} aria-label={t('ux_copy_details')} onClick={() => { void copyDetails(notice); }}><ContentCopyIcon fontSize="small" /></IconButton>
    </Tooltip>
    {copiedIds.includes(notice.id) && <Typography variant="caption" role="status">{t('ux_copied')}</Typography>}
    <Tooltip title={t(archived ? 'ux_remove_notification' : 'close')}><IconButton size="small" color="inherit" aria-label={t(archived ? 'ux_remove_notification' : 'close')} onClick={() => archived ? removeFromHistory(notice.id) : dismiss(notice.id)}><CloseIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
    {copyFailedIds.includes(notice.id) && <Typography variant="caption" role="status" sx={{ maxWidth: 160 }}>{t('ux_copy_failed_retry')}</Typography>}
  </Stack>;

  return <>
    {current && !listOpen && <Box data-testid="persistent-notification" sx={{ position: 'fixed', bottom: 12, left: 12, maxWidth: 'min(520px, calc(100vw - 24px))', zIndex: theme => theme.zIndex.snackbar }}>
      <Alert key={current.id} severity={current.severity} role="alert" action={actions(current)}
        sx={{ boxShadow: 3, '& .MuiAlert-message': { minWidth: 0, maxHeight: '30vh', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
        {current.message}
        <Box><Button size="small" color="inherit" onClick={() => setListOpen(true)}>{t('ux_notifications')} ({recent.length})</Button></Box>
      </Alert>
    </Box>}
    <Dialog open={listOpen} onClose={() => setListOpen(false)} fullWidth maxWidth="md" aria-labelledby="notification-list-title">
      <DialogTitle id="notification-list-title">{t('ux_notifications')} ({recent.length})</DialogTitle>
      <DialogContent dividers>
        {recent.length ? <Stack component="ul" spacing={1} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {[...recent].reverse().map(notice => <Box component="li" key={notice.id}>
            <Alert severity={notice.severity} role="status" action={actions(notice, true)} sx={{ '& .MuiAlert-message': { minWidth: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}><Typography component="time" dateTime={new Date(notice.createdAt).toISOString()} variant="caption" display="block" color="text.secondary">{new Date(notice.createdAt).toLocaleString()}</Typography>
              {notice.message}</Alert>
          </Box>)}
        </Stack> : <Typography color="text.secondary">{t('ux_no_notifications')}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button disabled={!recent.length} onClick={() => { setRecent([]); setErrors([]); setSuccesses([]); setCopiedIds([]); setCopyFailedIds([]); }}>{t('ux_clear_notification_history')}</Button>
        <Button onClick={() => setListOpen(false)}>{t('close')}</Button>
      </DialogActions>
    </Dialog>
    <Snackbar key={success?.id || 'empty'} open={!!success} autoHideDuration={4500}
      onClose={(_event, reason) => { if (reason !== 'clickaway') setSuccesses(previous => previous.filter(row => row.id !== success?.id)); }}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
      <Alert severity={success?.severity || 'success'} role="status" onClose={() => setSuccesses(previous => previous.filter(row => row.id !== success?.id))}>{success?.message || ''}</Alert>
    </Snackbar>
  </>;
}
