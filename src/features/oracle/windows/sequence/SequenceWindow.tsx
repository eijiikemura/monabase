// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { SequenceInformationTab } from '@/features/sequence/SequenceInformationTab';
import { WindowLoadingIndicator } from "@/components/feedback/WindowLoadingIndicator";
import { memo } from 'react';
import { Box, Paper, Typography, Tabs, Tab, IconButton, Tooltip, Alert, Button } from '@mui/material';
import { useTheme } from '@mui/material/styles'; // Import theme access helpers.
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { useTranslation } from 'react-i18next';

import SequenceStructureTab from './SequenceStructureTab';
import { useSequenceWindow, type SequenceWindowProps } from './useSequenceWindow';

const MemoCodeMirror = memo(CodeMirror);
const MemoSequenceStructureTab = memo(SequenceStructureTab);
const SOURCE_EXTENSIONS = [sql()];

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
  tabItem: { minHeight: 40, py: 0 },
  settingBox: (isVisible: boolean) => ({ flexGrow: 1, display: isVisible ? 'block' : 'none', overflow: 'hidden', minHeight: 0 }),
  sourceBox: (isVisible: boolean) => ({ minWidth: 0, flexGrow: 1, display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, overflow: 'hidden', p: 1, minHeight: 0 }),
  sourcePaper: { minHeight: 0, minWidth: 0, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', bgcolor: 'background.paper' },
  sourceHeader: { p: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', display: 'flex', justifyContent: 'space-between' },
  cmBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } }
};

const sourceSetup = { lineNumbers: true };

export default function SequenceWindow(props: SequenceWindowProps) {
  const { t } = useTranslation();
  const theme = useTheme(); // Get the current theme.
  
  const {
    isLoading, setIsStructureLoading, activeTab, setActiveTab,
    sourceText, sourceError, sourceReady, loadSource, copySource, handleReload, reloadKey
  } = useSequenceWindow(props);

  return (
    <Box component="fieldset" disabled={isLoading} aria-busy={isLoading} sx={styles.rootBox(props.isActive)}>
      {isLoading && <WindowLoadingIndicator />}
      {!props.isNew && (
        <Box sx={styles.tabsContainer}>
          <Tabs value={activeTab} onChange={(_e, val) => setActiveTab(val as number)} sx={styles.tabs}>
            <Tab disabled={isLoading} label={t("settings")} sx={styles.tabItem} />
            <Tab disabled={isLoading} label={t("source")} sx={styles.tabItem} />
            <Tab disabled={isLoading} label={t("routine_information")} sx={styles.tabItem} />
          </Tabs>
        </Box>
      )}

      <Box sx={styles.settingBox(activeTab === 0)}>
        <MemoSequenceStructureTab
          isWindowLoading={isLoading}
          onLoadingChange={setIsStructureLoading}
          tabId={props.tabId}
          schema={props.schema} 
          sequenceName={props.sequenceName} 
          isNew={props.isNew}
          isActive={props.isActive && activeTab === 0}
          reloadKey={reloadKey}
          onReload={handleReload}
        />
      </Box>

      {!props.isNew && (
        <Box data-testid="sequence-source" sx={styles.sourceBox(activeTab === 1)}>
          <Paper elevation={1} sx={styles.sourcePaper}>
            <Box sx={styles.sourceHeader}>
              <Typography variant="subtitle2" fontWeight="bold">{t("create_sequence_statement_ddl")}</Typography>
              <Button disabled={isLoading} onClick={() => void loadSource()}>{t('refresh')}</Button>
              <Tooltip title={t("copy")}>
                <span>
                  <IconButton disabled={isLoading || !sourceReady} size="small" onClick={() => void copySource()}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
            <Typography variant="caption" sx={{ p: 1 }}>{t('sequence_source_note')}</Typography>
            {sourceError && <Alert severity="error" action={<Button disabled={isLoading} onClick={() => void loadSource()}>{t('retry')}</Button>}>{sourceError}</Alert>}
            <Box sx={styles.cmBox}>
              {/* Apply the CodeMirror theme option. */}
              <MemoCodeMirror
                value={sourceText} 
                height="100%" 
                style={SOURCE_HOST_STYLE}
                extensions={SOURCE_EXTENSIONS}
                readOnly={true} 
                basicSetup={sourceSetup} 
                theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
              />
            </Box>
          </Paper>
        </Box>
      )}
      {!props.isNew && activeTab === 2 && <SequenceInformationTab database="oracle" schema={props.schema} name={props.sequenceName} />}
    </Box>
  );
}
