// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Tooltip, Button } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import UndoIcon from '@mui/icons-material/Undo';
import { useTranslation } from 'react-i18next';
interface TopMenuBarProps {
    onCommit: () => void;
    onRollback: () => void;
    hasUncommittedTx: boolean;
    monaStyle?: boolean;
    disabled?: boolean;
}
export default function TopMenuBar({ onCommit, onRollback, hasUncommittedTx, disabled = false }: TopMenuBarProps) {
    const { t } = useTranslation();
    const pendingStyle = {
        animation: hasUncommittedTx && !disabled ? 'pendingTransaction 1.8s ease-in-out infinite' : 'none',
        '@keyframes pendingTransaction': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.55 },
        },
        '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
    };
    return <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
  <Tooltip title={t('commit_transaction_save')}><span><Button disabled={disabled} aria-label={t('commit')} aria-description={hasUncommittedTx ? t('ux_pending_transaction') : undefined} sx={pendingStyle} variant={hasUncommittedTx ? 'contained' : 'outlined'} size="small" color="success" startIcon={<CheckCircleIcon />} onClick={onCommit} disableElevation>{t('commit')}</Button></span></Tooltip>
  <Tooltip title={t('rollback_transaction_undo')}><span><Button disabled={disabled} aria-label={t('rollback')} aria-description={hasUncommittedTx ? t('ux_pending_transaction') : undefined} sx={pendingStyle} variant={hasUncommittedTx ? 'contained' : 'outlined'} size="small" color="error" startIcon={<UndoIcon />} onClick={onRollback} disableElevation>{t('rollback')}</Button></span></Tooltip>
 </Box>;
}
