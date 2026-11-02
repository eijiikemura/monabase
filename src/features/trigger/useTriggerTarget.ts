// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { ipcRenderer } from '@/shared/api/desktop';
import { getErrorMessage } from '@/shared/utils/errorUtils';

// Each result belongs to one target. Changing targets invalidates even in-flight requests.
export function useTriggerTarget({ database, schema, table, active, onInvalidate }: {
  database: 'oracle' | 'postgresql'; schema: string; table: string; active: boolean; onInvalidate: () => void;
}) {
  const [schemas, setSchemas] = useState<string[]>(schema ? [schema] : []);
  const [columns, setColumns] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [readyKey, setReadyKey] = useState<string | null>(null);
  const generation = useRef(0);
  const key = JSON.stringify([database, schema, table]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const invalidate = useEventCallback(onInvalidate);
  const reload = useEventCallback(async () => {
    const version = ++generation.current;
    const requestKey = currentKey.current;
    setReadyKey(null); setError(''); setColumns([]);
    try {
      const schemaResult = await ipcRenderer.invoke('execute-sql-bg', database === 'oracle'
        ? 'SELECT USERNAME FROM ALL_USERS ORDER BY USERNAME'
        : 'SELECT schema_name FROM information_schema.schemata ORDER BY schema_name');
      if (!schemaResult.success) throw new Error(schemaResult.error);
      const names = schemaResult.rows.map(row => String(database === 'oracle' ? row.USERNAME : row.schema_name));
      // Include the selected schema even when a limited catalog listing omits it.
      if (schema && !names.includes(schema)) names.unshift(schema);
      let next: string[] = [];
      if (schema && table) {
        const result = await ipcRenderer.invoke('execute-sql-bg', database === 'oracle'
          ? 'SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS WHERE OWNER = :schema AND TABLE_NAME = :tableName ORDER BY COLUMN_ID'
          : 'SELECT column_name FROM information_schema.columns WHERE table_schema = :schema AND table_name = :tableName ORDER BY ordinal_position', { schema, tableName: table });
        if (!result.success) throw new Error(result.error);
        next = result.rows.map(row => String(database === 'oracle' ? row.COLUMN_NAME : row.column_name));
      }
      if (version !== generation.current || requestKey !== currentKey.current) return;
      setSchemas(names); setColumns(next); setReadyKey(schema && table ? requestKey : null);
    } catch (cause) {
      if (version === generation.current && requestKey === currentKey.current) setError(getErrorMessage(cause));
    }
  });
  const cancel = useEventCallback(() => { generation.current++; });
  useEffect(() => {
    invalidate();
    if (active) void reload();
    return cancel;
  }, [active, key, invalidate, reload, cancel]);
  return { schemaList: schemas, columnList: readyKey === key ? columns : [], targetError: error,
    targetReady: readyKey === key, reloadTarget: reload };
}
