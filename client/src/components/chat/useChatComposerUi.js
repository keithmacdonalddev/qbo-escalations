import { useCallback, useEffect, useRef, useState } from 'react';

export default function useChatComposerUi() {
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateCategory, setTemplateCategory] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showProviderPopover, setShowProviderPopover] = useState(false);
  const [composeFocused, setComposeFocused] = useState(false);
  const [input, setInput] = useState(() => {
    if (!import.meta.env.DEV) return '';
    try {
      const saved = sessionStorage.getItem('qbo-draft-input');
      if (saved) {
        sessionStorage.removeItem('qbo-draft-input');
        return saved;
      }
    } catch {}
    return '';
  });
  const [streamElapsedMs, setStreamElapsedMs] = useState(0);
  const [liveRequestRuntime, setLiveRequestRuntime] = useState(null);
  const [images, setImages] = useState([]);
  const [showWebcam, setShowWebcam] = useState(false);
  const [showImageParser, setShowImageParser] = useState(false);
  const [imageParserSeed, setImageParserSeed] = useState(null);
  const [isComposeDragOver, setIsComposeDragOver] = useState(false);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [discardedProviders, setDiscardedProviders] = useState({});

  const providerPopoverRef = useRef(null);
  const pendingImageParseRef = useRef(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const scrollFrameRef = useRef(0);

  useEffect(() => {
    if (!showProviderPopover) return;
    const handler = (event) => {
      if (providerPopoverRef.current && !providerPopoverRef.current.contains(event.target)) {
        setShowProviderPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showProviderPopover]);

  const handleDiscardProvider = useCallback((turnId, discardedProvider) => {
    setDiscardedProviders((prev) => {
      const existing = prev[turnId] || [];
      if (existing.includes(discardedProvider)) return prev;
      return { ...prev, [turnId]: [...existing, discardedProvider] };
    });
  }, []);

  const handleReEnableProvider = useCallback((turnId) => {
    setDiscardedProviders((prev) => {
      const next = { ...prev };
      delete next[turnId];
      return next;
    });
  }, []);

  return {
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
  };
}
