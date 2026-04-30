import { useCallback, useEffect, useState } from 'react';
import { useChat } from '../hooks/useChat.js';
import { listTemplates, trackTemplateUsage } from '../api/templatesApi.js';
import ChatConversationChrome from './chat/ChatConversationChrome.jsx';
import ChatComposeArea from './chat/ChatComposeArea.jsx';
import ChatThreadStack from './chat/ChatThreadStack.jsx';
import ChatTemplatePicker from './chat/ChatTemplatePicker.jsx';
import ChatSurfaceShell from './chat/ChatSurfaceShell.jsx';
import LiveCallAssistPanel from './chat/LiveCallAssistPanel.jsx';
import useChatCommandComposer from './chat/useChatCommandComposer.js';
import useChatConversationState from './chat/useChatConversationState.js';
import useChatComposerUi from './chat/useChatComposerUi.js';
import useChatRuntimeEffects from './chat/useChatRuntimeEffects.js';
import useChatRetryControls from './chat/useChatRetryControls.js';
import { tel, TEL } from '../lib/devTelemetry.js';
import './Chat.css';

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncateText(value, max = 180) {
  const text = safeText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}

function firstPresent(values, fallback = '') {
  if (!Array.isArray(values)) return fallback;
  for (const value of values) {
    const text = safeText(value);
    if (text) return text;
  }
  return fallback;
}

function formatCategory(value) {
  const text = safeText(value);
  return text ? text.replace(/-/g, ' ') : '';
}

const EXTRACTED_FIELD_KEYS = Object.freeze({
  'COID/MID': 'coidMid',
  CASE: 'caseNumber',
  'CLIENT/CONTACT': 'clientContact',
  AGENT: 'agentName',
  'CX IS ATTEMPTING TO': 'attemptingTo',
  'EXPECTED OUTCOME': 'expectedOutcome',
  'ACTUAL OUTCOME': 'actualOutcome',
  'KB/TOOLS USED': 'kbToolsUsed',
  'TRIED TEST ACCOUNT': 'triedTestAccount',
  'TS STEPS': 'tsSteps',
});

function parseExtractedEscalationText(sourceText) {
  const fields = {};
  const lines = safeText(sourceText).split(/\r?\n/);
  let currentKey = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const fieldMatch = line.match(/^([A-Z][A-Z0-9/ ]+):\s*(.*)$/);
    const normalizedLabel = fieldMatch
      ? safeText(fieldMatch[1]).replace(/\s+/g, ' ').toUpperCase()
      : '';
    const mappedKey = EXTRACTED_FIELD_KEYS[normalizedLabel] || null;

    if (mappedKey) {
      currentKey = mappedKey;
      fields[currentKey] = safeText(fieldMatch[2]);
      continue;
    }

    if (currentKey) {
      fields[currentKey] = [fields[currentKey], line].filter(Boolean).join(' ');
    }
  }

  const coidMid = safeText(fields.coidMid);
  if (coidMid && (!fields.coid || !fields.mid)) {
    const [coid, mid] = coidMid
      .split('/')
      .map((value) => safeText(value))
      .filter(Boolean);
    if (!fields.coid && coid) fields.coid = coid;
    if (!fields.mid && mid) fields.mid = mid;
  }

  return fields;
}

