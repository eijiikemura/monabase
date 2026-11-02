// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { GridFooterContent, StableGridFooter } from '@/features/data-grid/StableGridFooter';
import { memo, useMemo } from 'react';
import {
  Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
  Button, Tabs, Tab, Checkbox, FormControlLabel, TextField,
  Tooltip as MuiTooltip} from '@mui/material';
import { DataGrid, jaJP, GridPagination } from '@mui/x-data-grid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PivotTableChartIcon from '@mui/icons-material/PivotTableChart';
import FunctionsIcon from '@mui/icons-material/Functions';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer
} from 'recharts';

import ExportDialog from "@/components/data/ExportDialog";
import ConditionPanel from "@/components/data/ConditionPanel";
import { useCrossTabWindow, type CrossTabWindowProps, GRAPH_COLORS } from './useCrossTabWindow';

const MemoDataGrid = memo(DataGrid);
const MemoConditionPanel = memo(ConditionPanel);

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, height: '100%', bgcolor: 'background.default', p: 2, gap: 1 }),
  topContainer: (topHeight: number) => ({ display: 'flex', flexDirection: 'column' as const, height: topHeight, flexShrink: 0, gap: 1, minHeight: 0 }),
  headerPaper: { p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' as const, flexShrink: 0, bgcolor: 'background.paper' },
  headerTitle: { mr: 1 },
  headerIcon: { verticalAlign: 'middle', mr: 1 },
  formControlSmall: { minWidth: 150 },
  formControlLarge: { minWidth: 250, flexGrow: 1 },
  headerActionsBox: { display: 'flex', gap: 1 },
  configPaper: { display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', flexGrow: 1, minHeight: 0, bgcolor: 'background.paper' },
  configTabsWrapper: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 },
  configTabs: { minHeight: 36 },
  configTabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  configContentBox: (isVisible: boolean) => ({ display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, flexGrow: 1, overflowY: 'auto' as const, p: 2, bgcolor: 'action.hover', gap: 1.5 }),
  configRowBox: { display: 'flex', gap: 2, p: 1.5, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', alignItems: 'center', flexWrap: 'wrap' as const },
  configLabel: { fontWeight: 'bold', color: 'primary.main', width: 70 },
  configFieldSelect: { minWidth: 180 },
  configCastSelect: { minWidth: 140 },
  configFormatInput: { width: 120 },
  configGroupSelect: { minWidth: 120 },
  numGroupBox: { display: 'flex', gap: 1, alignItems: 'center' },
  numGroupInput: { width: 80 },
  valConfigWrapper: { display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' as const },
  valConfigBox: { display: 'flex', gap: 1, p: 1.5, bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', alignItems: 'center' },
  executeBtn: { px: 4, py: 1.5, fontWeight: 'bold' },
  conditionBox: (isVisible: boolean) => ({ display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, flexGrow: 1, overflow: 'hidden', bgcolor: 'background.paper' }),
  resizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', mx: -2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  resizerInner: (isResizing: boolean) => ({ width: 40, height: 2, bgcolor: isResizing ? 'background.paper' : 'divider', borderRadius: 1 }),
  bottomPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, bgcolor: 'background.paper' },
  bottomTabsWrapper: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 },
  bottomTabs: { minHeight: 36 },
  bottomTabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  resultBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0, position: 'relative' as const }),
  dataGrid: { border: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 'bold' } },
  emptyStateBox: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.secondary' },
  graphBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0, position: 'relative' as const, bgcolor: 'background.paper' }),
  graphToolbar: { display: 'flex', alignItems: 'center', p: 1, borderBottom: '1px solid', borderColor: 'divider', gap: 2 },
  graphTypeSelect: { height: 32, fontSize: '0.85rem' },
  chartContainer: { flexGrow: 1, p: 2, minHeight: 0, bgcolor: 'background.paper' },
  logsBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, minHeight: 0, bgcolor: 'action.hover' }),
  logsContentBox: { flexGrow: 1, overflowY: 'auto' as const, p: 1 },
  logItem: { mb: 1, pb: 1, borderBottom: '1px solid', borderColor: 'divider' },
  logItemTitle: { fontWeight: 'bold', color: 'text.secondary' },
  logItemSql: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.primary', mt: 0.5, bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  logErrorWrapper: { mt: 1, p: 1, bgcolor: 'error.light', borderRadius: 1, border: '1px solid', borderColor: 'error.main' },
  logErrorLine: { whiteSpace: 'pre-wrap', marginBottom: '2px', color: '#fff', fontFamily: 'monospace', fontSize: '0.85rem' },
  logEmptyText: { p: 2, textAlign: 'center' as const }
};

