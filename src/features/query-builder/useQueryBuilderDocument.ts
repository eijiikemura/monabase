// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { parseQueryDocument, type QueryDocument } from '@/features/query-builder/queryBuilderModel';

export function useQueryBuilderDocument(dbType: QueryDocument['dbType']) {
  const { t } = useTranslation();
  const [document, setDocument] = useState<QueryDocument>({ version: 1, dbType, selectedSchema: '', queryTables: [], queryFields: [], queryJoins: [] });
  const [savedKey, setSavedKey] = useState(JSON.stringify(document));
  const [, refresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false), mounted = useRef(true), request = useRef(0), generation = useRef(0);
  const live = useRef(document), previous = useRef(JSON.stringify(document));
  const key = JSON.stringify(document);
  if (previous.current !== key) { generation.current++; previous.current = key; }
  live.current = document;
  const history = useRef<{ past: QueryDocument[]; current: QueryDocument; future: QueryDocument[] }>({ past: [], current: document, future: [] });
  const reset = useRef(false), dragging = useRef(false);
  const [dragRevision, setDragRevision] = useState(0);
  const finishDrag = useCallback(() => { dragging.current = false; setDragRevision(value => value + 1); }, []);
  const initializeSchema = useCallback((schema: string) => {
    if (live.current.queryTables.length || live.current.selectedSchema) return;
    const next = { ...live.current, selectedSchema: schema };
    reset.current = true; setDocument(next); setSavedKey(JSON.stringify(next));
  }, []);
  useEffect(() => {
    if (dragging.current) return;
    const state = history.current;
    if (reset.current) { history.current = { past: [], current: document, future: [] }; reset.current = false; }
    else if (JSON.stringify(state.current) !== key) history.current = { past: [...state.past, state.current].slice(-100), current: document, future: [] };
    else return;
    refresh(value => value + 1);
  }, [document, key, dragRevision]);
  useEffect(() => {
    mounted.current = true;
    const ticket = request;
    return () => { mounted.current = false; ticket.current++; };
  }, []);
  const update = useCallback(<K extends keyof QueryDocument>(field: K, value: SetStateAction<QueryDocument[K]>) => {
    if (busy.current) return;
    setDocument(old => ({ ...old, [field]: typeof value === 'function' ? (value as (old: QueryDocument[K]) => QueryDocument[K])(old[field]) : value }));
  }, []);
  const setQueryTables: Dispatch<SetStateAction<QueryDocument['queryTables']>> = useCallback(value => update('queryTables', value), [update]);
  const setQueryFields: Dispatch<SetStateAction<QueryDocument['queryFields']>> = useCallback(value => update('queryFields', value), [update]);
  const setQueryJoins: Dispatch<SetStateAction<QueryDocument['queryJoins']>> = useCallback(value => update('queryJoins', value), [update]);
  const setSelectedSchema = useCallback((value: string) => update('selectedSchema', value), [update]);
  const undo = () => {
    if (busy.current || dragging.current) return;
    const state = history.current, next = state.past.at(-1);
    if (!next) return;
    history.current = { past: state.past.slice(0, -1), current: next, future: [state.current, ...state.future] };
    setDocument(next); refresh(value => value + 1);
  };
  const redo = () => {
    if (busy.current || dragging.current) return;
    const state = history.current, next = state.future[0];
    if (!next) return;
    history.current = { past: [...state.past, state.current], current: next, future: state.future.slice(1) };
    setDocument(next); refresh(value => value + 1);
  };
  const handleImportJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || busy.current) return;
    const ticket = ++request.current, before = generation.current;
    const current = () => mounted.current && ticket === request.current && before === generation.current && !busy.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (!current()) return;
      try {
        if (typeof reader.result !== 'string') throw new Error();
        const next = parseQueryDocument(reader.result, dbType);
        reset.current = true; setDocument(next); setSavedKey(JSON.stringify(next));
      } catch { alert(t('qb_invalid_file')); }
    };
    reader.onerror = () => { if (current()) alert(t('qb_read_failed')); };
    reader.onabort = () => { if (current()) alert(t('qb_read_failed')); };
    try { reader.readAsText(file); } catch { if (current()) alert(t('qb_read_failed')); }
  };
  const handleExportJson = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    const snapshot = live.current;
    try {
      parseQueryDocument(JSON.stringify(snapshot), dbType);
      const destination = await ipcRenderer.invoke('show-save-dialog', { defaultPath: 'query-builder.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!mounted.current || destination.canceled || !destination.filePath) return;
      const result = await ipcRenderer.invoke('save-file', destination.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      if (!result.success) throw new Error();
      if (mounted.current) setSavedKey(JSON.stringify(snapshot));
    } catch { if (mounted.current) alert(t('qb_save_failed')); }
    finally { busy.current = false; if (mounted.current) setSaving(false); }
  };
  return { document, live, busy, dragging, finishDrag, initializeSchema, saving, setQueryTables, setQueryFields, setQueryJoins, setSelectedSchema,
    replace: (next: QueryDocument) => { if (!busy.current) setDocument(next); },
    isDirty: key !== savedKey, canUndo: !!history.current.past.length, canRedo: !!history.current.future.length,
    undo, redo, handleImportJson, handleExportJson };
}
