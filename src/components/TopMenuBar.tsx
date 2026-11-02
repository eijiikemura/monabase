// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Tooltip, Button, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import UndoIcon from '@mui/icons-material/Undo';
import { useTranslation } from 'react-i18next';
interface TopMenuBarProps {
    onCommit: () => void;
    onRollback: () => void;
    hasUncommittedTx: boolean;
    monaStyle?: boolean;
}
export default function TopMenuBar({ onCommit, onRollback, hasUncommittedTx }: TopMenuBarProps) {
    const { t } = useTranslation();
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
  {hasUncommittedTx && <Chip size="small" color="warning" variant="outlined" role="status" label={t('ux_pending_transaction')}/>}
  <Tooltip title={t('commit_transaction_save')}><Button aria-label={t('commit')} variant={hasUncommittedTx ? 'contained' : 'outlined'} size="small" color="success" startIcon={<CheckCircleIcon />} onClick={onCommit} disableElevation>{t('commit')}</Button></Tooltip>
  <Tooltip title={t('rollback_transaction_undo')}><Button aria-label={t('rollback')} variant="outlined" size="small" color="error" startIcon={<UndoIcon />} onClick={onRollback}>{t('rollback')}</Button></Tooltip>
 </Box>;
}
