// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { loadTypeInformation, type TypeInformation } from './typeInformation';

export function TypeInformationTab({ database, schema, name }: { database: 'oracle' | 'postgresql'; schema: string; name: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<TypeInformation | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const version = useRef(0);
  const reload = useEventCallback(async () => {
    const request = ++version.current; setLoading(true); setError('');
    try { const result = await loadTypeInformation(database, schema, name); if (request === version.current) setData(result); }
    catch (cause) { if (request === version.current) setError(getErrorMessage(cause)); }
    finally { if (request === version.current) setLoading(false); }
  });
  useEffect(() => { setData(null); void reload(); const request = version; return () => { request.current++; }; }, [database, schema, name, reload]);
  return <Box sx={{ overflow: 'auto', flex: 1, minHeight: 0, p: 2 }}>
    <Button variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={() => void reload()}>{t('refresh')}</Button>{loading && <CircularProgress size={20} />}
    {error && <Alert severity="error" action={<Button disabled={loading} onClick={() => void reload()}>{t('retry')}</Button>}>{error}</Alert>}
    {data && <>
      <Typography fontWeight="bold">{schema}.{name}</Typography><Typography>{t('type_kind')}: {data.kind}</Typography>
      {data.status.map(status => <Typography key={status}>{status}</Typography>)}
      {!!data.attributes.length && <Table size="small"><TableHead><TableRow><TableCell>{t('name')}</TableCell><TableCell>{t('routine_arg_type')}</TableCell></TableRow></TableHead><TableBody>
        {data.attributes.map(row => <TableRow key={row.name}><TableCell>{row.name}</TableCell><TableCell>{row.type}</TableCell></TableRow>)}
      </TableBody></Table>}
      {!!data.labels.length && <Box><Typography variant="subtitle2">{t('type_enum_values')}</Typography>{data.labels.map((label, index) => <Typography key={label} component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap' }}>{index + 1}. {JSON.stringify(label)}</Typography>)}</Box>}
      {!!data.methods.length && <Box><Typography variant="subtitle2">{t('type_methods')}</Typography>{data.methods.map((method, index) => <Typography key={index}>{t('type_method_summary', method)}</Typography>)}</Box>}
      {(['references', 'dependents'] as const).map(key => <Box key={key} sx={{ mt: 2 }}><Typography variant="subtitle2">{key === 'references' ? t('view_references') : t('view_dependents')}</Typography>{data[key].map(item => <Typography key={item} variant="body2">{item}</Typography>)}</Box>)}
      <Typography variant="caption">{t('type_dependency_scope')}</Typography>
      {data.body && <Box sx={{ mt: 2 }}><Typography variant="subtitle2">{t('type_body_read_only')}</Typography>
        {data.body.diagnostics.map((item, index) => <Alert key={index} severity={item.severity}>TYPE BODY Line {item.line}, Col {item.col}: {item.text}</Alert>)}
        <Box component="pre" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.85rem' }}>{data.body.source}</Box>
      </Box>}
    </>}
  </Box>;
}
