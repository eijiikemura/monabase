// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { alpha, lighten, useTheme } from '@mui/material/styles';
import StorageOutlinedIcon from '@mui/icons-material/StorageOutlined';
import LinkOffOutlinedIcon from '@mui/icons-material/LinkOffOutlined';
import { useTranslation } from 'react-i18next';
import type { ConnectionConfig } from '@/shared/types/appTypes';
import { environmentColor } from '@/shared/utils/connectionDisplay';

export default function ConnectionBadge({ config, dbInfo, disconnected }: {
    config: ConnectionConfig;
    dbInfo: string;
    disconnected: boolean;
}) {
    const { t } = useTranslation();
    const theme = useTheme();
    const dark = theme.palette.mode === 'dark';
    const database = config.dbType === 'oracle' ? 'Oracle' : 'PostgreSQL';
    const identity = `${database} (${config.database || t('unspecified_2')}) - ${config.user}`;
    const label = config.environmentLabel?.trim();
    const baseColor = disconnected ? theme.palette.error.main : environmentColor(config.environmentColor);
    const accent = dark ? lighten(baseColor, 0.3) : baseColor;
    const Icon = disconnected ? LinkOffOutlinedIcon : StorageOutlinedIcon;

    return (
        <Tooltip title={<Box sx={{ whiteSpace: 'pre-wrap' }}>{label ? `${label}\n` : ''}{identity}{'\n'}{config.host || ''}{config.port ? ':' + config.port : ''}{'\n'}{dbInfo}</Box>}>
            <Box data-testid="connection-badge" tabIndex={0} sx={{
                display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, maxWidth: 320,
                px: 1, py: 0.5, borderRadius: 2.5, border: '1px solid',
                borderColor: alpha(accent, dark ? 0.32 : 0.22),
                background: `linear-gradient(115deg, ${alpha(accent, dark ? 0.16 : 0.10)}, ${alpha(accent, 0.03)})`,
                boxShadow: `inset 0 1px 0 ${alpha(theme.palette.common.white, dark ? 0.04 : 0.6)}`,
                '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 }
            }}>
                <Box aria-hidden="true" sx={{
                    position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 1.5, flexShrink: 0,
                    bgcolor: alpha(accent, dark ? 0.18 : 0.12), color: accent
                }}>
                    <Icon sx={{ fontSize: 18 }} />
                    <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7,
                        borderRadius: '50%', bgcolor: accent, border: '2px solid', borderColor: 'background.paper' }} />
                </Box>
                <Box sx={{ minWidth: 0, flex: '1 1 auto' }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.25, fontSize: '0.8125rem', color: disconnected ? accent : 'text.primary' }}>
                        {disconnected ? t('not_connected_disconnected') : config.name || identity}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: '0.625rem', lineHeight: 1.4, color: 'text.secondary', letterSpacing: '0.02em' }}>
                        {label ? `${label} · ${database}` : database}
                    </Typography>
                </Box>
                {config.dbType === 'postgresql' && !disconnected && (
                    <Chip size="small" variant="outlined" color={config.pgSslMode === 'verify-full' ? 'success' : 'warning'}
                        label={t(config.pgSslMode === 'verify-full' ? 'security_tls_verified' : 'security_tls_disabled')}
                        sx={{ height: 20, flexShrink: 0, fontSize: '0.625rem', '& .MuiChip-label': { px: 0.75 } }} />
                )}
            </Box>
        </Tooltip>
    );
}
