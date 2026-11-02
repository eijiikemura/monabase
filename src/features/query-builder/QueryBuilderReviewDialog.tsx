// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { useQueryBuilderAi } from '@/features/ai/useQueryBuilderAi';

export default function QueryBuilderReviewDialog({ ai }: { ai: ReturnType<typeof useQueryBuilderAi> }) {
  const { t } = useTranslation();
  if (!ai.review) return null;
  return <Dialog open fullWidth maxWidth="lg" onClose={ai.discardReview}>
    <DialogTitle>{t('qb_review_title')}</DialogTitle>
    <DialogContent>
      <Typography>{t('qb_review_help')}</Typography>
      <Box sx={{ display: 'flex', gap: 2, overflow: 'auto', mt: 2 }}>
        {[{ label: t('qb_before'), sql: ai.review.beforeSql, settings: ai.review.beforeSettings },
          { label: t('qb_after'), sql: ai.review.afterSql, settings: ai.review.afterSettings }].map(side => <Box key={side.label} sx={{ flex: 1, minWidth: 300 }}>
          <Typography variant="subtitle2">{side.label}</Typography>
          <Box component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{side.sql}</Box>
          <details><summary>{t('qb_review_settings')}</summary><Box component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{side.settings}</Box></details>
        </Box>)}
      </Box>
    </DialogContent>
    <DialogActions>
      <Button onClick={ai.discardReview}>{t('discard')}</Button>
      <Button variant="contained" disabled={ai.isReviewing} onClick={ai.applyReview}>{t('qb_apply_proposal')}</Button>
    </DialogActions>
  </Dialog>;
}
