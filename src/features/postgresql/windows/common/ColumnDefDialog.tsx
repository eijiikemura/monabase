// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnDialogState } from "@/shared/types/columnDialogTypes";
import { type SelectChangeEvent, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox, Box, FormHelperText } from '@mui/material';

import { useTranslation } from 'react-i18next';

const POSTGRES_DATA_TYPES = [
  'VARCHAR', 'CHAR', 'TEXT', 
  'INTEGER', 'SMALLINT', 'BIGINT', 'SERIAL', 'BIGSERIAL',
  'NUMERIC', 'REAL', 'DOUBLE PRECISION', 
  'DATE', 'TIMESTAMP', 'TIME', 'BOOLEAN', 'BYTEA', 'JSONB', 'UUID'
];

interface ColumnDefDialogProps<T extends ColumnDialogState> {
  isOpen: boolean;
  mode: 'add' | 'modify';
  schema: string;
  sequences: string[];
  userTypes?: string[]; 
  dialogState: T;
  setDialogState: React.Dispatch<React.SetStateAction<T>>;
  onSubmit: () => void;
  onClose: () => void;
  showPkCheckbox?: boolean; 
}

export default function ColumnDefDialog<T extends ColumnDialogState>({
  isOpen, mode, schema, sequences, userTypes = [], dialogState, setDialogState, onSubmit, onClose, showPkCheckbox = false 
}: ColumnDefDialogProps<T>) {
  const { t } = useTranslation();

  const isNumericType = (type: string) => {
    const tUp = type.toUpperCase();
    return tUp.includes('NUMERIC') || tUp.includes('DECIMAL');
  };

  const isLengthRequired = (type: string) => {
    const tUp = type.toUpperCase();
    return ['VARCHAR', 'CHAR', 'BIT'].includes(tUp);
  };

  const isNoLengthType = (type: string) => {
    const tUp = type.toUpperCase();
    if (userTypes.includes(type)) return true;
    return ['DATE', 'TIMESTAMP', 'TIME', 'TEXT', 'BYTEA', 'INTEGER', 'SMALLINT', 'BIGINT', 'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'JSONB', 'UUID', 'REAL', 'DOUBLE PRECISION'].some(t => tUp.includes(t));
  };

  // Detect date and time data types.
  const isDateOrTimeType = (type: string) => {
    const tUp = type.toUpperCase();
    return ['DATE', 'TIMESTAMP', 'TIME'].some(t => tUp.includes(t));
  };

  // Detect numeric data types that support sequences.
  const isSequenceAllowedType = (type: string) => {
    const tUp = type.toUpperCase();
    return ['INT', 'SERIAL', 'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE'].some(t => tUp.includes(t));
  };

  const handleTypeChange = (e: SelectChangeEvent<string>) => {
    const tVal = e.target.value;
    const isNum = isNumericType(tVal);
    const noLen = isNoLengthType(tVal);

    // Reset default settings when the type changes to avoid inconsistencies.
    setDialogState({ 
      ...dialogState, 
      newType: tVal,
      newLength: noLen ? '' : (isNum ? '10' : '50'),
      newScale: isNum ? '0' : '',
      newDefaultMode: 'manual',
      newDefault: ''
    });
  };

  const handleDefaultModeChange = (e: SelectChangeEvent<string>) => {
    const mode = e.target.value;
    setDialogState({
      ...dialogState,
      newDefaultMode: mode,
      newDefault: mode === 'manual' ? '' : (mode === 'now' ? 'CURRENT_TIMESTAMP' : '')
    });
  };

  const handleDefaultSelectChange = (e: SelectChangeEvent<string>) => {
    const val = e.target.value;
    if (val === 'CURRENT_TIMESTAMP') {
      setDialogState({ ...dialogState, newDefault: 'CURRENT_TIMESTAMP' });
    } else {
      setDialogState({ ...dialogState, newDefault: `nextval('"${schema}"."${val}"'::regclass)` });
    }
  };

  // Extract the sequence name from PostgreSQL nextval('schema.sequence_name'::regclass).
  const getSelectedSequenceName = (defaultStr: string) => {
    if (!defaultStr || !defaultStr.includes('nextval')) return '';
    // Extract names such as 'my_new_schema.a' or '"my_new_schema"."a"'.
    const match = defaultStr.match(/nextval\('"?([^"']+)?"?'::regclass\)/i) || defaultStr.match(/nextval\('"?([^"']+)?"?'\)/i);
    if (match && match[1]) {
      // If qualified, keep only the sequence name after the dot.
      const parts = match[1].split('.');
      const rawName = parts.length > 1 ? parts[1] : parts[0];
      return rawName.replace(/"/g, ''); // Remove surrounding double quotes.
    }
    return '';
  };

  const currentType = dialogState.newType.toUpperCase();
  const showLength = !isNoLengthType(currentType);
  const showScale = isNumericType(currentType);
  
  // Choose default value options by data type.
  const showNowOption = isDateOrTimeType(currentType);
  const showSequenceOption = isSequenceAllowedType(currentType);

  return (
    <Dialog open={isOpen} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{mode === 'add' ? t("add_column") : t("edit_column")}</DialogTitle>
      <DialogContent sx={{ minWidth: 400, pt: 1, display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
        
        <TextField 
          autoFocus 
          label={t("column_name")}
          type="text" 
          fullWidth 
          variant="outlined" 
          size="small" 
          value={dialogState.newColName} 
          onChange={(e) => setDialogState({ ...dialogState, newColName: e.target.value.toLowerCase() })} 
        />

        <Box sx={{ display: 'flex', gap: 2 }}>
          <FormControl size="small" sx={{ flexGrow: 1 }}>
            <InputLabel>{t("data_type")}</InputLabel>
            <Select value={dialogState.newType} label={t("data_type")} onChange={handleTypeChange}>
              {POSTGRES_DATA_TYPES.map(type => (
                <MenuItem key={type} value={type}>{type}</MenuItem>
              ))}
              {userTypes && userTypes.length > 0 && <MenuItem disabled>──────────</MenuItem>}
              {userTypes?.map(type => (
                <MenuItem key={type} value={type}>{type} (User Type)</MenuItem>
              ))}
            </Select>
          </FormControl>

          {showLength && (
            <TextField 
              label={isLengthRequired(currentType) ? t("length_required") : t("length")}
              type="text" 
              variant="outlined" 
              size="small" 
              sx={{ width: 100 }} 
              value={dialogState.newLength} 
              onChange={(e) => setDialogState({ ...dialogState, newLength: e.target.value })} 
              error={isLengthRequired(currentType) && !dialogState.newLength}
            />
          )}

          {showScale && (
            <TextField 
              label={t("precision_2")}
              type="text" 
              variant="outlined" 
              size="small" 
              sx={{ width: 80 }} 
              value={dialogState.newScale} 
              onChange={(e) => setDialogState({ ...dialogState, newScale: e.target.value })} 
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <FormControl size="small" sx={{ width: 120 }}>
            <InputLabel>{t("allow_nulls")}</InputLabel>
            <Select value={dialogState.newNullable} label={t("allow_nulls")} onChange={(e) => setDialogState({ ...dialogState, newNullable: e.target.value })}>
              <MenuItem value="Y">Yes</MenuItem>
              <MenuItem value="N">No</MenuItem>
            </Select>
          </FormControl>
          
          {showPkCheckbox && (
            <FormControlLabel 
              control={<Checkbox checked={dialogState.isPk} onChange={(e) => setDialogState({ ...dialogState, isPk: e.target.checked })} color="primary" />} 
              label={t("set_as_primary_key")}
              sx={{ ml: 2 }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <FormControl size="small" sx={{ width: 150 }}>
              <InputLabel>{t("default_value")}</InputLabel>
              <Select value={dialogState.newDefaultMode} label={t("default_value")} onChange={handleDefaultModeChange}>
                <MenuItem value="manual">{t("manual_input")}</MenuItem>
                {/* Show CURRENT_TIMESTAMP only for date and time types. */}
                {showNowOption && <MenuItem value="now">CURRENT_TIMESTAMP</MenuItem>}
                {/* Show sequence options only for numeric types. */}
                {showSequenceOption && sequences.length > 0 && <MenuItem value="sequence">{t("sequence_4")}</MenuItem>}
              </Select>
            </FormControl>
            
            {dialogState.newDefaultMode === 'sequence' && (
               <FormControl size="small" sx={{ flexGrow: 1 }}>
                 <InputLabel>{t("select_sequence")}</InputLabel>
                 <Select 
                   value={getSelectedSequenceName(dialogState.newDefault)} 
                   label={t("select_sequence")}
                   onChange={handleDefaultSelectChange}
                 >
                   {sequences.map(seq => (
                     <MenuItem key={seq} value={seq}>{seq}</MenuItem>
                   ))}
                 </Select>
               </FormControl>
            )}

            {dialogState.newDefaultMode === 'manual' && (
              <TextField 
                label={t("default_value_optional")}
                type="text" 
                fullWidth 
                variant="outlined" 
                size="small" 
                value={dialogState.newDefault} 
                onChange={(e) => setDialogState({ ...dialogState, newDefault: e.target.value })} 
              />
            )}

            {dialogState.newDefaultMode === 'now' && (
              <TextField 
                disabled
                type="text" 
                fullWidth 
                variant="outlined" 
                size="small" 
                value="CURRENT_TIMESTAMP" 
              />
            )}
          </Box>
          {dialogState.newDefaultMode === 'manual' && (
            <FormHelperText sx={{ ml: 1 }}>
              {t("strings_are_automatically_enclosed_in_single_quotes_e_g_0_0")}
            </FormHelperText>
          )}
        </Box>

        <TextField 
          label={t("comment_optional")}
          type="text" 
          fullWidth 
          variant="outlined" 
          size="small" 
          value={dialogState.newComment} 
          onChange={(e) => setDialogState({ ...dialogState, newComment: e.target.value })} 
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button onClick={onSubmit} variant="contained" color="primary">{mode === 'add' ? t("add") : t("change")}</Button>
      </DialogActions>
    </Dialog>
  );
}