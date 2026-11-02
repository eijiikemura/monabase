// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { 
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, 
  DialogActions, TextField, FormControlLabel, Checkbox, 
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Tooltip, Alert
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet';

// Common providers offering OpenAI-compatible APIs.
const COMPATIBLE_PROVIDERS = [
  { name: 'OpenAI (ChatGPT)', url: 'https://api.openai.com/v1' },
  { name: 'Claude (Anthropic)', url: 'https://api.anthropic.com/v1' },
  { name: 'Gemini (Google)', url: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'Ollama', url: 'http://localhost:11434/v1' },
  { name: 'LM Studio', url: 'http://localhost:1234/v1' },
];

export default function AiSettingsDialog({ aiLogic }: { aiLogic: ReturnType<typeof import('./useAiSettings').useAiSettings> }) {
  const { 
    t, aiSettingsDialogOpen, setAiSettingsDialogOpen, 
    providerPopupOpen, setProviderPopupOpen,
    isAiEnabled, setIsAiEnabled, 
    apiKey, setApiKey, credentialUnavailable, modelName, setModelName,
    endpointUrl, setEndpointUrl,
    isProcessing, isLoading, loadError, canEditSettings, retryLoadSettings, handleSave
  } = aiLogic;
  
  const theme = useTheme();
  const isDarkTheme = theme.palette.mode === 'dark';

  const handleProviderSelect = (url: string) => {
    setEndpointUrl(url);
    setProviderPopupOpen(false);
  };

  return (
    <>
      <Dialog open={aiSettingsDialogOpen} onClose={() => !isProcessing && setAiSettingsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t("ai_integration_settings_openai_compatible")}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
            {isLoading && <Alert severity="info">{t('loading_ai_settings')}</Alert>}
            {loadError && <Alert severity="error" action={
              <Button color="inherit" onClick={() => void retryLoadSettings()} disabled={isLoading || isProcessing}>
                {t('retry_ai_settings_load')}
              </Button>
            }>{t('ai_settings_load_failed', { error: loadError })}</Alert>}
            {credentialUnavailable && !apiKey && <Alert severity="warning">{t('credentials_could_not_be_unlocked')}</Alert>}
            
            <Box sx={{ 
              bgcolor: isDarkTheme ? 'rgba(33, 150, 243, 0.1)' : '#e3f2fd', 
              p: 1.5, borderRadius: 1, border: '1px solid', 
              borderColor: isDarkTheme ? 'rgba(33, 150, 243, 0.3)' : '#bbdefb' 
            }}>
              <Typography variant="body2" color="info.main" sx={{ fontWeight: 'bold' }}>
                💡 {t("unified_connection_through_an_openai_compatible_api")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t("ai_provider_connection_description")}
              </Typography>
            </Box>

            <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
              
              <FormControlLabel
                control={
                  <Checkbox 
                    checked={isAiEnabled} 
                    onChange={(e) => setIsAiEnabled(e.target.checked)} 
                    disabled={!canEditSettings}
                    color="primary"
                  />
                }
                label={<Typography variant="subtitle2" fontWeight="bold">{t("enable_ai_support")}</Typography>}
                sx={{ mb: 1 }}
              />
              
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                
                {/* Endpoint URL and selection button. */}
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    variant="outlined"
                    label={t("api_endpoint_url")}
                    placeholder="https://api.openai.com/v1"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    disabled={!isAiEnabled || !canEditSettings}
                    size="small"
                  />
                  {/* Use an icon-only button with a descriptive tooltip. */}
                  <Tooltip title={t("select_from_list")} placement="top">
                    <span>
                      <Button 
                        variant="outlined" 
                        onClick={() => setProviderPopupOpen(true)}
                        disabled={!isAiEnabled || !canEditSettings}
                        sx={{ minWidth: '40px', width: '40px', height: '40px', p: 0 }}
                      >
                        <SettingsEthernetIcon />
                      </Button>
                    </span>
                  </Tooltip>
                </Box>

                {/* API key. */}
                <TextField
                  fullWidth
                  variant="outlined"
                  label={t("api_key")}
                  type="password"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={!isAiEnabled || !canEditSettings}
                  size="small"
                  helperText={t("leave_blank_for_local_llms_or_other_environments_that_do_not_require_an_api_key")}
                />

                {/* Model name. */}
                <TextField
                  fullWidth
                  variant="outlined"
                  label={t("model_name_2")}
                  placeholder="GPT-6 Luna、Gemini 3.8 Flash、Claude Haiku 4.5など"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  disabled={!isAiEnabled || !canEditSettings}
                  size="small"
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
                <Button onClick={handleSave} variant="contained" color="primary" disabled={!canEditSettings} disableElevation>
                  {t("save_2")}
                </Button>
              </Box>
            </Box>

            {/* Usage notices. */}
            <Box sx={{ px: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t("api_usage_usually_incurs_charges_monitor_your_billing")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                {t("ai_external_data_sharing_notice")}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {t("ai_training_privacy_notice")}
              </Typography>
            </Box>

          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiSettingsDialogOpen(false)} disabled={isProcessing}>{t("close")}</Button>
        </DialogActions>
      </Dialog>

      {/* Provider selection popup. */}
      <Dialog open={providerPopupOpen} onClose={() => setProviderPopupOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t("common_providers_openai_compatible")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t("select_a_provider_to_fill_in_its_endpoint_url_automatically")}
            <br />
            <Typography component="span" color="error.main" variant="body2" fontWeight="bold">
              {t("for_other_providers_enter_the_openai_compatible_endpoint_url_manually")}
            </Typography>
          </Typography>
          
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead sx={{ bgcolor: isDarkTheme ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t("provider_name")}</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>{t("endpoint_url")}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold', width: '100px' }}>{t("action")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {COMPATIBLE_PROVIDERS.map((row) => (
                  <TableRow key={row.name} hover>
                    <TableCell>{row.name}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{row.url}</TableCell>
                    <TableCell align="center">
                      <Button variant="contained" size="small" disableElevation disabled={!canEditSettings} onClick={() => handleProviderSelect(row.url)}>
                        {t("select")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProviderPopupOpen(false)}>{t("cancel")}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}