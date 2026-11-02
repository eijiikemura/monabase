// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0


import { 
  Box, Paper, Typography, Button, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, FormControl, InputLabel,
  Select, MenuItem, TextField, Checkbox, ListItemText
} from '@mui/material';
import { DataGrid, type GridColDef, jaJP, enUS } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { useTableRelationTab, type TableRelationTabProps } from './useTableRelationTab';
import { useTranslation } from 'react-i18next';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1 }),
  paperBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  headerBox: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  gridWrapper: { flexGrow: 1, minHeight: 0 },
  dataGridRoot: { border: 0 },
  dialogContent: { minWidth: 400, pt: 1 },
  dialogFormBox: { display: 'flex', flexDirection: 'column' as const, gap: 3, mt: 1 },
  sourceColBox: { border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 },
  stepLabel1: { display: 'block', mb: 1 },
  targetColBox: { border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  stepLabel2: { display: 'block' }
};

export default function TableRelationTab(props: TableRelationTabProps) {
  const { i18n } = useTranslation();
  const isEnglish = i18n.language === 'en';
  const dataGridLocaleText = isEnglish ? enUS.components.MuiDataGrid.defaultProps.localeText : jaJP.components.MuiDataGrid.defaultProps.localeText;

  const {
    t, isLoading, isDialogLoading, relationsRows, dialogOpen, setDialogOpen,
    fkName, setFkName, sourceColumns, setSourceColumns,
    targetTable, targetColumns, setTargetColumns,
    deleteRule, setDeleteRule, currentTableCols, allTables, targetTableCols,
    handleTargetTableChange, handleOpenAddDialog, submitRelation, handleDropRelation
  } = useTableRelationTab(props);

  const columnsDef: GridColDef[] = [
    { field: 'CONSTRAINT_NAME', headerName: t("constraint_name_fk_name"), flex: 1.5 },
    { field: 'SOURCE_COLUMNS', headerName: t("target_column_self"), flex: 1.5 },
    { field: 'TARGET_TABLE', headerName: t("referenced_table"), flex: 1.5 },
    { field: 'TARGET_COLUMNS', headerName: t("ref_column"), flex: 1.5 },
    { field: 'DELETE_RULE', headerName: t("on_delete_rule"), flex: 1 },
    { 
      field: 'actions', headerName: t("action"), width: 80,
      renderCell: (p) => (
        <Tooltip title={t("drop_this_foreign_key")}>
          <span>
            <IconButton size="small" color="error" disabled={isLoading} onClick={() => handleDropRelation(p.row.CONSTRAINT_NAME)}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) 
    }
  ];

  if (!props.isActive) return null;

  return (
    <Box sx={styles.rootBox(props.isActive)}>
      <Paper elevation={1} sx={styles.paperBox}>
        <Box sx={styles.headerBox}>
          <Typography variant="subtitle2" fontWeight="bold">{t("relation_info_foreign_keys")}</Typography>
          <Button variant="outlined" color="primary" size="small" startIcon={<AddIcon />} onClick={handleOpenAddDialog} disabled={isLoading}>
            {t("add_relation_2")}
          </Button>
        </Box>
        <Box sx={styles.gridWrapper}>
          <DataGrid 
            rows={relationsRows} 
            columns={columnsDef} 
            density="compact" 
            hideFooter 
            loading={isLoading}
            disableRowSelectionOnClick 
            localeText={dataGridLocaleText} 
            sx={styles.dataGridRoot} 
          />
        </Box>
      </Paper>

      <Dialog 
        open={dialogOpen} 
        onClose={(_event, reason) => {
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setDialogOpen(false);
        }} 
        maxWidth="sm" 
        fullWidth
      >
        <DialogTitle>{t("add_relation_foreign_key")}</DialogTitle>
        <DialogContent sx={styles.dialogContent}>
          <Box component="fieldset" disabled={isDialogLoading} sx={{ ...styles.dialogFormBox, border: 0, p: 0, minWidth: 0 }}>
            
            <TextField 
              label={t("constraint_name_auto_generated_if_empty")}
              size="small" variant="outlined" fullWidth 
              value={fkName} onChange={(e) => setFkName(e.target.value.toUpperCase())} 
            />

            <Box sx={styles.sourceColBox}>
              <Typography variant="caption" color="text.secondary" sx={styles.stepLabel1}>{t("1_select_your_table_columns")}</Typography>
              <FormControl fullWidth size="small" disabled={isDialogLoading}>
                <InputLabel>{t("target_columns_multi_select")}</InputLabel>
                <Select 
                  multiple value={sourceColumns} 
                  onChange={(e) => setSourceColumns(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])} 
                  label={t("target_columns_multi_select")} renderValue={(selected) => (selected as string[]).join(', ')}
                >
                  {currentTableCols.map((col) => (
                    <MenuItem key={col} value={col}>
                      <Checkbox checked={sourceColumns.indexOf(col) > -1} />
                      <ListItemText primary={col} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Box sx={styles.targetColBox}>
              <Typography variant="caption" color="text.secondary" sx={styles.stepLabel2}>{t("2_select_referenced_table_and_columns")}</Typography>
              <FormControl fullWidth size="small" disabled={isDialogLoading}>
                <InputLabel>{t("referenced_table")}</InputLabel>
                <Select value={targetTable} label={t("referenced_table")} onChange={(e) => handleTargetTableChange(e.target.value as string)}>
                  {allTables.map((tbl) => <MenuItem key={tbl} value={tbl}>{tbl}</MenuItem>)}
                </Select>
              </FormControl>

              <FormControl fullWidth size="small" disabled={isDialogLoading || !targetTable}>
                <InputLabel>{t("referenced_columns_multi_select")}</InputLabel>
                <Select 
                  multiple value={targetColumns} 
                  onChange={(e) => setTargetColumns(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])} 
                  label={t("referenced_columns_multi_select")} renderValue={(selected) => (selected as string[]).join(', ')}
                >
                  {targetTableCols.map((col) => (
                    <MenuItem key={col} value={col}>
                      <Checkbox checked={targetColumns.indexOf(col) > -1} />
                      <ListItemText primary={col} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <FormControl fullWidth size="small" disabled={isDialogLoading}>
              <InputLabel>{t("rule_when_referenced_data_is_deleted")}</InputLabel>
              <Select value={deleteRule} label={t("rule_when_referenced_data_is_deleted")} onChange={(e) => setDeleteRule(e.target.value as string)}>
                <MenuItem value="NO ACTION">{t("no_action_prevent_deletion_throw_error")}</MenuItem>
                <MenuItem value="CASCADE">{t("cascade_also_delete_related_own_data")}</MenuItem>
                <MenuItem value="SET NULL">{t("set_null_set_own_data_to_null")}</MenuItem>
              </Select>
            </FormControl>

          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
          <Button onClick={submitRelation} disabled={isDialogLoading} variant="contained" color="primary">{t("execute_add")}</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}