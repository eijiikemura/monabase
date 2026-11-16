// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Box, Paper, Tabs, Tab } from '@mui/material';
import { TableNode } from './TableNode';

import { useErDiagramWindow, type ErDiagramWindowProps } from './useErDiagramWindow';
import { useCustomErDiagram } from './useCustomErDiagram';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import AutoErDiagram from './AutoErDiagram';
import CustomErDiagram from './CustomErDiagram';


const styles = {
  rootBox: (isActive: boolean) => ({
    position: 'relative' as const, border: 0, m: 0, minWidth: 0,
    flexGrow: 1, 
    display: isActive ? 'flex' : 'none', 
    flexDirection: 'column' as const, 
    height: '100%', 
    bgcolor: 'background.default', 
    p: 2, 
    gap: 1,
    '& .react-flow__attribution': { 
      display: 'none' 
    }
  }),
  mainPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  tabsWrapper: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 },
  tabs: { minHeight: 36 },
  tabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' }
};

export default function ErDiagramWindow(props: ErDiagramWindowProps) {
  const [mainTab, setMainTab] = useState(0);

  const autoLogic = useErDiagramWindow(props);
  const customLogic = useCustomErDiagram(props);
  const { t } = autoLogic;
  const ownBusy = autoLogic.isLoading || customLogic.isLoading || customLogic.isProcessing;
  const isLoading = ownBusy || Boolean(props.disabled);
  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  if (!props.isActive) return null;

  return (
    <Box data-testid="er-diagram-window" component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox(props.isActive)}>
      {isLoading && <WindowLoadingIndicator />}
      <Paper elevation={1} sx={styles.mainPaper}>
        <Box sx={styles.tabsWrapper}>
          <Tabs value={mainTab} onChange={(_e, val) => setMainTab(val)} sx={styles.tabs}>
            <Tab disabled={isLoading} label={t("auto_gen_er_diagram")} sx={styles.tabItem} />
            <Tab disabled={isLoading} label={t("custom_er_diagram_virtual_relations")} sx={styles.tabItem} />
          </Tabs>
        </Box>

        {mainTab === 0 && <AutoErDiagram logic={{ ...autoLogic, isLoading }} nodeTypes={nodeTypes} showLoadingIndicator={false} />}
        {mainTab === 1 && <CustomErDiagram logic={{ ...customLogic, isLoading }} nodeTypes={nodeTypes} />}
      </Paper>
    </Box>
  );
}