// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useSqlPaneLayout, SqlPaneControls } from '@/features/sql/SqlPaneLayout';
import SqlPrivacyToggle from '@/features/sql/SqlPrivacyToggle';
import { useSqlFile } from '@/features/sql/useSqlFile';
import SqlFileActions from '@/features/sql/SqlFileActions';

import { memo, useCallback, useLayoutEffect, useState } from 'react';
import { Box, LinearProgress, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAiObjectSelection } from "@/features/ai/useAiObjectSelection";

import SqlWindowTop from './SqlWindowTop';
import { useAiSqlGeneration } from "@/features/ai/useAiSqlGeneration";
import SqlWindowBottom from "@/features/sql/SqlWindowBottom";

import { useSqlWindow, type SqlWindowProps } from './useSqlWindow';

const styles = {
  rootBox: (isActive: boolean) => ({ flexGrow: 1, display: isActive ? 'flex' : 'none', flexDirection: 'column' as const, py: 2, px: 2, gap: 1, overflow: 'hidden', height: '100%', position: 'relative' as const, minHeight: 0, bgcolor: 'background.default' }),
  resizer: (isResizing: boolean) => ({ height: 8, cursor: 'row-resize', bgcolor: isResizing ? 'primary.main' : 'transparent', '&:hover': { bgcolor: 'primary.main' }, transition: 'background-color 0.2s', mx: -2, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }),
  resizerInner: (isResizing: boolean) => ({ width: 40, height: 2, bgcolor: isResizing ? 'background.paper' : 'divider', borderRadius: 1 })
};

interface SqlWindowExtendedProps extends SqlWindowProps {
  schemas?: string[];
}

