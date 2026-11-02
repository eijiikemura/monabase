// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { GridViewport } from '@/features/data-grid/GridViewport';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions,
  DialogContent, DialogTitle, Typography, TextField
} from '@mui/material';
import { DataGrid, type GridColDef, type GridValueFormatterParams } from '@mui/x-data-grid';
import { formatDbDate } from "@/shared/utils/dateFormatter";
import { useTranslation } from 'react-i18next';
import ExportDialog from "@/components/data/ExportDialog";
import { getErrorMessage } from "@/shared/utils/errorUtils";

import { ipcRenderer } from "@/shared/api/desktop";

interface UsageRecord {
  requestedAt: string;
  requestType: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
}
interface HistoryResponse {
  success: boolean;
  records?: UsageRecord[];
  error?: string;
}
interface Props {
  open: boolean;
  onClose: () => void;
  outputDateFormat: string;
}

function monthValue(month: { year: number; month: number }) {
  return `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}`;
}

export function parseUsageMonth(value: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match || Number(match[1]) < 1) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

export default function AiUsageHistoryDialog({
  open, onClose, outputDateFormat
}: Props) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [monthDraft, setMonthDraft] = useState(() => monthValue(month));
  const [attempt, setAttempt] = useState(0);
  const [pagination, setPagination] = useState({ page: 0, pageSize: 25 });
  const requestKey = JSON.stringify([month.year, attempt]);
  const [data, setData] = useState<{
    key: string; status: 'loading' | 'ready' | 'error'; records: UsageRecord[]; error: string;
  }>({ key: '', status: 'loading', records: [], error: '' });
  const monthKey = monthValue(month);
  const validMonth = parseUsageMonth(monthDraft) !== null;
  const ready = data.key === requestKey && data.status === 'ready';
  const error = data.key === requestKey && data.status === 'error' ? data.error : '';
  const isLoading = data.key !== requestKey || data.status === 'loading';

  useEffect(() => {
    if (!open) { setData({ key: '', status: 'loading', records: [], error: '' }); return; }
    let active = true;
    let requestVersion = 0;
    const load = async () => {
      const version = ++requestVersion;
      setData({ key: requestKey, status: 'loading', records: [], error: '' });
      try {
        const result: HistoryResponse = await ipcRenderer.invoke('get-ai-usage-history', month.year);
        if (!active || version !== requestVersion) return;
        if (!result.success) throw new Error(result.error || t('failed_to_load_ai_usage_history'));
        setData({ key: requestKey, status: 'ready', records: result.records || [], error: '' });
      } catch (loadError: unknown) {
        if (!active || version !== requestVersion) return;
        setData({ key: requestKey, status: 'error', records: [], error: getErrorMessage(loadError) || t('failed_to_load_ai_usage_history') });
      }
    };
    const onUpdated = (_event: unknown, year: number) => { if (year === month.year) void load(); };
    ipcRenderer.on('ai-usage-history-updated', onUpdated);
    void load();
    return () => {
      active = false;
      ipcRenderer.removeListener('ai-usage-history-updated', onUpdated);
    };
  }, [open, month.year, requestKey, t]);

  const rows = useMemo(() => {
    if (!ready) return [];
    return data.records
      .map((record, index) => ({ ...record, requestType: t(record.requestType), id: `${month.year}-${index}` }))
      .filter(record => record.requestedAt.startsWith(monthKey))
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt));
  }, [data, ready, month.year, monthKey, t]);
  const exportRows = useMemo(() => rows.map(row => ({
    ...row,
    requestedAt: formatDbDate(row.requestedAt, outputDateFormat)
  })), [rows, outputDateFormat]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({
    input: sum.input + row.inputTokens,
    output: sum.output + row.outputTokens
  }), { input: 0, output: 0 }), [rows]);
  const columns = useMemo<GridColDef[]>(() => [
    {
      field: 'requestedAt',
      headerName: t("requested_at"),
      width: 190,
      valueFormatter: (params: GridValueFormatterParams<string>) =>
        formatDbDate(params.value, outputDateFormat)
    },
    { field: 'requestType', headerName: t("request"), minWidth: 180, flex: 1 },
    { field: 'modelName', headerName: t("model_name"), minWidth: 180, flex: 1 },
    { field: 'inputTokens', headerName: t("input_tokens"), type: 'number', width: 150 },
    { field: 'outputTokens', headerName: t("output_tokens"), type: 'number', width: 150 }
  ], [t, outputDateFormat]);

  const chooseMonth = (value: { year: number; month: number }) => {
    if (value.year < 1 || value.year > 9999 || value.month < 1 || value.month > 12) return;
    setMonth(value); setMonthDraft(monthValue(value)); setPagination(previous => ({ ...previous, page: 0 }));
  };
  const moveMonth = (offset: number) => {
    let year = month.year, next = month.month + offset;
    if (next === 0) { year--; next = 12; }
    if (next === 13) { year++; next = 1; }
    chooseMonth({ year, month: next });
  };

  return (
    <Dialog
      open={open} onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { height: '80vh' } }}
    >
      <DialogTitle>{t("ai_usage_history")}</DialogTitle>
      <DialogContent sx={{
        display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden'
      }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <Button
            onClick={() => moveMonth(-1)}
            disabled={month.year === 1 && month.month === 1}
          >{t("previous_month")}</Button>
          <TextField label={t('ai_usage_month')} type="month" size="small" value={monthDraft}
            InputLabelProps={{ shrink: true }} inputProps={{ min: '0001-01', max: '9999-12' }}
            error={!validMonth} helperText={!validMonth ? t('ai_usage_invalid_month', { month: monthKey }) : undefined}
            onChange={event => {
              setMonthDraft(event.target.value);
              const next = parseUsageMonth(event.target.value);
              if (next) chooseMonth(next);
            }} />
          <Button
            onClick={() => moveMonth(1)}
            disabled={month.year === 9999 && month.month === 12}
          >{t("next_month")}</Button>
          <Button onClick={() => { const now = new Date(); chooseMonth({ year: now.getFullYear(), month: now.getMonth() + 1 }); }}>{t('ai_usage_this_month')}</Button>
          <Box sx={{ flexGrow: 1 }} />
          <ExportDialog
            columns={columns} rows={exportRows} iconType="download"
            defaultFileName={`ai-usage-${monthKey}`}
            disabled={!ready || !validMonth || rows.length === 0}
          />
        </Box>
        <Box data-testid="ai-usage-totals" sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          <Typography>
            {t("total_input_tokens")}: {ready ? totals.input.toLocaleString() : '—'}
          </Typography>
          <Typography>
            {t("total_output_tokens")}: {ready ? totals.output.toLocaleString() : '—'}
          </Typography>
        </Box>
        <Typography role="status" aria-live="polite" variant="body2">{isLoading ? t('loading_data') : error ? t('ai_usage_unavailable') : t('ai_usage_record_count', { count: rows.length })}</Typography>
        {error && <Alert severity="error" action={<Button onClick={() => setAttempt(value => value + 1)}>{t('retry')}</Button>}>{error}</Alert>}
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <GridViewport active={open}><DataGrid
            rows={rows} columns={columns} loading={isLoading}
            density="compact" disableRowSelectionOnClick
            pageSizeOptions={[25, 50, 100]}
            paginationModel={{ ...pagination, page: Math.min(pagination.page, Math.max(0, Math.ceil(rows.length / pagination.pageSize) - 1)) }}
            onPaginationModelChange={setPagination}
            localeText={{
              noRowsLabel: error ? t('ai_usage_unavailable') : isLoading ? t('loading_data') : t('no_ai_usage_history_for_this_month')
            }}
          /></GridViewport>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("close")}</Button>
      </DialogActions>
    </Dialog>
  );
}
