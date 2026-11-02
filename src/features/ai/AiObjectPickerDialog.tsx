// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import ObjectPickerDialog from '../objects/ObjectPickerDialog';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { AiObjectSelectionStore } from '@/shared/types/aiTypes';

export default function AiObjectPickerDialog({ open, onClose, selection, disabled }: {
  open: boolean; onClose: () => void; selection: AiObjectSelectionStore; disabled: boolean;
}) {
  const { t } = useTranslation();
  const targets = useSyncExternalStore(selection.subscribe, selection.getSnapshot);
  const existingKeys = useMemo(() => new Set(targets.map(target => target.object.key)), [targets]);
  const isObjectAdded = useCallback((object: DatabaseObject) => existingKeys.has(object.key), [existingKeys]);
  const confirm = (objects: DatabaseObject[]) => {
    if (!selection.isAvailable()) throw new Error(t("the_target_sql_window_has_been_closed"));
    selection.addObjects(objects);
  };
  return <ObjectPickerDialog open={open} dbType={selection.dbType}
    initialSchema={selection.getInitialSchema()} title={t("add_ai_target_objects")}
    disabled={disabled || !selection.isAvailable()} isObjectAdded={isObjectAdded}
    onConfirm={confirm} onClose={onClose} />;
}
