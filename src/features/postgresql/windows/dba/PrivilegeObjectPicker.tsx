// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItemButton, ListItemText, TextField, MenuItem, Stack, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import type { PgPrivilegeTarget, PgPrivilegeType } from '@/shared/types/postgresPrivilegeTypes';
import { getPgSelectSchema, savePgSelectSchema } from '../common/schemaStorage';
const types: PgPrivilegeType[] = ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'SEQUENCE', 'FUNCTION', 'PROCEDURE'];
export function PrivilegeObjectPicker({ open, schemas, dbName, userName, disabled, onClose, onSelect }: { open: boolean; schemas: string[]; dbName: string; userName: string; disabled: boolean; onClose: () => void; onSelect: (object: PgPrivilegeTarget) => void }) {
  const { t } = useTranslation();
  const [schema, setSchema] = useState(''), [type, setType] = useState<PgPrivilegeType>('TABLE'), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: PgPrivilegeTarget[]; hasMore: boolean } | null>(null), [selected, setSelected] = useState<PgPrivilegeTarget | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const key = JSON.stringify([schema, type, search, offset]), rows = result?.key === key ? result.rows : [];
  useEffect(() => {
    if (!open) return;
    const saved = getPgSelectSchema(dbName, userName);
    setSchema(previous => schemas.includes(previous) ? previous : saved && schemas.includes(saved) ? saved : schemas.includes(userName) ? userName : schemas[0] || '');
    setOffset(0); setSearch(''); setSelected(null);
  }, [open, schemas, dbName, userName]);
  useEffect(() => {
    const version = ++generation.current; let cancelled = false;
    if (!open || !schema) { setLoading(false); return; }
    setLoading(true); setError(''); setSelected(null);
    const timer = setTimeout(() => {
      void ipcRenderer.invoke('list-postgres-privilege-objects', { schema, type, search, offset }).then(response => {
        if (cancelled || version !== generation.current) return;
        if (!response.success) { setError(response.error); return; }
        setResult({ key, rows: response.objects, hasMore: response.hasMore });
      }).catch(() => { if (!cancelled && version === generation.current) setError('pg_priv_load_failed'); }).finally(() => { if (!cancelled && version === generation.current) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, schema, type, search, offset, key, revision]);
  const blocked = disabled || loading;
  return <Dialog open={open} onClose={() => { if (!disabled) onClose(); }} maxWidth="md" fullWidth>
    <DialogTitle>{t('pg_priv_pick')}</DialogTitle><DialogContent><Stack spacing={1} sx={{ pt: 1 }}>
      <Stack direction="row" spacing={1}><TextField select size="small" label={t('schema')} value={schemas.includes(schema) ? schema : ''} disabled={blocked} sx={{ minWidth: 180 }} onChange={e => { setSchema(e.target.value); setOffset(0); setSelected(null); if (userName) savePgSelectSchema(dbName, userName, e.target.value); }}>{schemas.map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>
        <TextField select size="small" label={t('object_type')} value={type} disabled={blocked} sx={{ minWidth: 160 }} onChange={e => { setType(e.target.value as PgPrivilegeType); setOffset(0); setSelected(null); }}>{types.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
        <TextField size="small" label={t('pg_priv_object_search')} value={search} disabled={disabled} onChange={e => { setSearch(e.target.value); setOffset(0); setSelected(null); }} />
      </Stack>
      {error && <Alert severity="error" action={<Button disabled={blocked} onClick={() => setRevision(value => value + 1)}>{t('retry')}</Button>}>{t(error)}</Alert>}
      {loading && <CircularProgress size={20} />}
      <List sx={{ height: 360, overflow: 'auto' }}>{rows.map(object => <ListItemButton key={object.identity} disabled={blocked || Boolean(error)} selected={selected?.identity === object.identity} onClick={() => setSelected(object)} onDoubleClick={() => { if (!blocked && !error) onSelect(object); }}><ListItemText primary={object.label} secondary={`${object.type} / OID ${object.oid}`} /></ListItemButton>)}</List>
      {!loading && !error && !rows.length && <Alert severity="info">{t('pg_priv_empty')}</Alert>}
      <Stack direction="row" spacing={1}><Button disabled={blocked || offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 100)); setSelected(null); }}>{t('pg_priv_previous')}</Button><Button disabled={blocked || Boolean(error) || result?.key !== key || !result.hasMore} onClick={() => { setOffset(value => value + 100); setSelected(null); }}>{t('pg_priv_next')}</Button></Stack>
    </Stack></DialogContent><DialogActions><Button disabled={disabled} onClick={onClose}>{t('cancel')}</Button><Button disabled={blocked || Boolean(error) || !selected || !rows.some(object => object.identity === selected.identity)} onClick={() => { if (selected) onSelect(selected); }}>{t('select')}</Button></DialogActions>
  </Dialog>;
}
