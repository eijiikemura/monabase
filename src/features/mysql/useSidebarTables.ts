// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { listMysqlObjects } from '@/features/objects/mysqlObjects';
import type { DatabaseObject } from '@/shared/types/objectTypes';

interface TablePage {
  rows?: DatabaseObject[]; filter: string; applied: string; loading: boolean; more: boolean; error: string;
}
const empty = (): TablePage => ({ filter: '', applied: '', loading: false, more: false, error: '' });

// Cache each database independently; exact database names may themselves contain dots.
export function useSidebarTables(category: 'TABLE' | 'INDEX' | 'VIEW' | 'TRIGGER' | 'PROCEDURE' | 'FUNCTION' = 'TABLE') {
  const [expanded, setExpanded] = useState<string[]>([]), [pages, setPages] = useState<Record<string, TablePage>>(Object.create(null));
  const cache = useRef<Record<string, TablePage>>(Object.create(null));
  const versions = useRef<Record<string, number>>(Object.create(null)), active = useRef<Record<string, boolean>>(Object.create(null));
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>(Object.create(null));
  const failed = useRef<Record<string, { filter: string; append: boolean }>>(Object.create(null));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const pendingTimers = timers.current;
    return () => { mounted.current = false; Object.values(pendingTimers).forEach(clearTimeout); };
  }, []);
  const update = (schema: string, next: Partial<TablePage>) => {
    if (!mounted.current) return;
    const value = { ...(cache.current[schema] || empty()), ...next };
    cache.current[schema] = value;
    setPages(previous => ({ ...previous, [schema]: value }));
  };
  const load = useEventCallback(async (schema: string, filter: string, append: boolean = false) => {
    const before = cache.current[schema] || empty();
    if (append && (active.current[schema] || timers.current[schema] || before.filter !== filter || before.applied !== filter)) return;
    clearTimeout(timers.current[schema]); delete timers.current[schema];
    const version = (versions.current[schema] || 0) + 1;
    versions.current[schema] = version; active.current[schema] = true;
    update(schema, { loading: true, error: '' });
    try {
      const rows = await listMysqlObjects(schema, category, filter, append ? before.rows?.length || 0 : 0);
      if (!mounted.current || versions.current[schema] !== version) return;
      const combined = append ? [...before.rows || [], ...rows] : rows;
      update(schema, { rows: [...new Map(combined.map(row => [row.key, row])).values()], applied: filter, more: rows.length === 100 });
      delete failed.current[schema];
    } catch (failure) {
      if (versions.current[schema] !== version) return;
      failed.current[schema] = { filter, append };
      update(schema, { error: failure instanceof Error ? failure.message : 'MySQL table list is unavailable.' });
    } finally {
      if (versions.current[schema] === version) { active.current[schema] = false; update(schema, { loading: false }); }
    }
  });
  const toggle = useEventCallback((schema: string) => {
    const opening = !expanded.includes(schema);
    setExpanded(previous => opening ? [...previous, schema] : previous.filter(name => name !== schema));
    if (opening && cache.current[schema]?.rows === undefined && !active.current[schema]) void load(schema, cache.current[schema]?.filter || '');
  });
  const filter = useEventCallback((schema: string, value: string) => {
    versions.current[schema] = (versions.current[schema] || 0) + 1;
    active.current[schema] = false;
    clearTimeout(timers.current[schema]);
    update(schema, { filter: value, loading: true, error: '' });
    timers.current[schema] = setTimeout(() => { delete timers.current[schema]; void load(schema, value); }, value ? 300 : 0);
  });
  const refresh = useEventCallback((schema: string) => { void load(schema, cache.current[schema]?.filter || ''); });
  const retry = useEventCallback((schema: string) => { const request = failed.current[schema]; if (request && !active.current[schema]) void load(schema, request.filter, request.append); });
  const more = useEventCallback((schema: string) => { const page = cache.current[schema]; if (page?.more) void load(schema, page.filter, true); });
  const refreshLoaded = useEventCallback((schema?: string) => {
    for (const name of Object.keys(cache.current)) if (!schema || name === schema) refresh(name);
  });
  useEffect(() => {
    const refreshEvent = (event: WindowEventMap['refresh-sidebar']) => { if (!event.detail.objType || event.detail.objType === category || category === 'INDEX' && event.detail.objType === 'TABLE') refreshLoaded(event.detail.schema); };
    const createdEvent = (event: WindowEventMap['table-created']) => {
      const schema = event.detail.schema;
      if (category !== 'TABLE') { refreshLoaded(schema); return; }
      setExpanded(previous => previous.includes(schema) ? previous : [...previous, schema]);
      refresh(schema);
    };
    window.addEventListener('refresh-sidebar', refreshEvent); window.addEventListener('table-created', createdEvent);
    return () => { window.removeEventListener('refresh-sidebar', refreshEvent); window.removeEventListener('table-created', createdEvent); };
  }, [category, refreshLoaded, refresh]);
  return { expanded, pages, toggle, filter, refresh, retry, more };
}
