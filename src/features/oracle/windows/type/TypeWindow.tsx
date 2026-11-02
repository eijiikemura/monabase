// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { TypeInformationTab } from '@/features/type/TypeInformationTab';
import { TypeChangeDialog } from '@/features/type/TypeChangeDialog';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import { memo } from 'react';
import type { ReturnValue } from "@/shared/types/traceTypes";
import { 
  Box, Paper, Tabs, Tab, Button, Tooltip, Alert} from '@mui/material';
import { useTheme } from '@mui/material/styles'; // Import theme access helpers.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';

import { SharedBottomPanel } from "@/features/stored/StoredCommonUI";
import VersionControlTab from "@/features/git/VersionControlTab";

// Use type-only imports to avoid build errors.
import { useTypeWindow, type TypeWindowProps } from './useTypeWindow';

const MemoCodeMirror = memo(CodeMirror);
const MemoSharedBottomPanel = memo(SharedBottomPanel);
const MemoVersionControlTab = memo(VersionControlTab);
const EMPTY_RETURN_VALUES: ReturnValue[] = [];

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
  mainBox: { minWidth: 0, display: 'flex', flexGrow: 1, overflow: 'hidden', flexDirection: 'column' as const, minHeight: 0 },
  paperTop: (isTab1: boolean) => ({ minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', mb: isTab1 ? 0 : 1, minHeight: 0, bgcolor: 'background.paper' }),
  toolbar: { p: 0.5, bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 },
  toolbarActions: { display: 'flex', alignItems: 'center' },
  deleteBtn: { py: 0, minHeight: 24, fontSize: '0.75rem', mr: 1 },
  compileBtn: { py: 0, minHeight: 24, fontSize: '0.75rem' },
  cmBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  versionControlBox: { flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  bottomPanelBox: { height: '30%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider', p: 1, flexShrink: 0, minHeight: 0 }
};

const codeSetup = { lineNumbers: true, autocompletion: true };

export default function TypeWindow(props: TypeWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme(); // Get the current theme.
  
  const {
    isLoading, sourceText, setSourceText, mainTab, setMainTab, sourceReady, sourceError,
    changePlan, handleConfirmCompile, closeChangePlan, retryChangePlan, hasOpenedVersionTab, bottomTab, setBottomTab,
    dbmsOutputs, editorRef, handleCompile, handleDelete, extensions, handleConsoleClick, hasUnsavedChanges, loadObjectInfo, handleClearLogs
  } = useTypeWindow(props);

  if (!props.isActive) return null;

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox(props.isActive)}>
      {isLoading && <WindowLoadingIndicator />}
      {sourceError && <Alert severity="error" action={<Button disabled={isLoading} onClick={() => void loadObjectInfo()}>{t('retry')}</Button>}>{sourceError}</Alert>}
      <Box sx={styles.tabsContainer}>
        <Tabs value={mainTab} onChange={(_e, val) => setMainTab(val as number)} sx={styles.tabs}>
          <Tab disabled={isLoading} value={0} label={t("source") + (hasUnsavedChanges ? ' *' : '')} sx={styles.tabItem(true)} />
          <Tab disabled={isLoading} value={1} label={t("version_control")} sx={styles.tabItem(true)} />
          <Tab disabled={isLoading} value={2} label={t('routine_information')} sx={styles.tabItem(true)} />
        </Tabs>
      </Box>

      <Box sx={styles.mainBox}>
        <Paper elevation={1} sx={styles.paperTop(mainTab !== 0)}>
          
            <Box sx={{
              display: mainTab === 0 ? 'flex' : 'none',
              flexDirection: 'column',
              flex: '1 1 0',
              minHeight: 0
            }}>
              <Box sx={styles.toolbar}>
                <Box></Box>
                <Box sx={styles.toolbarActions}>
                  <Button disabled={isLoading || !sourceReady} variant="outlined" color="error" size="small" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} sx={styles.deleteBtn}>
                    {t("delete")}
                  </Button>
                  <Tooltip title={t("compile_source_code")}>
                    <span>
                      <Button disabled={isLoading || !sourceReady} variant="outlined" color="primary" size="small" onClick={handleCompile} sx={styles.compileBtn}>
                        {t("compile")}
                      </Button>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
              <Box sx={styles.cmBox}>
                {/* Apply the CodeMirror theme option. */}
                <MemoCodeMirror
                  editable={!isLoading && sourceReady && !changePlan}
                  ref={editorRef} 
                  value={sourceText} 
                  height="100%" 
                  style={SOURCE_HOST_STYLE}
                  extensions={extensions} 
                  onChange={setSourceText}
                  basicSetup={codeSetup} 
                  theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
                />
              </Box>
            </Box>

          {hasOpenedVersionTab && (
            <Box sx={[styles.versionControlBox, { display: mainTab === 1 ? 'flex' : 'none' }]}>
              <MemoVersionControlTab
                isSourceLoading={isLoading}
                dbType="ORACLE" 
                schema={props.schema} 
                objectType="TYPE" 
                objectName={props.typeName} 
                currentSource={sourceText} 
                onRefresh={loadObjectInfo} 
              />
            </Box>
          )}
          {mainTab === 2 && <TypeInformationTab database="oracle" schema={props.schema} name={props.typeName} />}
        </Paper>

        <Box sx={[
          styles.bottomPanelBox,
          { display: mainTab === 0 ? 'flex' : 'none' }
        ]}>
          <MemoSharedBottomPanel bottomTab={bottomTab} setBottomTab={setBottomTab} returnValues={EMPTY_RETURN_VALUES} displayOutputs={dbmsOutputs} handleClearLogs={handleClearLogs} handleConsoleClick={handleConsoleClick} />
        </Box>
      </Box>
      <TypeChangeDialog plan={changePlan} busy={isLoading} ready={sourceReady} onClose={closeChangePlan} onConfirm={() => void handleConfirmCompile()} onRetry={() => void retryChangePlan()} />
    </Box>
  );
}
