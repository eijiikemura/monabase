// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { hasConditionInput } from '@/shared/utils/queryConditions';

import { 
  Box, Typography, MenuItem, Select, Button, TextField, FormControl, FormControlLabel, Checkbox
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useTranslation } from 'react-i18next'; 

import DateInput from './DateInput';

import type { Condition } from '@/shared/types/queryConditions';

interface ConditionPanelProps {
  columns: string[];
  conditions: { [key: string]: Condition };
  onConditionChange: (col: string, key: string, val: string) => void;
  onExecute: () => void;
  onClearConditions: () => void;
  inputDateFormat: string;
  hideSort?: boolean;
  allowTime?: boolean;
  disabled?: boolean; // Disabled flag for loading and similar states.
}

export default function ConditionPanel({ 
  columns, 
  conditions, 
  onConditionChange, 
  onExecute,
  onClearConditions,
  inputDateFormat, 
  hideSort = false,
  disabled = false,
  allowTime = false
}: ConditionPanelProps) {
  const { t } = useTranslation();
  const [columnSearch, setColumnSearch] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);
  const activeColumns = columns.filter(col => hasConditionInput(conditions[col], !hideSort));
  const visibleColumns = columns.filter(col => col.toLocaleLowerCase().includes(columnSearch.trim().toLocaleLowerCase()) &&
    (!onlyActive || activeColumns.includes(col)));
  const hiddenActive = activeColumns.filter(col => !visibleColumns.includes(col)).length;
  const hasDraft = Object.values(conditions).some(cond => cond.value !== '' || cond.sort !== '' || cond.operator !== '=');

  return (
    <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'background.default' }}>
        <Typography variant="subtitle2" fontWeight="bold">
          {hideSort ? t("filter_condition") : t("filter_sort")}
        </Typography>
        <Button 
          variant="contained" 
          color="primary" 
          size="small" 
          startIcon={<PlayArrowIcon />} 
          onClick={onExecute}
          disabled={disabled}
        >
          {t("execute")}
        </Button>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, p: 1 }}>
        <TextField size="small" label={t('condition_search_columns')} value={columnSearch} disabled={disabled}
          onChange={event => setColumnSearch(event.target.value)} sx={{ minWidth: 160, flex: 1 }} />
        <FormControlLabel label={t('condition_active_only')} control={<Checkbox size="small" checked={onlyActive}
          disabled={disabled} onChange={event => setOnlyActive(event.target.checked)} />} />
        <Button size="small" disabled={disabled || !hasDraft} onClick={onClearConditions}>{t('condition_clear_all')}</Button>
      </Box>
      {hiddenActive > 0 && <Typography role="status" aria-live="polite" variant="caption" sx={{ px: 1 }}>
        {t('condition_hidden_active', { count: hiddenActive, total: hiddenActive })}
      </Typography>}
      <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 1 }}>
        {!visibleColumns.length && <Typography color="text.secondary">{t('condition_no_columns')}</Typography>}
        {visibleColumns.map(col => {
          const cond = conditions[col] || { operator: '=', value: '', sort: '', type: 'STRING' };
          
          const isDisabled = cond.type === 'DISABLED';
          // Disable when the entire input or the individual column is excluded.
          const isFieldDisabled = disabled || isDisabled;

          return (
            <Box key={col} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography 
                sx={{ 
                  width: 150, 
                  fontSize: '0.85rem', 
                  fontWeight: 'bold', 
                  overflow: 'hidden', 
                  textOverflow: 'ellipsis', 
                  whiteSpace: 'nowrap',
                  color: isFieldDisabled ? 'text.disabled' : 'text.primary' 
                }} 
                title={col}
              >
                {col}
              </Typography>
              
              <FormControl size="small" sx={{ width: 120 }}>
                <Select
                  value={cond.type}
                  onChange={(e) => onConditionChange(col, 'type', e.target.value)}
                  disabled={isFieldDisabled} 
                  sx={{ fontSize: '0.85rem', '& .MuiSelect-select': { py: 0.5 } }}
                >
                  <MenuItem value="STRING">{t("string")}</MenuItem>
                  <MenuItem value="NUMBER">{t("number_2")}</MenuItem>
                  <MenuItem value="DATE">{t("date")}</MenuItem>
                  {(allowTime || cond.type === 'TIME') && <MenuItem value="TIME">{t('time_only')}</MenuItem>}
                  {isDisabled && <MenuItem value="DISABLED">{t("exclude")}</MenuItem>}
                </Select>
              </FormControl>

              <Select 
                size="small" 
                value={cond.operator}
                title={cond.operator === 'LIKE' ? t('search_contains_literal_help') : undefined}
                onChange={(e) => onConditionChange(col, 'operator', e.target.value)} 
                disabled={isFieldDisabled} 
                sx={{ width: 80, fontSize: '0.85rem', '& .MuiSelect-select': { py: 0.5 } }}
              >
                <MenuItem value="=">＝</MenuItem>
                <MenuItem value="<>">＜＞</MenuItem>
                <MenuItem value="<=">＜＝</MenuItem>
                <MenuItem value=">=">＞＝</MenuItem>
                <MenuItem value="LIKE">LIKE</MenuItem>
              </Select>
              
              <Box sx={{ width: 220 }}>
                {cond.type === 'DATE' ? (
                  <DateInput
                    value={cond.value}
                    onChange={(newVal) => onConditionChange(col, 'value', newVal)}
                    inputDateFormat={inputDateFormat}
                    disabled={isFieldDisabled}
                    sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem', py: 0.5 } }}
                  />
                ) : (
                  <TextField 
                    size="small" 
                    placeholder={isDisabled ? t("exclude_2") : cond.type === 'NUMBER' ? t("number") : cond.type === 'TIME' ? t("time_value_example") : t("enter_value")}
                    value={cond.value} 
                    onChange={(e) => onConditionChange(col, 'value', e.target.value)} 
                    fullWidth
                    disabled={isFieldDisabled} 
                    sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem', py: 0.5 } }} 
                  />
                )}
              </Box>

              {!hideSort && (
                <TextField 
                  size="small" 
                  placeholder={isDisabled ? "-" : t("sort_e_g_1_1_desc")}
                  value={cond.sort} 
                  onChange={(e) => onConditionChange(col, 'sort', e.target.value)} 
                  disabled={isFieldDisabled} 
                  sx={{ width: 180, '& .MuiInputBase-input': { fontSize: '0.85rem', py: 0.5 } }} 
                />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}