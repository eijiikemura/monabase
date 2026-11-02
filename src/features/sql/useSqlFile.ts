// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';

export function useSqlFile({ sql, setSql }: { sql: string; setSql: (value: string) => void }) {
  const { t } = useTranslation();
  const [baseline, setBaseline] = useState(''), [filePath, setFilePath] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const mounted = useRef(true), operation = useRef(false), generation = useRef(0), previous = useRef(sql), live = useRef(sql);
  if (previous.current !== sql) { previous.current = sql; generation.current++; }
  live.current = sql;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const openFile = async () => {
    if (operation.current || (sql !== baseline && !window.confirm(t('sql_replace_unsaved')))) return;
    operation.current = true; setIsProcessing(true); const before = generation.current;
    try {
      const response = await ipcRenderer.invoke('open-sql-file');
      if (!mounted.current || generation.current !== before) return;
      if (!response.success) throw new Error(response.error);
      if (!response.canceled && typeof response.sql === 'string' && response.filePath) {
        setSql(response.sql); setBaseline(response.sql); setFilePath(response.filePath);
      }
    } catch { if (mounted.current) notify(t('sql_file_open_failed')); }
    finally { operation.current = false; if (mounted.current) setIsProcessing(false); }
  };
  const saveAs = async () => {
    if (operation.current) return;
    operation.current = true; setIsProcessing(true); const snapshot = live.current;
    try {
      const destination = await ipcRenderer.invoke('show-save-dialog', { defaultPath: filePath || 'query.sql', filters: [{ name: 'SQL (UTF-8)', extensions: ['sql'] }] });
      if (!mounted.current || destination.canceled || !destination.filePath) return;
      const response = await ipcRenderer.invoke('save-file', destination.filePath, snapshot, 'utf8');
      if (!response.success) throw new Error(response.error);
      if (mounted.current) { setFilePath(destination.filePath); setBaseline(snapshot); }
    } catch { if (mounted.current) notify(t('sql_file_save_failed')); }
    finally { operation.current = false; if (mounted.current) setIsProcessing(false); }
  };
  return { isProcessing, openFile, saveAs };
}
