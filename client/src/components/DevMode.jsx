import { useState, useRef, useEffect, useCallback } from 'react';
import ChatMessage from './ChatMessage.jsx';
import Tooltip from './Tooltip.jsx';
import AgentActivityLog from './AgentActivityLog.jsx';
import PromptInspector from './PromptInspector.jsx';
import AgentDock from './AgentDock.jsx';
import { PROVIDER_FAMILY, PROVIDER_OPTIONS, REASONING_EFFORT_OPTIONS, getProviderLabel, getReasoningEffortOptions } from '../lib/providerCatalog.js';
import { useDevAgent } from '../context/DevAgentContext.jsx';
import { formatTokenCount, formatCost } from '../hooks/useTokenMonitor.js';
import './DevMode.css';

/** Quick dev prompts for common tasks */
const DEV_PROMPTS = [
  { label: 'Fix a bug', prompt: 'I need help fixing a bug: ' },
  { label: 'Add a feature', prompt: 'I want to add a new feature: ' },
  { label: 'Refactor', prompt: 'Refactor the following code: ' },
  { label: 'Explain code', prompt: 'Explain how this code works: ' },
];

const MODE_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'fallback', label: 'Fallback' },
];

const AGENT_SURFACE_TABS = [
  { id: 'dev', label: 'Dev Agent' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'chat', label: 'Chat' },
  { id: 'copilot', label: 'Co-pilot' },
];

