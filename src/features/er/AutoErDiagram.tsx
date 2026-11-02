// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0


import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import { useMemo } from 'react';
import { 
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Button, 
  Tooltip as MuiTooltip, Checkbox, FormControlLabel, IconButton
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DownloadIcon from '@mui/icons-material/Download';
import ReactFlow, { Background, Controls } from 'reactflow';
import 'reactflow/dist/style.css'; 

import { useErDiagramWindow } from './useErDiagramWindow';
import { TableNode } from './ErDiagramWindow';

const styles = {
  contentBox: { position: 'relative' as const, border: 0, m: 0, p: 0, minWidth: 0, display: 'flex', flexDirection: 'column' as const, flexGrow: 1, overflow: 'hidden' },
  toolbar: { p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' as const, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' },
  diagramArea: { flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f4f4f4', position: 'relative' as const },
  emptyState: { color: 'text.secondary', m: 'auto', textAlign: 'center' as const }
};

type AutoErDiagramProps = import('./useErDiagramWindow').ErDiagramWindowProps & {
  logic?: ReturnType<typeof useErDiagramWindow>;
  nodeTypes?: import('reactflow').NodeTypes;
  showLoadingIndicator?: boolean;
};
const defaultNodeTypes = { tableNode: TableNode };

export default function AutoErDiagram(props: AutoErDiagramProps) {
  return props.logic
    ? <AutoErDiagramView {...props} logic={props.logic} />
    : <StandaloneAutoErDiagram {...props} />;
}

function StandaloneAutoErDiagram(props: AutoErDiagramProps) {
  const logic = useErDiagramWindow({
    initialSchema: props.initialSchema,
    tableName: props.tableName,
    dbType: props.dbType || 'oracle'
  });
  return <AutoErDiagramView {...props} logic={logic} />;
}

function AutoErDiagramView(props: AutoErDiagramProps & { logic: ReturnType<typeof useErDiagramWindow> }) {
  const { logic } = props;
  const nodeTypes = props.nodeTypes || defaultNodeTypes;
  const { t, isLoading } = logic;
  const isEmbedded = !!props.tableName;

  const toolbarControls = useMemo(() => (
    <>
        {!isEmbedded && (
          <>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel shrink>{t("schema")}</InputLabel>
              <Select 
                value={logic.schema || ''} 
                displayEmpty
                label={t("schema")}
                notched 
                disabled={isLoading}
                onChange={logic.handleChangeSchema}
              >
                <MenuItem value="" disabled><em>{t("select_schema")}</em></MenuItem>
                {logic.schemaList.map((s: string) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <FormControl size="small" sx={{ minWidth: 250 }}>
              <InputLabel shrink>{t("table_2")}</InputLabel>
              <Select 
                value={logic.selectedObject || ''} 
                displayEmpty 
                label={t("table_2")}
                notched 
                disabled={isLoading}
                onChange={logic.handleChangeObject}
              >
                <MenuItem value=""><em>{t("all")}</em></MenuItem>
                {logic.objects.map((obj: string) => <MenuItem key={obj} value={obj}>{obj}</MenuItem>)}
              </Select>
            </FormControl>
            <MuiTooltip title={t("auto_generate_er_diagram_for_existing_db_with_current_selection")} arrow placement="top">
              <span>
                <Button 
                  variant="contained" 
                  color="primary" 
                  startIcon={<PlayArrowIcon />} 
                  disabled={isLoading}
                  onClick={logic.handleGenerateAutoEr}
                >
                  {t("draw_er_diagram")}
                </Button>
              </span>
            </MuiTooltip>
          </>
        )}
        
        <FormControlLabel 
          control={
            <Checkbox 
              checked={logic.showComments} 
              onChange={logic.handleToggleShowComments} 
              disabled={isLoading}
              size="small" 
            />
          } 
          label={<Typography variant="body2">{t("draw_comments")}</Typography>}
          sx={{ ml: isEmbedded ? 0 : 1 }} 
        />
        
        {logic.showComments && (
          <FormControlLabel 
            control={
              <Checkbox 
                checked={logic.logicalMode} 
                onChange={logic.handleToggleLogicalMode} 
                disabled={isLoading}
                size="small" 
              />
            } 
            label={<Typography variant="body2">{t("show_logical_names")}</Typography>}
            sx={{ ml: 0.5 }} 
          />
        )}

        <FormControlLabel 
          control={
            <Checkbox 
              checked={logic.showDataType} 
              onChange={logic.handleToggleShowDataType} 
              disabled={isLoading}
              size="small" 
            />
          } 
          label={<Typography variant="body2">{t("draw_data_types")}</Typography>}
          sx={{ ml: 1 }} 
        />
    </>
  ), [
    isEmbedded, isLoading, t,
    logic.schema, logic.schemaList,
    logic.selectedObject, logic.objects,
    logic.showComments, logic.logicalMode, logic.showDataType,
    logic.handleChangeSchema, logic.handleChangeObject,
    logic.handleGenerateAutoEr,
    logic.handleToggleShowComments,
    logic.handleToggleLogicalMode,
    logic.handleToggleShowDataType
  ]);

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.contentBox}>
      {isLoading && props.showLoadingIndicator !== false && <WindowLoadingIndicator />}
      <Box sx={styles.toolbar}>
        {toolbarControls}

        <Box sx={{ flexGrow: 1 }} />
        
        <MuiTooltip title={t("save_current_er_diagram_as_image_png")} arrow placement="top">
          <span>
            <IconButton 
              color="secondary" 
              data-testid="auto-er-export"
              onClick={logic.handleExportImage} 
              disabled={logic.nodes.length === 0 || isLoading}
              sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
            >
              <DownloadIcon />
            </IconButton>
          </span>
        </MuiTooltip>
      </Box>

      {/* Drawing area. */}
      <Box sx={styles.diagramArea} ref={logic.reactFlowWrapper}>
        {logic.nodes.length > 0 ? (
          <ReactFlow nodes={logic.nodes} edges={logic.edges} nodeTypes={nodeTypes} onNodesChange={logic.onNodesChange} fitView>
            <svg style={{ position: 'absolute', width: 0, height: 0 }}>
              <defs>
                <marker id="marker-1-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -5,-8 L -5,8 M -10,-8 L -10,8" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
                <marker id="marker-01-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="-2" cy="0" r="4" fill="#f4f4f4" stroke="#555" strokeWidth="1.5" /><path d="M -10,-8 L -10,8 M -10,8" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
                <marker id="marker-N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
                <marker id="marker-0N-start" viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="2" cy="0" r="4" fill="#f4f4f4" stroke="#555" strokeWidth="1.5" /><path d="M -10,-8 L -2,0 L -10,8 M -2,0 L -10,0" fill="none" stroke="#555" strokeWidth="1.5" /></marker>

                <marker id="marker-1-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 5,-8 L 5,8 M 10,-8 L 10,8" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
                <marker id="marker-01-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="2" cy="0" r="4" fill="#f4f4f4" stroke="#555" strokeWidth="1.5" /><path d="M 10,-8 L 10,8" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
                <marker id="marker-N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
                <marker id="marker-0N-end" viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="-2" cy="0" r="4" fill="#f4f4f4" stroke="#555" strokeWidth="1.5" /><path d="M 10,-8 L 2,0 L 10,8 M 2,0 L 10,0" fill="none" stroke="#555" strokeWidth="1.5" /></marker>
              </defs>
            </svg>
            <Background color="#ccc" gap={16} />
            <Controls />
          </ReactFlow>
        ) : (
          !isLoading && (
            <Typography variant="body2" sx={styles.emptyState}>
              {isEmbedded 
                ? t("no_relationships_to_display")
                : t("click_draw_er_diagram_to_display_the_existing_structure_here")}
            </Typography>
          )
        )}
      </Box>
    </Box>
  );
}
