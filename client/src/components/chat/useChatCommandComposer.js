import { useCallback } from 'react';
import { computeGhostText } from '../../data/smartComposeSuggestions.js';
import { tel, TEL } from '../../lib/devTelemetry.js';
import useChatComposerMediaAndTemplates from './useChatComposerMediaAndTemplates.js';
import useChatSlashCommands from './useChatSlashCommands.js';

export default function useChatCommandComposer({
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
}) {
  const {
    handleAttachClick,
    handlePaste,
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
  } = useChatComposerMediaAndTemplates({
    setImages,
    isStreaming,
    imageInputRef,
    isComposeDragOver,
    setIsComposeDragOver,
    templateCategory,
    setTemplateCategory,
    setLoadingTemplates,
    setShowTemplatePicker,
    setTemplates,
    textareaRef,
    setInput,
    appendProcessEvent,
    setShowWebcam,
    setShowImageParser,
    setImageParserSeed,
  });

  const {
    slashCommands,
    filteredSlashCommands,
    slashMenuOpen,
    insertSlashCommand,
    executeSlashCommand,
    activateSlashCommand,
  } = useChatSlashCommands({
    provider,
    effectiveMode,
    reasoningEffort,
    showCopilot,
    surfaceTab,
    isStreaming,
    input,
    setInput,
    setGhostText,
    setSlashMenuIndex,
    startFreshConversation,
    focusComposerWithValue,
    handleAttachClick,
    setShowWebcam,
    setProvider,
    setMode,
    setReasoningEffort,
    setSurfaceTab,
    setShowCopilot,
  });

  const toggleSmartCompose = useCallback((enabled) => {
    setSmartComposeEnabled(enabled);
    try { window.localStorage.setItem('qbo-smart-compose-enabled', String(enabled)); } catch {}
    if (!enabled) setGhostText('');
  }, [setGhostText, setSmartComposeEnabled]);

  const toggleContextPill = useCallback((enabled) => {
    setContextPillEnabled(enabled);
    try { window.localStorage.setItem('qbo-context-pill-enabled', String(enabled)); } catch {}
  }, [setContextPillEnabled]);

  const handleCopyField = useCallback(async (fieldName, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // silent
    }
  }, [setCopiedField]);

  const handleComposeFocus = useCallback(() => {
    setComposeFocused(true);
  }, [setComposeFocused]);

  const handleComposeBlur = useCallback(() => {
    setComposeFocused(false);
  }, [setComposeFocused]);

  const handleSubmit = useCallback(() => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isStreaming) return;
    if (input.trim().startsWith('/')) {
      executeSlashCommand(input);
      return;
    }
    setParseMeta(null);
    pendingImageParseRef.current = false;
    tel(TEL.USER_ACTION, 'User clicked send', { hasImages: false, textLength: trimmedInput.length });
    sendMessage(trimmedInput, [], provider);
    setInput('');
    setImages([]);
    setGhostText('');
  }, [executeSlashCommand, input, isStreaming, pendingImageParseRef, provider, sendMessage, setGhostText, setImages, setInput, setParseMeta]);

  const handleQuickAction = useCallback((value) => {
    if (isStreaming || !value) return;
    sendMessage(value, [], provider);
  }, [isStreaming, provider, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (slashMenuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenuIndex((prev) => Math.min(prev + 1, Math.max(filteredSlashCommands.length - 1, 0)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenuIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (e.key === 'Tab' && filteredSlashCommands.length > 0) {
        e.preventDefault();
        insertSlashCommand(filteredSlashCommands[Math.min(slashMenuIndex, filteredSlashCommands.length - 1)]);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && filteredSlashCommands.length > 0) {
        e.preventDefault();
        const selectedCommand = filteredSlashCommands[Math.min(slashMenuIndex, filteredSlashCommands.length - 1)];
        if (!input.trim().includes(' ')) {
          activateSlashCommand(selectedCommand);
          return;
        }
      }
    }
    if (e.key === 'Tab' && ghostText) {
      e.preventDefault();
      setInput((prev) => prev + ghostText);
      setGhostText('');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [activateSlashCommand, filteredSlashCommands, ghostText, handleSubmit, input, insertSlashCommand, setGhostText, setInput, setSlashMenuIndex, slashMenuIndex, slashMenuOpen]);

  const handleComposeInputChange = useCallback((e) => {
    const val = e.target.value;
    setInput(val);
    if (val.trimStart().startsWith('/')) {
      setGhostText('');
    } else if (smartComposeEnabled) {
      setGhostText(computeGhostText(val));
    }
  }, [setGhostText, setInput, smartComposeEnabled]);

  return {
    toggleSmartCompose,
    toggleContextPill,
    handleCopyField,
    handleComposeFocus,
    handleComposeBlur,
    handleAttachClick,
    slashCommands,
    filteredSlashCommands,
    slashMenuOpen,
    insertSlashCommand,
    executeSlashCommand,
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
    copiedField,
    composeFocused,
    smartComposeEnabled,
    contextPillEnabled,
    showWebcam,
    isComposeDragOver,
    slashMenuIndex,
  };
}
