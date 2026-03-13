import { useEffect, useMemo, useState } from 'react';
import { renderMarkdown } from '../utils/markdown.jsx';

const URGENCY_META = {
  urgent: { label: 'Urgent', className: 'is-urgent' },
  action: { label: 'Action', className: 'is-action' },
  fyi: { label: 'FYI', className: 'is-fyi' },
};

const ICONS = {
  plane: '\u2708',
  calendar: '\uD83D\uDCC5',
  mail: '\u2709',
  check: '\u2713',
  alert: '\u26A0',
  info: '\u2139',
};

function getUrgencyMeta(urgency) {
  return URGENCY_META[urgency] || URGENCY_META.fyi;
}

function formatAbsoluteTime(targetIso, fallbackLabel) {
  if (!targetIso) return fallbackLabel || '';
  const target = new Date(targetIso);
  if (!Number.isFinite(target.getTime())) return fallbackLabel || '';
  return target.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatCountdown(targetIso, nowMs) {
  if (!targetIso) return null;
  const target = new Date(targetIso);
  if (!Number.isFinite(target.getTime())) return null;

  const deltaMs = target.getTime() - nowMs;
  const absoluteMs = Math.abs(deltaMs);
  const totalMinutes = Math.round(absoluteMs / 60000);

  if (totalMinutes < 1) {
    return { label: deltaMs >= 0 ? 'Now' : 'Started just now', className: 'is-now' };
  }

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  const distance = parts.slice(0, 2).join(' ');

  if (deltaMs >= 0) {
    return { label: `In ${distance}`, className: 'is-upcoming' };
  }
  return { label: `${distance} ago`, className: 'is-past' };
}

function buildDefaultCollapsedMap(cards) {
  const next = {};
  cards.forEach((card) => {
    next[card.id] = card.urgency === 'fyi';
  });
  return next;
}

export default function WorkspaceBriefingCards({ briefing, onAction }) {
  const cards = useMemo(
    () => (Array.isArray(briefing?.structured?.cards) ? briefing.structured.cards : []),
    [briefing?.structured?.cards],
  );
  const [collapsedMap, setCollapsedMap] = useState(() => buildDefaultCollapsedMap(cards));
  const [pendingMap, setPendingMap] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setCollapsedMap(buildDefaultCollapsedMap(cards));
    setPendingMap({});
  }, [briefing?.date, cards]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  const handleToggle = (cardId) => {
    setCollapsedMap((prev) => ({ ...prev, [cardId]: !prev[cardId] }));
  };

  const handleAction = async (card, action, actionIndex) => {
    if (typeof onAction !== 'function') return;
    const pendingKey = `${card.id}:${action.id || action.label || actionIndex}`;
    setPendingMap((prev) => ({ ...prev, [pendingKey]: true }));
    try {
      await Promise.resolve(onAction(action, card));
    } catch {
      // The parent action handler is responsible for user-facing errors.
    } finally {
      setPendingMap((prev) => ({ ...prev, [pendingKey]: false }));
    }
  };

  if (cards.length === 0) {
    return (
      <div className="workspace-briefing-content">
        {renderMarkdown(briefing?.content || '')}
      </div>
    );
  }

  return (
    <div className="workspace-briefing-content workspace-briefing-content--cards">
      {briefing?.structured?.summary ? (
        <div className="workspace-briefing-summary">
          {renderMarkdown(briefing.structured.summary)}
        </div>
      ) : null}

      <div className="workspace-briefing-card-list">
        {cards.map((card, cardIndex) => {
          const urgencyMeta = getUrgencyMeta(card.urgency);
          const countdown = formatCountdown(card.countdownAt, nowMs);
          const isCollapsed = collapsedMap[card.id] === true;
          return (
            <section
              key={card.id || `briefing-card-${cardIndex}`}
              className={`workspace-briefing-card ${urgencyMeta.className}${isCollapsed ? ' is-collapsed' : ''}`}
            >
              <button
                className="workspace-briefing-card-header"
                type="button"
                onClick={() => handleToggle(card.id)}
                aria-expanded={!isCollapsed}
              >
                <span className="workspace-briefing-card-icon" aria-hidden="true">
                  {ICONS[card.icon] || ICONS.info}
                </span>
                <span className="workspace-briefing-card-title-wrap">
                  <span className="workspace-briefing-card-title">{card.title}</span>
                  {card.timeLabel || card.countdownAt ? (
                    <span className="workspace-briefing-card-time">
                      {formatAbsoluteTime(card.countdownAt, card.timeLabel)}
                    </span>
                  ) : null}
                </span>
                <span className={`workspace-briefing-card-badge ${urgencyMeta.className}`}>
                  {urgencyMeta.label}
                </span>
                {countdown ? (
                  <span className={`workspace-briefing-card-countdown ${countdown.className}`}>
                    {countdown.label}
                  </span>
                ) : null}
                <span className="workspace-briefing-card-chevron" aria-hidden="true">
                  {isCollapsed ? '\u25BE' : '\u25B4'}
                </span>
              </button>

              {!isCollapsed ? (
                <div className="workspace-briefing-card-body">
                  {card.bodyMarkdown ? (
                    <div className="workspace-briefing-card-copy">
                      {renderMarkdown(card.bodyMarkdown)}
                    </div>
                  ) : null}

                  {Array.isArray(card.actions) && card.actions.length > 0 ? (
                    <div className="workspace-briefing-card-actions">
                      {card.actions.map((action, actionIndex) => {
                        const pendingKey = `${card.id}:${action.id || action.label || actionIndex}`;
                        const busy = pendingMap[pendingKey] === true;
                        return (
                          <button
                            key={action.id || `${card.id}-action-${actionIndex}`}
                            className="workspace-briefing-card-action"
                            type="button"
                            onClick={() => handleAction(card, action, actionIndex)}
                            disabled={busy}
                          >
                            {busy ? 'Working...' : action.label}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
