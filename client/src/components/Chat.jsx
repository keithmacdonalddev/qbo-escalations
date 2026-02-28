import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Tooltip from './Tooltip.jsx';
import { useChat } from '../hooks/useChat.js';
import { transitions, fadeSlideUp, fadeSlideDown, fade, popover } from '../utils/motion.js';
import { exportConversation, getConversation, forkConversation } from '../api/chatApi.js';
import {
  parseEscalation,
  getEscalation,
  transitionEscalation,
  linkEscalation,
} from '../api/escalationsApi.js';
import { listTemplates, trackTemplateUsage } from '../api/templatesApi.js';
import ChatMessage from './ChatMessage.jsx';
import ParallelResponsePair from './ParallelResponsePair.jsx';
import TriageCard from './TriageCard.jsx';
import CopilotPanel from './CopilotPanel.jsx';
import ThinkingSidebar from './ThinkingSidebar.jsx';
import { computeGhostText } from '../data/smartComposeSuggestions.js';
import { getProviderLabel } from '../utils/markdown.jsx';

/**
 * Group messages for rendering: parallel messages with the same turnId become a single group.
 */
function groupMessagesForRendering(messages) {
  const groups = [];
  const seenTurnIds = new Set();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const turnId = msg.attemptMeta?.turnId;

    if (msg.role === 'assistant' && msg.mode === 'parallel' && turnId) {
      if (seenTurnIds.has(turnId)) continue;
      seenTurnIds.add(turnId);

      const turnMessages = messages
        .map((m, idx) => ({ ...m, _index: idx }))
        .filter(m => m.role === 'assistant' && m.mode === 'parallel' && m.attemptMeta?.turnId === turnId);

      groups.push({
        type: 'parallel-pair',
        turnId,
        responses: turnMessages,
        firstIndex: turnMessages[0]._index,
      });
    } else {
      groups.push({ type: 'single', message: msg, index: i });
    }
  }
  return groups;
}

/**
 * Detect if a parallel turn was triggered by an image upload (template parsing).
 */
function detectImageParseTurn(messages, parallelIndex) {
  for (let i = parallelIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return Array.isArray(messages[i].images) && messages[i].images.length > 0;
    }
  }
  return false;
}

const PARSE_ESCALATION_PROMPT = 'Parse this escalation image for fast triage.';

const QUICK_PROMPTS = [
  { label: 'Parse Escalation', prompt: PARSE_ESCALATION_PROMPT },
  { label: 'Draft Response', prompt: 'Based on our conversation, draft a professional response I can send back to the phone agent. Include specific resolution steps.' },
  { label: 'Categorize Issue', prompt: 'What QBO category does this issue fall under? Explain your reasoning and list related known issues in that category.' },
  { label: 'Suggest Troubleshooting', prompt: 'Based on the issue described, what troubleshooting steps should the agent try next? List them in order of likelihood to resolve.' },
];

const PROVIDER_OPTIONS = [
  { value: 'claude', label: 'Claude' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'chatgpt-5.3-codex-high', label: 'ChatGPT 5.3 Codex (High)' },
  { value: 'gpt-5-mini', label: 'GPT-5 Mini' },
];
const MODE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'fallback', label: 'Fallback' },
  { value: 'parallel', label: 'Parallel' },
];

