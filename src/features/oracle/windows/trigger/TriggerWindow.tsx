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
import React, { memo, useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Typography, Tabs, Tab, IconButton, Tooltip,
  TextField, FormControl, InputLabel, Select, MenuItem, RadioGroup, FormControlLabel, Radio,
  Checkbox, FormGroup, Button, Dialog, DialogTitle, DialogContent, Divider
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SaveIcon from '@mui/icons-material/Save';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import StopIcon from '@mui/icons-material/Stop';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';

import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';

import VersionControlTab from "@/features/git/VersionControlTab";
import { SharedRightPanel, BreakpointConditionPopover } from "@/features/stored/StoredCommonUI";
import { TraceDebugArea } from "@/features/stored/TraceDebugArea"; // Import shared components.
import { useTriggerWindow, type TriggerWindowProps } from './useTriggerWindow';
import { formatDateString, DEFAULT_DATE_FORMAT } from "@/shared/utils/dateFormatter";

import { highlightSql } from '../common/sqlHighlighter';

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
  tabPane: (visible: boolean) => ({ minWidth: 0, flexGrow: 1, display: visible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 }),
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
  aliasBox: { display: 'flex', gap: 1 },
  vResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  vResizerInner: () => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomContainer: { flexGrow: 1, display: 'flex', overflow: 'hidden', gap: 0, minHeight: 0 },
  editorPaper: (isConsoleOpen: boolean, leftWidth: number) => ({ width: isConsoleOpen ? leftWidth : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, bgcolor: 'background.paper' }),
  editorHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  errorBtn: { py: 0 },
  cmBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  hResizer: (isResizing: boolean) => ({ width: 8, cursor: 'col-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', mx: 1, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  hResizerInner: () => ({ height: 40, width: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  consolePaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: '#1e1e1e', minHeight: 0 },
  consoleHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 0.5, bgcolor: '#333', color: '#fff' },
  consoleTitle: { ml: 1 },
  consoleClose: { color: '#ccc', p: 0.5 },
  consoleContent: { flexGrow: 1, overflowY: 'auto' as const, color: '#d4d4d4', p: 1, fontFamily: 'monospace', fontSize: '0.85rem' },
  logError: { color: '#f48771', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } },
  logNormal: { color: '#d4d4d4', cursor: 'default' },
  logEmpty: { fontStyle: 'italic' },
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
  sourceMainBox: { minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', p: 1, height: '100%', minHeight: 0 },
  sourcePaper: { minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, bgcolor: 'background.paper' },
  sourceHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between' },
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

const codeSetup = { lineNumbers: true, autocompletion: true };
const sourceSetup = { lineNumbers: true };
const sourceExtensions = [sql()];
// Avoid editor renders when only surrounding UI changes and text, settings, and theme match.
const MemoCodeMirror = memo(CodeMirror);

type TriggerState = ReturnType<typeof useTriggerWindow>;
type Translate = ReturnType<typeof useTranslation>['t'];

type TriggerConfigPanelProps = Pick<TriggerState,
  'isLoading'
  | 'canSave'
  | 'canTrace'
  | 'definitionReady'
  | 'wizTriggerName'
  | 'setWizTriggerName'
  | 'handleDelete'
  | 'handleTraceExecuteClick'
  | 'handleCreateTrigger'
  | 'wizSchema'
  | 'setWizSchema'
  | 'schemaList'
  | 'wizTargetObject'
  | 'setWizTargetObject'
  | 'wizTargetType'
  | 'setWizTargetType'
  | 'wizTiming'
  | 'setWizTiming'
  | 'wizEvents'
  | 'handleEventChange'
  | 'wizUpdateCols'
  | 'setWizUpdateCols'
  | 'columnList'
  | 'wizAliasNew'
  | 'setWizAliasNew'
  | 'wizAliasOld'
  | 'setWizAliasOld'
  | 'wizForEachRow'
  | 'setWizForEachRow'
> & { t: Translate; isNew: boolean; onRequestAi: () => void };

const TriggerConfigPanel = memo(function TriggerConfigPanel({
  isLoading, canSave, canTrace, definitionReady,
  wizTriggerName,
  setWizTriggerName,
  handleDelete,
  handleTraceExecuteClick,
  handleCreateTrigger,
  onRequestAi,
  wizSchema,
  setWizSchema,
  schemaList,
  wizTargetObject,
  setWizTargetObject,
  wizTargetType,
  setWizTargetType,
  wizTiming,
  setWizTiming,
  wizEvents,
  handleEventChange,
  wizUpdateCols,
  setWizUpdateCols,
  columnList,
  wizAliasNew,
  setWizAliasNew,
  wizAliasOld,
  setWizAliasOld,
  wizForEachRow,
  setWizForEachRow,
  t,
  isNew,
}: TriggerConfigPanelProps) {
  return (
    <>

      <Box sx={styles.headerBox}>
        <Box sx={styles.headerLeft}>
          <Typography variant="subtitle2" fontWeight="bold">{t("trigger_settings")}</Typography>
          <TextField label={t("trigger_name")} size="small" variant="outlined" sx={styles.nameInput} value={wizTriggerName} onChange={(e) => setWizTriggerName(e.target.value.toUpperCase())} disabled={!isNew} />
        </Box>
        <Box sx={styles.headerActions}>
          {!isNew && (
            <Button disableRipple variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} disabled={isLoading || !definitionReady} disableElevation>
              {t("delete")}
            </Button>
          )}
          {!isNew && (
            <Tooltip title={t("debug_and_trace_this_trigger")}>
              <span>
                <Button disableRipple variant="outlined" color="secondary" startIcon={<AnalyticsIcon />} onClick={handleTraceExecuteClick} disabled={isLoading || !canTrace} sx={styles.traceBtn}>
                  {t("trace_analysis_2")}
                </Button>
              </span>
            </Tooltip>
          )}
          <Button disableRipple variant="contained" color="primary" startIcon={<SaveIcon />} onClick={handleCreateTrigger} disabled={isLoading || !canSave || !wizTriggerName || !wizTargetObject || wizEvents.length === 0}>
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
                {schemaList.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TriggerTargetPicker database="oracle" schema={wizSchema} table={wizTargetObject} type={wizTargetType} disabled={isLoading || !isNew} onChange={setWizTargetObject} />
          </Box>
          <FormControl component="fieldset" disabled={!isNew}>
            <Typography variant="caption" sx={styles.radioLabel}>{t("target_type_2")}</Typography>
            <RadioGroup row value={wizTargetType} onChange={(e) => setWizTargetType(e.target.value as 'TABLE'|'VIEW')}>
              <FormControlLabel value="TABLE" control={<Radio disableRipple size="small" />} label={<Typography variant="body2">{t("table_2")}</Typography>} />
              <FormControlLabel value="VIEW" control={<Radio disableRipple size="small" />} label={<Typography variant="body2">{t("view_2")}</Typography>} />
            </RadioGroup>
          </FormControl>
          <FormControl component="fieldset" disabled={!isNew}>
            <Typography variant="caption" sx={styles.radioLabel}>{t("timing_2")}</Typography>
            <RadioGroup row value={wizTiming} onChange={(e) => setWizTiming(e.target.value as 'BEFORE'|'AFTER'|'INSTEAD OF')}>
              <FormControlLabel value="BEFORE" control={<Radio disableRipple size="small" />} label={<Typography variant="body2">{t("before")}</Typography>} disabled={!isNew || wizTargetType === 'VIEW'} />
              <FormControlLabel value="AFTER" control={<Radio disableRipple size="small" />} label={<Typography variant="body2">{t("after")}</Typography>} disabled={!isNew || wizTargetType === 'VIEW'} />
              {wizTargetType === 'VIEW' && <FormControlLabel value="INSTEAD OF" control={<Radio disableRipple size="small" />} label={<Typography variant="body2">{t("instead_of")}</Typography>} />}
            </RadioGroup>
          </FormControl>
        </Box>

        <Box sx={styles.col2}>
          <FormControl component="fieldset" disabled={!isNew}>
            <Typography variant="caption" sx={styles.radioLabel}>{t("target_events_multi_select")}</Typography>
            <FormGroup row>
              <FormControlLabel control={<Checkbox disableRipple size="small" checked={wizEvents.includes('INSERT')} onChange={() => handleEventChange('INSERT')} />} label={<Typography variant="body2">INSERT</Typography>} />
              <FormControlLabel control={<Checkbox disableRipple size="small" checked={wizEvents.includes('UPDATE')} onChange={() => handleEventChange('UPDATE')} />} label={<Typography variant="body2">UPDATE</Typography>} />
              <FormControlLabel control={<Checkbox disableRipple size="small" checked={wizEvents.includes('DELETE')} onChange={() => handleEventChange('DELETE')} />} label={<Typography variant="body2">DELETE</Typography>} />
            </FormGroup>
          </FormControl>
          <FormControl size="small" fullWidth disabled={!isNew || !wizEvents.includes('UPDATE')}>
            <InputLabel>{t("update_target_columns_leave_empty_for_all_columns")}</InputLabel>
            <Select multiple value={wizUpdateCols} onChange={(e) => setWizUpdateCols(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value as string[])} label={t("update_target_columns_leave_empty_for_all_columns")} renderValue={(selected) => (selected as string[]).join(', ')}>
              {columnList.map(c => <MenuItem key={c} value={c}><Checkbox disableRipple checked={wizUpdateCols.indexOf(c) > -1} />{c}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        <Box sx={styles.col3}>
          <Box sx={styles.aliasBox}>
            <TextField label={t("alias_new_2")} size="small" variant="outlined" fullWidth disabled={!isNew} value={wizAliasNew} onChange={(e) => setWizAliasNew(e.target.value.toUpperCase())} />
            <TextField label={t("alias_old_2")} size="small" variant="outlined" fullWidth disabled={!isNew} value={wizAliasOld} onChange={(e) => setWizAliasOld(e.target.value.toUpperCase())} />
          </Box>
          <FormControlLabel control={<Checkbox disableRipple checked={wizForEachRow} onChange={(e) => setWizForEachRow(e.target.checked)} disabled={!isNew || wizTargetType === 'VIEW'} />} label={t("for_each_row")} />
        </Box>
      </Box>
    </>
  );
});

type TriggerEditorPaneProps = Pick<TriggerState,
  'isConsoleOpen'
  | 'leftWidth'
  | 'consoleLogs'
  | 'setIsConsoleOpen'
  | 'editorRef'
  | 'wizBody'
  | 'setWizBody'
  | 'extensions'
> & { t: Translate; themeMode: string; isBusy: boolean };

const TriggerEditorPane = memo(function TriggerEditorPane({
  isConsoleOpen,
  leftWidth,
  consoleLogs,
  setIsConsoleOpen,
  editorRef,
  wizBody,
  setWizBody,
  extensions,
  t,
  themeMode,
  isBusy,
}: TriggerEditorPaneProps) {
  return (
    <Paper elevation={1} sx={styles.editorPaper(isConsoleOpen, leftWidth)}>
      <Box sx={styles.editorHeader}>
        <Typography variant="subtitle2" fontWeight="bold">{t("source_editor")}</Typography>
        {!isConsoleOpen && consoleLogs.length > 0 && <Button disableRipple size="small" onClick={() => setIsConsoleOpen(true)} color="error" sx={styles.errorBtn}>{t("show_error_log")}</Button>}
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
          basicSetup={codeSetup}
          theme={themeMode === 'dark' ? 'dark' : 'light'}
        />
      </Box>
    </Paper>
  );
});

type TriggerConsolePaneProps = Pick<TriggerState,
  'consoleLogs'
  | 'setIsConsoleOpen'
  | 'handleConsoleClick'
> & { t: Translate };

const TriggerConsolePane = memo(function TriggerConsolePane({
  consoleLogs,
  setIsConsoleOpen,
  handleConsoleClick,
  t,
}: TriggerConsolePaneProps) {
  return (
    <Paper elevation={1} sx={styles.consolePaper}>
       <Box sx={styles.consoleHeader}>
           <Typography variant="caption" fontWeight="bold" sx={styles.consoleTitle}>{t("console_logs")}</Typography>
           <IconButton disableRipple size="small" onClick={() => setIsConsoleOpen(false)} sx={styles.consoleClose}><CloseIcon fontSize="small" /></IconButton>
       </Box>
       <Box sx={styles.consoleContent}>
           {consoleLogs.length > 0 ? (
               consoleLogs.map((log, index) => {
                 const isError = log.includes('[ERROR]');
                 return <Typography key={index} variant="body2" onClick={() => isError ? handleConsoleClick(log) : undefined} sx={isError ? styles.logError : styles.logNormal}>{log}</Typography>;
               })
           ) : <Typography variant="body2" sx={{ ...styles.logNormal, ...styles.logEmpty }}>{t("no_output_2")}</Typography>}
       </Box>
    </Paper>
  );
});

type TriggerSourcePaneProps = Pick<TriggerState,
  'sourceText'
> & { t: Translate; themeMode: string };

const TriggerSourcePane = memo(function TriggerSourcePane({
  sourceText,
  t,
  themeMode,
}: TriggerSourcePaneProps) {
  return (
    <Box sx={styles.sourceMainBox}>
      <Paper elevation={1} sx={styles.sourcePaper}>
        <Box sx={styles.sourceHeader}>
          <Typography variant="subtitle2" fontWeight="bold">{t("create_trigger_statement_ddl")}</Typography>
          <Tooltip title={t("copy")}><IconButton disableRipple size="small" onClick={() => navigator.clipboard.writeText(sourceText)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
        </Box>
        <Box sx={styles.cmBox}>
          <MemoCodeMirror
            value={sourceText}
            height="100%"
            style={SOURCE_HOST_STYLE}
            extensions={sourceExtensions}
            readOnly={true}
            basicSetup={sourceSetup}
            theme={themeMode === 'dark' ? 'dark' : 'light'}
          />
        </Box>
      </Paper>
    </Box>
  );
});

const TriggerVersionPane = memo(function TriggerVersionPane({
  schema,
  triggerName,
  sourceText,
  isLoading,
  onRefresh,
}: { schema: string; triggerName: string; sourceText: string; isLoading: boolean; onRefresh: () => Promise<void> }) {
  return (
    <Box sx={styles.sourceMainBox}>
      <VersionControlTab dbType="ORACLE" schema={schema} objectType="TRIGGER"
        objectName={triggerName} currentSource={sourceText} isSourceLoading={isLoading} onRefresh={onRefresh} />
    </Box>
  );
});

const EMPTY_ARGUMENTS: React.ComponentProps<typeof SharedRightPanel>['argumentsList'] = [];
const EMPTY_VALUES = {};
const ignoreArgValues = () => {};

type TriggerTracePaneProps = Pick<TriggerState,
  'isRightPanelOpen'
  | 'leftWidth'
  | 'simulator'
  | 'setIsRightPanelOpen'
  | 'triggerDisplaySql'
  | 'trgToProcMap'
  | 'procToTrgMap'
  | 'setMenuLineNum'
  | 'setAnchorEl'
  | 'isResizingH'
  | 'setIsResizingH'
  | 'resizeRef'
  | 'traceRightTab'
  | 'setTraceRightTab'
  | 'traceDateTime'
  | 'traceArguments'
  | 'traceConditions'
  | 'groupedVariables'
  | 'anchorEl'
  | 'menuLineNum'
> & { monaStyle?: boolean; isDarkTheme: boolean; isActiveTab: boolean; outputDateFormat?: string; inputDateFormat?: string; t: Translate; onRequestDebug: () => void; isDebugDisabled: boolean };

const TriggerTracePane = memo(function TriggerTracePane({
  isRightPanelOpen,
  leftWidth,
  simulator,
  setIsRightPanelOpen,
  triggerDisplaySql,
  trgToProcMap,
  procToTrgMap,
  setMenuLineNum,
  setAnchorEl,
  isResizingH,
  setIsResizingH,
  resizeRef,
  traceRightTab,
  setTraceRightTab,
  traceDateTime,
  traceArguments,
  traceConditions,
  groupedVariables,
  anchorEl,
  menuLineNum,
  monaStyle,
  isDarkTheme,
  isActiveTab,
  outputDateFormat,
  inputDateFormat,
  onRequestDebug,
  isDebugDisabled,
  t,
}: TriggerTracePaneProps) {
  const getActualLineNum = useCallback((displayLine: number) =>
    trgToProcMap[displayLine] > 0 ? trgToProcMap[displayLine] : undefined, [trgToProcMap]);
  const getDisplayLineNum = useCallback((actualLine: number) =>
    procToTrgMap[actualLine] > 0 ? procToTrgMap[actualLine] : undefined, [procToTrgMap]);

  return (
    <Box sx={styles.traceMainBox}>
      <Box sx={styles.traceContainer}>
        <Paper elevation={1} sx={styles.traceLeftPaper(isRightPanelOpen, leftWidth)}>

          <Box sx={styles.traceToolbar}>
            <Typography variant="caption" fontWeight="bold" sx={styles.consoleTitle}>{t("debug_area_trigger")}</Typography>

            <Box sx={styles.traceActions}>
              {(!simulator.isSimulating || simulator.currentStepIndex === -1) ?
                <Tooltip title={t("debug_play_f8")}><span><IconButton disableRipple size="small" onClick={() => simulator.handleSimulateStep('start')} disabled={simulator.executionSteps.length === 0} sx={styles.iconBtnGreen}><PlayArrowIcon fontSize="small" /></IconButton></span></Tooltip> :
                <Tooltip title={t("resume_f8")}><span><IconButton disableRipple size="small" onClick={() => simulator.handleSimulateStep('resume')} sx={styles.iconBtnGreen}><PlayCircleOutlineIcon fontSize="small" /></IconButton></span></Tooltip>
              }
              <Tooltip title={t("step_in_f11")}><span><IconButton disableRipple size="small" onClick={() => simulator.handleSimulateStep('step_into')} disabled={!simulator.isSimulating} sx={styles.iconBtnBlue}><SubdirectoryArrowRightIcon fontSize="small" /></IconButton></span></Tooltip>
              <Divider orientation="vertical" flexItem sx={styles.divider1} />
              <Tooltip title={t("stop_shift_f5")}><span><IconButton disableRipple size="small" onClick={() => simulator.handleSimulateStep('stop')} disabled={!simulator.isSimulating} sx={styles.iconBtnRed}><StopIcon fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title={t("ask_ai_to_analyze_the_full_trace")}><span>
                <AiRequestButton onClick={onRequestDebug} disabled={isDebugDisabled || simulator.executionSteps.length === 0} />
              </span></Tooltip>
              <Divider orientation="vertical" flexItem sx={styles.divider2} />
              {!isRightPanelOpen && <Tooltip title={t("open_right_panel")}><span><IconButton disableRipple size="small" onClick={() => setIsRightPanelOpen(true)} sx={styles.iconBtnWhite}><ChevronLeftIcon fontSize="small" /></IconButton></span></Tooltip>}
            </Box>
          </Box>

          {/* Use the shared debug component with trigger-specific line mapping. */}
          <TraceDebugArea
            sourceText={triggerDisplaySql}
            simulator={simulator}
            monaStyle={monaStyle}
            isDarkTheme={isDarkTheme}
            isActiveTab={isActiveTab}
            onContextMenu={(e, actualLineNum) => {
              if (!simulator.breakpoints.includes(actualLineNum)) simulator.toggleBreakpoint(actualLineNum);
              setMenuLineNum(actualLineNum);
              setAnchorEl(e.currentTarget);
            }}
            highlightLine={highlightSql}
            getActualLineNum={getActualLineNum}
            getDisplayLineNum={getDisplayLineNum}
          />

        </Paper>

        {isRightPanelOpen && (
          <Box
            onMouseDown={(e) => { setIsResizingH(true); resizeRef.current = { ...resizeRef.current, startX: e.clientX, startWidth: leftWidth }; }}
            sx={styles.hResizer(isResizingH)}
          >
            <Box sx={styles.hResizerInner()} />
          </Box>
        )}

        {isRightPanelOpen && (
          <SharedRightPanel
            mainTab={1}
            traceRightTab={traceRightTab}
            setTraceRightTab={setTraceRightTab}
            setIsRightPanelOpen={setIsRightPanelOpen}
            argumentsList={EMPTY_ARGUMENTS}
            argValues={EMPTY_VALUES}
            setArgValues={ignoreArgValues}
            traceDateTime={traceDateTime}
            traceArguments={traceArguments}
            traceConditions={traceConditions}
            simulator={simulator}
            groupedVariables={groupedVariables}
            outputDateFormat={outputDateFormat}
            inputDateFormat={inputDateFormat}
          />
        )}
      </Box>

      <BreakpointConditionPopover anchorEl={anchorEl} menuLineNum={menuLineNum} simulator={simulator} onClose={() => { setAnchorEl(null); setMenuLineNum(null); }} />
    </Box>
  );
});

interface ExtendedTriggerWindowProps extends TriggerWindowProps, StoredAiProps {
  monaStyle?: boolean;
}

function TriggerWindow(props: ExtendedTriggerWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const {
    canSave, canTrace, definitionReady, overview, loadError, retryLoad,
    activeTab, setActiveTab, isLoading: isDbLoading, isExecuting, sourceText,
    wizTriggerName, setWizTriggerName, wizSchema, setWizSchema,
    wizTargetType, setWizTargetType, wizTargetObject, setWizTargetObject,
    wizTiming, setWizTiming, wizEvents, setWizEvents, wizUpdateCols, setWizUpdateCols,
    wizAliasNew, setWizAliasNew, wizAliasOld, setWizAliasOld, wizForEachRow, setWizForEachRow,
    wizBody, setWizBody, schemaList, columnList, structureDefs,
    isConsoleOpen, setIsConsoleOpen, consoleLogs,
    editorRef, topHeight, leftWidth, isResizingV, setIsResizingV, isResizingH, setIsResizingH, resizeRef,
    isTraceDialogOpen, setIsTraceDialogOpen, traceTargetDml, setTraceTargetDml, traceWhereClause, setTraceWhereClause,
    traceInputData, setTraceInputData, simulator, traceDateTime, triggerDisplaySql,
    procToTrgMap, trgToProcMap, isRightPanelOpen, setIsRightPanelOpen, traceRightTab, setTraceRightTab,
    anchorEl, setAnchorEl, menuLineNum, setMenuLineNum, displayAliasNew, displayAliasOld, groupedVariables,
    handleEventChange, handleDelete, handleCreateTrigger, handleTraceExecuteClick, handleStartTrace, handleConsoleClick, extensions,
    traceArguments, traceConditions, loadExistingData
  } = useTriggerWindow(props);

  const onAiStart = useCallback(() => { setActiveTab('edit'); simulator.clearSimulation(); }, [setActiveTab, simulator]);
  const applyAiSettings = useCallback((settings: TriggerAiSettings) => {
    if (!props.isNew) return;
    setWizTiming(settings.timing);
    setWizEvents(settings.events);
    setWizForEachRow(settings.forEachRow);
  }, [props.isNew, setWizTiming, setWizEvents, setWizForEachRow]);
  const ai = useTriggerAi({
    dbType: 'oracle', schema: wizSchema, triggerName: wizTriggerName,
    targetName: wizTargetObject, targetType: wizTargetType,
    settings: JSON.stringify({ preserveTriggerSettings: !props.isNew, schema: wizSchema, triggerName: wizTriggerName, target: wizTargetObject,
      targetType: wizTargetType, timing: wizTiming, events: wizEvents, updateColumns: wizUpdateCols,
      aliasNew: wizAliasNew, aliasOld: wizAliasOld, forEachRow: wizForEachRow }),
    body: wizBody, setBody: setWizBody, applySettings: applyAiSettings, isNew: props.isNew, isActive: props.isActive,
    isBusy: isDbLoading || !canSave, isAiEnabled: props.isAiEnabled, onOpenAiSidebar: props.onOpenAiSidebar,
    onStart: onAiStart
  });
  const aiTraceDebug = useAiTraceDebug({
    dbType: 'oracle', schema: props.schema, objectName: props.triggerName,
    objectType: 'TRIGGER', sourceText: triggerDisplaySql || wizBody,
    traceObjectName: `TRG_TRACE_TRG_${props.triggerName.replace(/[^a-zA-Z0-9_]/g, '').substring(0, 15)}`.toUpperCase(),
    isAiEnabled: props.isAiEnabled, onOpenAiSidebar: props.onOpenAiSidebar
  });
  const isLoading = isDbLoading || ai.isGenerating || aiTraceDebug.isPreparing;

  const [visitedTabs, setVisitedTabs] = useState<Record<string, boolean>>({ edit: true });
  useEffect(() => {
    if (activeTab === 'trace') {
      setVisitedTabs(previous => previous.trace ? previous : { ...previous, trace: true });
    }
  }, [activeTab]);
  const handleTabChange = (_: React.SyntheticEvent, value: string) => {
    setVisitedTabs(previous => previous[value] ? previous : { ...previous, [value]: true });
    setActiveTab(value);
  };

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox(props.isActive)}>
      {isLoading && !isExecuting && <WindowLoadingIndicator />}
      <Box sx={styles.tabsContainer}>
        <Tabs value={activeTab} onChange={handleTabChange} sx={styles.tabs} TabIndicatorProps={{ style: { transition: 'none' } }}>
          <Tab disabled={isLoading} disableRipple label={props.isNew ? t("new") : t("edit")} value="edit" sx={styles.tabItem(false)} />
          {!props.isNew && traceDateTime && <Tab disabled={isLoading} disableRipple label={t("trace_analysis")} value="trace" sx={styles.tabItem(true)} />}
          {!props.isNew && <Tab disabled={isLoading} disableRipple label={t("source")} value="source" sx={styles.tabItem(false)} />}
          {!props.isNew && <Tab disabled={isLoading} disableRipple label={t("version_control")} value="version" sx={styles.tabItem(false)} />}
        </Tabs>
      </Box>

      {/* ============================================================ */}
      {/* Edit / create tab. */}
      {/* ============================================================ */}
      <TriggerOverview data={overview} error={loadError} busy={isLoading} onRetry={() => { void retryLoad(); }} />
      <Box sx={styles.tabPane(activeTab === 'edit')}>
        <Box sx={styles.editMainBox}>
          <Paper elevation={1} sx={styles.topPanel(topHeight)}>
            <TriggerConfigPanel
              isLoading={isLoading}
              canSave={canSave} canTrace={canTrace} definitionReady={definitionReady}
              wizTriggerName={wizTriggerName}
              setWizTriggerName={setWizTriggerName}
              handleDelete={handleDelete}
              handleTraceExecuteClick={handleTraceExecuteClick}
              handleCreateTrigger={handleCreateTrigger}
              onRequestAi={ai.requestAi}
              wizSchema={wizSchema}
              setWizSchema={setWizSchema}
              schemaList={schemaList}
              wizTargetObject={wizTargetObject}
              setWizTargetObject={setWizTargetObject}
              wizTargetType={wizTargetType}
              setWizTargetType={setWizTargetType}
              wizTiming={wizTiming}
              setWizTiming={setWizTiming}
              wizEvents={wizEvents}
              handleEventChange={handleEventChange}
              wizUpdateCols={wizUpdateCols}
              setWizUpdateCols={setWizUpdateCols}
              columnList={columnList}
              wizAliasNew={wizAliasNew}
              setWizAliasNew={setWizAliasNew}
              wizAliasOld={wizAliasOld}
              setWizAliasOld={setWizAliasOld}
              wizForEachRow={wizForEachRow}
              setWizForEachRow={setWizForEachRow}
              t={t}
              isNew={props.isNew}
            />
          </Paper>

          <Box
            onMouseDown={(e) => { setIsResizingV(true); resizeRef.current = { ...resizeRef.current, startY: e.clientY, startHeight: topHeight }; }}
            sx={styles.vResizer(isResizingV)}
          >
            <Box sx={styles.vResizerInner()} />
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
              t={t}
              themeMode={theme.palette.mode}
            />

            {isConsoleOpen && (
              <Box
                onMouseDown={(e) => { setIsResizingH(true); resizeRef.current = { ...resizeRef.current, startX: e.clientX, startWidth: leftWidth }; }}
                sx={styles.hResizer(isResizingH)}
              >
                <Box sx={styles.hResizerInner()} />
              </Box>
            )}

            {isConsoleOpen && (
            <TriggerConsolePane
                  consoleLogs={consoleLogs}
                  setIsConsoleOpen={setIsConsoleOpen}
                  handleConsoleClick={handleConsoleClick}
                  t={t}
                />
            )}
          </Box>
        </Box>
      </Box>

      {/* ============================================================ */}
      {/* Trace analysis tab. */}
      {/* ============================================================ */}
      {(visitedTabs.trace || activeTab === 'trace') && (
        <Box sx={styles.tabPane(activeTab === 'trace')}>
          <TriggerTracePane
            onRequestDebug={aiTraceDebug.requestDebug}
            isDebugDisabled={isLoading || props.isNew}
            isRightPanelOpen={isRightPanelOpen}
            leftWidth={leftWidth}
            simulator={simulator}
            setIsRightPanelOpen={setIsRightPanelOpen}
            triggerDisplaySql={triggerDisplaySql}
            trgToProcMap={trgToProcMap}
            procToTrgMap={procToTrgMap}
            setMenuLineNum={setMenuLineNum}
            setAnchorEl={setAnchorEl}
            isResizingH={isResizingH}
            setIsResizingH={setIsResizingH}
            resizeRef={resizeRef}
            traceRightTab={traceRightTab}
            setTraceRightTab={setTraceRightTab}
            traceDateTime={traceDateTime}
            traceArguments={traceArguments}
            traceConditions={traceConditions}
            groupedVariables={groupedVariables}
            anchorEl={anchorEl}
            menuLineNum={menuLineNum}
            monaStyle={props.monaStyle}
            isDarkTheme={theme.palette.mode === 'dark'}
            isActiveTab={props.isActive && activeTab === 'trace'}
            outputDateFormat={props.outputDateFormat}
            inputDateFormat={props.inputDateFormat}
            t={t}
          />
        </Box>
      )}

      {/* ============================================================ */}
      {/* Source tab. */}
      {/* ============================================================ */}
      {!props.isNew && visitedTabs.source && (
        <Box sx={styles.tabPane(activeTab === 'source')}>
          <TriggerSourcePane
          sourceText={sourceText}
          t={t}
          themeMode={theme.palette.mode}
        />
        </Box>
      )}

      {/* ============================================================ */}
      {!props.isNew && visitedTabs.version && (
        <Box sx={styles.tabPane(activeTab === 'version')}>
          <TriggerVersionPane
            schema={wizSchema}
            triggerName={wizTriggerName}
            sourceText={sourceText}
            isLoading={isLoading}
            onRefresh={loadExistingData}
          />
        </Box>
      )}

      {/* Trace analysis settings dialog. */}
      {/* ============================================================ */}
      <Dialog
        open={isTraceDialogOpen}
        onClose={(_, reason) => {
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
            </RadioGroup>
          </FormControl>

          {(traceTargetDml === 'UPDATE' || traceTargetDml === 'DELETE') && (
            <Box>
              <Typography variant="subtitle2" fontWeight="bold" sx={styles.dialogSubTitle}>{t("target_record_condition")} ({displayAliasOld}{t("value_retriever")})</Typography>
              <TextField
                fullWidth
                variant="outlined"
                size="small"
                placeholder={t("e_g_id_100")}
                value={traceWhereClause}
                onChange={(e) => setTraceWhereClause(e.target.value)}
                helperText={t("trigger_where_clause_new_help") + displayAliasOld + t("separator_3")}
              />
            </Box>
          )}

          {(traceTargetDml === 'INSERT' || traceTargetDml === 'UPDATE') && (
            <Box sx={styles.dmlBox}>
              <Typography variant="subtitle2" fontWeight="bold" sx={styles.dmlHeader}>
                {traceTargetDml === 'INSERT' ? t("value_to_insert") : t("value_to_update")} ({displayAliasNew}{t("value")})
              </Typography>

              {structureDefs.map(col => {
                 const isDateTime = col.DATA_TYPE.includes('DATE') || col.DATA_TYPE.includes('TIMESTAMP');

                 return (
                  <Box key={col.COLUMN_NAME}>
                    {isDateTime ? (
                      <Box sx={styles.dateInputWrapper}>
                        <TextField
                          label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${col.NULLABLE === 'N' ? t("required") : ''})`}
                          size="small" fullWidth variant="outlined" type="text"
                          placeholder={t("e_g") + (props.inputDateFormat || DEFAULT_DATE_FORMAT)}
                          value={traceInputData[col.COLUMN_NAME] || ''}
                          onChange={(e) => setTraceInputData({ ...traceInputData, [col.COLUMN_NAME]: e.target.value })}
                        />
                        <Box sx={{ position: 'relative', display: 'flex' }}>
                          <Tooltip title={t("select_from_calendar")}>
                            <IconButton disableRipple
                              color="primary"
                              onClick={(e) => {
                                const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                                if (input && typeof input.showPicker === 'function') input.showPicker();
                                else if (input) input.focus();
                              }}
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
                        label={`${col.COLUMN_NAME} (${col.DATA_TYPE}${col.NULLABLE === 'N' ? t("required") : ''})`}
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

        </DialogContent>
        <Divider />
        <Box sx={styles.dialogActions}>
          <Box sx={styles.dialogBtnGroup}>
            <Button disableRipple onClick={() => setIsTraceDialogOpen(false)}>{t("cancel")}</Button>
            <Button disableRipple variant="contained" color="secondary" startIcon={<AnalyticsIcon />} onClick={handleStartTrace} disabled={isLoading}>
              {t("start_trace_analysis")}
            </Button>
          </Box>
        </Box>
      </Dialog>

    </Box>
  );
}

export default memo(TriggerWindow);
