// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { Box, Table, TableHead, TableBody, TableRow, TableCell, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ResultSnapshot } from './resultSnapshot';
export default function ResultPreview({ snapshot }: { snapshot: ResultSnapshot }) {
  const { t } = useTranslation();
  return <Box sx={{ overflow: 'auto', maxHeight: 300 }}>
    <Typography variant="caption">{t('quality_preview_count', { shown: Math.min(100, snapshot.rows.length), total: snapshot.rows.length })}</Typography>
    <Table size="small" stickyHeader aria-label={t('quality_preview')}>
      <TableHead><TableRow>{snapshot.columns.map(column => <TableCell key={column}>{column}</TableCell>)}</TableRow></TableHead>
      <TableBody>{snapshot.rows.slice(0, 100).map((row, index) => <TableRow key={index}>{row.map((value, i) => <TableCell key={snapshot.columns[i]} sx={{ maxWidth: 300, overflowWrap: 'anywhere' }}>{value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)}</TableCell>)}</TableRow>)}</TableBody>
    </Table>
  </Box>;
}
