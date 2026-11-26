// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { compareResults, type Comparison } from './compareResults';
import { validateSnapshot, type ResultSnapshot } from './resultSnapshot';
import { readQualityFile, saveQualityFile } from './qualityFiles';
export default function ComparisonPanel({ source }: { source?: ResultSnapshot }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState<ResultSnapshot>(), [right, setRight] = useState<ResultSnapshot>();
  const [keys, setKeys] = useState<string[]>([]), [numeric, setNumeric] = useState(false), [result, setResult] = useState<Comparison>(), [error, setError] = useState('');
  const assign = (side: 'left' | 'right', snapshot: ResultSnapshot) => { (side === 'left' ? setLeft : setRight)(snapshot); setResult(undefined); setKeys([]); setError(''); };
  const load = async (side: 'left' | 'right', file: File) => {
    setResult(undefined); setError('');
    try { assign(side, validateSnapshot(await readQualityFile(file))); } catch (failure) { setError(failure instanceof Error ? failure.message : 'quality_invalid_document'); }
  };
  const compare = () => {
    setError(''); setResult(undefined);
    try { if (left && right) setResult(compareResults(left, right, { keys, numericStrings: numeric })); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'quality_execution_failed'); }
  };
  return <Box sx={{ display: 'grid', gap: 2 }}>
    <Alert severity="info">{t('quality_compare_help')}</Alert>
    <Alert severity="warning">{t('quality_snapshot_scope')}</Alert>
    {(['left','right'] as const).map(side => <Box key={side} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
      <Typography sx={{ width: 100 }}>{t(side === 'left' ? 'quality_before' : 'quality_after')}</Typography>
      <Button variant="outlined" disabled={!source} onClick={() => { if (source) assign(side, source); }}>{t('quality_use_current')}</Button>
      <Button component="label">{t('open')}<input type="file" accept=".json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void load(side, file); }} /></Button>
      <Button disabled={!(side === 'left' ? left : right)} onClick={() => { const snapshot = side === 'left' ? left : right; if (snapshot) void saveQualityFile(side + '-result.json', snapshot).catch(failure => setError(failure.message)); }}>{t('quality_save_snapshot')}</Button>
      {(side === 'left' ? left : right) && <Typography variant="caption">{t('quality_rows', { count: (side === 'left' ? left : right)!.rows.length })}</Typography>}
    </Box>)}
    <TextField select label={t('quality_key_columns')} value={keys} SelectProps={{ multiple: true }} onChange={event => { const value = event.target.value; setKeys(typeof value === 'string' ? value.split(',') : value); setResult(undefined); }} helperText={t('quality_key_help')}>
      {(left?.columns || []).map(column => <MenuItem key={column} value={column}>{column}</MenuItem>)}
    </TextField>
    <FormControlLabel control={<Checkbox checked={numeric} onChange={event => { setNumeric(event.target.checked); setResult(undefined); }} />} label={t('quality_numeric_strings')} />
    <Box sx={{ display: 'flex', gap: 1 }}><Button variant="contained" disabled={!left || !right} onClick={compare}>{t('quality_compare')}</Button>
      <Button disabled={!result} onClick={() => { if (result) void saveQualityFile('result-comparison.json', { columns: left?.columns, ...result }).catch(failure => setError(failure.message)); }}>{t('quality_export_report')}</Button></Box>
    {error && <Alert severity="error">{t(error)}</Alert>}
    {result && <>
      <Alert severity={result.equal ? 'success' : 'warning'}>{t(result.equal ? 'quality_equal' : 'quality_different')} — {t('quality_compare_counts', { ...result })}</Alert>
      <Box sx={{ maxHeight: 350, overflow: 'auto' }}>{result.differences.slice(0, 100).map((difference, index) => <Box key={index} sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography>{t('quality_' + difference.kind)} {difference.columns.join(', ')}</Typography>
        <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify({ before: difference.before, after: difference.after }, null, 2)}</Typography>
      </Box>)}{result.differences.length > 100 && <Typography>{t('quality_diff_preview_limit')}</Typography>}</Box>
    </>}
  </Box>;
}
