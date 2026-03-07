import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// SSE streaming helper for /api/workspace/ai
// ---------------------------------------------------------------------------

function sendWorkspaceAI({ prompt, context, conversationHistory, onChunk, onStatus, onActions, onDone, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch('/api/workspace/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, context, conversationHistory }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        onError?.(err.error || 'Request failed');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let dataLines = [];

      function flushEvent() {
        if (!currentEvent && dataLines.length === 0) return;
        const rawData = dataLines.join('\n');
        dataLines = [];
        const evtName = currentEvent;
        currentEvent = '';
        if (!rawData) return;
        try {
          const data = JSON.parse(rawData);
          if (evtName === 'chunk' && data.text) onChunk?.(data.text);
          else if (evtName === 'status') onStatus?.(data);
          else if (evtName === 'actions') onActions?.(data);
          else if (evtName === 'done') onDone?.(data);
          else if (evtName === 'error') onError?.(data.error || 'AI error');
        } catch { /* ignore */ }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
          if (!trimmed) { flushEvent(); continue; }
          if (trimmed.startsWith(':')) continue;
          if (trimmed.startsWith('event:')) { currentEvent = trimmed.slice(6).trim(); continue; }
          if (trimmed.startsWith('data:')) { dataLines.push(trimmed.slice(5).trimStart()); }
        }
      }
      flushEvent();
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err.message || 'Network error');
    }
  })();

  return { abort: () => controller.abort() };
}

// ---------------------------------------------------------------------------
// WorkspaceAgentPanel — shared docked panel for Gmail + Calendar views
// ---------------------------------------------------------------------------

