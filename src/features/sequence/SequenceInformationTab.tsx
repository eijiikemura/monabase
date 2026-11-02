// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { readSequenceMetadata, readSequenceUsage } from './sequenceMetadata';
import type { SequenceDatabase } from './sequenceModel';
export async function loadSequenceInformation(database: SequenceDatabase, schema: string, name: string) {
  const [metadata, usage] = await Promise.all([readSequenceMetadata(database, schema, name), readSequenceUsage(database, schema, name)]);
  return { metadata, usage };
}
export function SequenceInformationTab({ database, schema, name }: { database: SequenceDatabase; schema: string; name: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadSequenceInformation>> | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const reload = useEventCallback(async () => {
    const version = ++generation.current; setLoading(true); setError('');
    try { const result = await loadSequenceInformation(database, schema, name); if (version === generation.current) setData(result); }
    catch (cause) { if (version === generation.current) setError(getErrorMessage(cause).startsWith('sequence_') ? t(getErrorMessage(cause)) : getErrorMessage(cause)); }
    finally { if (version === generation.current) setLoading(false); }
  });
  useEffect(() => { setData(null); void reload(); const version = generation; return () => { version.current++; }; }, [database, schema, name, reload]);
  return <Box sx={{ p: 2, flex: 1, minHeight: 0, overflow: 'auto' }}>
    <Button variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={() => void reload()}>{t('refresh')}</Button>{loading && <CircularProgress size={20} />}
    {error && <Alert severity="error" action={<Button disabled={loading} onClick={() => void reload()}>{t('retry')}</Button>}>{error}</Alert>}
    {data && <>
      <Typography fontWeight="bold">{schema}.{name}</Typography>
      <Typography>{t('routine_arg_type')}: {data.metadata.settings.dataType}</Typography>
      {Object.entries(data.metadata.settings).filter(([key]) => key !== 'dataType' && (database === 'oracle' || !['order', 'keep', 'session'].includes(key))).map(([key, value]) => <Typography key={key}>{t('sequence_setting_' + key)}: {typeof value === 'boolean' ? t(value ? 'yes' : 'no') : value}</Typography>)}
      <Typography>{t('sequence_observed_value')}: {data.metadata.observed ?? t('sequence_value_unknown')}</Typography>
      <Typography variant="caption">{t('sequence_value_cache_note')}</Typography>
      <Typography variant="subtitle2" sx={{ mt: 2 }}>{t('sequence_owned_by')}</Typography>
      <Typography>{data.usage.owner ? `${data.usage.owner.schema}.${data.usage.owner.table}.${data.usage.owner.column}${data.usage.owner.identity ? ' (IDENTITY)' : ''}` : t('none')}</Typography>
      <Typography variant="subtitle2" sx={{ mt: 2 }}>{t('view_dependents')}</Typography>
      {data.usage.dependents.map(item => <Typography key={item}>{item}</Typography>)}
      <Typography variant="caption">{t('sequence_dependency_scope')}</Typography>
    </>}
  </Box>;
}
