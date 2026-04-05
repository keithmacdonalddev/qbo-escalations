import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolEventsBlock } from './ToolEvents.jsx';
import TerminalPreview, { parseBashEvent } from './TerminalPreview.jsx';
import { renderMarkdown, CopyButton, formatResponseTime, getProviderLabel } from '../utils/markdown.jsx';
import Tooltip from './Tooltip.jsx';
import { transitions } from '../utils/motion.js';

const ESCALATION_TEMPLATE_LABELS = Object.freeze({
  'COID/MID': 'coidMid',
  CASE: 'caseNumber',
  'CLIENT/CONTACT': 'clientContact',
  AGENT: 'agentName',
  'CX IS ATTEMPTING TO': 'attemptingTo',
  'EXPECTED OUTCOME': 'expectedOutcome',
  'ACTUAL OUTCOME': 'actualOutcome',
  'KB/TOOLS USED': 'kbToolsUsed',
  'TRIED TEST ACCOUNT': 'triedTestAccount',
  'TS STEPS': 'tsSteps',
  CATEGORY: 'category',
  SEVERITY: 'severity',
  'OPERATOR NOTE': 'operatorNote',
});

const ESCALATION_TEMPLATE_FIELDS = Object.freeze([
  { key: 'attemptingTo', label: 'CX Is Attempting To' },
  { key: 'expectedOutcome', label: 'Expected Outcome' },
  { key: 'actualOutcome', label: 'Actual Outcome' },
  { key: 'kbToolsUsed', label: 'KB / Tools Used' },
  { key: 'triedTestAccount', label: 'Tried Test Account' },
  { key: 'tsSteps', label: 'TS Steps' },
  { key: 'operatorNote', label: 'Operator Note' },
]);

