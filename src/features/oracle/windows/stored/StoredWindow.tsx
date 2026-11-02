// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { RoutineInformationTab } from '@/features/stored/RoutineInformationTab';
import { useAiCodingGeneration } from "@/features/ai/useAiCodingGeneration";
import { useAiTraceDebug } from "@/features/ai/useAiTraceDebug";
import AiRequestButton from "@/features/ai/AiRequestButton";
import { useAiObjectSelection } from "@/features/ai/useAiObjectSelection";
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import React, { memo, useCallback } from 'react';
import { Box, Paper, Typography, IconButton, Tooltip, Divider, Button, Tabs, Tab, Alert, LinearProgress } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import StopIcon from '@mui/icons-material/Stop';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { useTranslation } from 'react-i18next'; 

import { SharedBottomPanel, BreakpointConditionPopover, SharedRightPanel } from "@/features/stored/StoredCommonUI";
import { TraceDebugArea } from "@/features/stored/TraceDebugArea"; 
import VersionControlTab from "@/features/git/VersionControlTab";

import { useStoredWindow, type StoredWindowProps } from './useStoredWindow';

import { highlightSql } from '../common/sqlHighlighter';

const MemoCodeMirror = memo(CodeMirror);
const MemoSharedRightPanel = memo(SharedRightPanel);
const MemoSharedBottomPanel = memo(SharedBottomPanel);
const MemoVersionControlTab = memo(VersionControlTab);
const MemoBreakpointConditionPopover = memo(BreakpointConditionPopover);
const MemoTraceDebugArea = memo(TraceDebugArea);
const EDITOR_SETUP = { lineNumbers: true, autocompletion: true };

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
  leftPaper: (showRightPanel: boolean, leftWidth: number) => ({ minWidth: 0, width: showRightPanel ? leftWidth : '100%', flexShrink: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0, bgcolor: 'background.paper' }),
  toolbar: { p: 0.5, bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 },
  actionLeft: { display: 'flex', alignItems: 'center' },
  actionRight: { display: 'flex', alignItems: 'center' },
  btnInline: { display: 'inline-flex', marginLeft: '8px', marginRight: '8px' },
  btnInlineRight: { display: 'inline-flex', marginRight: '8px' },
  smallBtn: { py: 0, minHeight: 24, fontSize: '0.75rem' },
  smallBtnMr: { py: 0, minHeight: 24, fontSize: '0.75rem', mr: 1 },
  iconBtnMl: { p: 0, ml: 1 },
  codeEditorBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' } },
  
  debugPane: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, bgcolor: 'background.paper', overflow: 'hidden', minHeight: 0 },
  debugToolbar: { p: 0.5, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  debugLabel: { ml: 1, color: 'text.primary' },
  debugActions: { display: 'flex', gap: 0.5, alignItems: 'center' },
  iconBtnGreen: { color: 'success.main' },
  iconBtnBlue: { color: 'info.main' },
  iconBtnRed: { color: 'error.main' },
  iconBtnWhite: { color: 'text.primary' },
  divider1: { mx: 0.5, borderColor: 'divider' },
  divider2: { mx: 1, borderColor: 'divider' },
  
  versionControlBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  hResizer: (isResizing: boolean) => ({ width: 8, cursor: 'col-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', mx: 1, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  hResizerInner: (_isResizing: boolean) => ({ height: 40, width: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  vResizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'divider', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', my: 1, mx: 0.5, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  vResizerInner: (_isResizing: boolean) => ({ width: 40, height: 2, bgcolor: 'background.paper', borderRadius: 1 }),
  bottomPanelBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', p: 1, minHeight: 0 }
};

interface ExtendedStoredWindowProps extends StoredWindowProps {
  monaStyle?: boolean;
}

export default function StoredWindow(props: ExtendedStoredWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme(); 

  const {
    simulator, logic, mainTab, setMainTab, hasOpenedTraceTab,
    bottomTab, setBottomTab, traceRightTab, setTraceRightTab,
    leftWidth, topHeight, isRightPanelOpen, setIsRightPanelOpen, isResizingH, setIsResizingH, isResizingV, setIsResizingV,
    editorRef, resizeRef, anchorEl, menuLineNum, groupedVariables, handleCloseContextMenu, handleContextMenu, handleConsoleClick, extensions
  } = useStoredWindow(props);

  const { setSourceText, setCompileErrors, loadObjectInfo } = logic;
  const { clearSimulation } = simulator;

  const handleSourceChange = useCallback((value: string) => {
    setSourceText(value);
    clearSimulation();
    setCompileErrors(previous => previous.length === 0 ? previous : []);
  }, [setSourceText, clearSimulation, setCompileErrors]);

  const handleRefresh = useCallback(
    () => loadObjectInfo(true),
    [loadObjectInfo]
  );

  const isNew = Boolean(props.isNew);
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
    dbType: 'oracle',
    schema: props.schema,
    objectName: props.objectName,
    objectType: props.objectType,
    sourceText: logic.sourceText,
    isAiEnabled: props.isAiEnabled,
    onOpenAiSidebar: props.onOpenAiSidebar
  });
  const isBusy = logic.isLoading || aiGeneration.isGenerating ||
    aiTraceDebug.isPreparing;
  const handleEditorChange = useCallback((value: string) => {
    if (!aiGeneration.isGenerating) handleSourceChange(value);
  }, [aiGeneration.isGenerating, handleSourceChange]);
  const handleRequestAi = useCallback(() => {
    if (!props.isAiEnabled || !props.onOpenAiSidebar) {
      alert(t("ai_configure_support_instructions"));
      return;
    }
    const requestType = props.objectType === 'PROCEDURE'
      ? "coding_procedure"
      : "coding_function";
    props.onOpenAiSidebar({
      targetTab: `${isNew ? t("create_new") : props.objectName} (${props.schema} · ${props.objectType})`,
      requestType, requestId: crypto.randomUUID(), objectSelection,
      referencePrompt: `${requestType}の依頼です。`,
      codingResponse: aiGeneration.responseTarget
    });
  }, [props, isNew, t, objectSelection, aiGeneration.responseTarget]);

  const showRightPanel = !isNew && isRightPanelOpen && mainTab !== 2 && mainTab !== 3;

  if (!props.isActive) return null;

  return (
    <Box component="fieldset" disabled={isBusy} aria-busy={isBusy} sx={styles.rootBox(props.isActive)}>
      {logic.isLoading && !logic.isExecuting && <WindowLoadingIndicator />}
      {logic.loadError && <Alert severity="error" action={<Button disabled={isBusy} onClick={() => { void logic.loadObjectInfo(); }}>{t('retry')}</Button>}>{logic.loadError}</Alert>}
      {(aiGeneration.isGenerating || aiGeneration.isApplied) && (
        <Box role="status" sx={{ flexShrink: 0, px: 1, py: 0.5, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="primary">
            {aiGeneration.isGenerating ? t("ai_is_generating_a_program") : t("applied_the_generated_program")}
          </Typography>
          {aiGeneration.isGenerating && <LinearProgress />}
        </Box>
      )}
      <Box sx={styles.tabsContainer}>
        <Tabs value={mainTab} onChange={(_e, val) => setMainTab(val as number)} sx={styles.tabs}>
          <Tab disabled={isBusy} value={0} label={t("source") + (logic.hasUnsavedChanges ? ' *' : '')} sx={styles.tabItem(true)} />
          {!isNew && logic.traceDateTime && (
            <Tab disabled={isBusy} value={1} label={t("trace_analysis")} sx={styles.tabItem(true)} />
          )}
          {!isNew && <Tab disabled={isBusy} value={2} label={t("version_control")} sx={styles.tabItem(true)} />}
          {!isNew && <Tab disabled={isBusy} value={3} label={t("routine_information")} sx={styles.tabItem(true)} />}
        </Tabs>
      </Box>

      <Box sx={styles.mainContentBox(isNew || mainTab === 2 || mainTab === 3, topHeight)}>
        
        <Paper elevation={1} sx={styles.leftPaper(showRightPanel, leftWidth)}>
          {mainTab === 3 && <RoutineInformationTab database="oracle" schema={props.schema} name={props.objectName} kind={props.objectType} signature={undefined} args={logic.argumentsList} />}
          
          {mainTab === 0 && (
            <Box sx={styles.toolbar}>
              {!isNew && <Box sx={styles.actionLeft}>
                <Tooltip title={t("execute_target")}>
                  <span style={styles.btnInline}>
                    <Button disabled={isBusy || !logic.metadataReady || !logic.objectValid} variant="contained" color="success" size="small" startIcon={<PlayArrowIcon />} onClick={() => logic.handleExecute((success, hasReturnValues) => setBottomTab(success && hasReturnValues ? 0 : 1), () => { setIsRightPanelOpen(true); })} sx={styles.smallBtn}>{t("execute")}</Button>
                  </span>
                </Tooltip>
                <Tooltip title={t("execute_with_trace_for_debugging")}>
                  <span style={styles.btnInlineRight}>
                    <Button disabled={isBusy || !logic.metadataReady || !logic.objectValid} variant="outlined" color="secondary" size="small" startIcon={<AnalyticsIcon />} onClick={() => logic.handleTraceExecute(true, (success) => { if(success) { setMainTab(1); setTraceRightTab(0); setIsRightPanelOpen(true); } else setBottomTab(1); }, () => { setIsRightPanelOpen(true); })} sx={styles.smallBtn}>{t("execute_trace")}</Button>
                  </span>
                </Tooltip>
              </Box>}
              <Box sx={styles.actionRight}>
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
                  <span style={styles.btnInlineRight}>
                    <Button 
                      disabled={isBusy || (!props.isNew && !logic.metadataReady)}
                      variant="outlined" 
                      color="primary" 
                      size="small" 
                      onClick={() => {
                        let currentPos = 0;
                        if (editorRef.current?.view) {
                          currentPos = editorRef.current.view.state.selection.main.head;
                        }
                        
                        logic.handleCompile((errors) => { 
                          if(errors.length > 0) {
                            setBottomTab(1); 
                          } else {
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
                            }, 200);
                          }
                        });
                      }} 
                      sx={styles.smallBtn}
                    >
                      {t("compile")}
                    </Button>
                  </span>
                </Tooltip>
                <Tooltip title={t("ask_ai_to_create_or_modify_source_code")}>
                  <span><AiRequestButton sx={{ width: 24, height: 24, p: 0, '& .MuiSvgIcon-root': { fontSize: 18 } }} disabled={isBusy} aria-label={t("ask_ai_to_code")} onClick={handleRequestAi} /></span>
                </Tooltip>
                {!isNew && !isRightPanelOpen && <Tooltip title={t("open_right_panel")}><IconButton disabled={isBusy} size="small" onClick={() => setIsRightPanelOpen(true)} sx={styles.iconBtnMl}><ChevronLeftIcon fontSize="small" /></IconButton></Tooltip>}
              </Box>
            </Box>
          )}

          {isNew && logic.dbmsOutputs.length > 0 && (
            <Alert severity="error" sx={{ maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
              {logic.dbmsOutputs.join('\n')}
            </Alert>
          )}
          <Box sx={[
            styles.codeEditorBox,
            { display: mainTab === 0 ? 'block' : 'none' }
          ]}>
            <MemoCodeMirror
              editable={!isBusy}
              readOnly={isBusy}
              ref={editorRef}
              value={aiGeneration.displaySource}
              height="100%"
              style={SOURCE_HOST_STYLE}
              extensions={extensions}
              onChange={handleEditorChange}
              basicSetup={EDITOR_SETUP}
              theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
            />
          </Box>

          {!isNew && hasOpenedTraceTab && (
            <Box sx={[
              styles.debugPane,
              { display: mainTab === 1 ? 'flex' : 'none' }
            ]}>
              <Box sx={styles.debugToolbar}>
                <Typography variant="caption" fontWeight="bold" sx={styles.debugLabel}>{t("debug_area")}</Typography>
                
                <Box sx={styles.debugActions}>
                  {/* Wrap disabled tooltip buttons in a span. */}
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
                  {!isNew && !isRightPanelOpen && (
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

          {!isNew && mainTab === 2 && (
            <Box sx={styles.versionControlBox}>
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

        </Paper>

        {showRightPanel && (
          <Box 
            onMouseDown={(e) => { setIsResizingH(true); resizeRef.current = { ...resizeRef.current, startX: e.clientX, startWidth: leftWidth }; }} 
            sx={styles.hResizer(isResizingH)} 
          >
            <Box sx={styles.hResizerInner(isResizingH)} />
          </Box>
        )}
        
        {!isNew && <Box sx={{ display: showRightPanel ? 'contents' : 'none' }}>
          <MemoSharedRightPanel
            mainTab={mainTab === 1 ? 1 : 0} 
            traceRightTab={traceRightTab}
            setTraceRightTab={setTraceRightTab}
            setIsRightPanelOpen={setIsRightPanelOpen}
            argumentModes={logic.argumentModes} setArgumentModes={logic.setArgumentModes}
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
        </Box>}
      </Box>

      {!isNew && <React.Fragment>
        <Box
          onMouseDown={(e) => { setIsResizingV(true); resizeRef.current = { ...resizeRef.current, startY: e.clientY, startHeight: topHeight }; }}
          sx={[
            styles.vResizer(isResizingV),
            { display: mainTab !== 2 && mainTab !== 3 ? 'flex' : 'none' }
          ]}
        >
          <Box sx={styles.vResizerInner(isResizingV)} />
        </Box>

        <Box sx={[
          styles.bottomPanelBox,
          { display: mainTab !== 2 && mainTab !== 3 ? 'flex' : 'none' }
        ]}>
          <MemoSharedBottomPanel bottomTab={bottomTab} setBottomTab={setBottomTab} returnValues={logic.returnValues} displayOutputs={logic.dbmsOutputs} handleClearLogs={logic.handleClearLogs} handleConsoleClick={handleConsoleClick} />
        </Box>
      </React.Fragment>}

      {!isNew && <MemoBreakpointConditionPopover anchorEl={anchorEl} menuLineNum={menuLineNum} simulator={simulator} onClose={handleCloseContextMenu} />}
    </Box>
  );
}
