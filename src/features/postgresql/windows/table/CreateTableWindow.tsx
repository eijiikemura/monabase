// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0


import { 
  Box, Paper, Typography, TextField, Button 
} from '@mui/material';
import { DataGrid, type GridColDef, jaJP } from '@mui/x-data-grid';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import { useTranslation } from 'react-i18next';

import ColumnDefDialog from '../common/ColumnDefDialog';
import { useCreateTableWindow, type CreateTableWindowProps } from './useCreateTableWindow';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', height: '100%', bgcolor: 'background.default', p: 2 }),
  topPaper: { p: 2, mb: 2, display: 'flex', gap: 2, alignItems: 'center', bgcolor: 'background.paper' },
  nameInput: { width: 250 },
  commentInput: { flexGrow: 1 },
  gridPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  gridHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  gridWrapper: { flexGrow: 1, minHeight: 0 },
  dataGridRoot: { border: 0 },
  pkText: { color: 'error.main', fontWeight: 'bold' },
  actionBox: { display: 'flex', gap: 1 }
};

export default function CreateTableWindowPostgresql(props: CreateTableWindowProps) {
  const { t } = useTranslation();

  const {
    tableName, setTableName, tableComment, setTableComment, columns, isLoading,
    sequences, userTypes, alterDialog, setAlterDialog,
    handleOpenAddColumnDialog, handleOpenEditDialog, submitAlterColumn, handleDropColumn, submitCreateTable
  } = useCreateTableWindow(props);

  const structureGridColumns: GridColDef[] = [
    { field: 'PK_POSITION', headerName: 'PK', width: 60, renderCell: (p) => <span style={styles.pkText}>{p.value ? 'PK' : ''}</span> },
    { field: 'COLUMN_NAME', headerName: t("column_name"), flex: 1.5, minWidth: 150 },
    { field: 'DATA_TYPE', headerName: t("data_type"), flex: 1 },
    { field: 'LENGTH_PRECISION', headerName: t("length_precision"), flex: 1, renderCell: (p) => <span>{p.row.DATA_LENGTH} {p.row.DATA_SCALE ? `(${p.row.DATA_LENGTH}, ${p.row.DATA_SCALE})` : ''}</span> },
    { field: 'NULLABLE', headerName: t("allow_nulls"), width: 80, renderCell: (p) => <span>{p.row.NULLABLE === 'Y' ? 'Yes' : 'No'}</span> },
    { field: 'DATA_DEFAULT', headerName: t("default_value"), flex: 1 },
    { field: 'COMMENTS', headerName: t("comment"), flex: 2, minWidth: 200 },
    { 
      field: 'actions', headerName: t("action"), width: 160,
      renderCell: (p) => (
        <Box sx={styles.actionBox}>
          {/* Disable edit and delete buttons during creation. */}
          <Button 
            size="small" 
            variant="outlined" 
            disabled={isLoading}
            onClick={() => handleOpenEditDialog(p.row)}
          >
            {t("edit")}
          </Button>
          <Button 
            size="small" 
            variant="outlined" 
            color="error" 
            disabled={isLoading}
            onClick={() => handleDropColumn(p.row.id)}
          >
            {t("delete")}
          </Button>
        </Box>
      ) 
    }
  ];

  if (!props.isActive) return null;

  return (
    <Box sx={styles.rootBox(props.isActive)}>
      <Paper elevation={1} sx={styles.topPaper}>
        <TextField 
          label={t("table_name")}
          variant="outlined" 
          size="small" 
          value={tableName} 
          disabled={isLoading}
          onChange={(e) => setTableName(e.target.value.toLowerCase())} 
          sx={styles.nameInput} 
          placeholder={t("e_g_users_2")}
        />
        <TextField 
          label={t("table_comment_logical_name_etc")}
          variant="outlined" 
          size="small" 
          value={tableComment} 
          disabled={isLoading}
          onChange={(e) => setTableComment(e.target.value)} 
          sx={styles.commentInput} 
        />
        {/* Disable buttons during creation. */}
        <Button 
          variant="contained" 
          color="primary" 
          startIcon={<SaveIcon />} 
          onClick={submitCreateTable} 
          disabled={columns.length === 0 || !tableName.trim() || isLoading}
        >
          {t("create_table")}
        </Button>
      </Paper>

      <Paper elevation={1} sx={styles.gridPaper}>
        <Box sx={styles.gridHeader}>
          <Typography variant="subtitle2" fontWeight="bold">{t("column_definition_in_memory_edit")}</Typography>
          {/* Disable column addition during creation. */}
          <Button 
            variant="outlined" 
            color="primary" 
            size="small" 
            startIcon={<AddIcon />} 
            disabled={isLoading}
            onClick={handleOpenAddColumnDialog}
          >
            {t("add_column_2")}
          </Button>
        </Box>
        <Box sx={styles.gridWrapper}>
          <DataGrid 
            rows={columns} 
            columns={structureGridColumns} 
            density="compact" 
            hideFooter 
            disableRowSelectionOnClick 
            localeText={jaJP.components.MuiDataGrid.defaultProps.localeText} 
            sx={styles.dataGridRoot} 
          />
        </Box>
      </Paper>

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
        showPkCheckbox={true} 
      />
    </Box>
  );
}