import { motion } from 'framer-motion';
import AgentProgressStrip from './AgentProgressStrip.jsx';
import { useRunningTimer } from './useRunningTimer.js';

const SEVERITY_TONE = {
  P1: 'p1', P2: 'p2', P3: 'p3', P4: 'p4',
};

const CONFIDENCE_DOTS = { high: 3, medium: 2, low: 1 };

function deriveCategory(card) {
  if (!card) return '';
  const c = card.category || '';
  return typeof c === 'string' ? c.replace(/-/g, ' ') : '';
}

export default function Widget3Triage({
  stageState, onShowLeft, onShowRight, onToggleSplit, splitView,
  triageCard,
}) {
  const triage = stageState.triage;
  const isRunning = triage.status === 'running' || (triage.status === 'pending' && stageState.parser.status !== 'pending');
  const isDone = triage.status === 'done';
  const isFailed = triage.status === 'failed';
  const isFallback = isDone && Boolean(triage.fallbackUsed);
  const timerText = useRunningTimer(triage.startedAt, isRunning, triage.finishedAt);

  const card = triageCard || null;
  const category = deriveCategory(card);
  const severity = card?.severity || 'P3';
  const fastRead = card?.read || '';
  const nextStep = card?.action || '';
  const missingInfo = Array.isArray(card?.missingInfo) ? card.missingInfo : [];
  const confidence = (card?.confidence || 'medium').toLowerCase();
  const confidenceDots = CONFIDENCE_DOTS[confidence] || 2;

  return (
    <div className="v5-widget v5-widget--triage">
      <header className="v5-widget__head">
        <div className="v5-widget__head-row">
          <div className="v5-widget__nav-icons" role="toolbar" aria-label="Triage navigation">
            <button
              type="button"
              className="v5-nav-icon"
              onClick={onShowLeft}
              title="Show parsed template on top"
              aria-label="Show parsed template on top"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
            <button
              type="button"
              className="v5-nav-icon"
              onClick={onShowRight}
              title="Move to analyst"
              aria-label="Move to analyst"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
            </button>
            <button
              type="button"
              className={`v5-nav-icon ${splitView ? 'is-on' : ''}`}
              onClick={onToggleSplit}
              title="Split: parsed on top, triage on bottom"
              aria-label="Split view"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/></svg>
            </button>
          </div>
          <div className="v5-widget__heading-stack">
            <span className="v5-widget__eyebrow">03</span>
            <h2 className="v5-widget__title">{isFailed ? 'Triage failed' : isDone ? (isFallback ? 'Triaged (fallback)' : 'Triaged') : 'Triage running'}</h2>
          </div>
          <div className="v5-widget__timer" aria-live="polite">
            {isRunning && <span className="v5-widget__timer-dot v5-widget__timer-dot--running" />}
            {isDone && <span className="v5-widget__timer-dot v5-widget__timer-dot--done" />}
            {isFailed && <span className="v5-widget__timer-dot v5-widget__timer-dot--failed" />}
            <span className="v5-widget__timer-value">{isDone || isFailed ? `${((triage.durationMs || 0) / 1000).toFixed(1)}s` : timerText}</span>
          </div>
        </div>
        {isRunning && (
          <div className="v5-progress" aria-hidden="true">
            <motion.div
              className="v5-progress__bar"
              initial={{ x: '-40%' }}
              animate={{ x: '120%' }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </div>
        )}
      </header>

      <div className="v5-widget__body v5-widget__body--scroll">
        {isFailed && (
          <div className="v5-triage-placeholder" style={{ color: '#f97373' }}>
            <span>Triage failed: {triage.error || 'unknown error'}</span>
          </div>
        )}
        {!isDone && !isFailed && (
          <div className="v5-triage-placeholder">
            <motion.span
              className="v5-triage-placeholder__spin"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <span>Categorizing severity and writing the fast read…</span>
          </div>
        )}
        {isDone && card && (
          <motion.div
            className="v5-triage-output"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="v5-triage-header">
              <span className={`v5-sev v5-sev--${SEVERITY_TONE[severity] || 'p3'}`}>{severity}</span>
              {category && <span className="v5-triage-category">{category}</span>}
              <span className="v5-triage-confidence">
                confidence: <strong>{confidence}</strong>
                <span className="v5-conf-dots">
                  <span className={`v5-conf-dots__dot${confidenceDots >= 1 ? ' on' : ''}`} />
                  <span className={`v5-conf-dots__dot${confidenceDots >= 2 ? ' on' : ''}`} />
                  <span className={`v5-conf-dots__dot${confidenceDots >= 3 ? ' on' : ''}`} />
                </span>
              </span>
            </div>
            {fastRead && (
              <div className="v5-triage-block">
                <div className="v5-triage-block__label">Fast read</div>
                <div className="v5-triage-block__value">{fastRead}</div>
              </div>
            )}
            {nextStep && (
              <div className="v5-triage-block v5-triage-block--next">
                <div className="v5-triage-block__label">Immediate next step</div>
                <div className="v5-triage-block__value">{nextStep}</div>
              </div>
            )}
            {missingInfo.length > 0 && (
              <div className="v5-triage-missing">
                <span className="v5-triage-missing__label">Missing info:</span>
                {missingInfo.map((item, i) => (
                  <span key={`missing-${i}`} className="v5-chip">{item}</span>
                ))}
              </div>
            )}
          </motion.div>
        )}
        {isDone && !card && (
          <div className="v5-triage-placeholder">
            <span>No triage card produced.</span>
          </div>
        )}
      </div>

      <footer className="v5-widget__foot">
        <AgentProgressStrip stageState={stageState} exclude="triage" />
      </footer>
    </div>
  );
}
