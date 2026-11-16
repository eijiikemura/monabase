// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, IconButton, Tab, Tabs, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CodeMirror from '@uiw/react-codemirror';
import { MySQL, sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import type { AiContext } from '@/shared/types/aiTypes';
import { loadObjectReference } from '@/features/objects/objectRepository';
import VersionControlTab from '@/features/git/VersionControlTab';
import AiRequestButton from '@/features/ai/AiRequestButton';
import SqlFileActions from '@/features/sql/SqlFileActions';
import { ipcRenderer } from '@/shared/api/desktop';
import { useMysqlEditorAi } from './useMysqlEditorAi';

const extensions = [sql({ dialect: MySQL })];
export default function SourceWindow({ object, tabId, active, theme, aiEnabled, onOpenAi }: {
  object: DatabaseObject; tabId: number; active: boolean; theme: string; aiEnabled: boolean; onOpenAi: (context: AiContext) => void;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState(0), [text, setText] = useState(''), [native, setNative] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const version = useRef(0), original = useRef('');
  const load = useCallback(async () => {
    const request = ++version.current;
    setLoading(true); setError('');
    const before = original.current;
    try {
      const reference = await loadObjectReference(object);
      if (request !== version.current) return;
      original.current = reference.definition; setNative(reference.definition);
      setText(previous => !before || previous === before ? reference.definition : previous);
    } catch (failure) { if (request === version.current) setError(failure instanceof Error ? failure.message : t('execution_failed')); }
    finally { if (request === version.current) setLoading(false); }
  }, [object, t]);
  useEffect(() => { const pending = version; void load(); return () => { pending.current++; }; }, [load]);
  const ai = useMysqlEditorAi({ text, setText, active, schema: object.schema, tabId, object, onOpenAi });
  const save = async () => {
    try {
      const result = await ipcRenderer.invoke('show-save-dialog', { defaultPath: object.name + '.sql', filters: [{ name: 'SQL', extensions: ['sql'] }] });
      if (result.canceled || !result.filePath) return;
      const saved = await ipcRenderer.invoke('save-file', result.filePath, text, 'utf8');
      if (!saved.success) setError(saved.error);
    } catch { setError(t('save_settings_failed')); }
  };
  return <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
    <Tabs value={panel} onChange={(_event, value: number) => setPanel(value)} sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', minHeight: 40 }}>
      <Tab label={t('source')} sx={{ minHeight: 40 }} /><Tab label="Git" sx={{ minHeight: 40 }} />
    </Tabs>
    <Alert severity="info" sx={{ py: 0 }}>{t('mysql_definition_draft_only')}</Alert>
    {error && <Alert severity="error">{error}</Alert>}
    {panel === 0 && <Box sx={{ p: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Tooltip title={t('fetch_latest_source')}><span><IconButton aria-label={t('fetch_latest_source')} onClick={() => void load()} disabled={loading || ai.isGenerating} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}><RefreshIcon /></IconButton></span></Tooltip>
        <SqlFileActions disabled={loading || ai.isGenerating} onOpen={() => { void ipcRenderer.invoke('open-sql-file').then(result => { if (!result.success) setError(result.error); else if (!result.canceled && result.sql !== undefined) setText(result.sql); }).catch(() => setError(t('execution_failed'))); }} onSaveAs={() => void save()} />
        {aiEnabled && <Tooltip title={t('ask_ai_to_create_or_modify_sql')}><span><AiRequestButton disabled={loading || !native || ai.isGenerating} onClick={ai.open} /></span></Tooltip>}
        {loading && <CircularProgress size={20} />}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        <CodeMirror value={ai.displaySql} onChange={setText} readOnly={loading || ai.isGenerating} editable={!loading && !ai.isGenerating} extensions={extensions} height="100%" style={{ position: 'absolute', inset: 0 }} theme={theme === 'dark' ? 'dark' : 'light'} />
      </Box>
    </Box>}
    {panel === 1 && <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}><VersionControlTab isActive={active} dbType="MYSQL" schema={object.schema} objectType={object.category} objectName={object.name} currentSource={text} isSourceLoading={loading || !native} onRefresh={() => void load()} /></Box>}
  </Box>;
}
