import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolEventsBlock } from './ToolEvents.jsx';
import TerminalPreview, { parseBashEvent } from './TerminalPreview.jsx';
import { renderMarkdown, CopyButton, formatResponseTime, getProviderLabel } from '../utils/markdown.jsx';
import Tooltip from './Tooltip.jsx';
import { transitions } from '../utils/motion.js';

function ChatMessage({
  role,
  content,
  images,
  provider,
  mode,
  fallbackFrom,
  timestamp,
  isStreaming,
  responseTimeMs,
  onFork,
  onAccept,
  accepting = false,
  isAccepted = false,
  variant,
  toolEvents,
  onRerunCommand,
}) {
  const isDev = variant === 'dev';

  const bubbleClass = role === 'user'
    ? 'chat-bubble chat-bubble-user'
    : role === 'system'
      ? 'chat-bubble chat-bubble-system'
      : 'chat-bubble chat-bubble-assistant';

  const renderedContent = useMemo(() => {
    if (role !== 'assistant' || !content) return null;
    return renderMarkdown(content);
  }, [role, content]);

  // Separate bash events (for terminal preview) from other tool events
  const { bashEvents, otherEvents } = useMemo(() => {
    if (!toolEvents || toolEvents.length === 0) return { bashEvents: [], otherEvents: [] };
    const bash = [];
    const other = [];
    for (const te of toolEvents) {
      const parsed = parseBashEvent(te);
      if (parsed) {
        bash.push({ ...parsed, original: te });
      } else {
        other.push(te);
      }
    }
    return { bashEvents: bash, otherEvents: other };
  }, [toolEvents]);

  return (
    <div className={bubbleClass}>
      {role === 'assistant' && (
        <div className="chat-bubble-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <Tooltip text="AI model that generated this response" level="high">
            <span className={isDev ? 'eyebrow eyebrow--dev' : 'eyebrow'}>
              {getProviderLabel(provider)}
              {fallbackFrom && (
                <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--ink-tertiary)', fontWeight: 400 }}>
                  (fallback from {getProviderLabel(fallbackFrom)})
                </span>
              )}
            </span>
          </Tooltip>
          <AnimatePresence>
            {!isStreaming && content && (
              <motion.div
                key="actions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={transitions.fast}
                style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}
              >
                {isAccepted && (
                  <motion.span
                    className="badge badge-resolved"
                    title="Accepted parallel winner"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={transitions.springSnappy}
                  >
                    Accepted
                  </motion.span>
                )}
                {onAccept && !isAccepted && (
                  <button
                    className="copy-btn"
                    onClick={onAccept}
                    type="button"
                    disabled={accepting}
                    title="Accept this response"
                    style={{ fontSize: 'var(--text-xs)' }}
                  >
                    {accepting ? 'Accepting...' : 'Accept'}
                  </button>
                )}
                {onFork && (
                  <button
                    className="copy-btn"
                    onClick={onFork}
                    type="button"
                    title="Fork conversation from this point"
                    style={{ fontSize: 'var(--text-xs)' }}
                  >
                    Fork
                  </button>
                )}
                <CopyButton text={content} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Tool events (dev variant only) */}
      {role === 'assistant' && otherEvents.length > 0 && (
        <ToolEventsBlock events={otherEvents} />
      )}

      {/* Terminal previews for bash commands (dev variant only) */}
      {role === 'assistant' && bashEvents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          {bashEvents.map((be, i) => (
            <TerminalPreview
              key={i}
              command={be.command}
              output={be.output}
              exitCode={be.exitCode}
              onRerun={onRerunCommand}
            />
          ))}
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

      {role === 'assistant' && renderedContent ? (
        <div className="chat-bubble-content playbook-content" style={{ wordBreak: 'break-word' }}>
          {renderedContent}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      ) : (
        <div className="chat-bubble-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
          {isStreaming && <span className="streaming-cursor" />}
        </div>
      )}

      {(timestamp || responseTimeMs) && (
        <div className="chat-bubble-meta">
          {timestamp && new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {responseTimeMs && role === 'assistant' && (
            <Tooltip text="Time to first response from the AI" level="high">
              <span style={{ marginLeft: timestamp ? 'var(--sp-3)' : 0 }}>
                {formatResponseTime(responseTimeMs)}
              </span>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(ChatMessage);
