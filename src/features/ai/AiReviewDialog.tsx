// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import DiffLayoutControls, { useDiffLayout } from '@/components/data/DiffLayoutControls';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ReactDiffViewer from 'react-diff-viewer-continued';
import { useTranslation } from 'react-i18next';
import type { AiSourceReview } from '@/shared/types/aiTypes';

export default function AiReviewDialog({ review, summary, onSummaryChange, onApply, onDiscard }: {
  review: AiSourceReview; summary: string; onSummaryChange: (summary: string) => void;
  onApply: () => void; onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { splitView, setLayout } = useDiffLayout();
  const settings = review.afterSettings !== undefined;
  return <Dialog open maxWidth="xl" fullWidth onClose={onDiscard}>
    <DialogTitle>{t('ai_review_changes')}</DialogTitle>
    <DialogContent>
      <Typography sx={{ mb: 2 }}>{t('ai_review_explanation')}</Typography>
      <TextField fullWidth label={t('ai_change_summary')} value={summary}
        onChange={event => onSummaryChange(event.target.value)} inputProps={{ maxLength: 500 }} sx={{ mb: 2 }} />
      <Box sx={{ mb: 1 }}><DiffLayoutControls splitView={splitView} onChange={setLayout} /></Box>
      <Box sx={{ maxHeight: '65vh', overflow: 'auto' }}>
        {settings && <ReactDiffViewer splitView={splitView} oldValue={review.beforeSettings || ''} newValue={review.afterSettings || ''}
          leftTitle={t('ai_settings_before')} rightTitle={t('ai_settings_after')} useDarkTheme={theme.palette.mode === 'dark'} />}
        <ReactDiffViewer splitView={splitView} oldValue={review.before} newValue={review.after}
          leftTitle={t('ai_source_before')} rightTitle={t('ai_source_after')} useDarkTheme={theme.palette.mode === 'dark'} />
      </Box>
    </DialogContent>
    <DialogActions>
      <Button onClick={onDiscard}>{t('discard')}</Button>
      <Button variant="contained" onClick={onApply} disabled={!summary.trim()}>{t('ai_apply_changes')}</Button>
    </DialogActions>
  </Dialog>;
}
