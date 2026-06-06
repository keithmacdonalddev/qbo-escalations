import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import useFloatingAnchor from '../hooks/useFloatingAnchor.js';
import './KnowledgeGapsFlyout.css';

/**
 * KnowledgeGapsFlyout — the Escalation Dashboard "Knowledge gaps need attention"
 * affordance.
 *
 * Why a portal: the dashboard table card is overflow:hidden with an inner
 * overflow-x:auto scroller, which used to slice this popover off. The flyout is
 * now rendered through a portal to <body> and positioned with fixed coordinates
 * derived from the trigger, so it is never clipped or detached.
 *
 * Interaction: opens on hover AND keyboard focus, stays open while the pointer
 * is over either the trigger or the panel, can be pinned by click, and is
 * dismissible via Esc, click-away, or blur. Fully keyboard-accessible.
 *
 * Class names deliberately avoid the substrings "popover", "tooltip", "dialog",
 * "modal", "overlay", "menu" so the global overhaul.css !important rules that
 * target those substrings cannot wash out this component's styling.
 */
export default function KnowledgeGapsFlyout({ gaps, gapsDays, onChangeDays }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const panelId = useId();
  const hideTimer = useRef(null);
  const rootRef = useRef(null);

  const { triggerRef, panelRef, style } = useFloatingAnchor({
    open,
    placement: 'bottom',
    gap: 10,
    margin: 12,
  });

  const clearHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    clearHide();
    setOpen(true);
  }, [clearHide]);

  const scheduleHide = useCallback(() => {
    if (pinned) return;
    clearHide();
    hideTimer.current = setTimeout(() => setOpen(false), 120);
  }, [pinned, clearHide]);

  const close = useCallback(() => {
    clearHide();
    setPinned(false);
    setOpen(false);
  }, [clearHide]);

  // Esc closes; click-away closes a pinned flyout.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') {
        close();
        triggerRef.current?.focus?.();
      }
    }
    function onPointerDown(e) {
      const t = triggerRef.current;
      const p = panelRef.current;
      if (t && t.contains(e.target)) return;
      if (p && p.contains(e.target)) return;
      close();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open, close, triggerRef, panelRef]);

  useEffect(() => () => clearHide(), [clearHide]);

  if (!gaps || !Array.isArray(gaps.gaps) || gaps.gaps.length === 0) {
    return null;
  }

  const allGaps = gaps.gaps;
  const needAttention = allGaps.filter((g) => g.gapScore < 50);
  const attentionCount = needAttention.length;
  const unused = Array.isArray(gaps.unusedCategories) ? gaps.unusedCategories : [];

  // Worst first, so the eye lands on the most urgent gap.
  const ordered = [...allGaps].sort((a, b) => a.gapScore - b.gapScore);

  function severityOf(score) {
    if (score < 40) return 'critical';
    if (score < 70) return 'warning';
    return 'good';
  }

  function togglePin() {
    if (pinned) {
      close();
    } else {
      setPinned(true);
      setOpen(true);
    }
  }

  return (
    <div
      className="kgflyout-root"
      ref={rootRef}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
    >
      {/* Visual frame is the row container; the trigger button and the
          day-range <select> are DOM siblings (a <select> nested inside a
          <button> is invalid HTML with undefined keyboard behavior). */}
      <div className={`kgflyout-trigger${open ? ' is-open' : ''}${pinned ? ' is-pinned' : ''}`}>
        <button
          type="button"
          ref={triggerRef}
          className="kgflyout-trigger-main"
          onClick={togglePin}
          onFocus={show}
          onBlur={scheduleHide}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-haspopup="true"
        >
          <span className="kgflyout-trigger-lead">
            <svg
              className="kgflyout-trigger-icon"
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="kgflyout-trigger-label">Knowledge gaps</span>
            {attentionCount > 0 ? (
              <span className="kgflyout-trigger-badge">
                {attentionCount} need attention
              </span>
            ) : (
              <span className="kgflyout-trigger-badge is-clear">All covered</span>
            )}
          </span>
        </button>
        <span className="kgflyout-trigger-controls">
          <select
            value={gapsDays}
            onChange={(e) => onChangeDays(Number(e.target.value))}
            className="kgflyout-days-select"
            aria-label="Knowledge gap analysis window"
          >
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
          <button
            type="button"
            className="kgflyout-trigger-caret-btn"
            onClick={togglePin}
            onFocus={show}
            onBlur={scheduleHide}
            aria-label={open ? 'Hide knowledge gaps' : 'Show knowledge gaps'}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            tabIndex={-1}
          >
            <svg
              className="kgflyout-trigger-caret"
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </span>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.div
                ref={panelRef}
                id={panelId}
                role="region"
                aria-label={`Knowledge gaps over the last ${gapsDays} days`}
                className="kgflyout-panel"
                style={style}
                onMouseEnter={show}
                onMouseLeave={scheduleHide}
                initial={{ opacity: 0, scale: 0.97, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: -6 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="kgflyout-head">
                  <div className="kgflyout-head-text">
                    <span className="kgflyout-head-eyebrow">Knowledge coverage</span>
                    <h3 className="kgflyout-head-heading">Knowledge gaps</h3>
                  </div>
                  <span className="kgflyout-head-window">last {gapsDays} days</span>
                </div>

                <div className="kgflyout-summary">
                  <span className="kgflyout-summary-stat">
                    <strong>{attentionCount}</strong> need attention
                  </span>
                  <span className="kgflyout-summary-sep" aria-hidden="true" />
                  <span className="kgflyout-summary-stat is-muted">
                    <strong>{allGaps.length}</strong> categories analysed
                  </span>
                </div>

                <div className="kgflyout-list" role="list">
                  {ordered.map((g) => {
                    const sev = severityOf(g.gapScore);
                    return (
                      <div key={g.category} className="kgflyout-item" role="listitem">
                        <span className={`kgflyout-score kgflyout-score--${sev}`}>
                          <span className="kgflyout-score-value">{g.gapScore}</span>
                          <span className="kgflyout-score-unit">score</span>
                        </span>
                        <div className="kgflyout-item-body">
                          <div className="kgflyout-item-top">
                            <span className="kgflyout-item-name">
                              {g.category.replace(/-/g, ' ')}
                            </span>
                            {g.hasPlaybook ? (
                              <span className="kgflyout-pb kgflyout-pb--has">Playbook</span>
                            ) : (
                              <span className="kgflyout-pb kgflyout-pb--missing">No playbook</span>
                            )}
                          </div>
                          <div className="kgflyout-meta">
                            <span className="kgflyout-meta-item">
                              <span className="kgflyout-meta-num">{g.resolutionRate}%</span> resolved
                            </span>
                            <span className="kgflyout-meta-item">
                              <span className="kgflyout-meta-num">{g.total}</span> total
                            </span>
                            {g.longConversations?.length > 0 && (
                              <span className="kgflyout-meta-item">
                                <span className="kgflyout-meta-num">{g.longConversations.length}</span>
                                {' '}long convo{g.longConversations.length !== 1 ? 's' : ''}
                              </span>
                            )}
                            {g.uncertainPhrases > 0 && (
                              <span className="kgflyout-meta-item">
                                <span className="kgflyout-meta-num">{g.uncertainPhrases}</span>
                                {' '}uncertain
                              </span>
                            )}
                            {g.escalatedFurther > 0 && (
                              <span className="kgflyout-meta-item kgflyout-meta-item--alert">
                                <span className="kgflyout-meta-num">{g.escalatedFurther}</span>
                                {' '}re-escalated
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {unused.length > 0 && (
                  <div className="kgflyout-unused">
                    <span className="kgflyout-unused-label">
                      Playbook categories with no escalations
                    </span>
                    <div className="kgflyout-unused-tags">
                      {unused.map((c) => (
                        <span key={c} className="kgflyout-unused-tag">
                          {c.replace(/-/g, ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
