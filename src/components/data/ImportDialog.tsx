// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { parseDelimitedText, previewImport } from '@/features/table/importData';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import React, { useState, useRef, useEffect } from 'react';
import { 
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  FormControl, FormLabel, RadioGroup, FormControlLabel, Radio,
  TextField, Select, MenuItem, Box, IconButton, Tooltip, InputLabel,
  LinearProgress, Typography, Checkbox, Alert, TableContainer, Table, TableHead, TableRow, TableCell, TableBody
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { useTranslation } from 'react-i18next';

interface ImportDialogProps {
  onImport: (records: string[][], onProgress: (progress: number, text: string) => void, isHeader: boolean) => Promise<void>;
  columns: string[];
  targetKey?: string;
  tableName?: string;
  disabled?: boolean;
}

export default function ImportDialog({ onImport, columns, targetKey, tableName, disabled = false }: ImportDialogProps) {
  const { t } = useTranslation(); 
  const [isOpen, setIsOpen] = useState(false);

  const isWindows = navigator.platform.toUpperCase().indexOf('WIN') >= 0;
  const initialEncoding = isWindows ? 'sjis' : 'utf8';

  const [format, setFormat] = useState<'clipboard' | 'csv'>('clipboard');
  const [filePath, setFilePath] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<string>(initialEncoding);
  
  const [isHeader, setIsHeader] = useState<boolean>(true);

  // Selected delimiter for clipboard imports.
  const [clipboardDelimiter, setClipboardDelimiter] = useState<string>('tab');

  const [isImporting, setIsImporting] = useState<boolean>(false);
  const importing = useRef(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [progressText, setProgressText] = useState<string>('');

  const [preview, setPreview] = useState<{ records: string[][]; signature: string; details: ReturnType<typeof previewImport> } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const signature = JSON.stringify([targetKey, tableName, format, encoding, isHeader, clipboardDelimiter, columns]);
  const currentPreview = preview?.signature === signature ? preview : null;
  const invalidatePreview = () => { setPreview(null); setPreviewError(''); };

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const savedSettings = localStorage.getItem('importSettings');
      if (savedSettings) {
        try {
          const parsed = JSON.parse(savedSettings);
          setFormat(parsed.format || 'clipboard');
          setEncoding(parsed.encoding || initialEncoding);
          if (parsed.isHeader !== undefined) {
            setIsHeader(parsed.isHeader);
          }
          if (parsed.clipboardDelimiter) {
            setClipboardDelimiter(parsed.clipboardDelimiter);
          }
        } catch (e) {
          console.error("Failed to restore settings.", e);
        }
      }
      setIsImporting(false);
      setImportProgress(0);
      setProgressText('');
      setFilePath('');
      setSelectedFile(null);
      setPreview(null);
      setPreviewError('');
    }
  }, [isOpen, initialEncoding]);

  const handleBrowse = () => {
    if (importing.current) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (importing.current) return;
    const file = e.target.files?.[0];
    if (file) {
      invalidatePreview();
      setSelectedFile(file);
      setFilePath(('path' in file && typeof file.path === 'string' ? file.path : '') || file.name);
    }
    if (e.target) e.target.value = '';
  };

  const readFileAsText = (file: File, enc: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = () => reject(new Error(t("failed_to_load_file")));
      reader.readAsText(file, enc === 'sjis' ? 'Shift_JIS' : 'UTF-8');
    });
  };

  const handlePreview = async () => {
    if (importing.current) return;
    if (format === 'csv' && !selectedFile) {
      alert(t("please_select_a_file_to_import"));
      return;
    }

    invalidatePreview();
    importing.current = true;
    setIsImporting(true);
    setImportProgress(0);
    setProgressText(t("loading_data"));

    try {
      localStorage.setItem('importSettings', JSON.stringify({ format, encoding, isHeader, clipboardDelimiter }));
      let textData = '';
      if (format === 'clipboard') {
        textData = await navigator.clipboard.readText();
        if (textData.length === 0) throw new Error(t("no_data_in_clipboard"));
      } else {
        if (!selectedFile) throw new Error(t("no_file"));
        textData = await readFileAsText(selectedFile, encoding);
      }

      setProgressText(t("parsing_data"));
      
      // Use the selected delimiter; CSV always uses commas.
      let delimiter = ',';
      if (format === 'clipboard') {
         delimiter = clipboardDelimiter === 'tab' ? '\t' : ',';
      }

      const parsedRecords = parseDelimitedText(textData, delimiter, t);

      if (parsedRecords.length === 0) {
        throw new Error(t("no_data_to_import"));
      }

      const details = previewImport(parsedRecords, columns, isHeader, t);
      setPreview({ records: parsedRecords, signature, details });
    } catch (e: unknown) {
      setPreviewError(getErrorMessage(e));
    } finally {
      importing.current = false;
      setIsImporting(false);
    }
  };

  const handleImportClick = async () => {
    if (importing.current || !currentPreview) return;
    importing.current = true;
    setIsImporting(true);
    setImportProgress(0);
    try {
      await onImport(currentPreview.records, (progress, text) => {
        setImportProgress(progress); setProgressText(text);
      }, isHeader);
      setPreview(null);
      setIsOpen(false);
    } catch (error: unknown) {
      // An explicit new preview is required after a potentially partial insertion.
      setPreview(null);
      setPreviewError(getErrorMessage(error));
    } finally {
      importing.current = false;
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    if (!importing.current) { setIsOpen(false); invalidatePreview(); }
  };

  return (
    <>
      <Tooltip title={t("import_data_clipboard_csv")}>
        <span>
          <IconButton color="primary" onClick={() => setIsOpen(true)} disabled={disabled || isImporting} size="small" sx={{ bgcolor: 'background.paper' }}>
            <FileUploadIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Dialog open={isOpen} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t("data_import_settings")}</DialogTitle>
        <DialogContent>

          {tableName && (
            <Typography variant="body2" sx={{ mb: 2, fontWeight: 'bold', color: 'primary.main' }}>
              {t("target_table_5", { name: tableName })}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, mt: 1 }}>
            
            <FormControl component="fieldset" disabled={isImporting}>
              <FormLabel component="legend">{t("data_source")}</FormLabel>
              <RadioGroup row value={format} onChange={(e) => { invalidatePreview(); setFormat(e.target.value as typeof format); }}>
                <FormControlLabel value="clipboard" control={<Radio />} label={t("clipboard")} />
                <FormControlLabel value="csv" control={<Radio />} label={t("csv_file")} />
              </RadioGroup>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <TextField 
                label={format === 'clipboard' ? t("load_from_clipboard") : t("input_file")}
                size="small" 
                fullWidth 
                variant="outlined" 
                value={filePath} 
                disabled
              />
              <Button 
                variant="outlined" 
                onClick={handleBrowse} 
                disabled={format === 'clipboard' || isImporting}
                startIcon={<FolderOpenIcon />}
                sx={{ whiteSpace: 'nowrap' }}
              >
                {t("browse")}
              </Button>
              <input type="file" accept=".csv" ref={fileInputRef} onChange={handleFileChange} disabled={isImporting} style={{ display: 'none' }} />
            </Box>

            <FormControlLabel
              control={
                <Checkbox
                  checked={isHeader}
                  onChange={(e) => { invalidatePreview(); setIsHeader(e.target.checked); }}
                  disabled={isImporting}
                  color="primary"
                />
              }
              label={t("treat_first_row_as_header_skip_from_import")}
            />

            <Box sx={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              
              {/* Show delimiter selection only for clipboard imports. */}
              <FormControl size="small" disabled={format !== 'clipboard' || isImporting} sx={{ minWidth: 150 }}>
                <InputLabel>{t("delimiter")}</InputLabel>
                <Select value={clipboardDelimiter} label={t("delimiter")} onChange={(e) => { invalidatePreview(); setClipboardDelimiter(e.target.value); }}>
                  <MenuItem value="tab">{t("tab")}</MenuItem>
                  <MenuItem value="comma">{t("comma")}</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" disabled={format !== 'csv' || isImporting} sx={{ minWidth: 150 }}>
                <InputLabel>{t("encoding")}</InputLabel>
                <Select value={encoding} label={t("encoding")} onChange={(e) => { invalidatePreview(); setEncoding(e.target.value); }}>
                  <MenuItem value="sjis">Shift-JIS</MenuItem>
                  <MenuItem value="utf8">UTF-8</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {previewError && <Alert severity="error">{previewError}</Alert>}
            {currentPreview && <Box data-testid="import-preview">
              <Typography role="status" variant="body2">{t('import_preview_summary', { count: currentPreview.details.rowCount })}</Typography>
              <Typography variant="caption">{t('import_preview_help')}</Typography>
              {currentPreview.details.targets.some(column => !column) && <Alert severity="warning">{t('import_preview_ignored')}</Alert>}
              <TableContainer sx={{ maxHeight: 280 }}>
                <Table size="small" stickyHeader aria-label={t('import_preview')}>
                  <TableHead><TableRow>{currentPreview.details.targets.map((column, index) => <TableCell key={index}>
                    {isHeader ? currentPreview.records[0][index] : index + 1} → {column || t('import_preview_skip')}
                  </TableCell>)}</TableRow></TableHead>
                  <TableBody>{currentPreview.details.sample.map((row, index) => <TableRow key={index}>
                    {row.map((value, cell) => <TableCell key={cell} sx={{ maxWidth: 240, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{value}</TableCell>)}
                  </TableRow>)}</TableBody>
                </Table>
              </TableContainer>
            </Box>}

            {isImporting && (
              <Box sx={{ width: '100%', mt: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  {progressText}
                </Typography>
                <LinearProgress variant="determinate" value={importProgress} sx={{ mt: 0.5 }} />
              </Box>
            )}

          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={isImporting}>{t("cancel")}</Button>
          <Button onClick={handlePreview} disabled={isImporting}>{t("import_preview")}</Button>
          <Button onClick={handleImportClick} variant="contained" color="primary" disabled={isImporting || !currentPreview}>{t("execute")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
