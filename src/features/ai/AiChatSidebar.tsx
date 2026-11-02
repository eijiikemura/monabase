// Copyright 2026 eiji ikemura
// SPDX-License-Identifier: Apache-2.0

import type { AiSendKey } from '@/shared/types/appTypes';
import { useChatScroll } from './useChatScroll';
import { notify } from '@/shared/utils/notifications';
import AiReviewDialog from './AiReviewDialog';
import { prepareAiSubmission } from './prepareAiSubmission';
import { buildRequestEvidence, emptyRequestBrief } from './requestEvidence';
import { useEventCallback } from '@/shared/hooks/useEventCallback';
import { formatCodingMessage } from './codingResponse';
import type { AiContext, SelectedAiObject, AiChatMessage, AiSourceReview, AiDatabaseContext } from '@/shared/types/aiTypes';
import { getErrorMessage } from "@/shared/utils/errorUtils";
import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import AiObjectSelectionPanel from './AiObjectSelectionPanel';
import { buildAiObjectReference } from './useAiObjectSelection';

import { hasRequiredPackageHeader } from './packageHeaderRequirement';
import { createSourceConversationController } from './sourceConversation';

import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { 
  Box, Typography, TextField, IconButton, Button, 
  CircularProgress, Paper, Chip, Tooltip, Divider, Alert, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import CloseIcon from '@mui/icons-material/Close';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { ipcRenderer } from "@/shared/api/desktop";
const CODING_REQUEST_TYPES = ["coding_procedure", "coding_function",
  "coding_trigger", "coding_package"] as const;
const DEBUG_REQUEST_TYPES = [
  "debug_procedure",
  "debug_function",
  "debug_trigger",
  "debug_package"
] as const;
const EMPTY_TARGETS: readonly SelectedAiObject[] = Object.freeze([]);
const emptyTargetsSnapshot = () => EMPTY_TARGETS;
const emptyTargetsSubscribe = () => () => {};

type ChatMessage = AiChatMessage;

interface AiChatSidebarProps {
  connectionScope?: string;
  sendKey?: AiSendKey;
  onClose: () => void;
  aiContext: AiContext | null;
  setAiContext: (context: AiContext | null) => void;
}

export default function AiChatSidebar({ connectionScope, sendKey = 'enter', onClose, aiContext, setAiContext }: AiChatSidebarProps) {
  const { t, i18n } = useTranslation();
  const [requestBrief, setRequestBrief] = useState(emptyRequestBrief);
  const [environment, setEnvironment] = useState<AiDatabaseContext | null>(null);
  const [environmentError, setEnvironmentError] = useState('');
  const [collectingEnvironment, setCollectingEnvironment] = useState(false);
  const [environmentRevision, setEnvironmentRevision] = useState(0);
  const contextKey = aiContext?.requestId || aiContext?.initialPrompt || aiContext?.referencePrompt || aiContext?.targetTab;
  const environmentFailureText = t('ai_environment_unavailable');
  const briefLabels = { inputExample: t('ai_brief_inputExample'), expectedResult: t('ai_brief_expectedResult'),
    actualResult: t('ai_brief_actualResult'), constraints: t('ai_brief_constraints'), verification: t('ai_brief_verification') };
  useEffect(() => { setRequestBrief(emptyRequestBrief()); }, [connectionScope, contextKey]);
  useEffect(() => {
    let current = true;
    setEnvironment(null); setEnvironmentError('');
    if (!contextKey) { setCollectingEnvironment(false); return; }
    setCollectingEnvironment(true);
    void Promise.resolve().then(() => ipcRenderer.invoke('get-ai-database-context')).then(result => {
      if (!current) return;
      if (!result?.success || !result.environment || !['oracle', 'postgresql'].includes(result.environment.dbType) || result.environment.session !== 'main') throw new Error('Environment unavailable');
      setEnvironment(result.environment);
    }).catch(() => { if (current) setEnvironmentError(environmentFailureText); })
      .finally(() => { if (current) setCollectingEnvironment(false); });
    return () => { current = false; };
  }, [connectionScope, contextKey, environmentRevision, environmentFailureText]);
  const [conversation] = useState(() => createSourceConversationController({
    load: async identity => {
      if (!identity.connectionScope) throw new Error(t('ai_history_connection_required'));
      const result = await ipcRenderer.invoke(identity.historyScope === 'debug'
        ? 'load-ai-debug-history' : 'load-ai-source-history', identity);
      if (!result.success) throw new Error(result.error || t("failed_to_load_the_ai_conversation"));
      return result.conversation;
    },
    save: async (identity, history) => {
      if (!identity.connectionScope) throw new Error(t('ai_history_connection_required'));
      const result = await ipcRenderer.invoke(identity.historyScope === 'debug'
        ? 'save-ai-debug-history' : 'save-ai-source-history', identity, history);
      if (!result.success) throw new Error(result.error || t("failed_to_save_the_ai_conversation"));
    }
  }));
  const history = useSyncExternalStore(conversation.subscribe, conversation.getSnapshot);
  const { messages } = history;
  const setMessages = conversation.setMessages;
  const [inputText, setInputText] = useState<string>('');
  const [review, setReview] = useState<{ proposal: AiSourceReview; messageId: string; context: AiContext | null } | null>(null);
  const reviewRef = useRef(review);
  reviewRef.current = review;
  const [changeSummary, setChangeSummary] = useState('');
  const [requestPreview, setRequestPreview] = useState<{ text: string; history: { role: string; content: string }[]; context: AiContext | null } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const latestReply = messages.reduce<ChatMessage | undefined>(
    (latest, message) => message.sender === 'ai' ? message : latest,
    undefined
  );
  const latestUsage = latestReply?.usage;
  const isCodingRequest = aiContext?.requestType === "coding" ||
    CODING_REQUEST_TYPES.some(type => type === aiContext?.requestType);
  const allowEmptySelection = isCodingRequest || DEBUG_REQUEST_TYPES.some(type => type === aiContext?.requestType);
  const selection = aiContext?.objectSelection;
  const targets = useSyncExternalStore(selection?.subscribe || emptyTargetsSubscribe,
    selection?.getSnapshot || emptyTargetsSnapshot);
  const requiredHeader = aiContext?.requiredPackageHeader;
  const headerReady = hasRequiredPackageHeader(targets, requiredHeader);
  const headerMessage = requiredHeader?.objectName
    ? t("ai_package_body_requires_named_header", {
      name: `${requiredHeader.schema}.${requiredHeader.objectName}`
    })
    : t("ai_package_body_requires_header");
  const targetsReady = headerReady && (!selection || (selection.isAvailable() && (allowEmptySelection || targets.length > 0) &&
    targets.every(target => target.status === 'ready' && target.reference?.definition)));
  const emptyStateMessages: Record<string, { title: string; description?: string }> = {
    "sql_generation": {
      title: t("describe_the_sql_you_want_to_create"),
      description: t("add_all_required_target_objects_before_sending_an_ai_request")
    },
    "query_builder": {
      title: t("describe_the_sql_you_want_to_create"),
      description: t("ai_required_tables_and_views")
    },
    "sql_tuning": {
      title: t("describe_your_sql_tuning_request"),
      description: t("describe_what_you_want_to_improve_or_the_problems_encountered_when_executing_sql")
    },
    "data_generator": {
      title: t("describe_the_data_you_want_to_generate"),
      description: t("ai_data_request_description")
    },
    "coding": {
      title: t("describe_the_code_you_want_to_create_or_modify"),
      description: t("describe_the_desired_behavior_or_changes")
    }
  };
  const isDebugRequest = DEBUG_REQUEST_TYPES.some(
    type => type === aiContext?.requestType
  );
  const emptyStateMessage = isDebugRequest ? {
    title: t("describe_your_debugging_request"),
    description: t("ai_debug_request_description")
  } : isCodingRequest ? {
    title: t("describe_the_code_you_want_to_create_or_modify"),
    description: t("ai_optional_target_objects")
  } : selection ? {
    title: t("enter_your_ai_request"),
    description: t("add_all_required_target_objects_before_sending_an_ai_request")
  } : emptyStateMessages[aiContext?.requestType || ''] ?? {
    title: t("enter_your_ai_request")
  };
  
  const chatScroll = useChatScroll(messages, isLoading, aiContext?.requestId);
  const initialPromptSentRef = useRef<string | null>(null);
  const contextRef = useRef(aiContext);
  contextRef.current = aiContext;
  const previousContextRef = useRef(aiContext);
  const mountedRef = useRef(false);
  const activeRequestRef = useRef<{
    id: string; messageId: string; text: string; cleanup?: () => void;
  } | null>(null);
  const resetConversation = previousContextRef.current?.requestId !== aiContext?.requestId;

  const markMessageCancelled = useEventCallback((messageId: string) => {
    setMessages(previous => previous.map(message =>
      message.id === messageId ? { ...message, cancelled: true } : message));
  });

  const cancelActiveRequest = useEventCallback(() => {
    const request = activeRequestRef.current;
    activeRequestRef.current = null;
    if (request) {
      request.cleanup?.();
      void ipcRenderer.invoke('cancel-ai', request.id).catch((error: unknown) => {
        if (mountedRef.current) {
          notify(t("failed_to_cancel_the_ai_request") + getErrorMessage(error));
        }
      });
    }
    return request;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const request = activeRequestRef.current;
      // Do not abort requests during the immediate StrictMode remount in development.
      if (request) queueMicrotask(() => {
        if (!mountedRef.current && activeRequestRef.current?.id === request.id) {
          cancelActiveRequest();
        }
      });
    };
  }, [cancelActiveRequest]);

  useEffect(() => {
    const previous = previousContextRef.current;
    if (previous?.requestId !== aiContext?.requestId ||
        previous?.initialPrompt !== aiContext?.initialPrompt ||
        previous?.targetTab !== aiContext?.targetTab ||
        previous?.requestType !== aiContext?.requestType) {
      setReview(null); setRequestPreview(null);
      const cancelled = cancelActiveRequest();
      if (cancelled) {
        markMessageCancelled(cancelled.messageId);
        setIsLoading(false);
      }
    }
    if (previous?.requestId !== aiContext?.requestId) {
      setInputText('');
      setReview(null); setRequestPreview(null);
      initialPromptSentRef.current = null;
    }
    previousContextRef.current = aiContext;
  }, [aiContext, cancelActiveRequest, markMessageCancelled]);

  useEffect(() => {
    const detach = conversation.attach(aiContext?.historyTarget || aiContext?.codingResponse, selection, connectionScope);
    return () => {
      if (activeRequestRef.current) markMessageCancelled(activeRequestRef.current.messageId);
      detach();
    };
  }, [conversation, connectionScope, aiContext?.requestId, aiContext?.codingResponse, aiContext?.historyTarget, selection, markMessageCancelled]);

  useEffect(() => {
    if (selection && !selection.isAvailable() && activeRequestRef.current) {
      const cancelled = cancelActiveRequest();
      if (cancelled) {
        markMessageCancelled(cancelled.messageId);
        setInputText(cancelled.text);
        setIsLoading(false);
      }
    }
  }, [cancelActiveRequest, markMessageCancelled, selection, targets]);


  const buildRequestHistory = (requestTargets: readonly SelectedAiObject[] | undefined) => {
    const chatHistory = (resetConversation ? [] : messages)
      .filter(message => (message.sender === 'user' || message.sender === 'ai') && !message.cancelled && !message.failed)
      .map(message => ({ role: message.sender === 'user' ? 'user' : 'assistant', content: message.aiContent ?? message.text }));
    const reference = [aiContext?.referencePrompt,
      buildRequestEvidence(environment, requestBrief, Boolean(environmentError)),
      requestTargets ? buildAiObjectReference(requestTargets) : '',
      aiContext?.sqlResponse?.getReferencePrompt(), aiContext?.codingResponse?.getReferencePrompt(),
      isCodingRequest && requestTargets?.length === 0
        ? 'No reference objects were selected. Ask the user to add any existing dependencies instead of inventing them.' : '',
      (i18n?.language || 'en').startsWith('ja')
        ? 'Write explanations and clarification questions in Japanese. Keep JSON keys and identifiers unchanged.'
        : 'Write explanations and clarification questions in English. Keep JSON keys and identifiers unchanged.'
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: reference }, ...chatHistory];
  };

  const previewRequest = () => {
    if (collectingEnvironment) return;
    const result = prepareAiSubmission({ text: inputText, isLoading, hasActiveRequest: Boolean(activeRequestRef.current) || Boolean(reviewRef.current),
      isHistoryReady: history.ready, context: aiContext, allowEmptySelection, headerMessage,
      targetMessage: t('add_target_objects_and_wait_for_their_definitions_to_load_before_sending') });
    if (result.status === 'invalid') { notify(result.message); return; }
    if (result.status !== 'ready') return;
    setRequestPreview({ text: result.text, history: buildRequestHistory(result.targets), context: aiContext });
  };

  const handleSendMessage = useEventCallback(async (textToSend?: string, preview: typeof requestPreview = requestPreview) => {
    if (collectingEnvironment) return;
    const submission = prepareAiSubmission({
      text: textToSend || inputText,
      isLoading,
      hasActiveRequest: Boolean(activeRequestRef.current) || Boolean(reviewRef.current),
      isHistoryReady: history.ready,
      context: aiContext,
      allowEmptySelection,
      headerMessage,
      targetMessage: t("add_target_objects_and_wait_for_their_definitions_to_load_before_sending")
    });
    if (submission.status === 'blocked') return;
    if (submission.status === 'invalid') {
      notify(submission.message);
      return;
    }
    const { text: trimmed, targets: requestTargets } = submission;
    const requestHistory = buildRequestHistory(requestTargets);
    if (preview && (preview.context !== aiContext || preview.text !== trimmed || JSON.stringify(preview.history) !== JSON.stringify(requestHistory))) {
      setRequestPreview(null); notify(t('ai_request_preview_changed')); return;
    }
    setRequestPreview(null);
    const requestId = crypto.randomUUID();
    const requestContext = aiContext;
    const isCurrentRequest = () => mountedRef.current &&
      activeRequestRef.current?.id === requestId &&
      requestContext?.requestId === contextRef.current?.requestId;

    const userMessage: ChatMessage = {
      id: requestId,
      sender: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    activeRequestRef.current = {
      id: requestId, messageId: userMessage.id, text: trimmed
    };
    setMessages(prev => [...prev, userMessage]);
    
    if (!textToSend) {
      setInputText('');
    }
    setIsLoading(true);
    const sqlTarget = requestContext?.sqlResponse;
    const codingTarget = requestContext?.codingResponse;
    const responseTarget = codingTarget || sqlTarget;
    const cleanup = () => { responseTarget?.cancel(); };
    activeRequestRef.current.cleanup = cleanup;
    let receivedUsage: ChatMessage['usage'];

    try {
      responseTarget?.start();
      const res = await ipcRenderer.invoke(
        'ask-ai', trimmed, requestHistory,
        requestContext?.requestType || "unspecified",
        requestId, { stream: false }
      );
      if (res?.historyError) {
        notify(t("failed_to_save_ai_usage_history") + res.historyError);
      }
      if (!isCurrentRequest()) return;
      if (res?.cancelled) {
        markMessageCancelled(userMessage.id);
        setInputText(trimmed);
        return;
      }
      if (res?.usage) {
        receivedUsage = {
          promptTokens: res.usage.promptTokens ?? 0,
          completionTokens: res.usage.completionTokens ?? 0
        };
      }

      if (res && res.success) {
        const proposal = responseTarget?.review(res.answer);
        const resultMessage = proposal ? t('ai_changes_ready_for_review') : responseTarget?.commit(res.answer);
        const aiMessage: ChatMessage = {
          id: `${requestId}-ai`,
          sender: 'ai',
          text: resultMessage ?? res.answer,
          aiContent: responseTarget ? res.answer : undefined,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          usage: receivedUsage
        };
        setMessages(prev => [...prev, aiMessage]);
        if (proposal) {
          setChangeSummary(trimmed.split('\n')[0].slice(0, 500));
          setReview({ proposal, messageId: aiMessage.id, context: requestContext });
        }
        if (requestContext?.onResponse && !proposal) {
          try {
            requestContext.onResponse(res.answer);
          } catch (error: unknown) {
            notify(t("failed_to_apply_the_ai_response_to_settings") +
              getErrorMessage(error));
          }
        }
      } else {
        const errorMessage: ChatMessage = {
          id: `${requestId}-ai`,
          sender: 'ai',
          failed: true,
          usage: receivedUsage,
          text: codingTarget ? formatCodingMessage({ status: 'error', source: '',
            message: res?.error || t("failed_to_receive_the_ai_response") })
            : sqlTarget ? formatCodingMessage({ status: 'error', source: '',
              message: res?.error || t("failed_to_receive_the_ai_response") }, 'sql')
            : res?.error || t("an_error_occurred_check_whether_ai_is_enabled_in_settings"),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, errorMessage]);
      }
    } catch (e: unknown) {
      if (!isCurrentRequest()) return;
      const networkErrorMessage: ChatMessage = {
        id: `${requestId}-ai`,
        sender: 'ai',
        failed: true,
        usage: receivedUsage,
        text: codingTarget ? formatCodingMessage({ status: 'error', source: '', message: getErrorMessage(e) })
          : sqlTarget ? formatCodingMessage({ status: 'error', source: '', message: getErrorMessage(e) }, 'sql')
            : t("connection_error_6", { error: getErrorMessage(e) }),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, networkErrorMessage]);
    } finally {
      // Prevent cleanup from an old request from clearing a newer request.
      if (activeRequestRef.current?.id === requestId) {
        responseTarget?.cancel();
        activeRequestRef.current = null;
        if (mountedRef.current) setIsLoading(false);
      }
    }
  });

  const handleCancelMessage = () => {
    const request = cancelActiveRequest();
    if (!request) return;
    setIsLoading(false);
    markMessageCancelled(request.messageId);
    setInputText(request.text);
  };

  const handleCopyText = async (text: string) => {
    try {
      const copied = await ipcRenderer.invoke('copy-to-clipboard', text);
      if (!copied) throw new Error(t('copy_failed', { error: '' }));
      notify(t('copied_to_clipboard'), { severity: 'success' });
    } catch (error: unknown) {
      notify(t('copy_failed', { error: getErrorMessage(error) }));
    }
  };

  const handleCloseClick = () => {
    const confirmation = history.persistent
      ? t("confirm_close_ai_and_save")
      : t("confirm_close_ai_and_reset");
    if (!window.confirm(confirmation)) return;
    const cancelled = cancelActiveRequest();
    if (cancelled) markMessageCancelled(cancelled.messageId);
    void conversation.flush();
    setInputText('');
    setReview(null); setRequestPreview(null);
    contextRef.current = null;
    setAiContext(null);
    initialPromptSentRef.current = null;
    onClose();
  };

  const handleResetConversation = () => {
    if (isLoading || activeRequestRef.current || !window.confirm(t("confirm_reset_ai_history"))) return;
    setReview(null); setRequestPreview(null);
    conversation.reset();
    setInputText('');
  };

  useEffect(() => {
    const requestKey = aiContext?.requestId ?? aiContext?.initialPrompt;
    if (aiContext?.initialPrompt && requestKey &&
        !isLoading && history.ready && initialPromptSentRef.current !== requestKey) {
      initialPromptSentRef.current = requestKey;
      setInputText(aiContext.initialPrompt);
    }
  }, [aiContext?.initialPrompt, aiContext?.requestId, isLoading, history.ready, handleSendMessage]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', bgcolor: 'background.paper' }}>
      
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 1, minHeight: 48, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <AutoAwesomeIcon sx={{ fontSize: '1rem', mr: 1, verticalAlign: 'text-bottom' }} />
          AI Assistant
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {history.persistent && <Tooltip title={t("reset_conversation")}>
            <span><IconButton size="small" onClick={handleResetConversation} disabled={isLoading} aria-label={t("reset_conversation")}>
              <RestartAltIcon fontSize="small" />
            </IconButton></span>
          </Tooltip>}
          <Tooltip title={t("close")}>
            <IconButton size="small" onClick={handleCloseClick} aria-label={t("close")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover', minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">{t('request')}: {t(aiContext?.requestType || 'unspecified')}</Typography>
        <Tooltip title={aiContext?.targetTab || t('unspecified')}>
          <Typography variant="body2" noWrap>{t('target_window')}: {aiContext?.targetTab || t('unspecified')}</Typography>
        </Tooltip>
      </Box>

      {history.error && <Alert severity="error" sx={{ m: 1 }}>{t("failed_to_load_or_save_ai_conversation_history")} {history.error}</Alert>}
      {!history.ready && !history.error && <Box sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}><CircularProgress size={16} />{t("loading_conversation_history")}</Box>}
      {selection && <AiObjectSelectionPanel key={selection.id} selection={selection} disabled={isLoading || !!review || !history.ready} allowEmpty={allowEmptySelection && !requiredHeader} />}
      <Box component="details" sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', maxHeight: '40%', overflowY: 'auto', flexShrink: 0 }}>
        <Typography component="summary" variant="body2" sx={{ cursor: 'pointer' }}>{t('ai_requirements_and_verification')}</Typography>
        <Typography variant="caption" color="text.secondary">{t('ai_requirements_help')}</Typography>
        {(['inputExample', 'expectedResult', 'actualResult', 'constraints', 'verification'] as const).map(field => (
          <TextField key={field} fullWidth multiline minRows={2} size="small" sx={{ mt: 1 }}
            label={briefLabels[field]} value={requestBrief[field]} disabled={isLoading || !!review}
            inputProps={{ maxLength: 12000 }} onChange={event => setRequestBrief(current => ({ ...current, [field]: event.target.value }))} />
        ))}
        {collectingEnvironment && <Typography role="status" variant="caption">{t('ai_collecting_environment')}</Typography>}
        {environment && <Typography variant="caption">{environment.dbType} {environment.version} · {environment.schema} · {environment.timezone}</Typography>}
        {environmentError && <Alert severity="warning">{environmentError}</Alert>}
        <Button size="small" disabled={isLoading || collectingEnvironment} onClick={() => setEnvironmentRevision(value => value + 1)}>{t('ai_refresh_environment')}</Button>
        <Button size="small" disabled={isLoading || !requestBrief.verification.trim()} onClick={() => setInputText(t('ai_request_verification_repair'))}>{t('ai_create_repair_request')}</Button>
      </Box>
      {requiredHeader && !headerReady && <Alert severity="warning" sx={{ mx: 1.5, mt: 1 }}>{headerMessage}</Alert>}
      <Box ref={chatScroll.scrollRef} onScroll={chatScroll.onScroll} data-testid="ai-conversation-scroll" sx={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowAnchor: 'none', p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {messages.filter(message => message.sender === 'user' || message.sender === 'ai').length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'text.disabled', textAlign: 'center', px: 2 }}>
            <SmartToyOutlinedIcon sx={{ fontSize: 40, mb: 1, opacity: 0.5 }} />
            <Typography variant="body2" fontWeight="bold" color="text.secondary">
              {emptyStateMessage.title}
            </Typography>
            {emptyStateMessage.description && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                {emptyStateMessage.description}
              </Typography>
            )}
          </Box>
        ) : (
          messages.filter(message => message.sender === 'user' || message.sender === 'ai').map(msg => {
            const isUser = msg.sender === 'user';
            return (
              <Box key={msg.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start', width: '100%' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.3, px: 0.5 }}>
                  {isUser ? (
                    <><Typography variant="caption" color="text.disabled">{msg.timestamp}</Typography><PersonOutlineIcon sx={{ fontSize: 14, color: 'text.secondary' }} /></>
                  ) : (
                    <><SmartToyOutlinedIcon sx={{ fontSize: 14, color: 'primary.main' }} /><Typography variant="caption" fontWeight="bold" color="text.secondary">{'AI'}</Typography><Typography variant="caption" color="text.disabled">{msg.timestamp}</Typography></>
                  )}
                </Box>
                <Paper 
                  elevation={0} 
                  sx={{ 
                    p: 1.2, 
                    maxWidth: '90%', 
                    maxHeight: isUser ? 300 : 'none',
                    overflowY: isUser ? 'auto' : 'visible',
                    borderRadius: 2, 
                    bgcolor: isUser ? 'primary.main' : 'action.hover', 
                    color: isUser ? 'primary.contrastText' : 'text.primary', 
                    border: isUser ? 'none' : '1px solid', 
                    borderColor: 'divider', 
                    wordBreak: 'break-word', 
                    whiteSpace: 'pre-wrap', 
                    fontSize: '0.85rem', 
                    position: 'relative' 
                  }}
                >
                  {msg.text}
                  {msg.adoption && <Typography variant="body2" sx={{ mt: 1 }}>{t('ai_adopted_change')}: {msg.adoption.summary}</Typography>}
                  {msg.cancelled && (
                    <Box sx={{ mt: 1 }}>
                      <Chip label={t("sending_canceled")} size="small" variant="outlined"
                        sx={{ color: 'inherit', borderColor: 'currentColor' }} />
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                    <Tooltip title={isUser ? t("copy_message") : t("copy_response")}>
                      <IconButton size="small" aria-label={isUser ? t("copy_message") : t("copy_response")} onClick={() => handleCopyText(msg.text)} sx={{ p: 0.3, color: 'inherit' }}>
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Paper>
                {!isUser && msg.usage && (
                  <Box sx={{ display: 'flex', gap: 0.8, mt: 0.5, px: 0.5 }}>
                    <Chip label={`${t("input")}: ${msg.usage.promptTokens.toLocaleString()} tok`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                    <Chip label={`${t("export_2")}: ${msg.usage.completionTokens.toLocaleString()} tok`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 20 }} />
                  </Box>
                )}
              </Box>
            );
          })
        )}
        {isLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1, color: 'text.secondary' }}>
            <CircularProgress size={16} />
            <Typography variant="caption">{t("ai_is_generating_a_response")}</Typography>
          </Box>
        )}

      </Box>

      {chatScroll.showLatest && <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.5 }}>
        <Button size="small" onClick={chatScroll.scrollToLatest}>{t('ux_latest_messages')}</Button>
      </Box>}
      <Divider />
      <Box sx={{ p: 1.5, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            {t("token_usage_for_the_latest_response")}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
            <Chip
              label={`${t("input_tokens")}: ${latestUsage?.promptTokens.toLocaleString() ?? '—'}`}
              size="small"
              variant="outlined"
            />
            <Chip
              label={`${t("output_tokens")}: ${latestUsage?.completionTokens.toLocaleString() ?? '—'}`}
              size="small"
              variant="outlined"
            />
          </Box>
        </Box>
        <TextField multiline minRows={2} maxRows={6} fullWidth size="small" placeholder={t(sendKey === 'modifier-enter' ? 'ux_ai_request_modifier_placeholder' : 'enter_an_ai_request_shift_enter_for_a_new_line')} value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey && (sendKey === 'enter' || e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            handleSendMessage();
          }
        }} disabled={isLoading || !!review || !history.ready} sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }} />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          {!isLoading && <Button onClick={previewRequest} disabled={collectingEnvironment || !inputText.trim() || !targetsReady || !history.ready || !!review}>{t('ai_preview_request')}</Button>}
          {isLoading ? (
            <Button variant="outlined" color="error" size="small" startIcon={<StopIcon />} onClick={handleCancelMessage}>
              {t("cancel_2")}
            </Button>
          ) : (
            <Button variant="contained" size="small" endIcon={<SendIcon fontSize="small" />} onClick={() => handleSendMessage()} disabled={collectingEnvironment || !inputText.trim() || !targetsReady || !history.ready || !!review} disableElevation sx={{ px: 2 }}>{t("send")}</Button>
          )}
        </Box>
      </Box>
      {requestPreview && <Dialog open fullWidth maxWidth="md" onClose={() => setRequestPreview(null)}>
        <DialogTitle>{t('ai_preview_request')}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 1 }}>{t('ai_preview_request_description')}</Typography>
          <TextField fullWidth multiline value={requestPreview.history.map(item => `${item.role}:\n${item.content}`).join('\n\n') + '\n\nuser:\n' + requestPreview.text}
            InputProps={{ readOnly: true }} minRows={8} maxRows={22} />
        </DialogContent>
        <DialogActions><Button onClick={() => setRequestPreview(null)}>{t('close')}</Button>
          <Button onClick={() => handleSendMessage()}>{t('send')}</Button></DialogActions>
      </Dialog>}
      {review && <AiReviewDialog review={review.proposal} summary={changeSummary} onSummaryChange={setChangeSummary}
        onDiscard={() => {
          setMessages(previous => previous.map(message => message.id === review.messageId ? { ...message, text: t('ai_changes_discarded') } : message));
          setReview(null);
        }} onApply={() => {
          if (reviewRef.current !== review || review.context !== contextRef.current) return;
          try {
            const result = review.proposal.apply();
            const adoption = { summary: changeSummary.trim(), source: review.proposal.after, appliedAt: new Date().toISOString() };
            setMessages(previous => previous.map(message => message.id === review.messageId ? { ...message, text: result, adoption } : message));
            setReview(null);
          } catch (error: unknown) { notify(getErrorMessage(error)); }
        }} />}
    </Box>
  );
}
