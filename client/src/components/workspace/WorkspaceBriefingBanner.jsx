import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import WorkspaceBriefingCards from '../WorkspaceBriefingCards.jsx';

export default function WorkspaceBriefingBanner({
  briefing,
  expanded,
  onToggle,
  onDismiss,
  onAction,
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopy = () => {
    navigator.clipboard.writeText(briefing?.content || '').then(() => {
      setCopied(true);
    }).catch(() => {});
  };

  return (
    <motion.div
      className="workspace-briefing-banner"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="workspace-briefing-header" onClick={onToggle}>
        <span className="workspace-briefing-icon">{'\u2600\uFE0F'}</span>
        <span className="workspace-briefing-title">
          Morning briefing ready
          {briefing.meta?.calendarEventCount > 0 && (
            <span className="workspace-briefing-meta">
              {briefing.meta.calendarEventCount} events, {briefing.meta.inboxMessageCount} emails
            </span>
          )}
        </span>
        <div className="workspace-briefing-actions">
          <button
            className={`workspace-briefing-copy${copied ? ' is-copied' : ''}`}
            type="button"
            aria-label="Copy briefing to clipboard"
            title="Copy briefing"
            onClick={(e) => {
              e.stopPropagation();
              handleCopy();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
          <button
            className="workspace-briefing-toggle"
            type="button"
            aria-label={expanded ? 'Collapse briefing' : 'Expand briefing'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button
            className="workspace-briefing-dismiss"
            type="button"
            aria-label="Dismiss briefing"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss?.();
            }}
          >
            {'\u00D7'}
          </button>
        </div>
      </div>
      {expanded && (
        <WorkspaceBriefingCards
          briefing={briefing}
          onAction={onAction}
        />
      )}
    </motion.div>
  );
}
