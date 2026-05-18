import { motion } from 'framer-motion';
import { STAGE_KEYS, STAGE_LABELS } from './mockData.js';
import { useRunningTimer } from './useRunningTimer.js';

function AgentPip({ stageKey, stage }) {
  const status = stage?.status || 'pending';
  const timerText = useRunningTimer(stage?.startedAt, status === 'running', stage?.finishedAt);
  return (
    <div className={`v5-agent-pip v5-agent-pip--${status}`} aria-label={`${STAGE_LABELS[stageKey]} ${status}`}>
      <span className="v5-agent-pip__dot">
        {status === 'done' && (
          <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        {status === 'running' && (
          <motion.span
            className="v5-agent-pip__spin"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          />
        )}
      </span>
      <span className="v5-agent-pip__label">{STAGE_LABELS[stageKey]}</span>
      <span className="v5-agent-pip__timer">
        {status === 'done' ? `${(stage.durationMs / 1000).toFixed(1)}s`
          : status === 'running' ? timerText
            : '—'}
      </span>
    </div>
  );
}

export default function AgentProgressStrip({ stageState, exclude, variant = 'footer' }) {
  const visible = STAGE_KEYS.filter((k) => k !== exclude);
  return (
    <div className={`v5-agent-strip v5-agent-strip--${variant}`}>
      {visible.map((k) => (
        <AgentPip key={k} stageKey={k} stage={stageState[k]} />
      ))}
    </div>
  );
}
