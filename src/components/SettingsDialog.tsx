// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { 
  Box, TextField, Button, Dialog,
  DialogTitle, DialogContent, DialogActions, FormControl, InputLabel, Select, MenuItem,
  Tabs, Tab, FormHelperText, IconButton, Tooltip, FormControlLabel, Switch
} from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { useSettingsDialog, type SettingsDialogProps } from './useSettingsDialog';

const styles = {
  dialogContent: { pt: 0, minWidth: 0, height: 480 },
  tabsWrapper: { borderBottom: 1, borderColor: 'divider', mb: 2 },
  boxContainer: (isVisible: boolean) => ({ display: isVisible ? 'flex' : 'none', flexDirection: 'column' as const, gap: 2, mt: 1 }),
  resetButton: { mr: 'auto' }
};

export default function SettingsDialog(props: SettingsDialogProps) {
  const logic = useSettingsDialog(props);
  const { t } = logic;

  return (
    <Dialog open={props.isOpen} onClose={props.isSaving ? undefined : props.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("settings")}</DialogTitle>
      <DialogContent sx={styles.dialogContent}>
        <Box sx={styles.tabsWrapper}>
          <Tabs variant="scrollable" scrollButtons="auto" value={logic.activeTab} onChange={logic.handleTabChange}>
            <Tab disabled={props.isSaving} label={t("general")} />
            <Tab disabled={props.isSaving} label={t("view_4")} />
            <Tab disabled={props.isSaving} label={t('Oracle')} />
            <Tab disabled={props.isSaving} label={t('ai_settings_tab')} />
            <Tab disabled={props.isSaving} label={t('files_settings_tab')} />
          </Tabs>
        </Box>

        {/* General tab. */}
        <Box sx={styles.boxContainer(logic.activeTab === 0)}>
          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t("language")}</InputLabel>
            <Select
              value={logic.tempLanguage}
              label={t("language")}
              onChange={(e) => logic.setTempLanguage(e.target.value)}
            >
              <MenuItem value="ja">{t("japanese")}</MenuItem>
              <MenuItem value="en">{t("english")}</MenuItem>
            </Select>
          </FormControl>

          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t("timezone")}</InputLabel>
            <Select
              value={logic.tempTimezone}
              label={t("timezone")}
              onChange={(e) => logic.setTempTimezone(e.target.value)}
            >
              <MenuItem value="-12:00">UTC-12:00</MenuItem>
              <MenuItem value="-11:00">UTC-11:00</MenuItem>
              <MenuItem value="-10:00">UTC-10:00 (Hawaii)</MenuItem>
              <MenuItem value="-09:00">UTC-09:00 (Alaska)</MenuItem>
              <MenuItem value="-08:00">UTC-08:00 (Pacific Time)</MenuItem>
              <MenuItem value="-07:00">UTC-07:00 (Mountain Time)</MenuItem>
              <MenuItem value="-06:00">UTC-06:00 (Central Time)</MenuItem>
              <MenuItem value="-05:00">UTC-05:00 (Eastern Time)</MenuItem>
              <MenuItem value="-04:00">UTC-04:00</MenuItem>
              <MenuItem value="-03:00">UTC-03:00</MenuItem>
              <MenuItem value="-02:00">UTC-02:00</MenuItem>
              <MenuItem value="-01:00">UTC-01:00</MenuItem>
              <MenuItem value="+00:00">UTC+00:00 (London, GMT)</MenuItem>
              <MenuItem value="+01:00">UTC+01:00 (Paris, Berlin)</MenuItem>
              <MenuItem value="+02:00">UTC+02:00 (Cairo)</MenuItem>
              <MenuItem value="+03:00">UTC+03:00 (Moscow)</MenuItem>
              <MenuItem value="+04:00">UTC+04:00 (Dubai)</MenuItem>
              <MenuItem value="+05:00">UTC+05:00</MenuItem>
              <MenuItem value="+05:30">UTC+05:30 (India)</MenuItem>
              <MenuItem value="+06:00">UTC+06:00</MenuItem>
              <MenuItem value="+07:00">UTC+07:00 (Bangkok)</MenuItem>
              <MenuItem value="+08:00">UTC+08:00 (Singapore, Beijing)</MenuItem>
              <MenuItem value="+09:00">UTC+09:00 (Tokyo, Seoul)</MenuItem>
              <MenuItem value="+09:30">UTC+09:30</MenuItem>
              <MenuItem value="+10:00">UTC+10:00 (Sydney)</MenuItem>
              <MenuItem value="+11:00">UTC+11:00</MenuItem>
              <MenuItem value="+12:00">UTC+12:00 (Auckland)</MenuItem>
            </Select>
          </FormControl>

          <TextField
            disabled={props.isSaving}
            label={t("sql_timeout_in_seconds_0_for_unlimited")}
            type="number"
            fullWidth
            variant="outlined"
            size="small"
            {...logic.numericFieldProps('queryTimeout')}
            value={logic.tempQueryTimeout ?? 0}
            onChange={(e) => logic.setTempQueryTimeout(logic.parseNumericInput(String(e.target.value)))}
            inputProps={{ min: 0 }}
          />

          <TextField
            disabled={props.isSaving}
            label={t("max_visible_tabs_1_99")}
            type="number"
            fullWidth
            variant="outlined"
            size="small"
            {...logic.numericFieldProps('maxTabs')}
            value={logic.tempMaxTabs}
            onChange={(e) => logic.setTempMaxTabs(logic.parseNumericInput(String(e.target.value)))}
            inputProps={{ min: 1, max: 99 }}
          />
          
          <Box>
            <FormControlLabel label={t('sql_history_enabled')}
              control={<Switch disabled={props.isSaving} checked={logic.tempSqlHistoryEnabled}
                onChange={event => logic.setTempSqlHistoryEnabled(event.target.checked)} />} />
            <FormHelperText>{t('sql_history_privacy_help')}</FormHelperText>
          </Box>
          <TextField
            disabled={props.isSaving}
            label={t("sql_history_save_limit_1_999")}
            type="number"
            fullWidth
            variant="outlined"
            size="small"
            {...logic.numericFieldProps('sqlHistoryLimit')}
            value={logic.tempSqlHistoryLimit}
            onChange={(e) => logic.setTempSqlHistoryLimit(logic.parseNumericInput(String(e.target.value)))}
            inputProps={{ min: 1, max: 999 }}
          />
        </Box>

        {/* Display tab. */}
        <Box sx={styles.boxContainer(logic.activeTab === 1)}>
          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t("app_theme_design")}</InputLabel>
            <Select
              value={logic.tempTheme}
              label={t("app_theme_design")}
              onChange={(e) => logic.setTempTheme(e.target.value)}
            >
              <MenuItem value="mona">{t("mona_style")}</MenuItem>
              <MenuItem value="simple">{t("simple_style")}</MenuItem>
              <MenuItem value="dark">{t("dark_style")}</MenuItem>
            </Select>
          </FormControl>

          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t("date_display_format")}</InputLabel>
            <Select
              value={logic.tempOutputDateFormat}
              label={t("date_display_format")}
              onChange={(e) => logic.setTempOutputDateFormat(e.target.value)}
            >
              <MenuItem value="YYYY/MM/DD HH:mm:ss">YYYY/MM/DD HH:mm:ss</MenuItem>
              <MenuItem value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss</MenuItem>
              <MenuItem value="MM/DD/YYYY HH:mm:ss">MM/DD/YYYY HH:mm:ss</MenuItem>
              <MenuItem value="DD/MM/YYYY HH:mm:ss">DD/MM/YYYY HH:mm:ss</MenuItem>
              <MenuItem value="DD-MMM-YY HH:mm:ss">DD-MMM-YY HH:mm:ss</MenuItem>
            </Select>
          </FormControl>
          
          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t("date_input_format")}</InputLabel>
            <Select
              value={logic.tempInputDateFormat}
              label={t("date_input_format")}
              onChange={(e) => logic.setTempInputDateFormat(e.target.value)}
            >
              <MenuItem value="YYYY/MM/DD">YYYY/MM/DD</MenuItem>
              <MenuItem value="YYYY/MM/DD HH:mm:ss">YYYY/MM/DD HH:mm:ss</MenuItem>
              <MenuItem value="YYYY-MM-DD">YYYY-MM-DD</MenuItem>
              <MenuItem value="YYYY-MM-DD HH:mm:ss">YYYY-MM-DD HH:mm:ss</MenuItem>
              <MenuItem value="MM/DD/YYYY">MM/DD/YYYY</MenuItem>
              <MenuItem value="MM/DD/YYYY HH:mm:ss">MM/DD/YYYY HH:mm:ss</MenuItem>
              <MenuItem value="DD/MM/YYYY">DD/MM/YYYY</MenuItem>
              <MenuItem value="DD/MM/YYYY HH:mm:ss">DD/MM/YYYY HH:mm:ss</MenuItem>
              <MenuItem value="DD-MMM-YY">DD-MMM-YY</MenuItem>
              <MenuItem value="DD-MMM-YY HH:mm:ss">DD-MMM-YY HH:mm:ss</MenuItem>
            </Select>
          </FormControl>

          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t("number_format")}</InputLabel>
            <Select
              value={logic.tempNumberFormat}
              label={t("number_format")}
              onChange={(e) => logic.setTempNumberFormat(e.target.value)}
            >
              <MenuItem value="none">{t("none_1234567")}</MenuItem>
              <MenuItem value="comma">{t("comma_1_234_567")}</MenuItem>
              <MenuItem value="period">{t("period_1_234_567")}</MenuItem>
              <MenuItem value="space">{t("space_1_234_567")}</MenuItem>
            </Select>
            <FormHelperText>{t("applied_to_the_aggregated_values_of_the_cross_tab")}</FormHelperText>
          </FormControl>
        </Box>

        {/* Oracle tab. */}
        <Box sx={styles.boxContainer(logic.activeTab === 2)}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              disabled={props.isSaving}
              label={t("oracle_client_path_os_authentication_thick_mode")}
              placeholder={t("example_c_oracle_instantclient_19_21")}
              fullWidth
              variant="outlined"
              size="small"
              value={logic.tempOracleClientPath}
              onChange={(e) => logic.setTempOracleClientPath(e.target.value)}
              helperText={t("select_a_64_bit_instant_client_oracle_home_folder")}
            />
            <Tooltip title={t("select_folder")}>
              <IconButton
                disabled={props.isSaving}
                color="primary" 
                onClick={logic.handleSelectOracleFolder} 
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 2.5 }}
              >
                <FolderOpenIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* AI tab. Limits apply to the next request, including error and streamed bodies. */}
        <Box sx={styles.boxContainer(logic.activeTab === 3)} data-testid="ai-response-settings">
          <FormControl disabled={props.isSaving} fullWidth size="small">
            <InputLabel>{t('ux_ai_send_key')}</InputLabel>
            <Select label={t('ux_ai_send_key')} value={logic.tempAiSendKey} onChange={event => logic.setTempAiSendKey(event.target.value === 'modifier-enter' ? 'modifier-enter' : 'enter')}>
              <MenuItem value="enter">{t('ux_send_enter')}</MenuItem>
              <MenuItem value="modifier-enter">{t('ux_send_modifier_enter')}</MenuItem>
            </Select>
            <FormHelperText>{t('ux_send_key_help')}</FormHelperText>
          </FormControl>
          <FormHelperText>{t('ai_limits_help')}</FormHelperText>
          <TextField disabled={props.isSaving} fullWidth size="small" type="number"
            label={t('ai_response_max_mb')} value={logic.tempAiResponseMaxMb}
            onChange={event => logic.setTempAiResponseMaxMb(logic.parseNumericInput(String(event.target.value)))}
            inputProps={{ min: 1, max: 64, step: 1 }} {...logic.numericFieldProps('aiResponseMaxMb', t('ai_response_max_mb_help'))} />
          <TextField disabled={props.isSaving} fullWidth size="small" type="number"
            label={t('ai_idle_timeout_seconds')} value={logic.tempAiIdleTimeoutSeconds}
            onChange={event => logic.setTempAiIdleTimeoutSeconds(logic.parseNumericInput(String(event.target.value)))}
            inputProps={{ min: 1, max: 3600, step: 1 }} {...logic.numericFieldProps('aiIdleTimeoutSeconds', t('ai_idle_timeout_help'))} />
          <TextField disabled={props.isSaving} fullWidth size="small" type="number"
            label={t('ai_request_timeout_seconds')} value={logic.tempAiRequestTimeoutSeconds}
            onChange={event => logic.setTempAiRequestTimeoutSeconds(logic.parseNumericInput(String(event.target.value)))}
            inputProps={{ min: 1, max: 86400, step: 1 }} {...logic.numericFieldProps('aiRequestTimeoutSeconds', t('ai_request_timeout_help'))} />
        </Box>

        {/* File tab. File-type restrictions remain enforced by the main process. */}
        <Box sx={styles.boxContainer(logic.activeTab === 4)} data-testid="file-read-settings">
          <FormHelperText>{t('file_limits_help')}</FormHelperText>
          <TextField disabled={props.isSaving} fullWidth size="small" type="number"
            label={t('sql_file_max_mb')} value={logic.tempSqlFileMaxMb}
            onChange={event => logic.setTempSqlFileMaxMb(logic.parseNumericInput(String(event.target.value)))}
            inputProps={{ min: 1, max: 64, step: 1 }} {...logic.numericFieldProps('sqlFileMaxMb', t('file_limit_range'))} />
          <TextField disabled={props.isSaving} fullWidth size="small" type="number"
            label={t('er_file_max_mb')} value={logic.tempErFileMaxMb}
            onChange={event => logic.setTempErFileMaxMb(logic.parseNumericInput(String(event.target.value)))}
            inputProps={{ min: 1, max: 64, step: 1 }} {...logic.numericFieldProps('erFileMaxMb', t('file_limit_range'))} />
        </Box>

      </DialogContent>
      <DialogActions>
        <Button disabled={props.isSaving} onClick={logic.handleReset} color="secondary" sx={styles.resetButton}>{t("apply_default")}</Button>
        <Button disabled={props.isSaving} onClick={props.onClose}>{t("cancel")}</Button>
        <Button disabled={props.isSaving} onClick={logic.handleSaveClick} variant="contained" color="primary">{t("save")}</Button>
      </DialogActions>
    </Dialog>
  );
}
