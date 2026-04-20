import { useCallback } from 'react';
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
  }, [executeSlashCommand, input, isStreaming, pendingImageParseRef, provider, sendMessage, setImages, setInput, setParseMeta]);

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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [activateSlashCommand, filteredSlashCommands, handleSubmit, input, insertSlashCommand, setInput, setSlashMenuIndex, slashMenuIndex, slashMenuOpen]);

  const handleComposeInputChange = useCallback((e) => {
    setInput(e.target.value);
  }, [setInput]);

  return {
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
    composeFocused,
    showWebcam,
    isComposeDragOver,
    slashMenuIndex,
  };
}
