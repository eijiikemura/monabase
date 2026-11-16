// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { SelectChangeEvent } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { toPng } from 'html-to-image';
import { ipcRenderer } from '@/shared/api/desktop';
import type { TransactionState } from '@/shared/api/desktopContract';
import type { DatabaseRow } from '@/shared/types/databaseTypes';
import type { CrossTabWindowProps, ColumnInfo, CastType, LogEntry } from '@/features/cross-tab/crossTabTypes';
import { DEFAULT_COMPACT_DATE_FORMAT } from '@/shared/utils/dateFormatter';
import { getErrorMessage } from '@/shared/utils/errorUtils';
import { clearConditionInputs } from '@/shared/utils/queryConditions';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { useLoadingCounter } from '@/shared/hooks/useLoadingCounter';
import { withRowIdentity } from '@/features/data-grid/rowIdentity';
import { buildCrossTab, defaultConditions, defaultNumberGroup, initialCast, numericType, formatPivotNumber, parseCrossTabSettings, compareNumericValues, type CrossTabSettings } from './crossTabModel';
import { crossTabColumns, crossTabObjects } from './crossTabRepository';

export interface MysqlCrossTabProps extends CrossTabWindowProps {
  disabled: boolean; numberFormat: string; language: string;
  onState: (state: TransactionState) => void; onBusyChange: (busy: boolean) => void;
}
function initialSettings(schema: string): CrossTabSettings {
  return { version: 1, dbType: 'mysql', schema, objectType: 'TABLE', selectedObject: '', rowField: '', rowCastType: 'STRING', rowDateFormat: DEFAULT_COMPACT_DATE_FORMAT, rowDateGroup: 'NONE', rowNumGroup: defaultNumberGroup(),
    colField: '', colCastType: 'STRING', colDateFormat: DEFAULT_COMPACT_DATE_FORMAT, colDateGroup: 'NONE', colNumGroup: defaultNumberGroup(), valField: '', aggType: 'SUM', conditions: {} };
}
export function useCrossTabWindow(props: MysqlCrossTabProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<CrossTabSettings>(() => initialSettings(props.initialSchema));
  const [objects, setObjects] = useState<string[]>([]), [columns, setColumns] = useState<ColumnInfo[]>([]), [error, setError] = useState('');
  const [configTab, setConfigTab] = useState(0), [bottomTab, setBottomTab] = useState(0), [graphType, setGraphType] = useState<'bar'|'line'|'area'>('bar');
  const [pivotColumns, setPivotColumns] = useState<GridColDef[]>([]), [pivotRows, setPivotRows] = useState<DatabaseRow[]>([]), [logs, setLogs] = useState<LogEntry[]>([]);
  const [topHeight, setTopHeight] = useState(370), [isResizing, setIsResizing] = useState(false);
  const loading = useLoadingCounter(), { beginLoading, endLoading } = loading;
  const fileInputRef = useRef<HTMLInputElement>(null), mounted = useRef(true), revision = useRef(0), listVersion = useRef(0), fileVersion = useRef(0);
  const live = useRef({ state, columns }); live.current = { state, columns };
  const blocked = useEventCallback(() => props.disabled || loading.isBusy());
  const active = useEventCallback(() => mounted.current && props.isActive);
  const report = (failure: unknown) => { if (mounted.current) { const message = t(getErrorMessage(failure)); setError(message); alert(message); } };
  useEffect(() => { const pending = listVersion, files = fileVersion; mounted.current = true; return () => { mounted.current = false; pending.current++; files.current++; }; }, []);
  useEffect(() => {
    if (!state.schema) return;
    const request = ++listVersion.current, pending = listVersion; beginLoading(); setObjects([]); setError('');
    void crossTabObjects(state.schema, state.objectType).then(values => { if (mounted.current && pending.current === request) setObjects(values); })
      .catch(failure => { if (mounted.current && pending.current === request) setError(t(getErrorMessage(failure))); }).finally(endLoading);
    return () => { pending.current++; };
  }, [state.schema, state.objectType, beginLoading, endLoading, t]);
  useEffect(() => {
    if (!isResizing) return;
    const move = (event: MouseEvent) => setTopHeight(Math.max(250, Math.min(event.clientY - 120, window.innerHeight - 200)));
    const end = () => setIsResizing(false);
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); };
  }, [isResizing]);
  const update = <K extends keyof CrossTabSettings>(key: K, value: SetStateAction<CrossTabSettings[K]>) => {
    if (blocked()) return;
    revision.current++; setState(previous => ({ ...previous, [key]: typeof value === 'function' ? (value as (previous: CrossTabSettings[K]) => CrossTabSettings[K])(previous[key]) : value }));
  };
  const reset = (patch: Partial<CrossTabSettings>) => {
    if (blocked()) return;
    revision.current++; setState(previous => ({ ...initialSettings(previous.schema), aggType: previous.aggType,
      rowNumGroup: { ...previous.rowNumGroup, enable: false }, colNumGroup: { ...previous.colNumGroup, enable: false }, ...patch }));
    setColumns([]); setPivotColumns([]); setPivotRows([]); setConfigTab(0); setError('');
  };
  const handleChangeSchema = (event: SelectChangeEvent<string>) => { if (props.schemas.includes(event.target.value)) reset({ schema: event.target.value, objectType: state.objectType }); };
  const handleChangeObjectType = (event: SelectChangeEvent<string>) => { if (['TABLE','VIEW'].includes(event.target.value)) reset({ objectType: event.target.value as 'TABLE'|'VIEW' }); };
  const handleChangeObject = (event: SelectChangeEvent<string>) => { if (objects.includes(event.target.value)) reset({ objectType: state.objectType, selectedObject: event.target.value }); };
  const beginTask = () => { beginLoading(); props.onBusyChange(true); setError(''); };
  const endTask = () => { endLoading(); props.onBusyChange(false); };
  const handleFetchColumns = async () => {
    if (blocked() || !active() || !state.selectedObject) return;
    const snapshot = live.current.state, before = revision.current; beginTask();
    try {
      const values = await crossTabColumns(snapshot.schema, snapshot.selectedObject, snapshot.objectType);
      if (!active() || before !== revision.current) throw new Error('the_originating_window_is_unavailable');
      const first = values[0], second = values[1] || first, third = values[2] || first;
      const value = numericType(third.type) ? third : values.find(column => numericType(column.type)) || third;
      revision.current++; setColumns(values); setPivotColumns([]); setPivotRows([]);
      setState(previous => ({ ...previous, rowField: first.name, rowCastType: initialCast(first), colField: second.name, colCastType: initialCast(second), valField: value.name, aggType: numericType(value.type) ? 'SUM' : 'COUNT', conditions: defaultConditions(values) }));
    } catch (failure) { report(failure); } finally { endTask(); }
  };
  const changeAxis = (side: 'row'|'col', event: SelectChangeEvent<string>) => {
    if (blocked()) return;
    const column = columns.find(column => column.name === event.target.value); if (!column) return;
    revision.current++; setState(previous => side === 'row' ? { ...previous, rowField: column.name, rowCastType: initialCast(column), rowDateGroup: 'NONE', rowNumGroup: { ...previous.rowNumGroup, enable: false } }
      : { ...previous, colField: column.name, colCastType: initialCast(column), colDateGroup: 'NONE', colNumGroup: { ...previous.colNumGroup, enable: false } });
  };
  const changeCast = (side: 'row'|'col', value: SetStateAction<CastType>) => {
    if (blocked()) return;
    revision.current++;
    setState(previous => {
      const old = side === 'row' ? previous.rowCastType : previous.colCastType;
      const cast = typeof value === 'function' ? value(old) : value;
      return side === 'row' ? { ...previous, rowCastType: cast, rowDateGroup: ['NONE','DATE'].includes(cast) ? previous.rowDateGroup : 'NONE', rowNumGroup: { ...previous.rowNumGroup, enable: cast === 'NUMBER' && previous.rowNumGroup.enable } }
        : { ...previous, colCastType: cast, colDateGroup: ['NONE','DATE'].includes(cast) ? previous.colDateGroup : 'NONE', colNumGroup: { ...previous.colNumGroup, enable: cast === 'NUMBER' && previous.colNumGroup.enable } };
    });
  };
  const formatNumberValue = (value: unknown) => formatPivotNumber(value, props.numberFormat);
  const handleConditionChange = (name: string, key: string, value: string) => {
    if (!columns.some(column => column.name === name) || !['type','operator','value','sort'].includes(key)) return;
    update('conditions', previous => ({ ...previous, [name]: { ...previous[name], [key]: value } }));
  };
  const mainRows = async (sql: string, binds: Record<string, unknown>) => {
    let response;
    try { response = await ipcRenderer.invoke('execute-sql', sql, binds); }
    catch (failure) { props.onState({ transactionStatus: 'unknown' }); throw failure; }
    props.onState(response); if (!response.success) throw new Error(response.error);
    return response.rows;
  };
  const handleGeneratePivot = async () => {
    if (blocked() || !active() || !state.rowField || !state.colField || !state.valField) return;
    const snapshot = live.current, before = revision.current, timestamp = new Date().toLocaleString(), started = Date.now(); let sql = '';
    beginTask();
    try {
      const query = buildCrossTab(snapshot.state, snapshot.columns, props.inputDateFormat);
      const current = () => { if (!active() || before !== revision.current) throw new Error('the_originating_window_is_unavailable'); };
      if (query.validation) { sql = query.validation; const invalid = await mainRows(sql, query.binds); current(); if (invalid.length) throw new Error('mysql_cross_tab_invalid_cast'); }
      sql = query.distinct; const distinct = await mainRows(sql, query.binds); current();
      const categories = distinct.map(row => { if (row.COL_VAL == null) throw new Error('mysql_cross_tab_result_invalid'); return String(row.COL_VAL); });
      if (!categories.length) throw new Error('no_data_matches_the_specified_filter_condition');
      if (categories.length > 200) throw new Error(t('cross_tab_category_limit', { count: categories.length }));
      const pivot = query.pivot(categories); sql = pivot.sql; const rows = await mainRows(sql, pivot.binds); current();
      if (rows.some(row => !Object.hasOwn(row, 'ROW_VALUE') || categories.some((_, index) => !Object.hasOwn(row, 'pivot_' + index)))) throw new Error('mysql_cross_tab_result_invalid');
      const valueType = snapshot.columns.find(column => column.name === snapshot.state.valField)!.type;
      const numeric = ['COUNT','SUM','AVG'].includes(snapshot.state.aggType) || numericType(valueType);
      const resultColumns: GridColDef[] = [{ field: 'ROW_VALUE', headerName: snapshot.state.rowField, width: 220 }, ...categories.map((name, index): GridColDef => ({ field: 'pivot_' + index, headerName: name, width: 150,
        ...(numeric ? { type: 'number', sortComparator: compareNumericValues, valueFormatter: (params: { value: unknown }) => formatNumberValue(params.value) } : {}) }))];
      setPivotColumns(resultColumns); setPivotRows(rows.map((row, index) => withRowIdentity({ ...row }, index)));
      setLogs(previous => [{ time: timestamp, sql, execTime: Date.now() - started, resultMsg: t('aggregated_rows', { count: rows.length }) }, ...previous]); setBottomTab(0);
    } catch (failure) {
      if (mounted.current) { const message = t(getErrorMessage(failure)); setLogs(previous => [{ time: timestamp, sql, execTime: '-', resultMsg: t('error_occurred'), errorLines: [message] }, ...previous]); report(failure); setBottomTab(2); }
    } finally { endTask(); }
  };
  const handleExportSettings = async () => {
    if (blocked() || !active() || !columns.length) return;
    const snapshot = live.current; beginTask();
    try {
      const parsed = parseCrossTabSettings(snapshot.state, snapshot.columns);
      const destination = await ipcRenderer.invoke('show-save-dialog', { title: t('save_cross_tab_settings'), defaultPath: `Crosstab_${parsed.schema}_${parsed.selectedObject}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!active() || destination.canceled || !destination.filePath) return;
      const saved = await ipcRenderer.invoke('save-file', destination.filePath, JSON.stringify(parsed, null, 2), 'utf8'); if (!saved.success) throw new Error(saved.error);
      if (mounted.current) alert(t('cross_tab_settings_saved'));
    } catch (failure) { report(failure); } finally { endTask(); }
  };
  const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || blocked() || !active()) return;
    if (file.size > 1024 * 1024) { report(new Error('mysql_cross_tab_file_limit')); return; }
    const request = ++fileVersion.current, before = revision.current;
    const valid = () => active() && request === fileVersion.current && before === revision.current;
    const reader = new FileReader();
    reader.onload = async () => {
      if (!valid() || blocked()) { report(new Error('mysql_cross_tab_settings_outdated')); return; }
      beginTask();
      try {
        const parsed: unknown = JSON.parse(String(reader.result));
        if (!parsed || typeof parsed !== 'object' || !('schema' in parsed) || typeof parsed.schema !== 'string' || !props.schemas.includes(parsed.schema) || !('selectedObject' in parsed) || typeof parsed.selectedObject !== 'string' || !('objectType' in parsed) || !['TABLE','VIEW'].includes(String(parsed.objectType)) || !('version' in parsed) || parsed.version !== 1 || !('dbType' in parsed) || parsed.dbType !== 'mysql') throw new Error('mysql_cross_tab_invalid_settings');
        const values = await crossTabColumns(parsed.schema, parsed.selectedObject, String(parsed.objectType));
        const next = parseCrossTabSettings(parsed, values); if (!valid()) throw new Error('mysql_cross_tab_settings_outdated');
        revision.current++; setState(next); setColumns(values); setPivotColumns([]); setPivotRows([]); setConfigTab(0);
        alert(t('settings_restored_click_execute_cross_tab_to_see_results'));
      } catch (failure) { report(failure); } finally { endTask(); }
    };
    reader.onerror = reader.onabort = () => { if (valid()) report(new Error('file_load_error')); };
    try { reader.readAsText(file); } catch (failure) { report(failure); }
  };
  const handleCopyGraph = async () => {
    if (blocked() || !active() || !pivotRows.length) return;
    const element = document.getElementById(`mysql-cross-tab-${props.tabId}`); if (!element) { report(new Error('no_chart_found_to_copy')); return; }
    beginTask();
    try {
      const data = await toPng(element, { backgroundColor: '#ffffff', pixelRatio: 2 });
      const blob = await (await fetch(data)).blob();
      if (!active()) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      if (mounted.current) alert(t('chart_image_copied_to_clipboard'));
    } catch (failure) { report(failure); } finally { endTask(); }
  };
  return { t, ...state, objects, columns, error, isLoading: loading.isLoading || props.disabled,
    configTab, setConfigTab, bottomTab, setBottomTab, graphType, setGraphType, logs, setLogs, pivotColumns, pivotRows, topHeight, isResizing, setIsResizing, fileInputRef,
    rowCastType: state.rowCastType, setRowCastType: (value: SetStateAction<CastType>) => changeCast('row', value), setColCastType: (value: SetStateAction<CastType>) => changeCast('col', value),
    setRowDateFormat: (value: SetStateAction<string>) => update('rowDateFormat', value), setColDateFormat: (value: SetStateAction<string>) => update('colDateFormat', value),
    setRowDateGroup: (value: SetStateAction<string>) => update('rowDateGroup', value), setColDateGroup: (value: SetStateAction<string>) => update('colDateGroup', value),
    setRowNumGroup: (value: SetStateAction<typeof state.rowNumGroup>) => update('rowNumGroup', value), setColNumGroup: (value: SetStateAction<typeof state.colNumGroup>) => update('colNumGroup', value),
    setValField: (value: SetStateAction<string>) => update('valField', value), setAggType: (value: SetStateAction<typeof state.aggType>) => update('aggType', value),
    getInitialCastType: initialCast, handleChangeSchema, handleChangeObjectType, handleChangeObject, handleFetchColumns,
    handleRowFieldChange: (event: SelectChangeEvent<string>) => changeAxis('row', event), handleColFieldChange: (event: SelectChangeEvent<string>) => changeAxis('col', event),
    handleClearConditions: () => update('conditions', clearConditionInputs), handleConditionChange,
    handleGeneratePivot, handleExportSettings, handleImportFileChange, handleCopyGraph, formatNumberValue };
}
