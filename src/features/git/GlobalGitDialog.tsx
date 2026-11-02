// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import GitConflictDialog from './GitConflictDialog';

import { Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import { useTheme } from '@mui/material/styles';

export default function GlobalGitDialog({ gitLogic }: { gitLogic: ReturnType<typeof import('./useGlobalGit').useGlobalGit> }) {
  const { 
    t, gitSettingsDialogOpen, setGitSettingsDialogOpen, 
    isLocalRepo, repoPath, tempRemoteUrl, setTempRemoteUrl, 
    branchName,
    isGitProcessing, handleInitLocalRepo, handleSetRemote 
  } = gitLogic;
  
  const theme = useTheme();
  const isDarkTheme = theme.palette.mode === 'dark';

  return (
    <>
    {gitLogic.conflictDialogOpen && <GitConflictDialog onClose={() => gitLogic.setConflictDialogOpen(false)} onAbort={gitLogic.handleAbortMerge} onComplete={() => {
      gitLogic.setConflictDialogOpen(false); window.dispatchEvent(new CustomEvent('git-status-changed')); notify(t('git_pull_completed_please_reopen_the_corresponding_tabs_to_apply_the_changes'), { severity: 'success' });
    }} />}
    <Dialog open={gitSettingsDialogOpen} onClose={() => !isGitProcessing && setGitSettingsDialogOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{t("git_environment_settings")}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          
          <Box sx={{ bgcolor: isDarkTheme ? 'rgba(33, 150, 243, 0.1)' : '#e3f2fd', p: 1.5, borderRadius: 1, border: '1px solid', borderColor: isDarkTheme ? 'rgba(33, 150, 243, 0.3)' : '#bbdefb' }}>
            <Typography variant="body2" color="info.main" sx={{ fontWeight: 'bold' }}>
              💡 {t("branch_management_in_team_development")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t("git_workspace_scope_help")}
            </Typography>
          </Box>

          <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1, bgcolor: isLocalRepo ? 'action.hover' : 'background.paper' }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>
              {t("1_initialize_local_repository")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("initialize_the_working_folder_with_git_git_init", { path: repoPath })}<br />
              {t("please_execute_this_only_once_at_the_beginning")}
            </Typography>
            <Button 
              variant="outlined" 
              color={isLocalRepo ? "inherit" : "primary"}
              onClick={handleInitLocalRepo} 
              disabled={isLocalRepo || isGitProcessing}
              fullWidth
            >
              {isLocalRepo ? t("already_initialized") : t("execute_initialization_git_init")}
            </Button>
          </Box>

          <Box sx={{ border: '1px solid', borderColor: 'divider', p: 2, borderRadius: 1 }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1 }}>
              {t("2_remote_repository_settings")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t("git_remote_configuration_help")}<br />
              {t("saving_also_performs_the_initial_push_and_sets_up_tracking")}
            </Typography>
            
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                fullWidth
                variant="outlined"
                label={t("remote_repository_url")}
                placeholder={t("e_g_https_github_com_username_repo_git")}
                value={tempRemoteUrl}
                onChange={(e) => setTempRemoteUrl(e.target.value)}
                disabled={!isLocalRepo || isGitProcessing}
                size="small"
                sx={{ flex: 3 }}
              />
              {/* Branch name field. */}
              <TextField
                variant="outlined"
                label={t("branch_name")}
                value={branchName}
                InputProps={{ readOnly: true }}
                helperText={t('git_current_branch_help')}
                disabled={!isLocalRepo || isGitProcessing}
                size="small"
                sx={{ flex: 1 }}
              />
            </Box>

            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Button onClick={handleSetRemote} variant="contained" color="primary" disabled={!isLocalRepo || !branchName || isGitProcessing} disableElevation>
                {t("save_and_perform_initial_push")}
              </Button>
            </Box>
          </Box>

        </Box>
      </DialogContent>
      <DialogActions>
        {isLocalRepo && <Button onClick={() => { setGitSettingsDialogOpen(false); gitLogic.setConflictDialogOpen(true); }} disabled={isGitProcessing}>{t('git_resolve_conflicts')}</Button>}
        <Button onClick={() => setGitSettingsDialogOpen(false)} disabled={isGitProcessing}>{t("close")}</Button>
      </DialogActions>
    </Dialog>
    </>
  );
}
