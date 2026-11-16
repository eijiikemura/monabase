// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useState } from 'react';
import { Alert, Box, Button, Tab, Tabs } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AiContext } from '@/shared/types/aiTypes';
import type { DatabaseObject } from '@/shared/types/objectTypes';
import TableSourceTab from './TableSourceTab';
import { useMysqlTable, type MysqlTableProps } from './useMysqlTable';
import TableDataTab from './TableDataTab';
import TableMetadataTab from './TableMetadataTab';
import TableErTab from './TableErTab';

export default function TableWindow(props: MysqlTableProps & { object: DatabaseObject; tabId: number; aiEnabled: boolean; onOpenAi: (context: AiContext) => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0), [sourceVisited, setSourceVisited] = useState(false);
  const [visitedMetadata, setVisitedMetadata] = useState<number[]>([]);
  const controller = useMysqlTable(props, tab === 0);
  return <Box data-testid="mysql-table-window" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <Tabs value={tab} onChange={(_event, value: number) => { setTab(value); if ([1, 2, 4].includes(value)) setVisitedMetadata(previous => previous.includes(value) ? previous : [...previous, value]); if (value === 5) setSourceVisited(true); }} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 40, px: 2, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
      {['data', 'structure', 'relation', 'er_diagram', 'statistics', 'source'].map(label => <Tab key={label} label={t(label)} sx={{ minHeight: 40, py: 0 }} />)}
    </Tabs>
    {controller.error && <Alert severity="error" action={<Button disabled={props.busy || props.disabled} onClick={() => void controller.refresh()}>{t('retry')}</Button>}>{controller.error}</Alert>}
    <Box sx={{ flex: 1, minHeight: 0, display: tab === 0 ? 'flex' : 'none', flexDirection: 'column' }}><TableDataTab controller={controller} props={{ ...props, active: props.active && tab === 0 }} /></Box>
    {controller.metadata && visitedMetadata.map(value => <Box key={value} sx={{ display: tab === value ? 'flex' : 'none', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <TableMetadataTab mode={value === 1 ? 'structure' : value === 2 ? 'relation' : 'statistics'} controller={controller} props={{ ...props, active: props.active && tab === value }} />
    </Box>)}
    {controller.metadata && tab === 3 && props.active && <TableErTab schema={props.schema} table={props.table} metadata={controller.metadata} busy={props.busy} />}
    {sourceVisited && <Box sx={{ display: tab === 5 ? 'flex' : 'none', flex: 1, minHeight: 0 }}><TableSourceTab key={props.object.key} object={props.object} active={props.active && tab === 5} /></Box>}
  </Box>;
}
