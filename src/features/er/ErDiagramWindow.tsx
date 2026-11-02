// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useMemo, useState } from 'react';
import { Box, Paper, Typography, Tabs, Tab, Divider } from '@mui/material';
import KeyIcon from '@mui/icons-material/VpnKey'; 
import { Handle, Position } from 'reactflow';

import { useErDiagramWindow, type ErDiagramWindowProps } from './useErDiagramWindow';
import { useCustomErDiagram } from './useCustomErDiagram';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import AutoErDiagram from './AutoErDiagram';
import CustomErDiagram from './CustomErDiagram';

export const TableNode = ({ data }: import('reactflow').NodeProps<import('./erTypes').ErTableData>) => {
  const nodeMinWidth = data.showDataType !== false ? 220 : 150;
  const isLogical = data.showComments && data.logicalMode;

  let primaryTableName = data.tableName;
  let secondaryTableName: string | null = data.tableComment;
  
  if (isLogical) {
    primaryTableName = data.tableComment ? data.tableComment : data.tableName;
    secondaryTableName = null; 
  } else {
    primaryTableName = data.tableName;
    secondaryTableName = data.showComments ? data.tableComment : null;
  }

  let outlineStyle = '1px solid #ccc';
  let headerBgColor = 'primary.main';
  
  if (data.diffStatus === 'added') {
    outlineStyle = '3px solid #4caf50'; 
    headerBgColor = '#4caf50';
  } else if (data.diffStatus === 'deleted') {
    outlineStyle = '3px solid #f44336'; 
    headerBgColor = '#f44336';
  } else if (data.diffStatus === 'modified') {
    outlineStyle = '3px solid #ff9800'; 
    headerBgColor = '#ff9800';
  }

  return (
    <Paper elevation={3} sx={{ minWidth: nodeMinWidth, border: outlineStyle, borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper', transition: 'all 0.3s ease' }}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />

      <Box sx={{ bgcolor: headerBgColor, color: '#fff', px: 2, py: 1, textAlign: 'center', cursor: 'grab' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{primaryTableName}</Typography>
        {secondaryTableName && (
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.85, mt: 0.5, lineHeight: 1.2 }}>{secondaryTableName}</Typography>
        )}
      </Box>
      <Divider />
      <Box sx={{ display: 'flex', flexDirection: 'column', p: 1, gap: 1, bgcolor: 'background.default' }}>
        {data.columns.map((col, idx: number) => {
          let primaryColName = col.name;
          let secondaryColName: string | null = col.comment;

          if (isLogical) {
             primaryColName = col.comment ? col.comment : col.name;
             secondaryColName = null;
          } else {
             primaryColName = col.name;
             secondaryColName = data.showComments ? col.comment : null;
          }

          return (
            <Box key={idx} sx={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', fontSize: '0.75rem', fontFamily: 'monospace' }}>
              <Handle type="target" position={Position.Left} id={col.name} style={{ opacity: 0, left: -9, top: '50%' }} />
              <Handle type="source" position={Position.Right} id={col.name} style={{ opacity: 0, right: -9, top: '50%' }} />

              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                {col.isPk ? <KeyIcon sx={{ fontSize: 14, color: 'warning.main', flexShrink: 0, mt: 0.2 }} /> : <Box sx={{ width: 14, flexShrink: 0 }} />}
                <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography variant="caption" sx={{ fontWeight: col.isPk ? 'bold' : 'normal', color: 'text.primary', lineHeight: 1.2 }}>
                    {primaryColName} {col.isFk && '(FK)'}
                  </Typography>
                  {secondaryColName && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', lineHeight: 1.2, mt: 0.2 }}>{secondaryColName}</Typography>
                  )}
                </Box>
              </Box>
              {data.showDataType !== false && (
                <Typography variant="caption" sx={{ color: 'text.secondary', ml: 2, whiteSpace: 'nowrap' }}>{col.type}</Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
};

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
  const isLoading = autoLogic.isLoading || customLogic.isLoading;
  const nodeTypes = useMemo(() => ({ tableNode: TableNode }), []);

  if (!props.isActive) return null;

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox(props.isActive)}>
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