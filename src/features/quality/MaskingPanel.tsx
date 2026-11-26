// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { defaultMaskRules, maskResult, type MaskRule, type MaskMode } from './masking';
import { validateSnapshot, type ResultSnapshot } from './resultSnapshot';
import { readQualityFile, saveQualityFile } from './qualityFiles';
import ResultPreview from './ResultPreview';
export default function MaskingPanel({ source }: { source?: ResultSnapshot }) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(source), [rules, setRules] = useState<MaskRule[]>(source ? defaultMaskRules(source) : []);
  const [secret, setSecret] = useState<string>(() => crypto.randomUUID()), [masked, setMasked] = useState<ResultSnapshot>();
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const revision = useRef(0), running = useRef(false);
  useEffect(() => { revision.current++; setSnapshot(source); setRules(source ? defaultMaskRules(source) : []); setMasked(undefined); }, [source]);
  useEffect(() => () => { revision.current++; }, []);
  const invalidate = () => { revision.current++; setMasked(undefined); setError(''); };
  const editRule = (index: number, patch: Partial<MaskRule>) => { invalidate(); setRules(previous => previous.map((rule, i) => i === index ? { ...rule, ...patch } : rule)); };
  const generate = async () => {
    if (!snapshot || running.current) return;
    const version = ++revision.current; running.current = true; setBusy(true); setError(''); setMasked(undefined);
    try { const result = await maskResult(snapshot, rules, secret); if (version === revision.current) setMasked(result); }
    catch (failure) { if (version === revision.current) setError(failure instanceof Error ? failure.message : 'quality_execution_failed'); }
    finally { running.current = false; setBusy(false); }
  };
  const importFile = async (file: File) => {
    invalidate(); const version = revision.current;
    try { const next = validateSnapshot(await readQualityFile(file)); if (version === revision.current) { setSnapshot(next); setRules(defaultMaskRules(next)); } }
    catch (failure) { if (version === revision.current) setError(failure instanceof Error ? failure.message : 'quality_invalid_document'); }
  };
  return <Box sx={{ display: 'grid', gap: 2 }}>
    <Alert severity="info">{t('quality_mask_help')}</Alert>
    <Alert severity="warning">{t('quality_mask_privacy')}</Alert>
    <Box><Button component="label" disabled={busy} variant="outlined">{t('quality_load_snapshot')}<input type="file" accept=".json" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} /></Button></Box>
    {!snapshot && <Typography>{t('quality_capture_help')}</Typography>}
    {snapshot && <>
      <TextField type="password" label={t('quality_mask_secret')} value={secret} onChange={event => { invalidate(); setSecret(event.target.value); }} helperText={t('quality_mask_secret_help')} disabled={busy} autoComplete="off" />
      <Box sx={{ display: 'grid', gap: 1, maxHeight: 300, overflow: 'auto' }}>{rules.map((rule, index) => <Box key={rule.column} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography sx={{ minWidth: 150, overflowWrap: 'anywhere' }}>{rule.column}</Typography>
        <TextField select size="small" label={t('quality_mask_rule')} value={rule.mode} disabled={busy} onChange={event => editRule(index, { mode: event.target.value as MaskMode })} sx={{ minWidth: 160 }}>
          {(['omit','keep','null','fixed','token','email'] as const).map(mode => <MenuItem key={mode} value={mode}>{t('quality_mask_' + mode)}</MenuItem>)}
        </TextField>
        {(rule.mode === 'token' || rule.mode === 'email') && <TextField size="small" label={t('quality_mask_group')} value={rule.group} onChange={event => editRule(index, { group: event.target.value })} disabled={busy} />}
        {rule.mode === 'fixed' && <TextField size="small" label={t('quality_mask_value')} value={rule.value} onChange={event => editRule(index, { value: event.target.value })} disabled={busy} />}
      </Box>)}</Box>
      <Box sx={{ display: 'flex', gap: 1 }}><Button variant="contained" disabled={busy} onClick={() => void generate()}>{t('quality_mask_generate')}</Button><Button disabled={!masked || busy} onClick={() => { if (masked) void saveQualityFile('masked-data.json', masked).catch(failure => setError(failure.message)); }}>{t('quality_mask_export')}</Button></Box>
      {masked && <ResultPreview snapshot={masked} />}
    </>}
    {error && <Alert severity="error">{t(error)}</Alert>}
  </Box>;
}
