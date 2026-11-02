// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, IconButton, Tooltip } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SaveAsIcon from '@mui/icons-material/SaveAs';
import { useTranslation } from 'react-i18next';

export default function SqlFileActions({ onOpen, onSaveAs, disabled }: {
  onOpen: () => void; onSaveAs: () => void; disabled: boolean;
}) {
  const { t } = useTranslation();
  const buttonStyle = { border: '1px solid', borderColor: 'divider', borderRadius: 1 };
  return <>
    <Tooltip title={t('sql_open_file')}>
      <Box component="span" sx={{ display: 'inline-flex' }}><IconButton size="small" color="primary" disabled={disabled}
        onClick={onOpen} aria-label={t('sql_open_file')} sx={buttonStyle} disableRipple><FolderOpenIcon /></IconButton></Box>
    </Tooltip>
    <Tooltip title={t('sql_save_as')}>
      <Box component="span" sx={{ display: 'inline-flex' }}><IconButton size="small" color="primary" disabled={disabled}
        onClick={onSaveAs} aria-label={t('sql_save_as')} sx={buttonStyle} disableRipple><SaveAsIcon /></IconButton></Box>
    </Tooltip>
  </>;
}
