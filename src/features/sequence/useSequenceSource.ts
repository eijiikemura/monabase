// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { readSequenceSource } from './sequenceMetadata';
import type { SequenceDatabase } from './sequenceModel';
export interface SequenceWindowProps { tabId: number; schema: string; sequenceName: string; isNew: boolean; isActive: boolean; }
export function useSequenceSource(database: SequenceDatabase, props: SequenceWindowProps) {
  const { schema, sequenceName, isNew, isActive } = props;
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(0), [sourceText, setSourceText] = useState(''), [sourceError, setSourceError] = useState(''), [sourceReady, setSourceReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0), [isStructureLoading, setIsStructureLoading] = useState(false);
  const { isLoading: isSourceLoading, beginLoading, endLoading } = useLoadingCounter();
  const generation = useRef(0);
  const loadSource = useEventCallback(async () => {
    const request = ++generation.current; setSourceError(''); setSourceReady(false); beginLoading();
    try {
      const result = await readSequenceSource(database, schema, sequenceName);
      if (request === generation.current) { setSourceText(result); setSourceReady(true); }
    } catch (error) { if (request === generation.current) setSourceError(getErrorMessage(error).startsWith('sequence_') ? t(getErrorMessage(error)) : getErrorMessage(error)); }
    finally { endLoading(); }
  });
  useEffect(() => { setSourceText(''); setSourceReady(false); setSourceError(''); const version = generation; return () => { version.current++; }; }, [database, schema, sequenceName, isNew]);
  useEffect(() => { if (isActive && !isNew && sequenceName) void loadSource(); }, [isActive, isNew, schema, sequenceName, reloadKey, loadSource]);
  const handleReload = useEventCallback(() => setReloadKey(previous => previous + 1));
  const copySource = useEventCallback(async () => {
    if (!sourceReady || isSourceLoading) return;
    try { await navigator.clipboard.writeText(sourceText); }
    catch (error) { alert(t('sequence_copy_failed', { error: getErrorMessage(error) })); }
  });
  return { activeTab, setActiveTab, sourceText, sourceError, sourceReady, loadSource, copySource, handleReload, reloadKey, setReloadKey, setSourceText,
    isLoading: isSourceLoading || isStructureLoading, setIsStructureLoading };
}
