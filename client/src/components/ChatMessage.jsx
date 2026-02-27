import { useState, useCallback } from 'react';

export default function ChatMessage({ role, content, images, timestamp, isStreaming }) {
  const bubbleClass = role === 'user'
    ? 'chat-bubble chat-bubble-user'
    : role === 'system'
      ? 'chat-bubble chat-bubble-system'
      : 'chat-bubble chat-bubble-assistant';

  return (
    <div className={bubbleClass}>
      {role === 'assistant' && (
        <div className="chat-bubble-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <span className="eyebrow">Claude</span>
          {!isStreaming && content && <CopyButton text={content} />}
        </div>
      )}

      {images && images.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)' }}>
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Attachment ${i + 1}`}
              style={{
                maxWidth: 200,
                maxHeight: 160,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--line)',
              }}
            />
          ))}
        </div>
      )}

      <div className="chat-bubble-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {content}
        {isStreaming && <span className="streaming-cursor" />}
      </div>

      {timestamp && (
        <div className="chat-bubble-meta">
          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [text]);

  return (
    <button
      className={`copy-btn${copied ? ' is-copied' : ''}`}
      onClick={handleCopy}
      type="button"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
