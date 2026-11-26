// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { getQualityConnectionEpoch, type QualitySession } from './qualitySession';
import { parseDocument } from './resultSnapshot';
import { runRegressionSuite, validateSuite, type QualityDb, type RegressionOutcome, type RegressionSuite } from './regression';
import { readQualityFile, saveQualityFile } from './qualityFiles';
interface Props { dbType: QualityDb; readonly: boolean; captured: QualitySession['stored']; onBusy: (busy: boolean) => void; }
export default function RegressionPanel({ dbType, readonly, captured, onBusy }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify({ format: 'monabase-regression', version: 1, dbType, cases: [] }, null, 2));
  const [name, setName] = useState(''), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [outcomes, setOutcomes] = useState<RegressionOutcome[]>([]);
  const running = useRef(false), stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);
  const setDocument = (value: unknown) => { const suite = validateSuite(value); if (suite.dbType !== dbType) throw new Error('quality_database_mismatch'); setText(JSON.stringify(suite, null, 2)); setConfirmed(false); setOutcomes([]); setError(''); };
  const action = async (callback: () => void | Promise<void>) => { setError(''); try { await callback(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'quality_execution_failed'); } };
  const add = () => {
    if (!captured) return;
    const suite = validateSuite(parseDocument(text));
    setDocument({ ...suite, cases: [...suite.cases, { id: crypto.randomUUID(), name: name.trim() || captured.request.objectName, request: captured.request, expected: captured.expected, checks: [] }] });
    setName('');
  };
  const run = async () => {
    if (running.current || !confirmed || readonly) return;
    let suite: RegressionSuite;
    try { suite = validateSuite(parseDocument(text)); } catch (failure) { setError(failure instanceof Error ? failure.message : 'quality_invalid_suite'); return; }
    running.current = true; stopped.current = false; setBusy(true); onBusy(true); setError(''); setOutcomes([]);
    try {
      const epoch = getQualityConnectionEpoch();
      const result = await runRegressionSuite(suite, dbType, {
        stored: request => ipcRenderer.invoke('execute-stored', request),
        query: (sql, binds, schema) => ipcRenderer.invoke('execute-regression-check', sql, binds, schema)
      }, () => stopped.current || epoch !== getQualityConnectionEpoch());
      setOutcomes(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'quality_execution_failed'); }
    finally { running.current = false; setBusy(false); onBusy(false); setConfirmed(false); }
  };
  return <Box sx={{ display: 'grid', gap: 2 }}>
    <Alert severity="warning">{t('quality_regression_warning')}</Alert>
    <Alert severity="info">{t('quality_regression_help')}</Alert>
    {readonly && <Alert severity="info">{t('quality_readonly')}</Alert>}
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <TextField size="small" label={t('quality_case_name')} value={name} disabled={busy} onChange={event => setName(event.target.value)} inputProps={{ maxLength: 200 }} />
      <Button variant="outlined" disabled={busy || !captured} onClick={() => void action(add)}>{t('quality_add_case')}</Button>
      <Button component="label" disabled={busy}>{t('open')}<input type="file" accept=".json" hidden disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void action(async () => setDocument(await readQualityFile(file))); }} /></Button>
      <Button disabled={busy} onClick={() => void action(async () => { const suite = validateSuite(parseDocument(text)); await saveQualityFile('stored-regression.json', suite); })}>{t('save_as')}</Button>
    </Box>
    {captured && <Typography variant="body2">{t('quality_last_execution')}: {captured.request.schema}.{captured.request.objectName}{captured.request.subProgram ? '.' + captured.request.subProgram : ''}</Typography>}
    <TextField label={t('quality_suite_json')} multiline minRows={10} maxRows={20} value={text} disabled={busy} onChange={event => { setText(event.target.value); setConfirmed(false); setOutcomes([]); }} inputProps={{ spellCheck: false, style: { fontFamily: 'monospace', fontSize: 13 } }} helperText={t('quality_suite_edit_help')} />
    <FormControlLabel control={<Checkbox checked={confirmed} disabled={busy || readonly} onChange={event => setConfirmed(event.target.checked)} />} label={t('quality_regression_confirm')} />
    <Box sx={{ display: 'flex', gap: 1 }}><Button variant="contained" disabled={busy || !confirmed || readonly} onClick={() => void run()}>{t('quality_run_suite')}</Button>
      <Button disabled={!busy} onClick={() => { stopped.current = true; }}>{t('quality_stop_after_case')}</Button>
      <Button disabled={busy || !outcomes.length} onClick={() => void action(() => saveQualityFile('regression-report.json', { dbType, outcomes }))}>{t('quality_export_report')}</Button></Box>
    {busy && <Typography role="status">{t('quality_running')}</Typography>}
    {error && <Alert severity="error">{t(error)}</Alert>}
    {outcomes.map(outcome => <Alert key={outcome.id} severity={outcome.status === 'passed' ? 'success' : outcome.status === 'not-run' ? 'info' : 'error'}>
      {outcome.name}: {t('quality_' + outcome.status)}{outcome.details.length ? ' — ' + outcome.details.map(detail => t(detail)).join('; ') : ''}
      {outcome.actual && <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto' }}>{JSON.stringify({ actual: outcome.actual, failedChecks: outcome.failedChecks }, null, 2).slice(0, 8000)}</Typography>}
    </Alert>)}
  </Box>;
}
