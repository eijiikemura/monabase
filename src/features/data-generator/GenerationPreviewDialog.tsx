// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatDbDate } from '@/shared/utils/dateFormatter';
import { canonicalTemporalInput } from '@/shared/utils/temporalValues';
import type { ColumnRule } from './generatorTypes';
import type { GeneratedRow } from './useGenerationWorkflow';

export function GenerationPreviewDialog({ open, rows, columns, disabled, onClose, onRefresh, onExecute, rules = [], inputDateFormat = '', outputDateFormat = '' }: {
  open: boolean; rows: GeneratedRow[]; columns: string[]; disabled: boolean;
  rules?: ColumnRule[]; inputDateFormat?: string; outputDateFormat?: string;
  onClose: () => void; onRefresh: () => void; onExecute: () => void;
}) {
  const { t } = useTranslation();
  const displayValue = (column: string, value: unknown) => {
    const rule = rules.find(rule => rule.COLUMN_NAME === column);
    if (outputDateFormat && rule && /^(?:DATE|DATETIME|TIMESTAMP)(?:$|[ (])/i.test(rule.DATA_TYPE)) {
      const canonical = canonicalTemporalInput(value, inputDateFormat) ??
        canonicalTemporalInput(value, inputDateFormat.split(' ')[0] + ' HH:mm:ss') ??
        canonicalTemporalInput(value, inputDateFormat.split(' ')[0]);
      if (canonical) {
        const displayed = canonical.length === 10 && /^(?:TIMESTAMP|DATETIME)/i.test(rule.DATA_TYPE) ? canonical + ' 00:00:00' : canonical;
        return formatDbDate(displayed, outputDateFormat, { preserveDetails: false });
      }
    }
    return String(value);
  };
  return <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
    <DialogTitle>{t('generation_preview')}</DialogTitle>
    <DialogContent>
      <Alert severity="info">{t('generation_preview_help')}</Alert>
      {!rows.length ? <Alert severity="warning">{t('generation_preview_outdated')}</Alert> :
        <Table size="small" aria-label={t('generation_preview')}>
          <TableHead><TableRow>{columns.map(column => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
          <TableBody>{rows.map((row, index) => <TableRow key={index}>{columns.map(column => <TableCell key={column} sx={{ whiteSpace: 'pre-wrap' }}>
            {!Object.hasOwn(row, column) ? t('generation_db_default') : row[column] === null ? <strong>NULL</strong> : displayValue(column, row[column])}
          </TableCell>)}</TableRow>)}</TableBody>
        </Table>}
    </DialogContent>
    <DialogActions>
      <Button onClick={onClose}>{t('close')}</Button><Button onClick={onRefresh} disabled={disabled}>{t('generation_refresh_preview')}</Button>
      <Button onClick={onExecute} disabled={disabled || !rows.length} variant="contained">{t('execute')}</Button>
    </DialogActions>
  </Dialog>;
}
