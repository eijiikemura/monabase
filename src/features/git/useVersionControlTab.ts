// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import { useAiHistoryConnectionScope } from '@/features/ai/AiHistoryConnectionContext';
import { notify } from '@/shared/utils/notifications';
import type { GridRowParams } from '@mui/x-data-grid';
import type { AiSourceIdentity } from '@/shared/types/aiTypes';
import type { GitRevision } from "@/shared/types/databaseTypes";

import { getErrorMessage } from "@/shared/utils/errorUtils";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { sql, PostgreSQL } from '@codemirror/lang-sql'; 
import { plsqlDialect, oracleFunctionHighlighting } from "../oracle/windows/common/plsqlDialect"; 
import { ipcRenderer } from "@/shared/api/desktop";

export interface VersionControlTabProps {
  dbType?: string; 
  schema: string;
  objectType: string;
  objectName: string;
  signature?: string;
  tableName?: string;
  currentSource: string;
  isSourceLoading?: boolean;
  onRefresh?: () => void;
}

export function useVersionControlTab({ 
  dbType = 'ORACLE', 
  schema, 
  objectType, 
  objectName, 
  signature, tableName,
  currentSource, 
  isSourceLoading: parentIsSourceLoading = false
}: VersionControlTabProps) {
  const { t } = useTranslation();
  const connectionScope = useAiHistoryConnectionScope();
  const isPg = dbType.toUpperCase() === 'POSTGRESQL' || dbType.toUpperCase() === 'POSTGRES';

  const [activeSubTab, setActiveSubTab] = useState<number>(0);
  const [commitDialogOpen, setCommitDialogOpen] = useState<boolean>(false);
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isAiSummaryLoading, setIsAiSummaryLoading] = useState(false);
  const summaryRequest = useRef(0);
  const summaryContext = JSON.stringify([connectionScope, isPg, schema, objectType, objectName, signature, tableName, currentSource]);
  const latestSummaryContext = useRef({ key: summaryContext, message: commitMessage });
  latestSummaryContext.current = { key: summaryContext, message: commitMessage };
  useEffect(() => () => { summaryRequest.current++; }, []);
  useEffect(() => {
    if (!commitDialogOpen) { summaryRequest.current++; setIsAiSummaryLoading(false); }
  }, [commitDialogOpen]);

  

  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyList, setHistoryList] = useState<GitRevision[]>([]);
  const [selectedHistory, setSelectedHistory] = useState<GitRevision | null>(null);
  const [pastSource, setPastSource] = useState<string>(''); 
  
  const [diffHeight, setDiffHeight] = useState<number>(300);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const [isLocalRepo, setIsLocalRepo] = useState<boolean>(false);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [branchName, setBranchName] = useState<string | null>(null);
  const [repoPath, setRepoPath] = useState<string>('');

  const fullSource = currentSource.trim();
  const requests = useRef({ history: 0, content: 0 });
  const isSourceLoading = parentIsSourceLoading || currentSource === t('fetching_data');

  // Invalidates responses from another object, tab, or unmounted component.
  useEffect(() => {
    const pending = requests.current;
    setHistoryList([]);
    setHistoryPage(0); setHistoryHasMore(false); setHistoryLoading(false);
    setSelectedHistory(null);
    setPastSource('');
    return () => { pending.history++; pending.content++; };
  }, [isPg, schema, objectType, objectName, signature, tableName, activeSubTab]);

  const codeMirrorExtensions = useMemo(() => {
    if (isPg) {
      return [sql({ dialect: PostgreSQL })];
    } else {
      return [sql({ dialect: plsqlDialect }), oracleFunctionHighlighting];
    }
  }, [isPg]);

  const checkGitStatus = useCallback(async () => {
    try {
      const res = await ipcRenderer.invoke('git-status-check');
      if (res && res.success) {
        setIsLocalRepo(res.isRepo);
        setRemoteUrl(res.remoteUrl);
        setBranchName(res.branch);
        setRepoPath(res.repoPath || ''); 
      }
    } catch (e) {
      console.error(t("failed_to_check_git_environment"), e);
    }
  }, [t]);

  const loadHistory = useCallback(async (page = 0) => {
    if (!isLocalRepo || (isPg && ['FUNCTION', 'PROCEDURE'].includes(objectType) && signature === undefined)) return;
    const request = ++requests.current.history;
    setHistoryLoading(true);
    try {
      const res = await ipcRenderer.invoke('git-get-history', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        schema: schema,
        objectType: objectType.toUpperCase(),
        objectName: objectName, tableName, signature, page
      });
      if (request !== requests.current.history) return;
      if (res && res.success) {
        setHistoryList(res.history);
        setHistoryPage(page); setHistoryHasMore(!!res.hasMore);
      } else {
        notify(res.error);
      }
    } catch (e) {
      if (request !== requests.current.history) return;
      console.error(t("history_fetch_error"), e);
      notify(getErrorMessage(e));
    } finally {
      if (request === requests.current.history) setHistoryLoading(false);
    }
  }, [isLocalRepo, isPg, schema, objectType, objectName, signature, tableName, t]);

  useEffect(() => {
    if (activeSubTab === 1 || activeSubTab === 0) {
      checkGitStatus(); 
    }
  }, [activeSubTab, checkGitStatus]);

  useEffect(() => {
    const handleGitStatusChanged = () => {
      checkGitStatus();
      if (activeSubTab === 1 && isLocalRepo) loadHistory();
    };
    window.addEventListener('git-status-changed', handleGitStatusChanged);
    return () => window.removeEventListener('git-status-changed', handleGitStatusChanged);
  }, [activeSubTab, isLocalRepo, checkGitStatus, loadHistory]);

  useEffect(() => {
    if (activeSubTab === 1 && isLocalRepo) {
      requests.current.content++;
      loadHistory();
      setSelectedHistory(null);
      setPastSource('');
    }
  }, [activeSubTab, isLocalRepo, loadHistory]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      let newHeight = e.clientY - 200; 
      if (newHeight < 100) newHeight = 100;
      if (newHeight > window.innerHeight - 300) newHeight = window.innerHeight - 300;
      setDiffHeight(newHeight);
    };
    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.cursor = 'default';
      }
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const handleCopy = async () => {
    try {
      const copied = await ipcRenderer.invoke('copy-to-clipboard', fullSource);
      if (!copied) throw new Error(t('git_operation_failed'));
      notify(t('copied_to_clipboard'), { severity: 'success' });
    } catch (error: unknown) {
      notify(getErrorMessage(error));
    }
  };

  const handleUseAiSummary = async () => {
    const category = objectType.toUpperCase();
    if (!['FUNCTION', 'PROCEDURE', 'TRIGGER', 'PACKAGE', 'PACKAGE BODY'].includes(category)) return;
    const request = ++summaryRequest.current, key = summaryContext, previousMessage = commitMessage;
    setIsAiSummaryLoading(true);
    try {
      if (!connectionScope) throw new Error(t('ai_history_connection_required'));
      const identity: AiSourceIdentity = { connectionScope, dbType: isPg ? 'postgresql' : 'oracle', schema, objectName,
        category: category as AiSourceIdentity['category'], ...(signature !== undefined ? { signature } : {}),
        ...(tableName !== undefined ? { tableName } : {}) };
      const result = await ipcRenderer.invoke('load-ai-source-history', identity);
      if (request !== summaryRequest.current || latestSummaryContext.current.key !== key || latestSummaryContext.current.message !== previousMessage) return;
      if (!result.success) throw new Error(result.error);
      const adopted = result.conversation?.messages.filter(message => message.sender === 'ai' && message.adoption).at(-1)?.adoption;
      if (!adopted) { notify(t('ai_no_adopted_summary'), { severity: 'info' }); return; }
      setCommitMessage(adopted.summary);
    } catch (error: unknown) {
      if (request === summaryRequest.current && latestSummaryContext.current.key === key) notify(getErrorMessage(error));
    } finally { if (request === summaryRequest.current) setIsAiSummaryLoading(false); }
  };

  const handleCommit = async () => {
    setIsProcessing(true);
    try {
      const res = await ipcRenderer.invoke('git-commit', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        schema: schema,
        objectType: objectType.toUpperCase(),
        objectName: objectName, tableName, signature,
        sourceText: fullSource,
        message: commitMessage || t("updated_2", { name: objectName, type: objectType })
      });
      
      if (res && res.success) {
        notify(t("git_commit_executed"), { severity: 'success' });
        setCommitDialogOpen(false);
        setCommitMessage('');
        await checkGitStatus(); 
        if (activeSubTab === 1) loadHistory();
      } else {
        notify(t("git_commit_error", { error: res?.error || t("git_operation_failed") }));
      }
    } catch (e: unknown) {
      notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePush = async () => {
    if (!remoteUrl) return;
    if (!window.confirm(t("confirm_git_push_workspace", { url: remoteUrl }))) {
      return;
    }
    setIsProcessing(true);
    try {
      const res = await ipcRenderer.invoke('git-push');
      if (res && res.success) {
        notify(t("git_push_completed"), { severity: 'success' });
        await checkGitStatus(); 
        if (activeSubTab === 1) loadHistory(); 
      } else {
        notify(t("git_push_error", { error: res?.error || t("push_failed") }));
      }
    } catch (e: unknown) {
      notify(t("connection_error_6", { error: getErrorMessage(e) }));
    } finally {
      setIsProcessing(false);
    }
  };

  // Refetch the selected SQL before opening confirmation to avoid stale history selection.
  const handleRestore = async () => {
    if (!selectedHistory || isProcessing || isSourceLoading) return;
    const commitId = selectedHistory.fullId;
    setIsProcessing(true);
    try {
      const res = await ipcRenderer.invoke('git-get-file-content', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        schema: schema,
        objectType: objectType.toUpperCase(),
        objectName: objectName, tableName, signature,
        commitId
      });
      if (!res?.success || !res.content?.trim()) {
        notify(t("failed_to_retrieve_recovery_sql"));
        return;
      }
      window.dispatchEvent(new CustomEvent('open-sql-tab', {
        detail: { initialSql: res.content }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(t("connection_error_6", { error: message }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleHistoryRowClick = async (params: GridRowParams<GitRevision>) => {
    const request = ++requests.current.content;
    setSelectedHistory(params.row);
    setPastSource(t("fetching"));
    try {
      const res = await ipcRenderer.invoke('git-get-file-content', {
        dbType: isPg ? 'POSTGRESQL' : 'ORACLE',
        schema: schema,
        objectType: objectType.toUpperCase(),
        objectName: objectName, tableName, signature,
        commitId: params.row.fullId 
      });
      if (request !== requests.current.content) return;
      if (res && res.success) {
        setPastSource(res.content);
      } else {
        setPastSource(t("fetch_error", { error: res?.error || t("could_not_retrieve_content") }));
      }
    } catch (e: unknown) {
      if (request !== requests.current.content) return;
      setPastSource(t("connection_error", { error: getErrorMessage(e) }));
    }
  };

  return {
    handleUseAiSummary, isAiSummaryLoading,
    t,
    activeSubTab, setActiveSubTab,
    commitDialogOpen, setCommitDialogOpen,
    commitMessage, setCommitMessage,
    isProcessing,
    isSourceLoading, // Combined parent and child loading flag.
    historyList, selectedHistory, pastSource,
    historyPage, historyHasMore, historyLoading, loadHistory,
    diffHeight, isResizing, setIsResizing,
    isLocalRepo, remoteUrl, repoPath, branchName,
    fullSource,
    codeMirrorExtensions,
    handleCopy, handleCommit, handlePush, handleHistoryRowClick, handleRestore
  };
}
