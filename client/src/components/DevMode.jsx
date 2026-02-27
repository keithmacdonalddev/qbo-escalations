import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDevChat } from '../hooks/useDevChat.js';

/** Quick dev prompts for common tasks */
const DEV_PROMPTS = [
  { label: 'Fix a bug', prompt: 'I need help fixing a bug: ' },
  { label: 'Add a feature', prompt: 'I want to add a new feature: ' },
  { label: 'Refactor', prompt: 'Refactor the following code: ' },
  { label: 'Explain code', prompt: 'Explain how this code works: ' },
];

export default function DevMode() {
  const {
    messages,
    conversationId,
    conversations,
    isStreaming,
    streamingText,
    toolEvents,
    error,
    responseTime,
    sendMessage,
    abortStream,
    selectConversation,
    newConversation,
    removeConversation,
    setError,
  } = useDevChat();

  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, toolEvents]);

  // Auto-resize input
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  // Focus input after streaming ends
  useEffect(() => {
    if (!isStreaming) inputRef.current?.focus();
  }, [isStreaming]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        newConversation();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [newConversation]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input);
    setInput('');
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleQuickPrompt = useCallback((prompt) => {
    setInput(prompt);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="dev-container">
      {/* Top bar */}
      <div className="dev-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)' }}>
            Dev Mode
          </span>
          <span className="dev-badge">Claude Code</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowHistory(prev => !prev)}
            type="button"
          >
            History
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={newConversation}
            type="button"
          >
            New
          </button>
        </div>
      </div>

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

        {/* Main terminal area */}
        <div className="dev-terminal">
          {/* Messages */}
          <div className="dev-messages">
            {messages.length === 0 && !isStreaming && (
              <div className="dev-welcome">
                <div className="dev-welcome-title">Claude Code — Developer Mode</div>
                <div className="dev-welcome-desc">
                  Full Claude Code capabilities: file read/write, bash commands, code editing.
                  Describe what you want to build or fix.
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginTop: 'var(--sp-5)' }}>
                  {DEV_PROMPTS.map((dp, i) => (
                    <button
                      key={i}
                      className="btn btn-sm dev-prompt-btn"
                      onClick={() => handleQuickPrompt(dp.prompt)}
                      type="button"
                    >
                      {dp.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <DevMessage key={i} msg={msg} />
            ))}

            {/* Streaming response */}
            {isStreaming && (streamingText || toolEvents.length > 0) && (
              <div className="dev-msg dev-msg-assistant">
                <div className="dev-msg-label">claude</div>
                {toolEvents.length > 0 && (
                  <div className="dev-tool-events">
                    {toolEvents.map((te, i) => (
                      <ToolEventLine key={i} event={te} />
                    ))}
                  </div>
                )}
                {streamingText && (
                  <div className="dev-msg-content">
                    <DevMarkdown text={streamingText} />
                  </div>
                )}
                <span className="dev-cursor" />
              </div>
            )}

            {/* Streaming spinner */}
            {isStreaming && !streamingText && toolEvents.length === 0 && (
              <div className="dev-msg dev-msg-assistant">
                <div className="dev-msg-label">claude</div>
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

          {/* Input area */}
          <div className="dev-input-area">
            <div className="dev-input-shell">
              <span className="dev-prompt-symbol">$</span>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build, fix, or change..."
                rows={1}
                disabled={isStreaming}
                className="dev-input"
              />
              {isStreaming ? (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={abortStream}
                  type="button"
                >
                  Stop
                </button>
              ) : (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSubmit}
                  disabled={!input.trim()}
                  type="button"
                >
                  Run
                </button>
              )}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--ink-tertiary)', textAlign: 'center', marginTop: 'var(--sp-1)', fontFamily: 'var(--font-mono)' }}>
              Enter to send &middot; Shift+Enter new line &middot; Ctrl+N new session
              {responseTime && <span> &middot; Last: {(responseTime / 1000).toFixed(1)}s</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Render a single message */
function DevMessage({ msg }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`dev-msg ${isUser ? 'dev-msg-user' : 'dev-msg-assistant'}`}>
      <div className="dev-msg-label">
        {isUser ? 'you' : 'claude'}
        {msg.responseTimeMs && (
          <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--ink-tertiary)', fontWeight: 400 }}>
            {(msg.responseTimeMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Tool events for assistant messages */}
      {!isUser && msg.toolEvents && msg.toolEvents.length > 0 && (
        <ToolEventsBlock events={msg.toolEvents} />
      )}

      <div className="dev-msg-content">
        {isUser ? (
          <pre className="dev-user-text">{msg.content}</pre>
        ) : (
          <DevMarkdown text={msg.content} />
        )}
      </div>
    </div>
  );
}

/** Collapsible tool events block */
function ToolEventsBlock({ events }) {
  const [expanded, setExpanded] = useState(false);
  const displayEvents = expanded ? events : events.slice(0, 3);
  const hasMore = events.length > 3;

  return (
    <div className="dev-tool-events">
      {displayEvents.map((te, i) => (
        <ToolEventLine key={i} event={te} />
      ))}
      {hasMore && !expanded && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setExpanded(true)}
          type="button"
          style={{ fontSize: '10px', padding: '1px 6px', fontFamily: 'var(--font-mono)' }}
        >
          +{events.length - 3} more tool calls
        </button>
      )}
    </div>
  );
}

/** Single tool event line */
function ToolEventLine({ event }) {
  const [showDetails, setShowDetails] = useState(false);
  const icon = getToolIcon(event.tool);

  return (
    <div className="dev-tool-line">
      <button
        className="dev-tool-summary"
        onClick={() => setShowDetails(prev => !prev)}
        type="button"
      >
        <span className="dev-tool-icon">{icon}</span>
        <span className="dev-tool-name">{event.tool || 'tool'}</span>
        {event.file && <span className="dev-tool-file">{event.file}</span>}
        {event.status === 'success' && <span className="dev-tool-status-ok">OK</span>}
        {event.status === 'error' && <span className="dev-tool-status-err">ERR</span>}
      </button>
      {showDetails && event.details && (
        <pre className="dev-tool-details">{typeof event.details === 'string' ? event.details : JSON.stringify(event.details, null, 2)}</pre>
      )}
    </div>
  );
}

function getToolIcon(tool) {
  if (!tool) return '>';
  if (tool.includes('read') || tool.includes('Read')) return 'R';
  if (tool.includes('write') || tool.includes('Write')) return 'W';
  if (tool.includes('edit') || tool.includes('Edit')) return 'E';
  if (tool.includes('bash') || tool.includes('Bash')) return '$';
  if (tool.includes('grep') || tool.includes('Grep')) return '?';
  if (tool.includes('glob') || tool.includes('Glob')) return '*';
  return '>';
}

/** Simple markdown-to-JSX for dev mode (code blocks, inline code, bold) */
function DevMarkdown({ text }) {
  const rendered = useMemo(() => {
    if (!text) return null;
    const blocks = text.split(/(```[\s\S]*?```)/g);
    return blocks.map((block, i) => {
      if (block.startsWith('```')) {
        const match = block.match(/^```(\w*)\n?([\s\S]*?)```$/);
        if (match) {
          const lang = match[1];
          const code = match[2];
          return (
            <div key={i} className="dev-code-block">
              {lang && <div className="dev-code-lang">{lang}</div>}
              <pre className="dev-code-pre"><code>{code}</code></pre>
              <CopyBtn text={code} />
            </div>
          );
        }
      }
      // Inline formatting
      return <DevInlineBlock key={i} text={block} />;
    });
  }, [text]);

  return <div className="dev-markdown">{rendered}</div>;
}

function DevInlineBlock({ text }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        // Bold
        let formatted = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
        // Inline code
        formatted = formatted.replace(/`([^`]+)`/g, '<code class="dev-inline-code">$1</code>');
        return <div key={i} dangerouslySetInnerHTML={{ __html: formatted }} />;
      })}
    </>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }, [text]);

  return (
    <button
      className="dev-copy-btn"
      onClick={handleCopy}
      type="button"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
