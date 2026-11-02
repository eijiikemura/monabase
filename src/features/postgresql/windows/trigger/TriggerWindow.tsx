// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { TriggerTargetPicker } from '@/features/trigger/TriggerTargetPicker';
import { TriggerOverview } from '@/features/trigger/TriggerOverview';
import { useAiTraceDebug } from "@/features/ai/useAiTraceDebug";
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import AiRequestButton from "@/features/ai/AiRequestButton";
import { useTriggerAi } from "@/features/ai/useTriggerAi";
import type { TriggerAiSettings } from "@/features/ai/triggerBodyResponse";
import type { StoredAiProps } from "@/features/stored/storedCreation";

import { memo, useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Tabs, Tab, IconButton, Tooltip,
  TextField, FormControl, InputLabel, Select, MenuItem, RadioGroup, FormControlLabel, Radio,
  Checkbox, FormGroup, Button, Divider, Dialog, DialogTitle, DialogContent
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import StopIcon from '@mui/icons-material/Stop';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';

import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';

import VersionControlTab from "@/features/git/VersionControlTab";
import { useTriggerWindow, type TriggerWindowProps } from './useTriggerWindow';
import { SharedRightPanel, BreakpointConditionPopover } from "@/features/stored/StoredCommonUI";
import { TraceDebugArea } from "@/features/stored/TraceDebugArea";
import { formatDateString, DEFAULT_DATE_FORMAT } from "@/shared/utils/dateFormatter";

import { highlightSql } from '../common/pgSqlHighlighter';

// Extend the source editor to the bottom of its available area.
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  rootBox: (isActive: boolean) => ({ minHeight: 0, flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', height: '100%', bgcolor: 'background.default', position: 'relative' as const, border: 0, m: 0, p: 0, minWidth: 0 }),
  tabsContainer: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2 },
  tabs: { minHeight: 40 },
  tabItem: (isBold: boolean) => ({ minHeight: 40, py: 0, fontWeight: isBold ? 'bold' : 'normal' }),
  tabPane: (isVisible: boolean) => ({ minWidth: 0, flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', height: '100%', minHeight: 0 }),
  editMainBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', p: 1, gap: 1, minHeight: 0 },
  topPanel: (height: number) => ({ p: 2, display: 'flex', flexDirection: 'column' as const, gap: 2, height: height, flexShrink: 0, overflowY: 'auto' as const, bgcolor: 'background.paper' }),
  headerBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 2 },
  headerActions: { display: 'flex', gap: 1 },
  nameInput: { width: 300 },
  traceBtn: { fontWeight: 'bold' },
  formContainer: { display: 'flex', gap: 3 },
  col1: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  schemaObjectBox: { display: 'flex', gap: 1 },
  schemaSelect: { width: 120 },
  objectSelect: { flexGrow: 1 },
  radioLabel: { color: 'text.secondary' },
  col2: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 1 },
  col3: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  vResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  vResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomContainer: { flexGrow: 1, display: 'flex', overflow: 'hidden', gap: 0, minHeight: 0 },
  editorPaper: (isConsoleOpen: boolean, leftWidth: number) => ({ width: isConsoleOpen ? leftWidth : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, bgcolor: 'background.paper' }),
  editorHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  errorBtn: { py: 0 },
  cmBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  hResizer: (isResizing: boolean) => ({ width: 8, cursor: 'col-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', mx: 1, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  hResizerInner: (_isResizing: boolean) => ({ height: 40, width: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  consolePaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: '#1e1e1e', minHeight: 0 },
  consoleHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 0.5, bgcolor: '#333', color: '#fff' },
  consoleTitle: { ml: 1 },
  consoleClose: { color: '#ccc', p: 0.5 },
  consoleContent: { flexGrow: 1, overflowY: 'auto' as const, color: '#d4d4d4', p: 1, fontFamily: 'monospace', fontSize: '0.85rem' },
  logError: { color: '#f48771', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } },
  logNormal: { color: '#d4d4d4', cursor: 'default' },
  logEmpty: { fontStyle: 'italic' },
  sourceMainBox: { minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', p: 1, height: '100%', minHeight: 0 },
  sourcePaper: { minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, bgcolor: 'background.paper' },
  sourceHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between' },
  versionControlPane: { minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  traceMainBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, p: 1, height: '100%', overflow: 'hidden', minHeight: 0 },
  traceContainer: { display: 'flex', flexGrow: 1, overflow: 'hidden', minHeight: 0 },
  traceLeftPaper: (isRightOpen: boolean, width: number) => ({ width: isRightOpen ? width : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper', minHeight: 0 }),
  traceToolbar: { p: 0.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  traceActions: { display: 'flex', gap: 0.5, alignItems: 'center' },
  iconBtnGreen: { color: 'success.main' },
  iconBtnBlue: { color: 'info.main' },
  iconBtnRed: { color: 'error.main' },
  iconBtnWhite: { color: 'text.primary' },
  divider1: { mx: 0.5, borderColor: 'divider' },
  divider2: { mx: 1, borderColor: 'divider' },
  dialogTitle: { borderBottom: '1px solid', borderColor: 'divider', pb: 1 },
  dialogContent: { mt: 2, display: 'flex', flexDirection: 'column' as const, gap: 3 },
  dialogSubTitle: { mb: 1 },
  dmlBox: { display: 'flex', flexDirection: 'column' as const, gap: 2 },
  dmlHeader: { mb: 1, borderBottom: '1px solid', borderColor: 'divider', pb: 0.5 },
  dateInputWrapper: { display: 'flex', gap: 1, alignItems: 'center' },
  hiddenInput: { position: 'absolute' as const, width: 0, height: 0, opacity: 0, padding: 0, border: 0 },
  dialogActions: { p: 2, display: 'flex', flexDirection: 'column' as const, gap: 1, bgcolor: 'background.default' },
  dialogBtnGroup: { display: 'flex', justifyContent: 'flex-end', gap: 1 },
};

// Reuse object constants.
const CODE_SETUP = { lineNumbers: true, autocompletion: true };
const SOURCE_SETUP = { lineNumbers: true };
const SOURCE_EXTENSIONS = [sql()];
// Avoid editor renders when only surrounding UI changes and text, settings, and theme match.
const MemoCodeMirror = memo(CodeMirror);

// Memoize the settings form.
const TriggerConfigPanel = memo(({
  isLoading, canSave, canTrace, definitionReady, wizTriggerName, setWizTriggerName, isNew, handleDelete, handleTraceExecuteClick, handleCreateTrigger, onRequestAi,
  wizTargetObject, wizEvents, wizSchema, setWizSchema, schemaList, setWizTargetObject,
  wizTargetType, setWizTargetType, wizTiming, setWizTiming, handleEventChange, wizForEachRow, setWizForEachRow, t
}: Pick<ReturnType<typeof useTriggerWindow>, 'isLoading' | 'canSave' | 'canTrace' | 'definitionReady' | 'wizTriggerName' | 'setWizTriggerName' | 'handleDelete' | 'handleTraceExecuteClick' | 'handleCreateTrigger' | 'wizTargetObject' | 'wizEvents' | 'wizSchema' | 'setWizSchema' | 'schemaList' | 'setWizTargetObject' | 'wizTargetType' | 'setWizTargetType' | 'wizTiming' | 'setWizTiming' | 'handleEventChange' | 'wizForEachRow' | 'setWizForEachRow'> & { isNew: boolean; t: ReturnType<typeof useTranslation>['t']; onRequestAi: () => void }) => {
  return (
    <>
      <Box sx={styles.headerBox}>
        <Box sx={styles.headerLeft}>
          <Typography variant="subtitle2" fontWeight="bold">{t("trigger_settings_postgresql")}</Typography>
          <TextField label={t("trigger_name")} size="small" variant="outlined" sx={styles.nameInput} value={wizTriggerName} onChange={(e) => setWizTriggerName(e.target.value)} disabled={!isNew} />
        </Box>
        <Box sx={styles.headerActions}>
          {!isNew && (
            <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} disabled={isLoading || !definitionReady} disableElevation disableRipple>
              {t("delete")}
            </Button>
          )}
          {!isNew && (
            <Tooltip title={t("debug_and_trace_this_trigger")}>
              <span>
                <Button variant="outlined" color="secondary" startIcon={<AnalyticsIcon />} onClick={handleTraceExecuteClick} disabled={isLoading || !canTrace} sx={styles.traceBtn} disableRipple>
                  {t("trace_analysis_2")}
                </Button>
              </span>
            </Tooltip>
          )}
          <Button variant="contained" color="primary" startIcon={<SaveIcon />} onClick={handleCreateTrigger} disabled={isLoading || !canSave || !wizTriggerName || !wizTargetObject || wizEvents.length === 0} disableRipple>
            {isNew ? t("create") : t("change")}
          </Button>
          <Tooltip title={t("ask_ai_to_create_or_modify_a_trigger")}>
            <span><AiRequestButton disabled={isLoading || !canSave} onClick={onRequestAi} aria-label={t("ask_ai_to_create_or_modify_a_trigger")} /></span>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={styles.formContainer}>
        <Box sx={styles.col1}>
          <Box sx={styles.schemaObjectBox}>
            <FormControl size="small" sx={styles.schemaSelect}>
              <InputLabel>{t("schema")}</InputLabel>
              <Select value={wizSchema} label={t("schema")} onChange={(e) => setWizSchema(e.target.value as string)} disabled={!isNew}>
                {schemaList.map((s: string) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TriggerTargetPicker database="postgresql" schema={wizSchema} table={wizTargetObject} type={wizTargetType} disabled={isLoading || !isNew} onChange={setWizTargetObject} />
          </Box>
          <FormControl component="fieldset" disabled={!isNew}>
            <Typography variant="caption" sx={styles.radioLabel}>{t("target_type_2")}</Typography>
            <RadioGroup row value={wizTargetType} onChange={(e) => setWizTargetType(e.target.value as 'TABLE'|'VIEW')}>
              <FormControlLabel value="TABLE" control={<Radio size="small" disableRipple />} label={<Typography variant="body2">{t("table_2")}</Typography>} />
              <FormControlLabel value="VIEW" control={<Radio size="small" disableRipple />} label={<Typography variant="body2">{t("view_2")}</Typography>} />
            </RadioGroup>
          </FormControl>
          <FormControl component="fieldset" disabled={!isNew}>
            <Typography variant="caption" sx={styles.radioLabel}>{t("timing_2")}</Typography>
            <RadioGroup row value={wizTiming} onChange={(e) => setWizTiming(e.target.value as 'BEFORE'|'AFTER'|'INSTEAD OF')}>
              <FormControlLabel value="BEFORE" control={<Radio size="small" disableRipple />} label={<Typography variant="body2">{t("before")}</Typography>} disabled={!isNew || wizTargetType === 'VIEW'} />
              <FormControlLabel value="AFTER" control={<Radio size="small" disableRipple />} label={<Typography variant="body2">{t("after")}</Typography>} disabled={!isNew || wizTargetType === 'VIEW'} />
              {wizTargetType === 'VIEW' && <FormControlLabel value="INSTEAD OF" control={<Radio size="small" disableRipple />} label={<Typography variant="body2">{t("instead_of")}</Typography>} />}
            </RadioGroup>
          </FormControl>
        </Box>

        <Box sx={styles.col2}>
          <FormControl component="fieldset" disabled={!isNew}>
            <Typography variant="caption" sx={styles.radioLabel}>{t("target_events_multi_select")}</Typography>
            <FormGroup row>
              <FormControlLabel control={<Checkbox size="small" checked={wizEvents.includes('INSERT')} onChange={() => handleEventChange('INSERT')} disableRipple />} label={<Typography variant="body2">INSERT</Typography>} />
              <FormControlLabel control={<Checkbox size="small" checked={wizEvents.includes('UPDATE')} onChange={() => handleEventChange('UPDATE')} disableRipple />} label={<Typography variant="body2">UPDATE</Typography>} />
              <FormControlLabel control={<Checkbox size="small" checked={wizEvents.includes('DELETE')} onChange={() => handleEventChange('DELETE')} disableRipple />} label={<Typography variant="body2">DELETE</Typography>} />
              <FormControlLabel control={<Checkbox size="small" checked={wizEvents.includes('TRUNCATE')} onChange={() => handleEventChange('TRUNCATE')} disableRipple />} label={<Typography variant="body2">TRUNCATE</Typography>} disabled={wizTiming !== 'AFTER' && wizTiming !== 'BEFORE'} />
            </FormGroup>
          </FormControl>
        </Box>

        <Box sx={styles.col3}>
          <FormControlLabel control={<Checkbox checked={wizForEachRow} onChange={(e) => setWizForEachRow(e.target.checked)} disabled={!isNew || wizTargetType === 'VIEW' || wizEvents.includes('TRUNCATE')} disableRipple />} label={t("for_each_row")} />
          <Typography variant="caption" color="text.secondary">
            {t("postgres_trigger_implementation_help")}
          </Typography>
        </Box>
      </Box>
    </>
  );
});
TriggerConfigPanel.displayName = 'TriggerConfigPanel';

// Memoize the editor and console.
const TriggerEditorPane = memo(({
  isConsoleOpen, leftWidth, consoleLogs, setIsConsoleOpen, editorRef, wizBody, setWizBody,
  extensions, themeMode, handleConsoleClick, t, isBusy
}: Pick<ReturnType<typeof useTriggerWindow>, 'isConsoleOpen' | 'leftWidth' | 'consoleLogs' | 'setIsConsoleOpen' | 'editorRef' | 'wizBody' | 'setWizBody' | 'extensions' | 'handleConsoleClick'> & { themeMode: 'light' | 'dark'; t: ReturnType<typeof useTranslation>['t']; isBusy: boolean }) => {
  return (
    <>
      <Paper elevation={1} sx={styles.editorPaper(isConsoleOpen, leftWidth)}>
        <Box sx={styles.editorHeader}>
          <Typography variant="subtitle2" fontWeight="bold">{t("source_editor_trigger_function_body")}</Typography>
          {!isConsoleOpen && consoleLogs.length > 0 && (
            <Button size="small" onClick={() => setIsConsoleOpen(true)} color="error" sx={styles.errorBtn} disableRipple>
              {t("show_error_log")}
            </Button>
          )}
        </Box>
        <Box sx={styles.cmBox}>
          <MemoCodeMirror
            editable={!isBusy}
            ref={editorRef}
            value={wizBody}
            onChange={setWizBody}
            height="100%"
            style={SOURCE_HOST_STYLE}
            extensions={extensions}
            basicSetup={CODE_SETUP}
            theme={themeMode === 'dark' ? 'dark' : 'light'}
          />
        </Box>
      </Paper>

      {isConsoleOpen && (
        <Paper elevation={1} sx={styles.consolePaper}>
          <Box sx={styles.consoleHeader}>
            <Typography variant="caption" fontWeight="bold" sx={styles.consoleTitle}>{t("console_logs")}</Typography>
            <IconButton size="small" onClick={() => setIsConsoleOpen(false)} sx={styles.consoleClose} disableRipple>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box sx={styles.consoleContent}>
            {consoleLogs.length > 0 ? (
              consoleLogs.map((log: string, index: number) => {
                const isError = log.includes('[ERROR]');
                return (
                  <Typography
                    key={index}
                    variant="body2"
                    onClick={() => isError ? handleConsoleClick(log) : undefined}
                    sx={isError ? styles.logError : styles.logNormal}
                  >
                    {log}
                  </Typography>
                );
              })
            ) : (
              <Typography variant="body2" sx={{ ...styles.logNormal, ...styles.logEmpty }}>{t("no_output_2")}</Typography>
            )}
          </Box>
        </Paper>
      )}
    </>
  );
});
TriggerEditorPane.displayName = 'TriggerEditorPane';

// Memoize the source tab.
const TriggerSourcePane = memo(({ sourceText, themeMode, t }: { sourceText: string; themeMode: string; t: ReturnType<typeof useTranslation>['t'] }) => {
  return (
    <Box sx={styles.sourceMainBox}>
      <Paper elevation={1} sx={styles.sourcePaper}>
        <Box sx={styles.sourceHeader}>
          <Typography variant="subtitle2" fontWeight="bold">{t("create_trigger_statement_ddl")}</Typography>
          <Tooltip title={t("copy")}>
            <IconButton size="small" onClick={() => navigator.clipboard.writeText(sourceText)} disableRipple>
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        <Box sx={styles.cmBox}>
          <MemoCodeMirror
            value={sourceText}
            height="100%"
            style={SOURCE_HOST_STYLE}
            extensions={SOURCE_EXTENSIONS}
            readOnly={true}
            basicSetup={SOURCE_SETUP}
            theme={themeMode === 'dark' ? 'dark' : 'light'}
          />
        </Box>
      </Paper>
    </Box>
  );
});
TriggerSourcePane.displayName = 'TriggerSourcePane';

// Memoize the version control tab with stable props.
const TriggerVersionPane = memo(({
  schema, triggerName, tableName, sourceText, isLoading, onRefresh
}: {
  schema: string; triggerName: string; tableName: string; sourceText: string; isLoading: boolean; onRefresh: () => Promise<void>;
}) => {
  return (
    <Box sx={styles.sourceMainBox}>
      <Box sx={styles.versionControlPane}>
        <VersionControlTab
          dbType="POSTGRESQL"
          schema={schema}
          objectType="TRIGGER"
          objectName={triggerName}
          tableName={tableName}
          currentSource={sourceText}
          isSourceLoading={isLoading}
          onRefresh={onRefresh}
        />
      </Box>
    </Box>
  );
});
TriggerVersionPane.displayName = 'TriggerVersionPane';

interface ExtendedTriggerWindowProps extends TriggerWindowProps, StoredAiProps {
  monaStyle?: boolean;
}

export default function TriggerWindowPostgresql(props: ExtendedTriggerWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const {
    canSave, canTrace, definitionReady, overview, loadError, retryLoad,
    activeTab, setActiveTab, handleTabChange, isLoading: isDbLoading, isExecuting, sourceText,
    wizTriggerName, setWizTriggerName, wizSchema, setWizSchema,
    wizTargetType, setWizTargetType, wizTargetObject, setWizTargetObject,
    wizTiming, setWizTiming, wizEvents, setWizEvents, wizForEachRow, setWizForEachRow,
    wizBody, setWizBody, schemaList, structureDefs,
    isConsoleOpen, setIsConsoleOpen, consoleLogs,
    editorRef, topHeight, leftWidth, isResizingV, setIsResizingV, isResizingH, setIsResizingH, resizeRef,
    isTraceDialogOpen, setIsTraceDialogOpen, traceTargetDml, setTraceTargetDml, traceWhereClause, setTraceWhereClause,
    traceInputData, setTraceInputData, simulator, traceDateTime, triggerDisplaySql,
    procToTrgMap, trgToProcMap, isRightPanelOpen, setIsRightPanelOpen, traceRightTab, setTraceRightTab,
    anchorEl, setAnchorEl, menuLineNum, setMenuLineNum, groupedVariables,
    handleEventChange, handleDelete, handleCreateTrigger, handleTraceExecuteClick, handleStartTrace, handleConsoleClick, extensions, loadExistingData,
    traceArguments, traceConditions
  } = useTriggerWindow(props);

  const onAiStart = useCallback(() => { setActiveTab('edit'); simulator.clearSimulation(); }, [setActiveTab, simulator]);
  const applyAiSettings = useCallback((settings: TriggerAiSettings) => {
    if (!props.isNew) return;
    setWizTiming(settings.timing);
    setWizEvents(settings.events);
    setWizForEachRow(settings.forEachRow);
  }, [props.isNew, setWizTiming, setWizEvents, setWizForEachRow]);
  const ai = useTriggerAi({
    dbType: 'postgresql', schema: wizSchema, triggerName: wizTriggerName,
    targetName: wizTargetObject, targetType: wizTargetType,
    settings: JSON.stringify({ preserveTriggerSettings: !props.isNew, schema: wizSchema, triggerName: wizTriggerName, target: wizTargetObject,
      targetType: wizTargetType, timing: wizTiming, events: wizEvents, forEachRow: wizForEachRow }),
    body: wizBody, setBody: setWizBody, applySettings: applyAiSettings, isNew: props.isNew, isActive: props.isActive,
    isBusy: isDbLoading || !canSave, isAiEnabled: props.isAiEnabled, onOpenAiSidebar: props.onOpenAiSidebar,
    onStart: onAiStart
  });
  const aiTraceDebug = useAiTraceDebug({
    dbType: 'postgresql', schema: props.schema, objectName: props.triggerName, tableName: wizTargetObject || props.initialTable,
    objectType: 'TRIGGER', sourceText: triggerDisplaySql || wizBody,
    isAiEnabled: props.isAiEnabled, onOpenAiSidebar: props.onOpenAiSidebar
  });
  const isLoading = isDbLoading || ai.isGenerating || aiTraceDebug.isPreparing;

  // Mount each tab lazily once, then retain it in a hidden cache.
  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({ edit: true });

  useEffect(() => {
    if (!visitedTabs[activeTab]) {
      setVisitedTabs(prev => ({ ...prev, [activeTab]: true }));
    }
  }, [activeTab, visitedTabs]);

  if (!props.isActive) return null;

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox(props.isActive)}>
      {isLoading && !isExecuting && <WindowLoadingIndicator />}
      <Box sx={styles.tabsContainer}>
        <Tabs value={activeTab} onChange={handleTabChange} sx={styles.tabs} TabIndicatorProps={{ style: { transition: 'none' } }}>
          <Tab disabled={isLoading} label={props.isNew ? t("new") : t("edit")} value="edit" sx={styles.tabItem(false)} disableRipple />
          {!props.isNew && traceDateTime && <Tab disabled={isLoading} label={t("trace_analysis")} value="trace" sx={styles.tabItem(true)} disableRipple />}
          {!props.isNew && <Tab disabled={isLoading} label={t("source")} value="source" sx={styles.tabItem(false)} disableRipple />}
          {!props.isNew && <Tab disabled={isLoading} label={t("version_control")} value="version" sx={styles.tabItem(false)} disableRipple />}
        </Tabs>
      </Box>

      {/* Edit tab. */}
      <TriggerOverview data={overview} error={loadError} busy={isLoading} onRetry={() => { void retryLoad(); }} />
      <Box sx={styles.tabPane(activeTab === 'edit')}>
        <Box sx={styles.editMainBox}>
          <Paper elevation={1} sx={styles.topPanel(topHeight)}>
            <TriggerConfigPanel
              isLoading={isLoading}
              canSave={canSave} canTrace={canTrace} definitionReady={definitionReady}
              wizTriggerName={wizTriggerName}
              setWizTriggerName={setWizTriggerName}
              isNew={props.isNew}
              handleDelete={handleDelete}
              handleTraceExecuteClick={handleTraceExecuteClick}
              handleCreateTrigger={handleCreateTrigger}
              onRequestAi={ai.requestAi}
              wizTargetObject={wizTargetObject}
              wizEvents={wizEvents}
              wizSchema={wizSchema}
              setWizSchema={setWizSchema}
              schemaList={schemaList}
              setWizTargetObject={setWizTargetObject}
              wizTargetType={wizTargetType}
              setWizTargetType={setWizTargetType}
              wizTiming={wizTiming}
              setWizTiming={setWizTiming}
              handleEventChange={handleEventChange}
              wizForEachRow={wizForEachRow}
              setWizForEachRow={setWizForEachRow}
              t={t}
            />
          </Paper>

          <Box
            onMouseDown={(e) => { setIsResizingV(true); resizeRef.current = { ...resizeRef.current, startY: e.clientY, startHeight: topHeight }; }}
            sx={styles.vResizer(isResizingV)}
          >
            <Box sx={styles.vResizerInner(isResizingV)} />
          </Box>

          <Box sx={styles.bottomContainer}>
            <TriggerEditorPane
              isConsoleOpen={isConsoleOpen}
              leftWidth={leftWidth}
              consoleLogs={consoleLogs}
              setIsConsoleOpen={setIsConsoleOpen}
              editorRef={editorRef}
              wizBody={ai.displaySource}
              setWizBody={setWizBody}
              isBusy={isLoading || Boolean(overview?.readOnly)}
              extensions={extensions}
              themeMode={theme.palette.mode}
              handleConsoleClick={handleConsoleClick}
              t={t}
            />

            {isConsoleOpen && (
              <Box
                onMouseDown={(e) => { setIsResizingH(true); resizeRef.current = { ...resizeRef.current, startX: e.clientX, startWidth: leftWidth }; }}
                sx={styles.hResizer(isResizingH)}
              >
                <Box sx={styles.hResizerInner(isResizingH)} />
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Trace analysis tab. */}
      {!props.isNew && traceDateTime && visitedTabs['trace'] && (
        <Box sx={styles.tabPane(activeTab === 'trace')}>
          <Box sx={styles.traceMainBox}>
            <Box sx={styles.traceContainer}>
              <Paper elevation={1} sx={styles.traceLeftPaper(isRightPanelOpen, leftWidth)}>
                <Box sx={styles.traceToolbar}>
                  <Typography variant="caption" fontWeight="bold" sx={styles.consoleTitle}>{t("debug_area_trigger")}</Typography>

                  <Box sx={styles.traceActions}>
                    {(!simulator.isSimulating || simulator.currentStepIndex === -1) ?
                      <Tooltip title={t("debug_play_f8")}><span style={{ display: 'inline-flex' }}><IconButton size="small" onClick={() => simulator.handleSimulateStep('start')} disabled={simulator.executionSteps.length === 0} sx={styles.iconBtnGreen} disableRipple><PlayArrowIcon fontSize="small" /></IconButton></span></Tooltip> :
                      <Tooltip title={t("resume_f8")}><span style={{ display: 'inline-flex' }}><IconButton size="small" onClick={() => simulator.handleSimulateStep('resume')} sx={styles.iconBtnGreen} disableRipple><PlayCircleOutlineIcon fontSize="small" /></IconButton></span></Tooltip>
                    }
                    <Tooltip title={t("step_in_f11")}><span style={{ display: 'inline-flex' }}><IconButton size="small" onClick={() => simulator.handleSimulateStep('step_into')} disabled={!simulator.isSimulating} sx={styles.iconBtnBlue} disableRipple><SubdirectoryArrowRightIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Divider orientation="vertical" flexItem sx={styles.divider1} />
                    <Tooltip title={t("stop_shift_f5")}><span style={{ display: 'inline-flex' }}><IconButton size="small" onClick={() => simulator.handleSimulateStep('stop')} disabled={!simulator.isSimulating} sx={styles.iconBtnRed} disableRipple><StopIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title={t("ask_ai_to_analyze_the_full_trace")}><span>
                      <AiRequestButton onClick={aiTraceDebug.requestDebug} disabled={isLoading || simulator.executionSteps.length === 0} />
                    </span></Tooltip>
                    <Divider orientation="vertical" flexItem sx={styles.divider2} />
                    {!isRightPanelOpen && <Tooltip title={t("open_right_panel")}><span style={{ display: 'inline-flex' }}><IconButton size="small" onClick={() => setIsRightPanelOpen(true)} sx={styles.iconBtnWhite} disableRipple><ChevronLeftIcon fontSize="small" /></IconButton></span></Tooltip>}
                  </Box>
                </Box>

                <TraceDebugArea
                  sourceText={triggerDisplaySql}
                  simulator={simulator}
                  monaStyle={props.monaStyle}
                  isDarkTheme={theme.palette.mode === 'dark'}
                  isActiveTab={props.isActive && activeTab === 'trace'}
                  onContextMenu={(e, actualLineNum) => {
                    if (!simulator.breakpoints.includes(actualLineNum)) simulator.toggleBreakpoint(actualLineNum);
                    setMenuLineNum(actualLineNum);
                    setAnchorEl(e.currentTarget);
                  }}
                  highlightLine={highlightSql}
                  getActualLineNum={(displayLine) => trgToProcMap[displayLine] > 0 ? trgToProcMap[displayLine] : undefined}
                  getDisplayLineNum={(actualLine) => procToTrgMap[actualLine] > 0 ? procToTrgMap[actualLine] : undefined}
                />
              </Paper>

              {isRightPanelOpen && (
                <Box
                  onMouseDown={(e) => { setIsResizingH(true); resizeRef.current = { ...resizeRef.current, startX: e.clientX, startWidth: leftWidth }; }}
                  sx={styles.hResizer(isResizingH)}
                >
                  <Box sx={styles.hResizerInner(isResizingH)} />
                </Box>
              )}

              {isRightPanelOpen && (
                <SharedRightPanel
                  mainTab={1}
                  traceRightTab={traceRightTab}
                  setTraceRightTab={setTraceRightTab}
                  setIsRightPanelOpen={setIsRightPanelOpen}
                  argumentsList={[]}
                  argValues={{}}
                  setArgValues={() => {}}
                  traceDateTime={traceDateTime}
                  traceArguments={traceArguments}
                  traceConditions={traceConditions}
                  simulator={simulator}
                  groupedVariables={groupedVariables}
                  outputDateFormat={props.outputDateFormat}
                  inputDateFormat={props.inputDateFormat}
                />
              )}
            </Box>

            <BreakpointConditionPopover anchorEl={anchorEl} menuLineNum={menuLineNum} simulator={simulator} onClose={() => { setAnchorEl(null); setMenuLineNum(null); }} />
          </Box>
        </Box>
      )}

      {/* Source tab rendered by the memoized TriggerSourcePane. */}
      {!props.isNew && visitedTabs['source'] && (
        <Box sx={styles.tabPane(activeTab === 'source')}>
          <TriggerSourcePane
            sourceText={sourceText}
            themeMode={theme.palette.mode}
            t={t}
          />
        </Box>
      )}

      {/* Version control tab rendered by the memoized TriggerVersionPane. */}
      {!props.isNew && visitedTabs['version'] && (
        <Box sx={styles.tabPane(activeTab === 'version')}>
          <TriggerVersionPane
            tableName={wizTargetObject || props.initialTable || ''}
            schema={wizSchema}
            triggerName={wizTriggerName}
            sourceText={sourceText}
            isLoading={isLoading}
            onRefresh={loadExistingData}
          />
        </Box>
      )}

      <Dialog
        open={isTraceDialogOpen}
        onClose={(_e, reason) => {
          if (reason === 'backdropClick') return;
          setIsTraceDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={styles.dialogTitle}>
          {t("trigger_trace_analysis_settings")}
          <Typography variant="body2" color="text.secondary">
            {t("target_2")} {wizSchema}.{wizTargetObject}
          </Typography>
        </DialogTitle>
        <DialogContent sx={styles.dialogContent}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('trigger_trace_body_only_notice')}
          </Typography>
          <FormControl component="fieldset">
            <Typography variant="subtitle2" fontWeight="bold" sx={styles.dialogSubTitle}>{t("operation_to_simulate")}</Typography>
            <RadioGroup row value={traceTargetDml} onChange={(e) => setTraceTargetDml(e.target.value as typeof traceTargetDml)}>
              <FormControlLabel value="INSERT" control={<Radio disableRipple />} label="INSERT" disabled={!wizEvents.includes('INSERT')} />
              <FormControlLabel value="UPDATE" control={<Radio disableRipple />} label="UPDATE" disabled={!wizEvents.includes('UPDATE')} />
              <FormControlLabel value="DELETE" control={<Radio disableRipple />} label="DELETE" disabled={!wizEvents.includes('DELETE')} />
              <FormControlLabel value="TRUNCATE" control={<Radio disableRipple />} label="TRUNCATE" disabled={!wizEvents.includes('TRUNCATE')} />
            </RadioGroup>
          </FormControl>

          {(traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE') && (
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" sx={styles.dialogSubTitle}>{t("target_record_condition")} (OLD{t("value_retriever")})</Typography>
              <TextField
                fullWidth
                variant="outlined"
                size="small"
                placeholder={t("e_g_id_100")}
                value={traceWhereClause}
                onChange={(e) => setTraceWhereClause(e.target.value)}
                helperText={t("trigger_where_clause_old_help")}
              />
            </Box>
          )}

          {(traceTargetDml === 'INSERT' || traceTargetDml === 'UPDATE') && (
            <Box sx={styles.dmlBox}>
              <Typography variant="subtitle2" fontWeight="bold" sx={styles.dmlHeader}>
                {traceTargetDml === 'INSERT' ? t("value_to_insert") : t("value_to_update")} (NEW{t("value")})
              </Typography>

              {structureDefs.map(col => {
                 const isDateTime = col.DATA_TYPE.includes('date') || col.DATA_TYPE.includes('timestamp');
                 return (
                  <Box key={col.COLUMN_NAME}>
                    {isDateTime ? (
                      <Box sx={styles.dateInputWrapper}>
                        <TextField
                          label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${traceTargetDml === 'INSERT' && col.NULLABLE === 'N' ? t("required") : ''})`}
                          size="small" fullWidth variant="outlined" type="text"
                          placeholder={t("e_g") + (props.inputDateFormat || DEFAULT_DATE_FORMAT)}
                          value={traceInputData[col.COLUMN_NAME] || ''}
                          onChange={(e) => setTraceInputData({ ...traceInputData, [col.COLUMN_NAME]: e.target.value })}
                        />
                        <Box sx={{ position: 'relative', display: 'flex' }}>
                          <Tooltip title={t("select_from_calendar")}>
                            <IconButton
                              color="primary"
                              onClick={(e) => {
                                const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                                if (input && typeof input.showPicker === 'function') input.showPicker();
                                else if (input) input.focus();
                              }}
                              disableRipple
                            >
                              <CalendarTodayIcon />
                            </IconButton>
                          </Tooltip>
                          <input
                            type={props.inputDateFormat?.match(/H|h|m|s/) ? "datetime-local" : "date"}
                            step="1"
                            style={styles.hiddenInput}
                            onChange={(e) => {
                              if (e.target.value) {
                                const targetFmt = props.inputDateFormat || DEFAULT_DATE_FORMAT;
                                const dateObj = new Date(e.target.value);
                                const formatted = formatDateString(dateObj, targetFmt);
                                setTraceInputData({ ...traceInputData, [col.COLUMN_NAME]: formatted });
                                e.target.value = '';
                              }
                            }}
                          />
                        </Box>
                      </Box>
                    ) : (
                      <TextField
                        label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${traceTargetDml === 'INSERT' && col.NULLABLE === 'N' ? t("required") : ''})`}
                        size="small" fullWidth variant="outlined" type="text"
                        value={traceInputData[col.COLUMN_NAME] || ''}
                        onChange={(e) => setTraceInputData({ ...traceInputData, [col.COLUMN_NAME]: e.target.value })}
                      />
                    )}
                  </Box>
                 );
              })}
            </Box>
          )}

          {traceTargetDml === 'TRUNCATE' && (
            <Box>
              <Typography variant="body2" color="text.secondary">
                {t("truncate_trigger_condition_help")}
              </Typography>
            </Box>
          )}

        </DialogContent>
        <Divider />
        <Box sx={styles.dialogActions}>
          <Box sx={styles.dialogBtnGroup}>
            <Button onClick={() => setIsTraceDialogOpen(false)} disableRipple>{t("cancel")}</Button>
            <Button variant="contained" color="secondary" startIcon={<AnalyticsIcon />} onClick={handleStartTrace} disabled={isLoading} disableRipple>
              {t("start_trace_analysis")}
            </Button>
          </Box>
        </Box>
      </Dialog>
    </Box>
  );
}
