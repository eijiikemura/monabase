// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import PackageInformationTab from './PackageInformationTab';
import { requestPackageAi } from '@/features/ai/requestPackageAi';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import AiRequestButton from "@/features/ai/AiRequestButton";
import { useAiCodingGeneration } from "@/features/ai/useAiCodingGeneration";
import { useAiTraceDebug } from "@/features/ai/useAiTraceDebug";
import { useAiObjectSelection } from "@/features/ai/useAiObjectSelection";
import type { StoredAiProps } from "@/features/stored/storedCreation";
import type { PackageIdentity } from "@/features/stored/packageCreation";
import type { GroupedVariables } from "@/shared/types/traceTypes";
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import React, { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, Paper, Typography, IconButton, Tooltip, Button, Tabs, Tab, Select, MenuItem, Divider, Alert, LinearProgress } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import StopIcon from '@mui/icons-material/Stop';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { linter, type Diagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { useTranslation } from 'react-i18next';

import { CompletionContext } from '@codemirror/autocomplete';
import { plsqlDialect, oracleFunctionHighlighting, oracleBuiltinCompletions } from '../common/plsqlDialect'; 
import { useTraceSimulator } from '../common/useTraceSimulator'; 
import { useDbCompletions } from "@/features/sql/hooks/useDbCompletions";

import { SharedBottomPanel, BreakpointConditionPopover, SharedRightPanel } from "@/features/stored/StoredCommonUI";
import { TraceDebugArea } from "@/features/stored/TraceDebugArea"; 
import { usePackageLogic } from './usePackageLogic';
import VersionControlTab from "@/features/git/VersionControlTab";
import { DEFAULT_DATETIME_FORMAT } from "@/shared/utils/dateFormatter"; 

import { highlightSql } from '../common/sqlHighlighter';

const MemoCodeMirror = memo(CodeMirror);
const MemoSharedRightPanel = memo(SharedRightPanel);
const MemoSharedBottomPanel = memo(SharedBottomPanel);
const MemoVersionControlTab = memo(VersionControlTab);
const MemoBreakpointConditionPopover = memo(BreakpointConditionPopover);
const MemoTraceDebugArea = memo(TraceDebugArea);

// Extend the source editor to the bottom of its available area.
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  rootBox: (isActive: boolean) => ({ minHeight: 0, flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, p: 1, height: '100%', overflow: 'hidden', bgcolor: 'background.default', position: 'relative' as const, border: 0, m: 0, minWidth: 0 }),
  tabsContainer: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: 1, borderColor: 'divider', mb: 1, bgcolor: 'background.paper' },
  tabs: { minHeight: 36 },
  tabItem: (isBold: boolean) => ({ minHeight: 36, py: 0, fontWeight: isBold ? 'bold' : 'normal' }),
  mainContentBox: (isTab2: boolean, topHeight: number) => ({ display: 'flex', ...(isTab2 ? { flexGrow: 1, minHeight: 0 } : { height: topHeight, flexShrink: 0 }), overflow: 'hidden' }),
  paperLeft: (showRightPanel: boolean, leftWidth: number) => ({ minHeight: 0, minWidth: 0, width: showRightPanel ? leftWidth : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' }),
  actionToolbar: { p: 0.5, bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 },
  actionLeftBox: { display: 'flex', alignItems: 'center' },
  targetBox: { display: 'flex', alignItems: 'center', ml: 1, mr: 2 },
  targetLabel: { fontWeight: 'bold', color: 'text.secondary', mr: 1 },
  targetSelect: { bgcolor: 'background.paper', height: 26, minWidth: 120, '& .MuiSelect-select': { py: 0.5, pl: 1, pr: 3, fontSize: '0.75rem', display: 'flex', alignItems: 'center' } },
  btnMargin: { display: 'inline-flex', marginRight: '8px' },
  smallBtn: { py: 0, minHeight: 24, fontSize: '0.75rem' },
  smallBtnMr: { py: 0, minHeight: 24, fontSize: '0.75rem', mr: 1 },
  iconBtnMl: { p: 0, ml: 1 },
  codeEditorBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' } },
  debugPane: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, bgcolor: 'background.paper', overflow: 'hidden' },
  debugToolbar: { p: 0.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  debugLabel: { ml: 1, color: 'text.primary' },
  debugActions: { display: 'flex', gap: 0.5, alignItems: 'center' },
  iconBtnGreen: { color: 'success.main' },
  iconBtnBlue: { color: 'info.main' },
  iconBtnRed: { color: 'error.main' },
  iconBtnWhite: { color: 'text.primary' },
  divider1: { mx: 0.5, borderColor: 'divider' },
  divider2: { mx: 1, borderColor: 'divider' },
  versionControlPane: { minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  hResizer: (isResizing: boolean) => ({ width: 8, cursor: 'col-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', mx: 1, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  hResizerInner: (_isResizing: boolean) => ({ height: 40, width: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  vResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  vResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomPanelBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', p: 1 }
};

const codeSetup = { lineNumbers: true, autocompletion: true };

interface Props extends StoredAiProps {
  isNew?: boolean;
  onCreated?: (tabId: number, identity: PackageIdentity) => void;
  tabId: number; schema: string; objectName: string; objectType: 'PACKAGE' | 'PACKAGE BODY'; isActive: boolean;
  outputDateFormat?: string;
  inputDateFormat?: string;
  onDirtyStateChange?: (tabId: number, isDirty: boolean) => void;
  monaStyle?: boolean;
}

export default function PackageWindow(props: Props) {
  const { t } = useTranslation();
  const { onDirtyStateChange } = props;
  const theme = useTheme(); 
  const simulator = useTraceSimulator();
  const isNew = Boolean(props.isNew);
  const logic = usePackageLogic(props.schema, props.objectName, props.objectType, props.isActive, simulator, props.inputDateFormat || DEFAULT_DATETIME_FORMAT,
    { isNew, onCreated: identity => props.onCreated?.(props.tabId, identity) });

  useEffect(() => {
    if (onDirtyStateChange) {
      onDirtyStateChange(props.tabId, logic.hasUnsavedChanges);
    }
  }, [logic.hasUnsavedChanges, props.tabId, onDirtyStateChange]);

  const { dbCompletions, dbSchema } = useDbCompletions(props.schema);

  const [tabState, setTabState] = useState({
    mainTab: 0,
    hasOpenedTraceTab: false,
    hasOpenedVersionTab: false
  });
  const { mainTab, hasOpenedTraceTab, hasOpenedVersionTab } = tabState;
  const setMainTab = useCallback((value: number) => {
    setTabState(previous => previous.mainTab === value ? previous : {
      mainTab: value,
      hasOpenedTraceTab: previous.hasOpenedTraceTab || value === 1,
      hasOpenedVersionTab: previous.hasOpenedVersionTab || value === 2
    });
  }, []);
  const [bottomTab, setBottomTab] = useState(0); 
  const [traceRightTab, setTraceRightTab] = useState(0);

  const { setSourceText, setCompileErrors, loadObjectInfo } = logic;
  const { clearSimulation } = simulator;
  const handleSourceChange = useCallback((value: string) => {
    setSourceText(value);
    clearSimulation();
    setCompileErrors(previous => previous.length === 0 ? previous : []);
  }, [setSourceText, clearSimulation, setCompileErrors]);
  const objectSelection = useAiObjectSelection({ dbType: 'oracle', initialSchema: props.schema });
  const handleAiStart = useCallback(() => {
    setMainTab(0);
    clearSimulation();
  }, [setMainTab, clearSimulation]);
  const aiGeneration = useAiCodingGeneration({
    dbType: 'oracle', schema: props.schema, objectName: props.objectName, objectType: props.objectType,
    sourceText: logic.sourceText, setSourceText: handleSourceChange, isNew,
    isActive: props.isActive, isBusy: logic.isLoading, onStart: handleAiStart
  });
  const aiTraceDebug = useAiTraceDebug({
    dbType: 'oracle', schema: props.schema, objectName: props.objectName, objectType: 'PACKAGE BODY',
    sourceText: logic.sourceText, isAiEnabled: props.isAiEnabled, onOpenAiSidebar: props.onOpenAiSidebar
  });
  const isBusy = logic.isLoading || aiGeneration.isGenerating || aiTraceDebug.isPreparing;
  const handleEditorChange = useCallback((value: string) => {
    if (!aiGeneration.isGenerating && !aiTraceDebug.isPreparing) handleSourceChange(value);
  }, [aiGeneration.isGenerating, aiTraceDebug.isPreparing, handleSourceChange]);
  const handleRequestAi = useCallback(() => {
    requestPackageAi({
      isNew, schema: props.schema, objectName: props.objectName,
      objectType: props.objectType, isAiEnabled: props.isAiEnabled,
      onOpenAiSidebar: props.onOpenAiSidebar, objectSelection,
      responseTarget: aiGeneration.responseTarget, t
    });
  }, [props, isNew, t, objectSelection, aiGeneration.responseTarget]);

  useEffect(() => {
    if ((logic.compileErrors?.length > 0) || (logic.dbmsOutputs?.length > 0 && /\[ERROR\]/.test(logic.dbmsOutputs[0]))) {
      setBottomTab(1);
    }
  }, [logic.compileErrors, logic.dbmsOutputs]);

  // Use a 6:4 horizontal split for the right panel and retain the 7:3 vertical split.
  const [leftWidth, setLeftWidth] = useState(window.innerWidth * 0.6);
  const [topHeight, setTopHeight] = useState((window.innerHeight - 150) * 0.7);
  const ratioRef = useRef({ left: 0.6, top: 0.7 });
  
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(props.objectType !== 'PACKAGE');
  const [isResizingH, setIsResizingH] = useState(false);
  const [isResizingV, setIsResizingV] = useState(false);

  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const resizeRef = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [menuLineNum, setMenuLineNum] = useState<number | null>(null);

  const groupedVariables = useMemo(() => {
    const groups: GroupedVariables = {};
    Object.entries(simulator.currentVariables).forEach(([key, val]) => {
      const baseMatch = key.match(/^([a-zA-Z0-9_]+)(.*)$/);
      if (baseMatch) {
        if (baseMatch[2] === '') groups[baseMatch[1]] = val;
        else { if (typeof groups[baseMatch[1]] !== 'object') groups[baseMatch[1]] = {}; const group = groups[baseMatch[1]];
            if (typeof group === 'object') group[baseMatch[2]] = val; }
      } else groups[key] = val;
    });
    return groups;
  }, [simulator.currentVariables]);

  useEffect(() => {
    const handleWindowResize = () => {
      setLeftWidth(window.innerWidth * ratioRef.current.left);
      setTopHeight(Math.max(150, (window.innerHeight - 150) * ratioRef.current.top));
    };
    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingH && isRightPanelOpen) {
        const newWidth = Math.max(200, resizeRef.current.startWidth + (e.clientX - resizeRef.current.startX));
        setLeftWidth(newWidth);
        ratioRef.current.left = newWidth / window.innerWidth;
      } 
      if (isResizingV) {
        const newHeight = Math.max(150, resizeRef.current.startHeight + (e.clientY - resizeRef.current.startY));
        setTopHeight(newHeight);
        ratioRef.current.top = newHeight / Math.max(1, window.innerHeight - 150);
      } 
    };
    const handleMouseUp = () => { setIsResizingH(false); setIsResizingV(false); };
    if (isResizingH || isResizingV) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
      document.body.style.userSelect = 'none'; 
      document.body.style.cursor = isResizingH ? 'col-resize' : 'row-resize';
    } else { 
      document.body.style.userSelect = ''; 
      document.body.style.cursor = ''; 
    }
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [isResizingH, isResizingV, isRightPanelOpen]);

  const findSubProgramLine = (source: string, spName: string) => {
    if (!spName || !source) return -1;
    const lines = source.split('\n');
    const escaped = spName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(?:PROCEDURE|FUNCTION)\\s+(?:"${escaped}"|${escaped}(?![\\p{L}\\p{N}_$#]))`, 'iu');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('--')) continue; 
      if (regex.test(lines[i])) return i + 1;
    }
    return -1;
  };

  const lastScrolledKey = useRef<string>('');

  useEffect(() => {
    if (isBusy) return;
    if (!logic.selectedSubProgram || !logic.sourceText || props.objectType === 'PACKAGE' || logic.sourceText === t("fetching_data")) return;
    
    const key = `${logic.selectedSubProgram}-${mainTab}`;
    if (lastScrolledKey.current === key) return;

    const targetLine = findSubProgramLine(logic.sourceText, logic.selectedSubProgramName);
    if (targetLine === -1) return;

    if (mainTab === 0) {
      setTimeout(() => {
        if (editorRef.current?.view) {
          try {
            const pos = editorRef.current.view.state.doc.line(targetLine).from;
            editorRef.current.view.dispatch({
              effects: EditorView.scrollIntoView(pos, { y: 'center' })
            });
            lastScrolledKey.current = key;
          } catch { /* Auxiliary failures must not affect the main operation's result. */ }
        }
      }, 50);
    }
  }, [logic.selectedSubProgram, logic.selectedSubProgramName, logic.sourceText, mainTab, props.objectType, isBusy, t]);

  useEffect(() => {
    if (!logic.traceDateTime && mainTab === 1) {
      setMainTab(0);
    }
  }, [logic.traceDateTime, mainTab, setMainTab]);

  const handleCloseContextMenu = useCallback(() => {
    setAnchorEl(null);
    setMenuLineNum(null);
  }, []);

  const { breakpoints, toggleBreakpoint } = simulator;
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLElement>, lineNum: number) => {
    e.preventDefault(); 
    if (!breakpoints.includes(lineNum)) toggleBreakpoint(lineNum);
    setMenuLineNum(lineNum);
    setAnchorEl(e.currentTarget); 
  }, [breakpoints, toggleBreakpoint]);

  const oracleLinter = useMemo(() => linter((view) => {
    return (logic.compileErrors || []).map(err => {
      if (err.line > 0 && err.line <= view.state.doc.lines) {
        const line = view.state.doc.line(err.line);
        const from = line.from + (err.col > 0 ? err.col - 1 : 0);
        return { from: Math.min(from, line.to), to: line.to, severity: "error", message: err.text };
      }
      return null;
    }).filter(Boolean) as Diagnostic[];
  }), [logic.compileErrors]);

  const handleConsoleClick = useCallback((lineText: string) => {
    const match = lineText.match(/^\[ERROR\] Line (\d+):/);
    if (match && editorRef.current?.view) {
      const pos = editorRef.current.view.state.doc.line(parseInt(match[1], 10)).from; 
      editorRef.current.view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  }, []);

  const argumentCompletions = useMemo(() => {
    return logic.argumentsList.filter(a => a.POSITION > 0).map(arg => ({
      label: arg.ARGUMENT_NAME,
      type: 'variable',
      detail: t("arguments") + ` (${arg.DATA_TYPE})`
    }));
  }, [logic.argumentsList, t]);

  const extensions = useMemo(() => {
    return [
      sql({ dialect: plsqlDialect, upperCaseKeywords: true, schema: dbSchema }),
      plsqlDialect.language.data.of({
        autocomplete: (context: CompletionContext) => {
          const word = context.matchBefore(/\w*/);
          const dotBefore = context.matchBefore(/\.\w*/);
          if (dotBefore) return null;

          if (!word || (word.from === word.to && !context.explicit)) return null;
          return {
            from: word.from,
            options: [...dbCompletions, ...logic.localCompletions, ...argumentCompletions, ...oracleBuiltinCompletions]
          };
        }
      }),
      oracleLinter,
      oracleFunctionHighlighting
    ];
  }, [dbCompletions, dbSchema, oracleLinter, logic.localCompletions, argumentCompletions]);

  const handleRefresh = useCallback(
    () => loadObjectInfo(true),
    [loadObjectInfo]
  );

  const isSpec = props.objectType === 'PACKAGE';
  const showRightPanel = !isNew && isRightPanelOpen && !isSpec && mainTab !== 2 && mainTab !== 3;

  if (!props.isActive) return null;

  return (
    <Box component="fieldset" disabled={isBusy} aria-busy={isBusy} sx={styles.rootBox(props.isActive)}>
      {logic.isLoading && !logic.isExecuting && <WindowLoadingIndicator />}
      {logic.definitionLoadError && <Alert severity="error" action={<Button disabled={isBusy} onClick={() => void logic.loadObjectInfo(true)}>{t('retry')}</Button>}>{logic.definitionLoadError}</Alert>}
      {!logic.definitionLoadError && logic.metadataReady && !logic.objectValid && <Alert severity="warning">{t('package_invalid_status')}</Alert>}
      {!isNew && !isSpec && logic.hasUnsavedChanges && <Alert severity="info">{t('package_trace_compile_first')}</Alert>}
      {logic.argumentLoadError && <Alert severity="error" action={
        <Button color="inherit" disabled={isBusy || !logic.selectedSubProgram} onClick={() => void logic.loadArguments(logic.selectedSubProgram)}>
          {t('retry_package_arguments')}
        </Button>
      }>{t('package_arguments_load_failed', { error: logic.argumentLoadError })}</Alert>}
      {(aiGeneration.isGenerating || aiGeneration.isApplied) && (
        <Box role="status" aria-live="polite" sx={{ mb: 1 }}>
          <Typography variant="caption">{aiGeneration.isGenerating
            ? t("ai_is_generating_a_program_2") : t("applied_the_ai_generated_program")}</Typography>
          <LinearProgress variant={aiGeneration.isGenerating ? 'indeterminate' : 'determinate'} value={100} />
        </Box>
      )}
      <Box sx={styles.tabsContainer}>
        <Tabs value={mainTab} onChange={(_e, val) => setMainTab(val)} sx={styles.tabs}>
          <Tab disabled={isBusy} value={0} label={t("source") + (logic.hasUnsavedChanges ? ' *' : '')} sx={styles.tabItem(true)} />
          {!isNew && !isSpec && logic.traceDateTime && (
            <Tab disabled={isBusy} value={1} label={t("trace_analysis")} sx={styles.tabItem(true)} />
          )}
          {!isNew && <Tab disabled={isBusy} value={2} label={t("version_control")} sx={styles.tabItem(true)} />}
          {!isNew && <Tab disabled={isBusy} value={3} label={t('routine_information')} sx={styles.tabItem(true)} />}
        </Tabs>
      </Box>

      <Box sx={styles.mainContentBox(isNew || mainTab === 2 || mainTab === 3, topHeight)}>
        
        <Paper elevation={1} sx={styles.paperLeft(showRightPanel, leftWidth)}>
          
          {mainTab === 0 && (
            <Box sx={styles.actionToolbar}>
              <Box sx={styles.actionLeftBox}>
                {!isNew && !isSpec && (
                  <React.Fragment>
                    <Box sx={styles.targetBox}>
                      <Typography variant="caption" sx={styles.targetLabel}>{t("target_2")}</Typography>
                      <Select 
                        size="small" 
                        displayEmpty 
                        value={logic.selectedSubProgram || ''} 
                        disabled={isBusy || !logic.selectedSubProgram}
                        onChange={(e) => { const val = e.target.value as string; logic.setSelectedSubProgram(val); if (val) logic.loadArguments(val); }} 
                        sx={styles.targetSelect}
                      >
                        {logic.subPrograms.length === 0 ? <MenuItem value="" disabled sx={{ fontSize: '0.75rem' }}>{t("uncompiled")}</MenuItem> : logic.subPrograms.map(sp => <MenuItem key={sp.key} value={sp.key} sx={{ fontSize: '0.75rem' }}>{sp.label}</MenuItem>)}
                      </Select>
                    </Box>
                    <Tooltip title={t("execute_target")}>
                      <span style={styles.btnMargin}>
                        <Button variant="contained" color="success" size="small" startIcon={<PlayArrowIcon />} onClick={() => logic.handleExecute((success, hasReturnValues) => setBottomTab(success && hasReturnValues ? 0 : 1), () => { setIsRightPanelOpen(true); })} sx={styles.smallBtn} disabled={isBusy || !logic.canExecuteSubProgram}>{t("execute")}</Button>
                      </span>
                    </Tooltip>
                    <Tooltip title={t("execute_with_trace_for_debugging")}>
                      <span style={styles.btnMargin}>
                        <Button variant="outlined" color="secondary" size="small" startIcon={<AnalyticsIcon />} onClick={() => logic.handleTraceExecute(true, (success) => { if(success) { setMainTab(1); setTraceRightTab(0); setIsRightPanelOpen(true); } else setBottomTab(1); }, () => { setIsRightPanelOpen(true); })} sx={styles.smallBtn} disabled={isBusy || !logic.canExecuteSubProgram}>{t("execute_trace")}</Button>
                      </span>
                    </Tooltip>
                  </React.Fragment>
                )}
              </Box>
              
              <Box sx={styles.actionLeftBox}>
                {!isNew && <Button
                  disabled={isBusy}
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteOutlineIcon />}
                  onClick={() => logic.handleDelete(props.tabId)}
                  sx={styles.smallBtnMr}
                >
                  {t("delete")}
                </Button>}
                <Tooltip title={t("compile_source_code")}>
                  <span style={styles.btnMargin}>
                    <Button 
                      disabled={isBusy || (!isNew && !logic.metadataReady)}
                      variant="outlined" 
                      color="primary" 
                      size="small" 
                      onClick={() => {
                        const currentPos = editorRef.current?.view ? editorRef.current.view.state.selection.main.head : 0;
                        const currentFunc = logic.selectedSubProgram;
                        
                        logic.handleCompile((errors) => { 
                          if(errors.length > 0) {
                            setBottomTab(1); 
                          } else {
                            if (currentFunc) {
                              logic.setSelectedSubProgram(currentFunc);
                              lastScrolledKey.current = `${currentFunc}-${mainTab}`; 
                            }
                            setTimeout(() => {
                              if (editorRef.current?.view) {
                                try {
                                  const docLength = editorRef.current.view.state.doc.length;
                                  const safePos = Math.min(currentPos, docLength);
                                  editorRef.current.view.dispatch({
                                    selection: { anchor: safePos, head: safePos },
                                    effects: EditorView.scrollIntoView(safePos, { y: 'center' })
                                  });
                                } catch { /* Auxiliary failures must not affect the main operation's result. */ }
                              }
                            }, 300);
                          }
                        });
                      }} 
                      sx={styles.smallBtn}
                    >
                      {t("compile")}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={t("ask_ai_to_create_or_modify_the_program")}>
                  <span style={{ display: 'inline-flex' }}>
                    <AiRequestButton aria-label={t('ask_ai_to_code')} sx={{ width: 24, height: 24, p: 0, '& .MuiSvgIcon-root': { fontSize: 18 } }} disabled={isBusy} onClick={handleRequestAi} />
                  </span>
                </Tooltip>
                {!isNew && !isRightPanelOpen && !isSpec && <Tooltip title={t("open_right_panel")}><IconButton disabled={isBusy} size="small" onClick={() => setIsRightPanelOpen(true)} sx={styles.iconBtnMl}><ChevronLeftIcon fontSize="small" /></IconButton></Tooltip>}
              </Box>
            </Box>
          )}

          {isNew && logic.dbmsOutputs.length > 0 && (
            <Alert severity="error" sx={{ whiteSpace: 'pre-wrap', maxHeight: '25%', overflow: 'auto', flexShrink: 0 }}>
              {logic.dbmsOutputs.join('\n')}
            </Alert>
          )}
          <Box sx={[styles.codeEditorBox, { display: mainTab === 0 ? 'block' : 'none' }]}>
            <MemoCodeMirror
              editable={!isBusy}
              ref={editorRef}
              value={aiGeneration.displaySource}
              height="100%"
              style={SOURCE_HOST_STYLE}
              extensions={extensions}
              onChange={handleEditorChange}
              basicSetup={codeSetup}
              theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
            />
          </Box>

          {!isNew && !isSpec && hasOpenedTraceTab && (
            <Box sx={[styles.debugPane, { display: mainTab === 1 ? 'flex' : 'none' }]}>
              <Box sx={styles.debugToolbar}>
                <Typography variant="caption" fontWeight="bold" sx={styles.debugLabel}>{t("debug_area")}</Typography>
                
                <Box sx={styles.debugActions}>
                  {(!simulator.isSimulating || simulator.currentStepIndex === -1) ? (
                    <Tooltip title={t("debug_play_f8")}>
                      <span style={{ display: 'inline-flex' }}>
                        <IconButton size="small" onClick={() => logic.handleSimulationAction('start')} disabled={isBusy || simulator.executionSteps.length === 0} sx={styles.iconBtnGreen}><PlayArrowIcon fontSize="small" /></IconButton>
                      </span>
                    </Tooltip>
                  ) : (
                    <Tooltip title={t("resume_f8")}>
                      <span style={{ display: 'inline-flex' }}>
                        <IconButton disabled={isBusy} size="small" onClick={() => logic.handleSimulationAction('resume')} sx={styles.iconBtnGreen}><PlayCircleOutlineIcon fontSize="small" /></IconButton>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title={t("step_in_f11")}>
                    <span style={{ display: 'inline-flex' }}>
                      <IconButton size="small" onClick={() => logic.handleSimulationAction('step_into')} disabled={isBusy || !simulator.isSimulating} sx={styles.iconBtnBlue}><SubdirectoryArrowRightIcon fontSize="small" /></IconButton>
                    </span>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={styles.divider1} />
                  <Tooltip title={t("stop_shift_f5")}>
                    <span style={{ display: 'inline-flex' }}>
                      <IconButton size="small" onClick={() => logic.handleSimulationAction('stop')} disabled={isBusy || !simulator.isSimulating} sx={styles.iconBtnRed}><StopIcon fontSize="small" /></IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("ask_ai_to_analyze_the_full_trace")}>
                    <span style={{ display: 'inline-flex' }}>
                      <AiRequestButton onClick={aiTraceDebug.requestDebug} disabled={isBusy || simulator.executionSteps.length === 0} />
                    </span>
                  </Tooltip>
                  <Divider orientation="vertical" flexItem sx={styles.divider2} />
                  {!isRightPanelOpen && (
                    <Tooltip title={t("open_right_panel")}>
                      <span style={{ display: 'inline-flex' }}>
                        <IconButton disabled={isBusy} size="small" onClick={() => setIsRightPanelOpen(true)} sx={styles.iconBtnWhite}><ChevronLeftIcon fontSize="small" /></IconButton>
                      </span>
                    </Tooltip>
                  )}
                </Box>
              </Box>
              
              <MemoTraceDebugArea
                sourceText={logic.sourceText}
                simulator={simulator}
                monaStyle={props.monaStyle}
                isDarkTheme={theme.palette.mode === 'dark'}
                isActiveTab={props.isActive && mainTab === 1 && !isBusy}
                onContextMenu={handleContextMenu}
                highlightLine={highlightSql}
              />
            </Box>
          )}

          {!isNew && hasOpenedVersionTab && (
            <Box sx={[styles.versionControlPane, { display: mainTab === 2 ? 'flex' : 'none' }]}>
              <MemoVersionControlTab
                isSourceLoading={isBusy}
                dbType="ORACLE" 
                schema={props.schema} 
                objectType={props.objectType} 
                objectName={props.objectName} 
                currentSource={logic.sourceText} 
                onRefresh={handleRefresh}
              />
            </Box>
          )}

          {!isNew && mainTab === 3 && <PackageInformationTab schema={props.schema} name={props.objectName} />}
        </Paper>

        {showRightPanel && (
          <Box 
            onMouseDown={(e) => { setIsResizingH(true); resizeRef.current = { ...resizeRef.current, startX: e.clientX, startWidth: leftWidth }; }} 
            sx={styles.hResizer(isResizingH)} 
          >
            <Box sx={styles.hResizerInner(isResizingH)} />
          </Box>
        )}
        
        {!isNew && !isSpec && (
          <Box sx={{ display: showRightPanel ? 'contents' : 'none' }}>
            <MemoSharedRightPanel
              mainTab={mainTab === 1 ? 1 : 0}
              traceRightTab={traceRightTab}
              setTraceRightTab={setTraceRightTab}
              setIsRightPanelOpen={setIsRightPanelOpen}
              argumentModes={logic.argumentModes}
              setArgumentModes={logic.setArgumentModes}
              argumentsList={logic.argumentsList}
              argValues={logic.argValues}
              setArgValues={logic.setArgValues}
              traceDateTime={logic.traceDateTime}
              traceArguments={logic.traceArguments}
              simulator={simulator}
              groupedVariables={groupedVariables}
              outputDateFormat={props.outputDateFormat}
              inputDateFormat={props.inputDateFormat}
            />
          </Box>
        )}
      </Box>

      {!isNew && <React.Fragment>
        <Box
          onMouseDown={(e) => { setIsResizingV(true); resizeRef.current = { ...resizeRef.current, startY: e.clientY, startHeight: topHeight }; }}
          sx={[styles.vResizer(isResizingV), { display: mainTab !== 2 && mainTab !== 3 ? 'flex' : 'none' }]}
        >
          <Box sx={styles.vResizerInner(isResizingV)} />
        </Box>

        <Box sx={[styles.bottomPanelBox, { display: mainTab !== 2 && mainTab !== 3 ? 'flex' : 'none' }]}>
          <MemoSharedBottomPanel bottomTab={bottomTab} setBottomTab={setBottomTab} returnValues={logic.returnValues} displayOutputs={logic.dbmsOutputs} handleClearLogs={logic.handleClearLogs} handleConsoleClick={handleConsoleClick} />
        </Box>
      </React.Fragment>}

      {!isNew && <MemoBreakpointConditionPopover anchorEl={anchorEl} menuLineNum={menuLineNum} simulator={simulator} onClose={handleCloseContextMenu} />}
    </Box>
  );
}
