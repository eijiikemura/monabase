// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { loadPackageInformation } from '@/features/stored/packageMetadata';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';

export default function PackageInformationTab({ schema, name }: { schema: string; name: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Awaited<ReturnType<typeof loadPackageInformation>> | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  const reload = useEventCallback(async () => {
    const request = ++generation.current; setLoading(true); setError('');
    try {
      const result = await loadPackageInformation(schema, name);
      if (request === generation.current) setData(result);
    } catch (cause) { if (request === generation.current) setError(getErrorMessage(cause)); }
    finally { if (request === generation.current) setLoading(false); }
  });
  useEffect(() => { setData(null); void reload(); const version = generation; return () => { version.current++; }; }, [schema, name, reload]);
  return <Box sx={{ p: 2, overflow: 'auto', minHeight: 0, flex: 1 }}>
    <Button variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={() => void reload()}>{t('refresh')}</Button>{loading && <CircularProgress size={20} />}
    {error && <Alert severity="error" action={<Button disabled={loading} onClick={() => void reload()}>{t('retry')}</Button>}>{error}</Alert>}
    {data && <>
      <Typography fontWeight="bold">{schema}.{name}</Typography>
      {data.status.map(status => <Typography key={status.OBJECT_TYPE}>{status.OBJECT_TYPE}: {status.STATUS} · {status.AUTHID}</Typography>)}
      {data.programs.map(program => <Box key={program.key} sx={{ mt: 2 }}>
        <Typography variant="subtitle2">{program.label}</Typography>
        <Table size="small"><TableHead><TableRow><TableCell>{t('argument_name')}</TableCell><TableCell>{t('routine_arg_type')}</TableCell><TableCell>IN / OUT</TableCell><TableCell>{t('routine_argument_default')}</TableCell></TableRow></TableHead>
          <TableBody>{data.args.filter(arg => arg.SUBPROGRAM_ID === program.SUBPROGRAM_ID).map(arg => <TableRow key={arg.POSITION}>
            <TableCell>{arg.POSITION === 0 ? t('routine_result_type') : arg.ARGUMENT_NAME}</TableCell><TableCell>{arg.TYPE_NAME ? `${arg.TYPE_OWNER}.${arg.TYPE_NAME}` : arg.DATA_TYPE}</TableCell><TableCell>{arg.POSITION === 0 ? '—' : arg.IN_OUT}</TableCell><TableCell>{arg.DEFAULTED === 'Y' ? t('yes') : '—'}</TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </Box>)}
      {(['references', 'dependents'] as const).map(key => <Box key={key} sx={{ mt: 2 }}>
        <Typography variant="subtitle2">{key === 'references' ? t('view_references') : t('view_dependents')}</Typography>
        {data[key].map(item => <Typography key={JSON.stringify(item)} variant="body2">{item.OWNER}.{item.NAME} ({item.TYPE})</Typography>)}
      </Box>)}
      <Typography variant="caption">{t('package_dependency_scope')}</Typography>
    </>}
  </Box>;
}