export default function CrossTabWindow(props: CrossTabWindowProps) {
  const logic = useCrossTabWindow(props);
  const { t } = logic;

  const conditionColumns = useMemo(
    () => logic.columns.map(column => column.name),
    [logic.columns]
  );

  const footer = (
    <>
      <Box sx={{ display: 'flex', gap: 1, pl: 2, alignItems: 'center' }}>
        <ExportDialog
          columns={logic.pivotColumns}
          rows={logic.pivotRows}
          defaultFileName={`${logic.selectedObject}_crosstab`}
          iconType="download"
        />
      </Box>
      <GridPagination />
    </>
  );

  const gridComponents = useMemo(
    () => ({ Footer: StableGridFooter }),
    []
  );

  const graph = useMemo(() => {
    if (logic.pivotRows.length === 0) return null;

    const dataKeys = logic.pivotColumns.filter(c => c.field !== 'ROW_VALUE').map(c => c.field);
    const ChartComponent = logic.graphType === 'bar' ? BarChart : logic.graphType === 'line' ? LineChart : AreaChart;
    const DataComponent = logic.graphType === 'bar' ? Bar : logic.graphType === 'line' ? Line : Area;

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={logic.pivotRows} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="ROW_VALUE" />
          <YAxis
            tickFormatter={(val) => logic.formatNumberValue(val)}
            width={100}
          />
          <RechartsTooltip formatter={(value, name) => [logic.formatNumberValue(value), String(name ?? '')]} />
          <Legend />
          {dataKeys.map((key, index) => (
            <DataComponent
              key={key}
              type="monotone"
              dataKey={key}
              fill={GRAPH_COLORS[index % GRAPH_COLORS.length]}
              stroke={GRAPH_COLORS[index % GRAPH_COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </ChartComponent>
      </ResponsiveContainer>
    );
  }, [logic]);

  if (!props.isActive) return null;

  return (
    <Box sx={styles.rootBox(props.isActive)}>
      <Box sx={styles.topContainer(logic.topHeight)}>

        <Paper elevation={1} sx={styles.headerPaper}>
          <Typography variant="subtitle2" fontWeight="bold" sx={styles.headerTitle}>
            <PivotTableChartIcon sx={styles.headerIcon}/>{t("cross_tabulation")}
          </Typography>

          <FormControl size="small" sx={styles.formControlSmall}>
            <InputLabel shrink>{t("schema")}</InputLabel>
            <Select
              value={logic.schema || ''}
              displayEmpty
              label={t("schema")}
              notched
              onChange={logic.handleChangeSchema}
            >
              <MenuItem value="" disabled><em>{t("select_schema")}</em></MenuItem>
              {props.schemas.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl size="small" sx={styles.formControlSmall}>
            <InputLabel>{t("type_2")}</InputLabel>
            <Select value={logic.objectType} label={t("type_2")} onChange={logic.handleChangeObjectType}>
              <MenuItem value="TABLE">TABLE</MenuItem>
              <MenuItem value="VIEW">VIEW</MenuItem>
              <MenuItem value="MATERIALIZED VIEW">MATERIALIZED VIEW</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={styles.formControlLarge}>
            <InputLabel shrink>{t("object")}</InputLabel>
            <Select
              value={logic.selectedObject || ''}
              displayEmpty
              label={t("object")}
              notched
              onChange={logic.handleChangeObject}
              disabled={!logic.schema}
            >
              <MenuItem value=""><em>{t("all")}</em></MenuItem>
              {logic.objects.map(obj => <MenuItem key={obj} value={obj}>{obj}</MenuItem>)}
            </Select>
          </FormControl>

          <MuiTooltip title={t("fetch_columns_of_selected_object_and_open_setup_panel")} arrow placement="top">
            <span>
              <Button variant="contained" color="primary" startIcon={<PlayArrowIcon />} onClick={logic.handleFetchColumns} disabled={!logic.selectedObject}>
                {t("start_setup")}
              </Button>
            </span>
          </MuiTooltip>

          <Box sx={{ flexGrow: 1 }} />

          <Box sx={styles.headerActionsBox}>
            <MuiTooltip title={t("load_saved_settings_file_json")} arrow placement="top">
              <Button variant="outlined" size="small" startIcon={<FolderOpenIcon />} onClick={() => logic.fileInputRef.current?.click()}>
                {t("load")}
              </Button>
            </MuiTooltip>

            <MuiTooltip title={t("save_current_settings_as_a_json_file")} arrow placement="top">
              <span>
                <Button variant="outlined" size="small" startIcon={<SaveIcon />} onClick={logic.handleExportSettings} disabled={!logic.selectedObject || logic.columns.length === 0}>
                  {t("save")}
                </Button>
              </span>
            </MuiTooltip>

            <input type="file" accept=".json" ref={logic.fileInputRef} style={{ display: 'none' }} onChange={logic.handleImportFileChange} />
          </Box>
        </Paper>

        {logic.columns.length > 0 && (
          <Paper elevation={1} sx={styles.configPaper}>
            <Box sx={styles.configTabsWrapper}>
              <Tabs value={logic.configTab} onChange={(_e, newValue) => logic.setConfigTab(newValue)} sx={styles.configTabs}>
                <Tab label={t("pivot_settings")} sx={styles.configTabItem} />
                <Tab label={t("filter_condition")} sx={styles.configTabItem} />
              </Tabs>
            </Box>

            <Box sx={styles.configContentBox(logic.configTab === 0)}>

              <Box sx={styles.configRowBox}>
                <Typography variant="body2" sx={styles.configLabel}>{t("rows_y_axis")}</Typography>
                <FormControl size="small" sx={styles.configFieldSelect}>
                  <InputLabel>{t("target_column")}</InputLabel>
                  <Select value={logic.rowField} label={t("target_column")} onChange={logic.handleRowFieldChange}>
                    {logic.columns.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={styles.configCastSelect}>
                  <InputLabel>{t("type_cast")}</InputLabel>
                  <Select
                    value={logic.rowCastType}
                    label={t("type_cast")}
                    onChange={e => logic.setRowCastType(e.target.value as typeof logic.rowCastType)}
                    disabled={logic.rowCastType === 'NONE' && logic.getInitialCastType(logic.columns.find(c => c.name === logic.rowField)) === 'NONE'}
                  >
                    {logic.getInitialCastType(logic.columns.find(c => c.name === logic.rowField)) === 'NONE' ? (
                      <MenuItem value="NONE">{t("none_date_type")}</MenuItem>
                    ) : [
                      <MenuItem key="STRING" value="STRING">{t("to_string")}</MenuItem>,
                      <MenuItem key="NUMBER" value="NUMBER">{t("to_number")}</MenuItem>,
                      <MenuItem key="DATE" value="DATE">{t("to_date")}</MenuItem>
                    ]}
                  </Select>
                </FormControl>

                {logic.rowCastType === 'DATE' && (
                  <MuiTooltip title={t("specify_actual_format_e_g_yyyymmdd_for_20251231")}>
                    <TextField
                      size="small"
                      label={t("original_format")}
                      placeholder="YYYYMM"
                      value={logic.rowDateFormat}
                      onChange={e => logic.setRowDateFormat(e.target.value)}
                      sx={styles.configFormatInput}
                    />
                  </MuiTooltip>
                )}

                {(logic.rowCastType === 'NONE' || logic.rowCastType === 'DATE') && (
                  <FormControl size="small" sx={styles.configGroupSelect}>
                    <InputLabel>{t("grouping")}</InputLabel>
                    <Select value={logic.rowDateGroup} label={t("grouping")} onChange={e => logic.setRowDateGroup(e.target.value)}>
                      <MenuItem value="NONE">{t("none")}</MenuItem>
                      <MenuItem value="YEAR">{t("year")}</MenuItem>
                      <MenuItem value="QUARTER">{t("quarter")}</MenuItem>
                      <MenuItem value="MONTH">{t("month")}</MenuItem>
                      <MenuItem value="DAY">{t("day")}</MenuItem>
                    </Select>
                  </FormControl>
                )}

                {logic.rowCastType === 'NUMBER' && (
                  <Box sx={styles.numGroupBox}>
                    <FormControlLabel
                      control={<Checkbox size="small" checked={logic.rowNumGroup.enable} onChange={e => logic.setRowNumGroup({...logic.rowNumGroup, enable: e.target.checked})} />}
                      label={<Typography variant="body2">{t("group_by_classes")}</Typography>} sx={{ m: 0 }}
                    />
                    {logic.rowNumGroup.enable && (
                      <>
                        <TextField size="small" label={t("start_value")} type="number" value={logic.rowNumGroup.start} onChange={e => logic.setRowNumGroup({...logic.rowNumGroup, start: Number(e.target.value)})} sx={styles.numGroupInput} />
                        <TextField size="small" label={t("end_value")} type="number" value={logic.rowNumGroup.end} onChange={e => logic.setRowNumGroup({...logic.rowNumGroup, end: Number(e.target.value)})} sx={styles.numGroupInput} />
                        <TextField size="small" label={t("unit")} type="number" value={logic.rowNumGroup.step} onChange={e => logic.setRowNumGroup({...logic.rowNumGroup, step: Number(e.target.value)})} sx={styles.numGroupInput} />
                      </>
                    )}
                  </Box>
                )}
              </Box>

              <Box sx={styles.configRowBox}>
                <Typography variant="body2" sx={styles.configLabel}>{t("columns_x_axis")}</Typography>
                <FormControl size="small" sx={styles.configFieldSelect}>
                  <InputLabel>{t("target_column")}</InputLabel>
                  <Select value={logic.colField} label={t("target_column")} onChange={logic.handleColFieldChange}>
                    {logic.columns.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={styles.configCastSelect}>
                  <InputLabel>{t("type_cast")}</InputLabel>
                  <Select
                    value={logic.colCastType}
                    label={t("type_cast")}
                    onChange={e => logic.setColCastType(e.target.value as typeof logic.colCastType)}
                    disabled={logic.colCastType === 'NONE' && logic.getInitialCastType(logic.columns.find(c => c.name === logic.colField)) === 'NONE'}
                  >
                    {logic.getInitialCastType(logic.columns.find(c => c.name === logic.colField)) === 'NONE' ? (
                      <MenuItem value="NONE">{t("none_date_type")}</MenuItem>
                    ) : [
                      <MenuItem key="STRING" value="STRING">{t("to_string")}</MenuItem>,
                      <MenuItem key="NUMBER" value="NUMBER">{t("to_number")}</MenuItem>,
                      <MenuItem key="DATE" value="DATE">{t("to_date")}</MenuItem>
                    ]}
                  </Select>
                </FormControl>

                {logic.colCastType === 'DATE' && (
                  <MuiTooltip title={t("specify_actual_format_e_g_yyyymmdd_for_20251231")}>
                    <TextField
                      size="small"
                      label={t("original_format")}
                      placeholder="YYYYMM"
                      value={logic.colDateFormat}
                      onChange={e => logic.setColDateFormat(e.target.value)}
                      sx={styles.configFormatInput}
                    />
                  </MuiTooltip>
                )}

                {(logic.colCastType === 'NONE' || logic.colCastType === 'DATE') && (
                  <FormControl size="small" sx={styles.configGroupSelect}>
                    <InputLabel>{t("grouping")}</InputLabel>
                    <Select value={logic.colDateGroup} label={t("grouping")} onChange={e => logic.setColDateGroup(e.target.value)}>
                      <MenuItem value="NONE">{t("none")}</MenuItem>
                      <MenuItem value="YEAR">{t("year")}</MenuItem>
                      <MenuItem value="QUARTER">{t("quarter")}</MenuItem>
                      <MenuItem value="MONTH">{t("month")}</MenuItem>
                      <MenuItem value="DAY">{t("day")}</MenuItem>
                    </Select>
                  </FormControl>
                )}

                {logic.colCastType === 'NUMBER' && (
                  <Box sx={styles.numGroupBox}>
                    <FormControlLabel
                      control={<Checkbox size="small" checked={logic.colNumGroup.enable} onChange={e => logic.setColNumGroup({...logic.colNumGroup, enable: e.target.checked})} />}
                      label={<Typography variant="body2">{t("group_by_classes")}</Typography>} sx={{ m: 0 }}
                    />
                    {logic.colNumGroup.enable && (
                      <>
                        <TextField size="small" label={t("start_value")} type="number" value={logic.colNumGroup.start} onChange={e => logic.setColNumGroup({...logic.colNumGroup, start: Number(e.target.value)})} sx={styles.numGroupInput} />
                        <TextField size="small" label={t("end_value")} type="number" value={logic.colNumGroup.end} onChange={e => logic.setColNumGroup({...logic.colNumGroup, end: Number(e.target.value)})} sx={styles.numGroupInput} />
                        <TextField size="small" label={t("unit")} type="number" value={logic.colNumGroup.step} onChange={e => logic.setColNumGroup({...logic.colNumGroup, step: Number(e.target.value)})} sx={styles.numGroupInput} />
                      </>
                    )}
                  </Box>
                )}
              </Box>

              <Box sx={styles.valConfigWrapper}>
                <Box sx={styles.valConfigBox}>
                  <Typography variant="body2" sx={styles.configLabel}>{t("value_aggregation")}</Typography>
                  <FormControl size="small" sx={styles.configFieldSelect}>
                    <InputLabel>{t("aggregate_target_columns")}</InputLabel>
                    <Select value={logic.valField} label={t("aggregate_target_columns")} onChange={e => logic.setValField(e.target.value)}>
                      {logic.columns.map(c => <MenuItem key={c.name} value={c.name}>{c.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={styles.configGroupSelect}>
                    <InputLabel>{t("agg_method")}</InputLabel>
                    <Select value={logic.aggType} label={t("agg_method")} onChange={e => logic.setAggType(e.target.value as typeof logic.aggType)}>
                      <MenuItem value="SUM">{t("sum")}</MenuItem>
                      <MenuItem value="COUNT">{t("count")}</MenuItem>
                      <MenuItem value="AVG">{t("avg")}</MenuItem>
                      <MenuItem value="MAX">{t("max_2")}</MenuItem>
                      <MenuItem value="MIN">{t("min_2")}</MenuItem>
                    </Select>
                  </FormControl>
                </Box>

                <Box sx={{ flexGrow: 1 }} />

                <MuiTooltip title={t("execute_cross_tabulation_on_the_db_with_current_settings")} arrow placement="top">
                  <Button variant="contained" color="secondary" startIcon={<FunctionsIcon />} onClick={logic.handleGeneratePivot} sx={styles.executeBtn}>
                    {t("execute_cross_tab")}
                  </Button>
                </MuiTooltip>
              </Box>
            </Box>

            <Box sx={styles.conditionBox(logic.configTab === 1)}>
              <MemoConditionPanel
                columns={conditionColumns}
                conditions={logic.conditions}
                onConditionChange={logic.handleConditionChange}
                onClearConditions={logic.handleClearConditions}
                disabled={logic.isLoading}
                onExecute={logic.handleGeneratePivot}
                inputDateFormat={props.inputDateFormat}
                hideSort={true}
              />
            </Box>
          </Paper>
        )}
      </Box>

      <Box
        onMouseDown={() => logic.setIsResizing(true)}
        sx={styles.resizer(logic.isResizing)}
      >
        <Box sx={styles.resizerInner(logic.isResizing)} />
      </Box>

      <Paper elevation={1} sx={styles.bottomPaper}>
        <Box sx={styles.bottomTabsWrapper}>
          <Tabs value={logic.bottomTab} onChange={(_e, newValue) => logic.setBottomTab(newValue)} sx={styles.bottomTabs}>
            <Tab label={t("agg_results")} sx={styles.bottomTabItem} />
            <Tab label={t("chart")} sx={styles.bottomTabItem} />
            <Tab label={t("execution_log")} sx={styles.bottomTabItem} />
          </Tabs>
        </Box>

        <Box sx={styles.resultBox(logic.bottomTab === 0)}>
          {logic.pivotColumns.length > 0 ? (
            <>
              <GridFooterContent.Provider value={footer}>
                <MemoDataGrid
                rows={logic.pivotRows}
                columns={logic.pivotColumns}
                density="compact"
                disableRowSelectionOnClick
                localeText={jaJP.components.MuiDataGrid.defaultProps.localeText}
                components={gridComponents}
                sx={styles.dataGrid}
              />
              </GridFooterContent.Provider>
            </>
          ) : (
            <Box sx={styles.emptyStateBox}>
              {logic.columns.length > 0 ? t("set_conditions_and_click_execute_cross_tab") : t("select_an_object_from_the_top_and_click_start_setup")}
            </Box>
          )}
        </Box>

        <Box sx={styles.graphBox(logic.bottomTab === 1)}>
          {logic.pivotRows.length > 0 ? (
            <>
              <Box sx={styles.graphToolbar}>
                <FormControl size="small" sx={styles.formControlSmall}>
                  <Select value={logic.graphType} onChange={e => logic.setGraphType(e.target.value as typeof logic.graphType)} sx={styles.graphTypeSelect}>
                    <MenuItem value="bar">{t("bar_chart")}</MenuItem>
                    <MenuItem value="line">{t("line_chart")}</MenuItem>
                    <MenuItem value="area">{t("area_chart")}</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ flexGrow: 1 }} />

                <MuiTooltip title={t("copy_current_chart_as_image_png_to_clipboard")} arrow placement="top">
                  <Button variant="outlined" size="small" startIcon={<ContentCopyIcon />} onClick={logic.handleCopyGraph}>
                    {t("copy_image")}
                  </Button>
                </MuiTooltip>
              </Box>

              <Box id="bi-chart-container" sx={styles.chartContainer}>
                {graph}
              </Box>
            </>
          ) : (
            <Box sx={styles.emptyStateBox}>
              {t("please_execute_cross_tabulation_first_to_display_the_chart")}
            </Box>
          )}
        </Box>

        <Box sx={styles.logsBox(logic.bottomTab === 2)}>
          <Box sx={styles.logsContentBox}>
            {logic.logs.map((log, i) => (
              <Box key={i} sx={styles.logItem}>
                <Typography variant="caption" sx={styles.logItemTitle}>[{log.time}] {t("execution_time_2")} {log.execTime}{log.execTime !== '-' ? 'ms' : ''} / {t("result_2")} {log.resultMsg}</Typography>
                {log.sql && (
                  <Typography variant="body2" sx={styles.logItemSql}>{log.sql}</Typography>
                )}
                {log.errorLines && log.errorLines.length > 0 && (
                  <Box sx={styles.logErrorWrapper}>
                    {log.errorLines.map((eLine, eIdx) => (
                      <Box key={eIdx} sx={styles.logErrorLine}>{eLine}</Box>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
            {logic.logs.length === 0 && <Typography variant="body2" color="text.secondary" sx={styles.logEmptyText}>{t("no_execution_logs")}</Typography>}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
