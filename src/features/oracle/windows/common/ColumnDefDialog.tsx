// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { ColumnDialogState } from "@/shared/types/columnDialogTypes";
import { 
  Box, TextField, Button, Dialog, DialogTitle, DialogContent, 
  DialogActions, FormControl, InputLabel, Select, MenuItem, FormControlLabel, Checkbox,
  RadioGroup, Radio, Typography, Divider, ListSubheader
} from '@mui/material';
import { useTranslation } from 'react-i18next';

const DATA_TYPES = ['VARCHAR2', 'NVARCHAR2', 'NUMBER', 'FLOAT', 'DATE', 'TIMESTAMP', 'CHAR', 'CLOB', 'BLOB'];

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

  const isNumberType = dialogState.newType === 'NUMBER' || dialogState.newType === 'FLOAT';
  const isDateType = dialogState.newType === 'DATE' || dialogState.newType === 'TIMESTAMP';
  const isUserType = userTypes.includes(dialogState.newType);
  const hasSelectOption = isNumberType || isDateType;
  
  const isNoLengthType = isUserType || ['DATE', 'TIMESTAMP', 'CLOB', 'BLOB'].some(t => dialogState.newType.includes(t));

  return (
    <Dialog 
      open={isOpen} 
      onClose={(_event, reason) => {
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
          return;
        }
        if (onClose) {
          onClose();
        }
      }}
    >
      <DialogTitle>{mode === 'add' ? t("add_column") : t("alter_column")}</DialogTitle>
      <DialogContent sx={{ minWidth: 400, pt: 1 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          <TextField label={t("column_name")} size="small" variant="outlined" fullWidth value={dialogState.newColName} onChange={(e) => setDialogState({ ...dialogState, newColName: e.target.value.toUpperCase() })} />
          <FormControl fullWidth size="small">
            <InputLabel>{t("data_type")}</InputLabel>
            <Select 
              value={dialogState.newType} 
              label={t("data_type")}
              disabled={mode === 'modify' && (dialogState.oldType === 'CLOB' || dialogState.oldType === 'BLOB')}
              onChange={(e) => {
                const selectedType = e.target.value;
                let nextLength = dialogState.newLength;
                let nextScale = dialogState.newScale;
                if (selectedType === 'NUMBER' && parseInt(nextLength, 10) > 38) nextLength = '';
                if (selectedType !== 'NUMBER') nextScale = ''; 
                
                let nextMode = dialogState.newDefaultMode;
                if (selectedType !== 'NUMBER' && selectedType !== 'FLOAT' && selectedType !== 'DATE' && selectedType !== 'TIMESTAMP') {
                  nextMode = 'manual';
                }

                setDialogState({ ...dialogState, newType: selectedType, newLength: nextLength, newScale: nextScale, newDefaultMode: nextMode });
              }}
            >
              {DATA_TYPES.filter(dt => {
                if (mode === 'add') return true;
                if (dialogState.oldType === 'CLOB' || dialogState.oldType === 'BLOB') return dt === dialogState.oldType;
                return dt !== 'CLOB' && dt !== 'BLOB';
              }).map(dt => <MenuItem key={dt} value={dt}>{dt}</MenuItem>)}
              
              {userTypes.length > 0 && <Divider />}
              {userTypes.length > 0 && <ListSubheader sx={{ lineHeight: '24px', fontSize: '0.75rem' }}>{t("user_defined_type")}</ListSubheader>}
              {userTypes.map(ut => <MenuItem key={ut} value={ut} sx={{ color: 'primary.main' }}>{ut}</MenuItem>)}
            </Select>
          </FormControl>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField label={dialogState.newType === 'NUMBER' ? t("precision") : t("length_size_precision")} size="small" variant="outlined" sx={{ flexGrow: 1 }} value={dialogState.newLength} onChange={(e) => setDialogState({ ...dialogState, newLength: e.target.value })} disabled={isNoLengthType} />
            {dialogState.newType === 'NUMBER' && (<TextField label={t("scale")} size="small" variant="outlined" sx={{ width: 180 }} value={dialogState.newScale} onChange={(e) => setDialogState({ ...dialogState, newScale: e.target.value })} />)}
          </Box>
          <FormControl fullWidth size="small">
            <InputLabel>{t("allow_nulls")}</InputLabel>
            <Select value={dialogState.newNullable} label={t("allow_nulls")} onChange={(e) => setDialogState({ ...dialogState, newNullable: e.target.value })}>
              <MenuItem value="Y">{t("yes_allow_null")}</MenuItem>
              <MenuItem value="N">{t("no_required_not_null")}</MenuItem>
            </Select>
          </FormControl>
          
          {/* Use divider as the border color. */}
          <Box sx={{ border: '1px solid', borderColor: 'divider', p: 1.5, borderRadius: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">{t("set_default_value")}</Typography>
              {hasSelectOption && (
                <RadioGroup row value={dialogState.newDefaultMode} onChange={(e) => setDialogState({...dialogState, newDefaultMode: e.target.value as 'manual'|'select'})}>
                  <FormControlLabel value="manual" control={<Radio size="small" />} label={<Typography variant="caption">{t("manual")}</Typography>} />
                  <FormControlLabel value="select" control={<Radio size="small" />} label={<Typography variant="caption">{t("select")}</Typography>} />
                </RadioGroup>
              )}
            </Box>
            
            {dialogState.newDefaultMode === 'select' && hasSelectOption ? (
              isNumberType ? (
                <FormControl fullWidth size="small">
                  <InputLabel>{t("default_value_sequence")}</InputLabel>
                  <Select 
                    value={dialogState.newDefault} 
                    label={t("default_value_sequence")}
                    onChange={(e) => setDialogState({ ...dialogState, newDefault: e.target.value })}
                  >
                    <MenuItem value="">{t("none_2")}</MenuItem>
                    {sequences.map(seq => <MenuItem key={seq} value={`${schema ? schema + '.' : ''}${seq}.NEXTVAL`}>{seq}.NEXTVAL</MenuItem>)}
                  </Select>
                </FormControl>
              ) : (
                <FormControl fullWidth size="small">
                  <InputLabel>{t("default_value")}</InputLabel>
                  <Select 
                    value={dialogState.newDefault} 
                    label={t("default_value")}
                    onChange={(e) => setDialogState({ ...dialogState, newDefault: e.target.value })}
                  >
                    <MenuItem value="">{t("none_2")}</MenuItem>
                    <MenuItem value="SYSDATE">SYSDATE</MenuItem>
                    {dialogState.newType === 'TIMESTAMP' && <MenuItem value="CURRENT_TIMESTAMP">CURRENT_TIMESTAMP</MenuItem>}
                  </Select>
                </FormControl>
              )
            ) : (
              <TextField 
                label={t("default_value")}
                size="small" variant="outlined" fullWidth 
                value={dialogState.newDefault} 
                onChange={(e) => setDialogState({ ...dialogState, newDefault: e.target.value })} 
              />
            )}
          </Box>

          <TextField label={t("column_comment_logical_name")} size="small" variant="outlined" fullWidth value={dialogState.newComment} onChange={(e) => setDialogState({ ...dialogState, newComment: e.target.value })} />
          
          {showPkCheckbox && (
            <FormControlLabel control={<Checkbox checked={dialogState.isPk || false} onChange={(e) => setDialogState({ ...dialogState, isPk: e.target.checked })} />} label={t("set_this_column_as_primary_key")} />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button onClick={onSubmit} variant="contained" color="primary">{mode === 'add' ? t("execute_add") : t("execute_changes")}</Button>
      </DialogActions>
    </Dialog>
  );
}