export default function WorkspaceAgentPanel({ open, onToggle, viewContext }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [statusMsg, setStatusMsg] = useState(null);
  const [lastActions, setLastActions] = useState(null);
  const abortRef = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamText]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleSend = useCallback((e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamText('');
    setStatusMsg(null);
    setLastActions(null);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));

    const { abort } = sendWorkspaceAI({
      prompt: text,
      context: viewContext || undefined,
      conversationHistory: history,
      onChunk: (chunk) => setStreamText((prev) => prev + chunk),
      onStatus: (data) => setStatusMsg(data.message || 'Working...'),
      onActions: (data) => {
        setLastActions(data.results || []);
        setStatusMsg(null);
      },
      onDone: (data) => {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.fullResponse || '',
            actions: data.actions || [],
          },
        ]);
        setStreamText('');
        setStreaming(false);
        setStatusMsg(null);
      },
      onError: (err) => {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${err}`, isError: true },
        ]);
        setStreamText('');
        setStreaming(false);
        setStatusMsg(null);
      },
    });

    abortRef.current = abort;
  }, [input, streaming, messages, viewContext]);

  const handleStop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    if (streamText) {
      setMessages((prev) => [...prev, { role: 'assistant', content: streamText }]);
    }
    setStreamText('');
    setStreaming(false);
    setStatusMsg(null);
  }, [streamText]);

  const handleQuickAction = useCallback((promptText) => {
    setInput(promptText);
    setTimeout(() => {
      const userMsg = { role: 'user', content: promptText };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);
      setStreamText('');
      setStatusMsg(null);
      setLastActions(null);

      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      const { abort } = sendWorkspaceAI({
        prompt: promptText,
        context: viewContext || undefined,
        conversationHistory: history,
        onChunk: (chunk) => setStreamText((prev) => prev + chunk),
        onStatus: (data) => setStatusMsg(data.message || 'Working...'),
        onActions: (data) => {
          setLastActions(data.results || []);
          setStatusMsg(null);
        },
        onDone: (data) => {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: data.fullResponse || '',
              actions: data.actions || [],
            },
          ]);
          setStreamText('');
          setStreaming(false);
          setStatusMsg(null);
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Error: ${err}`, isError: true },
          ]);
          setStreamText('');
          setStreaming(false);
          setStatusMsg(null);
        },
      });
      abortRef.current = abort;
      setInput('');
    }, 0);
  }, [messages, viewContext]);

  const quickActions = useMemo(() => {
    const currentView = viewContext?.view;
    if (currentView === 'gmail') {
      if (viewContext?.emailId) {
        return [
          { label: 'Summarize this email', prompt: 'Summarize this email concisely. Highlight key points, action items, and sender intent.' },
          { label: 'Draft a reply', prompt: 'Draft a professional reply to this email.' },
          { label: 'Extract action items', prompt: 'Extract all action items and deadlines from this email as a bullet list.' },
          { label: 'Related calendar events', prompt: 'Are there any upcoming calendar events related to this email? Check my calendar.' },
        ];
      }
      return [
        { label: 'Unread summary', prompt: 'Search for my unread emails and give me a brief summary of each.' },
        { label: 'Today\'s schedule', prompt: 'What\'s on my calendar today? List all events with times.' },
        { label: 'Important emails', prompt: 'Search for important emails from the last 24 hours and summarize them.' },
      ];
    }
    if (currentView === 'calendar') {
      return [
        { label: 'Today\'s schedule', prompt: 'List all my events for today with times and details.' },
        { label: 'This week\'s events', prompt: 'Give me an overview of my calendar this week.' },
        { label: 'Find free time', prompt: 'When am I free this week? Find available time slots.' },
        { label: 'Unread emails', prompt: 'Search for my unread emails and give me a brief summary.' },
      ];
    }
    return [
      { label: 'Inbox overview', prompt: 'Search for my recent unread emails and summarize them.' },
      { label: 'Today\'s schedule', prompt: 'What\'s on my calendar today?' },
    ];
  }, [viewContext]);

  // Render inline markdown (very basic: bold, code, line breaks)
  function renderText(text) {
    if (!text) return null;
    return text.split('\n').map((line, i) => {
      // Bold **text**
      const parts = [];
      let lastIdx = 0;
      const boldRegex = /\*\*(.+?)\*\*/g;
      let m;
      while ((m = boldRegex.exec(line)) !== null) {
        if (m.index > lastIdx) parts.push(line.slice(lastIdx, m.index));
        parts.push(<strong key={`b${i}-${m.index}`}>{m[1]}</strong>);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx < line.length) parts.push(line.slice(lastIdx));
      if (parts.length === 0) parts.push(line);

      return (
        <span key={i}>
          {parts}
          {i < text.split('\n').length - 1 && <br />}
        </span>
      );
    });
  }

  if (!open) return null;

  return (
    <div className="workspace-agent-panel">
      <div className="workspace-agent-header">
        <div className="workspace-agent-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span>Workspace Agent</span>
          <span className="workspace-agent-badge">
            {viewContext?.view === 'gmail' ? 'Email' : viewContext?.view === 'calendar' ? 'Calendar' : 'Workspace'}
          </span>
        </div>
        <div className="workspace-agent-header-actions">
          {messages.length > 0 && (
            <button
              className="workspace-agent-icon-btn"
              onClick={() => { setMessages([]); setStreamText(''); setStatusMsg(null); setLastActions(null); }}
              type="button"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
              </svg>
            </button>
          )}
          <button className="workspace-agent-icon-btn" onClick={onToggle} type="button" aria-label="Close panel">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      <div className="workspace-agent-messages">
        {messages.length === 0 && !streaming && (
          <div className="workspace-agent-welcome">
            <div className="workspace-agent-welcome-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--ink-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <p className="workspace-agent-welcome-text">
              I can manage your email and calendar. Send emails, create events, search your inbox, check your schedule, and more.
            </p>
            <div className="workspace-agent-quick-actions">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  className="workspace-agent-quick-btn"
                  onClick={() => handleQuickAction(action.prompt)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`workspace-agent-msg workspace-agent-msg-${msg.role}${msg.isError ? ' workspace-agent-msg-error' : ''}`}
          >
            {msg.role === 'assistant' && (
              <div className="workspace-agent-msg-avatar">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
            )}
            <div className="workspace-agent-msg-content">
              {renderText(msg.content)}
            </div>
            {msg.actions && msg.actions.length > 0 && (
              <div className="workspace-agent-action-chips">
                {msg.actions.map((a, j) => (
                  <span key={j} className={`workspace-agent-action-chip ${a.error ? 'is-error' : 'is-success'}`}>
                    {a.tool}
                    {a.error ? ' (failed)' : ' (done)'}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Status message (executing actions) */}
        <AnimatePresence>
          {statusMsg && streaming && (
            <motion.div
              className="workspace-agent-status"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="workspace-agent-status-dot" />
              {statusMsg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Streaming text */}
        {streaming && streamText && (
          <div className="workspace-agent-msg workspace-agent-msg-assistant">
            <div className="workspace-agent-msg-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="workspace-agent-msg-content workspace-agent-streaming">
              {renderText(streamText)}
            </div>
          </div>
        )}

        {/* Typing indicator */}
        {streaming && !streamText && !statusMsg && (
          <div className="workspace-agent-msg workspace-agent-msg-assistant">
            <div className="workspace-agent-msg-avatar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </div>
            <div className="workspace-agent-msg-content">
              <div className="workspace-agent-typing">
                <span /><span /><span />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="workspace-agent-input" onSubmit={handleSend}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your Workspace Agent..."
          disabled={streaming}
        />
        {streaming ? (
          <button className="workspace-agent-send-btn workspace-agent-stop-btn" onClick={handleStop} type="button" aria-label="Stop">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button className="workspace-agent-send-btn" type="submit" disabled={!input.trim()} aria-label="Send">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
