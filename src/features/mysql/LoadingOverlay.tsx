// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Backdrop, Button, CircularProgress, SvgIcon, Typography } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

export default function LoadingOverlay({ open, monaStyle, cancelable, onCancel }: { open: boolean; monaStyle: boolean; cancelable: boolean; onCancel: () => void; }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return <Backdrop data-testid="global-loader" transitionDuration={0} open={open} sx={{
    color: monaStyle ? '#6D4C41' : 'text.primary',
    backgroundColor: monaStyle ? 'rgba(239, 235, 233, 0.85)' : theme.palette.mode === 'dark' ? 'rgba(18,18,18,0.85)' : 'rgba(255,255,255,0.85)',
    zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 2.5
  }}>
    <CircularProgress sx={{ color: monaStyle ? '#BCAAA4' : 'primary.main' }} size={50} thickness={4.5} />
    <Typography variant="h6" fontWeight="bold" sx={{ letterSpacing: 1 }}>{t('processing')}</Typography>
    {cancelable && <Button variant="contained" onClick={onCancel} startIcon={monaStyle ? <SvgIcon sx={{ fontSize: 20 }} viewBox="0 0 24 24">
      <g transform="translate(12, 12) scale(1.3)">
        <path d="M -3,-1 C -3,-3 3,-3 3,-1 C 4.5,-0.5 6.5,1.5 6.5,4 C 6.5,7 3,8 0,8 C -3,8 -6.5,7 -6.5,4 C -6.5,1.5 -4.5,-0.5 -3,-1 Z" fill="currentColor" />
        <ellipse cx="-6.5" cy="-2.5" rx="1.6" ry="2.2" transform="rotate(-35 -6.5 -2.5)" /><ellipse cx="-2.5" cy="-6" rx="1.8" ry="2.6" transform="rotate(-12 -2.5 -6)" /><ellipse cx="2.5" cy="-6" rx="1.8" ry="2.6" transform="rotate(12 2.5 -6)" /><ellipse cx="6.5" cy="-2.5" rx="1.6" ry="2.2" transform="rotate(35 6.5 -2.5)" />
      </g>
    </SvgIcon> : <StopIcon />} sx={{ mt: 1, px: 3, py: 1, bgcolor: monaStyle ? '#D7CCC8' : 'action.disabledBackground', color: monaStyle ? '#6D4C41' : 'text.primary', fontWeight: 'bold', borderRadius: 6, boxShadow: '0 4px 6px rgba(0,0,0,0.15)', textTransform: 'none', '&:hover': { bgcolor: monaStyle ? '#BCAAA4' : 'action.hover' } }}>{t('abort_process')}</Button>}
  </Backdrop>;
}
