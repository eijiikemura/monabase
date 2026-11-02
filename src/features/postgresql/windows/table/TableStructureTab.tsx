// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { UniqueKeyPosition } from "@/shared/types/databaseTypes";

import React from 'react';
import { 
  Box, Paper, Typography, TextField, Button, 
  IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, Menu, MenuItem, ListItemIcon,
  Accordion, AccordionSummary, AccordionDetails, ListItemText, Divider
} from '@mui/material';
import { DataGrid, type GridColDef, jaJP } from '@mui/x-data-grid';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import FlashOffIcon from '@mui/icons-material/FlashOff';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';

import ColumnDefDialog from '../common/ColumnDefDialog';
import { useTableStructureTab, type TableStructureTabProps } from './useTableStructureTab';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1, minHeight: 0 }),
  topPaper: (height: number) => ({ height, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' }),
  topHeaderBox: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  commentWrapper: { display: 'flex', alignItems: 'center', gap: 2 },
  commentLabel: { color: 'text.secondary' },
  commentText: { color: 'text.primary' },
  actionsWrapper: { display: 'flex', alignItems: 'center', gap: 1 },
  gridWrapper: { flexGrow: 1, minHeight: 0 },
  dataGridRoot: { border: 0 },
  hResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }),
  hResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomScrollBox: { flexGrow: 1, overflowY: 'auto' as const, p: 1, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', minHeight: 0 },
  accordionRoot: { border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' }, mb: 1 },
  accordionRootLast: { border: '1px solid', borderColor: 'divider', '&:before': { display: 'none' } },
  accordionSummary: { bgcolor: 'background.paper', minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center' } },
  accordionTitle: { flexGrow: 1 },
  accordionDetails: { p: 0 },
  nestedGridRoot: { border: 0, '& .MuiDataGrid-row:hover': { cursor: 'pointer' } },
  menuItemText: { fontSize: '0.85rem' },
  menuItemRedText: { fontSize: '0.85rem', color: 'error.main' },
  menuDivider: { my: 0.5 },
  dialogContent: { minWidth: 350, pt: 1 },
  dialogInput: { mt: 1 },
  pkColorComp: { color: 'secondary.main', fontWeight: 'bold' },
  pkColorNormal: { color: 'error.main', fontWeight: 'bold' },
  ukColorComp: { color: 'info.main', fontWeight: 'bold' },
  ukColorNormal: { color: 'warning.main', fontWeight: 'bold' },
  ukComma: { color: 'text.primary', marginRight: '4px' },
  dashColor: { color: 'text.disabled' },
  statusGray: { color: 'text.disabled' }
};

export default function TableStructureTabPostgresql(props: TableStructureTabProps) {
  const { t } = useTranslation();

  const {
    isLoading, tableComment, structureRows, indexRows, triggerRows, constraintRows,
    structureHeight, isResizingStructure, setIsResizingStructure,
    sequences, userTypes, setRefreshTrigger, alterDialog, setAlterDialog, tableCommentDialog, setTableCommentDialog,
    menuState, setMenuState,
    submitTableComment, handleOpenAddColumnDialog, handleOpenAlterDialog, submitAlterColumn, handleDropColumn, handleDropTable,
    handleOpenIndexWindow, handleOpenTriggerWindow, handleContextMenu, handleToggleEnable, handleDeleteObject
  } = useTableStructureTab(props);

  const structureGridColumns: GridColDef[] = [
    { field: 'rowNo', headerName: 'No.', width: 50 },
    { field: 'COLUMN_NAME', headerName: t("column_name"), flex: 1.5, minWidth: 150 },
    { field: 'DATA_TYPE', headerName: t("data_type"), width: 180 },
    { 
      field: 'LENGTH_PRECISION', 
      headerName: t("length_precision"),
      width: 130,
      align: 'center', headerAlign: 'center', 
      renderCell: (p) => {
        const typeUpper = String(p.row.DATA_TYPE).toUpperCase();
        if (typeUpper.includes('TEXT') || typeUpper.includes('BYTEA') || typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP') || typeUpper.includes('TIME')) {
          return <span style={styles.dashColor}>-</span>;
        }
        return <span>{p.row.DATA_LENGTH} {p.row.DATA_SCALE != null ? `(${p.row.DATA_LENGTH}, ${p.row.DATA_SCALE})` : ''}</span>;
      } 
    },
    { 
      field: 'PK_POSITION', 
      headerName: 'PK', 
      width: 60,
      align: 'center', headerAlign: 'center', 
      renderCell: (p) => {
        if (!p.value) return null;
        return <span style={p.row.IS_PK_COMPOSITE ? styles.pkColorComp : styles.pkColorNormal}>{p.value}</span>;
      }
    },
    { 
      field: 'UK_DATA', 
      headerName: 'UK', 
      width: 60,
      align: 'center', headerAlign: 'center', 
      renderCell: (p) => {
        const ukData = p.value;
        if (!ukData || ukData.length === 0) return null;
        return (
          <span style={{ display: 'inline-block' }}>
            {ukData.map((uk: UniqueKeyPosition, idx: number) => {
              return (
                <React.Fragment key={idx}>
                  <span style={uk.isComposite ? styles.ukColorComp : styles.ukColorNormal}>{uk.pos}</span>
                  {idx < ukData.length - 1 && <span style={styles.ukComma}>,</span>}
                </React.Fragment>
              );
            })}
          </span>
        );
      }
    },
    { 
      field: 'NULLABLE_DISP', 
      headerName: t("allow_nulls"),
      width: 80, 
      align: 'center', headerAlign: 'center', 
      renderCell: (p) => <span>{p.row.NULLABLE === 'Y' ? 'Yes' : 'No'}</span> 
    },
    { 
      field: 'DATA_DEFAULT', 
      headerName: t("default_value"),
      flex: 1.5,
      minWidth: 150,
      align: 'right', headerAlign: 'right', 
      renderCell: (p) => (
        <Tooltip title={p.value || ''} arrow placement="bottom-end">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', display: 'block', textAlign: 'right' }}>
            {p.value}
          </span>
        </Tooltip>
      )
    },
    { 
      field: 'COMMENTS', 
      headerName: t("comment"),
      flex: 2, 
      minWidth: 200,
      align: 'right', headerAlign: 'right',
      renderCell: (p) => (
        <Tooltip title={p.value || ''} arrow placement="bottom-end">
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', display: 'block', textAlign: 'right' }}>
            {p.value}
          </span>
        </Tooltip>
      )
    },
    { 
      field: 'actions', headerName: t("action"), width: 100,
      renderCell: (p) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {/* Disable the inline definition editor. */}
          <Tooltip title={t("change_definition_of_this_column")}>
            <span>
              <IconButton 
                size="small" 
                color="primary" 
                disabled={isLoading}
                onClick={(e) => { e.stopPropagation(); handleOpenAlterDialog(p.row); }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          {/* Disable inline column deletion. */}
          <Tooltip title={t("drop_this_column")}>
            <span>
              <IconButton 
                size="small" 
                color="error" 
                disabled={isLoading}
                onClick={(e) => { e.stopPropagation(); handleDropColumn(p.row.COLUMN_NAME); }}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      ) 
    }
  ];

  const handleCopyStructure = () => {
    if (structureGridColumns.length === 0 || structureRows.length === 0 || isLoading) return;
    const cols = structureGridColumns.filter(c => c.field !== 'actions');
    const text = `${cols.map(c => c.headerName).join('\t')}\n${structureRows.map(r => cols.map(c => {
      if (c.field === 'LENGTH_PRECISION') {
         const typeUpper = String(r.DATA_TYPE).toUpperCase();
         if (typeUpper.includes('TEXT') || typeUpper.includes('BYTEA') || typeUpper.includes('DATE') || typeUpper.includes('TIMESTAMP') || typeUpper.includes('TIME')) return '-';
         return `${r.DATA_LENGTH}${r.DATA_SCALE != null ? `(${r.DATA_LENGTH}, ${r.DATA_SCALE})` : ''}`;
      }
      if (c.field === 'NULLABLE_DISP') return r.NULLABLE === 'Y' ? 'Yes' : 'No';
      if (c.field === 'UK_DATA') {
         if (!r.UK_DATA || r.UK_DATA.length === 0) return '';
         return r.UK_DATA.map((uk: UniqueKeyPosition) => uk.pos).join(', ');
      }
      return Object.entries(r).find(([field]) => field === c.field)?.[1] || '';
    }).join('\t')).join('\n')}`;
    navigator.clipboard.writeText(text);
    alert(t("table_structure_copied_to_clipboard"));
  };

  const indexGridColumns: GridColDef[] = [
    { field: 'INDEX_NAME', headerName: t("index_name"), flex: 1.5 },
    { field: 'TYPE_DISP', headerName: t("type_2"), width: 130 },
    { field: 'UNIQUENESS', headerName: t("uniqueness"), width: 100 },
    { field: 'COLUMNS', headerName: t("columns_order"), flex: 3 },
  ];

  const triggerGridColumns: GridColDef[] = [
    { field: 'TRIGGER_NAME', headerName: t("trigger_name"), flex: 1.5 },
    { field: 'TRIGGER_TYPE', headerName: t("timing_events"), flex: 3 },
    { field: 'STATUS', headerName: t("status_3"), width: 100, renderCell: (p) => <span style={p.value === 'DISABLED' ? styles.statusGray : {}}>{p.value}</span> },
  ];

  const constraintGridColumns: GridColDef[] = [
    { field: 'CONSTRAINT_NAME', headerName: t("constraint_name"), flex: 1.5 },
    { field: 'CONSTRAINT_TYPE', headerName: t("type_2"), width: 80 },
    { field: 'SEARCH_CONDITION', headerName: t("condition"), flex: 3 },
  ];

  if (!props.isActive) return null;

  return (
    <Box data-testid="table-structure" sx={styles.rootBox(props.isActive)}>
      <Paper elevation={1} sx={styles.topPaper(structureHeight)}>
        <Box sx={styles.topHeaderBox}>
          <Box sx={styles.commentWrapper}>
            <Typography variant="body2" sx={styles.commentLabel}>
              {t("comment_2")} <strong style={styles.commentText}>{tableComment || t("not_set_2")}</strong>
            </Typography>
            {/* Disable table comment editing. */}
            <Tooltip title={t("change_table_comment_2")}>
              <span>
                <IconButton 
                  size="small" 
                  disabled={isLoading}
                  onClick={() => setTableCommentDialog({ isOpen: true, comment: tableComment })}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
          <Box sx={styles.actionsWrapper}>
            {/* Disable structure refresh. */}
            <Tooltip title={t("refresh_structure")}>
              <span>
                <IconButton 
                  color="primary" 
                  disabled={isLoading}
                  onClick={() => setRefreshTrigger(prev => prev + 1)} 
                  size="small"
                >
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
            {/* Disable table deletion. */}
            <Tooltip title={t("drop_table")}><span><IconButton color="error" size="small" onClick={handleDropTable} disabled={isLoading} aria-label={t("drop_table")}><DeleteOutlineIcon /></IconButton></span></Tooltip>
            {/* Disable column addition. */}
            <Tooltip title={t("add_column_2")}><span><IconButton color="primary" size="small" onClick={handleOpenAddColumnDialog} disabled={isLoading} aria-label={t("add_column_2")}><AddIcon /></IconButton></span></Tooltip>
            {/* Disable copying to the clipboard. */}
            <Tooltip title={t("copy_table_structure_tsv")}>
              <span>
                <IconButton 
                  color="primary" 
                  disabled={isLoading}
                  onClick={handleCopyStructure} 
                  size="small"
                >
                  <ContentCopyIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
        <Box sx={styles.gridWrapper}>
          <DataGrid 
            rows={structureRows} 
            columns={structureGridColumns} 
            density="compact" 
            hideFooter 
            loading={isLoading}
            disableRowSelectionOnClick 
            localeText={jaJP.components.MuiDataGrid.defaultProps.localeText} 
            onRowDoubleClick={(params) => {
              if (!isLoading) handleOpenAlterDialog(params.row);
            }}
            sx={{ ...styles.dataGridRoot, '& .MuiDataGrid-row:hover': { cursor: isLoading ? 'default' : 'pointer' } }} 
          />
        </Box>
      </Paper>
      
      <Box 
        onMouseDown={() => setIsResizingStructure(true)} 
        sx={styles.hResizer(isResizingStructure)} 
      >
        <Box sx={styles.hResizerInner(isResizingStructure)} />
      </Box>
      
      <Box sx={styles.bottomScrollBox}>
        
        {/* Indexes. */}
        <Accordion defaultExpanded disableGutters elevation={1} sx={styles.accordionRoot}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={styles.accordionSummary}>
            <Typography variant="subtitle2" fontWeight="bold" sx={styles.accordionTitle}>{t("index_2")}</Typography>
            <Button 
              variant="outlined" 
              color="primary" 
              size="small" 
              startIcon={<AddIcon />} 
              disabled={isLoading}
              onClick={(e) => { e.stopPropagation(); handleOpenIndexWindow(); }}
            >
              {t("add")}
            </Button>
          </AccordionSummary>
          <AccordionDetails sx={styles.accordionDetails}>
            <DataGrid 
              autoHeight
              rows={indexRows} 
              columns={indexGridColumns} 
              density="compact" 
              hideFooter 
              loading={isLoading}
              disableRowSelectionOnClick 
              localeText={jaJP.components.MuiDataGrid.defaultProps.localeText} 
              sx={styles.nestedGridRoot} 
              onRowDoubleClick={(params) => {
                if (!isLoading) {
                  window.dispatchEvent(new CustomEvent('open-edit-index-tab', { detail: { schema: props.schema, indexName: params.row.INDEX_NAME } }));
                }
              }}
              slotProps={{ 
                row: { 
                  onContextMenu: (e) => {
                    if (isLoading) return;
                    const rowId = e.currentTarget.getAttribute('data-id'); 
                    const row = indexRows.find(r => r.id === rowId); 
                    if (row) handleContextMenu(e, 'index', row); 
                  } 
                } 
              }}
            />
          </AccordionDetails>
        </Accordion>

        {/* CHECK constraints. */}
        <Accordion disableGutters elevation={1} sx={styles.accordionRoot}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={styles.accordionSummary}>
            <Typography variant="subtitle2" fontWeight="bold" sx={styles.accordionTitle}>{t("check_constraint_2")}</Typography>
            <Button 
              variant="outlined" 
              color="primary" 
              size="small" 
              startIcon={<AddIcon />} 
              disabled={isLoading}
              onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('open-create-constraint-tab', { detail: { schema: props.schema, tableName: props.tableName } })); }}
            >
              {t("add")}
            </Button>
          </AccordionSummary>
          <AccordionDetails sx={styles.accordionDetails}>
            <DataGrid 
              autoHeight
              rows={constraintRows} 
              columns={constraintGridColumns} 
              density="compact" 
              hideFooter 
              loading={isLoading}
              disableRowSelectionOnClick 
              localeText={jaJP.components.MuiDataGrid.defaultProps.localeText} 
              sx={styles.nestedGridRoot} 
              onRowDoubleClick={(params) => {
                if (!isLoading) {
                  window.dispatchEvent(new CustomEvent('open-edit-constraint-tab', { detail: { schema: props.schema, tableName: props.tableName, constraintName: params.row.CONSTRAINT_NAME } }));
                }
              }}
              slotProps={{ 
                row: { 
                  onContextMenu: (e) => {
                    if (isLoading) return;
                    const rowId = e.currentTarget.getAttribute('data-id'); 
                    const row = constraintRows.find(r => r.id === rowId); 
                    if (row) handleContextMenu(e, 'constraint', row); 
                  } 
                } 
              }}
            />
          </AccordionDetails>
        </Accordion>

        {/* Triggers. */}
        <Accordion disableGutters elevation={1} sx={styles.accordionRootLast}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={styles.accordionSummary}>
            <Typography variant="subtitle2" fontWeight="bold" sx={styles.accordionTitle}>{t("trigger_2")}</Typography>
            <Button 
              variant="outlined" 
              color="primary" 
              size="small" 
              startIcon={<AddIcon />} 
              disabled={isLoading}
              onClick={(e) => { e.stopPropagation(); handleOpenTriggerWindow(); }}
            >
              {t("add")}
            </Button>
          </AccordionSummary>
          <AccordionDetails sx={styles.accordionDetails}>
            <DataGrid 
              autoHeight
              rows={triggerRows} 
              columns={triggerGridColumns} 
              density="compact" 
              hideFooter 
              loading={isLoading}
              disableRowSelectionOnClick 
              localeText={jaJP.components.MuiDataGrid.defaultProps.localeText} 
              sx={styles.nestedGridRoot} 
              onRowDoubleClick={(params) => {
                if (!isLoading) {
                  window.dispatchEvent(new CustomEvent('open-edit-trigger-tab', { detail: { schema: props.schema, triggerName: params.row.TRIGGER_NAME } }));
                }
              }}
              slotProps={{ 
                row: { 
                  onContextMenu: (e) => {
                    if (isLoading) return;
                    const rowId = e.currentTarget.getAttribute('data-id'); 
                    const row = triggerRows.find(r => r.id === rowId); 
                    if (row) handleContextMenu(e, 'trigger', row); 
                  } 
                } 
              }}
            />
          </AccordionDetails>
        </Accordion>

      </Box>

      <Menu open={menuState !== null} onClose={() => setMenuState(null)} anchorReference="anchorPosition" anchorPosition={menuState !== null ? { top: menuState.mouseY, left: menuState.mouseX } : undefined}>
        {menuState && (
          <Box>
            {menuState.type === 'trigger' && (
              menuState.status === 'DISABLED' ? (
                <MenuItem onClick={handleToggleEnable} sx={styles.menuItemText}>
                  <ListItemIcon><FlashOnIcon fontSize="small" color="primary" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("enable_enable")}</ListItemText>
                </MenuItem>
              ) : (
                <MenuItem onClick={handleToggleEnable} sx={styles.menuItemText}>
                  <ListItemIcon><FlashOffIcon fontSize="small" color="action" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("disable_disable")}</ListItemText>
                </MenuItem>
              )
            )}
            {menuState.type === 'trigger' && <Divider sx={styles.menuDivider} />}
            <MenuItem onClick={handleDeleteObject} sx={styles.menuItemRedText}>
              <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("drop")}</ListItemText>
            </MenuItem>
          </Box>
        )}
      </Menu>

      <ColumnDefDialog 
        isOpen={alterDialog.isOpen} 
        mode={alterDialog.mode} 
        schema={props.schema} 
        sequences={sequences} 
        userTypes={userTypes}
        dialogState={alterDialog} 
        setDialogState={setAlterDialog} 
        onSubmit={submitAlterColumn} 
        onClose={() => setAlterDialog({ ...alterDialog, isOpen: false })} 
      />

      <Dialog open={tableCommentDialog.isOpen} onClose={() => setTableCommentDialog({ ...tableCommentDialog, isOpen: false })}>
        <DialogTitle>{t("change_table_comment")}</DialogTitle>
        <DialogContent sx={styles.dialogContent}><TextField autoFocus margin="dense" label={t("table_comment")} type="text" fullWidth variant="outlined" size="small" value={tableCommentDialog.comment} onChange={(e) => setTableCommentDialog({ ...tableCommentDialog, comment: e.target.value })} sx={styles.dialogInput} /></DialogContent>
        <DialogActions><Button onClick={() => setTableCommentDialog({ ...tableCommentDialog, isOpen: false })}>{t("cancel")}</Button><Button onClick={submitTableComment} variant="contained" color="primary">{t("execute_changes")}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}