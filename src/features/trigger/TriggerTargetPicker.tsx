// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Button, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
export function TriggerTargetPicker({ database, schema, table, type, disabled, onChange }: {
  database: 'oracle' | 'postgresql'; schema: string; table: string; type: 'TABLE' | 'VIEW'; disabled: boolean;
  onChange: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <Tooltip title={t('trigger_select_target_help')}><span><Button variant="outlined" aria-label={t('target_object_2')} disabled={disabled || !schema} onClick={() => setOpen(true)}>{table || t('target_object_2')}</Button></span></Tooltip>
    <ObjectPickerDialog open={open} dbType={database} fixedSchema={schema} categories={[type]} initialCategory={type} multiple={false} disabled={disabled}
      onClose={() => setOpen(false)} onConfirm={objects => { if (objects[0]) onChange(objects[0].name); setOpen(false); }} />
  </>;
}
