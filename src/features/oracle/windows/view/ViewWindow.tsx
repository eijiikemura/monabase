// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { ViewMetadataTab } from '@/features/view/ViewMetadataTab';
import React, { memo, useState, useEffect } from 'react';
import { Box, Tabs, Tab, Paper, Typography, Button, Divider, IconButton, Tooltip, Alert } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseIcon from '@mui/icons-material/Close';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';

import ViewDataTab from './ViewDataTab';
import VersionControlTab from "@/features/git/VersionControlTab";
import { useViewWindow, type ViewWindowProps } from './useViewWindow';

// Reuse settings and components; fill remaining space with the source editor.
const MemoCodeMirror = memo(CodeMirror);
const MemoVersionControlTab = memo(VersionControlTab);
const EDITOR_SETUP = { lineNumbers: true, autocompletion: true };
const EDITOR_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', height: '100%', bgcolor: 'background.default', position: 'relative' as const, minHeight: 0 }),
  tabsContainer: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2 },
  tabs: { minHeight: 40 },
  tabItem: { minHeight: 40, py: 0 },
  mainContainer: { flexGrow: 1, display: 'flex', flexDirection: 'row' as const, overflow: 'hidden' },
  leftPane: { flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  editorPane: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, p: 2, gap: 2, overflow: 'hidden' }),
  cardPaper: { p: 2, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, gap: 2, bgcolor: 'background.paper' },
  headerBox: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  actionsBox: { display: 'flex', gap: 1 },
  queryPaper: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  queryHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' },
  queryEditorBox: { flexGrow: 1, overflow: 'auto' as const, '& .cm-editor': { height: '100%', outline: 'none', backgroundColor: 'background.paper' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  versionControlBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 }),
  consoleResizer: (isResizing: boolean) => ({ width: 4, cursor: 'col-resize', bgcolor: isResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s' }),
  consolePaper: (width: number) => ({ width, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, borderRadius: 0, bgcolor: 'background.paper' }),
  consoleHeader: { borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 },
  consoleTabs: { minHeight: 36 },
  consoleTabItem: { minHeight: 36, py: 0, fontSize: '0.85rem' },
  consoleContent: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'action.hover' },
  consoleToolbar: { display: 'flex', justifyContent: 'flex-end', p: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' },
  consoleLogsArea: { flexGrow: 1, overflowY: 'auto' as const, p: 1 },
  logItemSql: { fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: 'text.primary', mt: 0.5, bgcolor: 'background.paper', p: 1, borderRadius: 1, border: '1px solid', borderColor: 'divider' },
  logEmpty: { p: 2, textAlign: 'center' as const }
};

export default function ViewWindow(props: ViewWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme();

  const {
    activeTab, setActiveTab, schema, viewName, sourceText, setSourceText, 
    loadSource, handleSave, handleDelete, hasUnsavedChanges, extensions,
    dbmsOutputs, handleClearLogs, isLoading, canSave, sourceError, editorRef, dataRevision,
    metadata, metadataError, metadataLoading, reloadMetadata
  } = useViewWindow(props);

  const [consoleWidth, setConsoleWidth] = useState<number>(350);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState<boolean>(false);

  useEffect(() => {
    if (dbmsOutputs.length > 0) setIsConsoleOpen(true);
  }, [dbmsOutputs]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      let newWidth = window.innerWidth - e.clientX; 
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 800) newWidth = 800;
      setConsoleWidth(newWidth);
    };
    const handleMouseUp = () => setIsResizing(false);
    if (isResizing) { 
      window.addEventListener('mousemove', handleMouseMove); 
      window.addEventListener('mouseup', handleMouseUp); 
    }
    return () => { 
      window.removeEventListener('mousemove', handleMouseMove); 
      window.removeEventListener('mouseup', handleMouseUp); 
    };
  }, [isResizing]);

  return (
    <Box sx={styles.rootBox(props.isActive)}>
      <Box sx={styles.tabsContainer}>
        <Tabs value={activeTab} onChange={(_e, val) => setActiveTab(val as number)} sx={styles.tabs}>
          <Tab label={t("data")} sx={styles.tabItem} />
          <Tab label={hasUnsavedChanges ? `* ${t("edit")}` : t("edit")} sx={styles.tabItem} />
          <Tab label={t("version_control")} sx={styles.tabItem} />
          <Tab label={t("view_information")} sx={styles.tabItem} />
        </Tabs>
      </Box>

      <Box sx={{ ...styles.mainContainer, minHeight: 0, minWidth: 0 }}>
        <Box sx={{ ...styles.leftPane, flex: '1 1 0', minHeight: 0, minWidth: 0 }}>
          {/* Data tab. */}
          <ViewDataTab revision={dataRevision} schema={schema} viewName={viewName} isActive={props.isActive && activeTab === 0} />

          {activeTab === 3 && <ViewMetadataTab data={metadata} error={metadataError} loading={metadataLoading} onRefresh={() => { void reloadMetadata(); }} />}
          {/* Edit tab. */}
          <Box sx={{ ...styles.editorPane(activeTab === 1), minHeight: 0, minWidth: 0 }}>
            {sourceError && <Alert severity="error" action={<Button disabled={isLoading} onClick={() => { void loadSource(); }}>{t('retry')}</Button>}>{sourceError}</Alert>}
            <Paper elevation={1} sx={styles.cardPaper}>
              <Box sx={styles.headerBox}>
                <Typography variant="subtitle1" fontWeight="bold">
                  {t("edit_view")} - {viewName}
                </Typography>
                <Box sx={styles.actionsBox}>
                  <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} disabled={isLoading} disableElevation size="small">
                    {t("delete")}
                  </Button>
                  <Button variant="contained" color="success" startIcon={<PlayArrowIcon />} onClick={handleSave} disabled={!canSave} disableElevation size="small">
                    {t("compile_save")}
                  </Button>
                </Box>
              </Box>
              <Divider />
            </Paper>

            <Paper elevation={1} sx={{ ...styles.queryPaper, flex: '1 1 0', minHeight: 0, minWidth: 0 }}>
              <Box sx={styles.queryHeader}>
                <Typography variant="caption" fontWeight="bold">{t("source_code_create_or_replace_view")}</Typography>
              </Box>
              <Box sx={{
                ...styles.queryEditorBox,
                flex: '1 1 0',
                minHeight: 0,
                minWidth: 0,
                overflow: 'hidden',
                position: 'relative'
              }}>
                <MemoCodeMirror
                  ref={editorRef}
                  editable={!isLoading}
                  value={sourceText} 
                  onChange={setSourceText}
                  height="100%" 
                  extensions={extensions} 
                  basicSetup={EDITOR_SETUP}
                  style={EDITOR_HOST_STYLE}
                  theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                />
              </Box>
            </Paper>
          </Box>

          {/* Version control tab. */}
          <Box sx={styles.versionControlBox(activeTab === 2)}>
            <MemoVersionControlTab
              dbType="ORACLE" 
              schema={schema} 
              objectType="VIEW" 
              objectName={viewName} 
              currentSource={sourceText} 
              onRefresh={loadSource}
              isSourceLoading={isLoading}
            />
          </Box>
        </Box>

        {isConsoleOpen && activeTab === 1 && (
          <React.Fragment>
            <Box onMouseDown={() => setIsResizing(true)} sx={styles.consoleResizer(isResizing)} />
            
            <Paper elevation={1} sx={styles.consolePaper(consoleWidth)}>
              <Box sx={styles.consoleHeader}>
                <Tabs value={0} sx={styles.consoleTabs}>
                  <Tab label={t("console")} sx={styles.consoleTabItem} />
                </Tabs>
                <IconButton size="small" onClick={() => setIsConsoleOpen(false)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={styles.consoleContent}>
                <Box sx={styles.consoleToolbar}>
                  <Tooltip title={t("clear_log")}>
                    <IconButton color="error" onClick={handleClearLogs} size="small">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
                <Box sx={styles.consoleLogsArea}>
                  {dbmsOutputs.length > 0 ? (
                    dbmsOutputs.map((log, i) => (
                      <Typography key={i} variant="body2" sx={styles.logItemSql}>
                        {log}
                      </Typography>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={styles.logEmpty}>
                      {t("no_execution_logs")}
                    </Typography>
                  )}
                </Box>
              </Box>
            </Paper>
          </React.Fragment>
        )}
      </Box>
    </Box>
  );
}