function getReasoningEffortLabel(value) {
  return REASONING_EFFORT_OPTIONS.find((option) => option.value === value)?.label || 'High';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Compact token usage bar between messages and input */
function TokenMonitorBar({ tokenStats }) {
  if (!tokenStats || !tokenStats.combined || tokenStats.combined.total === 0) return null;

  const { foreground: fg, background: bg, combined, budget } = tokenStats;
  const hasBudget = budget && budget.maxPercent > 0;
  const barClass = `token-monitor-bar${hasBudget && budget.state === 'amber' ? ' is-amber' : ''}${hasBudget && budget.state === 'danger' ? ' is-danger' : ''}`;

  return (
    <div className={barClass}>
      <div className="token-monitor-left">
        <div className="token-monitor-section">
          <span className="token-monitor-label">Tokens</span>
          <span className="token-monitor-value">{formatTokenCount(combined.total)}</span>
          <span className="token-monitor-detail">
            ({formatTokenCount(combined.input)} in / {formatTokenCount(combined.output)} out)
          </span>
        </div>
        {combined.cost > 0 && (
          <div className="token-monitor-section">
            <span className="token-monitor-label">Cost</span>
            <span className="token-monitor-value">{formatCost(combined.cost)}</span>
          </div>
        )}
        <div className="token-monitor-section">
          <span className="token-monitor-label">Msgs</span>
          <span className="token-monitor-value">{combined.messages}</span>
        </div>
      </div>
      {hasBudget && (
        <div className="token-monitor-budget">
          <div className="token-monitor-budget-track">
            <div
              className={`token-monitor-budget-fill token-monitor-budget-fill--${budget.state}`}
              style={{ width: `${Math.min(budget.maxPercent, 100)}%` }}
            />
          </div>
          <span className="token-monitor-budget-label">
            {Math.round(budget.maxPercent)}%
          </span>
        </div>
      )}
      {hasBudget && budget.state === 'danger' && (
        <div className="token-monitor-budget-alert">
          Budget nearly exhausted — background work paused
        </div>
      )}
      {bg.total > 0 && (
        <div className="token-monitor-right">
          <div className="token-monitor-section token-monitor-bg">
            <span className="token-monitor-label">Bg</span>
            <span className="token-monitor-value">{formatTokenCount(bg.total)}</span>
            {bg.cost > 0 && (
              <span className="token-monitor-detail">({formatCost(bg.cost)})</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatShortDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function ControlPlaneBar({ agentHealthy, healthDetails, runtimeHealth, bgTransport, monitorTransport }) {
  const monitor = runtimeHealth?.monitor || {};
  const remediation = runtimeHealth?.remediation || {};
  const domains = runtimeHealth?.domains || {};
  const stateCounts = monitor.stateCounts || {};
  const activeTransportIncidents = monitor.activeMonitorTransportIncidents || 0;
  const queueSize = bgTransport?.queueSize || 0;
  const cooldownRemainingMs = Math.max(0, (bgTransport?.nextAllowedAt || 0) - Date.now());
  const coolingDown = Boolean(bgTransport?.coolingDown && cooldownRemainingMs > 0);
  const controlState = coolingDown
    ? (bgTransport?.cooldownReason === 'rate-limit' ? 'Rate-limited' : 'Cooling down')
    : 'Ready';
  const degradedDomains = ['gmail', 'calendar', 'escalations']
    .filter((key) => {
      const status = domains[key]?.status;
      return status === 'degraded' || status === 'warning';
    });
  const transport = monitorTransport || {};

  return (
    <div className="dev-control-bar">
      <div className="dev-control-chip">
        <span className={`dev-control-dot ${agentHealthy ? 'is-ok' : 'is-warn'}`} />
        <span className="dev-control-label">Agent</span>
        <strong>{agentHealthy ? 'Healthy' : `${(healthDetails?.issues || []).length} issue${(healthDetails?.issues || []).length === 1 ? '' : 's'}`}</strong>
      </div>
      <div className={`dev-control-chip${coolingDown ? ' is-warn' : ''}`}>
        <span className="dev-control-label">Monitor Channel</span>
        <strong>{controlState}</strong>
        {coolingDown && (
          <span className="dev-control-detail">{formatShortDuration(cooldownRemainingMs)} left</span>
        )}
        {!coolingDown && queueSize > 0 && (
          <span className="dev-control-detail">{queueSize} queued</span>
        )}
      </div>
      <div className="dev-control-chip">
        <span className="dev-control-label">Incidents</span>
        <strong>{monitor.activeIncidents || 0} active</strong>
        {activeTransportIncidents > 0 && (
          <span className="dev-control-detail">{activeTransportIncidents} blind spot</span>
        )}
        {(monitor.remediatingIncidents || 0) > 0 && (
          <span className="dev-control-detail">{monitor.remediatingIncidents} remediating</span>
        )}
      </div>
      <div className="dev-control-chip">
        <span className="dev-control-label">Lifecycle</span>
        <strong>{stateCounts.failed || 0} failed</strong>
        {(stateCounts.resolved || 0) > 0 && (
          <span className="dev-control-detail">{stateCounts.resolved} resolved</span>
        )}
      </div>
      <div className="dev-control-chip">
        <span className="dev-control-label">Duplicates</span>
        <strong>{monitor.totalSuppressed || 0} suppressed</strong>
        {(monitor.totalForwarded || 0) > 0 && (
          <span className="dev-control-detail">{monitor.totalForwarded} forwarded</span>
        )}
      </div>
      <div className="dev-control-chip">
        <span className="dev-control-label">Remediation</span>
        <strong>{remediation.failedAttempts || 0} failed</strong>
        {(remediation.partialAttempts || 0) > 0 && (
          <span className="dev-control-detail">{remediation.partialAttempts} partial</span>
        )}
        {(remediation.verifiedAttempts || 0) > 0 && (
          <span className="dev-control-detail">{remediation.verifiedAttempts} verified</span>
        )}
      </div>
      <div className="dev-control-chip">
        <span className="dev-control-label">Domains</span>
        <strong>{degradedDomains.length} degraded</strong>
        {degradedDomains.length > 0 && (
          <span className="dev-control-detail">{degradedDomains.join(', ')}</span>
        )}
      </div>
      <div className="dev-control-chip">
        <span className="dev-control-label">Monitor Streams</span>
        <strong>{transport.connectedCount || 0} connected</strong>
        {((transport.cooldownCount || 0) > 0 || (transport.degradedCount || 0) > 0) && (
          <span className="dev-control-detail">
            {transport.cooldownCount || 0} cooling, {transport.degradedCount || 0} degraded
          </span>
        )}
      </div>
    </div>
  );
}

function DomainRemediationBar({ runtimeHealth }) {
  const domains = runtimeHealth?.domains || {};
  const entries = [
    { key: 'gmail', label: 'Gmail' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'escalations', label: 'Escalations' },
  ].filter((entry) => {
    const domain = domains[entry.key] || {};
    return Boolean(domain.remediation?.message) || (Array.isArray(domain.issues) && domain.issues.length > 0);
  });

  if (entries.length === 0) return null;

  return (
    <div className="dev-control-bar">
      {entries.map((entry) => {
        const domain = domains[entry.key] || {};
        return (
          <div key={entry.key} className="dev-control-chip">
            <span className="dev-control-label">{entry.label}</span>
            <strong>{domain.remediation?.required ? 'Action needed' : (domain.status || 'ok')}</strong>
            <span className="dev-control-detail">
              {domain.remediation?.message || domain.issues?.[0] || 'Healthy'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function DevMode({ chat = null }) {
  const {
    messages,
    conversationId,
    conversations,
    provider,
    mode,
    fallbackProvider,
    reasoningEffort,
    isStreaming,
    streamingText,
    streamProvider,
    toolEvents,
    fallbackNotice,
    error,
    responseTime,
    sendMessage,
    setProvider,
    setMode,
    setFallbackProvider,
    setReasoningEffort,
    dismissFallbackNotice,
    abortStream,
    selectConversation,
    newConversation,
    removeConversation,
    deleteLastMessage,
    setError,
    bgLastResults,
    bgTransport,
    monitorTransport,
    agentHealthy,
    healthDetails,
    runtimeHealth,
    tokenStats,
  } = useDevAgent();

  const [inspectorOpen, setInspectorOpen] = useState(() => {
    try { return localStorage.getItem('promptInspectorOpen') === 'true'; } catch { return false; }
  });
  const toggleInspector = useCallback(() => {
    setInspectorOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('promptInspectorOpen', String(next)); } catch {}
      return next;
    });
  }, []);

  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [composeFocused, setComposeFocused] = useState(false);
  const [showProviderPopover, setShowProviderPopover] = useState(false);
  const [images, setImages] = useState([]);
  const [surfaceTab, setSurfaceTab] = useState('dev');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const imageInputRef = useRef(null);
  const providerPopoverRef = useRef(null);
  const selectionIncludesClaude = PROVIDER_FAMILY[provider] === 'claude'
    || (mode !== 'single' && PROVIDER_FAMILY[fallbackProvider] === 'claude');

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, toolEvents]);

  // Auto-resize input
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  // Focus input after streaming ends
  useEffect(() => {
    if (!isStreaming) textareaRef.current?.focus();
  }, [isStreaming]);

  useEffect(() => {
    if (surfaceTab === 'dev') return;
    setShowHistory(false);
    setInspectorOpen(false);
  }, [surfaceTab]);

  // Ctrl+Shift+D focuses the textarea when on the dev page
  useEffect(() => {
    function handleGlobalKey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        textareaRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  // Close provider popover on outside click
  useEffect(() => {
    const handler = (e) => {
      if (providerPopoverRef.current && !providerPopoverRef.current.contains(e.target)) {
        setShowProviderPopover(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Detect orphaned user message (last msg is user + not streaming)
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const hasOrphanedUser = lastMsg && lastMsg.role === 'user' && !isStreaming;

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
        textareaRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newConversation]);

  // Orphaned message keyboard shortcuts: R=Retry, E=Edit, D/Escape=Delete
  useEffect(() => {
    if (!hasOrphanedUser) return;
    const handler = (e) => {
      // Skip if user is typing in textarea or any input
      const tag = e.target.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || e.target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        deleteLastMessage();
        sendMessage(lastMsg.content, lastMsg.images || [], provider);
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setInput(lastMsg.content === '(image attached)' ? '' : lastMsg.content);
        deleteLastMessage();
        textareaRef.current?.focus();
      } else if (e.key === 'd' || e.key === 'D' || e.key === 'Escape') {
        e.preventDefault();
        deleteLastMessage();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasOrphanedUser, lastMsg, deleteLastMessage, sendMessage, provider]);

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && images.length === 0) || isStreaming) return;
    const textToSend = input.trim() || 'Review the attached UI screenshot and identify the issue.';
    sendMessage(textToSend, images.map((img) => img.src), provider);
    setInput('');
    setImages([]);
  }, [input, images, isStreaming, sendMessage, provider]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleQuickPrompt = useCallback((prompt) => {
    setInput(prompt);
    textareaRef.current?.focus();
  }, []);

  const handleRerunCommand = useCallback((command) => {
    if (isStreaming) return;
    sendMessage(command, [], provider);
  }, [isStreaming, sendMessage, provider]);

  const appendImageFiles = useCallback((files) => {
    const imageFiles = Array.from(files || []).filter((file) => file?.type?.startsWith('image/'));
    if (imageFiles.length === 0) return;

    Promise.all(imageFiles.map(async (file) => {
      try {
        const src = await readFileAsDataUrl(file);
        return { src, key: `${file.name || 'img'}-${file.size || 0}-${file.lastModified || Date.now()}` };
      } catch {
        return null;
      }
    })).then((prepared) => {
      const valid = prepared.filter(Boolean);
      if (valid.length === 0) return;
      setImages((prev) => [...prev, ...valid]);
    });
  }, []);

  const removeImage = useCallback((index) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'));
    if (imageItems.length === 0) return;
    e.preventDefault();
    const files = imageItems.map((item) => item.getAsFile()).filter(Boolean);
    appendImageFiles(files);
  }, [appendImageFiles]);

  const handleAttachClick = useCallback(() => {
    if (isStreaming) return;
    imageInputRef.current?.click();
  }, [isStreaming]);

  const handleFilePickerChange = useCallback((e) => {
    appendImageFiles(e.target.files);
    e.target.value = '';
  }, [appendImageFiles]);

  return (
    <div className="dev-container">
      {fallbackNotice && (
        <div className="chat-bubble chat-bubble-system" style={{ margin: 'var(--sp-3)', border: '1px solid var(--line)', background: 'var(--bg-sunken)' }}>
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
        </div>
      )}

      {surfaceTab === 'dev' ? (
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* History sidebar */}
        {showHistory && (
          <div className="dev-history">
            <div className="dev-history-title">Sessions</div>
            {conversations.map(conv => (
              <div
                key={conv._id}
                className={`dev-history-item${conversationId === conv._id ? ' is-active' : ''}`}
                onClick={() => { selectConversation(conv._id); setShowHistory(false); }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter') { selectConversation(conv._id); setShowHistory(false); } }}
              >
                <div className="truncate" style={{ fontSize: 'var(--text-xs)' }}>
                  {conv.title || 'Untitled session'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                  <span style={{ fontSize: '10px', color: 'var(--ink-tertiary)' }}>
                    {conv.messageCount || 0} msgs
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => { e.stopPropagation(); removeConversation(conv._id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}
                    aria-label={`Delete session ${conv.title || 'Untitled session'}`}
                    style={{ padding: '1px 4px', minHeight: 'auto', fontSize: '10px', opacity: 0.5 }}
                    type="button"
                  >
                    Del
                  </button>
                </div>
              </div>
            ))}
            {conversations.length === 0 && (
              <div style={{ padding: 'var(--sp-3)', fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}>
                No sessions yet
              </div>
            )}
          </div>
        )}

        {/* Main terminal area + inspector side-by-side */}
        <div className={`dev-terminal${inspectorOpen ? ' dev-terminal--with-inspector' : ''}`}>
          {/* Messages */}
          <div className="dev-messages">
            {messages.length === 0 && !isStreaming && (
              <div className="dev-welcome">
                <div className="dev-welcome-title">Developer Mode</div>
                <div className="dev-welcome-desc">
                  Full dev-mode capabilities: file read/write, bash commands, code edits, and screenshot debugging.
                  You can also attach screenshots to debug UI issues.
                </div>
              </div>
            )}

            {messages.map((msg, i) => {
              const isOrphanedUser = i === messages.length - 1 && msg.role === 'user' && !isStreaming;
              return (
                <div key={msg._id || msg.timestamp || i} style={{ position: 'relative' }}>
                  <ChatMessage
                    role={msg.role}
                    content={msg.content}
                    images={msg.images}
                    provider={msg.provider || provider}
                    fallbackFrom={msg.fallbackFrom}
                    timestamp={msg.timestamp}
                    responseTimeMs={msg.responseTimeMs}
                    usage={msg.usage}
                    isStreaming={false}
                    variant="dev"
                    toolEvents={msg.toolEvents}
                    onRerunCommand={handleRerunCommand}
                  />
                  {isOrphanedUser && (
                    <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end', marginTop: 'var(--sp-1)', paddingRight: 'var(--sp-2)' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          deleteLastMessage();
                          sendMessage(msg.content, msg.images || [], provider);
                        }}
                        type="button"
                        title="Retry — re-send the same prompt (R)"
                        style={{ fontSize: 'var(--text-xs)', color: 'var(--accent)' }}
                      >
                        Retry
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          setInput(msg.content === '(image attached)' ? '' : msg.content);
                          deleteLastMessage();
                          textareaRef.current?.focus();
                        }}
                        type="button"
                        title="Edit — move back to input and delete (E)"
                        style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)' }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={deleteLastMessage}
                        type="button"
                        title="Delete this message (D)"
                        style={{ fontSize: 'var(--text-xs)', color: 'var(--red, #e53e3e)' }}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Streaming response */}
            {isStreaming && (streamingText || toolEvents.length > 0) && (
              <ChatMessage
                role="assistant"
                content={streamingText || ''}
                provider={streamProvider || provider}
                isStreaming={true}
                variant="dev"
                toolEvents={toolEvents}
                onRerunCommand={handleRerunCommand}
              />
            )}

            {/* Streaming spinner */}
            {isStreaming && !streamingText && toolEvents.length === 0 && (
              <div className="chat-bubble chat-bubble-assistant" style={{ alignSelf: 'flex-start' }}>
                <div className="eyebrow eyebrow--dev" style={{ marginBottom: 'var(--sp-2)' }}>
                  {getProviderLabel(streamProvider || provider)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <span className="spinner spinner-sm" />
                  <span style={{ color: 'var(--ink-tertiary)', fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)' }}>
                    Processing...
                  </span>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="dev-msg dev-msg-error">
                <span className="dev-error-prefix">ERROR</span>
                <span>{error}</span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setError(null)}
                  type="button"
                  style={{ marginLeft: 'var(--sp-3)' }}
                >
                  Dismiss
                </button>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Token monitor bar */}
          <TokenMonitorBar tokenStats={tokenStats} />
          <ControlPlaneBar
            agentHealthy={agentHealthy}
            healthDetails={healthDetails}
            runtimeHealth={runtimeHealth}
            bgTransport={bgTransport}
            monitorTransport={monitorTransport}
          />
          <DomainRemediationBar runtimeHealth={runtimeHealth} />

          {/* Input area — Compose Card */}
          <div className="chat-input-area">
            <div className="compose-card-header-row">
              <div className="quick-action-chips chat-input-prompts">
                {DEV_PROMPTS.map((dp, i) => (
                  <button
                    key={i}
                    className="quick-action-chip"
                    onClick={() => handleQuickPrompt(dp.prompt)}
                    type="button"
                    disabled={isStreaming}
                  >
                    {dp.label}
                  </button>
                ))}
              </div>

              <div className="compose-card-tab-row">
                <div className="compose-card-tab-strip compose-card-tab-strip--dev" role="tablist" aria-label="Agent tabs">
                  {AGENT_SURFACE_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      className={`compose-card-tab compose-card-tab--dev${surfaceTab === tab.id ? ' is-active' : ''}`}
                      onClick={() => setSurfaceTab(tab.id)}
                      type="button"
                      role="tab"
                      aria-selected={surfaceTab === tab.id}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Compose card */}
            <div className="compose-card-shell">
              <div className={`compose-card compose-card--dev${composeFocused ? ' is-focused' : ''}`}>
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
                    {' \u00b7 '}
                    {getReasoningEffortLabel(reasoningEffort)}
                    {mode !== 'single' && (
                      <> + {getProviderLabel(fallbackProvider)}</>
                    )}
                    <span className="chevron">&#9662;</span>
                  </button>

                  {/* Provider/mode popover */}
                  {showProviderPopover && (
                    <div className="provider-popover">
                      <Tooltip text="Choose which AI model to use" level="medium">
                        <div className="provider-popover-label">Provider</div>
                      </Tooltip>
                      {PROVIDER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={`provider-popover-option${provider === option.value ? ' is-selected' : ''}`}
                          onClick={() => {
                            setProvider(option.value);
                            const nextFamily = PROVIDER_FAMILY[option.value] || 'claude';
                            const allowed = getReasoningEffortOptions(nextFamily);
                            if (!allowed.some((o) => o.value === reasoningEffort)) {
                              setReasoningEffort('high');
                            }
                          }}
                          type="button"
                        >
                          <span className="check">{provider === option.value ? '\u2713' : ''}</span>
                          {option.label}
                        </button>
                      ))}
                      <div className="provider-popover-divider" />
                      <Tooltip text="Single: one model, Fallback: auto-retry with backup" level="medium">
                        <div className="provider-popover-label">Mode</div>
                      </Tooltip>
                      {MODE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={`provider-popover-option${mode === option.value ? ' is-selected' : ''}`}
                          onClick={() => setMode(option.value)}
                          type="button"
                        >
                          <span className="check">{mode === option.value ? '\u2713' : ''}</span>
                          {option.label}
                        </button>
                      ))}
                      {mode !== 'single' && (
                        <>
                          <div className="provider-popover-divider" />
                          <div className="provider-popover-label">Fallback Provider</div>
                          {PROVIDER_OPTIONS.filter((o) => o.value !== provider).map((option) => (
                            <button
                              key={option.value}
                              className={`provider-popover-option${fallbackProvider === option.value ? ' is-selected' : ''}`}
                              onClick={() => setFallbackProvider(option.value)}
                              type="button"
                            >
                              <span className="check">{fallbackProvider === option.value ? '\u2713' : ''}</span>
                              {option.label}
                            </button>
                          ))}
                        </>
                      )}
                      <div className="provider-popover-divider" />
                      <div className="provider-popover-label">Reasoning Effort</div>
                      {getReasoningEffortOptions(PROVIDER_FAMILY[provider] || 'claude').map((option) => (
                        <button
                          key={option.value}
                          className={`provider-popover-option${reasoningEffort === option.value ? ' is-selected' : ''}`}
                          onClick={() => setReasoningEffort(option.value)}
                          type="button"
                        >
                          <span className="check">{reasoningEffort === option.value ? '\u2713' : ''}</span>
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                  <Tooltip text="Browse past dev sessions" level="medium">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowHistory(prev => !prev)}
                      type="button"
                      style={{ fontSize: 'var(--text-xs)' }}
                    >
                      History
                    </button>
                  </Tooltip>
                  <Tooltip text="Start a fresh dev conversation" level="medium">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={newConversation}
                      type="button"
                      style={{ fontSize: 'var(--text-xs)' }}
                    >
                      New
                    </button>
                  </Tooltip>
                  {/* Help button */}
                  <div className="compose-help-btn" aria-label="Keyboard shortcuts">
                    ?
                    <div className="compose-help-tooltip">
                      <kbd>Enter</kbd> Send message<br />
                      <kbd>Shift</kbd>+<kbd>Enter</kbd> New line<br />
                      <kbd>Ctrl</kbd>+<kbd>V</kbd> Paste images<br />
                      <kbd>Ctrl</kbd>+<kbd>N</kbd> New session<br />
                      <span style={{ color: 'var(--ink-tertiary)', fontSize: '10px' }}>When aborted:</span><br />
                      <kbd>R</kbd> Retry &middot; <kbd>E</kbd> Edit &middot; <kbd>D</kbd> Delete
                    </div>
                  </div>
                </div>
              </div>

              {/* Compose body — textarea with $ prompt */}
              <div className="compose-body">
                <div className="compose-body-inner">
                  <span className="dev-prompt-symbol">$</span>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onFocus={() => setComposeFocused(true)}
                    onBlur={() => setComposeFocused(false)}
                    placeholder="Describe what you want to build, fix, or change..."
                    rows={1}
                    disabled={isStreaming}
                  />
                </div>
              </div>

              {/* Compose footer — actions + send */}
              <div className="compose-footer">
                <div className="compose-actions">
                  <button
                    className={`compose-action-btn${images.length > 0 ? ' is-active' : ''}`}
                    onClick={handleAttachClick}
                    title="Attach images (Ctrl+V)"
                    type="button"
                    aria-label="Attach images"
                    disabled={isStreaming}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
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

                  {responseTime && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--ink-tertiary)' }}>
                      Last: {(responseTime / 1000).toFixed(1)}s
                    </span>
                  )}

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
                        {images.map((image, i) => (
                          <div key={image.key || `${i}-${image.src.slice(0, 24)}`} className="compose-attachment">
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
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {isStreaming ? (
                  <button
                    className="compose-send-btn is-danger"
                    onClick={abortStream}
                    type="button"
                    aria-label="Stop generating"
                    title="Stop generating"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                ) : (
                  <button
                    className="compose-send-btn"
                    onClick={handleSubmit}
                    disabled={!input.trim() && images.length === 0}
                    type="button"
                    aria-label="Send message"
                    title="Send message"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
          }}>
            <AgentDock
              chat={chat}
              activeTab={surfaceTab}
              onActiveTabChange={setSurfaceTab}
              hideTabs
              viewContext={{ view: 'dev', conversationId: conversationId || null }}
            />
          </div>
        </div>
        <div className="chat-input-area">
          <div className="compose-card-tab-row">
            <div className="compose-card-tab-strip compose-card-tab-strip--dev" role="tablist" aria-label="Agent tabs">
              {AGENT_SURFACE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`compose-card-tab compose-card-tab--dev${surfaceTab === tab.id ? ' is-active' : ''}`}
                  onClick={() => setSurfaceTab(tab.id)}
                  type="button"
                  role="tab"
                  aria-selected={surfaceTab === tab.id}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="compose-card-shell">
            <div className="compose-card compose-card--dev" />
          </div>
        </div>
        </>
      )}

        {/* Prompt Inspector — side panel */}
        {inspectorOpen && (
          <PromptInspector
            isOpen={inspectorOpen}
            onClose={toggleInspector}
            conversationId={conversationId}
          />
        )}

      {/* Activity log — persistent bottom panel with Inspector toggle */}
      <div className="dev-activity-row">
        <AgentActivityLog />
        <button
          className={`btn btn-sm btn-ghost pi-toggle-btn${inspectorOpen ? ' is-active' : ''}`}
          onClick={toggleInspector}
          type="button"
          title={inspectorOpen ? 'Close prompt inspector' : 'Open prompt inspector'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          Inspector
        </button>
      </div>
    </div>
  );
}
