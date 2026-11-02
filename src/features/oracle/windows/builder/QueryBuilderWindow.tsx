// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { queryBuilderErrorMessage } from '@/features/query-builder/queryBuilderModel';
import QueryBuilderReviewDialog from '@/features/query-builder/QueryBuilderReviewDialog';

import { 
  Box, Paper, Typography, Checkbox, 
  IconButton, Tabs, Tab, Button,
  TextField, Select, MenuItem, Card, CardHeader, CardContent,
  Tooltip, FormControl
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow'; 
import AddIcon from '@mui/icons-material/Add';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadIcon from '@mui/icons-material/Download';
import UploadIcon from '@mui/icons-material/Upload';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import AiRequestButton from "@/features/ai/AiRequestButton";

import SqlWindowBottom from "@/features/sql/SqlWindowBottom";
import ObjectPickerDialog from "@/features/objects/ObjectPickerDialog";

const BUILDER_OBJECT_CATEGORIES = ['TABLE', 'VIEW'] as const;
import { useQueryBuilderWindow, type QueryBuilderProps } from './useQueryBuilderWindow';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, py: 2, px: 2, gap: 1, overflow: 'hidden', height: '100%', position: 'relative' as const }),
  tabsWrapper: { borderBottom: 1, borderColor: 'divider', mb: 0 },
  tabs: { minHeight: 36 },
  tabItem: { minHeight: 36, py: 0, fontSize: '0.9rem' },
  mainTabBox: (isVisible: boolean) => ({ display: isVisible ? 'flex' : 'none', flexGrow: 1, flexDirection: 'column' as const, mt: 1, overflow: 'hidden' }),
  designViewPaper: { flex: 1, position: 'relative' as const, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const, bgcolor: 'background.default' },
  designViewHeader: { p: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', zIndex: 10 },
  designViewHeaderActions: { display: 'flex', gap: 1 },
  toolbarIcon: { border: '1px solid', borderColor: 'divider', borderRadius: 1, minWidth: 32 },
  canvasBox: { position: 'relative' as const, flexGrow: 1, overflow: 'auto' },
  svgCanvas: { position: 'absolute' as const, top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' as const, zIndex: 1 },
  tableCard: (t: { x: number; y: number }) => ({ position: 'absolute' as const, left: t.x, top: t.y, width: 180, border: '1px solid', borderColor: 'primary.main', zIndex: 2, boxShadow: 3, userSelect: 'none' as const }),
  tableCardHeader: { bgcolor: 'action.hover', p: 1, cursor: 'move', '&:active': { cursor: 'grabbing' } },
  tableCardHeaderIcon: { p: 0.2 },
  tableCardContent: { p: 0, '&:last-child': { pb: 0 }, maxHeight: 150, overflowY: 'auto' as const, bgcolor: 'background.paper' },
  colItem: (isSelected: boolean) => ({ display: 'flex', alignItems: 'center', p: 0.5, px: 1, fontSize: '0.8rem', borderBottom: '1px solid', borderColor: 'divider', cursor: 'grab', bgcolor: isSelected ? 'action.selected' : 'transparent', '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' }, userSelect: 'none' as const }),
  colItemIcon: (isSelected: boolean) => ({ fontSize: '0.8rem', color: isSelected ? 'primary.main' : 'text.disabled', mr: 0.5, pointerEvents: 'none' as const }),
  gridResizer: (isGridResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isGridResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 0.5, mx: -2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  gridResizerInner: (isGridResizing: boolean) => ({ width: 40, height: 2, bgcolor: isGridResizing ? 'background.paper' : 'divider', borderRadius: 1 }),
  gridPaper: (gridHeight: number) => ({ height: gridHeight, flexShrink: 0, display: 'flex', flexDirection: 'column' as const }),
  gridTabsWrapper: { borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' },
  gridTabs: { minHeight: 32 },
  gridTabItem: { minHeight: 32, py: 0, fontSize: '0.85rem' },
  gridBox: (isVisible: boolean, hasFields: boolean) => ({ display: isVisible ? 'flex' : 'none', flexGrow: 1, minWidth: 'max-content', bgcolor: hasFields ? 'background.paper' : 'background.default', overflowX: 'auto' as const }),
  gridHeaders: { width: 160, borderRight: '2px solid', borderColor: 'divider', bgcolor: 'action.hover', position: 'sticky' as const, left: 0, zIndex: 2 },
  gridHeaderCell: { height: 28, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', px: 1, fontSize: '0.8rem', fontWeight: 'bold' },
  fieldCol: (isDragged: boolean) => ({ width: 160, borderRight: '1px solid', borderColor: 'divider', position: 'relative' as const, opacity: isDragged ? 0.5 : 1, cursor: isDragged ? 'grabbing' : 'grab' }),
  fieldColCloseBtn: { position: 'absolute' as const, top: 2, right: 2, width: 20, height: 20, bgcolor: 'background.paper' },
  fieldColTitle: { height: 28, borderBottom: '1px solid', borderColor: 'divider', px: 1, fontSize: '0.8rem', display: 'flex', alignItems: 'center', bgcolor: 'action.selected', fontWeight: 'bold' },
  fieldColSubtitle: { height: 28, borderBottom: '1px solid', borderColor: 'divider', px: 1, fontSize: '0.75rem', display: 'flex', alignItems: 'center', bgcolor: 'background.default', color: 'text.secondary' },
  fieldColCell: { height: 28, borderBottom: '1px solid', borderColor: 'divider', p: 0 },
  fieldColSelect: { fontSize: '0.75rem', px: 1 },
  fieldColCheckboxCell: { height: 28, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  joinBox: (isVisible: boolean, hasJoins: boolean) => ({ display: isVisible ? 'flex' : 'none', flexGrow: 1, flexDirection: 'column' as const, bgcolor: hasJoins ? 'background.paper' : 'background.default', p: 2, overflowY: 'auto' as const }),
  joinEmptyText: { fontStyle: 'italic' },
  joinItem: { display: 'flex', alignItems: 'center', gap: 2, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.default' },
  joinColumn: { display: 'flex', flexDirection: 'column' as const, gap: 0.5, flex: 1 },
  joinSelect: { bgcolor: 'background.paper' },

};

export default function QueryBuilderWindow(props: QueryBuilderProps) {
  const logic = useQueryBuilderWindow(props);
  const { t } = logic;
  const theme = useTheme();

  if (!props.isActive) return null;

  return (
    <Box data-testid="query-builder" component="fieldset" disabled={logic.isLoading || logic.ai.isReviewing} sx={{ ...styles.rootBox(props.isActive), minWidth: 0, border: 0, m: 0, pointerEvents: logic.isLoading || logic.ai.isReviewing ? 'none' : 'auto' }}>
      <Box sx={styles.tabsWrapper}>
        <Tabs value={logic.mainTab} onChange={(_e, val) => logic.setMainTab(val)} sx={styles.tabs}>
          <Tab label={t("design_view")} sx={styles.tabItem} />
          <Tab label={t("result_logs")} sx={styles.tabItem} />
        </Tabs>
      </Box>

      {/* Tab 0: design view. */}
      <Box sx={styles.mainTabBox(logic.mainTab === 0)}>
        <Paper elevation={1} sx={styles.designViewPaper}>
          <Box data-testid="query-builder-toolbar" sx={styles.designViewHeader}>
            <Box sx={styles.designViewHeaderActions}>
              <Tooltip title={t('qb_undo_help')}>
                <Box component="span" sx={{ display: 'flex' }}><IconButton size="small" color="primary" onClick={logic.editor.undo}
                  disabled={!logic.editor.canUndo || logic.isLoading} aria-label={t('qb_undo')} sx={styles.toolbarIcon}><UndoIcon /></IconButton></Box>
              </Tooltip>
              <Tooltip title={t('qb_redo_help')}>
                <Box component="span" sx={{ display: 'flex' }}><IconButton size="small" color="primary" onClick={logic.editor.redo}
                  disabled={!logic.editor.canRedo || logic.isLoading} aria-label={t('qb_redo')} sx={styles.toolbarIcon}><RedoIcon /></IconButton></Box>
              </Tooltip>
              <Tooltip title={t('qb_import_help')}>
                <Box component="span" sx={{ display: 'flex' }}><IconButton size="small" color="primary" onClick={logic.triggerImport}
                  disabled={logic.isLoading} aria-label={t('read_2')} sx={styles.toolbarIcon}><UploadIcon /></IconButton></Box>
              </Tooltip>
              <Tooltip title={t('qb_export_help')}>
                <Box component="span" sx={{ display: 'flex' }}><IconButton size="small" color="primary" onClick={logic.handleExportJson}
                  disabled={logic.queryTables.length === 0 || logic.isLoading} aria-label={t('save')} sx={styles.toolbarIcon}><DownloadIcon /></IconButton></Box>
              </Tooltip>
              <input type="file" accept=".json" style={{ display: 'none' }} ref={logic.importFileRef} onChange={logic.handleImportJson} />

              <Tooltip title={t('qb_clear_help')}>
                <Box component="span" sx={{ display: 'flex' }}><Button size="small" variant="outlined" onClick={logic.handleClearAll} color="error" startIcon={<ClearAllIcon />} sx={{ ml: 1 }}>{t("clear")}</Button></Box>
              </Tooltip>
              <Tooltip title={t("add_tables_or_views_to_the_query")}>
                <Box component="span" sx={{ display: 'flex' }}><Button size="small" variant="contained" onClick={logic.handleOpenAddTableDialog} startIcon={<AddIcon />}>{t("add")}</Button></Box>
              </Tooltip>
              <Tooltip title={t('qb_execute_help')}>
                <Box component="span" sx={{ display: 'flex' }}><Button size="small" variant="contained" color="success" onClick={logic.handleExecuteSql} startIcon={<PlayArrowIcon />} disabled={logic.queryTables.length === 0 || !!logic.sqlError || logic.isLoading}>{t("execute")}</Button></Box>
              </Tooltip>
              <Tooltip title={t("ask_ai_to_generate_sql_using_the_added_tables_and_views")}>
                <Box component="span" sx={{ display: 'flex', alignItems: 'stretch' }}><AiRequestButton aria-label={t("ask_ai_to_generate_sql")} onClick={logic.handleRequestAi} disabled={logic.queryTables.length === 0} /></Box>
              </Tooltip>
            </Box>
          </Box>
          
          {logic.sqlError && <Typography role="alert" color="error" sx={{ px: 2 }}>{queryBuilderErrorMessage(logic.sqlError, t)}</Typography>}
          <Box data-testid="query-builder-canvas" sx={styles.canvasBox}>
            {logic.queryTables.length === 0 && <Box data-testid="query-builder-empty" sx={{ p: 2, color: 'text.secondary', pointerEvents: 'none' }}>
              <Typography variant="subtitle2">{t("tables_views_and_fields")}</Typography>
              <Typography variant="caption">{t("ctrl_shift_for_multi_select_drag_or_double_click_to_add")}</Typography>
            </Box>}
            <svg style={styles.svgCanvas}>
              {logic.queryJoins.map(join => {
                const fromT = logic.queryTables.find(table => table.id === join.fromTableId);
                const toT = logic.queryTables.find(table => table.id === join.toTableId);
                if (fromT && toT) {
                  const x1 = fromT.x + 90; const y1 = fromT.y + 20; const x2 = toT.x + 90; const y2 = toT.y + 20;
                  const midX = (x1 + x2) / 2; const midY = (y1 + y2) / 2;
                  
                  const joinLabel = join.joinType === 'INNER' ? t("inner_join") : join.joinType === 'LEFT' ? t("left_outer_join") : t("right_outer_join");
                  const isLeft = join.joinType === 'LEFT';
                  const isRight = join.joinType === 'RIGHT';

                  return (
                    <g key={join.id}>
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={theme.palette.primary.main} strokeWidth="2" strokeDasharray="4 2" />
                      <rect x={midX - 50} y={midY - 10} width={100} height={20} fill={theme.palette.background.paper} rx={4} stroke={theme.palette.divider} />
                      {isLeft && <polygon points={`${midX + 40},${midY} ${midX + 30},${midY - 5} ${midX + 30},${midY + 5}`} fill={theme.palette.primary.main} />}
                      {isRight && <polygon points={`${midX - 40},${midY} ${midX - 30},${midY - 5} ${midX - 30},${midY + 5}`} fill={theme.palette.primary.main} />}
                      <text x={midX} y={midY + 3} fontSize="9" fill={theme.palette.text.primary} textAnchor="middle" fontWeight="bold">
                        {joinLabel}
                      </text>
                    </g>
                  );
                }
                return null;
              })}
            </svg>

            {logic.queryTables.map(table => (
              <Card key={table.id} sx={styles.tableCard(table)}>
                <CardHeader 
                  title={table.name} 
                  titleTypographyProps={{ variant: 'caption', fontWeight: 'bold' }} 
                  action={
                    <Tooltip title={t("remove_this_table_or_view")}>
                      <IconButton size="small" onClick={() => logic.handleRemoveTable(table.id)} sx={styles.tableCardHeaderIcon}>
                        <CloseIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                      </IconButton>
                    </Tooltip>
                  }
                  sx={styles.tableCardHeader} 
                  onMouseDown={(e) => logic.handleTableMouseDown(e, table.id, table.x, table.y)}
                />
                <CardContent sx={styles.tableCardContent}>
                  {table.columns.map((col, idx) => {
                    const isSelected = logic.selectedCols.includes(`${table.id}::${col}`);
                    return (
                      <Box 
                        key={col} 
                        draggable 
                        onClick={(e) => logic.handleColClick(e, table.id, col, idx)} 
                        onDoubleClick={() => logic.handleFieldDoubleClick(table, col)} 
                        onDragStart={(e) => logic.handleColDragStart(e, table.id, col, idx)}
                        onDragOver={(e) => e.preventDefault()} 
                        onDrop={(e) => logic.handleFieldDropToField(e, table.id, col)}
                        sx={styles.colItem(isSelected)}
                      >
                        <DragIndicatorIcon sx={styles.colItemIcon(isSelected)} />
                        <Box sx={{ flexGrow: 1 }}>{col}</Box>
                      </Box>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </Box>
        </Paper>

        <Box onMouseDown={logic.handleGridMouseDown} sx={styles.gridResizer(logic.isGridResizing)}>
          <Box sx={styles.gridResizerInner(logic.isGridResizing)} />
        </Box>

        <Paper elevation={1} sx={styles.gridPaper(logic.gridHeight)}>
          <Box sx={styles.gridTabsWrapper}>
            <Tabs value={logic.gridTab} onChange={(_e, val) => logic.setGridTab(val)} sx={styles.gridTabs}>
              <Tab label={t("design_grid")} sx={styles.gridTabItem} />
              <Tab label={`${t("join_condition")} ${logic.queryJoins.length > 0 ? `(${logic.queryJoins.length})` : ''}`} sx={styles.gridTabItem} />
            </Tabs>
          </Box>

          <Box onDragOver={(e) => e.preventDefault()} onDrop={logic.handleFieldDropToGrid} sx={styles.gridBox(logic.gridTab === 0, logic.queryFields.length > 0)}>
            <Box sx={styles.gridHeaders}>
              {[t("columns_fields"), t("table_2"), t("aggregate"), t("sort_2"), t("show"), t("condition"), t("or")].map((label) => (
                <Box key={label} sx={styles.gridHeaderCell}>{label}</Box>
              ))}
            </Box>
            {logic.queryFields.map((field, idx) => (
              <Box 
                key={field.id} draggable 
                onDragStart={(e) => logic.handleGridFieldDragStart(e, idx)}
                onDragEnter={() => logic.handleGridFieldDragEnter(idx)}
                onDragEnd={logic.handleGridFieldDragEnd}
                onDragOver={(e) => e.preventDefault()}
                sx={styles.fieldCol(logic.draggedGridFieldIndex === idx)}
              >
                <IconButton size="small" onClick={() => logic.handleRemoveField(field.id)} sx={styles.fieldColCloseBtn}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
                <Box sx={styles.fieldColTitle}>{field.columnName}</Box>
                <Box sx={styles.fieldColSubtitle}>{field.tableName}</Box>
                <Box sx={styles.fieldColCell}>
                   <Select size="small" variant="standard" fullWidth disableUnderline value={field.groupBy} sx={styles.fieldColSelect} onChange={(e) => logic.handleGroupByChange(field.id, e.target.value)}>
                     <MenuItem value="">{t("none")}</MenuItem><MenuItem value="GROUP BY">{t("grouping")}</MenuItem><MenuItem value="SUM">{t("sum_2")}</MenuItem><MenuItem value="COUNT">{t("count_2")}</MenuItem><MenuItem value="MAX">{t("max_3")}</MenuItem><MenuItem value="MIN">{t("min_3")}</MenuItem><MenuItem value="AVG">{t("avg_2")}</MenuItem>
                   </Select>
                </Box>
                <Box sx={styles.fieldColCell}>
                   <Select size="small" variant="standard" fullWidth disableUnderline value={field.sort} sx={styles.fieldColSelect} onChange={(e) => logic.handleSortChange(field.id, e.target.value)}>
                     <MenuItem value="">{t("none")}</MenuItem><MenuItem value="ASC">{t("asc")}</MenuItem><MenuItem value="DESC">{t("desc")}</MenuItem>
                   </Select>
                </Box>
                <Box sx={styles.fieldColCheckboxCell}>
                  <Checkbox size="small" checked={field.show} sx={{ p: 0 }} onChange={(e) => logic.handleShowChange(field.id, e.target.checked)} />
                </Box>
                <Box sx={styles.fieldColCell}>
                  <TextField size="small" variant="standard" fullWidth InputProps={{ disableUnderline: true, style: { fontSize: '0.8rem', padding: '0 8px' } }} placeholder={t("e_g_1000")} value={field.criteria} onChange={(e) => logic.handleCriteriaChange(field.id, e.target.value)} />
                </Box>
                <Box sx={styles.fieldColCell}>
                  <TextField size="small" variant="standard" fullWidth InputProps={{ disableUnderline: true, style: { fontSize: '0.8rem', padding: '0 8px' } }} placeholder={t("e_g_a")} value={field.orCriteria} onChange={(e) => logic.handleOrCriteriaChange(field.id, e.target.value)} />
                </Box>
              </Box>
            ))}
            {logic.queryFields.length === 0 && <Box sx={{ p: 2, color: 'text.secondary', fontStyle: 'italic', fontSize: '0.85rem' }}>{t("drag_and_drop_column_names_here_from_above")}</Box>}
          </Box>

          <Box sx={styles.joinBox(logic.gridTab === 1, logic.queryJoins.length > 0)}>
            {logic.queryJoins.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={styles.joinEmptyText}>{t("no_join_conditions_set_drag_columns_between_tables_above_to_create_joins")}</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {logic.queryJoins.map(join => (
                  <Box key={join.id} sx={styles.joinItem}>
                    <Box sx={styles.joinColumn}>
                      <Typography variant="caption" color="text.secondary">{t("table_1")}</Typography>
                      <FormControl size="small" fullWidth>
                        <Select value={join.fromTableId} onChange={(e) => logic.updateJoin(join.id, 'fromTableId', e.target.value as string)} sx={styles.joinSelect}>
                          {logic.queryTables.map(table => <MenuItem key={table.id} value={table.id}>{table.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                      <FormControl size="small" fullWidth>
                        <Select value={join.fromCol} onChange={(e) => logic.updateJoin(join.id, 'fromCol', e.target.value as string)} sx={styles.joinSelect}>
                          {logic.queryTables.find(table => table.id === join.fromTableId)?.columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Box>

                    <Box sx={styles.joinColumn}>
                      <Typography variant="caption" color="text.secondary">{t("join_type")}</Typography>
                      <FormControl size="small" fullWidth>
                        <Select value={join.joinType} onChange={(e) => logic.updateJoin(join.id, 'joinType', e.target.value as string)} sx={styles.joinSelect}>
                          <MenuItem value="INNER">{t("inner_join_exists_in_both")}</MenuItem>
                          <MenuItem value="LEFT">{t("left_outer_join_all_data_from_table_1")}</MenuItem>
                          <MenuItem value="RIGHT">{t("right_outer_join_all_data_from_table_2")}</MenuItem>
                        </Select>
                      </FormControl>
                    </Box>

                    <Box sx={styles.joinColumn}>
                      <Typography variant="caption" color="text.secondary">{t("table_2_2")}</Typography>
                      <FormControl size="small" fullWidth>
                        <Select value={join.toTableId} onChange={(e) => logic.updateJoin(join.id, 'toTableId', e.target.value as string)} sx={styles.joinSelect}>
                          {logic.queryTables.map(table => <MenuItem key={table.id} value={table.id}>{table.name}</MenuItem>)}
                        </Select>
                      </FormControl>
                      <FormControl size="small" fullWidth>
                        <Select value={join.toCol} onChange={(e) => logic.updateJoin(join.id, 'toCol', e.target.value as string)} sx={styles.joinSelect}>
                          {logic.queryTables.find(table => table.id === join.toTableId)?.columns.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Box>

                    <Tooltip title={t("remove_this_join")}>
                      <IconButton color="error" onClick={() => logic.setQueryJoins(prev => prev.filter(j => j.id !== join.id))} sx={{ mt: 2 }}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Paper>
      </Box>

      {/* Tab 1: results and logs. */}
      <Box sx={styles.mainTabBox(logic.mainTab === 1)}>
        {logic.mainTab === 1 && <SqlWindowBottom
          rows={logic.rows} 
          columns={logic.columns} 
          isExplainResult={false}
          bottomTab={logic.bottomTab} 
          setBottomTab={logic.setBottomTab} 
          logs={logic.logs} 
          historyLogs={logic.historyLogs} 
          historyLimit={logic.historyLimit}
          handleClearLogs={logic.handleClearLogs} 
          handleClearHistory={logic.handleClearHistory} 
          handleConsoleClick={() => {}}
          setSqlText={() => {}} 
          dateFormat={props.dateFormat}
          sqlText=""
          dbInfo={props.dbInfo}
          title={props.title || 'QueryBuilder'}
          isAiEnabled={false}
          onOpenAiSidebar={() => {}}
        />}
      </Box>

      <QueryBuilderReviewDialog ai={logic.ai} />
      <ObjectPickerDialog open={logic.addTableDialogOpen} dbType="oracle"
        initialSchema={props.userName?.toUpperCase()} categories={BUILDER_OBJECT_CATEGORIES}
        title={t("add_tables_and_views")} disabled={logic.isLoading}
        isObjectAdded={logic.isObjectAdded} onConfirm={logic.handleAddObjectsToBuilder}
        onClose={() => logic.setAddTableDialogOpen(false)} />
    </Box>
  );
}
