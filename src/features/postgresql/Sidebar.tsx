// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { navigateSidebar, sidebarObjectKey } from '@/features/objects/sidebarNavigation';
import { SidebarCategoryStatus } from '@/features/objects/SidebarCategoryStatus';
import ClearIcon from '@mui/icons-material/Clear';
import { triggerTabKey } from './triggerIdentity';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';
import { routineTabKey } from './routineIdentity';
import type { SidebarObject } from "@/shared/types/databaseTypes";

import React from 'react';
import {
  Paper, Box, Typography, IconButton, Divider, List, ListItemButton,
  ListItemIcon, ListItemText, Collapse, Menu, MenuItem, TextField, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button,
  CircularProgress
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import FolderIcon from '@mui/icons-material/Folder';
import TableChartIcon from '@mui/icons-material/TableChart';
import SettingsIcon from '@mui/icons-material/Settings';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import TerminalIcon from '@mui/icons-material/Terminal';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FunctionsIcon from '@mui/icons-material/Functions';
import DescriptionIcon from '@mui/icons-material/Description';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import FlashOffIcon from '@mui/icons-material/FlashOff';
import SortIcon from '@mui/icons-material/Sort';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import ViewListIcon from '@mui/icons-material/ViewList';
import LayersIcon from '@mui/icons-material/Layers';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';

import ExportDialog from "@/components/data/ExportDialog";
import ImportDialog from "@/components/data/ImportDialog";
import { useSidebarLogic } from './useSidebarLogic';

const styles = {
  sidebarPaper: (width: number) => ({ width, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper', position: 'relative' as const }),
  headerBox: (isOpen: boolean) => ({ display: 'flex', alignItems: 'center', justifyContent: isOpen ? 'space-between' : 'center', p: 1, minHeight: 48, flexShrink: 0 }),
  headerText: { fontWeight: 'bold', color: 'text.secondary', whiteSpace: 'nowrap' as const, overflow: 'hidden' },
  divider: { flexShrink: 0 },
  mainListContainer: (isOpen: boolean) => ({ flexGrow: 1, overflowY: 'auto' as const, overflowX: 'hidden' as const, display: isOpen ? 'block' : 'none' }),
  schemaItem: { py: 0.5, px: 2 },
  schemaIcon: (isOpen: boolean) => ({ minWidth: 0, mr: isOpen ? 2 : 0 }),
  typeItem: { pl: 4, py: 0.3 },
  typeIcon: { minWidth: 28 },
  filterBox: { display: 'flex', alignItems: 'center', pl: 7, pr: 2, py: 0.5, bgcolor: 'action.hover' },
  filterInput: { flexGrow: 1, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.5 } },
  filterBtn: { ml: 0.5 },
  emptyText: { pl: 7, py: 0.3, color: 'text.disabled', fontStyle: 'italic', '& .MuiListItemText-primary': { fontSize: '0.8rem' } },
  loadingBox: { display: 'flex', alignItems: 'center', gap: 1.5, pl: 7, py: 0.8, color: 'text.secondary' },
  objItem: (isSelected: boolean) => ({ pl: 7, py: 0.2, bgcolor: isSelected ? 'action.selected' : 'inherit' }),
  objIcon: { minWidth: 28 },
  objText: (isDisabled: boolean) => ({ '& .MuiListItemText-primary': { fontSize: '0.85rem', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis', color: isDisabled ? 'text.disabled' : 'inherit' } }),
  menuItem: { fontSize: '0.85rem' },
  menuItemRed: { fontSize: '0.85rem', color: 'error.main' },
  menuItemWide: { fontSize: '0.85rem', minWidth: 220 },
  menuDivider: { my: 0.5 },
  hiddenBox: { display: 'none' },
  colorPrimary: { color: '#0d47a1' },
  colorTeal: { color: '#00897b' },
  colorLightBlue: { color: '#039be5' },
  colorIndigo: { color: '#3f51b5' },
  colorPurple: { color: '#8e24aa' },
  colorDeepPurple: { color: '#5e35b1' },
  colorOrange: { color: '#fb8c00' },
  colorGrey: { color: '#616161' },
  colorDeepOrange: { color: '#d84315' }
};

interface SidebarProps {
  isSidebarOpen: boolean; sidebarWidth: number; onToggleSidebar: () => void;
  schemas: string[]; expandedSchemas: string[]; onToggleSchema: (schema: string) => void;
  onAddTab: (type: 'sql' | 'table' | 'create-table' | 'view' | 'sequence' | 'create-sequence' | 'stored' | 'create-stored' | 'trigger' | 'create-trigger' | 'mview' | 'create-mview' | 'index' | 'create-index' | 'type', name?: string, initialSql?: string) => void;
  outputDateFormat: string;
}

const SidebarObjectItem = React.memo(({
  obj, schema, type, isSelectedTable, selectObject, onAddTab, handleSidebarContextMenu
}: {
  obj: SidebarObject; schema: string; type: string; isSelectedTable: boolean;
  selectObject: ReturnType<typeof useSidebarLogic>['selectObject'];
  onAddTab: SidebarProps['onAddTab']; handleSidebarContextMenu: ReturnType<typeof useSidebarLogic>['handleSidebarContextMenu'];
}) => {
  const objName = obj.name;
  const isDisabled = obj.status === 'DISABLED';

  let IconComponent = SettingsIcon;
  if (type === 'TABLE') IconComponent = TableChartIcon;
  if (type === 'SEQUENCE') IconComponent = FormatListNumberedIcon;
  if (type === 'FUNCTION' || type === 'PROCEDURE') IconComponent = FunctionsIcon;
  if (type === 'TRIGGER') IconComponent = isDisabled ? FlashOffIcon : FlashOnIcon;
  if (type === 'VIEW') IconComponent = ViewListIcon;
  if (type === 'MATERIALIZED VIEW') IconComponent = LayersIcon;
  if (type === 'INDEX') IconComponent = SortIcon;
  if (type === 'TYPE') IconComponent = DescriptionIcon;

  return (
    <ListItemButton
      data-sidebar-row data-sidebar-object data-sidebar-level={3}
      aria-current={isSelectedTable ? 'true' : undefined} onKeyDown={navigateSidebar} selected={isSelectedTable}
      sx={styles.objItem(isSelectedTable)}
      onClick={() => selectObject(schema, type, objName, obj.signature, obj.tableName)}
      onDoubleClick={() => {
        selectObject(schema, type, objName, obj.signature, obj.tableName);
        if (['TABLE', 'VIEW', 'SEQUENCE', 'TRIGGER', 'MATERIALIZED VIEW', 'INDEX', 'TYPE'].includes(type)) {
          const tType = type === 'VIEW' ? 'view' : type === 'SEQUENCE' ? 'sequence' : type === 'TRIGGER' ? 'trigger' : type === 'MATERIALIZED VIEW' ? 'mview' : type === 'INDEX' ? 'index' : type === 'TYPE' ? 'type' : 'table';
          onAddTab(tType, type === 'TRIGGER' && obj.tableName ? triggerTabKey({ schema, objectName: objName, tableName: obj.tableName }) : qualifiedObjectName({ schema, objectName: objName }));
        } else if (type === 'FUNCTION' || type === 'PROCEDURE') {
          onAddTab('stored', routineTabKey({ schema, objectName: objName, objectType: type, signature: obj.signature ?? '' }), type);
        }
      }}
      onContextMenu={(e) => handleSidebarContextMenu(e, 'table', objName, schema, type, undefined, objName, obj.status, obj.tableName, obj.signature)}
    >
      <ListItemIcon sx={styles.objIcon}>
        <IconComponent fontSize="small" color={isDisabled ? "action" : "action"} />
      </ListItemIcon>
      <ListItemText primary={type === 'TRIGGER' && obj.tableName ? `${objName} (${obj.tableName})` : obj.signature !== undefined ? `${objName}(${obj.signature})` : objName} sx={styles.objText(isDisabled)} />
    </ListItemButton>
  );
});
SidebarObjectItem.displayName = 'SidebarObjectItem';

export default function Sidebar({
  isSidebarOpen, sidebarWidth, onToggleSidebar,
  schemas, expandedSchemas, onToggleSchema, onAddTab, outputDateFormat
}: SidebarProps) {
  const logic = useSidebarLogic({ schemas, expandedSchemas, onAddTab, outputDateFormat });
  const { t } = logic;

  const getCategoryNameJp = (type: string) => {
    switch (type) {
      case 'TABLE': return t("table_2");
      case 'INDEX': return t("index_2");
      case 'TRIGGER': return t("trigger_2");
      case 'VIEW': return t("view_2");
      case 'PROCEDURE': return t("procedure_2");
      case 'FUNCTION': return t("function_2");
      case 'TYPE': return t("type_2");
      case 'SEQUENCE': return t("sequence_3");
      case 'MATERIALIZED VIEW': return t("materialized_view_2");
      default: return type;
    }
  };

  const getCategoryIcon = (type: string) => {
    switch (type) {
      case 'TABLE': return <TableChartIcon fontSize="small" sx={styles.colorPrimary} />;
      case 'INDEX': return <SortIcon fontSize="small" sx={styles.colorGrey} />;
      case 'TRIGGER': return <FlashOnIcon fontSize="small" sx={styles.colorOrange} />;
      case 'VIEW': return <ViewListIcon fontSize="small" sx={styles.colorTeal} />;
      case 'PROCEDURE': return <FunctionsIcon fontSize="small" sx={styles.colorDeepPurple} />;
      case 'FUNCTION': return <FunctionsIcon fontSize="small" sx={styles.colorPurple} />;
      case 'TYPE': return <DescriptionIcon fontSize="small" sx={styles.colorDeepOrange} />;
      case 'SEQUENCE': return <FormatListNumberedIcon fontSize="small" sx={styles.colorIndigo} />;
      case 'MATERIALIZED VIEW': return <LayersIcon fontSize="small" sx={styles.colorLightBlue} />;
      default: return <FolderIcon fontSize="small" color="action" />;
    }
  };

  return (
    <React.Fragment>
      <Paper square elevation={0} sx={styles.sidebarPaper(sidebarWidth)}>
        <Box sx={styles.headerBox(isSidebarOpen)}>
          {isSidebarOpen && <Typography variant="subtitle2" sx={styles.headerText}>{t("db_objects")}</Typography>}
          <IconButton size="small" onClick={onToggleSidebar}>
            {isSidebarOpen ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </IconButton>
        </Box>
        <Divider sx={styles.divider} />

        <Box sx={styles.mainListContainer(isSidebarOpen)} data-sidebar-list aria-label={t("db_objects")}>
          <List dense disablePadding>
            {schemas.map(schema => {
              const isSchemaOpen = expandedSchemas.includes(schema);
              return (
                <React.Fragment key={schema}>
                  <ListItemButton
                    data-sidebar-row data-sidebar-level={1} aria-expanded={isSchemaOpen} onKeyDown={navigateSidebar} id={`schema-${schema}`}
                    onClick={() => {
                      if(isSidebarOpen) {
                        onToggleSchema(schema);
                      }
                    }}
                    sx={styles.schemaItem}
                  >
                    <ListItemIcon sx={styles.schemaIcon(isSidebarOpen)}><PersonIcon color="primary" fontSize="small" /></ListItemIcon>
                    {isSidebarOpen && <ListItemText primary={schema} />}
                    {isSidebarOpen && (isSchemaOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />)}
                  </ListItemButton>

                  <Collapse in={isSidebarOpen && isSchemaOpen} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding dense>
                      {logic.OBJECT_TYPES.map(type => {
                        const typeKey = qualifiedObjectName({ schema: schema, objectName: type });
                        const isTypeOpen = logic.expandedTypes.includes(typeKey);
                        const isCategoryLoading = logic.loadingCategories.includes(typeKey);
                        const objects = logic.loadedObjects[typeKey];
                        const canLoadMore = logic.hasMore(typeKey);

                        return (
                          <React.Fragment key={typeKey}>
                            <ListItemButton data-sidebar-row data-sidebar-level={2} aria-expanded={isTypeOpen} onKeyDown={navigateSidebar} onClick={() => logic.toggleType(schema, type)} sx={styles.typeItem}>
                              <ListItemIcon sx={styles.typeIcon}>
                                {getCategoryIcon(type)}
                              </ListItemIcon>
                              <ListItemText primary={getCategoryNameJp(type)} />
                              {isTypeOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                            </ListItemButton>

                            <Collapse in={isTypeOpen} timeout="auto" unmountOnExit>
                              <List component="div" disablePadding dense>
                                {isTypeOpen && (
                                  <Box sx={styles.filterBox}>
                                    <TextField
                                      size="small"
                                      variant="standard"
                                      placeholder={t("search", { category: getCategoryNameJp(type) })}
                                      value={logic.objectFilters[typeKey] || ''}
                                      onChange={(e) => logic.handleFilterChange(typeKey, e.target.value)}
                                      inputProps={{ 'aria-label': t("search", { category: getCategoryNameJp(type) }) }}
                                      sx={styles.filterInput}
                                    />

                                    {!!logic.objectFilters[typeKey] && <Tooltip title={t('sidebar_clear_search')}>
                                      <IconButton size="small" aria-label={t('sidebar_clear_search')} onClick={() => logic.handleFilterChange(typeKey, '')}><ClearIcon fontSize="small" /></IconButton>
                                    </Tooltip>}
                                    {type === 'TABLE' && (
                                      <Tooltip title={t("create_new_table")}><IconButton size="small" onClick={() => onAddTab('create-table', schema)} sx={styles.filterBtn}><AddIcon fontSize="small" color="primary" /></IconButton></Tooltip>
                                    )}
                                    {type === 'VIEW' && (
                                      <Tooltip title={t("new_view_opens_sql_window")}><IconButton size="small" onClick={() => onAddTab('sql', undefined, `CREATE OR REPLACE VIEW "${schema}"."new_view" AS\nSELECT * FROM table_name;\n`)} sx={styles.filterBtn}><AddIcon fontSize="small" color="primary" /></IconButton></Tooltip>
                                    )}
                                    {type === 'SEQUENCE' && (
                                      <Tooltip title={t("create_new_sequence")}><IconButton size="small" onClick={() => onAddTab('create-sequence', schema)} sx={styles.filterBtn}><AddIcon fontSize="small" color="primary" /></IconButton></Tooltip>
                                    )}
                                    {type === 'FUNCTION' && (
                                      <Tooltip title={t("create_function")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-stored', schema, 'FUNCTION')} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'PROCEDURE' && (
                                      <Tooltip title={t("create_procedure")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-stored', schema, 'PROCEDURE')} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'TRIGGER' && (
                                      <Tooltip title={t("new_trigger_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-trigger', schema)} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'MATERIALIZED VIEW' && (
                                      <Tooltip title={t("new_mview_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-mview', schema)} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'INDEX' && (
                                      <Tooltip title={t("new_index_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-index', schema)} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'TYPE' && (
                                      <Tooltip title={t("new_type_opens_sql_window")}>
                                        <IconButton size="small" onClick={() => onAddTab('sql', undefined, logic.getTypeTemplate(schema))} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}

                                    <Tooltip title={t("refresh_to_latest_state")}><IconButton size="small" onClick={(e) => logic.handleRefreshObjects(e, schema, type)} sx={styles.filterBtn}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                                  </Box>
                                )}

                                <SidebarCategoryStatus loading={isCategoryLoading} error={logic.categoryErrors[typeKey]} size={objects?.length} more={canLoadMore} onRetry={() => { void logic.retryCategory(typeKey); }} />
                                {objects ? (
                                  objects.length === 0 && !isCategoryLoading && !logic.categoryErrors[typeKey] ? (
                                    <ListItemText primary={t("no_matching_results")} sx={styles.emptyText} />
                                  ) : (
                                    <React.Fragment>
                                      {objects.map(obj => (
                                        <SidebarObjectItem
                                          key={JSON.stringify([obj.name, obj.signature, obj.tableName])}
                                          obj={obj}
                                          schema={schema}
                                          type={type}
                                          isSelectedTable={logic.selectedObject === sidebarObjectKey(schema, type, obj.name, obj.signature, obj.tableName)}
                                          selectObject={logic.selectObject}
                                          onAddTab={onAddTab}
                                          handleSidebarContextMenu={logic.handleSidebarContextMenu}
                                        />
                                      ))}

                                      {/* Load the next chunk. */}
                                      {canLoadMore && (
                                        <ListItemButton
                                          onClick={() => logic.loadMore(typeKey)}
                                          disabled={isCategoryLoading}
                                          sx={{ justifyContent: 'center', py: 1, bgcolor: 'action.hover' }}
                                        >
                                          {isCategoryLoading ? (
                                            <CircularProgress size={14} thickness={4} sx={{ mr: 1 }} />
                                          ) : null}
                                          <ListItemText
                                            primary={t("show_100_more")}
                                            primaryTypographyProps={{ fontSize: '0.8rem', color: 'primary', textAlign: 'center', fontWeight: 'bold' }}
                                          />
                                        </ListItemButton>
                                      )}
                                    </React.Fragment>
                                  )
                                ) : null}
                              </List>
                            </Collapse>
                          </React.Fragment>
                        );
                      })}

                    </List>
                  </Collapse>
                </React.Fragment>
              );
            })}
          </List>
        </Box>
      </Paper>

      <Menu
        open={logic.sidebarContextMenu !== null}
        onClose={logic.closeSidebarContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={logic.sidebarContextMenu !== null ? { top: logic.sidebarContextMenu.mouseY, left: logic.sidebarContextMenu.mouseX } : undefined}
      >
        {logic.sidebarContextMenu?.type === 'table' && (
          <Box>
            {logic.sidebarContextMenu.objType !== 'TABLE' && (
              <MenuItem onClick={logic.handleOpenTableWindow} sx={styles.menuItem}>
                <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
                <ListItemText sx={{ flexGrow: 1 }}>{t("open")}</ListItemText>
              </MenuItem>
            )}

            {logic.sidebarContextMenu.objType === 'TRIGGER' && (
              <>
                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleToggleEnableTrigger} sx={styles.menuItem}>
                  <ListItemIcon>
                    {logic.sidebarContextMenu.status === 'DISABLED' ? <FlashOnIcon fontSize="small" color="primary" /> : <FlashOffIcon fontSize="small" color="action" />}
                  </ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>
                    {logic.sidebarContextMenu.status === 'DISABLED' ? t("enable_enable") : t("disable_disable")}
                  </ListItemText>
                </MenuItem>
              </>
            )}

            {logic.sidebarContextMenu.objType === 'MATERIALIZED VIEW' && (
              <>
                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleRefreshMViewClick} sx={styles.menuItem}>
                  <ListItemIcon><RefreshIcon fontSize="small" color="primary" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("refresh")}</ListItemText>
                </MenuItem>
              </>
            )}

            {logic.sidebarContextMenu.objType === 'TABLE' && (
              <>
                <MenuItem onClick={logic.handleOpenTableWindow} sx={styles.menuItem}>
                  <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("open")}</ListItemText>
                </MenuItem>

                <MenuItem onClick={logic.handleOpenSqlWindow} sx={styles.menuItem}>
                  <ListItemIcon><TerminalIcon fontSize="small" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("open_in_sql_window")}</ListItemText>
                </MenuItem>

                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleCopyToClipboard} sx={styles.menuItemWide}>
                  <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("copy_table_name")}</ListItemText>
                </MenuItem>

                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleRenameClick} sx={styles.menuItem}>{t("rename_table")}</MenuItem>
                <MenuItem onClick={logic.handleCopyClick} sx={styles.menuItem}>{t("copy_table")}</MenuItem>
                <MenuItem onClick={logic.handleAnalyzeClick} sx={styles.menuItem}>{t("gather_stats_analyze_2")}</MenuItem>
                <MenuItem onClick={logic.handleVacuumClick} sx={styles.menuItem}>{t("optimize_vacuum")}</MenuItem>

                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleImportClick} sx={styles.menuItem}>
                  <ListItemIcon><FileUploadIcon fontSize="small" color="primary" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("import")}</ListItemText>
                </MenuItem>
                <MenuItem onClick={logic.handleExportClick} sx={styles.menuItem}>
                  <ListItemIcon><FileDownloadIcon fontSize="small" color="primary" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("export")}</ListItemText>
                </MenuItem>

                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleTruncateClick} sx={styles.menuItemRed}>
                  <ListItemIcon><DeleteSweepIcon fontSize="small" color="error" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("truncate")}</ListItemText>
                </MenuItem>
              </>
            )}

            <Divider sx={styles.menuDivider} />
            {!['FUNCTION', 'PROCEDURE'].includes(logic.sidebarContextMenu.objType || '') && <MenuItem onClick={logic.handleDeleteClick} sx={styles.menuItemRed}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("drop")}</ListItemText>
            </MenuItem>}
          </Box>
        )}
      </Menu>

      <Dialog open={logic.dialogState.isOpen} onClose={() => logic.setDialogState({ ...logic.dialogState, isOpen: false })}>
        <DialogTitle>
          {logic.dialogState.mode === 'rename' && t("rename_table")}
          {logic.dialogState.mode === 'copy' && t("copy_table")}
          {logic.dialogState.mode === 'analyze' && t("gather_stats_analyze")}
          {logic.dialogState.mode === 'vacuum' && t("optimize_table_vacuum")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {logic.dialogState.mode === 'rename' && t("please_enter_a_new_table_name")}
            {logic.dialogState.mode === 'copy' && t("please_enter_target_table_name")}
            {logic.dialogState.mode === 'vacuum' && t("execute_space_recovery_vacuum")}
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label={logic.dialogState.mode === 'analyze' || logic.dialogState.mode === 'vacuum' ? '' : t("new_table_name")}
            type={logic.dialogState.mode === 'analyze' || logic.dialogState.mode === 'vacuum' ? 'hidden' : 'text'}
            fullWidth
            variant="standard"
            value={logic.dialogState.newName}
            onChange={(e) => logic.setDialogState({ ...logic.dialogState, newName: e.target.value })}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => logic.setDialogState({ ...logic.dialogState, isOpen: false })}>{t("cancel")}</Button>
          <Button onClick={logic.handleDialogSubmit} variant="contained">
            {logic.dialogState.mode === 'rename' && t("change")}
            {logic.dialogState.mode === 'copy' && t("create")}
            {(logic.dialogState.mode === 'analyze' || logic.dialogState.mode === 'vacuum') && t("execute")}
          </Button>
        </DialogActions>
      </Dialog>

      <Box ref={logic.importContainerRef} sx={styles.hiddenBox}>
        {logic.importTarget && (
          <ImportDialog targetKey={JSON.stringify([logic.importTarget.schema, logic.importTarget.tableName])} columns={logic.importTarget.structureDefs.map(column => column.COLUMN_NAME)} onImport={logic.processSidebarBulkInsertData} tableName={logic.importTarget.tableName} />
        )}
      </Box>

      <Box ref={logic.exportContainerRef} sx={styles.hiddenBox}>
        {logic.exportTarget && (
          <ExportDialog
            columns={logic.exportTarget.columns}
            rows={[]}
            defaultFileName={`${logic.exportTarget.tableName}_export`}
            iconType="download"
            totalCount={logic.exportTarget.totalCount}
            fetchDataChunk={logic.fetchExportDataChunk}
            tableName={logic.exportTarget.tableName}
          />
        )}
      </Box>
    </React.Fragment>
  );
}
