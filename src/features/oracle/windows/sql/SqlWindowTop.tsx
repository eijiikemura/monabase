// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import SqlEditorToolbar, { useSqlEditorLayout } from '@/features/sql/SqlEditorToolbar';
import CloseIcon from '@mui/icons-material/Close';

import React, { memo, useCallback, useId } from 'react';
import { 
  Box, Paper, Typography, FormControlLabel, Checkbox, Button, Drawer,
  IconButton, Divider, TextField, FormControl, Select, MenuItem, Tooltip
} from '@mui/material';
import { useTheme } from '@mui/material/styles'; 
import PlayArrowIcon from '@mui/icons-material/PlayArrow'; 
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import AiRequestButton from "@/features/ai/AiRequestButton";
import CodeMirror from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';

import DateInput from "@/components/data/DateInput";
import { DEFAULT_DATE_FORMAT } from "@/shared/utils/dateFormatter";
import { useSqlWindowTop, type SqlWindowTopProps } from './useSqlWindowTop';

// Extend the source editor to the bottom of its available area.
const SOURCE_HOST_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  height: '100%',
  width: '100%'
};

const styles = {
  rootBox: (height: number | string) => ({ display: 'flex', height, flexShrink: 0, gap: 1, minHeight: 0, minWidth: 0, width: '100%' }),
  editorPaper: { p: 2, flexGrow: 1, display: 'flex', flexDirection: 'column' as const, minWidth: 0, minHeight: 0, bgcolor: 'background.paper' },
  cmBox: { minHeight: 0, minWidth: 0, flex: '1 1 0', position: 'relative' as const, overflow: 'hidden' as const, mb: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1, '& .cm-editor': { height: '100%', outline: 'none' }, '& .cm-scroller': { fontFamily: 'monospace', fontSize: '0.95rem' } },
  playBtn: { bgcolor: 'success.main', color: 'white', '&:hover': { bgcolor: 'success.dark' }, borderRadius: 1 },
  checkboxLabel: (isActive: boolean) => ({ fontWeight: 'bold', color: isActive ? 'primary.main' : 'text.secondary' }),
  checkboxFormControl: { m: 0, ml: 1 },
  divider: { mx: 1 },
  formatBtn: { border: '1px solid', borderColor: 'divider', borderRadius: 1 },
  bindVarPaper: { width: 350, flexShrink: 0, display: 'flex', flexDirection: 'column' as const, bgcolor: 'background.paper', overflow: 'hidden', minHeight: 0 },
  bindVarHeader: { p: 1, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center' },
  bindVarList: { p: 2, flexGrow: 1, overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: 2 },
  bindVarItemBox: { display: 'flex', flexDirection: 'column' as const, gap: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' },
  selectWhite: { bgcolor: 'background.paper' }
};

const codeSetup = { lineNumbers: true, autocompletion: true };

interface SqlWindowTopExtendedProps extends Omit<SqlWindowTopProps, 'setIsLoading'> {
  fileActions?: React.ReactNode;
  handleRequestAi?: () => void;
  isAiGenerating?: boolean;
  setIsLoading?: React.Dispatch<React.SetStateAction<boolean>>;
  ignoreBindVars?: boolean;
  setIgnoreBindVars?: (val: boolean) => void;
}

// Memoize the toolbar and describe actions with tooltips.
const SqlToolbar = memo(({
  isExplainMode, setIsExplainMode, ignoreBindVars, setIgnoreBindVars,
  handleExecuteSql, handleFormatSql, handleRequestAi, isAiGenerating, fileActions, bindToggle
}: {
  fileActions?: React.ReactNode;
  bindToggle?: React.ReactNode;
  isExplainMode: boolean;
  setIsExplainMode: (val: boolean) => void;
  ignoreBindVars?: boolean;
  setIgnoreBindVars?: (val: boolean) => void;
  handleExecuteSql: (e?: React.MouseEvent) => void;
  handleFormatSql: () => void;
  handleRequestAi?: () => void;
  isAiGenerating?: boolean;
}) => {
  const { t } = useTranslation();

  return (
    <SqlEditorToolbar primary={<>

      <Tooltip title={isExplainMode
        ? t("analyze_the_sql_execution_plan_f5")
        : t("execute_sql_or_only_the_selected_text_if_a_selection_exists_f5")}>
        <Box component="span" sx={{ display: 'inline-flex' }}><IconButton disabled={isAiGenerating} color="success" size="small" onClick={handleExecuteSql}
          sx={styles.playBtn} aria-label={isExplainMode ? t("analyze_sql_execution_plan") : t("execute_sql")} disableRipple>
          <PlayArrowIcon />
        </IconButton></Box>
      </Tooltip>

      {bindToggle}
    </>}>
      <Tooltip title={t("when_checked_the_execute_button_analyzes_the_sql_execution_plan")}>
        <FormControlLabel
          control={<Checkbox disabled={isAiGenerating} size="small" checked={isExplainMode}
            onChange={(e) => setIsExplainMode(e.target.checked)} disableRipple />}
          label={<Typography variant="body2" sx={styles.checkboxLabel(isExplainMode)}>{t("parse")}</Typography>}
          sx={styles.checkboxFormControl}
        />
      </Tooltip>

      {setIgnoreBindVars && (
        <Tooltip title={t("execute_sql_as_written_without_treating_variable_name_as_a_bind_variable")}>
          <FormControlLabel
            control={<Checkbox disabled={isAiGenerating} size="small" checked={ignoreBindVars || false}
              onChange={(e) => setIgnoreBindVars(e.target.checked)} disableRipple />}
            label={<Typography variant="body2" sx={styles.checkboxLabel(ignoreBindVars || false)}>{t("disable_bind_variables")}</Typography>}
            sx={styles.checkboxFormControl}
          />
        </Tooltip>
      )}

      <Divider orientation="vertical" flexItem sx={styles.divider} />
      {fileActions}
      <Tooltip title={t("format_sql_line_breaks_and_indentation_and_uppercase_keywords")}>
        <Box component="span" sx={{ display: 'inline-flex' }}><IconButton disabled={isAiGenerating} color="info" size="small" onClick={handleFormatSql}
          sx={styles.formatBtn} aria-label={t("format_sql")} disableRipple>
          <AutoFixHighIcon />
        </IconButton></Box>
      </Tooltip>
      {handleRequestAi && (
        <Tooltip title={t("ask_ai_to_create_or_modify_sql_using_the_current_sql_as_context")}>
          <Box component="span" sx={{ display: 'inline-flex' }}><AiRequestButton disabled={isAiGenerating} onClick={handleRequestAi} sx={styles.formatBtn} aria-label={t("ask_ai_to_create_or_modify_sql")} /></Box>
        </Tooltip>
      )}

    </SqlEditorToolbar>
  );
});
SqlToolbar.displayName = 'SqlToolbar';

function SqlWindowTopComponent(props: SqlWindowTopExtendedProps) {
  const { t } = useTranslation();
  const layout = useSqlEditorLayout();
  const bindPanelId = useId();
  const hasBindings = !props.ignoreBindVars && props.bindVariables.length > 0;
  const bindingVisible = hasBindings && layout.bindOpen;
  const theme = useTheme(); 
  const { extensions } = useSqlWindowTop(props as SqlWindowTopProps);

  const handleTextChange = useCallback((value: string) => {
    if (!props.isAiGenerating) props.setSqlText(value);
  }, [props]);

  const handleExplainChange = useCallback((val: boolean) => {
    props.setIsExplainMode(val);
  }, [props]);

  const bindPanel = (
    <Paper id={bindPanelId} data-testid="sql-bind-panel" elevation={1} sx={{ ...styles.bindVarPaper, width: layout.narrow ? 'min(350px, 90vw)' : 350, height: '100%' }}>
          <Box sx={styles.bindVarHeader}>
            <Typography variant="subtitle2" fontWeight="bold">{t("bind_variables")}</Typography>
            <Tooltip title={t('sql_hide_bind_variables')}><IconButton size="small" aria-label={t('sql_hide_bind_variables')} onClick={() => layout.setBindOpen(false)} sx={{ ml: 'auto' }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
          </Box>
          <Box sx={styles.bindVarList}>
            {props.bindVariables.map(v => (
              <Box key={v} sx={styles.bindVarItemBox}>
                <Typography variant="subtitle2" fontWeight="bold" color="primary">:{v}</Typography>
                <FormControl size="small" fullWidth>
                  <Tooltip title={t("select_the_variable_value_type")}>
                    <Select disabled={props.isAiGenerating} value={props.bindTypes[v] || 'STRING'} onChange={(e) => props.setBindTypes(prev => ({ ...prev, [v]: e.target.value }))} sx={styles.selectWhite}>
                      <MenuItem value="STRING">{t("string_2")}</MenuItem>
                      <MenuItem value="NUMBER">{t("number_3")}</MenuItem>
                      <MenuItem value="DATE">{t("date_2")}</MenuItem>
                    </Select>
                  </Tooltip>
                </FormControl>
                <Tooltip title={t("enter_the_value_to_pass_to_the_variable_during_sql_execution")}>
                  <Box component="span" sx={{ display: 'block' }}>
                    {props.bindTypes[v] === 'DATE' ? (
                      <DateInput disabled={props.isAiGenerating} value={props.bindValues[v] || ''} onChange={(newVal) => props.setBindValues(prev => ({ ...prev, [v]: newVal }))} inputDateFormat={props.localInputDateFormat || DEFAULT_DATE_FORMAT} sx={styles.selectWhite} />
                    ) : (
                      <TextField disabled={props.isAiGenerating} size="small" fullWidth value={props.bindValues[v] || ''} onChange={(e) => props.setBindValues(prev => ({ ...prev, [v]: e.target.value }))} variant="outlined" placeholder={props.bindTypes[v] === 'NUMBER' ? t("number") : t("text")} sx={styles.selectWhite} />
                    )}
                  </Box>
                </Tooltip>
              </Box>
            ))}
          </Box>
        </Paper>
  );

  return (
    <Box ref={layout.rootRef} sx={styles.rootBox(props.editorHeight)}>
      <Paper elevation={1} sx={styles.editorPaper}>
        <Box sx={styles.cmBox}>
          <CodeMirror 
            ref={props.editorRef} 
            value={props.sqlText}
            readOnly={props.isAiGenerating}
            editable={!props.isAiGenerating}
            height="100%" 
            style={SOURCE_HOST_STYLE}
            extensions={extensions} 
            onChange={handleTextChange} 
            basicSetup={codeSetup} 
            theme={theme.palette.mode === 'dark' ? 'dark' : 'light'} 
          />
        </Box>
        
        {!props.hideToolbar && (
          <SqlToolbar
            isExplainMode={props.isExplainMode}
            setIsExplainMode={handleExplainChange}
            ignoreBindVars={props.ignoreBindVars}
            setIgnoreBindVars={props.setIgnoreBindVars}
            fileActions={props.fileActions}
            bindToggle={hasBindings && <Tooltip title={t(bindingVisible ? 'sql_hide_bind_variables' : 'sql_show_bind_variables')}>
              <Button size="small" aria-label={t(bindingVisible ? 'sql_hide_bind_variables' : 'sql_show_bind_variables')} aria-expanded={bindingVisible}
                aria-controls={bindingVisible ? bindPanelId : undefined} onClick={() => layout.setBindOpen(!bindingVisible)} sx={{ whiteSpace: 'nowrap' }}>
                {t('sql_bind_count', { count: props.bindVariables.length })}
              </Button>
            </Tooltip>}
            handleExecuteSql={props.handleExecuteSql}
            handleFormatSql={props.handleFormatSql}
            handleRequestAi={props.handleRequestAi}
            isAiGenerating={props.isAiGenerating}
          />
        )}
      </Paper>

      {bindingVisible && (layout.narrow
        ? <Drawer anchor="right" open PaperProps={{ role: 'dialog', 'aria-label': t('bind_variables') }} onClose={() => layout.setBindOpen(false)}>{bindPanel}</Drawer>
        : bindPanel)}

    </Box>
  );
}

// Compare every prop, including toolbar actions and execution callbacks.
export default memo(SqlWindowTopComponent);
