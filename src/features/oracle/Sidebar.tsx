// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { navigateSidebar, sidebarObjectKey } from '@/features/objects/sidebarNavigation';
import { SidebarCategoryStatus } from '@/features/objects/SidebarCategoryStatus';
import ClearIcon from '@mui/icons-material/Clear';
import { qualifiedObjectName } from '@/shared/utils/objectIdentity';

import React, { useState, useCallback } from 'react';
import {
  Paper, Box, Typography, IconButton, Divider, List, ListItemButton,
  ListItemIcon, ListItemText, Collapse, Menu, MenuItem, TextField, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, CircularProgress
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
import CodeIcon from '@mui/icons-material/Code';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RestoreIcon from '@mui/icons-material/Restore';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import FlashOffIcon from '@mui/icons-material/FlashOff';
import LinkIcon from '@mui/icons-material/Link';
import ShortcutIcon from '@mui/icons-material/Shortcut';
import SortIcon from '@mui/icons-material/Sort';
import BuildIcon from '@mui/icons-material/Build';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';

// Additional category icon imports.
import ViewListIcon from '@mui/icons-material/ViewList';
import LayersIcon from '@mui/icons-material/Layers';
import WidgetsIcon from '@mui/icons-material/Widgets';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
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
  objErrorIcon: { fontSize: '1.1rem', mr: 0.5 },
  objText: (isPackage: boolean, isDisabled: boolean) => ({ '& .MuiListItemText-primary': { fontSize: '0.85rem', fontWeight: isPackage ? 'bold' : 'normal', color: isDisabled ? 'text.disabled' : 'inherit', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' } }),
  pkgSubItem: { pl: 10, py: 0.2 },
  pkgSubIcon: { minWidth: 20 },
  pkgSubErrorIcon: { fontSize: '1rem', mr: 0.5 },
  pkgSubText: { '& .MuiListItemText-primary': { fontSize: '0.8rem', color: 'text.secondary' } },
  recycleBinItem: { pl: 4, py: 0.3 },
  recycleBinIcon: { minWidth: 28 },
  recycleBinIconColor: { color: 'text.secondary' },
  recycleBinSubItem: { pl: 7, py: 0.2 },
  recycleBinSubText: { '& .MuiListItemText-primary': { fontSize: '0.85rem', color: 'text.secondary', whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' } },
  menuItem: { fontSize: '0.85rem' },
  menuItemRed: { fontSize: '0.85rem', color: 'error.main' },
  menuItemWide: { fontSize: '0.85rem', minWidth: 220 },
  menuDivider: { my: 0.5 },
  hiddenBox: { display: 'none' },
  colorPrimary: { color: '#0d47a1' },
  colorTeal: { color: '#00897b' },
  colorLightBlue: { color: '#039be5' },
  colorBlueGrey: { color: '#455a64' },
  colorIndigo: { color: '#3f51b5' },
  colorPurple: { color: '#8e24aa' },
  colorDeepPurple: { color: '#5e35b1' },
  colorBrown: { color: '#6d4c41' },
  colorOrange: { color: '#fb8c00' },
  colorCyan: { color: '#00acc1' },
  colorLightGreen: { color: '#7cb342' },
  colorGrey: { color: '#616161' },
  colorDeepOrange: { color: '#d84315' },
  colorPkgSpec: { color: '#795548' },
  colorPkgBody: { color: '#0288d1' }
};

interface SidebarObjectItemProps {
  objName: string;
  schema: string;
  type: string;
  isSelectedTable: boolean;
  isInvalid: boolean;
  isDisabled: boolean;
  isIndexUnusable: boolean;
  isIndexInvisible: boolean;
  isFunctionIndex: boolean;
  isSpecInvalid: boolean;
  isBodyInvalid: boolean;
  hasBody: boolean;
  tooltipContent: string;
  selectObject: ReturnType<typeof useSidebarLogic>['selectObject'];
  onAddTab: SidebarProps['onAddTab'];
  handleSidebarContextMenu: ReturnType<typeof useSidebarLogic>['handleSidebarContextMenu'];
  t: ReturnType<typeof useSidebarLogic>['t'];
}

const SidebarObjectItem = React.memo(({
  objName, schema, type, isSelectedTable, isInvalid, isDisabled,
  isIndexUnusable, isIndexInvisible, isFunctionIndex,
  isSpecInvalid, isBodyInvalid, hasBody, tooltipContent,
  onAddTab, selectObject, handleSidebarContextMenu, t
}: SidebarObjectItemProps) => {
  const isPackage = type === 'PACKAGE';
  const [isPackageOpen, setIsPackageOpen] = useState<boolean>(false);

  let IconComponent = SettingsIcon;
  if (type === 'TABLE') IconComponent = TableChartIcon;
  if (type === 'SEQUENCE') IconComponent = FormatListNumberedIcon;
  if (type === 'FUNCTION' || type === 'PROCEDURE') IconComponent = FunctionsIcon;
  if (type === 'PACKAGE') IconComponent = FolderIcon;
  if (type === 'TYPE') IconComponent = DescriptionIcon;
  if (type === 'TRIGGER') {
    IconComponent = isDisabled ? FlashOffIcon : FlashOnIcon;
  }
  if (type === 'DATABASE LINK') IconComponent = LinkIcon;
  if (type === 'SYNONYM') IconComponent = ShortcutIcon;
  if (type === 'MATERIALIZED VIEW') IconComponent = TableChartIcon;
  if (type === 'MATERIALIZED VIEW LOG') IconComponent = DescriptionIcon;

  if (type === 'INDEX') {
    if (isFunctionIndex) {
      IconComponent = FunctionsIcon;
    } else {
      IconComponent = isIndexInvisible ? VisibilityOffIcon : SortIcon;
    }
  }

  const togglePackage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPackageOpen(prev => !prev);
  }, []);

  const listItemContent = (
    <ListItemButton
      data-sidebar-row data-sidebar-object data-sidebar-level={3}
      aria-expanded={isPackage ? isPackageOpen : undefined} aria-current={isSelectedTable ? 'true' : undefined}
      onKeyDown={navigateSidebar} selected={isSelectedTable}
      sx={styles.objItem(isSelectedTable)}
      onClick={(e) => {
        selectObject(schema, type, objName);
        if (isPackage) {
          togglePackage(e);
        }
      }}
      onDoubleClick={() => {
        selectObject(schema, type, objName);
        if (['TABLE', 'VIEW', 'SEQUENCE', 'TRIGGER', 'DATABASE LINK', 'SYNONYM', 'MATERIALIZED VIEW', 'MATERIALIZED VIEW LOG', 'INDEX', 'TYPE'].includes(type)) {
          const tType = type === 'VIEW' ? 'view' : type === 'SEQUENCE' ? 'sequence' : type === 'TRIGGER' ? 'trigger' : type === 'DATABASE LINK' ? 'dblink' : type === 'SYNONYM' ? 'synonym' : type === 'MATERIALIZED VIEW' ? 'mview' : type === 'MATERIALIZED VIEW LOG' ? 'mview-log' : type === 'INDEX' ? 'index' : type === 'TYPE' ? 'type' : 'table';
          onAddTab(tType, qualifiedObjectName({ schema: schema, objectName: objName }));
        } else if (type === 'FUNCTION' || type === 'PROCEDURE' || type === 'PACKAGE') {
          onAddTab(type === 'PACKAGE' ? 'package' : 'stored', qualifiedObjectName({ schema: schema, objectName: objName }), type);
        }
      }}
      onContextMenu={(e) => handleSidebarContextMenu(e, 'table', objName, schema, type, undefined, objName)}
    >
      <ListItemIcon sx={styles.objIcon}>
        <IconComponent fontSize="small" color={(isDisabled || isIndexInvisible || isIndexUnusable) ? "disabled" : (isPackage || type === 'TRIGGER' || isFunctionIndex ? "primary" : "action")} />
      </ListItemIcon>

      {(isInvalid || isIndexUnusable) && (
        <Tooltip title={isIndexUnusable ? t("unusable_rebuild_required") : t("invalid_recompilation_required")}>
          <ErrorOutlineIcon color="error" sx={styles.objErrorIcon} />
        </Tooltip>
      )}

      <ListItemText primary={objName} sx={styles.objText(isPackage, isDisabled || isIndexInvisible || isIndexUnusable)} />

      {isPackage && (
        <IconButton size="small" aria-label={isPackageOpen ? t("sidebar_collapse") : t("sidebar_expand")} onClick={togglePackage}>
          {isPackageOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
        </IconButton>
      )}
    </ListItemButton>
  );

  return (
    <React.Fragment>
      {tooltipContent ? (
        <Tooltip title={tooltipContent} placement="right" arrow>
          {listItemContent}
        </Tooltip>
      ) : (
        listItemContent
      )}

      {isPackage && (
        <Collapse in={isPackageOpen} timeout="auto" unmountOnExit>
          <List component="div" disablePadding dense>
            <ListItemButton
              data-sidebar-row data-sidebar-object data-sidebar-level={4} onKeyDown={navigateSidebar}
              sx={styles.pkgSubItem}
              onDoubleClick={() => onAddTab('package', qualifiedObjectName({ schema: schema, objectName: objName }), 'PACKAGE')}
              onContextMenu={(e) => handleSidebarContextMenu(e, 'table', objName, schema, 'PACKAGE')}
            >
              <ListItemIcon sx={styles.pkgSubIcon}><DescriptionIcon sx={styles.colorPkgSpec} fontSize="small" /></ListItemIcon>
              {isSpecInvalid && (
                <Tooltip title={t("specification_status_is_invalid_recompilation_required")}>
                  <ErrorOutlineIcon color="error" sx={styles.pkgSubErrorIcon} />
                </Tooltip>
              )}
              <ListItemText primary={t("specification_header")} sx={styles.pkgSubText} />
            </ListItemButton>

            {hasBody && (
              <ListItemButton
                data-sidebar-row data-sidebar-object data-sidebar-level={4} onKeyDown={navigateSidebar}
              sx={styles.pkgSubItem}
                onDoubleClick={() => onAddTab('package', qualifiedObjectName({ schema: schema, objectName: objName }), 'PACKAGE BODY')}
                onContextMenu={(e) => handleSidebarContextMenu(e, 'table', objName, schema, 'PACKAGE BODY')}
              >
                <ListItemIcon sx={styles.pkgSubIcon}><CodeIcon sx={styles.colorPkgBody} fontSize="small" /></ListItemIcon>
                {isBodyInvalid && (
                  <Tooltip title={t("body_status_is_invalid_recompilation_required")}>
                    <ErrorOutlineIcon color="error" sx={styles.pkgSubErrorIcon} />
                  </Tooltip>
                )}
                <ListItemText primary={t("body")} sx={styles.pkgSubText} />
              </ListItemButton>
            )}
          </List>
        </Collapse>
      )}
    </React.Fragment>
  );
});
SidebarObjectItem.displayName = 'SidebarObjectItem';

interface SidebarProps {
  isSidebarOpen: boolean; sidebarWidth: number; onToggleSidebar: () => void;
  schemas: string[]; expandedSchemas: string[]; onToggleSchema: (schema: string) => void;
  onAddTab: (type: 'sql' | 'table' | 'create-table' | 'view' | 'sequence' | 'create-sequence' | 'stored' | 'create-stored' | 'package' | 'create-package' | 'trigger' | 'create-trigger' | 'dblink' | 'create-dblink' | 'synonym' | 'create-synonym' | 'mview' | 'create-mview' | 'mview-log' | 'create-mview-log' | 'index' | 'create-index' | 'constraint' | 'create-constraint' | 'type', name?: string, initialSql?: string) => void;
  outputDateFormat: string;
}

export default function Sidebar({
  isSidebarOpen, sidebarWidth, onToggleSidebar,
  schemas, expandedSchemas, onToggleSchema, onAddTab, outputDateFormat
}: SidebarProps) {
  const logic = useSidebarLogic({ schemas, expandedSchemas, onAddTab, outputDateFormat });
  const { t } = logic;
  const [packageCreationSchema, setPackageCreationSchema] = useState<string | null>(null);

  const getCategoryNameJp = (type: string) => {
    switch (type) {
      case 'TABLE': return t("table_2");
      case 'VIEW': return t("view_2");
      case 'MATERIALIZED VIEW': return t("materialized_view_2");
      case 'MATERIALIZED VIEW LOG': return t("mview_log_2");
      case 'SEQUENCE': return t("sequence_3");
      case 'FUNCTION': return t("function_2");
      case 'PROCEDURE': return t("procedure_2");
      case 'PACKAGE': return t("package");
      case 'TRIGGER': return t("trigger_2");
      case 'DATABASE LINK': return t("database_link");
      case 'SYNONYM': return t("synonym_2");
      case 'INDEX': return t("index_2");
      case 'TYPE': return t("type_2");
      default: return type;
    }
  };

  const getCategoryIcon = (type: string) => {
    switch (type) {
      case 'TABLE': return <TableChartIcon fontSize="small" sx={styles.colorPrimary} />;
      case 'VIEW': return <ViewListIcon fontSize="small" sx={styles.colorTeal} />;
      case 'MATERIALIZED VIEW': return <LayersIcon fontSize="small" sx={styles.colorLightBlue} />;
      case 'MATERIALIZED VIEW LOG': return <DescriptionIcon fontSize="small" sx={styles.colorBlueGrey} />;
      case 'SEQUENCE': return <FormatListNumberedIcon fontSize="small" sx={styles.colorIndigo} />;
      case 'FUNCTION': return <FunctionsIcon fontSize="small" sx={styles.colorPurple} />;
      case 'PROCEDURE': return <FunctionsIcon fontSize="small" sx={styles.colorDeepPurple} />;
      case 'PACKAGE': return <WidgetsIcon fontSize="small" sx={styles.colorBrown} />;
      case 'TRIGGER': return <FlashOnIcon fontSize="small" sx={styles.colorOrange} />;
      case 'DATABASE LINK': return <LinkIcon fontSize="small" sx={styles.colorCyan} />;
      case 'SYNONYM': return <ShortcutIcon fontSize="small" sx={styles.colorLightGreen} />;
      case 'INDEX': return <SortIcon fontSize="small" sx={styles.colorGrey} />;
      case 'TYPE': return <DescriptionIcon fontSize="small" sx={styles.colorDeepOrange} />;
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
                  <ListItemButton data-sidebar-row data-sidebar-level={1} aria-expanded={isSchemaOpen} onKeyDown={navigateSidebar} id={`schema-${schema}`} onClick={() => { if(isSidebarOpen) onToggleSchema(schema); }} sx={styles.schemaItem}>
                    <ListItemIcon sx={styles.schemaIcon(isSidebarOpen)}><PersonIcon color="primary" fontSize="small" /></ListItemIcon>
                    {isSidebarOpen && <ListItemText primary={schema} />}
                    {isSidebarOpen && (isSchemaOpen ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />)}
                  </ListItemButton>

                  <Collapse in={isSidebarOpen && isSchemaOpen} timeout="auto" unmountOnExit>
                    <List component="div" disablePadding dense>
                      {logic.OBJECT_TYPES.map(type => {
                        const typeKey = qualifiedObjectName({ schema: schema, objectName: type });
                        const isTypeOpen = logic.expandedTypes.includes(typeKey);
                        const isCategoryLoading = logic.loadingCategories?.includes(typeKey);
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
                                      <Tooltip title={t("new_view_opens_sql_window")}><IconButton size="small" onClick={() => onAddTab('sql', undefined, `CREATE OR REPLACE VIEW ${schema}.NEW_VIEW_NAME AS\nSELECT * FROM table_name;\n`)} sx={styles.filterBtn}><AddIcon fontSize="small" color="primary" /></IconButton></Tooltip>
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
                                    {type === 'PACKAGE' && (
                                      <Tooltip title={t("create_package")}>
                                        <IconButton size="small" onClick={() => setPackageCreationSchema(schema)} sx={styles.filterBtn}>
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
                                    {type === 'TRIGGER' && (
                                      <Tooltip title={t("new_trigger_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-trigger', schema)} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'DATABASE LINK' && (
                                      <Tooltip title={t("new_database_link_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-dblink', schema)} sx={styles.filterBtn}>
                                          <AddIcon fontSize="small" color="primary" />
                                        </IconButton>
                                      </Tooltip>
                                    )}
                                    {type === 'SYNONYM' && (
                                      <Tooltip title={t("new_synonym_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-synonym', schema)} sx={styles.filterBtn}>
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
                                    {type === 'MATERIALIZED VIEW LOG' && (
                                      <Tooltip title={t("new_mview_log_opens_wizard")}>
                                        <IconButton size="small" onClick={() => onAddTab('create-mview-log', schema)} sx={styles.filterBtn}>
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

                                    <Tooltip title={t("refresh_to_latest_state")}><IconButton size="small" onClick={(e) => logic.handleRefreshObjects(e, schema, type)} sx={styles.filterBtn}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
                                  </Box>
                                )}

                                <SidebarCategoryStatus loading={isCategoryLoading} error={logic.categoryErrors[typeKey]} size={objects?.length} more={canLoadMore} onRetry={() => { void logic.retryCategory(typeKey); }} />
                                {objects ? (
                                  objects.length === 0 && !isCategoryLoading && !logic.categoryErrors[typeKey] ? (
                                    <ListItemText primary={t("no_matching_results")} sx={styles.emptyText} />
                                  ) : (
                                    <React.Fragment>
                                      {objects.map(objName => {
                                        const isPackage = type === 'PACKAGE';
                                        const isInvalid = logic.invalidObjects[typeKey]?.some(o => o.name === objName) || false;
                                        const isDisabled = type === 'TRIGGER' && logic.disabledTriggers[typeKey]?.includes(objName) || false;
                                        const isIndex = type === 'INDEX';
                                        const idxStatus = isIndex ? logic.indexStatuses[typeKey]?.[objName] : null;
                                        const isIndexUnusable = idxStatus?.status === 'UNUSABLE' || false;
                                        const isIndexInvisible = idxStatus?.visibility === 'INVISIBLE' || false;
                                        const isFunctionIndex = idxStatus?.indexType?.includes('FUNCTION-BASED') || false;

                                        const isSpecInvalid = isPackage && logic.invalidObjects[typeKey]?.some(o => o.name === objName && o.type === 'PACKAGE') || false;
                                        const isBodyInvalid = isPackage && logic.invalidObjects[typeKey]?.some(o => o.name === objName && o.type === 'PACKAGE BODY') || false;
                                        const hasBody = isPackage && logic.packageBodies[typeKey] && logic.packageBodies[typeKey].includes(objName) || false;

                                        const isMView = type === 'MATERIALIZED VIEW';
                                        const refreshDate = isMView ? logic.mviewRefreshDates[qualifiedObjectName({ schema: schema, objectName: objName })] : null;

                                        let tooltipContent = '';
                                        if (isMView) {
                                          tooltipContent = refreshDate ? t("last_refresh", { date: refreshDate }) : t("last_refresh_fetching");
                                        } else if (isIndexUnusable) {
                                          tooltipContent = t("status_is_unusable_rebuild_required");
                                        } else if (isIndexInvisible) {
                                          tooltipContent = t("invisible_index_it_will_not_be_used_by_the_optimizer");
                                        } else if (isFunctionIndex) {
                                          tooltipContent = t("function_based_index");
                                        }

                                        return (
                                          <SidebarObjectItem
                                            key={objName}
                                            objName={objName}
                                            schema={schema}
                                            type={type}
                                            isSelectedTable={logic.selectedObject === sidebarObjectKey(schema, type, objName)}
                                            selectObject={logic.selectObject}
                                            isInvalid={isInvalid}
                                            isDisabled={isDisabled}
                                            isIndexUnusable={isIndexUnusable}
                                            isIndexInvisible={isIndexInvisible}
                                            isFunctionIndex={isFunctionIndex}
                                            isSpecInvalid={isSpecInvalid}
                                            isBodyInvalid={isBodyInvalid}
                                            hasBody={hasBody}
                                            tooltipContent={tooltipContent}
                                            onAddTab={onAddTab}
                                            handleSidebarContextMenu={logic.handleSidebarContextMenu}
                                            t={t}
                                          />
                                        );
                                      })}

                                      {/* Show more button. */}
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

                      <React.Fragment key={`${schema}-recyclebin`}>
                        <ListItemButton
                          onClick={() => logic.toggleRecycleBin(schema)}
                          onContextMenu={(e) => logic.handleSidebarContextMenu(e, 'recyclebin_category', schema, schema, 'RECYCLEBIN')}
                          sx={styles.recycleBinItem}
                        >
                          <ListItemIcon sx={styles.recycleBinIcon}><DeleteOutlineIcon fontSize="small" sx={styles.recycleBinIconColor} /></ListItemIcon>
                          <ListItemText primary={t("recycle_bin")} />
                          {logic.expandedRecycleBins.includes(schema) ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                        </ListItemButton>

                        <Collapse in={logic.expandedRecycleBins.includes(schema)} timeout="auto" unmountOnExit>
                          <List component="div" disablePadding dense>
                            {logic.loadingCategories?.includes(`${schema}.RECYCLEBIN`) || !logic.loadedRecycleBins[schema] ? (
                              <Box sx={styles.loadingBox}>
                                <CircularProgress size={16} thickness={4} />
                                <Typography variant="caption" sx={{ fontSize: '0.8rem' }}>{t("loading")}</Typography>
                              </Box>
                            ) : logic.loadedRecycleBins[schema].length > 0 ? (
                              logic.loadedRecycleBins[schema].map(item => (
                                <ListItemButton
                                  key={item.objectName}
                                  sx={styles.recycleBinSubItem}
                                  onContextMenu={(e) => logic.handleSidebarContextMenu(e, 'recyclebin', item.originalName, schema, 'RECYCLEBIN', undefined, item.objectName)}
                                >
                                  <ListItemIcon sx={styles.recycleBinIcon}>
                                    <TableChartIcon fontSize="small" color="disabled" />
                                  </ListItemIcon>
                                  <ListItemText primary={item.originalName} sx={styles.recycleBinSubText} />
                                </ListItemButton>
                              ))
                            ) : (
                              <ListItemText primary={t("recycle_bin_is_empty_2")} sx={styles.emptyText} />
                            )}
                          </List>
                        </Collapse>
                      </React.Fragment>

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
        {logic.sidebarContextMenu?.type === 'recyclebin' && (
          <Box>
            <MenuItem onClick={logic.handleRestoreClick} sx={styles.menuItem}>
              <ListItemIcon><RestoreIcon fontSize="small" color="primary" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("restore")}</ListItemText>
            </MenuItem>
            <MenuItem onClick={logic.handlePurgeClick} sx={styles.menuItemRed}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("purge_completely")}</ListItemText>
            </MenuItem>
          </Box>
        )}

        {logic.sidebarContextMenu?.type === 'recyclebin_category' && (
          <Box>
            <MenuItem onClick={logic.handleEmptyRecycleBinClick} sx={styles.menuItemRed}>
              <ListItemIcon><DeleteSweepIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("empty_recycle_bin_purge_recyclebin")}</ListItemText>
            </MenuItem>
          </Box>
        )}

        {logic.sidebarContextMenu?.type === 'table' && (
          <Box>
            <MenuItem onClick={logic.handleOpenTableWindow} sx={styles.menuItem}>
              <ListItemIcon><OpenInNewIcon fontSize="small" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("open")}</ListItemText>
            </MenuItem>

            {['VIEW', 'MATERIALIZED VIEW', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TYPE'].includes(logic.sidebarContextMenu.objType || '') && (
              <>
                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleCompileClick} sx={styles.menuItem}>
                  <ListItemIcon><BuildIcon fontSize="small" color="primary" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("compile_compile")}</ListItemText>
                </MenuItem>
              </>
            )}

            {logic.sidebarContextMenu.objType === 'TRIGGER' && (
              <>
                <Divider sx={styles.menuDivider} />
                {logic.disabledTriggers[`${logic.sidebarContextMenu.schema}.TRIGGER`]?.includes(logic.sidebarContextMenu.value) ? (
                  <MenuItem onClick={() => logic.handleToggleTriggerEnable(true)} sx={styles.menuItem}>
                    <ListItemIcon><FlashOnIcon fontSize="small" color="primary" /></ListItemIcon>
                    <ListItemText sx={{ flexGrow: 1 }}>{t("enable_2")}</ListItemText>
                  </MenuItem>
                ) : (
                  <MenuItem onClick={() => logic.handleToggleTriggerEnable(false)} sx={styles.menuItem}>
                    <ListItemIcon><FlashOffIcon fontSize="small" color="action" /></ListItemIcon>
                    <ListItemText sx={{ flexGrow: 1 }}>{t("disable")}</ListItemText>
                  </MenuItem>
                )}
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

            {logic.sidebarContextMenu.objType === 'INDEX' && (
              <>
                <Divider sx={styles.menuDivider} />
                <MenuItem onClick={logic.handleRebuildIndexClick} sx={styles.menuItem}>
                  <ListItemIcon><BuildIcon fontSize="small" color="primary" /></ListItemIcon>
                  <ListItemText sx={{ flexGrow: 1 }}>{t("rebuild")}</ListItemText>
                </MenuItem>
                {logic.indexStatuses[`${logic.sidebarContextMenu.schema}.INDEX`]?.[logic.sidebarContextMenu.value]?.visibility === 'INVISIBLE' ? (
                  <MenuItem onClick={() => logic.handleToggleIndexVisibilityClick(true)} sx={styles.menuItem}>
                    <ListItemIcon><VisibilityIcon fontSize="small" color="primary" /></ListItemIcon>
                    <ListItemText sx={{ flexGrow: 1 }}>{t("visible_visible")}</ListItemText>
                  </MenuItem>
                ) : (
                  <MenuItem onClick={() => logic.handleToggleIndexVisibilityClick(false)} sx={styles.menuItem}>
                    <ListItemIcon><VisibilityOffIcon fontSize="small" color="action" /></ListItemIcon>
                    <ListItemText sx={{ flexGrow: 1 }}>{t("invisible_invisible")}</ListItemText>
                  </MenuItem>
                )}
              </>
            )}

            {logic.sidebarContextMenu.objType === 'TABLE' && (
              <>
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

            <MenuItem onClick={logic.handleDeleteClick} sx={styles.menuItemRed}>
              <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
              <ListItemText sx={{ flexGrow: 1 }}>{t("drop")}</ListItemText>
            </MenuItem>
          </Box>
        )}
      </Menu>

      <Dialog open={logic.dialogState.isOpen} onClose={() => logic.setDialogState({ ...logic.dialogState, isOpen: false })}>
        <DialogTitle>
          {logic.dialogState.mode === 'rename' && t("rename_table")}
          {logic.dialogState.mode === 'copy' && t("copy_table")}
          {logic.dialogState.mode === 'analyze' && t("gather_stats_analyze")}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {logic.dialogState.mode === 'rename' && t("please_enter_a_new_table_name")}
            {logic.dialogState.mode === 'copy' && t("please_enter_target_table_name")}
            {logic.dialogState.mode === 'analyze' && t("enter_sampling_ratio_1_100")}
          </DialogContentText>
          <TextField autoFocus margin="dense" label={logic.dialogState.mode === 'analyze' ? t("sampling_ratio") : t("new_table_name")} type={logic.dialogState.mode === 'analyze' ? 'number' : 'text'} fullWidth variant="standard" value={logic.dialogState.newName} onChange={(e) => logic.setDialogState({ ...logic.dialogState, newName: e.target.value })} inputProps={logic.dialogState.mode === 'analyze' ? { min: 1, max: 100 } : {}} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => logic.setDialogState({ ...logic.dialogState, isOpen: false })}>{t("cancel")}</Button>
          <Button onClick={logic.handleDialogSubmit} variant="contained">{logic.dialogState.mode === 'rename' && t("change")}{logic.dialogState.mode === 'copy' && t("create")}{logic.dialogState.mode === 'analyze' && t("execute")}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={packageCreationSchema !== null} onClose={() => setPackageCreationSchema(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t("select_the_package_type_to_create")}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("select_header_specification_or_body_implementation")}</DialogContentText>
          <List>
            {(['PACKAGE', 'PACKAGE BODY'] as const).map(type => (
              <ListItemButton key={type} onClick={() => {
                if (packageCreationSchema === null) return;
                onAddTab('create-package', packageCreationSchema, type);
                setPackageCreationSchema(null);
              }}>
                <ListItemText primary={type === 'PACKAGE' ? t("header_specification") : t("body_implementation")} />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPackageCreationSchema(null)}>{t("cancel")}</Button>
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
