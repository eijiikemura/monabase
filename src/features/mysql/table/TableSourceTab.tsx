// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import VersionControlTab from '@/features/git/VersionControlTab';
import { loadObjectReference } from '@/features/objects/objectRepository';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import { getErrorMessage } from '@/shared/utils/errorUtils';

// Tables show the actual database definition through the shared Git viewer.
// Editable/AI-assisted routine drafts remain in the separate SourceWindow.
export default function TableSourceTab({ object, active }: { object: DatabaseObject; active: boolean }) {
  const { t } = useTranslation();
  const [source, setSource] = useState(''), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const version = useRef(0), dirty = useRef(true);
  const load = useCallback(async () => {
    const request = ++version.current;
    dirty.current = false; setLoading(true); setError('');
    try {
      const reference = await loadObjectReference(object);
      if (!reference.definition.trim()) throw new Error(t('table_source_failed'));
      if (request === version.current) setSource(reference.definition);
    } catch (failure) { if (request === version.current) setError(getErrorMessage(failure)); }
    finally { if (request === version.current) setLoading(false); }
  }, [object, t]);
  useEffect(() => { const pending = version; dirty.current = true; return () => { pending.current++; }; }, [load]);
  useEffect(() => { if (active && dirty.current) void load(); }, [active, load]);
  useEffect(() => {
    const changed = (event: WindowEventMap['reload-source']) => {
      if (event.detail?.schema !== object.schema || event.detail.tableName !== object.name) return;
      dirty.current = true;
      if (active) void load();
    };
    window.addEventListener('reload-source', changed);
    return () => window.removeEventListener('reload-source', changed);
  }, [object.schema, object.name, active, load]);
  return <Box data-testid="mysql-table-source" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    {error && <Alert severity="warning" action={<Button disabled={loading} onClick={() => void load()}>{t('retry')}</Button>}>{t('table_source_failed')}</Alert>}
    <VersionControlTab dbType="MYSQL" schema={object.schema} objectType="TABLE" objectName={object.name}
      currentSource={source} isSourceLoading={loading || !source || Boolean(error)} isActive={active} onRefresh={() => void load()} />
  </Box>;
}
