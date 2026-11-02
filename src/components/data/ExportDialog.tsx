// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { spreadsheetText, excelCell } from '@/shared/utils/spreadsheetText';
import type { ExportDataFetcher } from '@/features/table/exportSnapshot';
import type { GridColDef } from '@mui/x-data-grid';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useEffect, useRef } from 'react';
import { 
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  FormControl, FormLabel, RadioGroup, FormControlLabel, Radio,
  TextField, Checkbox, Select, MenuItem, Box, IconButton, Tooltip, InputLabel,
  LinearProgress, Typography, Alert
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import * as XLSX from 'xlsx';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from "@/shared/api/desktop";

const EXPORT_STOPPED = Symbol('export-stopped');
const yieldToScreen = () => new Promise<void>(resolve => setTimeout(resolve, 0));

interface ExportDialogProps {
  columns: GridColDef[];
  rows: object[];
  defaultFileName?: string;
  iconType?: 'copy' | 'download';
  totalCount?: number;
  fetchDataChunk?: ExportDataFetcher;
  tableName?: string;
  conditionsText?: string;
  disabled?: boolean;
}

export default function ExportDialog({ columns, rows, defaultFileName = 'export', iconType = 'copy', totalCount, fetchDataChunk, tableName, conditionsText, disabled = false }: ExportDialogProps) {
  const { t } = useTranslation(); 
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState('');

  const isWindows = navigator.platform.toUpperCase().indexOf('WIN') >= 0;
  const initialEncoding = isWindows ? 'sjis' : 'utf8';

  const [format, setFormat] = useState<'clipboard' | 'csv' | 'excel'>('clipboard');
  const confirmedPath = useRef('');
  const [filePath, setFilePath] = useState<string>('');
  const [spreadsheetSafe, setSpreadsheetSafe] = useState(true);
  const [includeHeader, setIncludeHeader] = useState<boolean>(true);
  const [encoding, setEncoding] = useState<string>(initialEncoding);

  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const operation = useRef<'browse' | 'export' | null>(null);
  const isBusy = isExporting || isBrowsing;
  const stopRequested = useRef(false);
  const phaseRef = useRef<'select' | 'fetch' | 'prepare' | 'save'>('select');
  const [phase, setPhase] = useState<'select' | 'fetch' | 'prepare' | 'save'>('select');
  const [fetchedCount, setFetchedCount] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const changePhase = (next: typeof phase) => { phaseRef.current = next; setPhase(next); };
  useEffect(() => () => { stopRequested.current = true; }, []);
  const [exportProgress, setExportProgress] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      setError('');
      confirmedPath.current = '';
      const savedSettings = localStorage.getItem('exportSettings');
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          setFormat(parsed.format || 'clipboard');
          setSpreadsheetSafe(parsed.spreadsheetSafe !== false);
          setIncludeHeader(parsed.includeHeader !== undefined ? parsed.includeHeader : true);
          setEncoding(parsed.encoding || initialEncoding);
          if (parsed.filePath) setFilePath(parsed.filePath);
        } catch (e) {
          console.error("Failed to restore settings.", e);
        }
      }
      setIsExporting(false);
      setStopped(false);
      setExportProgress(0);
    }
  }, [isOpen, initialEncoding]);

  const handleBrowse = async () => {
    if (operation.current) return;
    setError('');
    operation.current = 'browse';
    setIsBrowsing(true);
    const ext = format === 'excel' ? 'xlsx' : 'csv';
    const filters = format === 'excel' 
      ? [{ name: 'Excel Files', extensions: ['xlsx'] }] 
      : [{ name: 'CSV Files', extensions: ['csv'] }];

    try {
      const result = await ipcRenderer.invoke('show-save-dialog', {
        title: t("specify_output"),
        defaultPath: `${defaultFileName}.${ext}`,
        filters: filters
      });

      if (!result.canceled && result.filePath) {
        confirmedPath.current = result.filePath;
        setFilePath(result.filePath);
      }
    } catch {
      setError(t('failed_to_select_export_destination'));
    } finally {
      operation.current = null;
      setIsBrowsing(false);
    }
  };

  const handleExport = async () => {
    if (operation.current) return;
    if (columns.length === 0) {
      setError(t("no_data_structure_to_export"));
      return;
    }
    if (!fetchDataChunk && rows.length === 0) {
      setError(t("no_data_to_export"));
      return;
    }

    if (format !== 'clipboard' && !filePath) {
      setError(t("please_specify_output_full_path"));
      return;
    }

    setError('');
    operation.current = 'export';
    stopRequested.current = false;
    setIsStopping(false);
    setStopped(false);
    setFetchedCount(0);
    changePhase('select');
    setIsExporting(true);
    setExportProgress(0);

    try {
      let destinationPath = filePath;
      if (format !== 'clipboard' && confirmedPath.current !== filePath) {
        const selected = await ipcRenderer.invoke('show-save-dialog', { defaultPath: filePath });
        if (selected.canceled || !selected.filePath) return;
        destinationPath = selected.filePath;
        confirmedPath.current = destinationPath;
        setFilePath(destinationPath);
      }
      localStorage.setItem('exportSettings', JSON.stringify({ format, includeHeader, encoding, spreadsheetSafe, filePath: destinationPath }));
      let targetRows: Record<string, unknown>[] = rows.map(row => ({ ...row }));

      if (stopRequested.current) throw EXPORT_STOPPED;
      if (fetchDataChunk) {
        changePhase('fetch');
        await yieldToScreen();
        const allFetched: Record<string, unknown>[] = [];
        const limit = 5000;
        let failure: unknown;
        try {
          let offset = 0;
          for (;;) {
            if (stopRequested.current) throw EXPORT_STOPPED;
            const chunk = await fetchDataChunk(offset, limit);
            if (stopRequested.current) throw EXPORT_STOPPED;
            allFetched.push(...chunk.map(row => ({ ...row })));
            offset += chunk.length;
            setFetchedCount(offset);
            if (totalCount && totalCount > 0) setExportProgress(Math.min(99, Math.floor(offset / totalCount * 100)));
            if (chunk.length < limit) break;
            await yieldToScreen();
          }
        } catch (error: unknown) {
          failure = error;
          throw error;
        } finally {
          try { await fetchDataChunk.close?.(); }
          catch (error: unknown) { if (!failure || failure === EXPORT_STOPPED) throw error; }
        }
        targetRows = allFetched;
      }
      if (stopRequested.current) throw EXPORT_STOPPED;

      if (targetRows.length === 0) {
        setError(t("no_data_to_export_2"));
        setIsExporting(false);
        return;
      }

      changePhase('prepare');
      await yieldToScreen();
      if (stopRequested.current) throw EXPORT_STOPPED;
      if (format === 'excel') {
        // Keep columns positional: labels need not be unique or non-empty.
        const exportData = targetRows.map(row => columns.map(column => excelCell(row[column.field])));
        if (includeHeader) exportData.unshift(columns.map(column => excelCell(column.headerName ?? column.field)));
        const worksheet = XLSX.utils.aoa_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
        
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        changePhase('save');
        await yieldToScreen();
        if (stopRequested.current) throw EXPORT_STOPPED;
        const res = await ipcRenderer.invoke('save-file', destinationPath, excelBuffer, 'binary');
        if (res.success) {
          notify(t("excel_file_exported"), { severity: 'success' });
          setIsOpen(false);
        } else throw new Error(res.error);

      } else {
        const delimiter = format === 'clipboard' ? '\t' : ',';
        const serializeCell = (value: unknown): string => {
          const text = spreadsheetText(value, spreadsheetSafe);
          // Quote empty cells too, so a single empty value remains a record on import.
          const needsQuotes = format === 'csv' || text === '' || /[\t\r\n"]/.test(text);
          return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const records = targetRows.map(row => columns.map(column => serializeCell(row[column.field])).join(delimiter));
        if (includeHeader) {
          records.unshift(columns.map(column => serializeCell(column.headerName ?? column.field)).join(delimiter));
        }
        const textData = records.join('\n');

        changePhase('save');
        await yieldToScreen();
        if (stopRequested.current) throw EXPORT_STOPPED;
        if (format === 'clipboard') {
          await ipcRenderer.invoke('copy-to-clipboard', textData);
          notify(t("copied_to_clipboard"), { severity: 'success' });
          setIsOpen(false);
        } else {
          const res = await ipcRenderer.invoke('save-file', destinationPath, textData, encoding);
          if (res.success) {
            notify(t("csv_file_exported"), { severity: 'success' });
            setIsOpen(false);
          } else throw new Error(res.error);
        }
      }
    } catch (e: unknown) {
      if (e === EXPORT_STOPPED) { setStopped(true); return; }
      setError(`${t("export_error")}\n${getErrorMessage(e)}`);
    } finally {
      operation.current = null;
      setIsExporting(false);
    }
  };

  const handleClose = () => {
    if (!operation.current) setIsOpen(false);
  };

  return (
    <>
      <Tooltip title={t("export_data_clipboard_csv_excel")}>
        <span>
          <IconButton color="primary" onClick={() => setIsOpen(true)} disabled={disabled || isBusy} size="small" sx={{ bgcolor: 'background.paper' }}>
            {iconType === 'copy' ? <ContentCopyIcon /> : <FileDownloadIcon />}
          </IconButton>
        </span>
      </Tooltip>

      <Dialog open={isOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t("data_export_settings")}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2, whiteSpace: 'pre-wrap' }}>{error}</Alert>}
          
          {tableName && (
            <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 'bold', color: 'primary.main' }}>
              {t("target_table_4")} {tableName}
            </Typography>
          )}

          {conditionsText && (
            <Typography variant="caption" sx={{ mb: 2, display: 'block', color: 'text.secondary', whiteSpace: 'pre-wrap', bgcolor: 'action.hover', p: 1, borderRadius: 1 }}>
              {conditionsText}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            <FormControl component="fieldset" disabled={isBusy}>
              <FormLabel component="legend">{t("output_format")}</FormLabel>
              <RadioGroup row value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <FormControlLabel value="clipboard" control={<Radio />} label={t("clipboard")} />
                <FormControlLabel value="csv" control={<Radio />} label="CSV" />
                <FormControlLabel value="excel" control={<Radio />} label="Excel" />
              </RadioGroup>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField 
                label={t("output_path_full")}
                size="small" 
                fullWidth 
                variant="outlined" 
                value={filePath} 
                onChange={(e) => setFilePath(e.target.value)}
                disabled={format === 'clipboard' || isBusy}
              />
              <Button 
                variant="outlined" 
                onClick={handleBrowse} 
                disabled={format === 'clipboard' || isBusy}
                startIcon={<FolderOpenIcon />}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {t("browse")}
              </Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <FormControlLabel
                control={<Checkbox checked={includeHeader} onChange={(e) => setIncludeHeader(e.target.checked)} disabled={isBusy} />}
                label={t("export_header_row")}
              />
              <FormControl size="small" disabled={format !== 'csv' || isBusy}>
                <InputLabel>{t("encoding")}</InputLabel>
                <Select value={encoding} label={t("encoding")} onChange={(e) => setEncoding(e.target.value)}>
                  <MenuItem value="sjis">Shift-JIS</MenuItem>
                  <MenuItem value="utf8">UTF-8</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {format !== 'excel' && <Box>
              <FormControlLabel
                control={<Checkbox checked={spreadsheetSafe} onChange={event => setSpreadsheetSafe(event.target.checked)} disabled={isBusy} />}
                label={t('spreadsheet_safe_export')} />
              <Typography variant="caption" color="text.secondary" display="block">
                {spreadsheetSafe ? t('spreadsheet_safe_export_help') : t('spreadsheet_raw_export_help')}
              </Typography>
            </Box>}

            {stopped && <Typography role="status">{t('export_stopped')}</Typography>}
            {isExporting && (
              <Box role="status" aria-live="polite" sx={{ width: '100%', mt: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  {phase === 'fetch' ? t('export_fetch_progress', { count: fetchedCount }) : phase === 'prepare' ? t('export_preparing') : phase === 'save' ? t('export_saving') : t('export_selecting_destination')}
                  {isStopping && ` — ${t('export_stopping')}`}
                </Typography>
                <LinearProgress variant={phase === 'fetch' && totalCount !== undefined && totalCount > 0 ? 'determinate' : 'indeterminate'} value={exportProgress} sx={{ mt: 0.5 }} />
              </Box>
            )}

          </Box>
        </DialogContent>
        <DialogActions>
          {isExporting && phase === 'fetch' && <Tooltip title={t('export_stop_help')}><span><Button disabled={isStopping} onClick={() => {
            if (phaseRef.current !== 'fetch') return;
            stopRequested.current = true; setIsStopping(true);
          }}>{t('export_stop')}</Button></span></Tooltip>}
          <Button onClick={handleClose} disabled={isBusy}>{t("cancel")}</Button>
          <Button onClick={handleExport} variant="contained" color="primary" disabled={isBusy}>{t("export_2")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
