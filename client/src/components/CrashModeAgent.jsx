import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api/http.js';
import { consumeSSEStream } from '../api/sse.js';

/**
 * Crash-Survivor Dev Agent Widget
 *
 * Renders OUTSIDE the ErrorBoundary so it survives app crashes.
 * Zero dependencies on React context, providers, or hooks from the app tree.
 * Uses shared HTTP/SSE helpers to talk to /api/dev/chat.
 *
 * Listens for `react-error-boundary` custom events dispatched by main.jsx
 * and auto-sends the crash details to the dev agent.
 */
export default function CrashModeAgent() {
  const [visible, setVisible] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [crashError, setCrashError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const sendingRef = useRef(false);
  // Track whether we already auto-sent for this crash to avoid duplicates
  const autoSentRef = useRef(false);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when widget becomes visible
  useEffect(() => {
    if (visible && !minimized) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [visible, minimized]);

  // Shared fetch/SSE helpers keep crash-mode traffic visible to monitors
  const sendToAgent = useCallback(async (text) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setMessages(prev => [...prev, { role: 'user', text }]);

    try {
      const res = await apiFetch('/api/dev/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId || undefined,
          provider: 'claude',
        }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        setMessages(prev => [...prev, {
          role: 'system',
          text: `Server error ${res.status}: ${errBody?.error || res.statusText}. Is the server running?`,
        }]);
        sendingRef.current = false;
        setSending(false);
        return;
      }

      // Process SSE stream using the project's event format
      let assistantText = '';
      let newConvId = conversationId;
      await consumeSSEStream(res, (eventType, data) => {
        if ((eventType === 'start' || eventType === 'init' || eventType === 'session') && data?.conversationId) {
          newConvId = data.conversationId;
        }
        if (eventType === 'chunk' && typeof data?.text === 'string') {
          assistantText += data.text;
        }
        if (eventType === 'delta' && data?.delta?.text) {
          assistantText += data.delta.text;
        }
        if (eventType === 'result' && typeof data?.result === 'string') {
          assistantText = data.result;
        }
        if (eventType === 'text' && Array.isArray(data?.message?.content)) {
          assistantText = data.message.content
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text)
            .join('');
        }
        if (eventType === 'done' && data?.conversationId) {
          newConvId = data.conversationId;
        }
        if (eventType === 'done' && typeof data?.text === 'string') {
          assistantText = data.text;
        }
      });

      setConversationId(newConvId);
      if (assistantText) {
        setMessages(prev => [...prev, { role: 'assistant', text: assistantText }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'system',
        text: `Cannot reach server: ${err.message}. Start the server with "npm run dev:server".`,
      }]);
    }

    sendingRef.current = false;
    setSending(false);
  }, [conversationId]);

  // Listen for crash events from ErrorBoundary
  useEffect(() => {
    function handleCrash(e) {
      const { error, componentStack } = e.detail || {};
      setCrashError(error);
      setVisible(true);
      setMinimized(false);
      autoSentRef.current = false;

      const crashMsg = [
        '[AUTO-ERROR] App crashed -- ErrorBoundary triggered',
        '',
        `Error: ${error?.message || 'Unknown'}`,
        `Stack: ${error?.stack?.split('\n').slice(0, 8).join('\n') || 'unavailable'}`,
        `Component Stack: ${componentStack?.split('\n').slice(0, 5).join('\n') || 'unavailable'}`,
        '',
        'The entire app has crashed and is showing the error fallback page.',
        'This is a critical issue that blocks all user functionality. Investigate and fix it immediately.',
      ].join('\n');

      // Slight delay so state settles before sending
      if (!autoSentRef.current) {
        autoSentRef.current = true;
        setTimeout(() => sendToAgent(crashMsg), 100);
      }
    }

    window.addEventListener('react-error-boundary', handleCrash);
    return () => window.removeEventListener('react-error-boundary', handleCrash);
  }, [sendToAgent]);

  // Keyboard shortcut: Ctrl+Shift+E to toggle in crash mode
  useEffect(() => {
    function handleKey(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (visible) {
          setMinimized(m => !m);
        }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [visible]);

  function handleSend() {
    if (!input.trim() || sending) return;
    sendToAgent(input.trim());
    setInput('');
  }

  if (!visible) return null;

  // Minimized: just show a pulsing pill
  if (minimized) {
    return (
      <div
        onClick={() => setMinimized(false)}
        style={{
          position: 'fixed', bottom: 20, right: 20,
          background: '#1a1a2e', border: '1px solid #e8574a',
          borderRadius: 20, padding: '6px 14px',
          boxShadow: '0 4px 20px rgba(232,87,74,0.3)',
          zIndex: 999999, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#e0e0e0', fontSize: 12,
        }}
      >
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: sending ? '#f0ad4e' : '#e8574a',
          boxShadow: `0 0 8px ${sending ? '#f0ad4e' : '#e8574a'}`,
          animation: 'crash-agent-pulse 1.5s infinite',
        }} />
        <span style={{ fontWeight: 600 }}>
          {sending ? 'Agent working...' : 'Crash Agent'}
        </span>
        <style>{KEYFRAMES}</style>
      </div>
    );
  }

  // Full widget -- all inline styles, no external CSS
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20,
      width: 400, maxHeight: 520,
      background: '#1a1a2e',
      border: '1px solid #e8574a',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(232,87,74,0.3)',
      zIndex: 999999,
      display: 'flex', flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: '#e0e0e0', fontSize: 13,
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        background: 'rgba(232,87,74,0.08)',
        borderRadius: '12px 12px 0 0',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: sending ? '#f0ad4e' : '#e8574a',
            boxShadow: `0 0 8px ${sending ? '#f0ad4e' : '#e8574a'}`,
            animation: 'crash-agent-pulse 1.5s infinite',
          }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Dev Agent</span>
          <span style={{
            fontSize: 10, padding: '1px 6px',
            background: 'rgba(232,87,74,0.25)',
            borderRadius: 4, color: '#e8574a',
            fontWeight: 600, letterSpacing: '0.5px',
          }}>CRASH MODE</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => setMinimized(true)}
            title="Minimize (Ctrl+Shift+E)"
            style={headerBtnStyle}
          >&ndash;</button>
          <button
            onClick={() => setVisible(false)}
            title="Close"
            style={headerBtnStyle}
          >&times;</button>
        </div>
      </div>

      {/* Crash info banner */}
      {crashError && (
        <div style={{
          padding: '8px 14px',
          background: 'rgba(232,87,74,0.12)',
          borderBottom: '1px solid rgba(232,87,74,0.15)',
          fontSize: 11, color: '#e8574a',
          lineHeight: 1.4,
        }}>
          <strong>Crash:</strong> {crashError.message?.slice(0, 120)}
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '10px 14px', maxHeight: 320,
      }}>
        {messages.length === 0 && (
          <div style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
            Crash detected. Agent is being notified...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            marginBottom: 8, padding: '8px 10px',
            borderRadius: 8,
            background: msg.role === 'user' ? 'rgba(52,168,83,0.12)' :
                         msg.role === 'system' ? 'rgba(232,87,74,0.12)' :
                         'rgba(255,255,255,0.04)',
            fontSize: 12, lineHeight: 1.5,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            <div style={{
              fontWeight: 600, fontSize: 10, marginBottom: 3,
              color: msg.role === 'user' ? '#34a853' :
                     msg.role === 'system' ? '#e8574a' : '#4ec9b5',
              textTransform: 'uppercase', letterSpacing: '0.5px',
            }}>
              {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'Dev Agent'}
            </div>
            {msg.text}
          </div>
        ))}
        {sending && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
          <div style={{
            padding: '8px 10px', borderRadius: 8,
            background: 'rgba(255,255,255,0.04)',
            fontSize: 12, color: '#666',
          }}>
            <span style={{ animation: 'crash-agent-pulse 1s infinite' }}>Agent is thinking...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: '8px 14px 10px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', gap: 8,
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={sending ? 'Agent working...' : 'Tell the agent what to fix...'}
          disabled={sending}
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, padding: '7px 10px',
            color: '#e0e0e0', fontSize: 12,
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => { e.target.style.borderColor = 'rgba(78,201,181,0.5)'; }}
          onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.15)'; }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !input.trim()}
          style={{
            background: sending ? '#555' : '#34a853',
            border: 'none', borderRadius: 6,
            padding: '7px 14px', color: '#fff',
            cursor: sending ? 'default' : 'pointer',
            fontSize: 12, fontWeight: 600,
            opacity: (sending || !input.trim()) ? 0.5 : 1,
            transition: 'opacity 0.15s, background 0.15s',
          }}
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>

      <style>{KEYFRAMES}</style>
    </div>
  );
}

const headerBtnStyle = {
  background: 'none', border: 'none',
  color: '#888', cursor: 'pointer',
  fontSize: 16, padding: '0 4px',
  lineHeight: 1,
};

const KEYFRAMES = `@keyframes crash-agent-pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`;
