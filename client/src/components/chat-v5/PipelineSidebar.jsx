import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { STAGE_LABELS, STAGE_DESCRIPTIONS } from './mockData.js';
import { useRunningTimer } from './useRunningTimer.js';
import { PIPELINE_RUNTIME_IDS } from './pipelineRuntime.js';
import { useAgentRegistry } from '../../context/AgentRegistryContext.jsx';
import {
  healthStatusToOperationalToken,
  healthStatusLabel,
  buildDotTooltip,
} from '../../lib/agentStatus.js';

const PIPE_ORDER = ['parser', 'inv', 'triage', 'main'];

function PipeStep({ index, stageKey, stage, agentHealth }) {
  const timerText = useRunningTimer(stage.startedAt, stage.status === 'running', stage.finishedAt);
  const fallbackUsed = stage.status === 'done' && Boolean(stage.fallbackUsed);
  const statusText = stage.status === 'done'
    ? `${((stage.durationMs || 0) / 1000).toFixed(1)}s${fallbackUsed ? ' · fallback' : ''}`
    : stage.status === 'failed'
      ? 'failed'
    : stage.status === 'running' ? timerText
      : 'waiting';
  const fallbackTitle = fallbackUsed
    ? (stage.fallbackReason || 'Rule fallback was used for this stage.')
    : undefined;

  // Per-stage agent reachability dot. Source: registry's health.status mapped
  // to the existing status-dot-* CSS tokens via the shared agentStatus helper.
  // INDEPENDENT of stage.status (Waiting/Running/Done) — the timer text still
  // tells you where the stage is in the pipeline; this dot tells you whether
  // the agent assigned to that stage is reachable right now. If the registry
  // hasn't loaded this agent yet (bootstrap window or unknown id) we fall
  // through to 'idle' so the dot still renders rather than disappearing.
  const healthToken = healthStatusToOperationalToken(agentHealth?.status);
  // Full tooltip honors the plan's AC#13 / exceeds-bar format:
  //   "Online · last checked 12s ago" / "Offline · last checked 47s ago".
  // The aria-label keeps the short status label so screen-reader output isn't
  // cluttered with a freshness hint that the underlying timestamp will not
  // update live (browsers don't re-render `title` until the next mouseover).
  const healthLabel = healthStatusLabel(agentHealth?.status);
  const healthTitle = buildDotTooltip(agentHealth?.status, agentHealth?.checkedAt);

  return (
    <div
      className={`v5-pipe-step v5-pipe-step--${stage.status}${fallbackUsed ? ' v5-pipe-step--fallback' : ''}`}
      title={fallbackTitle}
    >
      <div className="v5-pipe-step__indicator">
        {stage.status === 'done' ? (
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2 6.5l2.5 2.5 5.5-6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : stage.status === 'failed' ? (
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          </svg>
        ) : stage.status === 'running' ? (
          <motion.span
            className="v5-pipe-step__spin"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        ) : (
          <span className="v5-pipe-step__num">{index + 1}</span>
        )}
      </div>
      <div className="v5-pipe-step__body">
        <div className="v5-pipe-step__name">
          <span
            className={`status-dot status-dot-${healthToken} v5-pipe-step__health-dot`}
            title={healthTitle}
            aria-label={`Agent status: ${healthLabel}`}
          />
          {STAGE_LABELS[stageKey]}
        </div>
        <div className="v5-pipe-step__desc">{STAGE_DESCRIPTIONS[stageKey]}</div>
      </div>
      <div className="v5-pipe-step__timer">{statusText}</div>
      {index < PIPE_ORDER.length - 1 && (
        <div className={`v5-pipe-step__connector ${stage.status === 'done' ? 'is-active' : ''}`} aria-hidden="true" />
      )}
    </div>
  );
}

function InvMatch({ match, isRevealed }) {
  return (
    <motion.div
      className={`v5-inv-row ${match.best ? 'is-best' : ''}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: isRevealed ? 1 : 0, y: isRevealed ? 0 : 6 }}
      transition={{ duration: 0.25 }}
    >
      <div className="v5-inv-row__head">
        <span className="v5-inv-row__id">{match.id}</span>
        <span className={`v5-inv-row__similarity ${match.best ? 'is-best' : ''}`}>{match.similarity}% match</span>
      </div>
      <div className="v5-inv-row__title">{match.title}</div>
      <div className="v5-inv-row__meta">
        <span>{match.status}</span>
        {match.age && (
          <>
            <span className="v5-inv-row__dot">·</span>
            <span>{match.age}</span>
          </>
        )}
        {match.note && (
          <>
            <span className="v5-inv-row__dot">·</span>
            <span>{match.note}</span>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default function PipelineSidebar({ stageState, imageCaptured, invMatches }) {
  const invStage = stageState.inv;
  const invRunning = invStage.status === 'running';
  const invDone = invStage.status === 'done';
  const invFailed = invStage.status === 'failed';
  const invTimerText = useRunningTimer(invStage.startedAt, invRunning, invStage.finishedAt);
  const realMatches = Array.isArray(invMatches) ? invMatches : [];

  // Subscribe to the agent registry ONCE here so every PipeStep below can read
  // its assigned agent's health without violating the Rules of Hooks inside a
  // .map() loop. The stage → agentId mapping is the existing single source of
  // truth in pipelineRuntime.js (PIPELINE_RUNTIME_IDS), reused so the dot
  // color always reflects the agent that the pipeline orchestrator will
  // actually invoke for that stage.
  const agentRegistry = useAgentRegistry();
  const healthByStage = useMemo(() => {
    const out = {};
    const agents = agentRegistry?.agents || {};
    for (const stageKey of PIPE_ORDER) {
      const agentId = PIPELINE_RUNTIME_IDS[stageKey];
      out[stageKey] = agents[agentId]?.health || null;
    }
    return out;
  }, [agentRegistry]);

  return (
    <aside className="v5-sidebar" aria-label="Run pipeline and INV context">
      <section className="v5-sidebar__section">
        <h3 className="v5-sidebar__heading">Pipeline <span className="v5-sidebar__by">· this run</span></h3>
        <div className="v5-pipe">
          {PIPE_ORDER.map((key, idx) => (
            <PipeStep
              key={key}
              index={idx}
              stageKey={key}
              stage={stageState[key]}
              agentHealth={healthByStage[key]}
            />
          ))}
        </div>
      </section>

      <section className="v5-sidebar__section">
        <h3 className="v5-sidebar__heading">
          Prior cases <span className="v5-sidebar__by">· INV search {invDone ? `· ${((invStage.durationMs || 0) / 1000).toFixed(1)}s` : invRunning ? `· ${invTimerText}` : invFailed ? '· failed' : ''}</span>
        </h3>
        {!imageCaptured && (
          <div className="v5-sidebar__hint">Drop a screenshot to start the search.</div>
        )}
        {invRunning && !invDone && (
          <div className="v5-inv-loading">
            <motion.span
              className="v5-inv-loading__spin"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            />
            <span>Searching prior INV-XXXXXX cases…</span>
          </div>
        )}
        <AnimatePresence>
          {invDone && (
            <motion.div
              key="inv-list"
              className="v5-inv-list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              {realMatches.length > 0 ? (
                realMatches.map((m) => (
                  <InvMatch key={m.id} match={m} isRevealed />
                ))
              ) : (
                <div className="v5-sidebar__hint">No prior INV cases matched.</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </aside>
  );
}