function formatTokenEstimate(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatProcessEventTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function createFileMetaKey(file) {
  const name = file?.name || '';
  const size = Number.isFinite(file?.size) ? file.size : 0;
  const lastModified = Number.isFinite(file?.lastModified) ? file.lastModified : 0;
  return `${name}::${size}::${lastModified}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function computeFileHash(file) {
  if (!globalThis.crypto?.subtle) {
    return null;
  }
  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function ChatView({ conversationIdFromRoute, chat }) {
  const {
    messages,
    conversationId,
    provider,
    mode,
    fallbackProvider,
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
    parallelProviders,
    setParallelProviders,
    dismissFallbackNotice,
    dismissRuntimeWarnings,
    acceptParallelTurn,
    unacceptParallelTurn,
    triageCard,
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
  } = chat;

  // Effective mode accounts for persistent split mode from prior parallel turns
  const effectiveMode = splitModeActive ? 'parallel' : mode;

  const [exportCopied, setExportCopied] = useState(false);
  const [savedEscalationId, setSavedEscalationId] = useState(null);
  const [parseMeta, setParseMeta] = useState(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateCategory, setTemplateCategory] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [showProviderPopover, setShowProviderPopover] = useState(false);
  const [composeFocused, setComposeFocused] = useState(false);
  const [discardedProviders, setDiscardedProviders] = useState({});
  const providerPopoverRef = useRef(null);

  const handleDiscardProvider = useCallback((turnId, discardedProvider) => {
    setDiscardedProviders(prev => {
      const existing = prev[turnId] || [];
      if (existing.includes(discardedProvider)) return prev;
      return { ...prev, [turnId]: [...existing, discardedProvider] };
    });
  }, []);
  const handleReEnableProvider = useCallback((turnId) => {
    setDiscardedProviders(prev => {
      const next = { ...prev };
      delete next[turnId];
      return next;
    });
  }, []);

  // Compose settings popover
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const settingsPopoverRef = useRef(null);

  // Feature B: Smart Compose
  const [smartComposeEnabled, setSmartComposeEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('qbo-smart-compose-enabled');
    return stored === null ? true : stored === 'true';
  });
  const [ghostText, setGhostText] = useState('');

  // Feature C: Context Pill
  const [contextPillEnabled, setContextPillEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('qbo-context-pill-enabled');
    return stored === null ? true : stored === 'true';
  });
  const [copiedField, setCopiedField] = useState(null);

  // Co-pilot panel toggle
  const [showCopilot, setShowCopilot] = useState(false);

  const [linkedEscalation, setLinkedEscalation] = useState(null);
  const [resolvingEscalation, setResolvingEscalation] = useState(false);

  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [isComposeDragOver, setIsComposeDragOver] = useState(false);
  const pendingImageParseRef = useRef(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);

  // Check if current conversation has a linked escalation
  useEffect(() => {
    if (!conversationId) { setLinkedEscalation(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const conv = await getConversation(conversationId);
        if (cancelled) return;
        if (conv.escalationId) {
          const esc = await getEscalation(conv.escalationId);
          if (!cancelled) setLinkedEscalation(esc);
        } else {
          setLinkedEscalation(null);
        }
      } catch {
        if (!cancelled) setLinkedEscalation(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, savedEscalationId]);

  // Load conversation from route param
  useEffect(() => {
    if (conversationIdFromRoute && conversationIdFromRoute !== conversationId) {
      selectConversation(conversationIdFromRoute);
      return;
    }
    if (conversationIdFromRoute === null && conversationId) {
      newConversation();
    }
  }, [conversationIdFromRoute, conversationId, selectConversation, newConversation]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, parallelStreaming]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      // Ctrl+N: new conversation
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newConversation]);

  // Focus input after streaming ends
  useEffect(() => {
    if (!isStreaming) {
      textareaRef.current?.focus();
    }
  }, [isStreaming]);

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

  // Toggle callbacks
  const toggleSmartCompose = useCallback((enabled) => {
    setSmartComposeEnabled(enabled);
    window.localStorage.setItem('qbo-smart-compose-enabled', String(enabled));
    if (!enabled) setGhostText('');
  }, []);

  const toggleContextPill = useCallback((enabled) => {
    setContextPillEnabled(enabled);
    window.localStorage.setItem('qbo-context-pill-enabled', String(enabled));
  }, []);

  // Copy field handler for context pill
  const handleCopyField = useCallback(async (fieldName, value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 1500);
    } catch { /* silent */ }
  }, []);

  const appendImageFiles = useCallback((files) => {
    const imageFiles = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;

    Promise.all(imageFiles.map(async (file) => {
      try {
        const [src, hash] = await Promise.all([
          readFileAsDataUrl(file),
          computeFileHash(file).catch(() => null),
        ]);
        return {
          src,
          hash,
          metaKey: createFileMetaKey(file),
        };
      } catch {
        return null;
      }
    })).then((prepared) => {
      const preparedCount = prepared.filter(Boolean).length;
      setImages((prev) => {
        const seenHashes = new Set(prev.map((img) => img.hash).filter(Boolean));
        const seenMetaKeys = new Set(prev.map((img) => img.metaKey));
        const next = [...prev];

        for (const item of prepared) {
          if (!item) continue;
          if ((item.hash && seenHashes.has(item.hash)) || seenMetaKeys.has(item.metaKey)) {
            continue;
          }
          if (item.hash) {
            seenHashes.add(item.hash);
          }
          seenMetaKeys.add(item.metaKey);
          next.push(item);
        }
        return next;
      });
      if (preparedCount > 0) {
        appendProcessEvent({
          level: 'info',
          title: 'Image attached',
          message: `${preparedCount} image${preparedCount === 1 ? '' : 's'} added to this message.`,
          code: 'IMAGE_ATTACHED',
          imageCount: preparedCount,
        });
      }
    });
  }, [appendProcessEvent]);

  const removeImage = useCallback((index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
    appendProcessEvent({
      level: 'info',
      title: 'Image removed',
      message: `Removed attachment ${index + 1}.`,
      code: 'IMAGE_REMOVED',
    });
  }, [appendProcessEvent]);

  const hasImageItems = useCallback((dataTransfer) => {
    if (!dataTransfer) return false;
    const items = Array.from(dataTransfer.items || []);
    if (items.some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return true;
    const files = Array.from(dataTransfer.files || []);
    return files.some((file) => file?.type?.startsWith('image/'));
  }, []);

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && images.length === 0) || isStreaming) return;
    setParseMeta(null);
    // Auto-inject parse prompt when sending images with no text
    const textToSend = !input.trim() && images.length > 0 ? PARSE_ESCALATION_PROMPT : input;
    pendingImageParseRef.current = !input.trim() && images.length > 0;
    sendMessage(textToSend, images.map((img) => img.src), provider);
    setInput('');
    setImages([]);
    setGhostText('');
  }, [input, images, isStreaming, sendMessage, provider]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab' && ghostText) {
      e.preventDefault();
      setInput(prev => prev + ghostText);
      setGhostText('');
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit, ghostText]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
      appendImageFiles(files);
    }
  }, [appendImageFiles]);

  const handleAttachClick = useCallback(() => {
    if (isStreaming) return;
    imageInputRef.current?.click();
  }, [isStreaming]);

  const handleFilePickerChange = useCallback((e) => {
    appendImageFiles(e.target.files);
    e.target.value = '';
  }, [appendImageFiles]);

  const handleComposeDragEnter = useCallback((e) => {
    if (isStreaming || !hasImageItems(e.dataTransfer)) return;
    e.preventDefault();
    setIsComposeDragOver(true);
  }, [isStreaming, hasImageItems]);

  const handleComposeDragOver = useCallback((e) => {
    if (isStreaming || !hasImageItems(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isComposeDragOver) {
      setIsComposeDragOver(true);
    }
  }, [isStreaming, hasImageItems, isComposeDragOver]);

  const handleComposeDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setIsComposeDragOver(false);
  }, []);

  const handleComposeDrop = useCallback((e) => {
    if (!hasImageItems(e.dataTransfer)) return;
    e.preventDefault();
    setIsComposeDragOver(false);
    if (isStreaming) return;
    appendImageFiles(e.dataTransfer.files);
  }, [isStreaming, hasImageItems, appendImageFiles]);

  const handleQuickPrompt = useCallback((prompt) => {
    if (isStreaming) return;
    setParseMeta(null);
    sendMessage(prompt, images.map((img) => img.src), provider);
    setImages([]);
  }, [isStreaming, images, sendMessage, provider]);


  // Mark linked escalation as resolved
  const handleResolveEscalation = useCallback(async () => {
    if (!linkedEscalation || resolvingEscalation) return;
    setResolvingEscalation(true);
    try {
      const updated = await transitionEscalation(linkedEscalation._id, 'resolved');
      setLinkedEscalation(updated);
    } catch { /* ignore */ }
    setResolvingEscalation(false);
  }, [linkedEscalation, resolvingEscalation]);

  // Auto-save escalation after image parse completes
  useEffect(() => {
    if (isStreaming || !pendingImageParseRef.current || !conversationId || savedEscalationId) return;
    pendingImageParseRef.current = false;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser || !Array.isArray(lastUser.images) || lastUser.images.length === 0) return;
    // Use first image (most likely the escalation template); parse API accepts a single image
    const primaryImage = lastUser.images[0];
    let cancelled = false;
    (async () => {
      try {
        appendProcessEvent({
          level: 'info',
          title: 'Escalation parse started',
          message: 'Running structured extraction on the uploaded screenshot.',
          code: 'PARSE_STARTED',
        });
        const parsed = await parseEscalation({
          image: primaryImage,
          mode,
          primaryProvider: provider,
          fallbackProvider: mode !== 'single' ? fallbackProvider : undefined,
        });
        if (cancelled) return;
        setParseMeta(parsed?._meta || null);
        appendProcessEvent({
          level: 'success',
          title: 'Escalation parse complete',
          message: `Parser selected ${getProviderLabel(parsed?._meta?.providerUsed || provider)}.`,
          code: 'PARSE_COMPLETE',
          provider: parsed?._meta?.providerUsed || provider,
        });
        if (parsed?.escalation?._id) {
          appendProcessEvent({
            level: 'info',
            title: 'Linking escalation',
            message: `Linking escalation ${parsed.escalation._id} to this conversation.`,
            code: 'ESCALATION_LINKING',
          });
          await linkEscalation(parsed.escalation._id, conversationId);
          if (!cancelled) {
            setSavedEscalationId(parsed.escalation._id);
            appendProcessEvent({
              level: 'success',
              title: 'Escalation linked',
              message: `Escalation ${parsed.escalation._id} is now linked to this thread.`,
              code: 'ESCALATION_LINKED',
            });
          }
        }
      } catch (err) {
        appendProcessEvent({
          level: 'error',
          title: 'Escalation parse failed',
          message: err?.message || 'The post-chat parse/link step failed.',
          code: err?.code || 'PARSE_FAILED',
        });
      }
    })();
    return () => { cancelled = true; };
  }, [
    isStreaming,
    conversationId,
    savedEscalationId,
    messages,
    mode,
    provider,
    fallbackProvider,
    appendProcessEvent,
  ]);

  // Reset saved escalation when conversation changes
  useEffect(() => {
    setSavedEscalationId(null);
    setParseMeta(null);
    pendingImageParseRef.current = false;
  }, [conversationId]);

  // Template picker
  const openTemplatePicker = useCallback(async () => {
    setShowTemplatePicker(true);
    setLoadingTemplates(true);
    try {
      const list = await listTemplates(templateCategory || undefined);
      setTemplates(list);
    } catch { /* ignore */ }
    setLoadingTemplates(false);
  }, [templateCategory]);

  const handleTemplateInsert = useCallback((template) => {
    setInput(prev => prev ? prev + '\n\n' + template.body : template.body);
    setShowTemplatePicker(false);
    trackTemplateUsage(template._id).catch(() => {});
    textareaRef.current?.focus();
  }, []);

  const handleTemplateCategoryChange = useCallback(async (cat) => {
    setTemplateCategory(cat);
    setLoadingTemplates(true);
    try {
      const list = await listTemplates(cat || undefined);
      setTemplates(list);
    } catch { /* ignore */ }
    setLoadingTemplates(false);
  }, []);

  // Fork conversation from a specific message
  const handleFork = useCallback(async (messageIndex) => {
    if (!conversationId) return;
    try {
      const forked = await forkConversation(conversationId, messageIndex);
      // Navigate to the new forked conversation
      window.location.hash = `#/chat/${forked._id}`;
    } catch { /* ignore */ }
  }, [conversationId]);

  const canRetryLastResponse = Boolean(
    conversationId
      && !isStreaming
      && messages.length > 1
      && messages.some((m) => m.role === 'user')
  );

  return (
    <div className="chat-with-thinking">
    <div className="chat-container">
      {/* Linked escalation banner */}
      {linkedEscalation && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-2) var(--sp-5)',
          background: 'var(--bg-sunken)',
          borderBottom: '1px solid var(--line)',
          fontSize: 'var(--text-sm)',
        }}>
          <span className={`badge badge-${linkedEscalation.status === 'open' ? 'open' : linkedEscalation.status === 'in-progress' ? 'progress' : linkedEscalation.status === 'resolved' ? 'resolved' : 'escalated'}`}>
            {linkedEscalation.status}
          </span>
          <span style={{ flex: 1, color: 'var(--ink-secondary)' }}>
            Linked escalation
            {linkedEscalation.coid && <span className="mono" style={{ marginLeft: 'var(--sp-2)' }}>COID: {linkedEscalation.coid}</span>}
            {linkedEscalation.category && (
              <span className={`cat-badge cat-${linkedEscalation.category}`} style={{ marginLeft: 'var(--sp-2)', fontSize: 'var(--text-xs)' }}>
                {linkedEscalation.category.replace('-', ' ')}
              </span>
            )}
          </span>
          {linkedEscalation.status !== 'resolved' && (
            <button
              className="btn btn-sm btn-primary"
              onClick={handleResolveEscalation}
              disabled={resolvingEscalation}
              type="button"
            >
              {resolvingEscalation ? 'Resolving...' : 'Mark Resolved'}
            </button>
          )}
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => { window.location.hash = '#/dashboard'; }}
            type="button"
          >
            View
          </button>
        </div>
      )}

      {/* Messages area */}
      <div className="chat-messages" aria-live="polite">
        {runtimeWarnings.length > 0 && (
          <div className="chat-bubble chat-bubble-system" style={{ border: '1px solid var(--warning)', background: 'var(--warning-subtle)' }}>
            <strong style={{ marginRight: 'var(--sp-2)', color: 'var(--warning)' }}>Budget Notice:</strong>
            {runtimeWarnings[0]?.message || 'A runtime guardrail warning was raised.'}
            <button
              className="btn btn-sm btn-ghost"
              onClick={dismissRuntimeWarnings}
              style={{ marginLeft: 'var(--sp-3)' }}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        {contextDebug?.budgets && (
          <div className="parallel-context-line">
            <span className="ctx-dot" style={{ background: 'var(--accent)' }} />
            <span>
              Context {contextDebug.knowledgeMode} • {formatTokenEstimate(contextDebug.budgets.estimatedInputTokens)} est input tokens
            </span>
            <span className="ctx-hints">
              S {formatTokenEstimate(contextDebug.budgets.systemChars / 4)} | H {formatTokenEstimate(contextDebug.budgets.historyChars / 4)} | R {formatTokenEstimate(contextDebug.budgets.retrievalChars / 4)}
            </span>
          </div>
        )}

        {processEvents.length > 0 && (
          <div className="chat-process-panel" role="status" aria-live="polite">
            <div className="chat-process-header">
              <span>Request Activity</span>
              <button
                className="btn btn-sm btn-ghost"
                onClick={clearProcessEvents}
                type="button"
              >
                Clear
              </button>
            </div>
            <div className="chat-process-list">
              {processEvents.slice(-14).map((event) => (
                <div key={event.id} className={`chat-process-item is-${event.level || 'info'}`}>
                  <span className="chat-process-dot" />
                  <div className="chat-process-body">
                    <div className="chat-process-title">
                      <strong>{event.title || 'Event'}</strong>
                      <span>{formatProcessEventTime(event.at)}</span>
                    </div>
                    <div className="chat-process-message">{event.message}</div>
                    {(event.code || event.provider || Number.isFinite(event.latencyMs)) && (
                      <div className="chat-process-meta">
                        {event.code && <span className="mono">{event.code}</span>}
                        {event.provider && <span>{getProviderLabel(event.provider)}</span>}
                        {Number.isFinite(event.latencyMs) && <span>{event.latencyMs}ms</span>}
                      </div>
                    )}
                    {event.detail && (
                      <details className="chat-process-detail">
                        <summary>Details</summary>
                        <pre>{event.detail}</pre>
                      </details>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence>
          {fallbackNotice && (
            <motion.div key="fallback-notice" {...fadeSlideDown} transition={transitions.normal}
              className="chat-bubble chat-bubble-system" style={{ border: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
              <strong style={{ marginRight: 'var(--sp-2)' }}>Fallback used:</strong>
              {getProviderLabel(fallbackNotice.from)} &rarr; {getProviderLabel(fallbackNotice.to)}
              {fallbackNotice.reason && (
                <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--ink-secondary)' }}>
                  ({fallbackNotice.reason})
                </span>
              )}
              <button
                className="btn btn-sm btn-ghost"
                onClick={dismissFallbackNotice}
                style={{ marginLeft: 'var(--sp-3)' }}
                type="button"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.length === 0 && !isStreaming && (
          <motion.div
            className="empty-state"
            style={{ marginTop: 'var(--sp-10)' }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitions.emphasis}
          >
            <div className="empty-state-title">QBO Escalation Assistant</div>
            <div className="empty-state-desc">
              Paste escalation screenshots (Ctrl+V) and hit Send. {getProviderLabel(provider)} will parse, save, and recommend next steps.
            </div>
          </motion.div>
        )}

        {/* Conversation actions — New Chat + Export + Retry */}
        {messages.length > 1 && !isStreaming && conversationId && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', padding: '0 var(--sp-2)' }}>
            <button
              className="copy-btn"
              onClick={newConversation}
              type="button"
              title="Start a new conversation"
            >
              New Chat
            </button>
            {canRetryLastResponse && (
              <button
                className="copy-btn"
                onClick={() => retryLastResponse(provider)}
                type="button"
              >
                Retry Last Response
              </button>
            )}
            <button
              className={`copy-btn${exportCopied ? ' is-copied' : ''}`}
              onClick={async () => {
                try {
                  const text = await exportConversation(conversationId);
                  await navigator.clipboard.writeText(text);
                  setExportCopied(true);
                  setTimeout(() => setExportCopied(false), 2000);
                } catch { /* ignore */ }
              }}
              type="button"
            >
              {exportCopied ? 'Copied to clipboard' : 'Copy full conversation'}
            </button>
          </div>
        )}

        <AnimatePresence initial={false}>
          {groupMessagesForRendering(messages).map((group) => {
            if (group.type === 'parallel-pair') {
              const { turnId, responses: turnResponses, firstIndex } = group;
              const hasAccepted = turnResponses.some(r => r.attemptMeta?.accepted);
              const isImageParse = detectImageParseTurn(messages, firstIndex);

              return (
                <motion.div key={`pair-${turnId}`} {...fadeSlideUp} transition={transitions.springGentle}>
                  <ParallelResponsePair
                    responses={turnResponses.map(r => ({
                      provider: r.provider,
                      content: r.content,
                      isStreaming: false,
                      responseTimeMs: r.responseTimeMs,
                      usage: r.usage || null,
                      turnId,
                      isAccepted: Boolean(r.attemptMeta?.accepted),
                      isRejected: Boolean(r.attemptMeta?.rejected),
                    }))}
                    onAccept={hasAccepted ? undefined : (tid, prov) => acceptParallelTurn(tid, prov)}
                    onUnaccept={(tid) => unacceptParallelTurn(tid)}
                    onDiscard={(tid, prov) => handleDiscardProvider(tid, prov)}
                    onReEnable={(tid) => handleReEnableProvider(tid)}
                    onFork={conversationId && !isStreaming ? (idx) => handleFork(idx) : undefined}
                    accepting={parallelAcceptingKey}
                    isImageParseTurn={isImageParse}
                    discardedProviders={discardedProviders[turnId] || []}
                  />
                </motion.div>
              );
            }

            const msg = group.message;
            const i = group.index;
            return (
              <motion.div key={msg._id || msg.timestamp || `msg-${i}`} {...fadeSlideUp} transition={transitions.springGentle}>
                <ChatMessage
                  role={msg.role}
                  content={msg.content}
                  images={msg.images}
                  provider={msg.provider}
                  mode={msg.mode}
                  fallbackFrom={msg.fallbackFrom}
                  timestamp={msg.timestamp}
                  responseTimeMs={msg.responseTimeMs}
                  usage={msg.usage}
                  onFork={msg.role === 'assistant' && conversationId && !isStreaming ? () => handleFork(i) : undefined}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Triage card — appears instantly before streaming text */}
        {triageCard && (
          <TriageCard triageCard={triageCard} />
        )}

        {/* Streaming response (single/fallback) */}
        <AnimatePresence>
          {isStreaming && effectiveMode !== 'parallel' && streamingText && (
            <motion.div key="streaming-single" {...fadeSlideUp} transition={transitions.normal}>
              <ChatMessage
                role="assistant"
                content={streamingText}
                provider={streamProvider}
                isStreaming={true}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Streaming response (parallel) — split-column layout */}
        <AnimatePresence>
          {isStreaming && effectiveMode === 'parallel' && (() => {
            const activeParallelProviders = parallelProviders.length >= 2
              ? parallelProviders
              : [...new Set([provider, fallbackProvider])].filter(Boolean);
            return (
              <motion.div key="streaming-parallel" {...fadeSlideUp} transition={transitions.normal}>
                <ParallelResponsePair
                  responses={activeParallelProviders.map(p => ({
                    provider: p,
                    content: parallelStreaming[p] || '',
                    isStreaming: true,
                    responseTimeMs: null,
                    turnId: null,
                    isAccepted: false,
                    isRejected: false,
                  }))}
                  accepting={null}
                  isImageParseTurn={false}
                  discardedProviders={[]}
                />
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Streaming but no text yet (single/fallback) — minimal indicator since sidebar shows details */}
        <AnimatePresence>
          {isStreaming && effectiveMode !== 'parallel' && !streamingText && (
            <motion.div key="streaming-thinking" {...fadeSlideUp} transition={transitions.normal}>
              <div className="chat-bubble chat-bubble-assistant" style={{ alignSelf: 'flex-start' }}>
                <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>{getProviderLabel(streamProvider || provider)}</div>
                <span className="spinner spinner-sm" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Discard unsaved chat — shows when aborted/failed before server saved the conversation,
             or when only user messages exist with an error (no assistant response came through) */}
        {!isStreaming && messages.length > 0 && (
          !conversationId || (error && !messages.some(m => m.role === 'assistant'))
        ) && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 'var(--sp-3) 0',
          }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={newConversation}
              type="button"
              style={{ color: 'var(--ink-tertiary)', fontSize: 'var(--text-sm)' }}
            >
              Discard &amp; start over
            </button>
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
        {error && (
          <motion.div key="error-card" {...fadeSlideDown} transition={transitions.springGentle} className="chat-error-card">
            <div className="chat-error-title">Request failed</div>
            <div className="chat-error-message text-danger">{errorDetails?.message || error}</div>
            {(errorDetails?.code || errorDetails?.detail) && (
              <div className="chat-error-meta">
                {errorDetails?.code && <span className="mono">{errorDetails.code}</span>}
                {errorDetails?.detail && <span>technical detail available</span>}
              </div>
            )}
            {Array.isArray(errorDetails?.attempts) && errorDetails.attempts.length > 0 && (
              <div className="chat-error-attempts">
                {errorDetails.attempts.map((attempt, idx) => (
                  <div key={`${attempt.provider || 'provider'}-${idx}`} className={`chat-error-attempt${attempt.status === 'ok' ? ' is-ok' : ' is-error'}`}>
                    <span>{getProviderLabel(attempt.provider)}</span>
                    <span>{attempt.status || 'unknown'}</span>
                    {Number.isFinite(attempt.latencyMs) && <span>{attempt.latencyMs}ms</span>}
                    {attempt.errorCode && <span className="mono">{attempt.errorCode}</span>}
                    {attempt.errorMessage && <span>{attempt.errorMessage}</span>}
                  </div>
                ))}
              </div>
            )}
            {errorDetails?.detail && (
              <details className="chat-error-detail">
                <summary>Technical details</summary>
                <pre>{errorDetails.detail}</pre>
              </details>
            )}
            <div className="chat-error-actions">
              {canRetryLastResponse && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => retryLastResponse(provider)}
                  type="button"
                >
                  Retry
                </button>
              )}
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setError(null)}
                type="button"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
        </AnimatePresence>

        {parseMeta && !isStreaming && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-2)',
            padding: 'var(--sp-3) var(--sp-5)',
            margin: '0 var(--sp-3)',
            background: 'var(--bg-sunken)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--line-subtle)',
            flexWrap: 'wrap',
          }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
              Parsed by <strong>{getProviderLabel(parseMeta.providerUsed)}</strong>
            </span>
            {parseMeta.validation?.score !== undefined && parseMeta.validation?.score !== null && (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-secondary)' }}>
                Score: {Number(parseMeta.validation.score).toFixed(2)} ({parseMeta.validation.confidence || parseMeta.confidence || 'unknown'})
              </span>
            )}
            {parseMeta.usedRegexFallback && (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--warning, #9a6b00)' }}>
                Regex fallback used
              </span>
            )}
            {Array.isArray(parseMeta.validation?.issues) && parseMeta.validation.issues.length > 0 && (
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--ink-tertiary)' }}>
                Issues: {parseMeta.validation.issues.slice(0, 3).join(', ')}
              </span>
            )}
          </div>
        )}

        {/* Escalation saved confirmation */}
        {savedEscalationId && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--sp-3)',
            padding: 'var(--sp-3) var(--sp-5)',
            margin: '0 var(--sp-3)',
            background: 'var(--success-subtle, #e8f5e9)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--success, #41a466)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success, #41a466)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--success, #41a466)', fontWeight: 600, flex: 1 }}>
              Escalation saved and linked to this conversation
            </span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => { window.location.hash = `#/escalations/${savedEscalationId}`; }}
              type="button"
            >
              View Escalation
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area — Compose Card */}
      <div className="chat-input-area">
        {/* Quick action chips — always visible */}
        <div className="quick-action-chips">
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              className="quick-action-chip"
              onClick={() => handleQuickPrompt(qp.prompt)}
              type="button"
              disabled={isStreaming}
            >
              {qp.label}
            </button>
          ))}
          <button
            className={`quick-action-chip${showCopilot ? ' is-active' : ''}`}
            onClick={() => setShowCopilot(prev => !prev)}
            type="button"
            style={showCopilot ? { background: 'var(--accent)', color: '#fff' } : {}}
          >
            Co-pilot
          </button>
        </div>

        {/* Co-pilot panel — collapsible */}
        <AnimatePresence>
          {showCopilot && (
            <motion.div
              key="copilot-drawer"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ padding: 'var(--sp-2) 0' }}>
                <CopilotPanel
                  escalationId={savedEscalationId}
                  title="Co-pilot"
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Escalation context pill */}
        {contextPillEnabled && linkedEscalation && (linkedEscalation.coid || linkedEscalation.caseNumber || linkedEscalation.category || linkedEscalation.status) && (
          <div className="context-pill">
            {linkedEscalation.coid && (
              <>
                <button
                  className={`context-pill-field${copiedField === 'coid' ? ' is-copied' : ''}`}
                  onClick={() => handleCopyField('coid', linkedEscalation.coid)}
                  title="Click to copy COID"
                  type="button"
                >
                  <span className="field-label">COID</span>
                  <span className="field-value">{linkedEscalation.coid}</span>
                </button>
                <span className="context-pill-divider" />
              </>
            )}
            {linkedEscalation.caseNumber && (
              <>
                <button
                  className={`context-pill-field${copiedField === 'case' ? ' is-copied' : ''}`}
                  onClick={() => handleCopyField('case', linkedEscalation.caseNumber)}
                  title="Click to copy case number"
                  type="button"
                >
                  <span className="field-label">Case</span>
                  <span className="field-value">#{linkedEscalation.caseNumber}</span>
                </button>
                <span className="context-pill-divider" />
              </>
            )}
            {linkedEscalation.category && linkedEscalation.category !== 'unknown' && (
              <>
                <button
                  className={`context-pill-field${copiedField === 'category' ? ' is-copied' : ''}`}
                  onClick={() => handleCopyField('category', linkedEscalation.category)}
                  title="Click to copy category"
                  type="button"
                >
                  <span className={`cat-badge cat-${linkedEscalation.category}`} style={{ fontSize: 'var(--text-xs)' }}>
                    {linkedEscalation.category.replace('-', ' ')}
                  </span>
                </button>
                <span className="context-pill-divider" />
              </>
            )}
            {linkedEscalation.status && (
              <button
                className={`context-pill-field${copiedField === 'status' ? ' is-copied' : ''}`}
                onClick={() => handleCopyField('status', linkedEscalation.status)}
                title="Click to copy status"
                type="button"
              >
                <span className={`badge badge-${linkedEscalation.status === 'open' ? 'open' : linkedEscalation.status === 'in-progress' ? 'progress' : linkedEscalation.status === 'resolved' ? 'resolved' : 'escalated'}`} style={{ fontSize: 'var(--text-xs)' }}>
                  {linkedEscalation.status}
                </span>
              </button>
            )}
          </div>
        )}

        {/* Compose card */}
        <div
          className={`compose-card${composeFocused ? ' is-focused' : ''}${isComposeDragOver ? ' is-dragover' : ''}`}
          onDragEnter={handleComposeDragEnter}
          onDragOver={handleComposeDragOver}
          onDragLeave={handleComposeDragLeave}
          onDrop={handleComposeDrop}
        >
          {/* Top strip: provider chip + help */}
          <div className="compose-top-strip">
            <div ref={providerPopoverRef} style={{ position: 'relative' }}>
              <button
                className={`provider-chip${showProviderPopover ? ' is-open' : ''}`}
                onClick={() => setShowProviderPopover(prev => !prev)}
                type="button"
                aria-label="Change model and mode settings"
                aria-expanded={showProviderPopover}
              >
                {getProviderLabel(provider)}
                {' \u00b7 '}
                {MODE_OPTIONS.find(m => m.value === mode)?.label || 'Single'}
                {mode === 'fallback' && (
                  <> + {getProviderLabel(fallbackProvider)}</>
                )}
                {mode === 'parallel' && parallelProviders.length >= 2 && (
                  <> · Parallel ({parallelProviders.length})</>
                )}
                <span className="chevron">&#9662;</span>
              </button>

              {/* Provider/mode popover */}
              <AnimatePresence>
              {showProviderPopover && (
                <motion.div key="provider-popover" className="provider-popover" {...popover} transition={transitions.fast}>
                  <div className="provider-popover-label">Provider</div>
                  {PROVIDER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                      onClick={() => { setProvider(option.value); }}
                      type="button"
                    >
                      <span className="check">{provider === option.value ? '\u2713' : ''}</span>
                      {option.label}
                    </button>
                  ))}
                  <div className="provider-popover-divider" />
                  <div className="provider-popover-label">Mode</div>
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={`provider-popover-option${mode === option.value ? ' is-selected' : ''}`}
                      onClick={() => { setMode(option.value); }}
                      type="button"
                    >
                      <span className="check">{mode === option.value ? '\u2713' : ''}</span>
                      {option.label}
                    </button>
                  ))}
                  {mode === 'fallback' && (
                    <>
                      <div className="provider-popover-divider" />
                      <div className="provider-popover-label">Fallback Provider</div>
                      {PROVIDER_OPTIONS.filter((o) => o.value !== provider).map((option) => (
                        <button
                          key={option.value}
                          className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}`}
                          onClick={() => { setFallbackProvider(option.value); }}
                          type="button"
                        >
                          <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                          {option.label}
                        </button>
                      ))}
                    </>
                  )}
                  {mode === 'parallel' && (
                    <>
                      <div className="provider-popover-divider" />
                      <div className="provider-multi-select">
                        <label style={{ fontSize: '0.75rem', color: 'var(--ink-secondary)', marginBottom: 4, display: 'block' }}>
                          Parallel Providers (select 2–4)
                        </label>
                        {PROVIDER_OPTIONS.map(opt => {
                          const isSelected = parallelProviders.includes(opt.value);
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="switch"
                              aria-checked={isSelected}
                              aria-label={`${opt.label} provider`}
                              className={`provider-chip ${isSelected ? 'selected' : ''}`}
                              onClick={() => {
                                const next = isSelected
                                  ? parallelProviders.filter(p => p !== opt.value)
                                  : [...parallelProviders, opt.value];
                                setParallelProviders(next);
                              }}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '4px 10px',
                                margin: '2px 4px 2px 0',
                                borderRadius: 12,
                                border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--line)',
                                background: isSelected ? 'var(--accent-subtle)' : 'transparent',
                                color: isSelected ? 'var(--accent)' : 'var(--ink-secondary)',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: isSelected ? 600 : 400,
                                transition: 'all 0.15s ease',
                              }}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                        {parallelProviders.length < 2 && (
                          <div role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 4 }}>
                            Select at least 2 providers
                          </div>
                        )}
                        {parallelProviders.length > 4 && (
                          <div role="alert" style={{ fontSize: '0.7rem', color: 'var(--danger)', marginTop: 4 }}>
                            Maximum 4 providers allowed
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </motion.div>
              )}
              </AnimatePresence>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              {/* Settings gear */}
              <div ref={settingsPopoverRef} style={{ position: 'relative' }}>
                <button
                  className={`compose-settings-btn${showSettingsPopover ? ' is-open' : ''}`}
                  onClick={() => setShowSettingsPopover(prev => !prev)}
                  type="button"
                  aria-label="Compose settings"
                  aria-expanded={showSettingsPopover}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                </button>

                <AnimatePresence>
                {showSettingsPopover && (
                  <motion.div key="settings-popover" className="compose-settings-popover" {...popover} transition={transitions.fast}>
                    <div className="provider-popover-label">Compose Settings</div>
                    <button
                      className="compose-settings-toggle"
                      onClick={() => toggleSmartCompose(!smartComposeEnabled)}
                      type="button"
                    >
                      <span className={`compose-toggle-indicator${smartComposeEnabled ? ' is-on' : ''}`} />
                      <span className="compose-settings-toggle-text">
                        <span className="compose-settings-toggle-title">Smart Compose</span>
                        <span className="compose-settings-toggle-desc">Ghost-text suggestions as you type</span>
                      </span>
                    </button>
                    <button
                      className="compose-settings-toggle"
                      onClick={() => toggleContextPill(!contextPillEnabled)}
                      type="button"
                    >
                      <span className={`compose-toggle-indicator${contextPillEnabled ? ' is-on' : ''}`} />
                      <span className="compose-settings-toggle-text">
                        <span className="compose-settings-toggle-title">Context Pill</span>
                        <span className="compose-settings-toggle-desc">Show COID, case, category above input</span>
                      </span>
                    </button>
                  </motion.div>
                )}
                </AnimatePresence>
              </div>

              {/* Help button */}
              <div className="compose-help-btn" aria-label="Keyboard shortcuts">
                ?
                <div className="compose-help-tooltip">
                  <kbd>Enter</kbd> Send message<br />
                  <kbd>Shift</kbd>+<kbd>Enter</kbd> New line<br />
                  <kbd>Ctrl</kbd>+<kbd>V</kbd> Paste images<br />
                  <kbd>Ctrl</kbd>+<kbd>N</kbd> New conversation<br />
                  <kbd>Tab</kbd> Accept suggestion
                </div>
              </div>
            </div>
          </div>

          {/* Compose body — textarea + ghost text */}
          <div className="compose-body" style={{ position: 'relative' }}>
            <div className="compose-body-inner">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  const val = e.target.value;
                  setInput(val);
                  if (smartComposeEnabled) {
                    setGhostText(computeGhostText(val));
                  }
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onFocus={() => setComposeFocused(true)}
                onBlur={() => setComposeFocused(false)}
                placeholder="What's the escalation?"
                rows={2}
                disabled={isStreaming}
              />
              {smartComposeEnabled && ghostText && (
                <div className="compose-ghost-overlay" aria-hidden="true">
                  <span style={{ visibility: 'hidden' }}>{input}</span>
                  <span className="compose-ghost-text">{ghostText}</span>
                </div>
              )}
            </div>
          </div>

          {/* Compose footer — actions + send */}
          <div className="compose-footer">
            <div className="compose-actions">
              <Tooltip text="Attach a screenshot or image (Ctrl+V)" level="low">
                <button
                  className={`compose-action-btn${images.length > 0 ? ' is-active' : ''}`}
                  onClick={handleAttachClick}
                  type="button"
                  aria-label="Attach images"
                  disabled={isStreaming}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
              </Tooltip>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFilePickerChange}
                style={{ display: 'none' }}
                tabIndex={-1}
                aria-hidden="true"
              />

              <Tooltip text="Insert a response template" level="medium">
                <button
                  className="compose-action-btn"
                  onClick={openTemplatePicker}
                  type="button"
                  aria-label="Insert template"
                  disabled={isStreaming}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </button>
              </Tooltip>

              {images.length > 0 && (
                <div
                  className="compose-attachments-inline"
                  aria-live="polite"
                  aria-label={`${images.length} image${images.length === 1 ? '' : 's'} attached`}
                >
                  <span className="compose-attachments-title">
                    {images.length} upload{images.length === 1 ? '' : 's'}
                  </span>
                  <div className="compose-attachments-list">
                    <AnimatePresence>
                      {images.map((image, i) => (
                        <motion.div
                          key={image.hash || image.metaKey || `img-${i}`}
                          className="compose-attachment"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={transitions.springSnappy}
                          layout
                        >
                          <img src={image.src} alt={`Attachment ${i + 1}`} />
                          <button
                            type="button"
                            className="compose-attachment-remove"
                            onClick={() => removeImage(i)}
                            aria-label={`Remove attached image ${i + 1}`}
                            title="Remove image"
                          >
                            x
                          </button>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            <span className="compose-footer-hint">Drag and drop images into this box</span>

            <AnimatePresence mode="wait" initial={false}>
              {isStreaming ? (
                <motion.button
                  key="stop"
                  className="compose-send-btn is-danger"
                  onClick={abortStream}
                  type="button"
                  aria-label="Stop generating"
                  title="Stop generating"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={transitions.springSnappy}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  className="compose-send-btn"
                  onClick={handleSubmit}
                  disabled={(!input.trim() && images.length === 0) || (effectiveMode === 'parallel' && (parallelProviders.length < 2 || parallelProviders.length > 4))}
                  type="button"
                  aria-label="Send message"
                  title="Send message"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={transitions.springSnappy}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Template picker overlay */}
      <AnimatePresence>
      {showTemplatePicker && (
        <motion.div
          key="template-overlay"
          className="modal-overlay"
          onClick={() => setShowTemplatePicker(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowTemplatePicker(false); }}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
          {...fade}
          transition={transitions.fast}
        >
          <motion.div
            className="card"
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={transitions.emphasis}
            style={{
              width: 'min(600px, 90vw)',
              maxHeight: '70vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-4)' }}>
              <h2 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Insert Template</h2>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowTemplatePicker(false)}
                type="button"
              >
                Close
              </button>
            </div>

            {/* Category filter chips */}
            <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap', marginBottom: 'var(--sp-4)' }}>
              {['', 'acknowledgment', 'follow-up', 'escalation-up', 'payroll', 'bank-feeds', 'reconciliation', 'general'].map(cat => (
                <button
                  key={cat}
                  className={`btn btn-sm ${templateCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => handleTemplateCategoryChange(cat)}
                  type="button"
                  style={{ fontSize: 'var(--text-xs)' }}
                >
                  {cat ? cat.replace('-', ' ') : 'All'}
                </button>
              ))}
            </div>

            {/* Template list */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadingTemplates ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)' }}>
                  <span className="spinner spinner-sm" />
                </div>
              ) : templates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 'var(--sp-6)', color: 'var(--ink-secondary)' }}>
                  No templates found.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                  {templates.map(tmpl => (
                    <button
                      key={tmpl._id}
                      onClick={() => handleTemplateInsert(tmpl)}
                      type="button"
                      style={{
                        textAlign: 'left',
                        padding: 'var(--sp-3) var(--sp-4)',
                        background: 'var(--bg-sunken)',
                        border: '1px solid var(--line)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'border-color 140ms ease',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--line)'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-1)' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{tmpl.title}</span>
                        <span className={`cat-badge cat-${tmpl.category || 'general'}`} style={{ fontSize: 'var(--text-xs)' }}>
                          {(tmpl.category || 'general').replace('-', ' ')}
                        </span>
                      </div>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        color: 'var(--ink-secondary)',
                        whiteSpace: 'pre-wrap',
                        maxHeight: 60,
                        overflow: 'hidden',
                        lineHeight: 1.5,
                      }}>
                        {tmpl.body}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
    <ThinkingSidebar
      thinkingText={thinkingText}
      isThinking={isThinking}
      thinkingStartTime={thinkingStartTime}
      isStreaming={isStreaming}
      streamingText={streamingText}
      parallelStreaming={parallelStreaming}
      isParallelMode={effectiveMode === 'parallel'}
    />
    </div>
  );
}

export default function Chat(props) {
  const chat = useChat();
  return <ChatView {...props} chat={chat} />;
}