function formatTokenCount(n) {
  if (n == null) return '';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseEscalationTemplateContent(content) {
  const text = safeText(content);
  if (!text) return null;

  const fields = {};
  let currentKey = null;
  let matchedLabels = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^([A-Z][A-Z0-9/ ]+):\s*(.*)$/);
    const label = match ? safeText(match[1]).replace(/\s+/g, ' ').toUpperCase() : '';
    const mappedKey = ESCALATION_TEMPLATE_LABELS[label] || null;
    if (mappedKey) {
      matchedLabels += 1;
      currentKey = mappedKey;
      fields[currentKey] = safeText(match[2]);
      continue;
    }
    if (currentKey) {
      fields[currentKey] = [fields[currentKey], line].filter(Boolean).join(' ');
    }
  }

  if (matchedLabels < 4) return null;

  const coidMid = safeText(fields.coidMid);
  if (coidMid && (!fields.coid || !fields.mid)) {
    const [coid, mid] = coidMid.split('/').map((value) => safeText(value));
    if (!fields.coid && coid) fields.coid = coid;
    if (!fields.mid && mid) fields.mid = mid;
  }

  return fields;
}

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
  usage,
  citations,
  quickActions,
  onQuickAction,
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
    if (role !== 'assistant' || !content || isStreaming) return null;
    return renderMarkdown(content);
  }, [role, content, isStreaming]);
  const parsedUserTemplate = useMemo(() => (
    role === 'user' ? parseEscalationTemplateContent(content) : null
  ), [content, role]);
  const parsedTemplateFields = useMemo(() => (
    parsedUserTemplate
      ? ESCALATION_TEMPLATE_FIELDS
        .map((field) => ({ ...field, value: safeText(parsedUserTemplate[field.key]) }))
        .filter((field) => field.value)
      : []
  ), [parsedUserTemplate]);

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
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            />
          ))}
        </div>
      )}

      {role === 'user' && parsedUserTemplate ? (
        <div className="chat-template-card">
          <div className="chat-template-card-head">
            <span className="chat-template-card-kicker">Parsed Escalation Template</span>
            {(parsedUserTemplate.severity || parsedUserTemplate.category) && (
              <span className="chat-template-card-pill">
                {[parsedUserTemplate.severity, parsedUserTemplate.category].filter(Boolean).join(' ')}
              </span>
            )}
          </div>

          <div className="chat-template-card-meta">
            {parsedUserTemplate.coid ? <span>COID/MID {parsedUserTemplate.coid}{parsedUserTemplate.mid ? ` / ${parsedUserTemplate.mid}` : ''}</span> : null}
            {parsedUserTemplate.caseNumber ? <span>Case {parsedUserTemplate.caseNumber}</span> : null}
            {parsedUserTemplate.clientContact ? <span>Client {parsedUserTemplate.clientContact}</span> : null}
            {parsedUserTemplate.agentName ? <span>Agent {parsedUserTemplate.agentName}</span> : null}
          </div>

          <div className="chat-template-card-fields">
            {parsedTemplateFields.map((field) => (
              <div key={field.key} className="chat-template-card-field">
                <div className="chat-template-card-label">{field.label}</div>
                <div className="chat-template-card-value">{field.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : role === 'assistant' && renderedContent ? (
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

      {role === 'user' && content && (
        <div className="chat-bubble-user-actions">
          <CopyButton text={content} />
        </div>
      )}

      {role === 'assistant' && !isStreaming && citations?.length > 0 && (
        <div className="citation-sources">
          <div className="citation-header">Sources</div>
          {citations.map((c) => (
            <div key={c.index} className="citation-item">
              <span className="citation-number">[{c.index}]</span>
              <span className="citation-title">{c.title || c.sourceName}</span>
              <span className="citation-source">({c.sourceName})</span>
            </div>
          ))}
        </div>
      )}

      {role === 'assistant' && !isStreaming && quickActions?.length > 0 && onQuickAction && (
        <motion.div
          className="chat-quick-actions"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transitions.normal}
        >
          {quickActions.map((action, i) => (
            <button
              key={i}
              className="chat-quick-action-btn"
              type="button"
              onClick={() => onQuickAction(action.value || action.label)}
            >
              {action.label}
            </button>
          ))}
        </motion.div>
      )}

      {(timestamp || responseTimeMs || usage) && (
        <div className="chat-bubble-meta">
          {timestamp && (
            <span className="timestamp-hover-anchor">
              {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              <span className="timestamp-hover-card">
                <span className="timestamp-hover-row">
                  <span className="timestamp-hover-label">Time</span>
                  <span>{new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })}</span>
                </span>
                {provider && (
                  <span className="timestamp-hover-row">
                    <span className="timestamp-hover-label">Provider</span>
                    <span>{getProviderLabel(provider)}</span>
                  </span>
                )}
                {responseTimeMs && role === 'assistant' && (
                  <span className="timestamp-hover-row">
                    <span className="timestamp-hover-label">Latency</span>
                    <span>{formatResponseTime(responseTimeMs)}</span>
                  </span>
                )}
                {role === 'assistant' && usage && usage.usageAvailable !== false && usage.totalTokens > 0 && (
                  <>
                    <span className="timestamp-hover-row">
                      <span className="timestamp-hover-label">Tokens</span>
                      <span>
                        {formatTokenCount(usage.totalTokens)}
                        {(usage.inputTokens || usage.outputTokens) ? (
                          <span style={{ color: 'var(--ink-tertiary)', marginLeft: 4 }}>
                            ({formatTokenCount(usage.inputTokens || 0)} in / {formatTokenCount(usage.outputTokens || 0)} out)
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {usage.totalCostMicros > 0 && (
                      <span className="timestamp-hover-row">
                        <span className="timestamp-hover-label">Cost</span>
                        <span>${(usage.totalCostMicros / 1_000_000).toFixed(4)}</span>
                      </span>
                    )}
                    {usage.model && (
                      <span className="timestamp-hover-row">
                        <span className="timestamp-hover-label">Model</span>
                        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)' }}>{usage.model}</span>
                      </span>
                    )}
                  </>
                )}
                {fallbackFrom && (
                  <span className="timestamp-hover-row">
                    <span className="timestamp-hover-label">Fallback</span>
                    <span>from {getProviderLabel(fallbackFrom)}</span>
                  </span>
                )}
              </span>
            </span>
          )}
          {responseTimeMs && role === 'assistant' && (
            <Tooltip text="Time to first response from the AI" level="high">
              <span style={{ marginLeft: timestamp ? 'var(--sp-3)' : 0 }}>
                {formatResponseTime(responseTimeMs)}
              </span>
            </Tooltip>
          )}
          {role === 'assistant' && usage && usage.usageAvailable !== false && usage.totalTokens > 0 && (
            <span className="usage-badge" style={{ marginLeft: 'var(--sp-3)' }}>
              {formatTokenCount(usage.totalTokens)} tokens
              {usage.totalCostMicros > 0 && ` ($${(usage.totalCostMicros / 1_000_000).toFixed(4)})`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default React.memo(ChatMessage);
