import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '../hooks/useChat.js';
import ChatMessage from './ChatMessage.jsx';
import ImageUpload from './ImageUpload.jsx';

export default function Chat({ conversationIdFromRoute }) {
  const {
    messages,
    conversationId,
    isStreaming,
    streamingText,
    error,
    sendMessage,
    abortStream,
    selectConversation,
    setError,
  } = useChat();

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

  const handleSubmit = useCallback(() => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input, images);
    setInput('');
    setImages([]);
    setShowUpload(false);
  }, [input, images, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((e) => {
    // Enter sends, Shift+Enter adds newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  // Handle paste for images
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

  return (
    <div className="chat-container">
      {/* Messages area */}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="empty-state">
            <div className="empty-state-title">QBO Escalation Assistant</div>
            <div className="empty-state-desc">
              Paste an escalation screenshot or describe the issue. Claude will help diagnose and draft a response.
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            role={msg.role}
            content={msg.content}
            images={msg.images}
            timestamp={msg.timestamp}
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
            <span className="spinner spinner-sm" /> <span className="text-secondary" style={{ fontSize: 'var(--text-sm)', marginLeft: 'var(--sp-2)' }}>Thinking...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="chat-bubble chat-bubble-system" style={{ borderColor: 'var(--danger)' }}>
            <span className="text-danger">{error}</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setError(null)}
              style={{ marginLeft: 'var(--sp-3)' }}
            >
              Dismiss
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

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
            title="Attach images"
            type="button"
            aria-label="Toggle image upload"
          >
            {/* Simple clip icon via unicode */}
            <span style={{ fontSize: '16px' }}>+</span>
          </button>

          <textarea
            ref={textareaRef}
            className="chat-textarea"
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
              padding: '8px 10px',
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
              disabled={!input.trim()}
              type="button"
            >
              Send
            </button>
          )}
        </div>

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-tertiary)', textAlign: 'center' }}>
          Enter to send, Shift+Enter for new line. Ctrl+V to paste images.
        </div>
      </div>
    </div>
  );
}
