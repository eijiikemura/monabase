// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import GitHistoryPagination from '@/features/git/GitHistoryPagination';

import React, { memo, useMemo } from 'react';
import { 
  Box, Typography, FormControl, InputLabel, Select, MenuItem, Button, 
  Checkbox, FormControlLabel, Divider, List, ListItemButton, ListItemText, 
  TextField, Dialog, DialogTitle, DialogContent, DialogActions, Menu, 
  IconButton, Tooltip, CircularProgress, Backdrop, Paper 
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import ObjectPickerDialog from '@/features/objects/ObjectPickerDialog';
import DownloadIcon from '@mui/icons-material/Download';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close'; 
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RestoreIcon from '@mui/icons-material/Restore';
import SyncIcon from '@mui/icons-material/Sync';
import ReactFlow, { Background, Controls, ReactFlowProvider } from 'reactflow';
import 'reactflow/dist/style.css'; 

const ER_OBJECT_CATEGORIES = ['TABLE', 'VIEW'] as const;
const MemoReactFlow = memo(ReactFlow);
const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 };
const FLOW_DECORATIONS = (
  <>
    <Background color="#ccc" gap={16} />
    <Controls />
  </>
);

const styles = {
  contentBox: { display: 'flex', flexDirection: 'column' as const, flexGrow: 1, overflow: 'hidden', position: 'relative' as const },
  toolbar: { p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' as const, flexShrink: 0, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'action.hover' },
  diagramArea: { flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#f4f4f4', position: 'relative' as const },
  diffLegend: { display: 'flex', gap: 2, alignItems: 'center', ml: 2 },
  diffDot: (color: string) => ({ width: 12, height: 12, borderRadius: '50%', bgcolor: color, display: 'inline-block', mr: 0.5 })
};

export default function CustomErDiagram({ logic, nodeTypes }: { logic: ReturnType<typeof import('./useCustomErDiagram').useCustomErDiagram>; nodeTypes: import('reactflow').NodeTypes }) {
  const { t } = logic;
  const isLoading = logic.isLoading || logic.isProcessing;

  const historyColumns = useMemo<GridColDef[]>(() => [
    { field: 'id', headerName: t("commit_id"), width: 100 },
    { 
      field: 'date', 
      headerName: t("datetime"),
      width: 160,
      valueFormatter: (params) => {
        if (!params.value) return '';
        const date = new Date(params.value);
        return isNaN(date.getTime()) ? params.value : date.toLocaleString('ja-JP');
      }
    },
    { field: 'message', headerName: t("commit_message"), flex: 1 }
  ], [t]);

  const designControls = useMemo(() => (
    <>
      <TextField
        size="small"
        label={t("er_diagram_name")}
        value={logic.erDiagramName}
        onChange={(e) => logic.setErDiagramName(e.target.value)}
        placeholder={t("e_g_user_management")}
        disabled={isLoading}
        sx={{ minWidth: 150, bgcolor: 'background.paper' }}
      />
      <FormControl size="small" sx={{ minWidth: 120 }}>
        <InputLabel shrink>{t("schema")}</InputLabel>
        <Select
          value={logic.customSchema || ''}
          displayEmpty
          label={t("schema")}
          notched
          disabled={isLoading || logic.customNodes.length > 0}
          onChange={logic.handleChangeCustomSchema}
        >
          <MenuItem value="" disabled><em>{t("select_schema")}</em></MenuItem>
          {logic.customSchema && !logic.schemaList.includes(logic.customSchema) && <MenuItem value={logic.customSchema}>{logic.customSchema}</MenuItem>}
          {logic.schemaList.map((s: string) => (
            <MenuItem key={s} value={s}>{s}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <Tooltip title={t('er_add_objects_help')}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddIcon />}
            onClick={logic.handleOpenAddCustomTableDialog}
            disabled={isLoading}
          >
            {t("add_table_2")}
          </Button>
        </Box>
      </Tooltip>
      <Tooltip title={t('er_add_relation_help')}>
        <Box component="span" sx={{ display: 'inline-flex' }}>
          <Button
            variant="contained"
            color="info"
            startIcon={<AddIcon />}
            onClick={logic.handleOpenAddRelationDialog}
            disabled={logic.customNodes.length < 2 || isLoading}
          >
            {t("add_relation_2")}
          </Button>
        </Box>
      </Tooltip>

      <FormControlLabel
        control={
          <Checkbox
            checked={logic.showComments}
            onChange={logic.handleToggleShowComments}
            disabled={isLoading}
            size="small"
          />
        }
        label={<Typography variant="body2">{t("show_comments")}</Typography>}
        sx={{ ml: 1 }}
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
        label={<Typography variant="body2">{t("show_data_types")}</Typography>}
        sx={{ ml: 1 }}
      />
    </>
  ), [t, logic, isLoading]);

  return (
    <Box sx={styles.contentBox}>
      {/* Custom SVG markers without vertical bars for the ER canvas and history comparison. */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          {['', 'added-', 'deleted-', 'modified-'].map(prefix => {
            const p = `custom-er-marker-${prefix}`;
            const c = prefix === 'added-' ? '#4caf50' : prefix === 'deleted-' ? '#f44336' : prefix === 'modified-' ? '#ff9800' : '#555';
            return (
              <React.Fragment key={p}>
                <marker id={`${p}1-start`} viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -5,-8 L -5,8 M -5,0 L -10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}N-start`} viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0 M 0,-8 L 0,8" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}01-start`} viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke={c} strokeWidth="1.5" /><path d="M -6,-8 L -6,8 M -6,0 L -10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}0N-start`} viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="3" cy="0" r="3.5" fill="#f4f4f4" stroke={c} strokeWidth="1.5" /><path d="M -10,-8 L -1,0 L -10,8 M -1,0 L -10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}MANY-start`} viewBox="-10 -10 20 20" refX="-10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M -10,-8 L 0,0 L -10,8 M 0,0 L -10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                
                <marker id={`${p}1-end`} viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 5,-8 L 5,8 M 5,0 L 10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}N-end`} viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}01-end`} viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="0" cy="0" r="3.5" fill="#f4f4f4" stroke={c} strokeWidth="1.5" /><path d="M 6,-8 L 6,8 M 6,0 L 10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}0N-end`} viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><circle cx="-3" cy="0" r="3.5" fill="#f4f4f4" stroke={c} strokeWidth="1.5" /><path d="M 10,-8 L 1,0 L 10,8 M 1,0 L 10,0" fill="none" stroke={c} strokeWidth="1.5" /></marker>
                <marker id={`${p}MANY-end`} viewBox="-10 -10 20 20" refX="10" refY="0" markerWidth="12" markerHeight="12" orient="auto"><path d="M 10,-8 L 0,0 L 10,8 M 0,0 L 10,0 M 0,-8 L 0,8" fill="none" stroke={c} strokeWidth="1.5" /></marker>
              </React.Fragment>
            );
          })}
        </defs>
      </svg>

      {logic.customMode !== 'init' && !logic.isLocalRepo && (
        <Box sx={{ p: 1.5, bgcolor: '#fff3e0', borderBottom: '1px solid', borderColor: '#ffe0b2', display: 'flex', alignItems: 'center' }}>
          <Typography variant="body2" color="warning.dark" sx={{ fontWeight: 'bold' }}>
            {t("git_initialize_repository_help")}
          </Typography>
        </Box>
      )}

      {logic.customMode === 'init' ? (
        <Box sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', m: 'auto', position: 'relative' }}>
          <Button 
            variant="contained" 
            size="large" 
            startIcon={<AddIcon />} 
            onClick={logic.handleCreateNewCustomEr} 
            disabled={isLoading}
            sx={{ width: 250 }}
          >
            {t("create_new_er_diagram")}
          </Button>
          <Divider sx={{ width: '100%' }}>{t("or_open_saved")}</Divider>
          <List sx={{ width: '100%', maxWidth: 400, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            {logic.savedFiles.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>{t("no_saved_er_diagrams")}</Typography>
            ) : (
              logic.savedFiles.map((file: string) => (
                <ListItemButton key={file} onClick={() => logic.handleOpenCustomEr(file)} disabled={isLoading}>
                  <FolderOpenIcon sx={{ mr: 2, color: 'text.secondary' }} />
                  <ListItemText primary={file} />
                  <IconButton edge="end" onClick={(e) => logic.handleDeleteCustomEr(file, e)} disabled={isLoading} size="small" sx={{ color: 'error.main' }}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemButton>
              ))
            )}
          </List>
        </Box>
      ) : logic.isCompareMode ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
          <Box sx={styles.toolbar}>
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={logic.handleCloseCompareMode} disabled={isLoading}>
              {t("back_to_design_screen")}
            </Button>
            <Button 
              variant="contained" 
              color="primary" 
              startIcon={<RestoreIcon />} 
              onClick={logic.handleRestorePastVersion}
              disabled={!logic.canRestoreHistory || isLoading}
              sx={{ ml: 2 }}
            >
              {t("restore_to_selected_version")}
            </Button>
            
            <Box sx={styles.diffLegend}>
              <Typography variant="caption"><Box sx={styles.diffDot('#4caf50')} />{t("add")}</Typography>
              <Typography variant="caption"><Box sx={styles.diffDot('#f44336')} />{t("delete")}</Typography>
              <Typography variant="caption"><Box sx={styles.diffDot('#ff9800')} />{t("change")}</Typography>
            </Box>
          </Box>

          <Paper elevation={0} sx={{ height: logic.historyListHeight, flexShrink: 0, m: 1, border: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
             <Box sx={{ p: 0.5, px: 1.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
               <Typography variant="caption" fontWeight="bold" color="text.secondary">{t("history_list")}</Typography>
              <GitHistoryPagination page={logic.historyPage} hasMore={logic.historyHasMore} loading={logic.historyLoading} onChange={page => { void logic.loadErHistory(page); }} />
             </Box>
             <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', minHeight: 0 }}>
                {logic.historyList.length === 0 ? (
                  <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography variant="body2" color="text.disabled">{t("no_past_history")}</Typography>
                  </Box>
                ) : (
                  <DataGrid 
                    rows={logic.historyList} 
                    columns={historyColumns} 
                    density="compact"
                    hideFooter
                    disableColumnMenu
                    onRowClick={logic.handleHistoryRowClick}
                    sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} 
                  />
                )}
             </Box>
          </Paper>

          <Box 
            onMouseDown={logic.startResizingHistory} 
            sx={{ 
              height: 10, 
              cursor: 'row-resize', 
              bgcolor: logic.isResizingHistory ? 'primary.main' : 'divider', 
              '&:hover': { bgcolor: 'primary.main' }, 
              transition: 'background-color 0.2s', 
              mx: 1,
              mb: 1,
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }} 
          >
            <Box sx={{ width: 40, height: 3, bgcolor: 'background.paper', borderRadius: 1 }} />
          </Box>

          <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden', borderTop: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ p: 1, bgcolor: '#fff3e0', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" color="warning.dark" fontWeight="bold">
                  {logic.selectedHistory ? t("past_source", { id: logic.selectedHistory.id }) : t("past_source_not_selected")}
                </Typography>
              </Box>
              <Box sx={{ flexGrow: 1, position: 'relative', bgcolor: '#f4f4f4' }}>
                {logic.isHistoryLoading ? (
                  <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress aria-label={t("loading")} />
                  </Box>
                ) : !logic.selectedHistory ? (
                  <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                     <Typography color="text.disabled">{t("please_select_a_version_from_the_history_above")}</Typography>
                  </Box>
                ) : (
                  <ReactFlowProvider>
                    <MemoReactFlow
                      nodes={logic.annotatedPastNodes} edges={logic.annotatedPastEdges} nodeTypes={nodeTypes}
                      fitView fitViewOptions={FIT_VIEW_OPTIONS}
                      nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag 
                    >
                      {FLOW_DECORATIONS}
                    </MemoReactFlow>
                  </ReactFlowProvider>
                )}
              </Box>
            </Box>
            
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ p: 1, bgcolor: '#e8f5e9', borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2" color="success.dark" fontWeight="bold">{t("current_source_latest_local")}</Typography>
              </Box>
              <Box sx={{ flexGrow: 1, position: 'relative', bgcolor: '#f4f4f4' }}>
                <ReactFlowProvider>
                  <MemoReactFlow
                    nodes={logic.annotatedCurrentNodes} edges={logic.annotatedCurrentEdges} nodeTypes={nodeTypes}
                    fitView fitViewOptions={FIT_VIEW_OPTIONS}
                    nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag 
                  >
                    {FLOW_DECORATIONS}
                  </MemoReactFlow>
                </ReactFlowProvider>
              </Box>
            </Box>
          </Box>
        </Box>
      ) : (
        <>
          <Box sx={styles.toolbar}>
            {designControls}
            <Typography variant="caption" color={logic.isDirty ? 'warning.main' : 'text.secondary'} role="status">
              {logic.isDirty ? t('er_unsaved_changes') : t('er_no_unsaved_changes')}
            </Typography>
            <Button size="small" onClick={logic.handleUndo} disabled={!logic.canUndo || isLoading || logic.isProcessing}>{t('er_undo')}</Button>
            <Button size="small" onClick={logic.handleRedo} disabled={!logic.canRedo || isLoading || logic.isProcessing}>{t('er_redo')}</Button>

            <Box sx={{ flexGrow: 1 }} />
            
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mr: 2 }}>
              
              <Tooltip title={t("sync_with_latest_db_state")} arrow placement="top">
                <span>
                  <IconButton 
                    color="info" 
                    data-testid="er-sync"
                    onClick={logic.handleSyncWithDatabase} 
                    sx={{ border: '1px solid', borderColor: 'info.main', bgcolor: 'background.paper' }}
                    disabled={logic.customNodes.length === 0 || logic.isProcessing || isLoading}
                  >
                    <SyncIcon /> 
                  </IconButton>
                </span>
              </Tooltip>

              <Tooltip title={logic.isLocalRepo ? t("save_er_diagram_and_commit_to_git") : t("save_er_diagram_locally")}>
                <span>
                  <Button 
                    variant="contained" 
                    color="success" 
                    size="small" 
                    startIcon={<SaveIcon />} 
                    onClick={() => {
                      if (logic.isLocalRepo) {
                        logic.setCommitDialogOpen(true);
                      } else {
                        logic.handleCommit();
                      }
                    }}
                    disabled={logic.isProcessing || isLoading}
                    disableElevation
                  >
                    {logic.isLocalRepo ? 'Git Commit' : t("save")}
                  </Button>
                </span>
              </Tooltip>

              <Tooltip title={!logic.isLocalRepo ? t("please_initialize_git_from_the_top_menu_first") : (!logic.isSaved ? t("please_save_the_er_diagram_first") : t("compare_diagram_with_past_version"))}>
                <span>
                  <Button 
                    variant="outlined" 
                    color="secondary"
                    size="small" 
                    startIcon={<CompareArrowsIcon />}
                    onClick={logic.handleOpenCompareMode}
                    disabled={!logic.isLocalRepo || !logic.isSaved || logic.isProcessing || isLoading}
                  >
                    {t("compare_history")}
                  </Button>
                </span>
              </Tooltip>

            </Box>

            <Tooltip title={t("export_image")} arrow placement="top">
              <span>
                <IconButton 
                  color="secondary" 
                  data-testid="er-export"
                  onClick={logic.handleExportImage} 
                  disabled={logic.customNodes.length === 0 || isLoading}
                  sx={{ border: '1px solid', borderColor: 'secondary.main', mr: 1, bgcolor: 'background.paper' }}
                >
                  <DownloadIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t("close")} arrow placement="top">
              <span>
                <IconButton 
                  color="default" 
                  onClick={logic.handleCloseCustomEr} 
                  disabled={isLoading}
                  sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
                >
                  <CloseIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Box sx={styles.diagramArea} ref={logic.reactFlowWrapper}>
            <MemoReactFlow
              nodes={logic.customNodes} edges={logic.customEdges} nodeTypes={nodeTypes} 
              onNodesChange={logic.onCustomNodesChange} onEdgesChange={logic.onCustomEdgesChange}
              onEdgeContextMenu={logic.handleEdgeContextMenu}
              fitView fitViewOptions={FIT_VIEW_OPTIONS}
              nodesDraggable={!isLoading} nodesConnectable={false} elementsSelectable={!isLoading}
              deleteKeyCode={isLoading ? null : ['Backspace', 'Delete']}
            >
              {FLOW_DECORATIONS}
            </MemoReactFlow>
          </Box>
        </>
      )}

      {/* Backdrop for operations such as Git commits. */}
      <Backdrop sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1, display: 'flex', flexDirection: 'column', gap: 2 }} open={logic.isProcessing}>
        <CircularProgress color="inherit" />
        <Typography variant="h6" fontWeight="bold">{t("communicating_with_git_server")}</Typography>
      </Backdrop>

      <Dialog open={!!logic.syncPreview} onClose={() => logic.setSyncPreview(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('er_sync_review')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>{t('er_sync_review_help')}</Typography>
          <List dense>
            {logic.syncPreview?.changes.map((change, index) => <ListItemText key={index}
              primary={`${change.table}${change.column ? ` / ${change.column}` : ''}`}
              secondary={change.status === 'added' ? t('er_change_added') : change.status === 'deleted' ? t('er_change_deleted') : t('er_change_modified')} />)}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => logic.setSyncPreview(null)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={logic.handleApplySync} disabled={isLoading || logic.isProcessing}>{t('er_apply_sync')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={logic.commitDialogOpen} onClose={() => !logic.isProcessing && logic.setCommitDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("execute_git_commit")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
            {t("save_the_current_er_diagram_to_a_file_and_record_it_as_history")}<br />
            {t("enter_details_so_it_s_easy_to_understand_when_looking_at_history_later")}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            rows={3}
            variant="outlined"
            label={t("commit_message_optional")}
            placeholder={t("e_g_added_table_and_modified_relation")}
            value={logic.commitMessage}
            onChange={(e) => logic.setCommitMessage(e.target.value)}
            disabled={logic.isProcessing}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => logic.setCommitDialogOpen(false)} disabled={logic.isProcessing}>{t("cancel")}</Button>
          <Button onClick={logic.handleCommit} variant="contained" disabled={logic.isProcessing} disableElevation>
            {t("record")}
          </Button>
        </DialogActions>
      </Dialog>

      <ObjectPickerDialog open={logic.addTableDialogOpen} dbType={logic.isPg ? 'postgresql' : 'oracle'}
        fixedSchema={logic.customSchema} categories={ER_OBJECT_CATEGORIES} title={t('add_tables_and_views')}
        disabled={isLoading} isObjectAdded={logic.isObjectAdded} onConfirm={logic.handleAddObjectsToCustomCanvas}
        onClose={() => logic.setAddTableDialogOpen(false)} />

      <Dialog open={logic.addRelationDialogOpen} onClose={() => logic.setAddRelationDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{logic.relationEditMode ? t("edit_relation") : t("add_relation")}</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControl fullWidth size="small">
              <InputLabel shrink>{t("parent_table_1")}</InputLabel>
              <Select value={logic.relationForm.sourceTable} notched onChange={(e) => logic.setRelationForm({ ...logic.relationForm, sourceTable: e.target.value as string })}>
                {logic.customNodes.map((n) => <MenuItem key={n.id} value={n.id}>{n.id}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel shrink>{t("parent_cardinality")}</InputLabel>
              <Select value={logic.relationForm.sourceCard} notched onChange={(e) => logic.setRelationForm({ ...logic.relationForm, sourceCard: e.target.value as string })}>
                <MenuItem value="1">{t("1_only")}</MenuItem>
                <MenuItem value="01">{t("0_or_1")}</MenuItem>
                <MenuItem value="N">{t("1_or_more_many")}</MenuItem>
                <MenuItem value="0N">{t("0_or_more_many")}</MenuItem>
                <MenuItem value="MANY">{t("many_no_symbol")}</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Typography variant="body2" align="center" color="text.secondary">{t("relationship")}</Typography>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <FormControl fullWidth size="small">
              <InputLabel shrink>{t("child_table_many")}</InputLabel>
              <Select value={logic.relationForm.targetTable} notched onChange={(e) => logic.setRelationForm({ ...logic.relationForm, targetTable: e.target.value as string })}>
                {logic.customNodes.map((n) => <MenuItem key={n.id} value={n.id}>{n.id}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel shrink>{t("child_cardinality")}</InputLabel>
              <Select value={logic.relationForm.targetCard} notched onChange={(e) => logic.setRelationForm({ ...logic.relationForm, targetCard: e.target.value as string })}>
                <MenuItem value="1">{t("1_only")}</MenuItem>
                <MenuItem value="01">{t("0_or_1")}</MenuItem>
                <MenuItem value="N">{t("1_or_more_many")}</MenuItem>
                <MenuItem value="0N">{t("0_or_more_many")}</MenuItem>
                <MenuItem value="MANY">{t("many_no_symbol")}</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => logic.setAddRelationDialogOpen(false)} color="inherit">{t("cancel")}</Button>
          <Button onClick={logic.handleSaveRelation} variant="contained">{t("save")}</Button>
        </DialogActions>
      </Dialog>

      <Menu
        open={logic.edgeContextMenu !== null} onClose={() => logic.setEdgeContextMenu(null)}
        anchorReference="anchorPosition" anchorPosition={logic.edgeContextMenu !== null ? { top: logic.edgeContextMenu.mouseY, left: logic.edgeContextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={logic.handleEditRelation}>{t("edit_relation_2")}</MenuItem>
        <MenuItem onClick={logic.handleDeleteRelation} sx={{ color: 'error.main' }}>{t("remove_relation")}</MenuItem>
      </Menu>
    </Box>
  );
}
