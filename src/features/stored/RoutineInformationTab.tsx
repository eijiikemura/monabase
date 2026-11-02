// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { loadRoutineInformation, type RoutineInformation } from '@/features/stored/routineMetadata';
import type { ArgInfo } from '@/features/stored/storedCommon';
export function RoutineInformationTab({ database, schema, name, kind, signature, args }: {
  database: 'oracle' | 'postgresql'; schema: string; name: string; kind: 'PROCEDURE' | 'FUNCTION'; signature?: string; args: ArgInfo[];
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<RoutineInformation | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const reload = useEventCallback(async () => {
    const version = ++generation.current; setLoading(true); setError('');
    try { const info = await loadRoutineInformation(database, schema, name, kind, signature); if (version === generation.current) setData(info); }
    catch (cause) { if (version === generation.current) setError(getErrorMessage(cause)); }
    finally { if (version === generation.current) setLoading(false); }
  });
  useEffect(() => { setData(null); void reload(); const version = generation; return () => { version.current++; }; }, [database, schema, name, kind, signature, reload]);
  return <Box sx={{ p: 2, overflow: 'auto', minHeight: 0, flex: 1 }}>
    <Button variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={() => { void reload(); }}>{t('refresh')}</Button>{loading && <CircularProgress size={20} />}
    {error && <Alert severity="error" action={<Button disabled={loading} onClick={() => { void reload(); }}>{t('retry')}</Button>}>{error}</Alert>}
    {data && <>
      <Typography fontWeight="bold">{data.identity}</Typography>
      <Typography>{t('status')}: {data.status} · {data.language} · {data.security}</Typography>
      <Typography>{t('routine_result_type')}: {data.result}</Typography>
      <Table size="small"><TableHead><TableRow><TableCell>{t('argument_name')}</TableCell><TableCell>{t('routine_arg_type')}</TableCell><TableCell>IN / OUT</TableCell><TableCell>{t('routine_argument_default')}</TableCell></TableRow></TableHead>
        <TableBody>{args.filter(arg => arg.POSITION > 0).map(arg => <TableRow key={arg.POSITION}><TableCell>{arg.ARGUMENT_NAME}</TableCell><TableCell>{arg.DATA_TYPE}</TableCell><TableCell>{arg.IN_OUT}</TableCell><TableCell>{arg.DEFAULT_VALUE || (arg.DEFAULTED === 'Y' ? t('yes') : '—')}</TableCell></TableRow>)}</TableBody></Table>
      {(['references', 'dependents'] as const).map(key => <Box key={key} sx={{ mt: 2 }}><Typography variant="subtitle2">{key === 'references' ? t('view_references') : t('view_dependents')}</Typography>
        {data[key].map(item => <Typography key={JSON.stringify(item)} variant="body2">{item.schema}.{item.name} ({item.type})</Typography>)}</Box>)}
      <Typography variant="caption">{t('routine_dependency_scope')}</Typography>
    </>}
  </Box>;
}
