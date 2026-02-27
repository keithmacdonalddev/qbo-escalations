import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../hooks/useChat.js';
import { exportConversation } from '../api/chatApi.js';
import ChatMessage from './ChatMessage.jsx';
import ImageUpload from './ImageUpload.jsx';

const QUICK_PROMPTS = [
  { label: 'Parse Escalation', prompt: 'Parse this escalation and identify: COID, MID, case number, client contact, agent name, what they\'re attempting, expected vs actual outcome, troubleshooting steps taken, and the QBO category. Then recommend next steps.' },
  { label: 'Draft Response', prompt: 'Based on our conversation, draft a professional response I can send back to the phone agent. Include specific resolution steps.' },
  { label: 'Categorize Issue', prompt: 'What QBO category does this issue fall under? Explain your reasoning and list related known issues in that category.' },
  { label: 'Suggest Troubleshooting', prompt: 'Based on the issue described, what troubleshooting steps should the agent try next? List them in order of likelihood to resolve.' },
];

export default function Chat({ conversationIdFromRoute }) {
  const {
    messages,
    conversationId,
    isStreaming,
    streamingText,
    error,
    responseTime,
    sendMessage,
    abortStream,
    selectConversation,
    newConversation,
    setError,
  } = useChat();

  const [exportCopied, setExportCopied] = useState(false);

  const [input, setInput] = useState('');
  const [images, setImages] = useState([]);
  const [showUpload, setShowUpload] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Load conversation from route param
  useEffect(() => {
    if (conversationIdFromRoute && conversationIdFromRoute !== conversationId) {
      selectConversation(conversationIdFromRoute);
    }
  }, [conversationIdFromRoute, conversationId, selectConversation]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
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

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && images.length === 0) || isStreaming) return;
    sendMessage(input, images);
    setInput('');
    setImages([]);
    setShowUpload(false);
  }, [input, images, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
    if (imageItems.length > 0) {
      e.preventDefault();
      setShowUpload(true);
      const files = imageItems.map(item => item.getAsFile()).filter(Boolean);
      const readers = files.map(file => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      }));
      Promise.all(readers).then(results => {
        setImages(prev => [...prev, ...results]);
      });
    }
  }, []);

  const handleQuickPrompt = useCallback((prompt) => {
    if (isStreaming) return;
    sendMessage(prompt, images);
    setImages([]);
    setShowUpload(false);
  }, [isStreaming, images, sendMessage]);

  const hasImages = images.length > 0;

  return (
    <div className="chat-container">
      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="empty-state" style={{ marginTop: 'var(--sp-10)' }}>
            <div className="empty-state-title">QBO Escalation Assistant</div>
            <div className="empty-state-desc">
              Paste an escalation screenshot (Ctrl+V) or describe the issue. Claude will help diagnose and draft a response.
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', justifyContent: 'center', marginTop: 'var(--sp-7)' }}>
              {QUICK_PROMPTS.slice(0, 2).map((qp, i) => (
                <button
                  key={i}
                  className="btn btn-secondary"
                  onClick={() => handleQuickPrompt(qp.prompt)}
                  type="button"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Export button when conversation has messages */}
        {messages.length > 1 && !isStreaming && conversationId && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 var(--sp-2)' }}>
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

        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            role={msg.role}
            content={msg.content}
            images={msg.images}
            timestamp={msg.timestamp}
            responseTimeMs={msg.responseTimeMs}
          />
        ))}

        {/* Streaming response */}
        {isStreaming && streamingText && (
          <ChatMessage
            role="assistant"
            content={streamingText}
            isStreaming={true}
          />
        )}

        {/* Streaming but no text yet */}
        {isStreaming && !streamingText && (
          <div className="chat-bubble chat-bubble-assistant" style={{ alignSelf: 'flex-start' }}>
            <div className="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>Claude</div>
            <span className="spinner spinner-sm" />
            <span className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginLeft: 'var(--sp-2)' }}>
              Thinking...
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="chat-bubble chat-bubble-system" style={{ borderColor: 'var(--danger)', border: '1px solid var(--danger)' }}>
            <span className="text-danger">{error}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setError(null)}
              style={{ marginLeft: 'var(--sp-3)' }}
              type="button"
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick action bar — show when images are attached */}
      {hasImages && !isStreaming && (
        <div style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-3) var(--sp-5)',
          borderTop: '1px solid var(--line-subtle)',
          overflowX: 'auto',
        }}>
          {QUICK_PROMPTS.map((qp, i) => (
            <button
              key={i}
              className="btn btn-sm btn-secondary"
              onClick={() => handleQuickPrompt(qp.prompt)}
              type="button"
              style={{ whiteSpace: 'nowrap' }}
            >
              {qp.label}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="chat-input-area" style={{ flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {showUpload && (
          <ImageUpload
            images={images}
            onImagesChange={setImages}
            disabled={isStreaming}
          />
        )}

        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', width: '100%' }}>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setShowUpload(prev => !prev)}
            title="Attach images (or press Ctrl+V to paste)"
            type="button"
            aria-label="Toggle image upload"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Describe the escalation or paste a screenshot (Ctrl+V)..."
            rows={1}
            disabled={isStreaming}
            style={{
              flex: 1,
              minHeight: 40,
              maxHeight: 160,
              resize: 'none',
              background: 'var(--bg-sunken)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '8px 12px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-base)',
              color: 'var(--ink)',
              lineHeight: 1.5,
            }}
          />

          {isStreaming ? (
            <button
              className="btn btn-danger"
              onClick={abortStream}
              type="button"
            >
              Stop
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!input.trim() && images.length === 0}
              type="button"
            >
              Send
            </button>
          )}
        </div>

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textAlign: 'center' }}>
          Enter to send &middot; Shift+Enter for new line &middot; Ctrl+V to paste images &middot; Ctrl+N new conversation
        </div>
      </div>
    </div>
  );
}