function buildStructuredParseBlock(fields = {}) {
  const lines = [
    fields.coid ? `COID/MID: ${fields.coid}${fields.mid ? ` / ${fields.mid}` : ''}` : '',
    fields.caseNumber ? `CASE: ${fields.caseNumber}` : '',
    fields.clientContact ? `CLIENT/CONTACT: ${fields.clientContact}` : '',
    fields.agentName ? `AGENT: ${fields.agentName}` : '',
    fields.attemptingTo ? `CX IS ATTEMPTING TO: ${fields.attemptingTo}` : '',
    fields.expectedOutcome ? `EXPECTED OUTCOME: ${fields.expectedOutcome}` : '',
    fields.actualOutcome ? `ACTUAL OUTCOME: ${fields.actualOutcome}` : '',
    fields.kbToolsUsed ? `KB/TOOLS USED: ${fields.kbToolsUsed}` : '',
    fields.triedTestAccount ? `TRIED TEST ACCOUNT: ${fields.triedTestAccount}` : '',
    fields.tsSteps ? `TS STEPS: ${fields.tsSteps}` : '',
    fields.category ? `CATEGORY: ${fields.category}` : '',
    fields.severity ? `SEVERITY: ${fields.severity}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildVisibleParsedTemplate(preview, note = '') {
  const cleanNote = safeText(note);
  const base = safeText(preview?.sourceText) || buildStructuredParseBlock(preview?.fields || {});
  if (!cleanNote) return base;
  return [base, `OPERATOR NOTE: ${cleanNote}`].filter(Boolean).join('\n\n');
}

function buildParsedEscalationPreviewFromText(sourceText) {
  const fields = parseExtractedEscalationText(sourceText);
  const ids = [
    fields.coid ? `COID/MID ${fields.coid}${fields.mid ? ` / ${fields.mid}` : ''}` : '',
    fields.caseNumber ? `Case ${fields.caseNumber}` : '',
  ].filter(Boolean);
  const issue = firstPresent([
    fields.actualOutcome,
    fields.attemptingTo,
  ], 'Parsed escalation screenshot');

  if (Object.keys(fields).length === 0) {
    return buildFallbackEscalationPreview(sourceText);
  }

  return {
    mode: 'structured',
    sourceText,
    fields,
    triageCard: null,
    severity: '',
    category: '',
    ids,
    client: firstPresent([fields.clientContact], 'Unknown'),
    agent: firstPresent([fields.agentName], 'Unknown'),
    summary: truncateText(issue, 220),
    issue: truncateText(issue, 140),
    attemptingTo: truncateText(fields.attemptingTo, 160),
    expectedOutcome: truncateText(fields.expectedOutcome, 140),
    actualOutcome: truncateText(fields.actualOutcome, 140),
    tsSteps: truncateText(fields.tsSteps, 180),
    action: '',
  };
}

function buildFallbackEscalationPreview(sourceText) {
  return {
    mode: 'fallback',
    sourceText,
    fields: {},
    triageCard: null,
    severity: '',
    category: '',
    ids: [],
    client: '',
    agent: '',
    summary: 'Raw screenshot text is available for the main chat, but the compact triage preview did not finish.',
    issue: truncateText(sourceText, 180) || 'Raw screenshot text is ready to send.',
    attemptingTo: '',
    expectedOutcome: '',
    actualOutcome: '',
    tsSteps: '',
    action: '',
  };
}

function buildParsedEscalationSubmission(preview, note = '') {
  const fields = preview?.fields && typeof preview.fields === 'object' ? preview.fields : {};
  const triage = preview?.triageCard && typeof preview.triageCard === 'object' ? preview.triageCard : null;
  const cleanNote = safeText(note);
  const visibleTemplate = buildVisibleParsedTemplate(preview, note);

  const payloadSections = [
    'Use the parsed escalation context below as the canonical reference for this turn.',
    cleanNote ? `Operator note:\n${cleanNote}` : '',
    buildStructuredParseBlock(fields)
      ? `Structured escalation summary:\n${buildStructuredParseBlock(fields)}`
      : '',
    triage
      ? [
        'Server triage summary:',
        triage.severity ? `Severity: ${triage.severity}` : '',
        triage.category ? `Category: ${formatCategory(triage.category)}` : '',
        triage.read ? `Read: ${triage.read}` : '',
        triage.action ? `Action: ${triage.action}` : '',
        Array.isArray(triage.missingInfo) && triage.missingInfo.length > 0 ? `Missing info: ${triage.missingInfo.join('; ')}` : '',
        triage.confidence ? `Confidence: ${triage.confidence}` : '',
        triage.categoryCheck ? `Category check: ${triage.categoryCheck}` : '',
      ].filter(Boolean).join('\n')
      : '',
    preview?.sourceText ? `Raw extracted screenshot text:\n${preview.sourceText}` : '',
    'Write the main escalation response using the normal chat response format. Do not ask for the screenshot again unless critical information is missing.',
  ].filter(Boolean);

  return {
    displayContent: visibleTemplate,
    payloadMessage: payloadSections.join('\n\n'),
  };
}

function isFollowUpParseResult(parsedText, text) {
  if (parsedText && typeof parsedText === 'object') {
    if (parsedText.parserPromptId === 'follow-up-chat-parser' || parsedText.promptId === 'follow-up-chat-parser') return true;
    if (parsedText.role === 'follow-up-chat') return true;
  }
  return /^Context type:\s*phone-agent-follow-up/im.test(text || '');
}

function buildFollowUpContextSubmission(text) {
  const cleanText = safeText(text);
  return {
    displayContent: cleanText,
    payloadMessage: [
      'Use this parsed phone-agent follow-up chat as additional live case context.',
      'It happened after the original escalation template. Do not treat it as a new escalation.',
      'Update diagnosis, missing information, severity, or next action only if this context changes them.',
      '',
      cleanText,
    ].join('\n'),
  };
}

export function ChatView({ conversationIdFromRoute, chat, aiSettings = null, routeView = 'chat' }) {
  const {
    messages,
    conversationId,
    provider,
    mode,
    fallbackProvider,
    model,
    fallbackModel,
    reasoningEffort,
    isStreaming,
    streamingText,
    parallelStreaming,
    streamProvider,
    fallbackNotice,
    runtimeWarnings,
    contextDebug,
    parallelAcceptingKey,
    error,
    errorDetails,
    responseTime,
    processEvents,
    sendMessage,
    retryLastResponse,
    setProvider,
    setMode,
    setFallbackProvider,
    setModel,
    setFallbackModel,
    setReasoningEffort,
    parallelProviders,
    setParallelProviders,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    acceptParallelTurn,
    unacceptParallelTurn,
    triageCard,
    setTriageCard,
    caseIntake,
    invMatches,
    abortStream,
    selectConversation,
    newConversation,
    setError,
    appendProcessEvent,
    clearProcessEvents,
    thinkingText,
    isThinking,
    thinkingStartTime,
    splitModeActive,
    currentTraceId,
  } = chat;
  const [parsedDraftState, setParsedDraftState] = useState(null);
  const [parsedEscalationPreview, setParsedEscalationPreview] = useState(null);
  const [liveCallOpen, setLiveCallOpen] = useState(false);

  // Effective mode accounts for persistent split mode from prior parallel turns
  const effectiveMode = splitModeActive ? 'parallel' : mode;

  const {
    activityExpanded,
    setActivityExpanded,
    showTemplatePicker,
    setShowTemplatePicker,
    templates,
    setTemplates,
    templateCategory,
    setTemplateCategory,
    loadingTemplates,
    setLoadingTemplates,
    showProviderPopover,
    setShowProviderPopover,
    providerPopoverRef,
    streamElapsedMs,
    setStreamElapsedMs,
    liveRequestRuntime,
    setLiveRequestRuntime,
    composeFocused,
    setComposeFocused,
    input,
    setInput,
    images,
    setImages,
    showWebcam,
    setShowWebcam,
    showImageParser,
    setShowImageParser,
    imageParserSeed,
    setImageParserSeed,
    isComposeDragOver,
    setIsComposeDragOver,
    slashMenuIndex,
    setSlashMenuIndex,
    discardedProviders,
    pendingImageParseRef,
    messagesEndRef,
    textareaRef,
    imageInputRef,
    scrollFrameRef,
    handleDiscardProvider,
    handleReEnableProvider,
  } = useChatComposerUi({
    provider,
    mode,
    effectiveMode,
    reasoningEffort,
    parallelProviders,
    isStreaming,
    aiSettings,
    thinkingStartTime,
    sendMessage,
    abortStream,
    setProvider,
    setMode,
    setFallbackProvider,
    setReasoningEffort,
    setParallelProviders,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    clearProcessEvents,
    setError,
    newConversation,
    appendProcessEvent,
  });

  const {
    exportCopied,
    linkedEscalation,
    forkInfo,
    resolvingEscalation,
    savedEscalationId,
    parseMeta,
    setParseMeta,
    resetConversationState,
    handleResolveEscalation,
    handleCopyConversation,
    handleFork,
  } = useChatConversationState({
    conversationId,
    messages,
    isStreaming,
    pendingImageParseRef,
    currentTraceId,
    provider,
    mode,
    fallbackProvider,
    aiSettings,
    appendProcessEvent,
  });

  const {
    canRetryLastResponse,
    handleRetryLastResponse,
  } = useChatRetryControls({
    conversationId,
    messages,
    isStreaming,
    provider,
    retryLastResponse,
  });

  const {
    focusComposerWithValue,
    startFreshConversation,
  } = useChatRuntimeEffects({
    aiSettings,
    conversationIdFromRoute,
    routeView,
    conversationId,
    isStreaming,
    streamingText,
    parallelStreaming,
    provider,
    thinkingStartTime,
    messages,
    input,
    textareaRef,
    messagesEndRef,
    scrollFrameRef,
    setInput,
    setImages,
    setShowWebcam,
    setComposeFocused,
    setIsComposeDragOver,
    setStreamElapsedMs,
    setLiveRequestRuntime,
    selectConversation,
    newConversation,
    resetConversationState,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    clearProcessEvents,
    setError,
  });

  const submitParsedEscalationPreview = useCallback((noteText, previewOverride = null) => {
    const preview = previewOverride || parsedEscalationPreview;
    if (!preview) return false;
    const submission = buildParsedEscalationSubmission(preview, noteText);
    pendingImageParseRef.current = false;
    sendMessage(submission.displayContent, [], provider, [], {
      payloadMessage: submission.payloadMessage,
      displayContent: submission.displayContent,
      requestExtras: {
        parsedEscalationText: preview.sourceText,
        parsedEscalationSource: 'image-parser',
        parsedEscalationProvider: preview.parserProvider || provider,
        parsedEscalationModel: preview.parserModel || '',
      },
    });
    setParsedDraftState({ phase: 'sent' });
    setParseMeta(null);
    setTriageCard(null);
    return true;
  }, [
    parsedEscalationPreview,
    pendingImageParseRef,
    provider,
    sendMessage,
    setParseMeta,
    setTriageCard,
  ]);

  const handleLiveCallSendTranscript = useCallback((payload) => {
    const displayContent = safeText(payload?.displayContent);
    const payloadMessage = safeText(payload?.payloadMessage) || displayContent;
    if (!displayContent || !payloadMessage) return false;

    sendMessage(displayContent, [], provider, [], {
      payloadMessage,
      displayContent,
      requestExtras: {
        liveCallTranscript: safeText(payload?.transcriptText),
        liveCallProvider: payload?.provider || 'elevenlabs',
        liveCallModel: payload?.modelId || 'scribe_v2_realtime',
        liveCallElapsedMs: Number.isFinite(Number(payload?.elapsedMs)) ? Number(payload.elapsedMs) : undefined,
      },
    });
    setInput('');
    appendProcessEvent({
      level: 'info',
      title: 'Live call transcript sent',
      message: 'Started the main chat using the current live call transcript.',
    });
    return true;
  }, [
    appendProcessEvent,
    provider,
    sendMessage,
    setInput,
  ]);

  const handleLiveCallInsertTranscript = useCallback((transcriptText) => {
    const cleanTranscript = safeText(transcriptText);
    if (!cleanTranscript) return;
    setInput((prev) => {
      const cleanPrev = typeof prev === 'string' ? prev.trimEnd() : '';
      return cleanPrev ? `${cleanPrev}\n\n${cleanTranscript}` : cleanTranscript;
    });
    requestAnimationFrame(() => {
      textareaRef.current?.focus?.();
    });
  }, [setInput, textareaRef]);

  const handleImageParsed = useCallback(async (parsedText) => {
    const text = typeof parsedText === 'string' ? parsedText : parsedText?.text || '';
    if (!text.trim()) return;

    focusComposerWithValue('');
    setActivityExpanded(false);
    setParseMeta(null);
    setTriageCard(null);
    const parserProvider = typeof parsedText === 'object' && parsedText
      ? safeText(parsedText.providerUsed || parsedText.provider || '')
      : '';
    const parserModel = typeof parsedText === 'object' && parsedText
      ? safeText(parsedText.modelUsed || parsedText.usage?.model || parsedText.model || '')
      : '';
    const parserPromptId = typeof parsedText === 'object' && parsedText
      ? safeText(parsedText.parserPromptId || parsedText.promptId || '')
      : '';

    if (isFollowUpParseResult(parsedText, text)) {
      const submission = buildFollowUpContextSubmission(text);
      if (isStreaming) {
        setInput((prev) => {
          const cleanPrev = typeof prev === 'string' ? prev.trimEnd() : '';
          return cleanPrev ? `${cleanPrev}\n\n${submission.displayContent}` : submission.displayContent;
        });
        appendProcessEvent({
          level: 'warning',
          title: 'Follow-up context parsed',
          message: 'The main chat is still responding, so the parsed follow-up transcript was placed in the composer to send next.',
          code: 'FOLLOW_UP_CONTEXT_WAITING',
          provider,
        });
        return;
      }

      sendMessage(submission.displayContent, [], provider, [], {
        payloadMessage: submission.payloadMessage,
        displayContent: submission.displayContent,
        requestExtras: {
          followUpContextText: text,
          followUpContextSource: 'follow-up-chat-parser',
          followUpContextProvider: parserProvider || provider,
          followUpContextModel: parserModel || '',
        },
      });
      appendProcessEvent({
        level: 'info',
        title: 'Follow-up context sent',
        message: 'Parsed phone-agent chat context was added to this case and sent to the main chat.',
        code: 'FOLLOW_UP_CONTEXT_SENT',
        provider,
        parserPromptId,
      });
      return;
    }

    const preview = {
      ...buildParsedEscalationPreviewFromText(text),
      parserProvider,
      parserModel,
    };
    setParsedEscalationPreview(preview);
    submitParsedEscalationPreview('', preview);
    appendProcessEvent({
      level: 'info',
      title: 'Parsed escalation sent',
      message: `Started the main chat with ${provider} using the parsed screenshot text. Triage summary and reasoning will stream back on this request.`,
      code: 'PARSED_ESCALATION_SENT',
      provider,
    });
  }, [
    appendProcessEvent,
      focusComposerWithValue,
      isStreaming,
      provider,
      sendMessage,
      setActivityExpanded,
      setInput,
      setParseMeta,
      setTriageCard,
      submitParsedEscalationPreview,
  ]);

  useEffect(() => {
    setParsedEscalationPreview(null);
    setParsedDraftState(null);
  }, [conversationId]);

  useEffect(() => {
    if (!triageCard) return;
    setParsedEscalationPreview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        triageCard,
        severity: safeText(triageCard.severity || prev.severity),
        category: formatCategory(triageCard.category || prev.category),
        client: firstPresent([triageCard.client, prev.client], prev.client),
        agent: firstPresent([triageCard.agent, prev.agent], prev.agent),
        summary: truncateText(triageCard.read || prev.summary, 220),
        action: truncateText(triageCard.action || prev.action, 170),
      };
    });
  }, [triageCard]);

  const clearParsedEscalationPreview = useCallback(() => {
    setParsedEscalationPreview(null);
    setParsedDraftState(null);
    setParseMeta(null);
    setTriageCard(null);
    focusComposerWithValue('');
  }, [focusComposerWithValue, setParseMeta, setTriageCard]);

  let composeStatusNotice = null;
  if (parsedDraftState?.phase === 'ready' || parsedDraftState?.phase === 'sent') {
    composeStatusNotice = {
      tone: isStreaming ? 'info' : 'success',
      text: isStreaming
        ? 'Parsed escalation was sent to the main chat. Use this box only for follow-up. Request activity and reasoning stream in the right dock.'
        : 'Parsed escalation is already in the main chat. Use this box only for follow-up.',
    };
  }

  const {
    handleComposeFocus,
    handleComposeBlur,
    handleAttachClick,
    filteredSlashCommands,
    slashMenuOpen,
    activateSlashCommand,
    handleSubmit,
    handleQuickAction,
    handleKeyDown,
    handlePaste,
    handleComposeInputChange,
    handleWebcamCapture,
    handleFilePickerChange,
    handleComposeDragEnter,
    handleComposeDragOver,
    handleComposeDragLeave,
    handleComposeDrop,
    openTemplatePicker,
    handleTemplateInsert,
    handleTemplateCategoryChange,
    removeImage,
  } = useChatCommandComposer({
    provider,
    effectiveMode,
    reasoningEffort,
    isStreaming,
    input,
    setInput,
    images,
    setImages,
    showWebcam,
    setShowWebcam,
    setShowImageParser,
    setImageParserSeed,
    isComposeDragOver,
    setIsComposeDragOver,
    slashMenuIndex,
    setSlashMenuIndex,
    composeFocused,
    setComposeFocused,
    templateCategory,
    setTemplateCategory,
    loadingTemplates,
    setLoadingTemplates,
    setShowTemplatePicker,
    setTemplates,
    textareaRef,
    imageInputRef,
    pendingImageParseRef,
    sendMessage,
    startFreshConversation,
    focusComposerWithValue,
    setParseMeta,
    setProvider,
    setMode,
    setReasoningEffort,
    appendProcessEvent,
  });

  // Load conversation from route param
  useEffect(() => {
    tel(TEL.MOUNT, 'Chat component mounted');
  }, []);

  // State anomaly: messages exist without a conversationId
  useEffect(() => {
    if (!conversationId && messages.length > 0) {
      tel(TEL.STATE_ANOMALY, 'Messages exist but no conversationId', { messageCount: messages.length });
    }
  }, [conversationId, messages.length]);

  // State anomaly: streaming flag is on but no streaming text arriving after 15s
  useEffect(() => {
    if (!isStreaming) return;
    const timer = setTimeout(() => {
      if (isStreaming && !streamingText && !Object.keys(parallelStreaming).length) {
        tel(TEL.STATE_ANOMALY, 'Streaming active for 15s but no content received', { provider, conversationId });
      }
    }, 15000);
    return () => clearTimeout(timer);
  }, [isStreaming, streamingText, parallelStreaming, provider, conversationId]);

  // Close provider popover on outside click or Escape
  useEffect(() => {
    if (!showProviderPopover) return;
    const handleClick = (e) => {
      if (providerPopoverRef.current && !providerPopoverRef.current.contains(e.target)) {
        setShowProviderPopover(false);
      }
    };
    const handleKey = (e) => {
      if (e.key === 'Escape') setShowProviderPopover(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showProviderPopover]);

  return (
    <div className="chat-with-thinking">
      <div className="chat-container">
        <ChatConversationChrome
          linkedEscalation={linkedEscalation}
          handleResolveEscalation={handleResolveEscalation}
          resolvingEscalation={resolvingEscalation}
          forkInfo={forkInfo}
        >
          <ChatSurfaceShell
            threadContent={
              <ChatThreadStack
                aiSettings={aiSettings}
                conversationId={conversationId}
                provider={provider}
                effectiveMode={effectiveMode}
                reasoningEffort={reasoningEffort}
                streamProvider={streamProvider}
                streamingText={streamingText}
                thinkingText={thinkingText}
                messages={messages}
                parallelProviders={parallelProviders}
                parallelStreaming={parallelStreaming}
                liveRequestRuntime={liveRequestRuntime}
                processEvents={processEvents}
                streamElapsedMs={streamElapsedMs}
                runtimeWarnings={runtimeWarnings}
                dismissRuntimeWarnings={dismissRuntimeWarnings}
                contextDebug={contextDebug}
                fallbackNotice={fallbackNotice}
                dismissFallbackNotice={dismissFallbackNotice}
                triageCard={triageCard}
                invMatches={invMatches}
                error={error}
                errorDetails={errorDetails}
                retryLastResponse={retryLastResponse}
                setError={setError}
                acceptParallelTurn={acceptParallelTurn}
                unacceptParallelTurn={unacceptParallelTurn}
                handleDiscardProvider={handleDiscardProvider}
                handleReEnableProvider={handleReEnableProvider}
                parallelAcceptingKey={parallelAcceptingKey}
                discardedProviders={discardedProviders}
                handleFork={handleFork}
                handleQuickAction={handleQuickAction}
                parseMeta={parseMeta}
                savedEscalationId={savedEscalationId}
                messagesEndRef={messagesEndRef}
                isStreaming={isStreaming}
                newConversation={newConversation}
                activityExpanded={activityExpanded}
                setActivityExpanded={setActivityExpanded}
                clearProcessEvents={clearProcessEvents}
                caseIntake={caseIntake}
                hideTriageCard={Boolean(parsedEscalationPreview && parsedDraftState?.phase !== 'sent')}
                liveCallPanel={liveCallOpen ? (
                  <LiveCallAssistPanel
                    open
                    disabled={isStreaming}
                    onClose={() => setLiveCallOpen(false)}
                    onInsertTranscript={handleLiveCallInsertTranscript}
                    onSendTranscript={handleLiveCallSendTranscript}
                  />
                ) : null}
              />
            }
            composeArea={
              <ChatComposeArea
                providerPopoverRef={providerPopoverRef}
                provider={provider}
                mode={mode}
                fallbackProvider={fallbackProvider}
                model={model}
                fallbackModel={fallbackModel}
                reasoningEffort={reasoningEffort}
                parallelProviders={parallelProviders}
                showProviderPopover={showProviderPopover}
                setShowProviderPopover={setShowProviderPopover}
                setProvider={setProvider}
                setMode={setMode}
                setFallbackProvider={setFallbackProvider}
                setModel={setModel}
                setFallbackModel={setFallbackModel}
                setReasoningEffort={setReasoningEffort}
                setParallelProviders={setParallelProviders}
                composeFocused={composeFocused}
                handleComposeFocus={handleComposeFocus}
                handleComposeBlur={handleComposeBlur}
                isComposeDragOver={isComposeDragOver}
                handleComposeDragEnter={handleComposeDragEnter}
                handleComposeDragOver={handleComposeDragOver}
                handleComposeDragLeave={handleComposeDragLeave}
                handleComposeDrop={handleComposeDrop}
                input={input}
                textareaRef={textareaRef}
                handleComposeInputChange={handleComposeInputChange}
                handleKeyDown={handleKeyDown}
                handlePaste={handlePaste}
                isStreaming={isStreaming}
                images={images}
                imageInputRef={imageInputRef}
                handleAttachClick={handleAttachClick}
                handleFilePickerChange={handleFilePickerChange}
                showWebcam={showWebcam}
                setShowWebcam={setShowWebcam}
                showImageParser={showImageParser}
                setShowImageParser={setShowImageParser}
                imageParserSeed={imageParserSeed}
                setImageParserSeed={setImageParserSeed}
                handleWebcamCapture={handleWebcamCapture}
                openTemplatePicker={openTemplatePicker}
                removeImage={removeImage}
                effectiveMode={effectiveMode}
                abortStream={abortStream}
                handleSubmit={handleSubmit}
                slashMenuOpen={slashMenuOpen}
                filteredSlashCommands={filteredSlashCommands}
                slashMenuIndex={slashMenuIndex}
                activateSlashCommand={activateSlashCommand}
                parsedEscalationPreview={parsedDraftState?.phase === 'sent' ? null : parsedEscalationPreview}
                onClearParsedEscalationPreview={clearParsedEscalationPreview}
                composeStatusNotice={composeStatusNotice}
                onImageParsed={handleImageParsed}
                conversationId={conversationId}
                messages={messages}
                canRetryLastResponse={canRetryLastResponse}
                exportCopied={exportCopied}
                onStartFreshConversation={startFreshConversation}
                onRetryLastResponse={handleRetryLastResponse}
                onCopyConversation={handleCopyConversation}
                liveCallOpen={liveCallOpen}
                onToggleLiveCall={() => setLiveCallOpen((prev) => !prev)}
              />
            }
          />
        </ChatConversationChrome>

        <ChatTemplatePicker
          showTemplatePicker={showTemplatePicker}
          templateCategory={templateCategory}
          loadingTemplates={loadingTemplates}
          templates={templates}
          onClose={() => setShowTemplatePicker(false)}
          onCategoryChange={handleTemplateCategoryChange}
          onInsert={handleTemplateInsert}
        />
      </div>
    </div>
  );
}

export default function Chat(props) {
  const chat = useChat();
  return <ChatView {...props} chat={chat} />;
}
