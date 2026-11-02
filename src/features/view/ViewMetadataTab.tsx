// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import RefreshIcon from '@mui/icons-material/Refresh';
import { Alert, Box, Button, CircularProgress, Paper, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { ViewMetadata, ViewDependency } from '@/features/view/viewMetadata';
export function ViewMetadataTab({ data, error, loading, onRefresh }: {
  data: ViewMetadata | null; error: string; loading: boolean; onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const dependencies = (items: ViewDependency[]) => <Table size="small"><TableHead><TableRow><TableCell>{t('schema')}</TableCell><TableCell>{t('name')}</TableCell><TableCell>{t('type')}</TableCell></TableRow></TableHead>
    <TableBody>{items.map(item => <TableRow key={JSON.stringify([item.schema, item.name, item.type])}><TableCell>{item.schema}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.type}</TableCell></TableRow>)}</TableBody></Table>;
  return <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
    <Button variant="outlined" startIcon={<RefreshIcon />} disabled={loading} onClick={onRefresh}>{t('refresh')}</Button>
    {loading && <CircularProgress size={20} />}
    {error && <Alert severity="error" action={<Button disabled={loading} onClick={onRefresh}>{t('retry')}</Button>}>{error}</Alert>}
    {data && <>
      <Typography>{t('status')}: {data.status}</Typography>
      <Typography variant="subtitle2">{t('view_columns')}</Typography>
      <Paper variant="outlined"><Table size="small"><TableHead><TableRow><TableCell>{t('name')}</TableCell><TableCell>{t('type')}</TableCell><TableCell>NULL</TableCell></TableRow></TableHead>
        <TableBody>{data.columns.map(col => <TableRow key={col.name}><TableCell>{col.name}</TableCell><TableCell>{col.type}</TableCell><TableCell>{col.nullable}</TableCell></TableRow>)}</TableBody></Table></Paper>
      <Typography variant="subtitle2" sx={{ mt: 2 }}>{t('view_references')}</Typography>{dependencies(data.references)}
      <Typography variant="subtitle2" sx={{ mt: 2 }}>{t('view_dependents')}</Typography>{dependencies(data.dependents)}
      <Typography variant="caption">{t('view_dependency_scope')}</Typography>
    </>}
  </Box>;
}
