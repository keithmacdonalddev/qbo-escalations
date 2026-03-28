import { useEffect } from 'react';
import { useChat } from '../hooks/useChat.js';
import { listTemplates, trackTemplateUsage } from '../api/templatesApi.js';
import ChatConversationChrome from './chat/ChatConversationChrome.jsx';
import ChatComposeArea from './chat/ChatComposeArea.jsx';
import ChatThreadStack from './chat/ChatThreadStack.jsx';
import ChatTemplatePicker from './chat/ChatTemplatePicker.jsx';
import ChatSurfaceShell from './chat/ChatSurfaceShell.jsx';
import useChatCommandComposer from './chat/useChatCommandComposer.js';
import useChatConversationState from './chat/useChatConversationState.js';
import useChatComposerUi from './chat/useChatComposerUi.js';
import useChatRuntimeEffects from './chat/useChatRuntimeEffects.js';
import useChatRetryControls from './chat/useChatRetryControls.js';
import { tel, TEL } from '../lib/devTelemetry.js';
import './Chat.css';

export function ChatView({ conversationIdFromRoute, chat, aiSettings = null }) {
  const {
    messages,
    conversationId,
    provider,
    mode,
    fallbackProvider,
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
    setReasoningEffort,
    parallelProviders,
    setParallelProviders,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    acceptParallelTurn,
    unacceptParallelTurn,
    triageCard,
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
    showSettingsPopover,
    setShowSettingsPopover,
    providerPopoverRef,
    settingsPopoverRef,
    smartComposeEnabled,
    setSmartComposeEnabled,
    contextPillEnabled,
    setContextPillEnabled,
    copiedField,
    setCopiedField,
    showCopilot,
    setShowCopilot,
    surfaceTab,
    setSurfaceTab,
    streamElapsedMs,
    setStreamElapsedMs,
    liveRequestRuntime,
    setLiveRequestRuntime,
    composeFocused,
    setComposeFocused,
    input,
    setInput,
    ghostText,
    setGhostText,
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
    handleOpenTraceLogs,
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
    conversationId,
    isStreaming,
    streamingText,
    parallelStreaming,
    provider,
    thinkingStartTime,
    surfaceTab,
    messages,
    input,
    textareaRef,
    messagesEndRef,
    scrollFrameRef,
    setInput,
    setGhostText,
    setImages,
    setShowWebcam,
    setShowCopilot,
    setSurfaceTab,
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

  const {
    toggleSmartCompose,
    toggleContextPill,
    handleCopyField,
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
    showCopilot,
    surfaceTab,
    isStreaming,
    input,
    setInput,
    ghostText,
    setGhostText,
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
    smartComposeEnabled,
    setSmartComposeEnabled,
    contextPillEnabled,
    setContextPillEnabled,
    copiedField,
    setCopiedField,
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
    setSurfaceTab,
    setShowCopilot,
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

  // Close provider popover on outside click
  useEffect(() => {
    if (!showProviderPopover) return;
    const handler = (e) => {
      if (providerPopoverRef.current && !providerPopoverRef.current.contains(e.target)) {
        setShowProviderPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProviderPopover]);

  // Close settings popover on outside click
  useEffect(() => {
    if (!showSettingsPopover) return;
    const handler = (e) => {
      if (settingsPopoverRef.current && !settingsPopoverRef.current.contains(e.target)) {
        setShowSettingsPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSettingsPopover]);

  return (
    <div className="chat-with-thinking">
      <div className="chat-container">
        <ChatConversationChrome
          linkedEscalation={linkedEscalation}
          handleResolveEscalation={handleResolveEscalation}
          resolvingEscalation={resolvingEscalation}
          forkInfo={forkInfo}
          showCopilot={showCopilot}
          savedEscalationId={savedEscalationId}
          contextPillEnabled={contextPillEnabled}
          copiedField={copiedField}
          handleCopyField={handleCopyField}
        >
          <ChatSurfaceShell
            chat={chat}
            surfaceTab={surfaceTab}
            onSurfaceTabChange={setSurfaceTab}
            conversationId={conversationId}
            conversationIdFromRoute={conversationIdFromRoute}
            messages={messages}
            isStreaming={isStreaming}
            canRetryLastResponse={canRetryLastResponse}
            exportCopied={exportCopied}
            onStartFreshConversation={startFreshConversation}
            onRetryLastResponse={handleRetryLastResponse}
            onOpenTraceLogs={handleOpenTraceLogs}
            onCopyConversation={handleCopyConversation}
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
                linkedEscalation={linkedEscalation}
                handleResolveEscalation={handleResolveEscalation}
                resolvingEscalation={resolvingEscalation}
                forkInfo={forkInfo}
                parseMeta={parseMeta}
                savedEscalationId={savedEscalationId}
                messagesEndRef={messagesEndRef}
                isStreaming={isStreaming}
                newConversation={newConversation}
                activityExpanded={activityExpanded}
                setActivityExpanded={setActivityExpanded}
                clearProcessEvents={clearProcessEvents}
              />
            }
            composeArea={
              <ChatComposeArea
                providerPopoverRef={providerPopoverRef}
                settingsPopoverRef={settingsPopoverRef}
                provider={provider}
                mode={mode}
                fallbackProvider={fallbackProvider}
                reasoningEffort={reasoningEffort}
                parallelProviders={parallelProviders}
                showProviderPopover={showProviderPopover}
                setShowProviderPopover={setShowProviderPopover}
                showSettingsPopover={showSettingsPopover}
                setShowSettingsPopover={setShowSettingsPopover}
                setProvider={setProvider}
                setMode={setMode}
                setFallbackProvider={setFallbackProvider}
                setReasoningEffort={setReasoningEffort}
                setParallelProviders={setParallelProviders}
                smartComposeEnabled={smartComposeEnabled}
                toggleSmartCompose={toggleSmartCompose}
                contextPillEnabled={contextPillEnabled}
                toggleContextPill={toggleContextPill}
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
                ghostText={ghostText}
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
                onImageParsed={focusComposerWithValue}
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