function SqlWindowPostgresql(props: SqlWindowExtendedProps) {
  const { t } = useTranslation();
  const {
    privateExecution, setPrivateExecution,
    sqlText, setSqlText, columns, rows, isExplainResult, explainSnapshot, resultSummary,
    isLoading,
    isExplainMode, setIsExplainMode,
    bottomTab, setBottomTab, logs, historyLogs, historyLimit,
    localInputDateFormat, compileErrors,
    editorRef, bindValues, setBindValues, bindTypes, setBindTypes, bindVariables,
    handleFormatSql, handleExecuteSql, handleClearLogs, handleClearHistory, handleConsoleClick,
    selectedSchema, setSelectedSchema,
    ignoreBindVars, setIgnoreBindVars 
  } = useSqlWindow(props);
  const panes = useSqlPaneLayout(props.isActive);
  const changePaneMode = panes.changeMode;
  const [pendingLogLine, setPendingLogLine] = useState<string | null>(null);
  const handleLogNavigation = useCallback((line: string) => {
    changePaneMode('split');
    setPendingLogLine(line);
  }, [changePaneMode]);
  useLayoutEffect(() => {
    if (pendingLogLine === null) return;
    if (props.isActive) handleConsoleClick(pendingLogLine);
    setPendingLogLine(null);
  }, [pendingLogLine, props.isActive, handleConsoleClick]);
  const paneControls = <SqlPaneControls mode={panes.mode} onChange={panes.changeMode} />;
  const sqlFile = useSqlFile({ sql: sqlText, setSql: setSqlText });
  const objectSelection = useAiObjectSelection({ dbType: 'postgresql', initialSchema: selectedSchema });

  const aiSqlGeneration = useAiSqlGeneration({ sqlText, setSqlText, isActive: props.isActive, dbType: 'postgresql', schema: selectedSchema });

  const handleRequestAi = useCallback(() => {
    if (!props.isAiEnabled) {
      alert(t("ai_enable_support_instructions"));
      return;
    }
    if (!props.onOpenAiSidebar) {
      alert(t("cannot_start_an_ai_request_because_the_ai_sidebar_opener_is_unavailable"));
      return;
    }
    props.onOpenAiSidebar({
      targetTab: props.title,
      requestType: "sql_generation",
      requestId: crypto.randomUUID(),
      objectSelection,
      referencePrompt: 'PostgreSQL用のSQLを作成してください。',
      sqlResponse: aiSqlGeneration.responseTarget
    });
  }, [props, objectSelection, aiSqlGeneration.responseTarget, t]);

  if (!props.isActive) return null;

  return (
    <Box ref={panes.rootRef} sx={styles.rootBox(props.isActive)}>
      {(aiSqlGeneration.isGenerating || aiSqlGeneration.isApplied) && (
        <Box role="status" sx={{ flexShrink: 0, px: 1, py: 0.5, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="primary">
            {aiSqlGeneration.isGenerating ? t("ai_is_generating_sql") : t("applied_the_generated_sql")}
          </Typography>
          {aiSqlGeneration.isGenerating && <LinearProgress />}
        </Box>
      )}
      <Box sx={{ display: panes.mode === 'result' ? 'none' : 'flex', flexDirection: 'column', minHeight: 0, flex: panes.mode === 'editor' ? '1 1 0' : '0 0 auto', height: panes.mode === 'editor' ? undefined : panes.height }}>
      <SqlWindowTop
        fileActions={<>{paneControls}<SqlFileActions onOpen={sqlFile.openFile} onSaveAs={sqlFile.saveAs} disabled={aiSqlGeneration.isGenerating || isLoading || sqlFile.isProcessing} /><SqlPrivacyToggle active={privateExecution} onChange={setPrivateExecution} disabled={aiSqlGeneration.isGenerating || isLoading || sqlFile.isProcessing} /></>}
        sqlText={aiSqlGeneration.displaySql} setSqlText={setSqlText} editorHeight="100%"
        isExplainMode={isExplainMode} setIsExplainMode={setIsExplainMode}
        handleExecuteSql={handleExecuteSql} handleFormatSql={handleFormatSql}
        handleRequestAi={handleRequestAi}
        isAiGenerating={aiSqlGeneration.isGenerating || isLoading || sqlFile.isProcessing}
        editorRef={editorRef} compileErrors={compileErrors} localInputDateFormat={localInputDateFormat}
        bindVariables={bindVariables} bindValues={bindValues} setBindValues={setBindValues}
        bindTypes={bindTypes} setBindTypes={setBindTypes}
        schemas={props.schemas} 
        selectedSchema={selectedSchema} 
        setSelectedSchema={setSelectedSchema} 
        ignoreBindVars={ignoreBindVars}       
        setIgnoreBindVars={setIgnoreBindVars} 
      />

      </Box>
      {panes.mode === 'split' && <Box
        {...panes.separatorProps}
        aria-label={t('sql_resize_panes')}
        title={t('sql_resize_panes_help')}
        sx={{ ...styles.resizer(panes.isResizing), '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}
      >
        <Box sx={styles.resizerInner(panes.isResizing)} />
      </Box>}
      <Box sx={{ display: panes.mode === 'editor' ? 'none' : 'flex', flex: 1, minHeight: 0 }}>
      <SqlWindowBottom
        isVisible={panes.mode !== 'editor'}
        layoutActions={paneControls}
        resultSummary={resultSummary} rows={rows} columns={columns} isExplainResult={isExplainResult} explainSnapshot={explainSnapshot}
        bottomTab={bottomTab} setBottomTab={setBottomTab} logs={logs} historyLogs={historyLogs} historyLimit={historyLimit}
        handleClearLogs={handleClearLogs} handleClearHistory={handleClearHistory} handleConsoleClick={handleLogNavigation}
        setSqlText={setSqlText} dateFormat={props.dateFormat} 
        sqlText={sqlText}
        dbInfo={props.dbInfo}
        dbType="postgresql"
        selectedSchema={selectedSchema}
        title={props.title}
        isAiEnabled={props.isAiEnabled || false}
        onOpenAiSidebar={props.onOpenAiSidebar || (() => {})}
      />
      </Box>
    </Box>
  );
}

export default memo(SqlWindowPostgresql);
