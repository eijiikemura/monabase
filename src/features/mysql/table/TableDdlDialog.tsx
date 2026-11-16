// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { buildTableDdl, type TableDdlInput } from './tableDdl';
import { autoIncrementColumn, autoIncrementMaximum, autoIncrementValue } from './tableModel';
import { loadTableMetadata } from './tableRepository';
import type { MysqlColumn, MysqlStatement, MysqlTableMetadata } from './tableModel';

export default function TableDdlDialog({ schema, table, metadata, initial, busy, failureMessage, onExecute, onClose }: {
  schema: string; table: string; metadata: MysqlTableMetadata; initial: TableDdlInput; busy: boolean; failureMessage: string;
  onExecute: (statement: MysqlStatement) => Promise<boolean>; onClose: () => void;
}) {
  const { t } = useTranslation();
  const [input, setInput] = useState(initial), [error, setError] = useState(''), [confirmation, setConfirmation] = useState('');
  const [preview, setPreview] = useState<MysqlStatement>(), [targetColumns, setTargetColumns] = useState<MysqlColumn[]>([]), [loadingTarget, setLoadingTarget] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const submitted = useRef(false);
  const autoColumn = autoIncrementColumn(metadata);
  const actionLabels = { 'auto-increment': 'mysql_auto_increment_change', 'comment': 'mysql_table_ddl_comment', 'add-column': 'mysql_table_ddl_add_column', 'rename-column': 'mysql_table_ddl_rename_column', 'drop-column': 'mysql_table_ddl_drop_column', 'drop-table': 'mysql_table_ddl_drop_table', 'add-index': 'mysql_table_ddl_add_index', 'drop-index': 'mysql_table_ddl_drop_index', 'add-check': 'mysql_table_ddl_add_check', 'drop-check': 'mysql_table_ddl_drop_check', 'add-relation': 'mysql_table_ddl_add_relation', 'drop-relation': 'mysql_table_ddl_drop_relation' };
  const update = (next: Partial<TableDdlInput>) => { setInput(previous => ({ ...previous, ...next })); setPreview(undefined); setConfirmation(''); setError(''); };
  const lock = busy || loadingTarget;
  const multiColumns = (target = false) => <TextField select SelectProps={{ multiple: true }} size="small" fullWidth label={t(target ? 'referenced_columns_multi_select' : 'target_columns_multi_select')} value={target ? input.targetColumns : input.columns} disabled={lock} onChange={event => { const values = event.target.value as unknown as string[]; update(target ? { targetColumns: values } : { columns: values }); }}>
    {(target ? targetColumns : metadata.columns).map(column => <MenuItem key={column.COLUMN_NAME} value={column.COLUMN_NAME}>{column.COLUMN_NAME}</MenuItem>)}
  </TextField>;
  const destructive = ['auto-increment', 'drop-table', 'drop-column', 'drop-index', 'drop-check', 'drop-relation'].includes(input.action);
  const nameList = input.action.includes('column') && input.action !== 'add-column' ? metadata.columns.map(column => column.COLUMN_NAME) : [];
  const loadTarget = async () => {
    setLoadingTarget(true); setError(''); setPreview(undefined);
    try { const target = await loadTableMetadata(input.targetSchema, input.targetTable); setTargetColumns(target.columns); update({ targetColumns: [] }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); }
    finally { setLoadingTarget(false); }
  };
  return <Dialog open onClose={() => { if (!lock) onClose(); }} maxWidth="md" fullWidth>
    <DialogTitle>{t(actionLabels[input.action])} · {schema}.{table}</DialogTitle>
    <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
      <Alert severity="warning">{t('mysql_table_ddl_warning')}</Alert>
      {attempted && failureMessage && <Alert severity="error">{failureMessage}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      {!['auto-increment', 'comment', 'drop-table'].includes(input.action) && (nameList.length ? <TextField select label={t('name')} size="small" value={input.name} disabled={lock || attempted} onChange={event => update({ name: event.target.value })}>{nameList.map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField> : <TextField label={t('name')} size="small" value={input.name} disabled={lock || attempted || input.action.startsWith('drop-')} onChange={event => update({ name: event.target.value })} />)}
      {input.action === 'auto-increment' && <>
        <Alert severity="warning">{t('mysql_auto_increment_warning')}</Alert>
        <Typography variant="body2">{t('mysql_auto_increment_current', { value: metadata.table.AUTO_INCREMENT ?? '—' })}</Typography>
        <TextField label={t('mysql_auto_increment_new_value')} size="small" value={input.value} disabled={lock || attempted} inputProps={{ inputMode: 'numeric', maxLength: 20 }} helperText={t('mysql_auto_increment_input_help', { max: autoColumn ? autoIncrementMaximum(autoColumn) : '—' })} onChange={event => update({ value: event.target.value })}/>
      </>}
      {['comment', 'rename-column', 'add-check'].includes(input.action) && <TextField label={t(input.action === 'comment' ? 'table_comment' : input.action === 'rename-column' ? 'new_name' : 'condition')} size="small" multiline value={input.value} disabled={lock || attempted} onChange={event => update({ value: event.target.value })} />}
      {input.action === 'add-column' && <>
        <TextField label={t('data_type')} size="small" value={input.type} placeholder="VARCHAR(100)" disabled={lock || attempted} onChange={event => update({ type: event.target.value })} helperText={t('mysql_table_add_column_help')} />
        <FormControlLabel label={t('allow_nulls')} control={<Checkbox checked={input.nullable} disabled={lock || attempted} onChange={event => update({ nullable: event.target.checked })} />} />
      </>}
      {input.action === 'add-index' && <><Box>{multiColumns()}</Box><FormControlLabel label={t('uniqueness')} control={<Checkbox checked={input.unique} disabled={lock || attempted} onChange={event => update({ unique: event.target.checked })} />} /></>}
      {input.action === 'add-relation' && <>
        {multiColumns()}
        <Box sx={{ display: 'flex', gap: 1 }}><TextField label={t('schema')} size="small" value={input.targetSchema} disabled={lock || attempted} onChange={event => { setTargetColumns([]); update({ targetSchema: event.target.value, targetColumns: [] }); }} /><TextField label={t('referenced_table')} size="small" value={input.targetTable} disabled={lock || attempted} onChange={event => { setTargetColumns([]); update({ targetTable: event.target.value, targetColumns: [] }); }} /><Button disabled={lock || attempted || !input.targetTable} onClick={() => void loadTarget()}>{t('mysql_table_load_columns')}</Button></Box>
        {multiColumns(true)}
        {(['deleteRule', 'updateRule'] as const).map(key => <TextField key={key} select size="small" label={key === 'deleteRule' ? 'ON DELETE' : 'ON UPDATE'} value={input[key]} disabled={lock || attempted} onChange={event => update({ [key]: event.target.value })}>{['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL'].map(rule => <MenuItem key={rule} value={rule}>{rule}</MenuItem>)}</TextField>)}
      </>}
      {preview && <><Typography component="pre" sx={{ whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1 }}>{preview.sql}</Typography>{Object.keys(preview.binds).length > 0 && <Typography component="pre" sx={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(preview.binds, null, 2)}</Typography>}{destructive && <TextField label={t('mysql_table_confirm_name', { name: table })} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={lock || attempted} />}</>}
      {attempted && <Alert severity="info">{t('mysql_table_ddl_attempted')}</Alert>}
    </DialogContent>
    <DialogActions><Button disabled={lock} onClick={onClose}>{t('close')}</Button><Button disabled={lock || attempted} onClick={() => { try { if(input.action==='auto-increment'&&autoIncrementValue(metadata,input.value)===String(metadata.table.AUTO_INCREMENT))throw new Error(t('mysql_auto_increment_unchanged'));setPreview(buildTableDdl(schema, table, input, metadata)); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : t('execution_failed')); } }}>{t('preview')}</Button><Button variant="contained" color={destructive ? 'error' : 'primary'} disabled={lock || attempted || !preview || destructive && confirmation !== table} onClick={() => { if (!preview || submitted.current) return; submitted.current = true; setAttempted(true); void onExecute(preview).then(success => { if (success) onClose(); else setError(t('mysql_table_ddl_attempted')); }); }}>{t('execute')}</Button></DialogActions>
  </Dialog>;
}
