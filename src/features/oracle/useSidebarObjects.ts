// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from '@/shared/api/desktop';
import { getOracleDateFormat } from '@/shared/utils/dateFormatter';
import { qualifiedObjectName, splitObjectName } from '@/shared/utils/objectIdentity';
import { buildCategoryQuery } from './sidebarQueries';

const PAGE_SIZE = 100;

export function useSidebarObjects(outputDateFormat: string) {
  const { t } = useTranslation();
  const [expandedTypes, setExpandedTypes] = useState<string[]>([]); 
  const [loadedObjects, setLoadedObjects] = useState<{ [key: string]: string[] }>({}); 
  const [packageBodies, setPackageBodies] = useState<{ [key: string]: string[] }>({});
  const [invalidObjects, setInvalidObjects] = useState<{ [key: string]: { name: string, type: string }[] }>({});
  const [objectFilters, setObjectFilters] = useState<{ [key: string]: string }>({});
  const [hasMoreMap, setHasMoreMap] = useState<{ [key: string]: boolean }>({});
  const [loadingCategories, setLoadingCategories] = useState<string[]>([]);
  const [disabledTriggers, setDisabledTriggers] = useState<{ [key: string]: string[] }>({});
  const [indexStatuses, setIndexStatuses] = useState<{ [key: string]: { [name: string]: { status: string, visibility: string, indexType: string } } }>({});
  const [mviewRefreshDates, setMviewRefreshDates] = useState<{ [key: string]: string }>({});
  const [categoryErrors, setCategoryErrors] = useState<Record<string, string>>({});
  const appliedFilters = useRef<Record<string, string>>({});
  const activeRequests = useRef<Record<string, number>>({});
  const desiredFilters = useRef<Record<string, string>>({});
  const failedRequests = useRef<Record<string, { schema: string; type: string; filter: string; offset: number; append: boolean }>>({});
  const requestVersions = useRef<Record<string, number>>({});
  useEffect(() => () => {
    for (const key of Object.keys(requestVersions.current)) requestVersions.current[key]++;
  }, []);
  const filterDebounceTimerRef = useRef<{ [key: string]: ReturnType<typeof setTimeout> }>({});

  // Fetch database objects using execute-sql-bg.
  const fetchObjectsFromDb = async (schema: string, type: string, filterText: string, offset: number, append: boolean = false) => {
    const key = qualifiedObjectName({ schema, objectName: type });
    if (append && (filterDebounceTimerRef.current[key] || activeRequests.current[key] || appliedFilters.current[key] !== filterText || desiredFilters.current[key] !== filterText)) return;
    if (filterDebounceTimerRef.current[key]) {
      clearTimeout(filterDebounceTimerRef.current[key]); delete filterDebounceTimerRef.current[key];
    }
    desiredFilters.current[key] = filterText;
    const version = (requestVersions.current[key] ?? 0) + 1;
    requestVersions.current[key] = version;
    activeRequests.current[key] = version;
    const isCurrent = () => requestVersions.current[key] === version;
    setCategoryErrors(prev => ({ ...prev, [key]: '' }));
    setLoadingCategories(prev => [...new Set([...prev, key])]);
    try {
      const { sql, binds } = buildCategoryQuery(schema, type, filterText, offset, PAGE_SIZE);
      const res = await ipcRenderer.invoke<{ OBJECT_NAME: string }>('execute-sql-bg', sql, binds);

      if (!isCurrent()) return;

      if (res.success && Array.isArray(res.rows)) {
        appliedFilters.current[key] = filterText;
        delete failedRequests.current[key];
        const newObjs: string[] = res.rows.map((r: { OBJECT_NAME: string }) => r.OBJECT_NAME);
        setLoadedObjects(prev => ({
          ...prev,
          [key]: append ? [...(prev[key] || []), ...newObjs] : newObjs
        }));
        setHasMoreMap(prev => ({
          ...prev,
          [key]: newObjs.length >= PAGE_SIZE
        }));

        // Fetch additional status information asynchronously only when needed.
        if (type !== 'DATABASE LINK' && type !== 'SYNONYM' && type !== 'MATERIALIZED VIEW LOG' && type !== 'INDEX') { 
          fetchInvalidObjects(schema, type).then(invalidList => {
            if (!isCurrent()) return;
            setInvalidObjects(prev => ({ ...prev, [key]: invalidList }));
          });
        }

        if (type === 'TRIGGER') {
          fetchDisabledTriggers(schema).then(disabledList => {
            if (!isCurrent()) return;
            setDisabledTriggers(prev => ({ ...prev, [key]: disabledList }));
          });
        }

        if (type === 'PACKAGE') {
          const bodySql = `SELECT OBJECT_NAME FROM ALL_OBJECTS WHERE OWNER = :schema AND OBJECT_TYPE = 'PACKAGE BODY'`;
          ipcRenderer.invoke<{ OBJECT_NAME: string }>('execute-sql-bg', bodySql, { schema }).then(bodyRes => {
            if (!isCurrent()) return;
            if (bodyRes.success && bodyRes.rows) {
              setPackageBodies(prev => ({ ...prev, [key]: bodyRes.rows.map((r: { OBJECT_NAME: string }) => r.OBJECT_NAME) }));
            }
          }).catch(() => { /* Auxiliary status failures leave the object list available. */ });
        }

        if (type === 'MATERIALIZED VIEW') {
          fetchMViewRefreshDates(schema, isCurrent);
        }

        if (type === 'INDEX') {
          fetchIndexStatuses(schema).then(idxStatuses => {
            if (!isCurrent()) return;
            setIndexStatuses(prev => ({ ...prev, [key]: idxStatuses }));
          });
        }

      } else {
        throw new Error(res.error || t('sidebar_list_unavailable'));
      }
    } catch {
      if (!isCurrent()) return;
      failedRequests.current[key] = { schema, type, filter: filterText, offset, append };
      setCategoryErrors(prev => ({ ...prev, [key]: t('sidebar_list_unavailable') }));
    } finally {
      if (activeRequests.current[key] === version) delete activeRequests.current[key];
      if (isCurrent()) setLoadingCategories(prev => prev.filter(k => k !== key));
    }
  };

  const retryCategory = (key: string) => {
    const failed = failedRequests.current[key];
    if (failed && !activeRequests.current[key]) return fetchObjectsFromDb(failed.schema, failed.type, failed.filter, failed.offset, failed.append);
  };

  const fetchInvalidObjects = async (schema: string, type: string) => {
    let typeFilter = `OBJECT_TYPE = :type`;
    if (type === 'PACKAGE') {
      typeFilter = `OBJECT_TYPE IN ('PACKAGE', 'PACKAGE BODY')`;
    }
    const statusSql = `SELECT OBJECT_NAME, OBJECT_TYPE FROM ALL_OBJECTS WHERE OWNER = :schema AND ${typeFilter} AND STATUS = 'INVALID'`;
    try {
      const res = await ipcRenderer.invoke<{ OBJECT_NAME: string; OBJECT_TYPE: string }>('execute-sql-bg', statusSql, { schema, ...(type === 'PACKAGE' ? {} : { type }) });
      if (res.success && res.rows) {
        return res.rows.map((r: { OBJECT_NAME: string; OBJECT_TYPE: string }) => ({ name: r.OBJECT_NAME, type: r.OBJECT_TYPE }));
      }
    } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    return [];
  };

  const fetchDisabledTriggers = async (schema: string) => {
    const sql = `SELECT TRIGGER_NAME FROM ALL_TRIGGERS WHERE OWNER = :schema AND STATUS = 'DISABLED'`;
    try {
      const res = await ipcRenderer.invoke<{ TRIGGER_NAME: string }>('execute-sql-bg', sql, { schema });
      if (res.success && res.rows) {
        return res.rows.map((r: { TRIGGER_NAME: string }) => r.TRIGGER_NAME);
      }
    } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    return [];
  };

  const fetchIndexStatuses = async (schema: string) => {
    const sql = `SELECT INDEX_NAME, INDEX_TYPE, STATUS, VISIBILITY FROM ALL_INDEXES WHERE OWNER = :schema`;
    try {
      const res = await ipcRenderer.invoke<{ INDEX_NAME: string; STATUS: string; VISIBILITY: string; INDEX_TYPE: string }>('execute-sql-bg', sql, { schema });
      if (res.success && res.rows) {
        const statuses: { [name: string]: { status: string, visibility: string, indexType: string } } = {};
        res.rows.forEach((r: { INDEX_NAME: string; STATUS: string; VISIBILITY: string; INDEX_TYPE: string }) => {
          statuses[r.INDEX_NAME] = { status: r.STATUS, visibility: r.VISIBILITY, indexType: r.INDEX_TYPE };
        });
        return statuses;
      }
    } catch { /* Auxiliary failures must not affect the main operation's result. */ }
    return {};
  };

  const fetchMViewRefreshDates = async (schema: string, isCurrent: () => boolean = () => true) => {
    const oracleFormat = getOracleDateFormat(outputDateFormat);
    const sql = `SELECT MVIEW_NAME, TO_CHAR(LAST_REFRESH_DATE, '${oracleFormat}') AS LAST_REFRESH FROM ALL_MVIEWS WHERE OWNER = :schema`;
    try {
      const res = await ipcRenderer.invoke<{ LAST_REFRESH: string; MVIEW_NAME: string }>('execute-sql-bg', sql, { schema });
      if (!isCurrent()) return;
      if (res.success && res.rows) {
        const updates: { [key: string]: string } = {};
        res.rows.forEach((r: { LAST_REFRESH: string; MVIEW_NAME: string }) => {
          if (r.LAST_REFRESH) {
            updates[qualifiedObjectName({ schema, objectName: r.MVIEW_NAME })] = r.LAST_REFRESH;
          } else {
            updates[qualifiedObjectName({ schema, objectName: r.MVIEW_NAME })] = t("unrefreshed");
          }
        });
        setMviewRefreshDates(prev => ({ ...prev, ...updates }));
      }
    } catch { /* Auxiliary failures must not affect the main operation's result. */ }
  };

  const toggleType = async (schema: string, type: string) => {
    const key = qualifiedObjectName({ schema, objectName: type });
    if (expandedTypes.includes(key)) {
      setExpandedTypes(prev => prev.filter(k => k !== key));
      return;
    }

    setExpandedTypes(prev => [...prev, key]);

    if (!loadedObjects[key]) {
      const currentFilter = objectFilters[key] || '';
      fetchObjectsFromDb(schema, type, currentFilter, 0, false);
    }
  };

  const refreshObjects = async (schema: string, type: string) => {
    const key = qualifiedObjectName({ schema, objectName: type });
    const currentFilter = objectFilters[key] || '';
    await fetchObjectsFromDb(schema, type, currentFilter.trim(), 0, false);
  };

  const handleRefreshObjects = (e: React.MouseEvent, schema: string, type: string) => {
    e.stopPropagation();
    refreshObjects(schema, type);
  };

  const handleFilterChange = (key: string, value: string) => {
    requestVersions.current[key] = (requestVersions.current[key] ?? 0) + 1;
    setObjectFilters(prev => ({ ...prev, [key]: value }));
    desiredFilters.current[key] = value.trim();
    delete failedRequests.current[key];
    setCategoryErrors(prev => ({ ...prev, [key]: '' }));
    setLoadingCategories(prev => [...new Set([...prev, key])]);

    const [schema, type] = splitObjectName(key);
    if (!schema || !type) return;

    if (filterDebounceTimerRef.current[key]) {
      clearTimeout(filterDebounceTimerRef.current[key]);
    }

    filterDebounceTimerRef.current[key] = setTimeout(() => {
      delete filterDebounceTimerRef.current[key];
      fetchObjectsFromDb(schema, type, value.trim(), 0, false);
    }, 250);
  };

  const loadMore = (key: string) => {
    const [schema, type] = splitObjectName(key);
    if (!schema || !type) return;

    const currentList = loadedObjects[key] || [];
    const currentFilter = objectFilters[key] || '';
    fetchObjectsFromDb(schema, type, currentFilter.trim(), currentList.length, true);
  };

  const hasMore = (key: string) => !!hasMoreMap[key] && appliedFilters.current[key] === (objectFilters[key] || '').trim() && !categoryErrors[key];

  useEffect(() => {
    const timers = filterDebounceTimerRef.current;
    return () => { for (const timer of Object.values(timers)) clearTimeout(timer); };
  }, []);

  return { categoryErrors, retryCategory, expandedTypes, setExpandedTypes, loadedObjects, setLoadedObjects, packageBodies, setPackageBodies, invalidObjects, setInvalidObjects, objectFilters, setObjectFilters, hasMoreMap, setHasMoreMap, loadingCategories, setLoadingCategories, disabledTriggers, setDisabledTriggers, indexStatuses, setIndexStatuses, mviewRefreshDates, setMviewRefreshDates, fetchObjectsFromDb, fetchInvalidObjects, fetchDisabledTriggers, fetchIndexStatuses, fetchMViewRefreshDates, toggleType, refreshObjects, handleRefreshObjects, handleFilterChange, loadMore, hasMore };
}
