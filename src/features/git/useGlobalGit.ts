// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { notify } from '@/shared/utils/notifications';
import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from "@/shared/api/desktop";

interface UseGlobalGitProps {
  setIsGlobalLoading: (loading: boolean) => void;
  onMenuClose?: () => void;
}

export function useGlobalGit({ setIsGlobalLoading, onMenuClose }: UseGlobalGitProps) {
  const { t } = useTranslation();

  const [gitSettingsDialogOpen, setGitSettingsDialogOpen] = useState<boolean>(false);
  const [isLocalRepo, setIsLocalRepo] = useState<boolean>(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState<string>('');
  
  const [tempRemoteUrl, setTempRemoteUrl] = useState<string>('');
  const [branchName, setBranchName] = useState<string>('');
  
  const [isGitProcessing, setIsGitProcessing] = useState<boolean>(false);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);

  const checkGitStatusApp = useCallback(async () => {
    try {
      const res = await ipcRenderer.invoke('git-status-check');
      if (res && res.success) {
        setIsLocalRepo(res.isRepo);
        setRemoteUrl(res.remoteUrl);
        setRepoPath(res.repoPath || ''); 
        setBranchName(res.branch || '');
      }
    } catch (e) {
      console.error(t("failed_to_check_git_environment"), e);
    }
  }, [t]);

  useEffect(() => {
    checkGitStatusApp();
  }, [checkGitStatusApp]);

  useEffect(() => {
    if (gitSettingsDialogOpen) checkGitStatusApp();
  }, [gitSettingsDialogOpen, checkGitStatusApp]);

  useEffect(() => {
    const handleGitStatusChanged = () => {
      checkGitStatusApp();
    };
    window.addEventListener('git-status-changed', handleGitStatusChanged);
    return () => window.removeEventListener('git-status-changed', handleGitStatusChanged);
  }, [checkGitStatusApp]);

  const handleInitLocalRepo = async () => {
    setIsGitProcessing(true);
    try {
      const res = await ipcRenderer.invoke('git-init-local');
      if (res && res.success) {
        notify(t("local_repository_initialized_version_control_is_now_available"), { severity: 'success' });
        await checkGitStatusApp();
        window.dispatchEvent(new CustomEvent('git-status-changed'));
      } else {
        notify(t("initialization_error", { error: res?.error || t("failed_to_initialize_git") }));
      }
    } catch (e: unknown) {
      notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      setIsGitProcessing(false);
    }
  };

  const handleSetRemote = async () => {
    if (!tempRemoteUrl.trim()) {
      notify(t("please_enter_url"));
      return;
    }
    if (!branchName.trim()) {
      notify(t("enter_a_branch_name"));
      return;
    }
    
    setIsGitProcessing(true);
    try {
      const res = await ipcRenderer.invoke('git-set-remote', { 
        url: tempRemoteUrl.trim(), 
        branch: branchName.trim() 
      });

      if (res && res.success) {
        setRemoteUrl(tempRemoteUrl.trim());
        setGitSettingsDialogOpen(false);
        await checkGitStatusApp();
        window.dispatchEvent(new CustomEvent('git-status-changed'));

        notify(t("the_remote_was_configured_and_the_initial_push_completed"), { severity: 'success' });
      } else {
        await checkGitStatusApp();
        if (res?.needsPull) {
          notify(t('git_initial_push_requires_pull'));
        } else {
          notify(t("settings_error", { error: res?.error || t("failed_to_configure_the_git_remote") }));
        }
      }
    } catch (e: unknown) {
      notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      setIsGitProcessing(false);
    }
  };

  const handleGitPull = async () => {
    if (onMenuClose) onMenuClose();
    try {
      const statusRes = await ipcRenderer.invoke('git-status-check');
      if (!statusRes || !statusRes.success || !statusRes.isRepo) {
        notify(t("git_repository_is_not_initialized_please_initialize_from_git_git_settings_menu"));
        return;
      }
      if (!statusRes.remoteUrl) {
        notify(t("remote_repository_is_not_set_please_set_the_url_from_git_git_settings_menu"));
        return;
      }

      if (!window.confirm(t("confirm_git_pull_workspace", { url: statusRes.remoteUrl }))) {
        return;
      }

      setIsGlobalLoading(true);
      const res = await ipcRenderer.invoke('git-pull');
      
      if (res && !res.success && res.isConflict) {
        setIsGlobalLoading(false);
        setConflictDialogOpen(true);
        return;
      }
      
      if (res && res.success) {
        notify(t("git_pull_completed_please_reopen_the_corresponding_tabs_to_apply_the_changes"), { severity: 'success' });
        window.dispatchEvent(new CustomEvent('git-status-changed'));
      } else {
        notify(t("git_pull_error", { error: res?.error || t("pull_failed") }));
      }
    } catch (e: unknown) {
      notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      setIsGlobalLoading(false);
    }
  };

  const handleAbortMerge = async () => {
    if (!window.confirm(t('git_confirm_abort_merge'))) return;
    setIsGlobalLoading(true);
    try {
      const result = await ipcRenderer.invoke('git-merge-abort');
      if (!result?.success) throw new Error(result?.error || t('git_merge_abort_failed'));
      setConflictDialogOpen(false); notify(t('pull_operation_canceled_restored_to_original_safe_state'), { severity: 'success' });
      window.dispatchEvent(new CustomEvent('git-status-changed'));
    } catch (error: unknown) { notify(t('git_pull_cancel_failed', { error: getErrorMessage(error) })); }
    finally { setIsGlobalLoading(false); }
  };

  const handleGitPush = async () => {
    if (onMenuClose) onMenuClose();
    try {
      const statusRes = await ipcRenderer.invoke('git-status-check');
      if (!statusRes || !statusRes.success || !statusRes.isRepo) {
        notify(t("git_repository_is_not_initialized_please_initialize_from_git_git_settings_menu"));
        return;
      }
      if (!statusRes.remoteUrl) {
        notify(t("remote_repository_is_not_set_please_set_the_url_from_git_git_settings_menu"));
        return;
      }
      if (statusRes.ahead === 0) {
        notify(t("no_new_commits_to_push_to_the_remote_repository"), { severity: 'success' });
        return;
      }

      const confirmation = typeof statusRes.ahead === 'number'
        ? t('confirm_git_push_unpushed_commits', { url: statusRes.remoteUrl, count: statusRes.ahead })
        : t('confirm_git_push_unknown_count', { url: statusRes.remoteUrl });
      if (!window.confirm(confirmation)) {
        return;
      }

      setIsGlobalLoading(true);
      const res = await ipcRenderer.invoke('git-push');
      
      if (res && !res.success && res.error && res.error.includes('rejected')) {
        setIsGlobalLoading(false);
        const confirmForce = window.confirm(
          t("confirm_git_force_push_after_rejection")
        );
        if (confirmForce) {
          setIsGlobalLoading(true);
          const forceRes = await ipcRenderer.invoke('git-push-force');
          if (forceRes && forceRes.success) {
            notify(t("git_force_push_completed"), { severity: 'success' });
            window.dispatchEvent(new CustomEvent('git-status-changed'));
          } else {
            notify(t("git_push_error", { error: forceRes?.error || t("push_failed") }));
          }
        }
        return;
      }

      if (res && res.success) {
        notify(t("git_push_completed"), { severity: 'success' });
        window.dispatchEvent(new CustomEvent('git-status-changed'));
      } else {
        notify(t("git_push_error", { error: res?.error || t("push_failed") }));
      }
    } catch (e: unknown) {
      notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      setIsGlobalLoading(false);
    }
  };

  return {
    t, conflictDialogOpen, setConflictDialogOpen, handleAbortMerge,
    gitSettingsDialogOpen, setGitSettingsDialogOpen,
    isLocalRepo, repoPath, tempRemoteUrl, setTempRemoteUrl,
    branchName,
    isGitProcessing, remoteUrl,
    handleInitLocalRepo, handleSetRemote, handleGitPull, handleGitPush
  };
}
