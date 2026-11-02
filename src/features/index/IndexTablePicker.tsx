// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Button, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
export function IndexTablePicker({ database, schema, table, disabled, onChange }: {
  database: 'oracle' | 'postgresql'; schema: string; table: string; disabled: boolean; onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <Tooltip title={t('index_select_table_help')}><span><Button variant="outlined" aria-label={t('select_table')} disabled={disabled || !schema} onClick={() => setOpen(true)}>{table || t('select_table')}</Button></span></Tooltip>
    <ObjectPickerDialog open={open} dbType={database} fixedSchema={schema} categories={['TABLE']} initialCategory="TABLE" multiple={false} disabled={disabled}
      onClose={() => setOpen(false)} onConfirm={objects => { if (objects[0]) onChange(objects[0].name); setOpen(false); }} />
  </>;
}
