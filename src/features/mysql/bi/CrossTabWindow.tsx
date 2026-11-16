// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { Alert, Box } from '@mui/material';
import CrossTabPanel from '@/features/cross-tab/CrossTabPanel';
import { useCrossTabWindow, type MysqlCrossTabProps } from './useCrossTabWindow';
export default function CrossTabWindow(props: MysqlCrossTabProps) {
  const controller = useCrossTabWindow(props);
  return <Box data-testid="mysql-cross-tab" sx={{ flex: 1, minHeight: 0, display: props.isActive ? 'flex' : 'none', flexDirection: 'column' }}>
    {controller.error && <Alert severity="error">{controller.error}</Alert>}
    <CrossTabPanel {...props} controller={controller} dbType="mysql" chartId={`mysql-cross-tab-${props.tabId}`} />
  </Box>;
}
