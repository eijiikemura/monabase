// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { type SxProps, type Theme, Box, TextField, IconButton, Tooltip } from '@mui/material';
import { useRef } from 'react';

import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { useTranslation } from 'react-i18next';
import { formatDbDate } from "@/shared/utils/dateFormatter";

interface DateInputProps {
  value: string;
  onChange: (newValue: string) => void;
  inputDateFormat: string;
  label?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

export default function DateInput({ value, onChange, inputDateFormat, label, disabled = false, sx = {} }: DateInputProps) {
  const { t } = useTranslation();
  const pickerRef = useRef<HTMLInputElement>(null);

  const isDateTime = inputDateFormat.match(/H|h|m|s/);

  return (
    <Box sx={{ position: 'relative', display: 'flex', gap: 1, alignItems: 'center', width: '100%' }}>
      <TextField 
        label={label}
        size="small" 
        fullWidth 
        variant="outlined" 
        type="text"
        disabled={disabled}
        placeholder={t("e_g_2", { format: inputDateFormat })}
        value={value || ''} 
        onChange={(e) => onChange(e.target.value)} 
        sx={sx}
      />
      {!disabled && (
        <Tooltip title={t("select_from_calendar")}>
          <IconButton 
            color="primary" 
            onClick={() => {
              if (pickerRef.current) {
                try {
                  if (typeof pickerRef.current.showPicker === 'function') {
                    pickerRef.current.showPicker();
                  } else {
                    pickerRef.current.focus();
                  }
                } catch {
                  pickerRef.current.focus();
                }
              }
            }}
          >
            <CalendarTodayIcon />
          </IconButton>
        </Tooltip>
      )}
      {!disabled && (
        <input 
          ref={pickerRef}
          type={isDateTime ? "datetime-local" : "date"}
          step="1"
          style={{ 
            position: 'absolute', 
            bottom: 0,       // Anchor to the bottom of the entire input.
            left: 0, 
            width: '100%',   // Use the full input width.
            height: '1px',   // Minimum height recognized by the browser.
            opacity: 0.01,   // Use a tiny opacity instead of full transparency.
            padding: 0, 
            border: 0,
            pointerEvents: 'none'
          }}
          onChange={(e) => {
            if (e.target.value) {
              const formatted = formatDbDate(e.target.value, inputDateFormat);
              onChange(formatted);
              e.target.value = ''; 
            }
          }}
        />
      )}
    </Box>
  );
}