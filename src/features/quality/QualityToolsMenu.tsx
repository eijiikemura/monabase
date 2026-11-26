// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ConnectionConfig } from '@/shared/types/appTypes';
import { closeQualityTools, getQualityConnectionEpoch, getQualitySession, openQualityTools, subscribeQualitySession } from './qualitySession';
import type { QualityDb } from './regression';
const MaskingPanel = lazy(() => import('./MaskingPanel'));
const ComparisonPanel = lazy(() => import('./ComparisonPanel'));
const RegressionPanel = lazy(() => import('./RegressionPanel'));
export default function QualityToolsMenu({ config, disabled = false }: { config: ConnectionConfig; disabled?: boolean }) {
  const { t } = useTranslation();
  const session = useSyncExternalStore(subscribeQualitySession, getQualitySession);
  const [running, setRunning] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const dbType = (config.dbType === 'postgres' ? 'postgresql' : config.dbType) as QualityDb;
  return <>
    <Button color="inherit" disabled={disabled} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(event.currentTarget)} sx={{ textTransform: 'none' }}>{t('quality_tools')}</Button>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
      {['quality_masking','quality_comparison','quality_regression'].map((key, index) => <MenuItem key={key} onClick={() => { setAnchor(null); openQualityTools(index); }}>{t(key)}</MenuItem>)}
    </Menu>
    <Dialog open={session.open} keepMounted sx={{ display: session.open ? undefined : 'none' }} PaperProps={{ role: session.open ? 'dialog' : 'presentation' }} fullWidth maxWidth="lg" onClose={(_event, reason) => { if (!running && reason !== 'backdropClick') closeQualityTools(); }}>
      <DialogTitle>{t('quality_tools')} — {config.name || config.database || config.user} ({dbType})</DialogTitle>
      <DialogContent dividers>
        <Alert severity="info" sx={{ mb: 1 }}>{t('quality_local_only')}</Alert>
        <Tabs value={session.tab} onChange={(_event, tab: number) => openQualityTools(tab)} variant="scrollable">
          {['quality_masking','quality_comparison','quality_regression'].map(key => <Tab key={key} label={t(key)} />)}
        </Tabs>
        <Suspense key={getQualityConnectionEpoch()} fallback={<CircularProgress size={24} />}>
          <Box hidden={session.tab !== 0} sx={{ pt: 2 }}><MaskingPanel source={session.snapshot} /></Box>
          <Box hidden={session.tab !== 1} sx={{ pt: 2 }}><ComparisonPanel source={session.snapshot} /></Box>
          <Box hidden={session.tab !== 2} sx={{ pt: 2 }}><RegressionPanel dbType={dbType} readonly={Boolean(config.readonly)} captured={session.stored} onBusy={setRunning} /></Box>
        </Suspense>
      </DialogContent>
      <DialogActions><Button disabled={running} onClick={closeQualityTools}>{t('close')}</Button></DialogActions>
    </Dialog>
  </>;
}
